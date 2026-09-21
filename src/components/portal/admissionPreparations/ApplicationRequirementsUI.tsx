"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { ApplicationRequirementItemV2 } from "@/lib/portal/application-requirements-v2";
import type { ApplicationDocumentItemState } from "@/lib/portal/application-documents";
import type { PortalStrings } from "@/lib/portal/i18n";
import { clearPreparationIntent, persistPreparationIntent, readPendingRequirements, type StudentPreparationScope } from "@/lib/portal/student-preparation-pending";
import { initializeStudentPreparationUIAction } from "@/lib/portal/student-preparation-ui-actions";
import { ProgramDocumentItem } from "./ProgramDocumentItem";
import { ProgramDocumentHistory } from "./ProgramDocumentHistory";
import { ProgramDocumentRecovery } from "./ProgramDocumentRecovery";
import type { ProgramDocumentScope } from "./ProgramDocumentControls";
import type { ApplicationPackageReadiness } from "@/lib/portal/application-packages";
import { readStudentApplicationPackageReadinessAction } from "@/lib/portal/application-packages-actions";
import { PackagePreparation } from "../applicationPackages/PackagePreparation";
import { packageStrings } from "../applicationPackages/strings";

function Requirement({ item, programState, scope, revisionId, strings, documentStrings, onSaved, historyEpoch }: {
  item: ApplicationRequirementItemV2; programState: ApplicationDocumentItemState;
  scope: ProgramDocumentScope; revisionId: string; strings: PortalStrings<"preparations">;
  documentStrings: PortalStrings<"programDocuments">; onSaved: () => void;
  historyEpoch: number;
}) {
  const associationUnavailable = item.unavailableReasons.some((reason) =>
    ["slot_missing", "slot_removed", "application_link_missing", "slot_metadata_changed"].includes(reason));
  return <li className="pt-prep-requirement" id={`requirement-${item.requirementItemId}`}>
    <div className="pt-prep-row-heading"><h3>{item.label}</h3><span className="pt-prep-tag">{item.required ? strings.required : strings.optional}</span></div>
    <p className="pt-prep-note">{item.groupLabel}</p>
    <p className="pt-prep-instructions">{item.instructions}</p>
    {item.definitionImpact === "changed" ? <p className="pt-prep-note">{strings.definitionChanged}</p> : null}
    <dl className="pt-prep-state-list">
      {item.deadline ? <div><dt>{strings.materialDeadline}</dt><dd>
        <time dateTime={item.deadline.date}>{item.deadline.date.split("-").reverse().join(".")}</time>
        {item.deadline.time ? `, ${item.deadline.time}` : ""}{item.deadline.timezone ? ` (${item.deadline.timezone})` : ""}
        <p className="pt-prep-note">{strings.deadlineVerified} <time dateTime={item.deadline.verifiedOn}>{item.deadline.verifiedOn.split("-").reverse().join(".")}</time></p>
        {item.deadline.sourceUrl ? <a href={item.deadline.sourceUrl} target="_blank" rel="noopener noreferrer" className="pt-link">{strings.deadlineSource}</a> : null}
      </dd></div> : null}
      {associationUnavailable ? <div><dt>{strings.file}</dt><dd><ul>{item.unavailableReasons.filter(reason =>
        ["slot_missing", "slot_removed", "application_link_missing", "slot_metadata_changed"].includes(reason))
        .map(reason => <li key={reason}>{strings[`technical.${reason}`]}</li>)}</ul></dd></div> : null}
    </dl>
    <ProgramDocumentItem item={programState} scope={scope} target={{ studentCaseId: scope.studentCaseId, applicationId: scope.applicationId,
      requirementsRevisionId: revisionId, requirementItemId: item.requirementItemId, documentSlotId: item.documentSlotId }}
      audience="student" strings={documentStrings} onSaved={onSaved} historyEpoch={historyEpoch} />
  </li>;
}

export function ApplicationRequirementsUI({ scope, applicationId, initial, canInitialize, strings, documentStrings, locale }: {
  locale: string;
  scope: StudentPreparationScope;
  applicationId: string;
  initial: ApplicationPackageReadiness | null;
  canInitialize: boolean;
  strings: PortalStrings<"preparations">;
  documentStrings: PortalStrings<"programDocuments">;
}) {
  const [documents, setDocuments] = useState(initial);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const current = documents?.requirements ?? null;
  const documentScope = { ...scope, applicationId };
  const [eligible, setEligible] = useState(canInitialize);
  const [busy, setBusy] = useState<"read" | "initialize" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function update(initialize: boolean) {
    if (lock.current) return;
    lock.current = true;
    setHistoryEpoch(value => value + 1);
    setBusy(initialize ? "initialize" : "read");
    setError(null);
    try {
      const latest = await readStudentApplicationPackageReadinessAction(documentScope, { studentCaseId: scope.studentCaseId, applicationId });
      if (!latest.ok) {
        setDocuments(null);
        setEligible(false);
        setError(strings.requirementsUnavailable);
        return;
      }
      setDocuments(latest.readiness);
      setEligible(canInitialize);
      if (!initialize || latest.readiness.requirements.state !== "uninitialized" || !canInitialize) return;
      let intent;
      try {
        intent = readPendingRequirements(scope, applicationId) ?? {
          studentCaseId: scope.studentCaseId, applicationId, requestId: crypto.randomUUID(),
        };
        persistPreparationIntent(scope, intent);
      } catch { setError(strings.storageUnavailable); return; }
      const result = await initializeStudentPreparationUIAction(scope, intent);
      if (result.ok || result.reason !== "unavailable") {
        try { clearPreparationIntent(scope, intent); } catch { /* known server result */ }
      }
      if (!result.ok) {
        setError(result.reason === "unavailable" ? strings.unavailable
          : result.reason === "forbidden" ? strings.forbidden
          : result.reason === "needs_configuration" ? strings.configurationHelp
          : result.reason === "request_conflict" ? strings.requestConflict : strings.initializationIneligible);
      }
      // A receipt is never rendered as a current checklist.
      const readback = await readStudentApplicationPackageReadinessAction(documentScope, { studentCaseId: scope.studentCaseId, applicationId });
      if (readback.ok) { setDocuments(readback.readiness); setEligible(canInitialize); }
      else { setDocuments(null); setEligible(false); if (result.ok) setError(strings.requirementsUnavailable); }
    } catch {
      // A failed fresh read cannot leave an old file/review projection current.
      // Retained command intents remain available for a later explicit retry.
      setDocuments(null);
      setEligible(false);
      setError(strings.unavailable);
    }
    finally { setBusy(null); lock.current = false; }
  }
  return <section className="pt-prep-requirements" aria-labelledby="program-requirements-title" aria-busy={busy !== null}>
    <div className="pt-prep-section-heading"><h2 id="program-requirements-title" className="pt-section-title">{strings.requirements}</h2>
      <button type="button" className="pt-btn-ghost" disabled={busy !== null} onClick={() => update(false)}>{busy === "read" ? strings.checking : strings.check}</button>
    </div>
    {current?.origin === "evo_starter" || (current?.state === "uninitialized" && eligible) ? <p className="pt-prep-note">{strings.starter}</p> : null}
    {current?.configurationState === "confirmed" ? <p className="pt-prep-note">{strings.confirmed}</p> : null}
    {current === null ? <p className="pt-prep-error" role="status">{strings.requirementsUnavailable}</p> : null}
    {current?.state === "uninitialized" ? <div className="pt-prep-notice"><p>{eligible ? strings.uninitialized : strings.initializationIneligible}</p>
      {eligible ? <button type="button" className="pt-btn" disabled={busy !== null} onClick={() => update(true)}>{busy === "initialize" ? strings.initializing : strings.continue}</button> : null}
    </div> : null}
    {current?.state === "needs_configuration" ? <div className="pt-prep-notice"><h3>{strings.needsConfiguration}</h3><p>{strings.configurationHelp}</p>
      <ul>{current.configurationReasons.map((reason) => <li key={reason}>{strings[`config.${reason}`]}</li>)}</ul>
    </div> : null}
    <PackagePreparation scope={documentScope} readiness={documents} loading={busy !== null} audience="student" strings={packageStrings(locale)} documentStrings={documentStrings} onSaved={() => void update(false)} epoch={historyEpoch} />
    {current && current.revisionId && documents && current.items.length > 0 ? <ol className="pt-prep-requirement-list">{current.items.map((item, index) =>
      <Requirement key={item.requirementItemId} item={item} programState={documents.documentItems[index]} scope={documentScope}
        revisionId={current.revisionId!} strings={strings} documentStrings={documentStrings} onSaved={() => void update(false)} historyEpoch={historyEpoch} />)}</ol> : null}
    <ProgramDocumentRecovery scope={documentScope} audience="student" strings={documentStrings}
      currentItemIds={documents?.documentItems.map(item => item.requirementItemId) ?? []}
      currentSubmissionIds={documents?.documentItems.flatMap(item => item.submission ? [item.submission.submissionId] : []) ?? []}
      onSaved={() => void update(false)} />
    <ProgramDocumentHistory key={historyEpoch} scope={documentScope} target={{ studentCaseId: scope.studentCaseId, applicationId }} requirementItemId={null}
      audience="student" strings={documentStrings} onSaved={() => void update(false)} />
    {error ? <p className="pt-prep-error" role="alert">{error}</p> : null}
    <p className="pt-prep-note">{documentStrings.saveHint}</p>
    <div className="pt-prep-actions"><Link className="pt-btn-ghost" href="/portal/documents">{strings.allDocuments}</Link><Link className="pt-link" href="/portal#case-help">{strings.help}</Link></div>
  </section>;
}
