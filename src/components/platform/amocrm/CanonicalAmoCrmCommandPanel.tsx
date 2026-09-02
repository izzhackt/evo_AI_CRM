"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { btnCls, btnGhostCls, Card, cn } from "@/components/ui";
import { resolveCanonicalAmoCrmCommandPanelState } from "@/lib/canonical-amocrm-command-panel-state";
import type { Locale } from "@/lib/i18n";
import {
  reconcileCanonicalAmoCrmCommandAction,
  releaseCanonicalAmoCrmPreparedCommandAction,
  syncCanonicalAmoCrmAdmissionsAction,
  syncCanonicalAmoCrmSalesAction,
  type CanonicalAmoCrmCommandActionState,
  type CanonicalAmoCrmCommandAvailability,
} from "@/lib/server/canonical-amocrm-command-actions";

type Scope = "sales" | "admissions";
type TerminalStatus = Exclude<
  CanonicalAmoCrmCommandActionState["status"],
  "idle"
>;

const COPY = {
  ru: {
    title: {
      sales: "Синхронизация Sales с amoCRM",
      admissions: "Синхронизация Admissions с amoCRM",
    },
    description:
      "PostgreSQL EVO остаётся источником истины. Команда явно обновляет связанную карточку amoCRM и сохраняет результат каждого шага.",
    providerReady: "Канонический V2-провайдер готов",
    providerBlocked: "Команда недоступна: V2-провайдер не готов",
    noteLabel: "Проверенная сотрудником заметка",
    notePlaceholder: "Кратко укажите, что именно проверено перед синхронизацией.",
    noteHint: "Обязательное поле, не более 1000 байт.",
    taskLabel: "Задача для менеджера в amoCRM",
    taskPlaceholder:
      "Опишите следующее действие, которое менеджер должен выполнить.",
    taskHint: "Обязательное поле, не более 1000 байт.",
    taskDeadlineLabel: "Срок задачи",
    taskDeadlineHint:
      "Укажите точную дату и время. Без срока EVO не отправляет задачу в amoCRM.",
    submit: "Синхронизировать с amoCRM",
    submitting: "Синхронизация…",
    reconcile: "Проверить неизвестный результат",
    reconciling: "Проверка…",
    releasePrepared: "Снять неотправленную команду",
    releasingPrepared: "Снятие…",
    releasedBeforeDispatch:
      "Команда снята до отправки. amoCRM не вызывался; можно создать новую команду.",
    attempt: "ID последней попытки",
    steps: "Шаги команды",
    statuses: {
      accepted: "amoCRM подтвердил результат.",
      rejected: "amoCRM отклонил команду. Успех не записан.",
      unknown:
        "Результат неизвестен. Повторная запись заблокирована до безопасной проверки.",
      blocked: "Команда заблокирована серверной проверкой.",
      error: "Команда не выполнена из-за внутренней ошибки.",
      request_conflict:
        "Этот request ID уже использован с другими данными. Запись не повторена.",
    },
    blockedReasons: {
      feature_disabled: "Функция отключена в приватном V2-контуре.",
      provider_not_authorized: "Серверное разрешение провайдера не включено.",
      configuration_missing: "Не заполнена обязательная V2-конфигурация.",
      configuration_invalid: "V2-конфигурация некорректна.",
      routing_configuration_invalid: "Не настроен точный маршрут amoCRM.",
      token_unavailable: "Закрытый OAuth-токен недоступен серверу.",
    },
  },
  ky: {
    title: {
      sales: "Sales маалыматтарын amoCRM менен шайкештөө",
      admissions: "Admissions маалыматтарын amoCRM менен шайкештөө",
    },
    description:
      "EVO PostgreSQL чындыктын жалгыз булагы бойдон калат. Команда байланышкан amoCRM карточкасын гана жаңыртып, ар бир кадамдын жыйынтыгын сактайт.",
    providerReady: "Каноникалык V2 провайдери даяр",
    providerBlocked: "Команда жеткиликсиз: V2 провайдери даяр эмес",
    noteLabel: "Кызматкер текшерген эскертүү",
    notePlaceholder: "Шайкештөөдөн мурда эмнени текшергениңизди кыска жазыңыз.",
    noteHint: "Милдеттүү талаа, 1000 байттан ашпайт.",
    taskLabel: "amoCRMдеги менеджердин тапшырмасы",
    taskPlaceholder:
      "Менеджер кийинки кайсы аракетти жасашы керек экенин жазыңыз.",
    taskHint: "Милдеттүү талаа, 1000 байттан ашпайт.",
    taskDeadlineLabel: "Тапшырманын мөөнөтү",
    taskDeadlineHint:
      "Так күндү жана убакытты көрсөтүңүз. Мөөнөтсүз EVO amoCRMге тапшырма жөнөтпөйт.",
    submit: "amoCRM менен шайкештөө",
    submitting: "Шайкештөө…",
    reconcile: "Белгисиз жыйынтыкты текшерүү",
    reconciling: "Текшерилүүдө…",
    releasePrepared: "Жөнөтүлбөгөн команданы алып салуу",
    releasingPrepared: "Алынып салынууда…",
    releasedBeforeDispatch:
      "Команда жөнөтүлгөнгө чейин алынды. amoCRM чакырылган жок; жаңы команда түзсө болот.",
    attempt: "Акыркы аракеттин ID'си",
    steps: "Команданын кадамдары",
    statuses: {
      accepted: "amoCRM жыйынтыкты тастыктады.",
      rejected: "amoCRM команданы четке какты. Ийгилик жазылган жок.",
      unknown:
        "Жыйынтык белгисиз. Коопсуз текшерүүгө чейин кайра жазуу бөгөттөлдү.",
      blocked: "Команда сервердик текшерүү менен бөгөттөлдү.",
      error: "Ички катадан улам команда аткарылган жок.",
      request_conflict:
        "Бул request ID башка маалымат менен колдонулган. Жазуу кайталанган жок.",
    },
    blockedReasons: {
      feature_disabled: "Функция жеке V2 контурунда өчүрүлгөн.",
      provider_not_authorized: "Провайдердин сервердик уруксаты күйгүзүлгөн эмес.",
      configuration_missing: "Милдеттүү V2 конфигурациясы толтурулган эмес.",
      configuration_invalid: "V2 конфигурациясы туура эмес.",
      routing_configuration_invalid: "Так amoCRM маршруту коюлган эмес.",
      token_unavailable: "Жабык OAuth токени серверге жеткиликсиз.",
    },
  },
  en: {
    title: {
      sales: "Sync Sales with amoCRM",
      admissions: "Sync Admissions with amoCRM",
    },
    description:
      "EVO PostgreSQL remains the sole source of truth. This command explicitly updates the bound amoCRM record and preserves every step result.",
    providerReady: "Canonical V2 provider is ready",
    providerBlocked: "Command unavailable: V2 provider is not ready",
    noteLabel: "Staff-reviewed note",
    notePlaceholder: "Briefly state what was verified before this sync.",
    noteHint: "Required; maximum 1000 bytes.",
    taskLabel: "Manager task in amoCRM",
    taskPlaceholder: "Describe the next action the manager must complete.",
    taskHint: "Required; maximum 1000 bytes.",
    taskDeadlineLabel: "Task deadline",
    taskDeadlineHint:
      "Enter an exact date and time. EVO does not send an amoCRM task without a deadline.",
    submit: "Sync with amoCRM",
    submitting: "Syncing…",
    reconcile: "Check unknown result",
    reconciling: "Checking…",
    releasePrepared: "Release unsent command",
    releasingPrepared: "Releasing…",
    releasedBeforeDispatch:
      "The command was released before dispatch. amoCRM was not called; a new command can now be created.",
    attempt: "Latest attempt ID",
    steps: "Command steps",
    statuses: {
      accepted: "amoCRM confirmed the result.",
      rejected: "amoCRM rejected the command. No success was recorded.",
      unknown:
        "The result is unknown. Another write is blocked until a safe check completes.",
      blocked: "The command was blocked by a server-side check.",
      error: "The command did not run because of an internal error.",
      request_conflict:
        "This request ID was already used with different data. Nothing was repeated.",
    },
    blockedReasons: {
      feature_disabled: "The capability is disabled in the private V2 contour.",
      provider_not_authorized: "Server-side provider authorization is disabled.",
      configuration_missing: "Required V2 configuration is missing.",
      configuration_invalid: "The V2 configuration is invalid.",
      routing_configuration_invalid: "Exact amoCRM routing is not configured.",
      token_unavailable: "The private OAuth token is unavailable to the server.",
    },
  },
} as const;

const OPERATION_LABELS = {
  contact_create: "Contact · create",
  contact_update: "Contact · update",
  lead_create: "Lead · create",
  lead_update: "Lead · update",
  contact_lead_link: "Contact ↔ lead",
  lead_pipeline_status_update: "Pipeline / status",
  lead_responsible_update: "Responsible user",
  lead_note_create: "Human note",
  lead_task_create: "Manager task",
  lead_tag_update: "Exact tags",
} as const;

export type CanonicalAmoCrmBlockingAttempt = Readonly<{
  attemptId: string;
  operationName: keyof typeof OPERATION_LABELS;
  status: "prepared" | "unknown";
  providerDispatchedAt: string | null;
}>;

const INITIAL_STATE: CanonicalAmoCrmCommandActionState = Object.freeze({
  status: "idle",
  reason: "idle",
  attemptId: null,
  steps: Object.freeze([]),
});

function unixFromDateTimeLocal(value: string): string {
  if (value.trim().length === 0) return "";
  const parsed = new Date(value);
  const unix = Math.floor(parsed.getTime() / 1_000);
  if (!Number.isFinite(unix) || unix <= 0) return "";
  return String(unix);
}

function stateTone(status: CanonicalAmoCrmCommandActionState["status"]): string {
  if (status === "accepted") return "border-ok/30 bg-ok-weak text-ok";
  if (status === "unknown" || status === "blocked") {
    return "border-warn/30 bg-warn-weak text-warn";
  }
  return "border-danger/30 bg-danger-weak text-danger";
}

function ResultState({
  state,
  locale,
}: Readonly<{
  state: CanonicalAmoCrmCommandActionState;
  locale: Locale;
}>) {
  if (state.status === "idle") return null;
  const copy = COPY[locale];
  return (
    <div
      role="status"
      className={cn("space-y-3 rounded-card border p-3", stateTone(state.status))}
      data-testid="canonical-amocrm-command-state"
      data-status={state.status}
    >
      <p className="text-sm font-medium">
        {state.reason === "operator_released_before_dispatch"
          ? copy.releasedBeforeDispatch
          : copy.statuses[state.status as TerminalStatus]}
      </p>
      {state.steps.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.04em]">
            {copy.steps}
          </p>
          <ol className="mt-2 space-y-1.5">
            {state.steps.map((step, index) => (
              <li
                key={`${step.operationName}-${index}`}
                className="flex items-center justify-between gap-3 rounded-ctl bg-surface/70 px-2.5 py-2 text-xs text-fg-2"
                data-testid="canonical-amocrm-command-step"
                data-operation={step.operationName}
                data-status={step.status}
              >
                <span>
                  {OPERATION_LABELS[
                    step.operationName as keyof typeof OPERATION_LABELS
                  ] ?? "amoCRM operation"}
                </span>
                <span className="font-semibold">{step.status}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {state.attemptId ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.04em]">
            {copy.attempt}
          </p>
          <code
            className="mt-1 block break-all text-xs text-fg-2"
            data-testid="canonical-amocrm-terminal-attempt-id"
          >
            {state.attemptId}
          </code>
        </div>
      ) : null}
    </div>
  );
}

export function CanonicalAmoCrmCommandPanel({
  availability,
  blockingAttempt = null,
  leadId,
  locale,
  requestId,
  scope,
  studentCaseId = null,
}: Readonly<{
  availability: CanonicalAmoCrmCommandAvailability;
  blockingAttempt?: CanonicalAmoCrmBlockingAttempt | null;
  leadId: string;
  locale: Locale;
  requestId: string;
  scope: Scope;
  studentCaseId?: string | null;
}>) {
  const copy = COPY[locale];
  const router = useRouter();
  const [taskDeadlineLocal, setTaskDeadlineLocal] = useState("");
  const ready = availability.status === "ready";
  const syncAction =
    scope === "sales"
      ? syncCanonicalAmoCrmSalesAction
      : syncCanonicalAmoCrmAdmissionsAction;
  const [syncState, formAction, syncing] = useActionState(
    syncAction,
    INITIAL_STATE,
  );
  const [reconcileState, reconcileAction, reconciling] = useActionState(
    reconcileCanonicalAmoCrmCommandAction,
    INITIAL_STATE,
  );
  const [releaseState, releaseAction, releasing] = useActionState(
    releaseCanonicalAmoCrmPreparedCommandAction,
    INITIAL_STATE,
  );
  const preparedBlockingAttempt =
    blockingAttempt?.status === "prepared" &&
    blockingAttempt.providerDispatchedAt === null
      ? blockingAttempt
      : null;
  const persistedBlockingState: CanonicalAmoCrmCommandActionState =
    blockingAttempt === null
      ? INITIAL_STATE
      : Object.freeze({
          status:
            blockingAttempt.status === "unknown" ||
            blockingAttempt.providerDispatchedAt !== null
              ? "unknown"
              : "blocked",
          reason:
            blockingAttempt.status === "unknown"
              ? "stored_unknown"
              : blockingAttempt.providerDispatchedAt !== null
                ? "dispatch_outcome_unresolved"
                : "dispatch_not_started",
          attemptId: blockingAttempt.attemptId,
          steps: Object.freeze([
            Object.freeze({
              operationName: blockingAttempt.operationName,
              status:
                blockingAttempt.status === "unknown" ||
                blockingAttempt.providerDispatchedAt !== null
                  ? "unknown"
                  : "blocked",
              reason:
                blockingAttempt.status === "unknown"
                  ? "stored_unknown"
                  : blockingAttempt.providerDispatchedAt !== null
                    ? "dispatch_outcome_unresolved"
                    : "dispatch_not_started",
              attemptId: blockingAttempt.attemptId,
            }),
          ]),
        });
  const panelState = resolveCanonicalAmoCrmCommandPanelState({
    blockingAttemptId: blockingAttempt?.attemptId ?? null,
    persistedBlockingStatus: persistedBlockingState.status,
    reconcileState,
    syncState,
  });
  const displayedSyncState = panelState.showSyncState
    ? syncState.status === "idle"
      ? panelState.showPersistedBlockingState
        ? persistedBlockingState
        : INITIAL_STATE
      : syncState
    : INITIAL_STATE;
  const activeUnknownState =
    panelState.activeUnknownSource === "reconcile"
      ? reconcileState
      : panelState.activeUnknownSource === "sync"
        ? syncState
        : panelState.activeUnknownSource === "persisted"
          ? persistedBlockingState
          : null;
  const flowBlocked = panelState.flowBlocked;

  useEffect(() => {
    if (
      syncState.status !== "idle" ||
      reconcileState.status !== "idle" ||
      releaseState.status !== "idle"
    ) {
      router.refresh();
    }
  }, [reconcileState.status, releaseState.status, router, syncState.status]);

  return (
    <Card
      title={copy.title[scope]}
      className="shadow-none"
    >
      <div
        className="space-y-4"
        data-testid="canonical-amocrm-command-panel"
        data-scope={scope}
      >
        <p className="max-w-[56ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
        <div
          className={cn(
            "border-l px-3 py-2 text-xs font-medium",
            ready
              ? "border-ok/30 bg-ok-weak text-ok"
              : "border-warn/30 bg-warn-weak text-warn",
          )}
          data-testid="canonical-amocrm-provider-availability"
          data-status={availability.status}
        >
          <p>{ready ? copy.providerReady : copy.providerBlocked}</p>
          {availability.status === "blocked" ? (
            <p className="mt-1 font-normal">
              {copy.blockedReasons[availability.reason]}
            </p>
          ) : null}
        </div>

        <form
          action={formAction}
          className="space-y-3"
          data-testid="canonical-amocrm-sync-form"
        >
          {scope === "sales" ? (
            <input type="hidden" name="lead_id" value={leadId} />
          ) : (
            <input
              type="hidden"
              name="student_case_id"
              value={studentCaseId ?? ""}
            />
          )}
          <input type="hidden" name="request_id" value={requestId} />
          <label className="block">
            <span className="text-xs font-medium text-fg-2">
              {copy.noteLabel}
            </span>
            <textarea
              name="note_text"
              rows={3}
              maxLength={1000}
              required
              disabled={!ready || syncing || flowBlocked}
              placeholder={copy.notePlaceholder}
              className="mt-1.5 min-h-24 w-full resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2.5 text-base text-fg placeholder:text-fg-3 focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="canonical-amocrm-note-text"
            />
            <span className="mt-1 block text-xs text-fg-3">
              {copy.noteHint}
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-fg-2">
              {copy.taskLabel}
            </span>
            <textarea
              name="task_text"
              rows={3}
              maxLength={1000}
              required
              disabled={!ready || syncing || flowBlocked}
              placeholder={copy.taskPlaceholder}
              className="mt-1.5 min-h-24 w-full resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2.5 text-base text-fg placeholder:text-fg-3 focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="canonical-amocrm-task-text"
            />
            <span className="mt-1 block text-xs text-fg-3">
              {copy.taskHint}
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-fg-2">
              {copy.taskDeadlineLabel}
            </span>
            <input
              type="datetime-local"
              value={taskDeadlineLocal}
              required
              disabled={!ready || syncing || flowBlocked}
              onChange={(event) => setTaskDeadlineLocal(event.currentTarget.value)}
              className="mt-1.5 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2.5 text-base text-fg focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="canonical-amocrm-task-deadline"
            />
            <input
              type="hidden"
              name="task_complete_till"
              value={unixFromDateTimeLocal(taskDeadlineLocal)}
            />
            <span className="mt-1 block text-xs text-fg-3">
              {copy.taskDeadlineHint}
            </span>
          </label>
          <button
            type="submit"
            className={btnCls}
            disabled={!ready || syncing || flowBlocked}
            data-testid="canonical-amocrm-sync"
          >
            {syncing ? copy.submitting : copy.submit}
          </button>
        </form>

        <ResultState state={displayedSyncState} locale={locale} />

        {preparedBlockingAttempt ? (
          <form action={releaseAction}>
            <input
              type="hidden"
              name="workflow_scope"
              value={
                scope === "sales"
                  ? "sales_pre_handoff"
                  : "admissions_post_handoff"
              }
            />
            <input type="hidden" name="lead_id" value={leadId} />
            <input
              type="hidden"
              name="student_case_id"
              value={scope === "admissions" ? studentCaseId ?? "" : ""}
            />
            <input
              type="hidden"
              name="attempt_id"
              value={preparedBlockingAttempt.attemptId}
            />
            <button
              type="submit"
              className={btnGhostCls}
              disabled={releasing}
              data-testid="canonical-amocrm-release-prepared"
            >
              {releasing ? copy.releasingPrepared : copy.releasePrepared}
            </button>
          </form>
        ) : null}

        <ResultState state={releaseState} locale={locale} />

        {activeUnknownState?.attemptId ? (
          <form action={reconcileAction}>
            <input
              type="hidden"
              name="workflow_scope"
              value={
                scope === "sales"
                  ? "sales_pre_handoff"
                  : "admissions_post_handoff"
              }
            />
            <input type="hidden" name="lead_id" value={leadId} />
            <input
              type="hidden"
              name="student_case_id"
              value={scope === "admissions" ? studentCaseId ?? "" : ""}
            />
            <input
              type="hidden"
              name="attempt_id"
              value={activeUnknownState.attemptId}
            />
            <button
              type="submit"
              className={btnGhostCls}
              disabled={!ready || reconciling}
              data-testid="canonical-amocrm-reconcile"
            >
              {reconciling ? copy.reconciling : copy.reconcile}
            </button>
          </form>
        ) : null}

        <ResultState state={reconcileState} locale={locale} />
      </div>
    </Card>
  );
}
