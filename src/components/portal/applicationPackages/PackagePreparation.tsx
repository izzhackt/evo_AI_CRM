"use client";
import { useEffect, useRef, useState } from "react";
import type { ApplicationPackageReadiness, ApplicationPackageSelection } from "@/lib/portal/application-packages";
import type { ApplicationPackageScope } from "@/lib/portal/application-packages-pending";
import { buildApplicationPackageSubmitIntent } from "@/lib/portal/application-package-ui";
import { readStudentApplicationPackageReadinessAction, readStaffApplicationPackageReadinessAction } from "@/lib/portal/application-packages-actions";
import { ProgramDocumentTime, ProgramFileEvidence, type ProgramDocumentStrings } from "../admissionPreparations/ProgramDocumentEvidence";
import { PackageRecovery } from "./PackageRecovery";
import { PackageHistory } from "./PackageHistory";
import { PackageSelectionRow } from "./PackageSelection";
import { PackageDetailLoader, packageStatus } from "./PackageDetail";
import { packageScopeKey, usePackagePending } from "./pending";
import { packageCommandFailure, packageCommand, type PackageAudience } from "./commands";
import type { PackageStrings } from "./strings";
import s from "../admissionPreparations/ProgramDocuments.module.css";
import p from "./Packages.module.css";
type PreparationProps = {
  scope: ApplicationPackageScope; readiness: ApplicationPackageReadiness | null; audience: PackageAudience; strings: PackageStrings; documentStrings: ProgramDocumentStrings;
  onSaved: () => void; epoch?: number; canReview?: boolean; recovery?: boolean; loading?: boolean;
};
export function PackagePreparation(props: PreparationProps) { return <PreparationState key={packageScopeKey(props.scope)} {...props} />; }
function PreparationState({ scope, readiness, audience, strings: t, documentStrings, onSaved, epoch = 0, canReview = false, recovery = true, loading = false }: PreparationProps) {
  const [choices, setChoices] = useState<Record<string, ApplicationPackageSelection>>({}), [optional, setOptional] = useState<string[]>([]);
  const [selectionRevision, setSelectionRevision] = useState<string | null>(null), [selectionLabels, setSelectionLabels] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ value: ApplicationPackageReadiness; epoch: number } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [success, setSuccess] = useState(false);
  const [opened, setOpened] = useState<string | null>(null), [savedId, setSavedId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const lock = useRef(false), pending = usePackagePending(scope);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const revisionChanged = !!selectionRevision && !!readiness && selectionRevision !== readiness.requirements.revisionId && (Object.keys(choices).length > 0 || optional.length > 0);
  const missingOptional = readiness?.requirements.items.filter(item => !item.required && optional.includes(item.requirementItemId) && !choices[item.requirementItemId]) ?? [];
  const blocked = !pending.hydrated || pending.blocked || !!pending.entries.length || busy || loading;
  const shown = !revisionChanged && preview?.epoch === epoch ? preview.value : null;
  useEffect(() => { if (shown) previewHeading.current?.focus(); }, [shown]);
  const choicesForCurrent = readiness?.requirements.items.flatMap(item => (item.required || optional.includes(item.requirementItemId)) && choices[item.requirementItemId] ? [choices[item.requirementItemId]] : []) ?? [];
  const edit = () => { setPreview(null); setSuccess(false); setMessage(null); };
  async function prepare() {
    if (lock.current || blocked || !readiness || revisionChanged || missingOptional.length) return; lock.current = true; setBusy(true); setPreview(null); setMessage(null); setSuccess(false);
    const startEpoch = epoch;
    try { const result = await (audience === "student" ? readStudentApplicationPackageReadinessAction : readStaffApplicationPackageReadinessAction)(scope, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId }, choicesForCurrent);
      if (!result.ok) { setMessage(result.reason === "forbidden" ? t.forbidden : t.unavailable); return; }
      setPreview({ value: result.readiness, epoch: startEpoch });
    } catch { setMessage(t.unavailable); } finally { lock.current = false; setBusy(false); }
  }
  async function submit() {
    if (lock.current || blocked || !shown) return;
    const intent = buildApplicationPackageSubmitIntent(shown, crypto.randomUUID());
    if (!intent) { setMessage(t.changed); return; }
    lock.current = true; setBusy(true); setMessage(null); setSuccess(false);
    try { const result = await packageCommand(scope, audience, intent);
      if (result.kind === "committed") {
        setSuccess(true); setMessage(result.cleared ? t.sent : `${t.sent} ${t.cleanup}`);
        if (result.proof.status === "committed" && "packageVersion" in result.proof.receipt) { setSavedId(result.proof.receipt.packageId); setSentAt(result.proof.receipt.submittedAt); }
        setPreview(null); onSaved();
      } else setMessage(packageCommandFailure(result, t));
    } catch { setMessage(t.pending); } finally { lock.current = false; setBusy(false); }
  }
  function saved(message?: string) { if (message) { setMessage(message); setSuccess(true); } onSaved(); }
  function readyReason(reason: string) { return reason === "empty_composition" ? t.empty : reason === "missing_required" ? t.missing : reason === "file_unavailable" ? t.fileUnavailable : reason === "material_unavailable" ? t.materialUnavailable : reason === "previous_submission_changed" ? t.changed : t.unavailable; }
  return <section className={`${s.root} ${audience === "student" ? s.portal : ""} ${p.section}`} aria-label={t.title}>
    {recovery ? <PackageRecovery scope={scope} audience={audience} strings={t} onSaved={saved} /> : null}
    <h2 className={s.heading}>{t.title}</h2>
    {revisionChanged ? <div role="alert"><p className={s.note}>{t.revisionChanged}</p><ul>{Object.entries(selectionLabels).map(([id, label]) => <li key={id}>{label}</li>)}</ul><button type="button" className={s.secondary} disabled={blocked} onClick={() => { setChoices({}); setOptional([]); setSelectionLabels({}); setSelectionRevision(readiness?.requirements.revisionId ?? null); edit(); }}>{t.resetSelection}</button></div> : null}
    {readiness?.latestPackage ? <p className={s.note}>{packageStatus(readiness.latestPackage, t)} · {t.version} {readiness.latestPackage.packageVersion}</p> : null}
    {readiness?.requirements.origin === "evo_starter" ? <><p className={s.note}>{t.starter}</p><p className={s.note}>{t.starterHelp}</p></> : null}
    {loading ? <p role="status">{t.loading}</p> : !readiness ? <p className={s.error} role="alert">{t.unavailable}</p> : <details className={p.details} open={choosing || !!shown} onToggle={event => setChoosing(event.currentTarget.open)}>
      <summary className={s.summary}>{t.choose}</summary>
      {!shown ? <><ol className={p.rows}>{readiness.requirements.items.map(item => {
        const state = readiness.documentItems.find(value => value.requirementItemId === item.requirementItemId);
        return state ? <PackageSelectionRow key={`${item.requirementItemId}:${epoch}`} scope={scope} item={item} state={state} selected={choices[item.requirementItemId]} included={item.required || optional.includes(item.requirementItemId)} disabled={blocked || revisionChanged} strings={t}
          onInclude={included => { edit(); setSelectionRevision(readiness.requirements.revisionId); setSelectionLabels(old => ({ ...old, [item.requirementItemId]: item.label })); setOptional(old => included ? [...old, item.requirementItemId] : old.filter(value => value !== item.requirementItemId)); }}
          onChange={selection => { edit(); setSelectionRevision(readiness.requirements.revisionId); setSelectionLabels(old => ({ ...old, [item.requirementItemId]: item.label })); setChoices(old => { const result = { ...old }; if (selection) result[item.requirementItemId] = selection; else delete result[item.requirementItemId]; return result; }); }} /> : null;
      })}</ol>{missingOptional.length ? <div role="status"><p className={s.note}>{t.optionalNeedsFile}</p><ul>{missingOptional.map(item => <li key={item.requirementItemId}>{item.label}</li>)}</ul></div> : null}<button type="button" className={s.button} disabled={(!busy && blocked) || revisionChanged || missingOptional.length > 0 || !readiness.requirements.revisionId} aria-disabled={busy || blocked} onClick={() => void prepare()}>{busy ? t.loading : t.preview}</button></> : <div className={p.preview}>
        <h3 ref={previewHeading} tabIndex={-1} className={s.heading}>{t.previewTitle}</h3>
        <ul className={p.rows}>{shown.selections.map(item => {
          const requirement = shown.requirements.items.find(value => value.requirementItemId === item.requirementItemId);
          return <li key={item.requirementItemId}><h4 className={s.heading}>{requirement?.label ?? t.document}</h4>
            {item.file && requirement && shown.requirements.revisionId ? <ProgramFileEvidence file={item.file} target={{ studentCaseId: scope.studentCaseId, applicationId: scope.applicationId, requirementsRevisionId: shown.requirements.revisionId, requirementItemId: item.requirementItemId, documentSlotId: requirement.documentSlotId }} audience={audience} strings={documentStrings} /> : null}
            {item.reasons.map(reason => <p className={s.error} key={reason}>{readyReason(reason)}</p>)}
          </li>;
        })}</ul>
        {shown.missingRequiredItemIds.length ? <><p className={s.note}>{t.missing}</p><ul>{shown.missingRequiredItemIds.map(id => <li key={id}>{shown.requirements.items.find(item => item.requirementItemId === id)?.label ?? t.document}</li>)}</ul></> : null}
        {shown.reasons.map(reason => <p key={reason} className={s.note}>{readyReason(reason)}</p>)}
        {shown.canSubmit ? <p role="status" className={s.note}>{t.ready}</p> : null}
        <div className={s.actions}><button type="button" className={s.button} disabled={(!busy && blocked) || !shown.canSubmit} aria-disabled={busy || blocked} onClick={() => void submit()}>{busy ? t.submitting : t.submit}</button><button type="button" className={s.secondary} disabled={blocked} onClick={edit}>{t.edit}</button></div>
      </div>}
    </details>}
    <div role="status" aria-live="polite">{message && success ? <p className={s.note}>{message}{sentAt ? <> · <ProgramDocumentTime value={sentAt} /></> : null}</p> : null}</div>
    {message && !success ? <p role="alert" className={s.error}>{message}</p> : null}
    {savedId || readiness?.latestPackage ? <button type="button" className={s.secondary} aria-expanded={!!opened} onClick={() => setOpened(old => old ? null : savedId ?? readiness?.latestPackage?.packageId ?? null)}>{t.open}</button> : null}
    {opened ? <PackageDetailLoader scope={scope} packageId={opened} audience={audience} strings={t} documentStrings={documentStrings} canReview={canReview} epoch={epoch} onSaved={saved} /> : null}
    <PackageHistory key={epoch} scope={scope} audience={audience} strings={t} documentStrings={documentStrings} canReview={canReview} onSaved={saved} />
  </section>;
}
