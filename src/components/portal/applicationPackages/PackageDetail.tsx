"use client";
import { useEffect, useRef, useState } from "react";
import type { ApplicationPackageDetail as Detail, ApplicationPackageReview, ApplicationPackageSummary } from "@/lib/portal/application-packages";
import type { ApplicationPackageScope } from "@/lib/portal/application-packages-pending";
import { readApplicationPackageDetailAction, readApplicationPackageReviewHistoryAction } from "@/lib/portal/application-packages-actions";
import type { ApplicationDocumentCursor } from "@/lib/portal/application-documents";
import { ProgramDocumentTime, ProgramFileEvidence, type ProgramDocumentStrings } from "../admissionPreparations/ProgramDocumentEvidence";
import { ProgramDocumentReview } from "../admissionPreparations/ProgramDocumentReview";
import { packageReviewPresentation } from "./presentation";
import { packageScopeKey } from "./pending";
import { PackageReview } from "./PackageReview";
import type { PackageAudience } from "./commands";
import type { PackageStrings } from "./strings";
import s from "../admissionPreparations/ProgramDocuments.module.css";
import p from "./Packages.module.css";
export function packageStatus(value: ApplicationPackageSummary, t: PackageStrings) { return value.latestReview ? value.latestReview.decision === "approved" ? t.approved : t.correction : t.awaiting; }
export function PackageDecision({ review, strings: t }: { review: ApplicationPackageReview; strings: PackageStrings }) {
  return <div><p className={s.heading}>{review.decision === "approved" ? t.approved : t.correction}</p><p className={s.meta}>{t.reviewedAt}: <ProgramDocumentTime value={review.reviewedAt} /></p>{review.reason ? <p className={s.reason}>{review.reason}</p> : null}</div>;
}
function AffectedMaterials({ review, detail, strings: t }: { review: ApplicationPackageReview; detail: Detail; strings: PackageStrings }) {
  if (review.decision !== "correction_required") return null;
  return review.affectedItemIds.length ? <div><p className={s.heading}>{t.affected}</p><ul>{review.affectedItemIds.map(id => <li key={id}><a className={s.link} href={`#package-item-${detail.package.packageId}-${id}`}>{detail.items.find(item => item.requirementItemId === id)?.definition.label ?? t.document}</a></li>)}</ul></div> : <p className={s.note}>{t.general}</p>;
}
function ReviewEvidence({ evidence, strings: t, documentStrings }: { evidence: ApplicationPackageReview["documentReviews"][number]; strings: PackageStrings; documentStrings: ProgramDocumentStrings }) {
  return <div><p className={s.meta}>{t.reviewEvidence}</p><p>{evidence.review ? documentStrings[`review.${evidence.review.decision}`] : t.noReviews}</p>
    {evidence.review ? <p className={s.meta}><ProgramDocumentTime value={evidence.review.reviewedAt} /></p> : null}
    {evidence.review?.reason ? <p className={s.reason}>{evidence.review.reason}</p> : null}
    {evidence.reusedFromReview ? <p className={s.meta}>{t.reuseSource}: {documentStrings[`review.${evidence.reusedFromReview.decision}`]} · <ProgramDocumentTime value={evidence.reusedFromReview.reviewedAt} /></p> : null}
  </div>;
}
function ReviewHistory({ scope, detail, strings: t, documentStrings }: { scope: ApplicationPackageScope; detail: Detail; strings: PackageStrings; documentStrings: ProgramDocumentStrings }) {
  const packageId = detail.package.packageId;
  const [rows, setRows] = useState<ApplicationPackageReview[]>([]), [cursor, setCursor] = useState<ApplicationDocumentCursor | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const lock = useRef(false);
  async function load(reset: boolean) {
    if (lock.current) return; lock.current = true; setBusy(true); setFailed(false);
    try { const response = await readApplicationPackageReviewHistoryAction(scope, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId }, packageId, reset ? null : cursor);
      if (!response.ok) { setFailed(true); return; } setRows(old => reset ? [...response.history.reviews] : [...old, ...response.history.reviews.filter(row => !old.some(value => value.packageReviewId === row.packageReviewId))]); setCursor(response.history.nextCursor); setLoaded(true);
    } catch { setFailed(true); } finally { lock.current = false; setBusy(false); }
  }
  return <details className={p.details}><summary className={s.summary} onClick={() => { if (!loaded) void load(true); }}>{t.reviewHistory}</summary>
    {rows.map(row => <div key={row.packageReviewId} className={p.row}><PackageDecision review={row} strings={t} /><AffectedMaterials review={row} detail={detail} strings={t} /><ul className={s.list}>{row.documentReviews.map(evidence => <li key={evidence.requirementItemId}><p className={s.heading}>{detail.items.find(item => item.requirementItemId === evidence.requirementItemId)?.definition.label ?? t.document}</p><ReviewEvidence evidence={evidence} strings={t} documentStrings={documentStrings} /></li>)}</ul></div>)}
    {loaded && !rows.length ? <p className={s.note}>{t.noReviews}</p> : null}{busy ? <p role="status">{t.loading}</p> : null}{failed ? <p className={s.error} role="alert">{t.unavailable}</p> : null}
    <button type="button" className={s.secondary} disabled={busy} onClick={() => void load(true)}>{t.refresh}</button>{cursor ? <button type="button" className={s.secondary} disabled={busy} onClick={() => void load(false)}>{t.more}</button> : null}
  </details>;
}
export function PackageDetail({ detail, scope, audience, strings: t, documentStrings, frozenReview, canReview = false, onSaved, epoch = 0, showDecision = true }: {
  detail: Detail; scope: ApplicationPackageScope; audience: PackageAudience; strings: PackageStrings; documentStrings: ProgramDocumentStrings;
  frozenReview?: ApplicationPackageReview; canReview?: boolean; onSaved: (message?: string) => void; epoch?: number; showDecision?: boolean;
}) {
  const { review, newerReview, items, warnings } = packageReviewPresentation(detail, frozenReview);
  return <section className={p.preview} aria-label={`${t.version} ${detail.package.packageVersion}`}>
    <h3 className={s.heading}>{t.version} {detail.package.packageVersion}</h3>
    <p>{detail.program.programTitle} · {detail.program.intakeLabel}</p>
    {detail.package.origin === "evo_starter" ? <><p className={s.note}>{t.starter}</p><p className={s.note}>{t.starterHelp}</p></> : null}
    {!detail.package.isCurrentRequirements ? <p className={s.note}>{t.older}</p> : null}
    <p className={s.meta}>{t.submittedAt}: <ProgramDocumentTime value={detail.package.submittedAt} /></p>
    {frozenReview ? <p className={s.note}>{t.historical}</p> : null}
    {showDecision && review ? <PackageDecision review={review} strings={t} /> : showDecision ? <p className={s.note}>{t.awaiting}</p> : null}
    {review ? <AffectedMaterials review={review} detail={detail} strings={t} /> : null}
    {newerReview ? <section aria-label={t.newerDecision}><h4 className={s.heading}>{t.newerDecision}</h4><PackageDecision review={newerReview} strings={t} /><AffectedMaterials review={newerReview} detail={detail} strings={t} /></section> : null}
    {warnings.length ? <div><h4 className={s.heading}>{t.currentWarnings}</h4><ul>{warnings.map(warning => <li key={`${warning.requirementItemId}:${warning.reason}`}>{detail.items.find(item => item.requirementItemId === warning.requirementItemId)?.definition.label}: {warning.reason === "review_changed" ? t.reviewChanged : t.fileUnavailable}</li>)}</ul></div> : null}
    <ol className={p.rows}>{items.map(({ item, evidence, currentReview }) => {
      const target = { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId, requirementsRevisionId: item.submission.requirementsRevisionId, requirementItemId: item.requirementItemId, documentSlotId: item.definition.documentSlotId };
      return <li key={item.packageItemId} className={p.row} id={`package-item-${detail.package.packageId}-${item.requirementItemId}`}>
        <h4 className={s.heading}>{item.definition.label}</h4><p className={s.meta}>{item.definition.groupLabel} · {item.definition.required ? t.required : t.optionalLabel}</p>
        <p className={s.reason}>{item.definition.instructions}</p>
        {item.definition.deadline ? <p className={s.note}>{t.deadline}: <time dateTime={item.definition.deadline.date}>{item.definition.deadline.date}</time>{item.definition.deadline.time ? ` ${item.definition.deadline.time}` : ""}{item.definition.deadline.timezone ? ` (${item.definition.deadline.timezone})` : ""}{item.definition.deadline.sourceUrl ? <> · <a className={s.link} href={item.definition.deadline.sourceUrl} target="_blank" rel="noopener noreferrer">{t.deadlineSource}</a></> : null}</p> : null}
        <ProgramFileEvidence file={item.submission.file} target={target} audience={audience} strings={documentStrings} />
        {evidence ? <ReviewEvidence evidence={evidence} strings={t} documentStrings={documentStrings} /> : null}
        <div><p className={s.meta}>{t.currentFileReview}</p><p className={s.note}>{currentReview ? documentStrings[`review.${currentReview.decision}`] : documentStrings.waitingReview}</p>{currentReview ? <p className={s.meta}><ProgramDocumentTime value={currentReview.reviewedAt} /></p> : null}{currentReview?.reason ? <p className={s.reason}>{currentReview.reason}</p> : null}</div>
        {audience === "staff" && canReview ? <ProgramDocumentReview scope={scope} submission={item.submission} strings={documentStrings} canReview onSaved={onSaved} /> : null}
      </li>;
    })}</ol>
    {audience === "staff" && canReview ? <PackageReview key={`review:${packageScopeKey(scope)}:${detail.package.packageId}:${epoch}`} scope={scope} detail={detail} strings={t} onSaved={onSaved} /> : null}
    <ReviewHistory key={`history:${packageScopeKey(scope)}:${detail.package.packageId}:${epoch}`} scope={scope} detail={detail} strings={t} documentStrings={documentStrings} />
  </section>;
}
type LoaderProps = {
  scope: ApplicationPackageScope; packageId: string; audience: PackageAudience; strings: PackageStrings; documentStrings: ProgramDocumentStrings;
  canReview?: boolean; frozenReview?: ApplicationPackageReview; onSaved?: (message?: string) => void; epoch?: number; showDecision?: boolean;
};
export function PackageDetailLoader(props: LoaderProps) {
  return <DetailLoaderState key={`${packageScopeKey(props.scope)}:${props.packageId}:${props.epoch ?? 0}`} {...props} />;
}
function DetailLoaderState(props: LoaderProps) {
  const [refresh, setRefresh] = useState(0), [notice, setNotice] = useState<string | null>(null);
  function saved(message?: string) { if (message) setNotice(message); setRefresh(value => value + 1); props.onSaved?.(message); }
  return <div>{notice ? <p role="status" className={s.note}>{notice}</p> : null}
    <DetailFetch key={refresh} {...props} onSaved={saved} />
    <button type="button" className={s.secondary} onClick={() => setRefresh(value => value + 1)}>{props.strings.refresh}</button>
  </div>;
}
function DetailFetch({ scope, packageId, audience, strings, documentStrings, canReview = false, frozenReview, onSaved, epoch = 0, showDecision = true }: LoaderProps & { onSaved: (message?: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
  const { organizationId, membershipId, studentCaseId, applicationId } = scope;
  useEffect(() => {
    let active = true;
    void readApplicationPackageDetailAction({ organizationId, membershipId, studentCaseId, applicationId }, { studentCaseId, applicationId }, packageId)
      .then(result => { if (!active) return; if (result.ok) setDetail(result.detail); else setFailed(true); })
      .catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, membershipId, studentCaseId, applicationId, packageId]);
  return <div aria-busy={loading}>{loading ? <p role="status">{strings.loading}</p> : null}{failed ? <p role="alert" className={s.error}>{strings.unavailable}</p> : null}
    {detail ? <PackageDetail detail={detail} scope={scope} audience={audience} strings={strings} documentStrings={documentStrings} canReview={canReview} frozenReview={frozenReview} showDecision={showDecision} epoch={epoch} onSaved={onSaved} /> : null}
  </div>;
}
