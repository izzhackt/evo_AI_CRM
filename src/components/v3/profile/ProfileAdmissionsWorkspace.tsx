"use client";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";


import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Pill, type PillTone } from "@/components/v3/Pill";
import { btnCls, btnGhostCls, Card, cn, inputCls, labelCls } from "@/components/ui";
import {
  createPlatformUniversityApplicationAction,
  updatePlatformUniversityApplicationDetailsAction,
  type PlatformUniversityApplicationActionState,
} from "@/lib/platform-admissions-actions";
import {
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

import { ApplicationUniversitySelector } from "./ApplicationUniversitySelector";
import type { ApplicationPartnerDetails, ProfileAdmissionsWorkspace } from "./types";

type ActionStatus =
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

function useCanonicalRefresh(status: ActionStatus): void {
  const router = useRouter();
  useEffect(() => {
    if (status === "saved" || status === "stale") router.refresh();
  }, [router, status]);
}

function PrimaryApplicationField({
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

function ApplicationCountryField({
  defaultValue = "",
}: Readonly<{ defaultValue?: string }>) {
  const options = platformApplicationCountryEditOptions(defaultValue || null);
  return (
    <label>
      <span className={labelCls}>Страна</span>
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

function ApplicationDegreeField({
  defaultValue = "",
}: Readonly<{ defaultValue?: string }>) {
  const options = platformApplicationDegreeEditOptions(defaultValue || null);
  return (
    <label>
      <span className={labelCls}>Ступень</span>
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

function StateBanner({ status }: Readonly<{ status: ActionStatus }>) {
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

function ApplicationCreateForm({ workspace }: Readonly<{ workspace: ProfileAdmissionsWorkspace }>) {
  const initialState: PlatformUniversityApplicationActionState = {
    status: "idle",
    requestId: workspace.requestIds.createApplication,
    universityApplicationId: null,
    version: null,
  };
  const [state, action, pending] = useActionState(
    createPlatformUniversityApplicationAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form action={action} className="mt-3 space-y-3" aria-busy={pending} data-testid="v3-application-create">
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value="0" />
      {/* Unified workflow S4 (plan §11): no submission-status editing UI —
          a newly added university/program is simply "being considered", not
          submitted anywhere. The status column stays a required DB field, so
          a fixed default is still submitted, just never as a visible picker. */}
      <input type="hidden" name="status" value="preparation" />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <ApplicationUniversitySelector key={workspace.studentCaseId} />
        <label>
          <span className={labelCls}>Программа</span>
          <input name="program_name" required maxLength={300} className={inputCls} />
        </label>
        <PrimaryApplicationField defaultChecked={false} />
        <label>
          <span className={labelCls}>Дедлайн от университета</span>
          <input name="university_deadline_on" type="date" className={inputCls} />
        </label>
        <ApplicationCountryField />
        <ApplicationDegreeField />
        <label>
          <span className={labelCls}>Ссылка на подтверждение</span>
          <input name="evidence_reference" maxLength={1000} className={inputCls} />
        </label>
        <label className="md:col-span-2">
          <span className={labelCls}>Заметка</span>
          <textarea name="note" rows={2} maxLength={1000} className={inputCls} />
        </label>
        <button type="submit" className={btnCls} disabled={locked}>
          {pending ? "Сохраняем…" : "Добавить заявку"}
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
          <span className={labelCls}>Дедлайн от университета</span>
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
 * Партнёр и решение — read-only (unified workflow S4, plan §11). Facts a
 * curator recorded through the retired playbook editor stay visible next to
 * the application they belong to; there is no edit control here (see
 * `readApplicationPartnerDetails` in `src/lib/v3/admissions-source.ts` for
 * why). Renders nothing when every field is empty — a quiet card, not a
 * permanent "nothing here" placeholder.
 */
function ApplicationPartnerFacts({ details }: Readonly<{ details: ApplicationPartnerDetails | undefined }>) {
  if (!details) return null;
  const partner = [
    { label: "Контакт партнёра", value: details.partnerContact },
    { label: "Ссылка на переданный пакет", value: details.packageReference },
  ].filter((fact) => fact.value);
  const decision = [
    { label: "Номер / ссылка решения", value: details.decisionReference },
    { label: "Условия предложения", value: details.offerConditions },
  ].filter((fact) => fact.value);
  if (partner.length === 0 && decision.length === 0) return null;
  return (
    <div className="mt-3 space-y-3">
      {partner.length > 0 ? (
        <div className="rounded-nav border border-border p-3">
          <h4 className="text-sm font-medium text-fg">Партнёр и ссылки</h4>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            {partner.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-xs text-fg-3">{fact.label}</dt>
                <dd className="mt-0.5 break-words text-sm text-fg">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {decision.length > 0 ? (
        <div className="rounded-nav border border-border p-3">
          <h4 className="text-sm font-medium text-fg">Решение университета</h4>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            {decision.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-xs text-fg-3">{fact.label}</dt>
                <dd className="mt-0.5 break-words text-sm text-fg">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
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
          <span className={labelCls}>Что блокируем</span>
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
          <span className={labelCls}>Следующий шаг</span>
          <input name="next_action" required minLength={3} maxLength={1000} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Причина</span>
          <input name="reason" required minLength={3} maxLength={1000} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Ссылка на подтверждение</span>
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
          <span className={labelCls}>Причина снятия</span>
          <input name="reason" required minLength={3} maxLength={1000} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Ссылка на подтверждение</span>
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
}: Readonly<{
  actor: ActivePlatformActor;
  workspace: ProfileAdmissionsWorkspace | null;
  /** Read-only «Партнёр и ссылки» / «Решение университета» facts, keyed by application (unified workflow S4). */
  partnerDetails?: readonly ApplicationPartnerDetails[];
}>) {
  if (!workspace) return null;
  const canWrite = workspace.caseState === "active" && !isStaffPreview(actor);
  const canWriteApplications = canWrite && staffHasPermission(actor, "application.manage");

  return (
    <div className="flex flex-col gap-4" data-testid="v3-profile-admissions-workspace">
      <Card eyebrow id="applications" title="Заявки">
        {workspace.applications.length === 0 ? (
          <p className="px-4 py-3 text-sm text-fg-3">Заявок пока нет.</p>
        ) : (
          <div className="divide-y divide-border">
            {workspace.applications.map((application) => (
              <article
                key={application.universityApplicationId}
                className="px-4 py-3"
                data-testid="v3-profile-application"
                data-primary={application.isPrimary ? "true" : "false"}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{application.institutionName}</p>
                    <p className="mt-0.5 text-sm text-fg-3">{application.programName}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={application.isPrimary ? "info" : "neutral"}>
                      {application.isPrimary ? "Основной вариант" : "Обычный вариант"}
                    </Pill>
                    <Pill tone={statusTone(application.status)}>
                      {applicationStatus(application.status) ?? "—"}
                    </Pill>
                  </div>
                </div>
                <p className="mt-2 text-xs text-fg-3">
                  Дедлайн от университета:{" "}
                  {application.universityDeadlineOn ? (
                    <time dateTime={application.universityDeadlineOn}>
                      {allDayDate(application.universityDeadlineOn) ?? "не указан"}
                    </time>
                  ) : "не указан"}
                </p>
                <ApplicationGeographySummary
                  countryCode={application.country}
                  degreeKey={application.degree}
                />
                {application.latestEvidenceReference ? (
                  <p className="mt-2 break-all text-xs text-fg-3">
                    {application.latestEvidenceReference}
                  </p>
                ) : null}
                <ApplicationPartnerFacts
                  details={partnerDetails.find((item) => item.applicationId === application.universityApplicationId)}
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
              </article>
            ))}
          </div>
        )}
        {canWriteApplications ? (
          <details className="border-t border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-accent">
              Новая заявка
            </summary>
            <ApplicationCreateForm workspace={workspace} />
          </details>
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
