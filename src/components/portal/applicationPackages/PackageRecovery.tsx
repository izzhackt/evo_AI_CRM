"use client";
import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { listApplicationPackagePendingScopes, type ApplicationPackagePendingIntent, type ApplicationPackageScope } from "@/lib/portal/application-packages-pending";
import type { ApplicationDocumentOwner } from "@/lib/portal/application-documents";
import { readApplicationDocumentHistoryAction } from "@/lib/portal/application-documents-actions";
import { readApplicationPackageDetailAction } from "@/lib/portal/application-packages-actions";
import { packageCommandFailure, packageCommand, type PackageAudience } from "./commands";
import { packageScopeKey, subscribePackagePending, usePackagePending } from "./pending";
import type { PackageStrings } from "./strings";
import s from "../admissionPreparations/ProgramDocuments.module.css";
import p from "./Packages.module.css";

type FrozenFile = { label: string; filename: string; version: string; affected?: boolean; sourceReviewId?: string };
function RecoveryEntry({ scope, intent, audience, strings: t, onSaved }: { scope: ApplicationPackageScope; intent: ApplicationPackagePendingIntent; audience: PackageAudience; strings: PackageStrings; onSaved: (message?: string) => void }) {
  const [programTitle, setProgramTitle] = useState<string | null>(null);
  const [files, setFiles] = useState<FrozenFile[] | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false);
  async function preview() {
    if (loading) return; setLoading(true); setMessage(null);
    try {
      if ("packageId" in intent) {
        const result = await readApplicationPackageDetailAction(scope, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId }, intent.packageId);
        if (!result.ok || result.detail.items.length !== intent.documentReviews.length || result.detail.items.some((item, index) => item.requirementItemId !== intent.documentReviews[index].requirementItemId || item.submission.submissionId !== intent.documentReviews[index].submissionId)) throw Error();
        setProgramTitle(`${result.detail.program.programTitle} · ${result.detail.program.intakeLabel}`);
        setFiles(result.detail.items.map(item => ({ label: item.definition.label, filename: item.submission.file.originalFilename, version: item.submission.file.versionNo, affected: intent.affectedItemIds.includes(item.requirementItemId), sourceReviewId: intent.reuseApprovals.find(value => value.requirementItemId === item.requirementItemId)?.sourceReviewId })));
      } else {
        const rows = await Promise.all(intent.items.map(async item => {
          const result = await readApplicationDocumentHistoryAction(scope, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId, requirementItemId: item.requirementItemId });
          if (!result.ok) throw Error();
          const event = result.page.events.find(event => event.requirementsRevisionId === intent.requirementsRevisionId && (event.upload?.file ?? event.submission?.file)?.documentVersionId === item.selection.documentVersionId);
          const file = event?.upload?.file ?? event?.submission?.file;
          if (!event || !file) throw Error();
          return { label: event.definition.label, filename: file.originalFilename, version: file.versionNo };
        }));
        setFiles(rows);
      }
    } catch { setFiles(null); setMessage(t.unavailable); }
    finally { setLoading(false); }
  }
  async function run(checkOnly: boolean) {
    if (lock.current || (!checkOnly && !files)) return; lock.current = true; setBusy(true); setMessage(null);
    try {
      const result = await packageCommand(scope, audience, intent, checkOnly);
      if (result.kind === "committed" || result.kind === "not_written") {
        const confirmed = `${result.kind === "not_written" ? t.notWritten : "packageId" in intent ? t.reviewed : t.sent}${result.cleared ? "" : ` ${t.cleanup}`}`;
        setMessage(confirmed); onSaved(confirmed);
      } else setMessage(packageCommandFailure(result, t));
    } catch { setMessage(t.pending); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className={p.row} aria-busy={busy || loading}>
    <p className={s.heading}>{"packageId" in intent ? t.frozenReview : t.frozen}</p>
    {"packageId" in intent ? <><p>{intent.decision === "approved" ? t.approved : t.correction}</p>{intent.reason ? <p className={s.reason}>{intent.reason}</p> : null}</> : null}
    {programTitle ? <p className={s.heading}>{programTitle}</p> : null}
    {"packageId" in intent && intent.decision === "correction_required" && !intent.affectedItemIds.length ? <p className={s.note}>{t.general}</p> : null}
    <p className={s.note}>{t.pending}</p>
    {files ? <ul className={s.list}>{files.map((file, index) => <li key={index}><p>{file.label}</p><p className={s.filename}>{file.filename}</p><p className={s.meta}>{t.fileVersion} {file.version}</p>{file.affected ? <p className={s.note}>{t.correction}</p> : null}{file.sourceReviewId ? <details><summary className={s.summary}>{t.useReview}</summary><p className={s.meta}>{t.reuseSource}</p><p className={s.filename}><code>{file.sourceReviewId}</code></p></details> : null}</li>)}</ul> : <><p className={s.note}>{t.frozenUnavailable}</p><button type="button" className={s.secondary} disabled={busy} aria-disabled={loading || busy} onClick={() => void preview()}>{loading ? t.loading : t.previewTitle}</button></>}
    <div className={s.actions}><button type="button" className={s.secondary} disabled={loading} aria-disabled={busy || loading} onClick={() => void run(true)}>{t.checkResult}</button>
      <button type="button" className={s.button} disabled={loading || !files} aria-disabled={busy || loading || !files} onClick={() => void run(false)}>{busy ? t.submitting : t.retry}</button>
      <Link className={s.link} href={audience === "student" ? `/portal/preparations/${scope.applicationId}#package-history-${scope.applicationId}` : `/v3/profile?case=${scope.studentCaseId}&tab=route#preparation-${scope.applicationId}`}>{t.allHistory}</Link></div>
    {message ? <p role="status" className={s.note}>{message}</p> : null}
  </div>;
}
type RecoveryProps = { scope: ApplicationPackageScope; audience: PackageAudience; strings: PackageStrings; onSaved: (message?: string) => void };
export function PackageRecovery(props: RecoveryProps) { return <RecoveryState key={packageScopeKey(props.scope)} {...props} />; }
function RecoveryState({ scope, audience, strings, onSaved }: RecoveryProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const saved = (message?: string) => { if (message) setNotice(message); onSaved(message); };
  const pending = usePackagePending(scope);
  return <><div role="status" aria-live="polite">{notice ? <p className={s.note}>{notice}</p> : null}</div>
  {pending.hydrated && (pending.blocked || pending.entries.length > 0) ? <section className={`${s.root} ${audience === "student" ? s.portal : ""} ${p.section}`} aria-label={strings.pendingTitle}><h3 className={s.heading}>{strings.pendingTitle}</h3>
    {pending.blocked ? <p className={s.error} role="alert">{strings.storage}</p> : null}
    {pending.entries.map(entry => entry.blocked || !entry.intent ? <p key={`${entry.operation}:${entry.target}`} className={s.error} role="alert">{strings.storage}</p>
      : <RecoveryEntry key={`${packageScopeKey(scope)}:${entry.intent.requestId}`} scope={scope} intent={entry.intent} audience={audience} strings={strings} onSaved={saved} />)}
  </section> : null}</>;
}
type OwnerRecoveryProps = { owner: ApplicationDocumentOwner; audience: PackageAudience; strings: PackageStrings; onSaved?: (message?: string) => void; showEmpty?: boolean };
export function PackageOwnerRecovery(props: OwnerRecoveryProps) {
  return <OwnerRecoveryState key={`${props.owner.organizationId}:${props.owner.membershipId}`} {...props} />;
}
function OwnerRecoveryState({ owner, audience, strings, onSaved, showEmpty = false }: OwnerRecoveryProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const snapshot = useSyncExternalStore(subscribePackagePending, () => { try { return JSON.stringify(listApplicationPackagePendingScopes(owner)); } catch { return "blocked"; } }, () => "hydrating");
  const scopes = useMemo(() => snapshot === "blocked" || snapshot === "hydrating" ? [] : JSON.parse(snapshot) as readonly ApplicationPackageScope[], [snapshot]);
  const saved = (message?: string) => { if (message) setNotice(message); onSaved?.(message); };
  return <><div role="status" aria-live="polite">{notice ? <p className={s.note}>{notice}</p> : null}</div>
    {snapshot === "blocked" ? <p className={s.error} role="alert">{strings.storage}</p> : snapshot === "hydrating" ? showEmpty ? <p role="status">{strings.loading}</p> : null : <>
      {showEmpty && !scopes.length ? <p className={s.note}>{strings.noPending}</p> : null}
      {scopes.map(scope => <PackageRecovery key={packageScopeKey(scope)} scope={scope} audience={audience} strings={strings} onSaved={saved} />)}
    </>}
  </>;
}
export function PackageQueueRecovery(props: Omit<OwnerRecoveryProps, "audience">) { return <PackageOwnerRecovery {...props} audience="staff" />; }
