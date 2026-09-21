"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { reviewApplicationDocumentSubmissionAction, submitStaffApplicationDocumentAction, submitStudentApplicationDocumentAction } from "@/lib/portal/application-documents-actions";
import { APPLICATION_DOCUMENT_PENDING_EVENT, clearApplicationDocumentPending, listApplicationDocumentPending, withApplicationDocumentLock } from "@/lib/portal/application-documents-pending";
import { documentActionMessage, ProgramDocumentUpload, type ProgramDocumentScope } from "./ProgramDocumentControls";
import type { ProgramDocumentStrings } from "./ProgramDocumentEvidence";
import styles from "./ProgramDocuments.module.css";
import { useDocumentHydration } from "./useDocumentHydration";

type Entry = ReturnType<typeof listApplicationDocumentPending>[number];
function subscribe(callback: () => void) {
  window.addEventListener(APPLICATION_DOCUMENT_PENDING_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(APPLICATION_DOCUMENT_PENDING_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
function RecoverEntry({ entry, scope, audience, strings, onSaved }: {
  entry: Entry; scope: ProgramDocumentScope; audience: "student" | "staff"; strings: ProgramDocumentStrings; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const lock = useRef(false);
  const intent = entry.intent;
  const hydrated = useDocumentHydration();
  async function retry() {
    if (!intent || entry.blocked || lock.current || entry.operation === "upload") return;
    lock.current = true; setBusy(true); setMessage(null); setSucceeded(false);
    try {
      const locked = await withApplicationDocumentLock(scope, entry.operation, entry.target, async () => {
        const result = "decision" in intent ? await reviewApplicationDocumentSubmissionAction(scope, intent)
          : "selection" in intent ? await (audience === "student" ? submitStudentApplicationDocumentAction : submitStaffApplicationDocumentAction)(scope, intent) : null;
        if (!result) return;
        let cleared = true;
        if (result.ok || result.resolution === "not_written") {
          try { clearApplicationDocumentPending(scope, entry.operation, entry.target, intent); } catch { cleared = false; }
        }
        if (!result.ok) setMessage(documentActionMessage(result.reason, strings));
        else {
          setSucceeded(true);
          const confirmed = "decision" in intent ? strings.reviewSaved : strings.sent;
          setMessage(cleared ? confirmed : `${confirmed} ${strings.cleanupFailed}`);
          try { onSaved(); } catch { /* A confirmed receipt remains confirmed if refresh fails. */ }
        }
      });
      if (!locked.acquired) setMessage(locked.reason === "busy" ? strings.pending : strings.storageUnavailable);
    } catch { setMessage(strings.unavailable); }
    finally { lock.current = false; setBusy(false); }
  }
  if (entry.blocked || !intent) return <p className={styles.error} role="alert">{strings.storageUnavailable}</p>;
  if ("file" in intent) return <ProgramDocumentUpload scope={scope} target={{ studentCaseId: intent.studentCaseId,
    applicationId: intent.applicationId, requirementsRevisionId: intent.requirementsRevisionId,
    requirementItemId: intent.requirementItemId, documentSlotId: intent.documentSlotId,
  }} audience={audience} strings={strings} onSaved={onSaved} />;
  return <div className={styles.section}>
    <p className={styles.note}>{strings.pending}</p>
    <button type="button" className={styles.secondary} disabled={!hydrated || busy} onClick={() => void retry()}>{busy ? strings.sending : strings.retry}</button>
    {message ? <p className={succeeded ? styles.note : styles.error} role={succeeded ? "status" : "alert"}>{message}</p> : null}
  </div>;
}

export function ProgramDocumentRecovery({ scope, audience, currentItemIds, currentSubmissionIds, strings, onSaved, onlyReviews = false }: {
  scope: ProgramDocumentScope; audience: "student" | "staff"; currentItemIds: readonly string[];
  currentSubmissionIds: readonly string[]; strings: ProgramDocumentStrings; onSaved: () => void;
  onlyReviews?: boolean;
}) {
  const snapshot = useSyncExternalStore(subscribe, () => {
    try { return JSON.stringify(listApplicationDocumentPending(scope)); } catch { return "unavailable"; }
  }, () => "[]");
  const entries = useMemo(() => snapshot === "unavailable" ? [] : JSON.parse(snapshot) as readonly Entry[], [snapshot]);
  const hidden = entries.filter(entry => (!onlyReviews || entry.operation === "review") && (entry.blocked || (entry.operation === "review"
    ? !currentSubmissionIds.includes(entry.target) : !currentItemIds.includes(entry.target))));
  if (snapshot === "unavailable") return <p className={styles.error} role="alert">{strings.storageUnavailable}</p>;
  if (!hidden.length) return null;
  return <section className={`${styles.root} ${audience === "student" ? styles.portal : ""} ${styles.section}`} aria-label={strings.retry}>
    <h3 className={styles.heading}>{strings.retry}</h3>
    {hidden.map(entry => <RecoverEntry key={`${entry.operation}:${entry.target}`} entry={entry} scope={scope} audience={audience} strings={strings} onSaved={onSaved} />)}
  </section>;
}
