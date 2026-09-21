"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ApplicationDocumentOwner, ApplicationDocumentQueuePage, ApplicationDocumentScope } from "@/lib/portal/application-documents";
import { readStaffApplicationDocumentSubmissionQueueAction } from "@/lib/portal/application-documents-actions";
import { APPLICATION_DOCUMENT_PENDING_EVENT, listApplicationDocumentPendingScopes } from "@/lib/portal/application-documents-pending";
import { getPortalStrings } from "@/lib/portal/i18n";
import { ProgramSubmissionEvidence } from "@/components/portal/admissionPreparations/ProgramDocumentEvidence";
import { ProgramDocumentReview } from "@/components/portal/admissionPreparations/ProgramDocumentReview";
import { ProgramDocumentRecovery } from "@/components/portal/admissionPreparations/ProgramDocumentRecovery";
import styles from "@/components/portal/admissionPreparations/ProgramDocuments.module.css";

function subscribePending(callback: () => void) {
  window.addEventListener(APPLICATION_DOCUMENT_PENDING_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(APPLICATION_DOCUMENT_PENDING_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function QueueRecovery({ owner, visibleSubmissions, onSaved }: {
  owner: ApplicationDocumentOwner; visibleSubmissions: readonly string[]; onSaved: () => void;
}) {
  const strings = getPortalStrings("programDocuments", "ru");
  const snapshot = useSyncExternalStore(subscribePending, () => {
    try { return JSON.stringify(listApplicationDocumentPendingScopes(owner, "review")); } catch { return "unavailable"; }
  }, () => "[]");
  const scopes = useMemo(() => snapshot === "unavailable" ? [] : JSON.parse(snapshot) as readonly ApplicationDocumentScope[], [snapshot]);
  if (snapshot === "unavailable") return <p className={styles.error} role="alert">{strings.storageUnavailable}</p>;
  return scopes.map(scope => <ProgramDocumentRecovery key={`${scope.studentCaseId}:${scope.applicationId}`} scope={scope} audience="staff"
    currentItemIds={[]} currentSubmissionIds={visibleSubmissions} onlyReviews strings={strings} onSaved={onSaved} />);
}

export function ProgramDocumentQueue({ owner, initial, canReview }: {
  owner: ApplicationDocumentOwner; initial: ApplicationDocumentQueuePage | null; canReview: boolean;
}) {
  const strings = getPortalStrings("programDocuments", "ru");
  const [page, setPage] = useState(initial);
  const [items, setItems] = useState(initial?.items ?? []);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(initial === null);
  const lock = useRef(false);
  async function load(more: boolean) {
    if (lock.current || (more && !page?.nextCursor)) return;
    lock.current = true; setBusy(true); setFailed(false);
    try {
      const response = await readStaffApplicationDocumentSubmissionQueueAction(owner, more ? page?.nextCursor ?? null : null);
      if (!response.ok) { setFailed(true); return; }
      setPage(response.page);
      setItems(previous => more ? [...previous, ...response.page.items.filter(item => !previous.some(old => old.submission.submissionId === item.submission.submissionId))] : response.page.items);
    } catch { setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className={`${styles.root} mt-6`} aria-label={strings.queueTitle} aria-busy={busy}>
    {failed ? <p className={styles.error} role="alert">{strings.queueUnavailable}</p> : null}
    {page && !items.length ? <p className={styles.note}>{strings.queueEmpty}</p> : null}
    <ol className={styles.list}>{items.map(item => {
      const scope = { ...owner, studentCaseId: item.studentCaseId, applicationId: item.applicationId };
      const target = { studentCaseId: item.studentCaseId, applicationId: item.applicationId,
        requirementsRevisionId: item.submission.requirementsRevisionId,
        requirementItemId: item.submission.requirementItemId, documentSlotId: item.submission.documentSlotId };
      return <li key={item.submission.submissionId}>
        <h2 className={styles.heading}>{item.studentDisplayName} · {item.requirementLabel}</h2>
        <p className={styles.note}>{item.universityTitle} · {item.programTitle}</p>
        {!item.isCurrentRequirement ? <p className={styles.meta}>{strings.olderRequirement}</p> : null}
        {item.deadline ? <p className={styles.meta}>Срок: <time dateTime={item.deadline.date}>{item.deadline.date.split("-").reverse().join(".")}</time>
          {item.deadline.time ? `, ${item.deadline.time}` : ""}{item.deadline.timezone ? ` (${item.deadline.timezone})` : ""}</p> : null}
        <ProgramSubmissionEvidence submission={item.submission} target={target} audience="staff" strings={strings} />
        <ProgramDocumentReview scope={scope} submission={item.submission} strings={strings} canReview={canReview} onSaved={() => void load(false)} />
        <Link className={styles.link} href={`/v3/profile?case=${item.studentCaseId}&tab=route#preparation-${item.applicationId}`}>{strings.openProgram}</Link>
      </li>;
    })}</ol>
    <QueueRecovery owner={owner} visibleSubmissions={items.map(item => item.submission.submissionId)} onSaved={() => void load(false)} />
    <div className={styles.actions}>
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => void load(false)}>{busy ? strings.loading : strings.refresh}</button>
      {page?.nextCursor ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void load(true)}>{strings.historyMore}</button> : null}
    </div>
  </section>;
}
