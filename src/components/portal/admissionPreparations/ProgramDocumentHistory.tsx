"use client";

import { useRef, useState } from "react";
import type { ApplicationDocumentTarget } from "@/lib/portal/application-documents";
import { readApplicationDocumentHistoryAction } from "@/lib/portal/application-documents-actions";
import type { ProgramDocumentScope } from "./ProgramDocumentControls";
import { ProgramFileEvidence, ProgramSubmissionEvidence, type ProgramDocumentStrings } from "./ProgramDocumentEvidence";
import { ProgramDocumentReview } from "./ProgramDocumentReview";
import styles from "./ProgramDocuments.module.css";

type HistoryPage = Extract<Awaited<ReturnType<typeof readApplicationDocumentHistoryAction>>, { ok: true }>["page"];
export type ProgramHistoryEntry = HistoryPage["events"][number];

export function ProgramHistoryEvidence({ entry, target, scope, audience, strings, canReview = false, onSaved }: {
  entry: ProgramHistoryEntry; target: ApplicationDocumentTarget; scope: ProgramDocumentScope;
  audience: "student" | "staff"; strings: ProgramDocumentStrings; canReview?: boolean; onSaved: () => void;
}) {
  const origin = { ...target, requirementsRevisionId: entry.requirementsRevisionId,
    requirementItemId: entry.requirementItemId, documentSlotId: entry.definition.documentSlotId };
  return <div>
    <p className={styles.heading}>{entry.definition.label}</p>
    <p className={styles.meta}>{entry.definition.groupLabel} · {entry.definition.required ? strings.required : strings.optional}</p>
    {entry.definition.instructions ? <p className={styles.note}>{entry.definition.instructions}</p> : null}
    {entry.definition.deadline ? <div className={styles.section}>
      <p className={styles.meta}>{strings.deadline}: <time dateTime={entry.definition.deadline.date}>{entry.definition.deadline.date.split("-").reverse().join(".")}</time>
        {entry.definition.deadline.time ? `, ${entry.definition.deadline.time}` : ""}{entry.definition.deadline.timezone ? ` (${entry.definition.deadline.timezone})` : ""}</p>
      <p className={styles.meta}>{strings.deadlineVerified} <time dateTime={entry.definition.deadline.verifiedOn}>{entry.definition.deadline.verifiedOn.split("-").reverse().join(".")}</time></p>
      {entry.definition.deadline.sourceUrl ? <a className={styles.link} href={entry.definition.deadline.sourceUrl} target="_blank" rel="noopener noreferrer">{strings.deadlineSource}</a> : null}
    </div> : null}
    {entry.upload ? <div className={styles.section}>
      <p className={styles.meta}>{strings.savedFile}</p>
      <ProgramFileEvidence file={entry.upload.file} target={origin} audience={audience} strings={strings} />
    </div> : null}
    {entry.submission ? <>
      <ProgramSubmissionEvidence submission={entry.submission} target={origin} audience={audience} strings={strings} />
      {audience === "staff" ? <ProgramDocumentReview scope={scope} submission={entry.submission} strings={strings} canReview={canReview} onSaved={onSaved} /> : null}
    </> : null}
  </div>;
}

export function ProgramDocumentHistory({ scope, target, requirementItemId, audience, strings, canReview = false, onSaved }: {
  scope: ProgramDocumentScope; target: ApplicationDocumentTarget; requirementItemId: string | null;
  audience: "student" | "staff"; strings: ProgramDocumentStrings; canReview?: boolean; onSaved: () => void;
}) {
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [events, setEvents] = useState<readonly ProgramHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  async function load(more: boolean) {
    if (lock.current || (more && !page?.nextCursor)) return;
    lock.current = true; setBusy(true); setFailed(false);
    try {
      const result = await readApplicationDocumentHistoryAction(scope, { ...target, requirementItemId }, more ? page?.nextCursor ?? null : null);
      if (!result.ok) { setFailed(true); return; }
      setPage(result.page);
      setEvents(current => more ? [...current, ...result.page.events.filter(item => !current.some(old => old.id === item.id))] : result.page.events);
    } catch { setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  }
  return <details className={styles.details} onToggle={event => {
    if (event.currentTarget.open && !page && !lock.current) void load(false);
  }}>
    <summary className={styles.summary}>{requirementItemId ? strings.history : strings.programHistory}</summary>
    <div aria-busy={busy}>
      {busy ? <p className={styles.meta} role="status">{strings.loading}</p> : null}
      {failed ? <p className={styles.error} role="alert">{strings.historyUnavailable}</p> : null}
      {page && !events.length ? <p className={styles.note}>{strings.historyEmpty}</p> : null}
      <ol className={styles.list}>{events.map(entry => <li key={entry.id}>
        <ProgramHistoryEvidence entry={entry} scope={scope} target={target} audience={audience} strings={strings} canReview={canReview}
          onSaved={() => { onSaved(); void load(false); }} />
      </li>)}</ol>
      <div className={styles.actions}>
        {page?.nextCursor ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void load(true)}>{strings.historyMore}</button> : null}
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => void load(false)}>{strings.refresh}</button>
      </div>
    </div>
  </details>;
}
