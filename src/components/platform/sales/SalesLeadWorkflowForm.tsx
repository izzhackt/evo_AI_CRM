"use client";

import { useActionState, useState } from "react";

import {
  updatePlatformSalesLeadWorkflowAction,
  type PlatformSalesWorkflowActionState,
} from "@/lib/platform-sales-workflow-actions";
import {
  PLATFORM_SALES_STAGES,
  type PlatformSalesLeadWorkflow,
  type PlatformSalesOwnerOption,
  type PlatformSalesStage,
} from "@/lib/platform-sales-workflow-contract";

type Locale = "ru" | "en";

const STAGE_LABELS: Record<Locale, Record<PlatformSalesStage, string>> = {
  ru: {
    new: "Новый",
    contacting: "Связываемся",
    qualified: "Квалифицирован",
    meeting_scheduled: "Встреча назначена",
    meeting_completed: "Встреча проведена",
    potential: "Потенциальный клиент",
  },
  en: {
    new: "New",
    contacting: "Contacting",
    qualified: "Qualified",
    meeting_scheduled: "Meeting scheduled",
    meeting_completed: "Meeting completed",
    potential: "Potential",
  },
};

const COPY = {
  ru: {
    summary: "Изменить этап, владельца и следующий шаг",
    stage: "Этап квалификации",
    owner: "Ответственный Sales",
    unassigned: "Не назначен",
    unavailableOwner: "Текущий владелец недоступен",
    clear: "Следующее действие пока не запланировано",
    action: "Следующее действие",
    actionPlaceholder: "Например: позвонить и подтвердить встречу",
    due: "Срок",
    reason: "Причина изменения",
    reasonHint:
      "Обязательна при переназначении Admin и при удалении уже сохранённого действия.",
    save: "Сохранить подтверждённое состояние",
    saving: "Сохраняем…",
    saved: "Изменение сохранено атомарно и записано в аудит.",
    invalid: "Проверьте этап, владельца, действие, дату и причину.",
    forbidden: "Это изменение недоступно для вашей роли или этого лида.",
    stale: "Лид уже изменился в другой вкладке. Обновите страницу и повторите.",
    conflict: "Идентификатор запроса уже использован. Повторите отправку.",
    noChange: "Сохранённое состояние уже совпадает с формой.",
    unavailable: "Сохранение сейчас недоступно. Данные не считаются изменёнными.",
    reload: "Обновить страницу",
    version: "Версия",
  },
  en: {
    summary: "Change stage, owner and next action",
    stage: "Qualification stage",
    owner: "Responsible Sales owner",
    unassigned: "Unassigned",
    unavailableOwner: "Current owner is unavailable",
    clear: "No next action is scheduled",
    action: "Next action",
    actionPlaceholder: "For example: call and confirm the meeting",
    due: "Due date",
    reason: "Reason for change",
    reasonHint:
      "Required for Admin reassignment and removal of a saved next action.",
    save: "Save confirmed state",
    saving: "Saving…",
    saved: "The change was committed atomically and recorded in audit.",
    invalid: "Check the stage, owner, action, date and reason.",
    forbidden: "Your role cannot change this lead in that way.",
    stale: "This lead changed elsewhere. Refresh before trying again.",
    conflict: "The request identifier was already used. Submit again.",
    noChange: "The stored state already matches this form.",
    unavailable: "Saving is unavailable. The lead is not treated as changed.",
    reload: "Refresh page",
    version: "Version",
  },
} as const;

function stateMessage(
  locale: Locale,
  status: PlatformSalesWorkflowActionState["status"],
): string | null {
  const copy = COPY[locale];
  switch (status) {
    case "idle":
      return null;
    case "saved":
      return copy.saved;
    case "invalid":
      return copy.invalid;
    case "forbidden":
      return copy.forbidden;
    case "stale":
      return copy.stale;
    case "request_conflict":
      return copy.conflict;
    case "no_change":
      return copy.noChange;
    case "unavailable":
      return copy.unavailable;
  }
}

function SalesLeadWorkflowEditorFields({
  copy,
  lead,
  locale,
  ownerOptions,
  ownerOptionsUnavailable,
  pending,
}: Readonly<{
  copy: (typeof COPY)[Locale];
  lead: PlatformSalesLeadWorkflow;
  locale: Locale;
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsUnavailable: boolean;
  pending: boolean;
}>) {
  const [stage, setStage] = useState<PlatformSalesStage>(lead.stage);
  const [owner, setOwner] = useState(lead.currentOwnerMembershipId ?? "");
  const [clearNextAction, setClearNextAction] = useState(
    lead.nextActionText === null,
  );
  const [nextAction, setNextAction] = useState(lead.nextActionText ?? "");
  const [dueDate, setDueDate] = useState(lead.nextActionDueDate ?? "");
  const [reason, setReason] = useState("");
  const disabled = pending || ownerOptionsUnavailable;
  const currentOwnerMissing =
    lead.currentOwnerMembershipId !== null &&
    !ownerOptions.some(
      (option) => option.membershipId === lead.currentOwnerMembershipId,
    );

  return (
    <>
      <input
        type="hidden"
        name="clear_next_action"
        value={clearNextAction ? "true" : "false"}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium text-[var(--text)]">{copy.stage}</span>
          <select
            name="stage_key"
            value={stage}
            onChange={(event) => setStage(event.target.value as PlatformSalesStage)}
            disabled={disabled}
            className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            {PLATFORM_SALES_STAGES.map((value) => (
              <option key={value} value={value}>
                {STAGE_LABELS[locale][value]}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium text-[var(--text)]">{copy.owner}</span>
          <select
            name="owner_membership_id"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            disabled={disabled}
            className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <option value="">{copy.unassigned}</option>
            {currentOwnerMissing ? (
              <option value={lead.currentOwnerMembershipId ?? ""}>
                {lead.currentOwnerDisplayName ?? copy.unavailableOwner} ·{" "}
                {copy.unavailableOwner}
              </option>
            ) : null}
            {ownerOptions.map((option) => (
              <option key={option.membershipId} value={option.membershipId}>
                {option.displayLabel}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={clearNextAction}
          onChange={(event) => {
            setClearNextAction(event.target.checked);
            if (event.target.checked) {
              setNextAction("");
              setDueDate("");
            }
          }}
          disabled={disabled}
          className="mt-1"
        />
        <span>{copy.clear}</span>
      </label>

      {clearNextAction ? (
        <>
          <input type="hidden" name="next_action_text" value="" />
          <input type="hidden" name="next_action_due_date" value="" />
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-[var(--text)]">{copy.action}</span>
            <input
              name="next_action_text"
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              maxLength={500}
              required
              placeholder={copy.actionPlaceholder}
              disabled={disabled}
              className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-[var(--text)]">{copy.due}</span>
            <input
              type="date"
              name="next_action_due_date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              required
              disabled={disabled}
              className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            />
          </label>
        </div>
      )}

      <label className="space-y-1 text-sm">
        <span className="font-medium text-[var(--text)]">{copy.reason}</span>
        <textarea
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={500}
          disabled={disabled}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
        <span className="block text-xs text-[var(--text-2)]">
          {copy.reasonHint}
        </span>
      </label>
    </>
  );
}

export function SalesLeadWorkflowForm({
  lead,
  ownerOptions,
  ownerOptionsUnavailable,
  locale,
  requestId,
  compact = false,
}: Readonly<{
  lead: PlatformSalesLeadWorkflow;
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsUnavailable: boolean;
  locale: Locale;
  requestId: string;
  compact?: boolean;
}>) {
  const copy = COPY[locale];
  const initialState: PlatformSalesWorkflowActionState = {
    status: "idle",
    requestId,
    workflowVersion: null,
    changedAt: null,
  };
  const [result, action, pending] = useActionState(
    updatePlatformSalesLeadWorkflowAction,
    initialState,
  );

  const resultMatchesCurrentLead =
    result.workflowVersion === null || result.workflowVersion >= lead.workflowVersion;
  const message = resultMatchesCurrentLead
    ? stateMessage(locale, result.status)
    : null;
  const workflowVersion =
    result.status === "saved" &&
    result.workflowVersion !== null &&
    result.workflowVersion >= lead.workflowVersion
      ? result.workflowVersion
      : lead.workflowVersion;

  const form = (
    <form action={action} className="space-y-3" data-testid="sales-workflow-form">
      <input type="hidden" name="lead_id" value={lead.leadId} />
      <input
        type="hidden"
        name="expected_workflow_version"
        value={workflowVersion}
      />
      <input type="hidden" name="request_id" value={result.requestId} />
      <SalesLeadWorkflowEditorFields
        key={`${lead.leadId}:${lead.workflowVersion}`}
        copy={copy}
        lead={lead}
        locale={locale}
        ownerOptions={ownerOptions}
        ownerOptionsUnavailable={ownerOptionsUnavailable}
        pending={pending}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || ownerOptionsUnavailable}
          className="min-h-10 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? copy.saving : copy.save}
        </button>
        <span className="text-xs text-[var(--text-2)]">
          {copy.version}: {workflowVersion}
        </span>
      </div>

      {ownerOptionsUnavailable ? (
        <p className="text-sm text-[var(--warn)]" role="status">
          {copy.unavailable}
        </p>
      ) : message ? (
        <div
          className={
            result.status === "saved"
              ? "text-sm text-[var(--ok)]"
              : "text-sm text-[var(--warn)]"
          }
          role="status"
          data-testid={`sales-workflow-${result.status}`}
        >
          <p>{message}</p>
          {result.status === "stale" ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 underline"
            >
              {copy.reload}
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );

  if (!compact) return form;

  return (
    <details
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
      data-testid="sales-workflow-editor"
    >
      <summary className="cursor-pointer text-sm font-semibold">
        {copy.summary}
      </summary>
      <div className="mt-3">{form}</div>
    </details>
  );
}
