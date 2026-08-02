"use client";

import { useState, type FormEvent } from "react";

import {
  createPlatformDecisionBacklogEntryAction,
  transitionPlatformDecisionBacklogEntryAction,
} from "@/lib/platform-bw4-actions";
import {
  PLATFORM_STUDENT_PROFILE_FIELDS,
  type PlatformStudentProfileField,
} from "@/lib/platform-student-profile-fields";
import type {
  PlatformConversationBw4Workspace,
  PlatformDecisionBacklogEntry,
  PlatformDecisionBacklogVersion,
  PlatformDecisionOwnerRole,
  PlatformDecisionRequirementKind,
  PlatformDecisionStatus,
  PlatformReviewedWorkflowSourceMetadata,
} from "@/lib/platform-bw4-workflow";
import {
  btnCls,
  btnDangerGhostCls,
  btnGhostCls,
  compactActionCls,
  inputCls,
  labelCls,
} from "@/components/ui";

type Labels = Readonly<Record<string, string>>;

const STATUS_ORDER: Readonly<Record<PlatformDecisionStatus, number>> = {
  unresolved: 0,
  answered: 1,
  retired: 2,
};

const STUDENT_PROFILE_FIELD_LABEL_KEYS: Readonly<
  Record<PlatformStudentProfileField, string>
> = {
  preferred_display_name: "platformStudentProfileFieldPreferredDisplayName",
  legal_display_name: "platformStudentProfileFieldLegalDisplayName",
  communication_language: "platformStudentProfileFieldCommunicationLanguage",
  date_of_birth: "platformStudentProfileFieldDateOfBirth",
  citizenship_country: "platformStudentProfileFieldCitizenshipCountry",
  residency_country: "platformStudentProfileFieldResidencyCountry",
  current_education_summary:
    "platformStudentProfileFieldCurrentEducationSummary",
  academic_summary: "platformStudentProfileFieldAcademicSummary",
  language_summary: "platformStudentProfileFieldLanguageSummary",
  budget_band: "platformStudentProfileFieldBudgetBand",
  decision_participant_labels:
    "platformStudentProfileFieldDecisionParticipantLabels",
  consent_status: "platformStudentProfileFieldConsentStatus",
  consent_evidence_ref: "platformStudentProfileFieldConsentEvidenceRef",
  next_step: "platformStudentProfileFieldNextStep",
};

function addRequestId(event: FormEvent<HTMLFormElement>) {
  const input = event.currentTarget.elements.namedItem("request_id");
  if (input instanceof HTMLInputElement) {
    input.value = globalThis.crypto.randomUUID();
  }
}

function formatTimestamp(value: string, locale: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const language =
    locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU";
  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function roleLabel(role: PlatformDecisionOwnerRole, labels: Labels) {
  if (role === "admin") return labels.platformDecisionOwnerAdmin;
  if (role === "sales") return labels.platformDecisionOwnerSales;
  return labels.platformDecisionOwnerCurator;
}

function statusLabel(status: PlatformDecisionStatus, labels: Labels) {
  if (status === "unresolved") {
    return labels.platformDecisionStatusUnresolved;
  }
  if (status === "answered") return labels.platformDecisionStatusAnswered;
  return labels.platformDecisionStatusRetired;
}

function statusTone(status: PlatformDecisionStatus) {
  if (status === "unresolved") return "bg-warn-weak text-warn";
  if (status === "answered") return "bg-ok-weak text-ok";
  return "bg-surface text-fg-3";
}

function requirementLabel(
  kind: PlatformDecisionRequirementKind,
  labels: Labels,
) {
  if (kind === "student_profile") {
    return labels.platformDecisionRequirementStudentProfile;
  }
  if (kind === "country_requirement") {
    return labels.platformDecisionRequirementCountry;
  }
  if (kind === "document_requirement") {
    return labels.platformDecisionRequirementDocument;
  }
  if (kind === "handoff") return labels.platformDecisionRequirementHandoff;
  return labels.platformDecisionRequirementGeneral;
}

function studentProfileFieldLabel(field: string, labels: Labels) {
  const labelKey = (
    STUDENT_PROFILE_FIELD_LABEL_KEYS as Readonly<
      Partial<Record<string, string>>
    >
  )[field];
  return labelKey ? (labels[labelKey] ?? field) : field;
}

function sourceLabel(
  source: PlatformReviewedWorkflowSourceMetadata,
  labels: Labels,
) {
  const revision = source.sourceRevision
    ? `${source.sourceKey} · ${source.sourceRevision}`
    : source.sourceKey;
  return source.canUseForDecisionEvidence
    ? revision
    : `${revision} · ${labels.platformDecisionSourceRetired}`;
}

function RequirementValue({
  version,
  labels,
}: {
  version: PlatformDecisionBacklogVersion;
  labels: Labels;
}) {
  return (
    <span className="break-words">
      {requirementLabel(version.affectedRequirementKind, labels)}
      {version.affectedRequirementField
        ? ` · ${
            version.affectedRequirementKind === "student_profile"
              ? studentProfileFieldLabel(
                  version.affectedRequirementField,
                  labels,
                )
              : version.affectedRequirementField
          }`
        : ""}
      {version.affectedRequirementId &&
      version.affectedRequirementKind !== "student_profile"
        ? ` · ${version.affectedRequirementId}`
        : ""}
    </span>
  );
}

function EvidenceValue({
  version,
  sources,
  labels,
}: {
  version: PlatformDecisionBacklogVersion;
  sources: ReadonlyMap<string, PlatformReviewedWorkflowSourceMetadata>;
  labels: Labels;
}) {
  const source = version.sourceRegistryId
    ? (sources.get(version.sourceRegistryId) ?? null)
    : null;
  if (source === null || version.evidenceRef === null) {
    return <span className="text-fg-3">{labels.platformHandoffNoneRecorded}</span>;
  }

  return (
    <span className="space-y-0.5">
      <a
        href={source.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="block break-words font-semibold text-accent underline decoration-accent/40 underline-offset-2"
      >
        {sourceLabel(source, labels)}
      </a>
      <span className="block break-words text-fg-3">{version.evidenceRef}</span>
    </span>
  );
}

function BaseMutationFields({
  workspace,
  version,
  evidence,
}: {
  workspace: PlatformConversationBw4Workspace;
  version: PlatformDecisionBacklogVersion;
  evidence:
    | Readonly<{ sourceRegistryId: string | null; evidenceRef: string | null }>
    | null;
}) {
  return (
    <>
      <input type="hidden" name="conversation_id" value={workspace.conversationId} />
      <input
        type="hidden"
        name="student_case_id"
        value={workspace.studentCaseId ?? ""}
      />
      <input type="hidden" name="question" value={version.question} />
      <input type="hidden" name="owner_role" value={version.ownerRole} />
      <input
        type="hidden"
        name="affected_requirement_kind"
        value={version.affectedRequirementKind}
      />
      <input
        type="hidden"
        name="affected_requirement_id"
        value={version.affectedRequirementId ?? ""}
      />
      <input
        type="hidden"
        name="affected_requirement_field"
        value={version.affectedRequirementField ?? ""}
      />
      {evidence !== null && (
        <>
          <input
            type="hidden"
            name="source_registry_id"
            value={evidence.sourceRegistryId ?? ""}
          />
          <input
            type="hidden"
            name="evidence_ref"
            value={evidence.evidenceRef ?? ""}
          />
        </>
      )}
      <input type="hidden" name="request_id" defaultValue="" />
    </>
  );
}

function TransitionFields({
  workspace,
  decision,
  newStatus,
  answer,
  evidence,
}: {
  workspace: PlatformConversationBw4Workspace;
  decision: PlatformDecisionBacklogEntry;
  newStatus: PlatformDecisionStatus;
  answer: string | null;
  evidence:
    | Readonly<{ sourceRegistryId: string | null; evidenceRef: string | null }>
    | null;
}) {
  return (
    <>
      <BaseMutationFields
        workspace={workspace}
        version={decision.currentVersion}
        evidence={evidence}
      />
      <input
        type="hidden"
        name="decision_backlog_id"
        value={decision.decisionBacklogId}
      />
      <input
        type="hidden"
        name="expected_effective_version"
        value={decision.currentEffectiveVersion}
      />
      <input type="hidden" name="new_status" value={newStatus} />
      {answer !== null && <input type="hidden" name="answer" value={answer} />}
      {answer === null && newStatus !== "answered" && (
        <input type="hidden" name="answer" value="" />
      )}
    </>
  );
}

function CreateDecisionForm({
  workspace,
  labels,
}: {
  workspace: PlatformConversationBw4Workspace;
  labels: Labels;
}) {
  const [requirementKind, setRequirementKind] =
    useState<PlatformDecisionRequirementKind>("general");
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const studentProfileSelected = requirementKind === "student_profile";
  const handoffSelected = requirementKind === "handoff";
  const catalogRequirementSelected =
    requirementKind === "country_requirement" ||
    requirementKind === "document_requirement";
  const availableRequirements = workspace.availableRequirements.filter(
    (requirement) => requirement.requirementKind === requirementKind,
  );
  const hasCountryRequirement = workspace.availableRequirements.some(
    (requirement) => requirement.requirementKind === "country_requirement",
  );
  const hasDocumentRequirement = workspace.availableRequirements.some(
    (requirement) => requirement.requirementKind === "document_requirement",
  );

  return (
    <details
      className="mt-3 rounded-ctl border border-border bg-surface p-3"
      data-testid="platform-decision-create"
    >
      <summary className={`${compactActionCls} cursor-pointer list-none`}>
        {labels.platformDecisionCreate}
      </summary>
      <form
        action={createPlatformDecisionBacklogEntryAction}
        onSubmit={addRequestId}
        className="mt-3 grid gap-2 sm:grid-cols-2"
      >
        <input
          type="hidden"
          name="conversation_id"
          value={workspace.conversationId}
        />
        <input
          type="hidden"
          name="student_case_id"
          value={workspace.studentCaseId ?? ""}
        />
        <input type="hidden" name="source_registry_id" value="" />
        <input type="hidden" name="evidence_ref" value="" />
        <input type="hidden" name="request_id" defaultValue="" />

        <div className="sm:col-span-2">
          <label htmlFor="platform-decision-question" className={labelCls}>
            {labels.platformDecisionQuestion}
          </label>
          <textarea
            id="platform-decision-question"
            name="question"
            required
            minLength={1}
            maxLength={2000}
            className={`${inputCls} min-h-24 resize-y py-2`}
          />
        </div>

        <div>
          {workspace.allowedOwnerRoles.length === 1 ? (
            <>
              <p className={labelCls}>{labels.platformDecisionOwner}</p>
              <input
                type="hidden"
                name="owner_role"
                value={workspace.allowedOwnerRoles[0]}
              />
              <p className="rounded-ctl border border-border bg-surface-2 px-3 py-2 text-[12px] font-semibold text-fg-2">
                {roleLabel(workspace.allowedOwnerRoles[0], labels)}
              </p>
              <p className="mt-1 text-[10px] text-fg-3">
                {labels.platformDecisionOwnerFixed}
              </p>
            </>
          ) : (
            <>
              <label htmlFor="platform-decision-owner" className={labelCls}>
                {labels.platformDecisionOwner}
              </label>
              <select
                id="platform-decision-owner"
                name="owner_role"
                required
                className={inputCls}
              >
                {workspace.allowedOwnerRoles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role, labels)}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div>
          <label htmlFor="platform-decision-requirement" className={labelCls}>
            {labels.platformDecisionAffectedRequirement}
          </label>
          <select
            id="platform-decision-requirement"
            name="affected_requirement_kind"
            value={requirementKind}
            onChange={(event) => {
              setRequirementKind(
                event.target.value as PlatformDecisionRequirementKind,
              );
              setSelectedRequirementId("");
            }}
            className={inputCls}
          >
            <option value="general">
              {labels.platformDecisionRequirementGeneral}
            </option>
            {workspace.studentCaseId !== null && (
              <option value="student_profile">
                {labels.platformDecisionRequirementStudentProfile}
              </option>
            )}
            {hasCountryRequirement && (
              <option value="country_requirement">
                {labels.platformDecisionRequirementCountry}
              </option>
            )}
            {hasDocumentRequirement && (
              <option value="document_requirement">
                {labels.platformDecisionRequirementDocument}
              </option>
            )}
            {workspace.handoff !== null && (
              <option value="handoff">
                {labels.platformDecisionRequirementHandoff}
              </option>
            )}
          </select>
        </div>

        <input
          type="hidden"
          name="affected_requirement_id"
          value={
            studentProfileSelected
              ? (workspace.studentCaseId ?? "")
              : catalogRequirementSelected
                ? selectedRequirementId
              : handoffSelected
                ? (workspace.handoff?.handoffId ?? "")
                : ""
          }
        />
        {catalogRequirementSelected && (
          <div className="sm:col-span-2">
            <label
              htmlFor="platform-decision-requirement-target"
              className={labelCls}
            >
              {labels.platformDecisionAffectedRequirement}
            </label>
            <select
              id="platform-decision-requirement-target"
              required
              value={selectedRequirementId}
              onChange={(event) => setSelectedRequirementId(event.target.value)}
              className={inputCls}
              data-testid="platform-decision-requirement-target"
            >
              <option value="" disabled>
                {labels.platformDecisionAffectedRequirement}
              </option>
              {availableRequirements.map((requirement) => (
                <option
                  key={requirement.requirementId}
                  value={requirement.requirementId}
                >
                  {requirement.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {studentProfileSelected ? (
          <div className="sm:col-span-2">
            <label
              htmlFor="platform-decision-requirement-field"
              className={labelCls}
            >
              {labels.platformDecisionRequirementField}
            </label>
            <select
              id="platform-decision-requirement-field"
              name="affected_requirement_field"
              required
              defaultValue=""
              className={inputCls}
            >
              <option value="" disabled>
                {labels.platformDecisionRequirementField}
              </option>
              {PLATFORM_STUDENT_PROFILE_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {studentProfileFieldLabel(field, labels)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="affected_requirement_field" value="" />
        )}

        <div className="sm:col-span-2">
          <label htmlFor="platform-decision-create-reason" className={labelCls}>
            {labels.platformDecisionReason}
          </label>
          <input
            id="platform-decision-create-reason"
            name="reason"
            required
            minLength={1}
            maxLength={1000}
            className={inputCls}
          />
        </div>
        <button
          type="submit"
          className={`${btnCls} sm:col-span-2`}
          data-testid="platform-decision-create-submit"
        >
          {labels.platformDecisionCreate}
        </button>
      </form>
    </details>
  );
}

function DecisionHistory({
  decision,
  sources,
  locale,
  labels,
}: {
  decision: PlatformDecisionBacklogEntry;
  sources: ReadonlyMap<string, PlatformReviewedWorkflowSourceMetadata>;
  locale: string;
  labels: Labels;
}) {
  return (
    <details className="mt-3 border-t border-border pt-2">
      <summary className="cursor-pointer text-[10.5px] font-semibold text-accent underline decoration-accent/30 underline-offset-2">
        {labels.platformDecisionHistory} ({decision.versions.length})
      </summary>
      <ol className="mt-2 space-y-2" data-testid="platform-decision-history">
        {[...decision.versions].reverse().map((version) => (
          <li
            key={version.decisionBacklogVersionId}
            className="rounded-ctl border border-border bg-surface px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[9.5px] text-fg-3">
                {labels.platformDecisionHistoryVersion} {version.effectiveVersion}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${statusTone(version.status)}`}
              >
                {statusLabel(version.status, labels)}
              </span>
            </div>
            <p className="mt-1 break-words text-[10.5px] font-semibold text-fg-2">
              {version.question}
            </p>
            {version.answer !== null && (
              <p className="mt-1 break-words text-[10.5px] text-fg-2">
                {version.answer}
              </p>
            )}
            <div className="mt-2 text-[10px] leading-4 text-fg-3">
              <RequirementValue version={version} labels={labels} />
              <span aria-hidden="true"> · </span>
              {formatTimestamp(version.createdAt, locale)}
            </div>
            {version.sourceRegistryId !== null && (
              <div className="mt-1 text-[10px] leading-4 text-fg-3">
                <EvidenceValue
                  version={version}
                  sources={sources}
                  labels={labels}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

function AnswerDecisionForm({
  workspace,
  decision,
  labels,
}: {
  workspace: PlatformConversationBw4Workspace;
  decision: PlatformDecisionBacklogEntry;
  labels: Labels;
}) {
  const usableSources = workspace.reviewedSources.filter(
    (source) => source.canUseForDecisionEvidence,
  );
  const hasSources = usableSources.length > 0;
  return (
    <details className="rounded-ctl border border-border bg-surface p-2.5">
      <summary className="cursor-pointer text-[10.5px] font-semibold text-accent">
        {labels.platformDecisionSaveAnswer}
      </summary>
      <form
        action={transitionPlatformDecisionBacklogEntryAction}
        onSubmit={addRequestId}
        className="mt-3 space-y-2"
      >
        <TransitionFields
          workspace={workspace}
          decision={decision}
          newStatus="answered"
          answer={null}
          evidence={null}
        />
        <label
          htmlFor={`platform-decision-answer-${decision.decisionBacklogId}`}
          className={labelCls}
        >
          {labels.platformDecisionAnswerText}
        </label>
        <textarea
          id={`platform-decision-answer-${decision.decisionBacklogId}`}
          name="answer"
          required
          minLength={1}
          maxLength={8000}
          className={`${inputCls} min-h-24 resize-y py-2`}
        />
        <label
          htmlFor={`platform-decision-source-${decision.decisionBacklogId}`}
          className={labelCls}
        >
          {labels.platformDecisionEvidence}
        </label>
        <select
          id={`platform-decision-source-${decision.decisionBacklogId}`}
          name="source_registry_id"
          required
          defaultValue=""
          className={inputCls}
          disabled={!hasSources}
        >
          <option value="" disabled>
            {labels.platformDecisionEvidenceRequired}
          </option>
          {usableSources.map((source) => (
            <option key={source.sourceRegistryId} value={source.sourceRegistryId}>
              {sourceLabel(source, labels)}
            </option>
          ))}
        </select>
        {!hasSources && (
          <p className="rounded-ctl bg-warn-weak px-3 py-2 text-[10.5px] text-warn">
            {labels.platformDecisionNoReviewedSources}
          </p>
        )}
        <label
          htmlFor={`platform-decision-evidence-${decision.decisionBacklogId}`}
          className={labelCls}
        >
          {labels.platformDecisionEvidenceRef}
        </label>
        <input
          id={`platform-decision-evidence-${decision.decisionBacklogId}`}
          name="evidence_ref"
          required
          minLength={1}
          maxLength={1000}
          className={inputCls}
          disabled={!hasSources}
        />
        <label
          htmlFor={`platform-decision-answer-reason-${decision.decisionBacklogId}`}
          className={labelCls}
        >
          {labels.platformDecisionReason}
        </label>
        <input
          id={`platform-decision-answer-reason-${decision.decisionBacklogId}`}
          name="reason"
          required
          minLength={1}
          maxLength={1000}
          className={inputCls}
        />
        <button
          type="submit"
          disabled={!hasSources}
          className={`${btnCls} w-full`}
          data-testid="platform-decision-answer-submit"
        >
          {labels.platformDecisionSaveAnswer}
        </button>
      </form>
    </details>
  );
}

function SimpleTransitionForm({
  workspace,
  decision,
  newStatus,
  labels,
}: {
  workspace: PlatformConversationBw4Workspace;
  decision: PlatformDecisionBacklogEntry;
  newStatus: "unresolved" | "retired";
  labels: Labels;
}) {
  const current = decision.currentVersion;
  const reopening = newStatus === "unresolved";
  const evidence = reopening
    ? { sourceRegistryId: null, evidenceRef: null }
    : {
        sourceRegistryId: current.sourceRegistryId,
        evidenceRef: current.evidenceRef,
      };
  const answer = reopening ? null : current.answer;
  return (
    <form
      action={transitionPlatformDecisionBacklogEntryAction}
      onSubmit={addRequestId}
      className="rounded-ctl border border-border bg-surface p-2.5"
    >
      <TransitionFields
        workspace={workspace}
        decision={decision}
        newStatus={newStatus}
        answer={answer}
        evidence={evidence}
      />
      <label
        htmlFor={`platform-decision-${newStatus}-reason-${decision.decisionBacklogId}`}
        className={labelCls}
      >
        {labels.platformDecisionReason}
      </label>
      <input
        id={`platform-decision-${newStatus}-reason-${decision.decisionBacklogId}`}
        name="reason"
        required
        minLength={1}
        maxLength={1000}
        className={inputCls}
      />
      <button
        type="submit"
        className={`mt-2 w-full ${
          reopening ? btnGhostCls : btnDangerGhostCls
        }`}
        data-testid={
          reopening
            ? "platform-decision-reopen-submit"
            : "platform-decision-retire-submit"
        }
      >
        {reopening
          ? labels.platformDecisionReopen
          : labels.platformDecisionRetire}
      </button>
    </form>
  );
}

function DecisionCard({
  workspace,
  decision,
  sources,
  locale,
  labels,
}: {
  workspace: PlatformConversationBw4Workspace;
  decision: PlatformDecisionBacklogEntry;
  sources: ReadonlyMap<string, PlatformReviewedWorkflowSourceMetadata>;
  locale: string;
  labels: Labels;
}) {
  const current = decision.currentVersion;
  return (
    <article
      className={`rounded-ctl border p-3 ${
        current.status === "unresolved"
          ? "border-warn/30 bg-warn-weak/40"
          : "border-border bg-surface-2"
      }`}
      data-decision-id={decision.decisionBacklogId}
      data-decision-status={current.status}
      data-testid="platform-decision-entry"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="min-w-0 flex-1 break-words text-[11.5px] font-bold leading-4 text-fg">
          {current.question}
        </h4>
        <span
          className={`rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${statusTone(current.status)}`}
        >
          {statusLabel(current.status, labels)}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-fg-3">
            {labels.platformDecisionOwner}
          </dt>
          <dd className="mt-0.5 text-[10.5px] text-fg-2">
            {roleLabel(current.ownerRole, labels)}
          </dd>
        </div>
        <div>
          <dt className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-fg-3">
            {labels.platformDecisionEffectiveVersion}
          </dt>
          <dd className="mt-0.5 font-mono text-[10.5px] text-fg-2">
            {current.effectiveVersion}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-fg-3">
            {labels.platformDecisionAffectedRequirement}
          </dt>
          <dd className="mt-0.5 text-[10.5px] text-fg-2">
            <RequirementValue version={current} labels={labels} />
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-fg-3">
            {labels.platformDecisionAnswer}
          </dt>
          <dd className="mt-0.5 whitespace-pre-wrap break-words text-[10.5px] text-fg-2">
            {current.answer ?? labels.platformDecisionNoAnswer}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-fg-3">
            {labels.platformDecisionEvidence}
          </dt>
          <dd className="mt-0.5 text-[10.5px] leading-4 text-fg-2">
            <EvidenceValue version={current} sources={sources} labels={labels} />
          </dd>
        </div>
      </dl>

      {workspace.canManageDecisions &&
        (decision.canAnswer || decision.canReopen || decision.canRetire) && (
          <div
            className="mt-3 grid gap-2 sm:grid-cols-2"
            data-testid="platform-decision-controls"
          >
            {decision.canAnswer && (
              <AnswerDecisionForm
                workspace={workspace}
                decision={decision}
                labels={labels}
              />
            )}
            {decision.canReopen && (
              <SimpleTransitionForm
                workspace={workspace}
                decision={decision}
                newStatus="unresolved"
                labels={labels}
              />
            )}
            {decision.canRetire && (
              <SimpleTransitionForm
                workspace={workspace}
                decision={decision}
                newStatus="retired"
                labels={labels}
              />
            )}
          </div>
        )}

      <DecisionHistory
        decision={decision}
        sources={sources}
        locale={locale}
        labels={labels}
      />
    </article>
  );
}

export function PlatformDecisionBacklogCard({
  workspace,
  locale,
  labels,
}: {
  workspace: PlatformConversationBw4Workspace;
  locale: string;
  labels: Labels;
}) {
  const sources = new Map(
    workspace.reviewedSources.map((source) => [source.sourceRegistryId, source]),
  );
  const decisions = [...workspace.decisions].sort((left, right) => {
    const statusDifference =
      STATUS_ORDER[left.currentVersion.status] -
      STATUS_ORDER[right.currentVersion.status];
    return (
      statusDifference ||
      left.currentVersion.question.localeCompare(right.currentVersion.question)
    );
  });

  return (
    <section
      aria-labelledby="platform-decision-backlog-title"
      className="rounded-ctl border border-border bg-surface-2 p-3"
      data-can-manage={workspace.canManageDecisions ? "true" : "false"}
      data-testid="platform-decision-backlog"
    >
      <h3
        id="platform-decision-backlog-title"
        className="text-[11px] font-bold text-fg"
      >
        {labels.platformDecisionBacklogTitle}
      </h3>
      <p className="mt-1 text-[10.5px] leading-4 text-fg-3">
        {labels.platformDecisionBacklogHint}
      </p>

      {workspace.canManageDecisions && workspace.canCreateDecision && (
        <CreateDecisionForm workspace={workspace} labels={labels} />
      )}

      {decisions.length === 0 ? (
        <p className="mt-3 text-[11px] text-fg-3">
          {labels.platformDecisionEmpty}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {decisions.map((decision) => (
            <DecisionCard
              key={decision.decisionBacklogId}
              workspace={workspace}
              decision={decision}
              sources={sources}
              locale={locale}
              labels={labels}
            />
          ))}
        </div>
      )}
    </section>
  );
}
