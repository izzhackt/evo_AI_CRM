"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Pill, type PillTone } from "@/components/v3/Pill";
import { btnCls, btnGhostCls, cn, inputCls, labelCls } from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import {
  changePlatformUniversityApplicationAction,
  createPlatformUniversityApplicationAction,
  type PlatformUniversityApplicationActionState,
} from "@/lib/platform-admissions-actions";
import {
  PLATFORM_APPLICATION_STATUSES,
  type PlatformApplicationQueueRow,
} from "@/lib/platform-application-contract";
import {
  createPlatformFinanceStopFactorAction,
  resolvePlatformFinanceStopFactorAction,
  upsertPlatformCaseVisaAction,
  type PlatformCaseVisaActionState,
  type PlatformFinanceStopFactorActionState,
} from "@/lib/platform-case-operations-actions";
import { PLATFORM_VISA_STATUSES } from "@/lib/platform-case-operations-contract";
import {
  applicationStatus,
  financeBlockedAction,
  financeBlockedActionOptions,
  visaStatus,
} from "@/lib/v3/wording";

import { Card } from "./Card";
import type { ProfileAdmissionsWorkspace } from "./types";

type ActionStatus =
  | PlatformUniversityApplicationActionState["status"]
  | PlatformCaseVisaActionState["status"]
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
    <form action={action} className="mt-3 space-y-3" aria-busy={pending}>
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="catalog_institution_id" value="" />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value="0" />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <label>
          <span className={labelCls}>Университет</span>
          <input name="institution_name" required maxLength={300} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Программа</span>
          <input name="program_name" required maxLength={300} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Статус</span>
          <select name="status" defaultValue="preparation" className={inputCls}>
            {PLATFORM_APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>{applicationStatus(status) ?? "—"}</option>
            ))}
          </select>
        </label>
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

function ApplicationEditForm({
  workspace,
  application,
}: Readonly<{
  workspace: ProfileAdmissionsWorkspace;
  application: PlatformApplicationQueueRow;
}>) {
  const initialState: PlatformUniversityApplicationActionState = {
    status: "idle",
    requestId: workspace.requestIds.applications[application.universityApplicationId],
    universityApplicationId: application.universityApplicationId,
    version: application.version,
  };
  const [state, action, pending] = useActionState(
    changePlatformUniversityApplicationAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form action={action} className="mt-3 space-y-3" aria-busy={pending}>
      <input type="hidden" name="application_id" value={application.universityApplicationId} />
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value={state.version ?? application.version} />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <label>
          <span className={labelCls}>Статус</span>
          <select name="status" defaultValue={application.status} className={inputCls}>
            {PLATFORM_APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>{applicationStatus(status) ?? "—"}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>Ссылка на подтверждение</span>
          <input
            name="evidence_reference"
            defaultValue={application.latestEvidenceReference ?? ""}
            maxLength={1000}
            className={inputCls}
          />
        </label>
        <label className="md:col-span-2">
          <span className={labelCls}>Заметка</span>
          <textarea name="note" rows={2} maxLength={1000} className={inputCls} />
        </label>
        <button type="submit" className={btnGhostCls} disabled={locked}>
          {pending ? "Сохраняем…" : "Сохранить статус"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

function VisaForm({ workspace }: Readonly<{ workspace: ProfileAdmissionsWorkspace }>) {
  const initialState: PlatformCaseVisaActionState = {
    status: "idle",
    requestId: workspace.requestIds.visa,
    visaCaseId: workspace.visa?.visaCaseId ?? null,
    version: workspace.visa?.version ?? null,
  };
  const [state, action, pending] = useActionState(upsertPlatformCaseVisaAction, initialState);
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form action={action} className="mt-3 space-y-3" aria-busy={pending}>
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="visa_case_id" value={workspace.visa?.visaCaseId ?? ""} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input
        type="hidden"
        name="expected_version"
        value={state.version ?? workspace.visa?.version ?? "0"}
      />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <label>
          <span className={labelCls}>Статус</span>
          <select
            name="status"
            defaultValue={workspace.visa?.status ?? "not_started"}
            className={inputCls}
          >
            {PLATFORM_VISA_STATUSES.map((status) => (
              <option key={status} value={status}>{visaStatus(status) ?? "—"}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>Ссылка на подтверждение</span>
          <input name="evidence_reference" required maxLength={2000} className={inputCls} />
        </label>
        <label className="md:col-span-2">
          <span className={labelCls}>Заметка</span>
          <textarea
            name="note"
            rows={2}
            defaultValue={workspace.visa?.note ?? ""}
            maxLength={4000}
            className={inputCls}
          />
        </label>
        <button type="submit" className={btnCls} disabled={locked}>
          {pending ? "Сохраняем…" : workspace.visa ? "Обновить визу" : "Создать визовое дело"}
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
  actorRole,
  workspace,
}: Readonly<{
  actorRole: FixedRole;
  workspace: ProfileAdmissionsWorkspace | null;
}>) {
  if (!workspace) return null;
  const canWrite = workspace.caseState === "active" && actorRole !== "sales";

  return (
    <div className="flex flex-col gap-4" data-testid="v3-profile-admissions-workspace">
      <Card id="applications" title="Заявки">
        {workspace.applications.length === 0 ? (
          <p className="px-4 py-3 text-sm text-fg-3">Заявок пока нет.</p>
        ) : (
          <div className="divide-y divide-border">
            {workspace.applications.map((application) => (
              <article key={application.universityApplicationId} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{application.institutionName}</p>
                    <p className="mt-0.5 text-sm text-fg-3">{application.programName}</p>
                  </div>
                  <Pill tone={statusTone(application.status)}>
                    {applicationStatus(application.status) ?? "—"}
                  </Pill>
                </div>
                {application.latestEvidenceReference ? (
                  <p className="mt-2 break-all text-xs text-fg-3">
                    {application.latestEvidenceReference}
                  </p>
                ) : null}
                {canWrite ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-accent">
                      Изменить статус
                    </summary>
                    <ApplicationEditForm workspace={workspace} application={application} />
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        )}
        {canWrite ? (
          <details className="border-t border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-accent">
              Новая заявка
            </summary>
            <ApplicationCreateForm workspace={workspace} />
          </details>
        ) : null}
      </Card>

      <Card
        id="visa"
        title="Виза"
        aside={workspace.visa ? (
          <Pill tone={statusTone(workspace.visa.status)}>
            {visaStatus(workspace.visa.status) ?? "—"}
          </Pill>
        ) : undefined}
      >
        {!workspace.visa ? (
          <p className="px-4 pt-3 text-sm text-fg-3">Визовое дело ещё не создано.</p>
        ) : null}
        {workspace.visa?.note ? (
          <p className="px-4 pt-3 text-sm text-fg-3">{workspace.visa.note}</p>
        ) : null}
        {canWrite ? <div className="px-4 py-3"><VisaForm workspace={workspace} /></div> : null}
      </Card>
    </div>
  );
}

export function ProfileFinanceControls({
  actorRole,
  workspace,
}: Readonly<{
  actorRole: FixedRole;
  workspace: ProfileAdmissionsWorkspace | null;
}>) {
  if (!workspace) return null;
  const canCreate = workspace.caseState === "active" && actorRole !== "sales";
  const canRelease = workspace.caseState === "active" && actorRole === "admin";

  return (
    <Card title="Управление стопами">
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
