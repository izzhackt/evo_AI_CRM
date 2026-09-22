"use client";
import { useId, useRef, useState } from "react";
import type { ApplicationDocumentCursor } from "@/lib/portal/application-documents";
import { readApplicationDocumentHistoryAction } from "@/lib/portal/application-documents-actions";
import type { ApplicationPackageDetail, ApplicationPackageReuseApproval, ApplicationPackageDecision } from "@/lib/portal/application-packages";
import type { ApplicationPackageScope } from "@/lib/portal/application-packages-pending";
import { applicationPackageReviewBlockers, applicationPackageReuseCandidates, buildApplicationPackageReviewIntent } from "@/lib/portal/application-package-ui";
import { ProgramDocumentTime } from "../admissionPreparations/ProgramDocumentEvidence";
import { usePackagePending } from "./pending";
import { packageCommandFailure, packageCommand } from "./commands";
import type { PackageStrings } from "./strings";
import s from "../admissionPreparations/ProgramDocuments.module.css";
import p from "./Packages.module.css";

export function PackageReview({ scope, detail, strings: t, onSaved }: { scope: ApplicationPackageScope; detail: ApplicationPackageDetail; strings: PackageStrings; onSaved: (message?: string) => void }) {
  const id = useId(), pending = usePackagePending(scope);
  const [decision, setDecision] = useState<ApplicationPackageDecision>("approved"), [reason, setReason] = useState("");
  const [affected, setAffected] = useState<string[]>([]), [reuse, setReuse] = useState<ApplicationPackageReuseApproval[]>([]);
  const [candidates, setCandidates] = useState<ReturnType<typeof applicationPackageReuseCandidates>>([]);
  const [cursor, setCursor] = useState<ApplicationDocumentCursor | null>(null), [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const lock = useRef(false);
  const blocked = !pending.hydrated || pending.blocked || pending.entries.length > 0 || busy;
  const blockers = applicationPackageReviewBlockers(detail, reuse);
  async function findReuse() {
    if (loading) return; setLoading(true); setMessage(null);
    try {
      const result = await readApplicationDocumentHistoryAction(scope, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId }, loaded ? cursor : null);
      if (!result.ok) { setMessage(t.unavailable); return; }
      const found = applicationPackageReuseCandidates(detail, result.page);
      setCandidates(previous => [...previous, ...found.filter(candidate => !previous.some(old => old.approval.requirementItemId === candidate.approval.requirementItemId && old.approval.sourceReviewId === candidate.approval.sourceReviewId))]);
      setCursor(result.page.nextCursor); setLoaded(true);
    } catch { setMessage(t.unavailable); } finally { setLoading(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (lock.current || blocked) return;
    const intent = buildApplicationPackageReviewIntent(scope, detail, { decision, reason: decision === "approved" ? null : reason.trim(), affectedItemIds: decision === "approved" ? [] : affected, reuseApprovals: decision === "approved" ? reuse : [], requestId: crypto.randomUUID() });
    if (!intent) { setMessage(decision === "correction_required" && !reason.trim() ? t.reasonRequired : t.changed); return; }
    lock.current = true; setBusy(true); setMessage(null); setSucceeded(false);
    try {
      const result = await packageCommand(scope, "staff", intent);
      if (result.kind === "committed") { setSucceeded(true); setMessage(result.cleared ? t.reviewed : `${t.reviewed} ${t.cleanup}`); onSaved(result.cleared ? t.reviewed : `${t.reviewed} ${t.cleanup}`); }
      else setMessage(packageCommandFailure(result, t));
    } catch { setMessage(t.pending); } finally { lock.current = false; setBusy(false); }
  }
  return <form className={s.form} onSubmit={save} aria-busy={busy}>
    <h3 className={s.heading}>{t.review}</h3>
    <label className={s.label} htmlFor={`${id}-decision`}>{t.review}</label>
    <select id={`${id}-decision`} className={s.input} disabled={blocked} value={decision} onChange={event => setDecision(event.target.value as ApplicationPackageDecision)}>
      <option value="approved">{t.approved}</option><option value="correction_required">{t.correction}</option>
    </select>
    {decision === "correction_required" ? <>
      <label className={s.label} htmlFor={`${id}-reason`}>{t.reason}</label><textarea id={`${id}-reason`} className={`${s.input} ${s.textarea}`} required maxLength={5000} disabled={blocked} value={reason} onChange={event => setReason(event.target.value)} />
      <fieldset className={p.fieldset} disabled={blocked}><legend className={p.legend}>{t.affected}</legend>
        {detail.items.map(item => <label className={p.check} key={item.requirementItemId}><input type="checkbox" checked={affected.includes(item.requirementItemId)} onChange={event => setAffected(old => event.target.checked ? [...old, item.requirementItemId] : old.filter(value => value !== item.requirementItemId))} />{item.definition.label}</label>)}
      </fieldset><p className={s.note}>{t.general}</p>
    </> : <>
      {blockers.length ? <div><p className={s.note}>{t.filesFirst}</p><ul>{blockers.map(blocker => <li key={`${blocker.requirementItemId}:${blocker.reason}`}><a className={s.link} href={`#package-item-${detail.package.packageId}-${blocker.requirementItemId}`}>{detail.items.find(item => item.requirementItemId === blocker.requirementItemId)?.definition.label ?? t.document}</a>{` — ${blocker.reason === "file_unavailable" ? t.fileUnavailable : blocker.reason === "document_correction_required" ? t.correction : blocker.reason === "document_rejected" ? t.rejected : blocker.reason === "reuse_unavailable" ? t.reuseUnavailable : t.unreviewed}`}</li>)}</ul></div> : null}
      <details className={p.details}><summary className={s.summary}>{t.useReview}</summary><p className={s.note}>{t.reuseHint}</p>
        {!loaded || cursor ? <button type="button" className={s.secondary} disabled={blocked || loading} onClick={() => void findReuse()}>{loading ? t.loading : loaded ? t.more : t.findReview}</button> : null}
        {loaded && !candidates.length ? <p className={s.note}>{t.noReuse}</p> : null}
        {candidates.map(candidate => <label className={p.check} key={`${candidate.approval.requirementItemId}:${candidate.approval.sourceReviewId}`}>
          <input type="checkbox" disabled={blocked} checked={reuse.some(value => value.requirementItemId === candidate.approval.requirementItemId && value.sourceReviewId === candidate.approval.sourceReviewId)}
            onChange={event => setReuse(old => [...old.filter(value => value.requirementItemId !== candidate.approval.requirementItemId), ...(event.target.checked ? [candidate.approval] : [])])} />
          <span>{candidate.source.definition.label} · {candidate.source.submission?.file.originalFilename} · {t.fileVersion} {candidate.source.submission?.file.versionNo}<br />{t.reuseSource}: {candidate.source.submission?.review ? <ProgramDocumentTime value={candidate.source.submission.review.reviewedAt} /> : null}</span>
        </label>)}
      </details>
    </>}
    <button className={s.button} type="submit" disabled={(!busy && blocked) || (decision === "approved" && blockers.length > 0)} aria-disabled={busy || blocked}>{busy ? t.submitting : t.saveReview}</button>
    {message ? <p className={succeeded ? s.note : s.error} role={succeeded ? "status" : "alert"}>{message}</p> : null}
  </form>;
}
