"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { btnCls, cn, inputCls, labelCls } from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import {
  updatePlatformSalesWorkflowAction,
  type PlatformSalesWorkflowActionState,
} from "@/lib/platform-sales-actions";
import {
  PLATFORM_SALES_STAGES,
  type PlatformSalesOwnerOption,
  type PlatformSalesStage,
  type PlatformSalesWorkflowFormLead,
} from "@/lib/platform-sales-contract";

const COPY = {
  ru: {
    title: "Этап, ответственный и следующий шаг",
    description:
      "Изменение сохраняется одной версионной командой в Supabase. PostgreSQL и RLS повторно проверяют роль, владельца и актуальность лида.",
    stage: "Этап Sales",
    owner: "Ответственный Sales",
    unassigned: "Не назначен",
    unavailableOwner: "Текущий ответственный больше не входит в активный список",
    adminOwnerHelp: "Admin может назначить, переназначить или снять ответственного Sales.",
    salesOwnerHelp:
      "Sales может взять свободный лид на себя; назначенный лид остаётся за текущим ответственным.",
    moreOwners:
      "Показаны первые 100 подходящих сотрудников. Дополнительные записи не подставляются автоматически.",
    clearAction: "Очистить сохранённое следующее действие",
    noAction: "Следующее действие пока не запланировано",
    action: "Следующее действие",
    actionPlaceholder: "Например: подтвердить встречу и отправить список программ",
    dueDate: "Срок",
    reason: "Причина изменения",
    reasonRequired: "Причина обязательна для этого изменения.",
    reasonHelp:
      "Обязательна, когда Admin меняет уже назначенного ответственного или удаляется сохранённое действие.",
    reasonPlaceholder: "Кратко зафиксируйте деловую причину",
    save: "Сохранить изменение",
    saving: "Сохраняем…",
    version: "Версия workflow",
    saved: "Изменение сохранено в Supabase и записано в журнал событий.",
    invalid: "Проверьте этап, ответственного, действие, дату и обязательную причину.",
    forbidden: "Эта роль не может выполнить такое изменение для данного лида.",
    stale: "Лид уже изменён в другой вкладке. Обновите страницу перед повтором.",
    requestConflict: "Этот идентификатор команды уже использован. Форма подготовила новый.",
    unavailable: "Supabase сейчас недоступен. Изменение не подтверждено.",
    reload: "Обновить страницу",
    changedAt: "Подтверждено",
  },
  ky: {
    title: "Этап, жооптуу кызматкер жана кийинки кадам",
    description:
      "Өзгөртүү Supabase базасына бир версияланган команда менен сакталат. PostgreSQL жана RLS ролду, жооптуу кызматкерди жана лиддин актуалдуулугун кайра текшерет.",
    stage: "Sales этабы",
    owner: "Жооптуу Sales кызматкери",
    unassigned: "Дайындалган эмес",
    unavailableOwner: "Учурдагы жооптуу кызматкер активдүү тизмеде жок",
    adminOwnerHelp: "Admin Sales кызматкерин дайындай, алмаштыра же алып сала алат.",
    salesOwnerHelp:
      "Sales бош лидди өзүнө ала алат; дайындалган лид учурдагы жооптуу кызматкерде калат.",
    moreOwners:
      "Алгачкы 100 ылайыктуу кызматкер көрсөтүлдү. Кошумча жазуулар автоматтык түрдө тандалбайт.",
    clearAction: "Сакталган кийинки аракетти тазалоо",
    noAction: "Кийинки аракет азырынча пландалган эмес",
    action: "Кийинки аракет",
    actionPlaceholder: "Мисалы: жолугушууну ырастап, программалардын тизмесин жөнөтүү",
    dueDate: "Мөөнөт",
    reason: "Өзгөртүүнүн себеби",
    reasonRequired: "Бул өзгөртүү үчүн себеп милдеттүү.",
    reasonHelp:
      "Admin дайындалган жооптуу кызматкерди алмаштырганда же сакталган аракет өчүрүлгөндө милдеттүү.",
    reasonPlaceholder: "Ишкердик себебин кыскача жазыңыз",
    save: "Өзгөртүүнү сактоо",
    saving: "Сакталууда…",
    version: "Workflow версиясы",
    saved: "Өзгөртүү Supabase базасына сакталды жана окуялар журналына жазылды.",
    invalid: "Этапты, жооптуу кызматкерди, аракетти, датаны жана милдеттүү себепти текшериңиз.",
    forbidden: "Бул роль ушул лид үчүн мындай өзгөртүү жасай албайт.",
    stale: "Лид башка терезеде өзгөрдү. Кайталоодон мурун баракты жаңыртыңыз.",
    requestConflict: "Бул команда идентификатору колдонулган. Форма жаңысын даярдады.",
    unavailable: "Supabase азыр жеткиликсиз. Өзгөртүү ырасталган жок.",
    reload: "Баракты жаңыртуу",
    changedAt: "Ырасталды",
  },
  en: {
    title: "Stage, owner and next action",
    description:
      "The change is committed to Supabase as one versioned command. PostgreSQL and RLS recheck the role, owner and current lead version.",
    stage: "Sales stage",
    owner: "Responsible Sales owner",
    unassigned: "Unassigned",
    unavailableOwner: "The current owner is no longer in the active list",
    adminOwnerHelp: "Admin can assign, reassign or remove an eligible Sales owner.",
    salesOwnerHelp:
      "Sales can claim an unassigned lead; an assigned lead stays with its current owner.",
    moreOwners:
      "The first 100 eligible staff are shown. Additional records are not selected automatically.",
    clearAction: "Clear the saved next action",
    noAction: "No next action is scheduled yet",
    action: "Next action",
    actionPlaceholder: "For example: confirm the meeting and send the program shortlist",
    dueDate: "Due date",
    reason: "Reason for change",
    reasonRequired: "A reason is required for this change.",
    reasonHelp:
      "Required when Admin changes an assigned owner or a saved next action is removed.",
    reasonPlaceholder: "Record the business reason briefly",
    save: "Save change",
    saving: "Saving…",
    version: "Workflow version",
    saved: "The change was saved to Supabase and recorded in the event log.",
    invalid: "Check the stage, owner, action, date and required reason.",
    forbidden: "This role cannot make that change for this lead.",
    stale: "This lead changed in another tab. Reload before trying again.",
    requestConflict: "This command identifier was already used. A new one is ready.",
    unavailable: "Supabase is unavailable. The change is not confirmed.",
    reload: "Reload page",
    changedAt: "Confirmed",
  },
} as const;

const STAGE_COPY: Record<Locale, Record<PlatformSalesStage, string>> = {
  ru: {
    new: "Новый",
    contacting: "Связываемся",
    qualified: "Квалифицирован",
    meeting_scheduled: "Встреча назначена",
    meeting_completed: "Встреча проведена",
    potential: "Потенциальный клиент",
  },
  ky: {
    new: "Жаңы",
    contacting: "Байланышуудабыз",
    qualified: "Квалификациядан өттү",
    meeting_scheduled: "Жолугушуу дайындалды",
    meeting_completed: "Жолугушуу өттү",
    potential: "Потенциалдуу кардар",
  },
  en: {
    new: "New",
    contacting: "Contacting",
    qualified: "Qualified",
    meeting_scheduled: "Meeting scheduled",
    meeting_completed: "Meeting completed",
    potential: "Potential client",
  },
};

function actionMessage(
  locale: Locale,
  status: PlatformSalesWorkflowActionState["status"],
): string {
  const copy = COPY[locale];
  switch (status) {
    case "idle":
      return "";
    case "saved":
      return copy.saved;
    case "invalid":
      return copy.invalid;
    case "forbidden":
      return copy.forbidden;
    case "stale":
      return copy.stale;
    case "request_conflict":
      return copy.requestConflict;
    case "unavailable":
      return copy.unavailable;
  }
}

function formatChangedAt(value: string, locale: Locale): string {
  const tag = locale === "ru" ? "ru-RU" : locale === "ky" ? "ky-KG" : "en-GB";
  return new Intl.DateTimeFormat(tag, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function PlatformSalesWorkflowForm({
  lead,
  ownerOptions,
  ownerOptionsHaveMore,
  actorRole,
  actorMembershipId,
  locale,
  requestId,
}: Readonly<{
  lead: PlatformSalesWorkflowFormLead;
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actorRole: Extract<FixedRole, "admin" | "sales">;
  actorMembershipId: string;
  locale: Locale;
  requestId: string;
}>) {
  const router = useRouter();
  const copy = COPY[locale];
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
  const [stage, setStage] = useState<PlatformSalesStage>(lead.stageKey);
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
    if (result.status !== "saved") return;
    router.refresh();
  }, [result.changedAt, result.status, router]);

  const selectedOwnerIsListed = ownerOptions.some(
    (option) => option.membershipId === lead.currentOwnerMembershipId,
  );
  const mayChooseUnassigned =
    actorRole === "admin" || lead.currentOwnerMembershipId === null;
  const visibleOwnerOptions = useMemo(() => {
    if (actorRole === "admin") return ownerOptions;
    return ownerOptions.filter(
      (option) => option.membershipId === actorMembershipId,
    );
  }, [actorMembershipId, actorRole, ownerOptions]);
  const ownerChanged =
    ownerMembershipId !== (lead.currentOwnerMembershipId ?? "");
  const reasonRequired =
    (actorRole === "admin" &&
      lead.currentOwnerMembershipId !== null &&
      ownerChanged) ||
    (lead.nextActionText !== null && clearNextAction);
  const message = actionMessage(locale, result.status);
  const workflowVersion = result.version ?? lead.workflowVersion;

  return (
    <form
      action={action}
      className="space-y-5 rounded-card border border-border bg-surface px-5 py-4 shadow-evo"
      data-testid="platform-sales-workflow-form"
    >
      <input type="hidden" name="lead_id" value={lead.leadId} />
      <input type="hidden" name="expected_version" value={workflowVersion} />
      <input type="hidden" name="request_id" value={result.requestId} />
      <input
        type="hidden"
        name="clear_next_action"
        value={clearNextAction ? "true" : "false"}
      />

      <div>
        <h2 className="text-md font-semibold text-fg">{copy.title}</h2>
        <p className="mt-1 max-w-prose text-sm leading-5 text-fg-2">
          {copy.description}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label>
          <span className={labelCls}>{copy.stage}</span>
          <select
            name="stage_key"
            value={stage}
            onChange={(event) => {
              setStage(event.target.value as PlatformSalesStage);
            }}
            disabled={pending}
            className={inputCls}
            data-testid="platform-sales-stage"
          >
            {PLATFORM_SALES_STAGES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {STAGE_COPY[locale][candidate]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={labelCls}>{copy.owner}</span>
          <select
            name="current_owner_membership_id"
            value={ownerMembershipId}
            onChange={(event) => {
              setOwnerMembershipId(event.target.value);
            }}
            disabled={pending}
            className={inputCls}
            data-testid="platform-sales-owner"
          >
            {mayChooseUnassigned ? (
              <option value="">{copy.unassigned}</option>
            ) : null}
            {lead.currentOwnerMembershipId !== null && !selectedOwnerIsListed ? (
              <option value={lead.currentOwnerMembershipId}>
                {lead.currentOwnerDisplayName ?? copy.unavailableOwner}
              </option>
            ) : null}
            {visibleOwnerOptions.map((option) => (
              <option key={option.membershipId} value={option.membershipId}>
                {option.displayLabel}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs leading-5 text-fg-3">
            {actorRole === "admin" ? copy.adminOwnerHelp : copy.salesOwnerHelp}
          </span>
          {ownerOptionsHaveMore ? (
            <span className="mt-1 block text-xs leading-5 text-warn">
              {copy.moreOwners}
            </span>
          ) : null}
        </label>
      </div>

      <label className="flex min-h-11 items-start gap-3 rounded-ctl border border-control-edge bg-surface-2 px-3 py-2.5 text-sm text-fg">
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
          disabled={pending}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
          data-testid="platform-sales-clear-next-action"
        />
        <span>
          {lead.nextActionText === null ? copy.noAction : copy.clearAction}
        </span>
      </label>

      {clearNextAction ? (
        <>
          <input type="hidden" name="next_action_text" value="" />
          <input type="hidden" name="next_action_due_date" value="" />
        </>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_12rem]">
        <label>
          <span className={labelCls}>{copy.action}</span>
          <input
            name={clearNextAction ? undefined : "next_action_text"}
            value={nextActionText}
            onChange={(event) => {
              setNextActionText(event.target.value);
            }}
            required={!clearNextAction}
            disabled={pending || clearNextAction}
            maxLength={500}
            placeholder={copy.actionPlaceholder}
            className={inputCls}
            data-testid="platform-sales-next-action-text"
          />
        </label>

        <label>
          <span className={labelCls}>{copy.dueDate}</span>
          <input
            type="date"
            name={clearNextAction ? undefined : "next_action_due_date"}
            value={nextActionDueDate}
            onChange={(event) => {
              setNextActionDueDate(event.target.value);
            }}
            required={!clearNextAction}
            disabled={pending || clearNextAction}
            className={cn(inputCls, "font-mono text-sm")}
            data-testid="platform-sales-next-action-due-date"
          />
        </label>
      </div>

      <label>
        <span className={labelCls}>
          {copy.reason}
          {reasonRequired ? ` · ${copy.reasonRequired}` : ""}
        </span>
        <textarea
          name="reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          required={reasonRequired}
          disabled={pending}
          maxLength={500}
          rows={3}
          placeholder={copy.reasonPlaceholder}
          className={cn(inputCls, "h-auto resize-y py-2")}
          aria-describedby="platform-sales-reason-help"
          data-testid="platform-sales-reason"
        />
        <span
          id="platform-sales-reason-help"
          className="mt-1 block text-xs leading-5 text-fg-3"
        >
          {copy.reasonHelp}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={btnCls}
          data-testid="platform-sales-submit"
        >
          {pending ? copy.saving : copy.save}
        </button>
        <span className="text-xs text-fg-3">
          {copy.version}: {workflowVersion}
        </span>
      </div>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={cn(
          "min-h-5 text-sm",
          result.status === "saved" ? "text-ok" : "text-warn",
        )}
        data-status={result.status}
        data-testid="platform-sales-action-status"
      >
        {message ? <p>{message}</p> : null}
        {result.status === "saved" && result.changedAt ? (
          <p className="mt-1 text-xs text-fg-3">
            {copy.changedAt}: {formatChangedAt(result.changedAt, locale)}
          </p>
        ) : null}
        {result.status === "stale" ? (
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            className="mt-2 underline underline-offset-2"
          >
            {copy.reload}
          </button>
        ) : null}
      </div>
    </form>
  );
}
