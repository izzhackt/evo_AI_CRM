"use client";

import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  ApplicationDocumentItemTarget, ApplicationDocuments,
  ApplicationDocumentSubmitIntent, ApplicationDocumentUploadIntent,
} from "@/lib/portal/application-documents";
import { submitStudentApplicationDocumentAction, submitStaffApplicationDocumentAction } from "@/lib/portal/application-documents-actions";
import {
  runApplicationDocumentSubmit, runApplicationDocumentUploadAndSubmit, type ApplicationDocumentUploadAndSubmitOutcome,
} from "@/lib/portal/application-documents-commands";
import type { ApplicationDocumentNotice } from "@/lib/portal/application-documents-one-tap";
import { APPLICATION_DOCUMENT_PENDING_EVENT, readApplicationDocumentPending } from "@/lib/portal/application-documents-pending";
import { formatPortalString } from "@/lib/portal/i18n";
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

/** Student one tap: the send that follows a confirmed save, with the values taken at tap time. */
export type ProgramDocumentSendAfterSave = Readonly<{ previousSubmissionId: string | null }>;
type UploadFailure = Extract<ApplicationDocumentUploadAndSubmitOutcome, { stage: "upload" }>["upload"];
type SendStep = Extract<ApplicationDocumentUploadAndSubmitOutcome, { stage: "done" }>["submit"];

function uploadFailureMessage(outcome: UploadFailure, strings: ProgramDocumentStrings) {
  switch (outcome.status) {
    case "invalid_file": return strings.fileInvalid;
    case "wrong_file": return strings.wrongFile;
    case "rejected": return documentActionMessage(outcome.reason, strings);
    case "locked": return outcome.reason === "busy" ? strings.pending : strings.storageUnavailable;
  }
}
/** What the student reads when the file is saved but the send did not go through. */
function sendFailureMessage(outcome: SendStep, strings: ProgramDocumentStrings): string | null {
  const notSent = (reason: string) => formatPortalString(strings.savedNotSent, { reason });
  switch (outcome.status) {
    // Unknown result: the intent stays on the device and the Submit control shows «Проверить результат».
    case "unknown": return strings.unavailable;
    case "rejected": return outcome.reason === "unavailable" && outcome.resolution === "retain"
      ? strings.unavailable : notSent(documentActionMessage(outcome.reason, strings));
    // This tab never started the send: the file is saved and another tab is sending this document.
    case "locked": return outcome.reason === "busy" ? strings.savedSendBusy : notSent(strings.storageUnavailable);
    default: return null;
  }
}

export function ProgramDocumentUpload({ scope, target, audience, strings, onSaved, onNotice, onSendingChange, sendAfterSave, quiet = false, disabled = false }: {
  scope: ProgramDocumentScope;
  target: ApplicationDocumentItemTarget;
  audience: "student" | "staff";
  strings: ProgramDocumentStrings;
  onSaved: () => void;
  /** Receives the one-tap result that must stay visible after the refresh remounts this form. */
  onNotice?: (notice: ApplicationDocumentNotice | null) => void;
  /** Student who may submit: one tap saves the file and sends exactly that version for review. */
  sendAfterSave?: ProgramDocumentSendAfterSave;
  /** Reports the one-tap run while it lasts (its tap-time values), then null: its own submit intent is not a retained one. */
  onSendingChange?: (run: ProgramDocumentSendAfterSave | null) => void;
  /** Another action (sending a saved file) is the main one right now. */
  quiet?: boolean;
  disabled?: boolean;
}) {
  const inputId = useId();
  const hydrated = useDocumentHydration();
  const input = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const [stage, setStage] = useState<"upload" | "submit" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const pending = useProgramDocumentPending(scope, "upload", target.requirementItemId);
  const retained = pending.intent && "file" in pending.intent ? pending.intent as ApplicationDocumentUploadIntent : null;
  const busy = stage !== null;
  const oneTap = audience === "student" && Boolean(sendAfterSave);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || pending.blocked || (disabled && !retained)) return;
    const file = input.current?.files?.[0];
    if (!file) { setMessage(retained ? strings.reselectFile : strings.fileInvalid); return; }
    sending.current = true; setStage("upload"); setMessage(null); setSucceeded(false);
    try { onNotice?.(null); } catch { /* Display only. */ }
    const run = oneTap ? sendAfterSave ?? null : null;
    if (run) { try { onSendingChange?.(run); } catch { /* Display only. */ } }
    let saved = false;
    try {
      const outcome = await runApplicationDocumentUploadAndSubmit({
        scope, audience, target, file, onStage: setStage,
        sendAfterUpload: run ? { previousSubmissionId: run.previousSubmissionId, submit: submitStudentApplicationDocumentAction } : null,
      });
      if (outcome.stage === "upload") { setMessage(uploadFailureMessage(outcome.upload, strings)); return; }
      saved = true;
      if (input.current) input.current.value = "";
      const { upload, submit } = outcome;
      const failure = sendFailureMessage(submit, strings);
      if (failure !== null) {
        // The file is saved; the refresh below shows it with the ordinary send button.
        if (onNotice) onNotice({ tone: "error", text: failure, versionId: upload.receipt.documentVersionId }); else setMessage(failure);
      } else {
        const sent = submit.status === "sent";
        const cleaned = upload.cleared && (submit.status !== "sent" || submit.cleared);
        const text = `${sent ? strings.sent : strings.saved}${cleaned ? "" : ` ${strings.cleanupFailed}`}`;
        setSucceeded(true);
        setMessage(text);
        // The refresh below remounts this form and drops the message above; the item keeps the confirmation.
        if (sent) { try { onNotice?.({ tone: "success", text, versionId: upload.receipt.documentVersionId }); } catch { /* Display only. */ } }
      }
    } catch { setMessage(strings.unavailable); }
    finally {
      sending.current = false; setStage(null);
      if (run) { try { onSendingChange?.(null); } catch { /* Display only. */ } }
      // One refresh after the whole sequence: a remount mid-send would drop this form while it still works.
      if (saved) { try { onSaved(); } catch { /* A confirmed receipt remains confirmed if refresh fails. */ } }
    }
  }
  if (disabled && !retained && !pending.blocked) return null;
  const inert = !hydrated || busy || pending.blocked || (disabled && !retained);
  return <form className={styles.form} onSubmit={save} aria-busy={busy}>
    <div>
      <label className={styles.label} htmlFor={inputId}>{retained ? strings.reselectFile : strings.chooseFile}</label>
      <input ref={input} id={inputId} className={styles.input} type="file" accept="application/pdf,image/jpeg,image/png"
        required disabled={inert} aria-describedby={`${inputId}-help`} />
      <p id={`${inputId}-help`} className={styles.meta}>{strings.formats}</p>
    </div>
    {retained && !succeeded ? <p className={styles.note}>{strings.pending} <span className={styles.filename}>{retained.file.originalFilename}</span></p> : null}
    {pending.blocked ? <p role="alert" className={styles.error}>{strings.storageUnavailable}</p> : null}
    <div className={styles.actions}><button className={oneTap && !quiet ? styles.button : styles.secondary} type="submit" disabled={inert}>
      {stage === "submit" ? strings.sending : stage === "upload" ? (oneTap ? strings.uploading : strings.saving)
        : retained ? strings.retry : oneTap ? strings.uploadAndSend : strings.saveFile}
    </button></div>
    {message ? <p className={succeeded ? styles.note : styles.error} role={succeeded ? "status" : "alert"}>{message}</p> : null}
  </form>;
}

export function ProgramDocumentSubmit({ scope, target, audience, selection, previousSubmissionId, strings, onSaved, onAttempt, hideWhenIdle = false, suppressed = false, disabled = false }: {
  scope: ProgramDocumentScope;
  target: ApplicationDocumentItemTarget;
  audience: "student" | "staff";
  selection: ApplicationDocumentSubmitIntent["selection"] | null;
  previousSubmissionId: string | null;
  strings: ProgramDocumentStrings;
  onSaved: () => void;
  /** Called when a send starts, so an earlier «saved, not sent» notice does not outlive it. */
  onAttempt?: () => void;
  /** Student: show nothing while there is no saved file to send and no unfinished send. */
  hideWhenIdle?: boolean;
  /** This item's one-tap send is running: the submit intent it stored is not a retained one, and nothing is sent beside it. */
  suppressed?: boolean;
  disabled?: boolean;
}) {
  const pending = useProgramDocumentPending(scope, "submit", target.requirementItemId);
  const hydrated = useDocumentHydration();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const retained = !suppressed && pending.intent && "selection" in pending.intent ? pending.intent as ApplicationDocumentSubmitIntent : null;
  async function submit() {
    if (sending.current || suppressed || pending.blocked || (!retained && (disabled || !selection))) return;
    sending.current = true; setBusy(true); setMessage(null); setSucceeded(false);
    try { onAttempt?.(); } catch { /* Display only. */ }
    try {
      const outcome = await runApplicationDocumentSubmit({
        scope, target, selection, previousSubmissionId, whenRetained: "resend",
        submit: audience === "student" ? submitStudentApplicationDocumentAction : submitStaffApplicationDocumentAction,
      });
      switch (outcome.status) {
        case "sent":
          setSucceeded(true); setMessage(outcome.cleared ? strings.sent : `${strings.sent} ${strings.cleanupFailed}`);
          try { onSaved(); } catch { /* The exact submission receipt is already known. */ }
          break;
        case "rejected": setMessage(documentActionMessage(outcome.reason, strings)); break;
        case "locked": setMessage(outcome.reason === "busy" ? strings.pending : strings.storageUnavailable); break;
        case "unknown": setMessage(strings.unavailable); break;
        default: break;
      }
    } catch { setMessage(strings.unavailable); }
    finally { sending.current = false; setBusy(false); }
  }
  if (hideWhenIdle && !retained && !selection && !pending.blocked && !busy && !message) return null;
  return <div className={styles.section} aria-busy={busy}>
    {retained && !succeeded ? <p className={styles.note}>{strings.pending}</p> : null}
    {pending.blocked ? <p className={styles.error} role="alert">{strings.storageUnavailable}</p> : null}
    <button type="button" className={styles.button} disabled={!hydrated || busy || suppressed || pending.blocked || (!retained && (disabled || !selection))} onClick={() => void submit()}>
      {busy ? strings.sending : retained ? strings.retry : strings.send}
    </button>
    {message ? <p className={succeeded ? styles.note : styles.error} role={succeeded ? "status" : "alert"}>{message}</p> : null}
  </div>;
}

export type ProgramDocumentItem = ApplicationDocuments["items"][number];
