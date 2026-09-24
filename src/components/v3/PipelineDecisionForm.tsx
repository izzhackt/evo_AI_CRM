"use client";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { staffHasPermission } from "@/lib/platform-access";


import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  updatePlatformSalesWorkflowAction,
  type PlatformSalesWorkflowActionState,
} from "@/lib/platform-sales-actions";
import type {
  PlatformSalesOwnerOption,
  PlatformSalesStage,
  PlatformSalesWorkflowLead,
} from "@/lib/platform-sales-contract";

const STATUS_COPY: Record<
  Exclude<PlatformSalesWorkflowActionState["status"], "idle">,
  string
> = {
  saved: "Решение сохранено.",
  invalid: "Проверьте этап, действие, срок и причину.",
  forbidden: "У вашей роли нет прав на это изменение.",
  stale: "Лид уже изменён. Обновите данные перед повтором.",
  request_conflict: "Команда уже использована. Подготовлен новый безопасный повтор.",
  unavailable: "Supabase недоступен. Изменение не подтверждено.",
};

const CONTROL_CLASS =
  "mt-1 w-full rounded-ctl border border-control-edge bg-surface px-2.5 py-2 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:bg-surface-2 disabled:text-fg-3";

type WorkflowStageOption = Readonly<{
  key: PlatformSalesStage;
  title: string;
}>;

export function PipelineDecisionForm({
  lead,
  stages,
  ownerOptions,
  ownerOptionsHaveMore,
  actor,
  requestId,
}: Readonly<{
  lead: PlatformSalesWorkflowLead;
  stages: readonly WorkflowStageOption[];
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actor: ActivePlatformActor;
  actorMembershipId: string;
  requestId: string;
}>) {
  const router = useRouter();
  const initialState: PlatformSalesWorkflowActionState = {
    status: "idle",
    requestId,
    version: lead.workflowVersion,
    changedAt: null,
  };
  const [result, action, pending] = useActionState(
    updatePlatformSalesWorkflowAction,
    initialState,
  );
  const [open, setOpen] = useState(false);
  const [stageKey, setStageKey] = useState<PlatformSalesStage>(lead.stageKey);
  const [ownerMembershipId, setOwnerMembershipId] = useState(
    lead.currentOwnerMembershipId ?? "",
  );
  const [clearNextAction, setClearNextAction] = useState(
    lead.nextActionText === null,
  );
  const [nextActionText, setNextActionText] = useState(
    lead.nextActionText ?? "",
  );
  const [nextActionDueDate, setNextActionDueDate] = useState(
    lead.nextActionDueDate ?? "",
  );
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (result.status === "saved") router.refresh();
  }, [result.changedAt, result.status, router]);

  const canAssignOwner = staffHasPermission(actor, "lead.sales.owner.assign");
  const visibleOwnerOptions = canAssignOwner ? ownerOptions : [];
  const currentOwnerIsListed = visibleOwnerOptions.some(
    (option) => option.membershipId === lead.currentOwnerMembershipId,
  );
  const ownerChanged =
    ownerMembershipId !== (lead.currentOwnerMembershipId ?? "");
  const reasonRequired =
    (staffHasPermission(actor, "lead.sales.owner.assign") &&
      lead.currentOwnerMembershipId !== null &&
      ownerChanged) ||
    (lead.nextActionText !== null && clearNextAction);
  const workflowVersion = result.version ?? lead.workflowVersion;
  const message = result.status === "idle" ? null : STATUS_COPY[result.status];
  const controlId = `pipeline-decision-${lead.leadId}`;

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="relative mt-2 border-t border-border pt-2"
      data-lead-id={lead.leadId}
      data-testid="v3-pipeline-decision"
    >
      <summary className="t-item cursor-pointer rounded-sm text-fg-2 outline-none hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        Изменить этап и действие
      </summary>

      {open ? (
        <form
          action={action}
          className="mt-3 space-y-3"
          data-testid="v3-pipeline-workflow-form"
        >
        <input type="hidden" name="lead_id" value={lead.leadId} />
        <input
          type="hidden"
          name="expected_version"
          value={workflowVersion}
        />
        <input type="hidden" name="request_id" value={result.requestId} />
        <input
          type="hidden"
          name="clear_next_action"
          value={clearNextAction ? "true" : "false"}
        />

        <fieldset disabled={pending} className="space-y-3">
          <legend className="sr-only">Решение по лиду</legend>

          <label className="block t-label text-fg-2">
            Этап
            <select
              name="stage_key"
              value={stageKey}
              onChange={(event) => {
                setStageKey(event.target.value as PlatformSalesStage);
              }}
              className={CONTROL_CLASS}
              data-testid="v3-pipeline-stage"
            >
              {stages.map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block t-label text-fg-2">
            Ответственный
            {!canAssignOwner ? <input type="hidden" name="current_owner_membership_id" value={lead.currentOwnerMembershipId ?? ""} /> : null}
            <select
              name={canAssignOwner ? "current_owner_membership_id" : undefined}
              disabled={!canAssignOwner}
              value={ownerMembershipId}
              onChange={(event) => {
                setOwnerMembershipId(event.target.value);
              }}
              className={CONTROL_CLASS}
              data-testid="v3-pipeline-owner"
            >
              {canAssignOwner || lead.currentOwnerMembershipId === null ? (
                <option value="">Не назначен</option>
              ) : null}
              {lead.currentOwnerMembershipId !== null &&
              !currentOwnerIsListed ? (
                <option value={lead.currentOwnerMembershipId}>
                  {lead.currentOwnerDisplayName ?? "Текущий ответственный"}
                </option>
              ) : null}
              {visibleOwnerOptions.map((option) => (
                <option key={option.membershipId} value={option.membershipId}>
                  {option.displayLabel}
                </option>
              ))}
            </select>
          </label>

          {ownerOptionsHaveMore && staffHasPermission(actor, "lead.sales.owner.assign") ? (
            <p className="t-meta text-fg-3">
              Показаны первые 100 сотрудников.
            </p>
          ) : null}

          <label className="t-body-compact flex items-start gap-2 text-fg-2">
            <input
              type="checkbox"
              checked={clearNextAction}
              onChange={(event) => {
                const checked = event.target.checked;
                setClearNextAction(checked);
                if (checked) {
                  setNextActionText("");
                  setNextActionDueDate("");
                }
              }}
              className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
            />
            Без следующего действия
          </label>

          {clearNextAction ? (
            <>
              <input type="hidden" name="next_action_text" value="" />
              <input type="hidden" name="next_action_due_date" value="" />
            </>
          ) : (
            <>
              <label className="block t-label text-fg-2">
                Следующее действие
                <textarea
                  name="next_action_text"
                  value={nextActionText}
                  onChange={(event) => {
                    setNextActionText(event.target.value);
                  }}
                  required
                  maxLength={500}
                  rows={3}
                  placeholder="Что сделать дальше"
                  className={`${CONTROL_CLASS} resize-y`}
                  data-testid="v3-pipeline-next-action"
                />
              </label>

              <label className="block t-label text-fg-2">
                Срок
                <input
                  type="date"
                  name="next_action_due_date"
                  value={nextActionDueDate}
                  onChange={(event) => {
                    setNextActionDueDate(event.target.value);
                  }}
                  required
                  className={CONTROL_CLASS}
                  data-testid="v3-pipeline-next-action-date"
                />
              </label>
            </>
          )}

          <label className="block t-label text-fg-2">
            Причина{reasonRequired ? " · обязательна" : ""}
            <textarea
              name="reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              required={reasonRequired}
              maxLength={500}
              rows={2}
              aria-describedby={`${controlId}-reason`}
              className={`${CONTROL_CLASS} resize-y`}
              data-testid="v3-pipeline-reason"
            />
            <span
              id={`${controlId}-reason`}
              className="t-meta mt-1 block text-fg-3"
            >
              Нужна при смене ответственного или удалении действия.
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="submit"
              className="min-h-9 rounded-ctl bg-accent px-3 py-2 text-xs font-semibold text-on-accent outline-none hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:bg-surface-3 disabled:text-fg-3"
              data-testid="v3-pipeline-submit"
            >
              {pending ? "Сохраняем…" : "Сохранить решение"}
            </button>
            <span className="t-meta font-mono text-fg-3">
              Версия {workflowVersion}
            </span>
          </div>
        </fieldset>

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-status={result.status}
          data-testid="v3-pipeline-workflow-status"
          className={`t-body-compact min-h-4 ${
            result.status === "saved" ? "text-ok" : "text-warn"
          }`}
        >
          {message}
          {result.status === "stale" ? (
            <button
              type="button"
              onClick={() => router.refresh()}
              className="ms-1 font-semibold underline underline-offset-2"
            >
              Обновить
            </button>
          ) : null}
        </div>
        </form>
      ) : null}
    </details>
  );
}
