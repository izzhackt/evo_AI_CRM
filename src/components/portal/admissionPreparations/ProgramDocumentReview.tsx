"use client";

import { useId, useRef, useState } from "react";
import type { ApplicationDocumentReviewDecision, ApplicationDocumentReviewIntent } from "@/lib/portal/application-documents";
import { reviewApplicationDocumentSubmissionAction } from "@/lib/portal/application-documents-actions";
import { clearApplicationDocumentPending, persistApplicationDocumentPending, readApplicationDocumentPending, withApplicationDocumentLock } from "@/lib/portal/application-documents-pending";
import { documentActionMessage, useProgramDocumentPending, type ProgramDocumentScope } from "./ProgramDocumentControls";
import type { ProgramDocumentStrings, ProgramSubmission } from "./ProgramDocumentEvidence";
import styles from "./ProgramDocuments.module.css";
import { useDocumentHydration } from "./useDocumentHydration";

export function ProgramDocumentReview({ scope, submission, strings, canReview, onSaved }: {
  scope: ProgramDocumentScope; submission: ProgramSubmission; strings: ProgramDocumentStrings;
  canReview: boolean; onSaved: () => void;
}) {
  const id = useId();
  const hydrated = useDocumentHydration();
  const pending = useProgramDocumentPending(scope, "review", submission.submissionId);
  const retained = pending.intent && "decision" in pending.intent ? pending.intent as ApplicationDocumentReviewIntent : null;
  const [decision, setDecision] = useState<ApplicationDocumentReviewDecision>("approved");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const sending = useRef(false);
  if (!canReview && !retained && !pending.blocked) return null;
  const locked = !hydrated || busy || !!retained || pending.blocked;
  const shownDecision = retained?.decision ?? decision;
  const shownReason = retained?.reason ?? reason;
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || pending.blocked || (!canReview && !retained)) return;
    const trimmed = reason.trim();
    if (!retained && decision !== "approved" && !trimmed) { setMessage(strings.reasonRequired); return; }
    sending.current = true; setBusy(true); setMessage(null); setSucceeded(false);
    try {
      const result = await withApplicationDocumentLock(scope, "review", submission.submissionId, async () => {
        const saved = readApplicationDocumentPending(scope, "review", submission.submissionId);
        if (saved.blocked) throw new Error("storage_unavailable");
        const old = saved.intent && "decision" in saved.intent ? saved.intent as ApplicationDocumentReviewIntent : null;
        const intent: ApplicationDocumentReviewIntent = old ?? {
          submissionId: submission.submissionId, expectedPreviousReviewId: submission.review?.reviewId ?? null,
          decision, reason: decision === "approved" ? null : trimmed, requestId: crypto.randomUUID(),
        };
        persistApplicationDocumentPending(scope, "review", submission.submissionId, intent);
        const response = await reviewApplicationDocumentSubmissionAction(scope, intent);
        let cleared = true;
        if (response.ok || response.resolution === "not_written") {
          try { clearApplicationDocumentPending(scope, "review", submission.submissionId, intent); } catch { cleared = false; }
        }
        if (!response.ok) { setMessage(documentActionMessage(response.reason, strings)); return; }
        setSucceeded(true); setMessage(cleared ? strings.reviewSaved : `${strings.reviewSaved} ${strings.cleanupFailed}`);
        try { onSaved(); } catch { /* Refresh does not undo a confirmed review. */ }
      });
      if (!result.acquired) setMessage(result.reason === "busy" ? strings.pending : strings.storageUnavailable);
    } catch { setMessage(strings.unavailable); }
    finally { sending.current = false; setBusy(false); }
  }
  return <details className={styles.details} open={retained ? true : undefined}>
    <summary className={styles.summary}>{strings.reviewTitle}</summary>
    <form className={styles.form} onSubmit={save} aria-busy={busy}>
      <label htmlFor={`${id}-decision`} className={styles.label}>{strings.reviewTitle}</label>
      <select id={`${id}-decision`} className={styles.input} value={shownDecision} disabled={locked || !canReview}
        onChange={event => setDecision(event.target.value as ApplicationDocumentReviewDecision)}>
        <option value="approved" disabled={submission.file.technicalAvailability !== "available"}>{strings.approve}</option>
        <option value="correction_required">{strings.correction}</option>
        <option value="rejected">{strings.reject}</option>
      </select>
      {shownDecision !== "approved" ? <div>
        <label htmlFor={`${id}-reason`} className={styles.label}>{strings.reasonLabel}</label>
        <textarea id={`${id}-reason`} className={`${styles.input} ${styles.textarea}`} value={shownReason}
          maxLength={2000} required disabled={locked || !canReview} onChange={event => setReason(event.target.value)} />
      </div> : null}
      {retained && !succeeded ? <p className={styles.note}>{strings.pending}</p> : null}
      {pending.blocked ? <p role="alert" className={styles.error}>{strings.storageUnavailable}</p> : null}
      <div className={styles.actions}><button type="submit" className={styles.button}
        disabled={!hydrated || busy || pending.blocked || (!retained && (!canReview || (decision === "approved" && submission.file.technicalAvailability !== "available")))}>
        {busy ? strings.sending : retained ? strings.retry : strings.saveReview}
      </button></div>
      {message ? <p className={succeeded ? styles.note : styles.error} role={succeeded ? "status" : "alert"}>{message}</p> : null}
    </form>
  </details>;
}
