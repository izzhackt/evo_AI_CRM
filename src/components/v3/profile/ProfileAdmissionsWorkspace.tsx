"use client";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";


import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Pill, type PillTone } from "@/components/v3/Pill";
import { btnGhostCls, Card, cn, inputCls, fieldLabelCls } from "@/components/ui";
import {
  changePlatformUniversityApplicationAction,
  updateApplicationPartnerDetailsAction,
  updatePlatformUniversityApplicationDetailsAction,
  type PlatformUniversityApplicationActionState,
} from "@/lib/platform-admissions-actions";
import {
  PLATFORM_APPLICATION_EVIDENCE_STATUSES,
  PLATFORM_APPLICATION_FORWARD_STATUSES,
  platformApplicationCountryEditOptions,
  platformApplicationDegreeEditOptions,
  type PlatformApplicationQueueRow,
} from "@/lib/platform-application-contract";
import {
  createPlatformFinanceStopFactorAction,
  resolvePlatformFinanceStopFactorAction,
  type PlatformFinanceStopFactorActionState,
} from "@/lib/platform-case-operations-actions";
import {
  allDayDate,
  applicationStatus,
  country as applicationCountry,
  degree as applicationDegree,
  financeBlockedAction,
  financeBlockedActionOptions,
} from "@/lib/v3/wording";

import { ApplicationCreateDialog } from "./ApplicationCreateDialog";
import { StaffPreparationPanel } from "./StaffPreparationPanel";
import type { CatalogPreparation } from "@/lib/portal/catalog-preparations";
import type { StaffPreparationRead } from "@/lib/v3/staff-catalog-preparation-actions";
import type { ApplicationPartnerDetails, ProfileAdmissionsWorkspace } from "./types";

export type ActionStatus =
  | PlatformUniversityApplicationActionState["status"]
  | PlatformFinanceStopFactorActionState["status"];

const STATUS_COPY: Record<Exclude<ActionStatus, "idle">, string> = {
  saved: "Изменение сохранено.",
  invalid: "Проверьте обязательные поля и формат значений.",
  forbidden: "У вашей роли нет права выполнить это действие.",
  stale: "Данные уже изменились. Показано актуальное состояние — проверьте его перед повтором.",
  request_conflict: "Этот запрос уже использован с другими данными. Повторите действие с новым идентификатором запроса.",
  unavailable: "Supabase не подтвердил изменение. Ничего не отмечено как сохранённое.",
};

function statusTone(status: string): PillTone {
  if (status === "approved" || status === "enrolled" || status === "offer") return "ok";
  if (status === "submitted" || status === "under_review" || status === "ready") return "info";
  if (status === "rejected" || status === "withdrawn") return "danger";
  return "neutral";
}

/** Exported for ApplicationCreateDialog.tsx, which reuses this same locked/refresh convention. */
export function useCanonicalRefresh(status: ActionStatus): void {
  const router = useRouter();
  useEffect(() => {
    if (status === "saved" || status === "stale") router.refresh();
  }, [router, status]);
}

/** Exported for ApplicationCreateDialog.tsx (reuse, not a second copy). */
export function PrimaryApplicationField({
  defaultChecked,
}: Readonly<{ defaultChecked: boolean }>) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-ctl px-2 py-2 text-sm leading-5 text-fg-2 hover:bg-surface-2">
      <input
        type="checkbox"
        name="is_primary"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
      />
      <span>
        <span className="block font-medium text-fg">Основной вариант</span>
        <span className="block text-xs text-fg-3">
          В деле может быть только один; выбор заменит текущий основной вариант.
        </span>
      </span>
    </label>
  );
}

/** Exported for ApplicationCreateDialog.tsx (reuse, not a second copy). */
export function ApplicationCountryField({
  defaultValue = "",
}: Readonly<{ defaultValue?: string }>) {
  const options = platformApplicationCountryEditOptions(defaultValue || null);
  return (
    <label>
      <span className={fieldLabelCls}>Страна</span>
      <select name="country" defaultValue={defaultValue} className={inputCls}>
        <option value="">Не указана</option>
        {options.map((countryCode) => (
          <option key={countryCode} value={countryCode}>
            {applicationCountry(countryCode) ?? "Сохранено ранее (оставить без изменений)"}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Exported for ApplicationCreateDialog.tsx (reuse, not a second copy). */
export function ApplicationDegreeField({
  defaultValue = "",
}: Readonly<{ defaultValue?: string }>) {
  const options = platformApplicationDegreeEditOptions(defaultValue || null);
  return (
    <label>
      <span className={fieldLabelCls}>Ступень</span>
      <select name="degree" defaultValue={defaultValue} className={inputCls}>
        <option value="">Не указана</option>
        {options.map((degreeKey) => (
          <option key={degreeKey} value={degreeKey}>
            {applicationDegree(degreeKey) ?? "Сохранено ранее (оставить без изменений)"}
          </option>
        ))}
      </select>
    </label>
  );
}

function ApplicationGeographySummary({
  countryCode,
  degreeKey,
}: Readonly<{ countryCode: string | null; degreeKey: string | null }>) {
  const countryLabel = applicationCountry(countryCode);
  const degreeLabel = applicationDegree(degreeKey);
  if (!countryLabel && !degreeLabel) return null;

  return (
    <p className="mt-2 text-xs text-fg-3">
      {[countryLabel ? `Страна: ${countryLabel}` : null, degreeLabel ? `Ступень: ${degreeLabel}` : null]
        .filter((value): value is string => value !== null)
        .join(" · ")}
    </p>
  );
}

/** Exported for ApplicationCreateDialog.tsx (reuse, not a second copy). */
export function StateBanner({ status }: Readonly<{ status: ActionStatus }>) {
  if (status === "idle") return null;
  const warning = status === "invalid" || status === "stale" || status === "request_conflict";
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "text-xs leading-5",
        status === "saved" ? "text-ok" : warning ? "text-warn" : "text-danger",
      )}
      data-testid="v3-admissions-action-status"
      data-status={status}
    >
      {STATUS_COPY[status]}
    </p>
  );
}

/**
 * OTH-4 («Отметить статус»): un-deadens `platform.change_university_application`
 * (live since 107, previously exported but never rendered anywhere — see this
 * slice's plan doc, «Uni & knowledge base», «Добавленный вуз означает
 * «рассматриваем». Фактическая подача отмечается отдельно»). Only the
 * meaningful forward statuses are offered (PLATFORM_APPLICATION_FORWARD_STATUSES
 * excludes `preparation`, the fixed create-time default). Evidence is always
 * submitted as one field (exactActionStringFields requires the exact expected
 * count every time, the same convention `is_primary`'s checkbox already
 * relies on above) but only rendered/required while the chosen status needs
 * it; `rejected`/`withdrawn` require a note the same way the RPC itself does.
 */
function ApplicationStatusForm({
  workspace,
  application,
}: Readonly<{
  workspace: ProfileAdmissionsWorkspace;
  application: PlatformApplicationQueueRow;
}>) {
  const initialState: PlatformUniversityApplicationActionState = {
    status: "idle",
    requestId: workspace.requestIds.changeStatus[application.universityApplicationId],
    universityApplicationId: application.universityApplicationId,
    version: application.version,
  };
  const [state, action, pending] = useActionState(
    changePlatformUniversityApplicationAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";
  const [nextStatus, setNextStatus] = useState("");
  const needsEvidence = PLATFORM_APPLICATION_EVIDENCE_STATUSES.has(
    nextStatus as (typeof PLATFORM_APPLICATION_FORWARD_STATUSES)[number],
  );
  const needsNote = nextStatus === "rejected" || nextStatus === "withdrawn";

  return (
    <form action={action} className="mt-3 space-y-3" aria-busy={pending}>
      <input type="hidden" name="application_id" value={application.universityApplicationId} />
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value={state.version ?? application.version} />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <label>
          <span className={fieldLabelCls}>Статус</span>
          <select
            name="status"
            required
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value)}
            className={inputCls}
          >
            <option value="">Выберите статус</option>
            {PLATFORM_APPLICATION_FORWARD_STATUSES.filter((status) => status !== application.status).map((status) => (
              <option key={status} value={status}>{applicationStatus(status)}</option>
            ))}
          </select>
        </label>
        {needsEvidence ? (
          <label>
            <span className={fieldLabelCls}>Ссылка на подтверждение</span>
            <input name="evidence_reference" required maxLength={1000} className={inputCls} />
          </label>
        ) : (
          <input type="hidden" name="evidence_reference" value="" />
        )}
        <label className="md:col-span-2">
          <span className={fieldLabelCls}>Заметка</span>
          <textarea name="note" required={needsNote} rows={2} maxLength={1000} className={inputCls} />
        </label>
        <button type="submit" className={btnGhostCls} disabled={locked || !nextStatus}>
          {pending ? "Сохраняем…" : "Сохранить статус"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

function ApplicationDetailsForm({
  workspace,
  application,
}: Readonly<{
  workspace: ProfileAdmissionsWorkspace;
  application: PlatformApplicationQueueRow;
}>) {
  const initialState: PlatformUniversityApplicationActionState = {
    status: "idle",
    requestId: workspace.requestIds.applicationDetails[application.universityApplicationId],
    universityApplicationId: application.universityApplicationId,
    version: application.version,
  };
  const [state, action, pending] = useActionState(
    updatePlatformUniversityApplicationDetailsAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form action={action} className="mt-3 space-y-3" aria-busy={pending}>
      <input type="hidden" name="application_id" value={application.universityApplicationId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value={state.version ?? application.version} />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <PrimaryApplicationField defaultChecked={application.isPrimary} />
        <label>
          <span className={fieldLabelCls}>Дедлайн от университета</span>
          <input
            name="university_deadline_on"
            type="date"
            defaultValue={application.universityDeadlineOn ?? ""}
            className={inputCls}
          />
        </label>
        <ApplicationCountryField defaultValue={application.country ?? ""} />
        <ApplicationDegreeField defaultValue={application.degree ?? ""} />
        <button type="submit" className={btnGhostCls} disabled={locked}>
          {pending ? "Сохраняем…" : "Сохранить детали"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

/**
 * Партнёр и решение — editable since unified workflow S7 (plan §8/§11).
 * `platform.update_application_partner_details_v1` (migration 184) needs no
 * admissions_playbook_version_id, unlike the retired 137 write path — see
 * `readApplicationPartnerDetails` in `src/lib/v3/admissions-source.ts` for
 * the full history. Read-only fallback stays for staff without
 * `application.manage`, matching every other write control on this panel
 * (`canWriteApplications`); renders nothing when every field is empty AND
 * the actor cannot write — a quiet card, never a permanent placeholder.
 */
function ApplicationPartnerFacts({
  workspace, application, details, canWrite,
}: Readonly<{
  workspace: ProfileAdmissionsWorkspace;
  application: PlatformApplicationQueueRow;
  details: ApplicationPartnerDetails | undefined;
  canWrite: boolean;
}>) {
  const initialState: PlatformUniversityApplicationActionState = {
    status: "idle",
    requestId: workspace.requestIds.partnerDetails[application.universityApplicationId],
    universityApplicationId: application.universityApplicationId,
    version: details?.version ?? application.version,
  };
  const [state, action, pending] = useActionState(
    updateApplicationPartnerDetailsAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = !canWrite || pending || state.status === "saved" || state.status === "stale";
  const [draft, setDraft] = useState({
    partnerContact: details?.partnerContact ?? "",
    externalLink: details?.externalLink ?? "",
    decisionReference: details?.decisionReference ?? "",
    decisionNote: details?.decisionNote ?? "",
  });

  if (!canWrite) {
    const facts = [
      { label: "Контакт партнёра", value: details?.partnerContact ?? null },
      { label: "Ссылка", value: details?.externalLink ?? null },
      { label: "Номер / ссылка решения", value: details?.decisionReference ?? null },
      { label: "Заметка о решении", value: details?.decisionNote ?? null },
    ].filter((fact) => fact.value);
    if (facts.length === 0) return null;
    return (
      <div className="mt-3 rounded-nav border border-border p-3">
        <h4 className="t-item text-fg">Партнёр и решение</h4>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs text-fg-3">{fact.label}</dt>
              <dd className="mt-0.5 break-words text-sm text-fg">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-3 rounded-nav border border-border p-3" aria-busy={pending}>
      <h4 className="t-item text-fg">Партнёр и решение</h4>
      <input type="hidden" name="application_id" value={application.universityApplicationId} />
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value={state.version ?? application.version} />
      <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={fieldLabelCls}>Контакт партнёра</span>
          <input
            name="partner_contact"
            maxLength={300}
            value={draft.partnerContact}
            onChange={(event) => setDraft((previous) => ({ ...previous, partnerContact: event.target.value }))}
            className={inputCls}
          />
        </label>
        <label>
          <span className={fieldLabelCls}>Ссылка</span>
          <input
            name="external_link"
            type="url"
            maxLength={2000}
            placeholder="https://…"
            value={draft.externalLink}
            onChange={(event) => setDraft((previous) => ({ ...previous, externalLink: event.target.value }))}
            className={inputCls}
          />
        </label>
        <label>
          <span className={fieldLabelCls}>Номер / ссылка решения</span>
          <input
            name="decision_reference"
            maxLength={300}
            value={draft.decisionReference}
            onChange={(event) => setDraft((previous) => ({ ...previous, decisionReference: event.target.value }))}
            className={inputCls}
          />
        </label>
        <label className="sm:col-span-2">
          <span className={fieldLabelCls}>Заметка о решении</span>
          <textarea
            name="decision_note"
            maxLength={2000}
            rows={2}
            value={draft.decisionNote}
            onChange={(event) => setDraft((previous) => ({ ...previous, decisionNote: event.target.value }))}
            className={inputCls}
          />
        </label>
        <button type="submit" className={btnGhostCls} disabled={locked}>
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

function FinanceStopCreateForm({
  workspace,
  obligationId,
}: Readonly<{ workspace: ProfileAdmissionsWorkspace; obligationId: string }>) {
  const initialState: PlatformFinanceStopFactorActionState = {
    status: "idle",
    requestId: workspace.requestIds.createStops[obligationId],
    stopFactorId: null,
    version: null,
  };
  const [state, action, pending] = useActionState(
    createPlatformFinanceStopFactorAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form action={action} className="mt-3 space-y-3" aria-busy={pending}>
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="payment_obligation_id" value={obligationId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value="0" />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <label>
          <span className={fieldLabelCls}>Что блокируем</span>
          <select
            name="blocked_action"
            required
            defaultValue="application_submission"
            className={inputCls}
          >
            {financeBlockedActionOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={fieldLabelCls}>Следующий шаг</span>
          <input name="next_action" required minLength={3} maxLength={1000} className={inputCls} />
        </label>
        <label>
          <span className={fieldLabelCls}>Причина</span>
          <input name="reason" required minLength={3} maxLength={1000} className={inputCls} />
        </label>
        <label>
          <span className={fieldLabelCls}>Ссылка на подтверждение</span>
          <input name="evidence_ref" required maxLength={512} className={inputCls} />
        </label>
        <button type="submit" className={btnGhostCls} disabled={locked}>
          {pending ? "Сохраняем…" : "Поставить стоп"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

function FinanceStopResolveForm({
  workspace,
  stopFactorId,
  version,
}: Readonly<{
  workspace: ProfileAdmissionsWorkspace;
  stopFactorId: string;
  version: string;
}>) {
  const initialState: PlatformFinanceStopFactorActionState = {
    status: "idle",
    requestId: workspace.requestIds.resolveStops[stopFactorId],
    stopFactorId,
    version,
  };
  const [state, action, pending] = useActionState(
    resolvePlatformFinanceStopFactorAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form action={action} className="mt-2 space-y-3" aria-busy={pending}>
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="stop_factor_id" value={stopFactorId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value={state.version ?? version} />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <label>
          <span className={fieldLabelCls}>Причина снятия</span>
          <input name="reason" required minLength={3} maxLength={1000} className={inputCls} />
        </label>
        <label>
          <span className={fieldLabelCls}>Ссылка на подтверждение</span>
          <input name="evidence_ref" required maxLength={512} className={inputCls} />
        </label>
        <button type="submit" className={btnGhostCls} disabled={locked}>
          {pending ? "Сохраняем…" : "Снять стоп"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

export function ProfileAdmissionsWorkspacePanel({
  actor,
  workspace,
  partnerDetails = [],
  preparations,
}: Readonly<{
  actor: ActivePlatformActor;
  workspace: ProfileAdmissionsWorkspace | null;
  /** «Партнёр и решение» facts, keyed by application — editable since unified workflow S7 (plan §8/§11). */
  partnerDetails?: readonly ApplicationPartnerDetails[];
  preparations?: StaffPreparationRead<readonly CatalogPreparation[]>;
}>) {
  if (!workspace) return null;
  const canWrite = workspace.caseState === "active" && !isStaffPreview(actor);
  const canWriteApplications = canWrite && staffHasPermission(actor, "application.manage");
  const saved = preparations?.status === "ready" ? preparations.value : [];
  const scope = { organizationId: actor.organizationId, membershipId: actor.membershipId, studentCaseId: workspace.studentCaseId };
  const canReadRequirements = !isStaffPreview(actor) && staffHasPermission(actor, "document.read.full");
  const canInitializeRequirements = canWrite && staffHasPermission(actor, "document.manage");
  const canReviewDocuments = canWrite && staffHasPermission(actor, "document.review");

  return (
    <div className="flex flex-col gap-4" data-testid="v3-profile-admissions-workspace">
      <Card eyebrow id="applications" title="Заявки">
        {preparations && preparations.status !== "ready" ? <p role="status" className="px-4 py-3 text-sm text-fg-2">{preparations.status === "forbidden" ? "Нет доступа к сохранённым подготовкам в текущем режиме." : "Не удалось прочитать сохранённые подготовки. Обновите страницу; существующие заявки сохранены."}</p> : null}
        {workspace.applications.length === 0 && saved.length === 0 ? (
          <p className="px-4 py-3 text-sm text-fg-3">Заявок пока нет.</p>
        ) : (
          <div className="divide-y divide-border">
            {workspace.applications.map((application) => {
              const preparation = saved.find((item) => item.applicationId === application.universityApplicationId);
              const selectedProgram = preparation?.content.programs.find((item) => item.id === preparation.programId);
              return (
              <article
                key={application.universityApplicationId}
                className="px-4 py-3"
                data-testid="v3-profile-application"
                data-primary={application.isPrimary ? "true" : "false"}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-fg">{preparation?.content.name ?? application.institutionName}</p>
                    {selectedProgram?.title || application.programName ? <p className="mt-0.5 break-words text-sm text-fg-3">{selectedProgram?.title ?? application.programName}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={application.isPrimary ? "info" : "neutral"}>
                      {application.isPrimary ? "Основной вариант" : "Обычный вариант"}
                    </Pill>
                    <Pill tone={statusTone(preparation?.applicationStatus ?? application.status)}>
                      {applicationStatus(preparation?.applicationStatus ?? application.status) ?? "—"}
                    </Pill>
                  </div>
                </div>
                {!preparation ? <p className="mt-2 text-xs text-fg-3">
                  Дедлайн от университета:{" "}
                  {application.universityDeadlineOn ? (
                    <time dateTime={application.universityDeadlineOn}>
                      {allDayDate(application.universityDeadlineOn) ?? "не указан"}
                    </time>
                  ) : "не указан"}
                </p> : null}
                <ApplicationGeographySummary
                  countryCode={application.country}
                  degreeKey={application.degree}
                />
                {application.latestEvidenceReference ? (
                  <p className="mt-2 break-all text-xs text-fg-3">
                    {application.latestEvidenceReference}
                  </p>
                ) : null}
                {application.createdByDisplayName ? (
                  <p className="mt-2 text-xs text-fg-3">
                    Добавил: {application.createdByDisplayName}
                  </p>
                ) : null}
                <ApplicationPartnerFacts
                  key={`partner-${application.universityApplicationId}-${
                    partnerDetails.find((item) => item.applicationId === application.universityApplicationId)?.version
                      ?? application.version
                  }`}
                  workspace={workspace}
                  application={application}
                  details={partnerDetails.find((item) => item.applicationId === application.universityApplicationId)}
                  canWrite={canWriteApplications}
                />
                {canWriteApplications ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-accent">
                      Изменить параметры заявки
                    </summary>
                    <ApplicationDetailsForm
                      key={`details-${application.universityApplicationId}-${application.version}`}
                      workspace={workspace}
                      application={application}
                    />
                  </details>
                ) : null}
                {canWriteApplications ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-accent">
                      Отметить статус
                    </summary>
                    <ApplicationStatusForm
                      key={`status-${application.universityApplicationId}-${application.version}`}
                      workspace={workspace}
                      application={application}
                    />
                  </details>
                ) : null}
                {preparation ? <StaffPreparationPanel
                  key={`${scope.organizationId}:${scope.membershipId}:${preparation.applicationId}`}
                  preparation={preparation}
                  scope={scope}
                  canRead={canReadRequirements}
                  canReview={canReviewDocuments}
                  canInitialize={canInitializeRequirements && preparation.applicationStatus === "preparation"}
                /> : null}
              </article>
            ); })}
            {saved.filter((preparation) => !workspace.applications.some((application) => application.universityApplicationId === preparation.applicationId)).map((preparation) => <article key={preparation.applicationId} className="px-4 py-3" data-testid="v3-profile-application">
              <p className="break-words font-medium text-fg">{preparation.content.name}</p>
              <p className="mt-1 break-words text-sm text-fg-3">{preparation.content.programs.find((program) => program.id === preparation.programId)?.title}</p>
              <p className="mt-1 text-sm text-fg-2">{applicationStatus(preparation.applicationStatus)}</p>
              <StaffPreparationPanel key={`${scope.organizationId}:${scope.membershipId}:${preparation.applicationId}`} preparation={preparation} scope={scope} canRead={canReadRequirements} canReview={canReviewDocuments} canInitialize={canInitializeRequirements && preparation.applicationStatus === "preparation"} />
            </article>)}
          </div>
        )}
        {canWriteApplications ? (
          <div className="border-t border-border px-4 py-3">
            <ApplicationCreateDialog workspace={workspace} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export function ProfileFinanceControls({
  actor,
  workspace,
}: Readonly<{
  actor: ActivePlatformActor;
  workspace: ProfileAdmissionsWorkspace | null;
}>) {
  if (!workspace?.finance) return null;
  const canCreate = workspace.caseState === "active" && !isStaffPreview(actor) && staffHasPermission(actor, "finance.stop.create");
  const canRelease = workspace.caseState === "active" && !isStaffPreview(actor) && staffHasPermission(actor, "finance.stop.manage");

  return (
    <Card eyebrow title="Управление стопами">
      {workspace.finance.obligations.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-3">
          Финансовых обязательств нет — ставить стоп не на что.
        </p>
      ) : (
        <div className="divide-y divide-border" data-testid="v3-profile-finance-controls">
          {workspace.finance.obligations.map((obligation) => (
            <article key={obligation.paymentObligationId} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{obligation.label}</p>
                  <p className="mt-0.5 text-xs text-fg-3">{obligation.nextAction}</p>
                </div>
                {obligation.activeStopFactors.length > 0 ? (
                  <Pill tone="danger">стоп активен</Pill>
                ) : (
                  <Pill>без стопа</Pill>
                )}
              </div>

              {obligation.activeStopFactors.map((stop) => (
                <div key={stop.stopFactorId} className="v3-edge-danger mt-3 border-s-2 pl-3">
                  <p className="text-sm text-fg">{stop.reason}</p>
                  <p className="mt-0.5 text-xs text-fg-3">
                    {financeBlockedAction(stop.blockedAction) ?? "—"} · следующий шаг: {stop.nextAction}
                  </p>
                  {canRelease ? (
                    <FinanceStopResolveForm
                      workspace={workspace}
                      stopFactorId={stop.stopFactorId}
                      version={stop.version}
                    />
                  ) : null}
                </div>
              ))}

              {canCreate && obligation.status !== "paid" ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-danger">
                    Поставить финансовый стоп
                  </summary>
                  <FinanceStopCreateForm
                    workspace={workspace}
                    obligationId={obligation.paymentObligationId}
                  />
                </details>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}
