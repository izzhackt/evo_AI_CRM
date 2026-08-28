"use client";

import { useActionState, useState } from "react";

import { btnCls, cn, inputCls, labelCls } from "@/components/ui";
import {
  CANONICAL_SALES_STAGES,
  type CanonicalSalesStage,
  type CanonicalSalesWorkflowLead,
} from "@/lib/canonical-sales-workflow-contract";
import type { Locale } from "@/lib/i18n";
import {
  updateCanonicalSalesLeadWorkflowAction,
  type CanonicalSalesWorkflowActionState,
} from "@/lib/server/canonical-sales-workflow-actions";

const COPY = {
  ru: {
    title: "Квалификация и следующий шаг",
    description:
      "Изменение сохраняется прямо в PostgreSQL EVO V2. Для активного лида укажите действие и дату; для отказа — причину.",
    stage: "Этап",
    qualificationSummary: "Итог квалификации",
    qualificationPlaceholder: "Цель, страна, бюджет и готовность клиента",
    nextAction: "Следующее действие",
    nextActionPlaceholder: "Например: созвон по выбору программы",
    nextActionAt: "Срок",
    reason: "Причина изменения / отказа",
    reasonPlaceholder: "Обязательно при дисквалификации",
    save: "Сохранить",
    saving: "Сохраняем…",
    version: "Версия",
    terminal:
      "Лид уже передан в Admissions. Обычное редактирование Sales больше недоступно.",
    saved: "Сохранено в EVO V2.",
    invalid: "Проверьте обязательные поля и правила этапа.",
    forbidden: "У этой роли нет права изменять Sales-лид.",
    stale: "Лид уже изменён в другой вкладке. Обновите страницу.",
    request_conflict: "Этот идентификатор уже использован для другой команды. Повторите сохранение.",
    unavailable: "PostgreSQL сейчас недоступен. Ничего не сохранено.",
    reload: "Обновить страницу",
  },
  ky: {
    title: "Квалификация жана кийинки кадам",
    description:
      "Өзгөртүү түз EVO V2 PostgreSQL базасына сакталат. Активдүү лид үчүн аракетти жана датаны, баш тартууда себепти көрсөтүңүз.",
    stage: "Этап",
    qualificationSummary: "Квалификация жыйынтыгы",
    qualificationPlaceholder: "Кардардын максаты, өлкөсү, бюджети жана даярдыгы",
    nextAction: "Кийинки аракет",
    nextActionPlaceholder: "Мисалы: программа тандоо боюнча чалуу",
    nextActionAt: "Мөөнөт",
    reason: "Өзгөртүү / баш тартуу себеби",
    reasonPlaceholder: "Дисквалификацияда милдеттүү",
    save: "Сактоо",
    saving: "Сакталууда…",
    version: "Версия",
    terminal:
      "Лид Admissions бөлүмүнө өткөрүлгөн. Sales үчүн кадимки түзөтүү жабык.",
    saved: "EVO V2 базасына сакталды.",
    invalid: "Милдеттүү талааларды жана этап эрежелерин текшериңиз.",
    forbidden: "Бул роль Sales лидди өзгөртө албайт.",
    stale: "Лид башка терезеде өзгөртүлдү. Баракты жаңыртыңыз.",
    request_conflict: "Бул идентификатор башка командага колдонулган. Кайра сактаңыз.",
    unavailable: "PostgreSQL азыр жеткиликсиз. Эч нерсе сакталган жок.",
    reload: "Баракты жаңыртуу",
  },
  en: {
    title: "Qualification and next step",
    description:
      "The change is saved directly to EVO V2 PostgreSQL. Active leads require an action and date; disqualification requires a reason.",
    stage: "Stage",
    qualificationSummary: "Qualification summary",
    qualificationPlaceholder: "Client goal, country, budget, and readiness",
    nextAction: "Next action",
    nextActionPlaceholder: "For example: call to choose a program",
    nextActionAt: "Deadline",
    reason: "Change / disqualification reason",
    reasonPlaceholder: "Required when disqualifying",
    save: "Save",
    saving: "Saving…",
    version: "Version",
    terminal:
      "This lead has already been handed to Admissions. Normal Sales editing is closed.",
    saved: "Saved to EVO V2.",
    invalid: "Check the required fields and stage rules.",
    forbidden: "This role cannot change Sales leads.",
    stale: "The lead changed in another tab. Reload the page.",
    request_conflict: "This identifier was used for another command. Save again.",
    unavailable: "PostgreSQL is unavailable. Nothing was saved.",
    reload: "Reload page",
  },
} as const;

const STAGE_COPY: Record<Locale, Record<CanonicalSalesStage, string>> = {
  ru: {
    new: "Новый",
    qualifying: "Квалификация",
    qualified: "Квалифицирован",
    disqualified: "Дисквалифицирован",
    handoff_ready: "Готов к передаче",
    handed_off: "Передан в Admissions",
  },
  ky: {
    new: "Жаңы",
    qualifying: "Квалификация",
    qualified: "Квалификациядан өттү",
    disqualified: "Дисквалификацияланган",
    handoff_ready: "Өткөрүүгө даяр",
    handed_off: "Admissions бөлүмүнө өткөрүлдү",
  },
  en: {
    new: "New",
    qualifying: "Qualifying",
    qualified: "Qualified",
    disqualified: "Disqualified",
    handoff_ready: "Ready for handoff",
    handed_off: "Handed to Admissions",
  },
};

export function CanonicalSalesWorkflowForm({
  lead,
  locale,
  requestId,
}: Readonly<{
  lead: CanonicalSalesWorkflowLead;
  locale: Locale;
  requestId: string;
}>) {
  const copy = COPY[locale];
  const initialState: CanonicalSalesWorkflowActionState = {
    status: "idle",
    requestId,
    version: lead.version,
    changedAt: null,
  };
  const [result, action, pending] = useActionState(
    updateCanonicalSalesLeadWorkflowAction,
    initialState,
  );
  const [stage, setStage] = useState<CanonicalSalesStage>(lead.stage);
  const [reason, setReason] = useState("");
  const version = result.version ?? lead.version;

  if (lead.stage === "handed_off") {
    return (
      <section
        className="rounded-card border border-border bg-surface px-5 py-4"
        data-testid="canonical-sales-workflow-terminal"
      >
        <h2 className="text-[15px] font-semibold text-fg">{copy.title}</h2>
        <p className="mt-2 text-[13px] leading-5 text-fg-2">{copy.terminal}</p>
      </section>
    );
  }

  const message = result.status === "idle" ? null : copy[result.status];

  return (
    <form
      action={action}
      className="space-y-4 rounded-card border border-border bg-surface px-5 py-4"
      data-testid="canonical-sales-workflow-form"
    >
      <input type="hidden" name="lead_id" value={lead.leadId} />
      <input type="hidden" name="request_id" value={result.requestId} />
      <input type="hidden" name="expected_version" value={version} />

      <div>
        <h2 className="text-[15px] font-semibold text-fg">{copy.title}</h2>
        <p className="mt-1 text-[12.5px] leading-5 text-fg-2">
          {copy.description}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label>
          <span className={labelCls}>{copy.stage}</span>
          <select
            name="stage"
            value={stage}
            onChange={(event) => {
              const nextStage = event.target.value as CanonicalSalesStage;
              setStage(nextStage);
              if (nextStage !== "disqualified") setReason("");
            }}
            className={inputCls}
          >
            {CANONICAL_SALES_STAGES.filter(
              (candidate) => candidate !== "handed_off",
            ).map((candidate) => (
              <option key={candidate} value={candidate}>
                {STAGE_COPY[locale][candidate]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={labelCls}>{copy.nextActionAt}</span>
          <input
            type="date"
            name="next_action_at"
            defaultValue={lead.nextActionAt?.slice(0, 10) ?? ""}
            required={stage !== "disqualified"}
            className={cn(inputCls, "font-mono")}
          />
        </label>
      </div>

      <label>
        <span className={labelCls}>{copy.qualificationSummary}</span>
        <textarea
          name="qualification_summary"
          defaultValue={lead.qualificationSummary ?? ""}
          placeholder={copy.qualificationPlaceholder}
          required={stage === "qualified" || stage === "handoff_ready"}
          maxLength={2_000}
          rows={4}
          className={cn(inputCls, "h-auto resize-y py-2")}
        />
      </label>

      <label>
        <span className={labelCls}>{copy.nextAction}</span>
        <input
          name="next_action"
          defaultValue={lead.nextAction ?? ""}
          placeholder={copy.nextActionPlaceholder}
          required={stage !== "disqualified"}
          maxLength={500}
          className={inputCls}
        />
      </label>

      <label>
        <span className={labelCls}>{copy.reason}</span>
        <textarea
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={copy.reasonPlaceholder}
          required={stage === "disqualified"}
          disabled={stage !== "disqualified"}
          maxLength={500}
          rows={3}
          className={cn(inputCls, "h-auto resize-y py-2")}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btnCls}>
          {pending ? copy.saving : copy.save}
        </button>
        <span className="text-xs text-fg-3">
          {copy.version}: {version}
        </span>
      </div>

      {message ? (
        <div
          role="status"
          data-testid={`canonical-sales-workflow-${result.status}`}
          className={
            result.status === "saved"
              ? "text-sm text-[var(--ok)]"
              : "text-sm text-[var(--warn)]"
          }
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
}
