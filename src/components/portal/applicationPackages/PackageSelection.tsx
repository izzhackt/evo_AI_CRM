"use client";
import { useId, useState } from "react";
import type { ApplicationDocumentItemState, ApplicationDocumentReusableVersion, ApplicationDocumentVersionCursor, ApplicationDocumentFile, ApplicationDocumentSelection } from "@/lib/portal/application-documents";
import type { ApplicationRequirementItemV2 } from "@/lib/portal/application-requirements-v2";
import type { ApplicationPackageSelection } from "@/lib/portal/application-packages";
import type { ApplicationPackageScope } from "@/lib/portal/application-packages-pending";
import { readApplicationDocumentReusableVersionsAction } from "@/lib/portal/application-documents-actions";
import type { PackageStrings } from "./strings";
import s from "../admissionPreparations/ProgramDocuments.module.css";
import p from "./Packages.module.css";
export function PackageSelectionRow({ scope, item, state, selected, included, disabled, strings: t, onInclude, onChange }: {
  scope: ApplicationPackageScope; item: ApplicationRequirementItemV2; state: ApplicationDocumentItemState;
  selected?: ApplicationPackageSelection; included: boolean; disabled: boolean; strings: PackageStrings; onInclude: (included: boolean) => void; onChange: (selection: ApplicationPackageSelection | null) => void;
}) {
  const id = useId(), [more, setMore] = useState<ApplicationDocumentReusableVersion[]>([]), [cursor, setCursor] = useState<ApplicationDocumentVersionCursor | null>(state.reusableVersionsNextCursor);
  const [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  const versions: { selection: ApplicationDocumentSelection; file: ApplicationDocumentFile }[] = [];
  if (state.submission) versions.push({ selection: { kind: "existing_version", documentVersionId: state.submission.file.documentVersionId }, file: state.submission.file });
  if (state.savedDraft) versions.push({ selection: { kind: "program_upload", documentVersionId: state.savedDraft.file.documentVersionId, uploadContextId: state.savedDraft.uploadContextId }, file: state.savedDraft.file });
  versions.push(...state.reusableVersions, ...more);
  const unique = versions.filter((version, index) => versions.findIndex(item => item.file.documentVersionId === version.file.documentVersionId) === index);
  const value = selected?.selection.documentVersionId ?? "";
  async function load() {
    if (loading || !cursor) return; setLoading(true); setFailed(false);
    try { const response = await readApplicationDocumentReusableVersionsAction(scope, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId, requirementItemId: item.requirementItemId }, cursor);
      if (!response.ok) { setFailed(true); return; } setMore(old => [...old, ...response.page.versions]); setCursor(response.page.nextCursor);
    } catch { setFailed(true); } finally { setLoading(false); }
  }
  return <li className={p.row}><h4 id={`${id}-title`} className={s.heading}>{item.label}</h4>
    <p className={s.meta}>{item.required ? t.required : t.optionalLabel}</p>
    {!item.required ? <label className={p.check}><input type="checkbox" aria-label={`${t.optional}: ${item.label}`} disabled={disabled} checked={included} onChange={event => onInclude(event.target.checked)} />{t.optional}</label> : null}
    {included ? <><label id={`${id}-label`} htmlFor={id} className={s.label}>{t.select}</label><select id={id} aria-labelledby={`${id}-title ${id}-label`} className={s.input} disabled={disabled || loading} value={value} onChange={event => {
      const file = unique.find(version => version.file.documentVersionId === event.target.value);
      onChange(file ? { requirementItemId: item.requirementItemId, selection: file.selection, expectedPreviousSubmissionId: state.submission?.submissionId ?? null } : null);
    }}><option value="">{t.none}</option>{value && !unique.some(version => version.file.documentVersionId === value) ? <option value={value} disabled>{t.fileUnavailable}</option> : null}
      {unique.map(version => <option key={version.file.documentVersionId} value={version.file.documentVersionId} disabled={version.file.technicalAvailability !== "available"}>{version.file.originalFilename} · {t.fileVersion} {version.file.versionNo}</option>)}
    </select>{!unique.length ? <p className={s.note}>{t.noFile}</p> : null}
    {cursor ? <button type="button" className={s.secondary} disabled={disabled || loading} onClick={() => void load()}>{loading ? t.loading : t.moreFiles}</button> : null}
    {failed ? <p role="alert" className={s.error}>{t.unavailable}</p> : null}</> : null}
  </li>;
}
