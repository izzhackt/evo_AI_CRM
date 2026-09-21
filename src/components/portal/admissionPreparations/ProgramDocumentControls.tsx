"use client";

import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  ApplicationDocumentItemTarget, ApplicationDocuments,
  ApplicationDocumentSubmitIntent, ApplicationDocumentUploadIntent,
} from "@/lib/portal/application-documents";
import { submitStudentApplicationDocumentAction, submitStaffApplicationDocumentAction } from "@/lib/portal/application-documents-actions";
import {
  APPLICATION_DOCUMENT_PENDING_EVENT, clearApplicationDocumentPending,
  persistApplicationDocumentPending, readApplicationDocumentPending, withApplicationDocumentLock,
} from "@/lib/portal/application-documents-pending";
import { freezeApplicationDocumentUploadIntent, uploadApplicationDocumentFile } from "@/lib/portal/application-documents-upload";
import type { ProgramDocumentStrings } from "./ProgramDocumentEvidence";
import styles from "./ProgramDocuments.module.css";
import { useDocumentHydration } from "./useDocumentHydration";

export type ProgramDocumentScope = Readonly<{
  organizationId: string; membershipId: string; studentCaseId: string; applicationId: string;
}>;
type Operation = "upload" | "submit" | "review";
type Pending = ReturnType<typeof readApplicationDocumentPending>;
function subscribe(callback: () => void) {
  window.addEventListener(APPLICATION_DOCUMENT_PENDING_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(APPLICATION_DOCUMENT_PENDING_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
export function useProgramDocumentPending(scope: ProgramDocumentScope, operation: Operation, target: string): Pending {
  const snapshot = useSyncExternalStore(subscribe,
    () => JSON.stringify(readApplicationDocumentPending(scope, operation, target)),
    () => '{"intent":null,"blocked":false}');
  return useMemo(() => JSON.parse(snapshot) as Pending, [snapshot]);
}
export function documentActionMessage(reason: string, strings: ProgramDocumentStrings) {
  if (reason === "forbidden") return strings.forbidden;
  if (["stale_context", "request_conflict", "invalid", "case_ineligible", "application_ineligible"].includes(reason)) return strings.changed;
  if (["file_too_large", "unsupported_type"].includes(reason)) return strings.fileInvalid;
  if (reason === "malware_detected") return strings.uploadFailed;
  if (reason === "storage_unavailable") return strings.storageUnavailable;
  return strings.unavailable;
}

function sameUpload(a: ApplicationDocumentUploadIntent, b: ApplicationDocumentUploadIntent) {
  return a.requestId === b.requestId && a.studentCaseId === b.studentCaseId
    && a.applicationId === b.applicationId && a.requirementsRevisionId === b.requirementsRevisionId
    && a.requirementItemId === b.requirementItemId && a.documentSlotId === b.documentSlotId
    && a.file.originalFilename === b.file.originalFilename && a.file.declaredMimeType === b.file.declaredMimeType
    && a.file.byteSize === b.file.byteSize && a.file.sha256Hex === b.file.sha256Hex;
}

export function ProgramDocumentUpload({ scope, target, audience, strings, onSaved, disabled = false }: {
  scope: ProgramDocumentScope;
  target: ApplicationDocumentItemTarget;
  audience: "student" | "staff";
  strings: ProgramDocumentStrings;
  onSaved: () => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const hydrated = useDocumentHydration();
  const input = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const pending = useProgramDocumentPending(scope, "upload", target.requirementItemId);
  const retained = pending.intent && "file" in pending.intent ? pending.intent as ApplicationDocumentUploadIntent : null;
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || pending.blocked || (disabled && !retained)) return;
    const file = input.current?.files?.[0];
    if (!file) { setMessage(retained ? strings.reselectFile : strings.fileInvalid); return; }
    sending.current = true; setBusy(true); setMessage(null); setSucceeded(false);
    try {
      const locked = await withApplicationDocumentLock(scope, "upload", target.requirementItemId, async () => {
        const saved = readApplicationDocumentPending(scope, "upload", target.requirementItemId);
        if (saved.blocked) throw new Error("storage_unavailable");
        const old = saved.intent && "file" in saved.intent ? saved.intent as ApplicationDocumentUploadIntent : null;
        // A recovery uses its original revision/item, even after requirements change.
        const originalTarget = old ? { studentCaseId: old.studentCaseId, applicationId: old.applicationId,
          requirementsRevisionId: old.requirementsRevisionId, requirementItemId: old.requirementItemId,
          documentSlotId: old.documentSlotId } : target;
        const next = await freezeApplicationDocumentUploadIntent(originalTarget, file, old?.requestId);
        if (!next) { setMessage(strings.fileInvalid); return; }
        if (old && !sameUpload(old, next)) { setMessage(strings.wrongFile); return; }
        const intent = old ?? next;
        persistApplicationDocumentPending(scope, "upload", target.requirementItemId, intent);
        const result = await uploadApplicationDocumentFile({ audience, intent, file });
        let cleared = true;
        if (result.ok || result.resolution === "not_written") {
          try { clearApplicationDocumentPending(scope, "upload", target.requirementItemId, intent); } catch { cleared = false; }
        }
        if (!result.ok) { setMessage(documentActionMessage(result.reason, strings)); return; }
        if (input.current) input.current.value = "";
        setSucceeded(true); setMessage(cleared ? strings.saved : `${strings.saved} ${strings.cleanupFailed}`);
        try { onSaved(); } catch { /* A confirmed receipt remains confirmed if refresh fails. */ }
      });
      if (!locked.acquired) setMessage(locked.reason === "busy" ? strings.pending : strings.storageUnavailable);
    } catch { setMessage(strings.unavailable); }
    finally { sending.current = false; setBusy(false); }
  }
  if (disabled && !retained && !pending.blocked) return null;
  return <form className={styles.form} onSubmit={save} aria-busy={busy}>
    <div>
      <label className={styles.label} htmlFor={inputId}>{retained ? strings.reselectFile : strings.chooseFile}</label>
      <input ref={input} id={inputId} className={styles.input} type="file" accept="application/pdf,image/jpeg,image/png"
        required disabled={!hydrated || busy || pending.blocked || (disabled && !retained)} aria-describedby={`${inputId}-help`} />
      <p id={`${inputId}-help`} className={styles.meta}>{strings.formats}</p>
    </div>
    {retained && !succeeded ? <p className={styles.note}>{strings.pending} <span className={styles.filename}>{retained.file.originalFilename}</span></p> : null}
    {pending.blocked ? <p role="alert" className={styles.error}>{strings.storageUnavailable}</p> : null}
    <div className={styles.actions}><button className={styles.secondary} type="submit" disabled={!hydrated || busy || pending.blocked || (disabled && !retained)}>
      {busy ? strings.saving : retained ? strings.retry : strings.saveFile}
    </button></div>
    {message ? <p className={succeeded ? styles.note : styles.error} role={succeeded ? "status" : "alert"}>{message}</p> : null}
  </form>;
}

export function ProgramDocumentSubmit({ scope, target, audience, selection, previousSubmissionId, strings, onSaved, disabled = false }: {
  scope: ProgramDocumentScope;
  target: ApplicationDocumentItemTarget;
  audience: "student" | "staff";
  selection: ApplicationDocumentSubmitIntent["selection"] | null;
  previousSubmissionId: string | null;
  strings: ProgramDocumentStrings;
  onSaved: () => void;
  disabled?: boolean;
}) {
  const pending = useProgramDocumentPending(scope, "submit", target.requirementItemId);
  const hydrated = useDocumentHydration();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const retained = pending.intent && "selection" in pending.intent ? pending.intent as ApplicationDocumentSubmitIntent : null;
  async function submit() {
    if (sending.current || pending.blocked || (!retained && (disabled || !selection))) return;
    sending.current = true; setBusy(true); setMessage(null); setSucceeded(false);
    try {
      const locked = await withApplicationDocumentLock(scope, "submit", target.requirementItemId, async () => {
        const saved = readApplicationDocumentPending(scope, "submit", target.requirementItemId);
        if (saved.blocked) throw new Error("storage_unavailable");
        const old = saved.intent && "selection" in saved.intent ? saved.intent as ApplicationDocumentSubmitIntent : null;
        if (!old && !selection) return;
        const intent: ApplicationDocumentSubmitIntent = old ?? {
          studentCaseId: target.studentCaseId, applicationId: target.applicationId,
          requirementsRevisionId: target.requirementsRevisionId, requirementItemId: target.requirementItemId,
          requestId: crypto.randomUUID(),
          selection: selection!, expectedPreviousSubmissionId: previousSubmissionId };
        persistApplicationDocumentPending(scope, "submit", target.requirementItemId, intent);
        const result = await (audience === "student" ? submitStudentApplicationDocumentAction : submitStaffApplicationDocumentAction)(scope, intent);
        let cleared = true;
        if (result.ok || result.resolution === "not_written") {
          try { clearApplicationDocumentPending(scope, "submit", target.requirementItemId, intent); } catch { cleared = false; }
        }
        if (!result.ok) { setMessage(documentActionMessage(result.reason, strings)); return; }
        setSucceeded(true); setMessage(cleared ? strings.sent : `${strings.sent} ${strings.cleanupFailed}`);
        try { onSaved(); } catch { /* The exact submission receipt is already known. */ }
      });
      if (!locked.acquired) setMessage(locked.reason === "busy" ? strings.pending : strings.storageUnavailable);
    } catch { setMessage(strings.unavailable); }
    finally { sending.current = false; setBusy(false); }
  }
  return <div className={styles.section} aria-busy={busy}>
    {retained && !succeeded ? <p className={styles.note}>{strings.pending}</p> : null}
    {pending.blocked ? <p className={styles.error} role="alert">{strings.storageUnavailable}</p> : null}
    <button type="button" className={styles.button} disabled={!hydrated || busy || pending.blocked || (!retained && (disabled || !selection))} onClick={() => void submit()}>
      {busy ? strings.sending : retained ? strings.retry : strings.send}
    </button>
    {message ? <p className={succeeded ? styles.note : styles.error} role={succeeded ? "status" : "alert"}>{message}</p> : null}
  </div>;
}

export type ProgramDocumentItem = ApplicationDocuments["items"][number];
