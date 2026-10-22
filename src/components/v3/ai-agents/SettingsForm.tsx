"use client";

import Link from "next/link";
import { useState } from "react";

import { btnCls, btnGhostCls, fieldLabelCls, inputCls } from "@/components/ui";
import { AI_AGENT_MODELS, type AiAgentDetail, type AiAgentModelId } from "@/lib/ai-agents/contract";
import { startAiAgentRunAction, updateAiAgentAction } from "@/lib/platform-ai-agents-actions";
import {
  SCHEDULE_TIMEZONES,
  SCHEDULE_WEEKDAY_OPTIONS,
  aiAgentHref,
  cronFromPlan,
  describeSchedule,
  formatUsd,
  isValidCron,
  parseCronPlan,
  timezoneLabel,
  type ScheduleKind,
} from "@/lib/v3/ai-agents-view";

import { ActionMessage } from "./Notices";
import { useAgentsAction } from "./useAgentsAction";

type Kind = ScheduleKind | "custom";
const KIND_LABELS: Readonly<Record<Kind, string>> = {
  none: "Нет", daily: "Каждый день", weekdays: "По будням", weekly: "Раз в неделю", custom: "Свой cron",
};
const CLAUDE_AGENT_ID = /^agent_[A-Za-z0-9]{8,64}$/u;

function initial(detail: AiAgentDetail) {
  const plan = parseCronPlan(detail.scheduleCron);
  return {
    model: detail.model as AiAgentModelId,
    kind: (plan === "custom" ? "custom" : plan.kind) as Kind,
    time: plan === "custom" ? "09:00" : plan.time,
    weekday: plan === "custom" ? 1 : plan.weekday,
    cron: detail.scheduleCron ?? "",
    tz: detail.scheduleTz,
    prompt: detail.schedulePromptOverride ?? "",
    website: detail.triggerWebsiteLead,
    whatsapp: detail.triggerWhatsappInbound,
    budget: String(detail.runBudgetUsd),
    claudeId: detail.sync.claudeAgentId ?? "",
  };
}

/**
 * Вкладка «Настройки» (контракт §D.4, п. 6): модель, расписание (простой выбор
 * и cron для разработчиков), поручение для расписания, события, потолок расхода
 * запуска и привязка к агенту, созданному в Console. Правит только системный
 * администратор; остальные видят значения. Отправляется один патч — только
 * изменённые поля; то, что видит Claude, синхронизируется само.
 */
export function SettingsForm({
  detail,
  defaultSchedulePrompt,
  canEdit,
  canRunNow,
  runNowNote,
}: Readonly<{
  detail: AiAgentDetail;
  /** Поручение расписания из репозитория; null — для агента расписание не предусмотрено. */
  defaultSchedulePrompt: string | null;
  canEdit: boolean;
  /** Агент включён, синхронизирован, ключ задан. */
  canRunNow: boolean;
  runNowNote: string | null;
}>) {
  const base = initial(detail);
  const [form, setForm] = useState(base);
  // Форма возвращается к значениям сервера только когда версия настроек изменилась (запись прошла), а не при каждой перерисовке страницы.
  const [seenVersion, setSeenVersion] = useState(detail.configVersion);
  if (seenVersion !== detail.configVersion) { setSeenVersion(detail.configVersion); setForm(initial(detail)); }
  const save = useAgentsAction(updateAiAgentAction);
  const run = useAgentsAction(startAiAgentRunAction);
  const set = <K extends keyof typeof base>(name: K, value: (typeof base)[K]) => setForm((previous) => ({ ...previous, [name]: value }));

  const cron = form.kind === "custom" ? (form.cron.trim() === "" ? null : form.cron.trim()) : cronFromPlan({ kind: form.kind, time: form.time, weekday: form.weekday });
  const budget = Number(form.budget.replace(",", "."));
  const problems: string[] = [];
  if (form.kind === "custom" && cron !== null && !isValidCron(cron)) problems.push("Cron: пять полей из цифр и знаков * / , - (например, 0 9 * * 1).");
  if (form.kind !== "custom" && form.kind !== "none" && !/^([01]\d|2[0-3]):[0-5]\d$/u.test(form.time)) problems.push("Время расписания — в формате ЧЧ:ММ.");
  if (form.budget.trim() === "" || !Number.isFinite(budget) || budget < 0 || budget > 100) problems.push("Потолок расхода — число от 0 до 100 долларов.");
  if (form.claudeId.trim() !== "" && !CLAUDE_AGENT_ID.test(form.claudeId.trim())) problems.push("ID агента в Claude начинается с «agent_» (его показывает Claude Console).");
  if (form.prompt.length > 8000) problems.push("Поручение для расписания — не длиннее 8000 знаков.");

  const patch: Record<string, unknown> = {};
  if (form.model !== base.model) patch.model = form.model;
  if (cron !== detail.scheduleCron) patch.scheduleCron = cron;
  if (form.tz !== base.tz) patch.scheduleTz = form.tz;
  if (form.prompt.trim() !== base.prompt.trim()) patch.schedulePromptOverride = form.prompt.trim() === "" ? null : form.prompt;
  if (form.website !== base.website) patch.triggerWebsiteLead = form.website;
  if (form.whatsapp !== base.whatsapp) patch.triggerWhatsappInbound = form.whatsapp;
  if (problems.length === 0 && String(budget) !== String(detail.runBudgetUsd)) patch.runBudgetUsd = budget;
  if (form.claudeId.trim() !== base.claudeId) patch.claudeAgentId = form.claudeId.trim() === "" ? null : form.claudeId.trim();
  const dirty = Object.keys(patch).length > 0;
  const effectivePrompt = (detail.schedulePromptOverride ?? defaultSchedulePrompt ?? "").trim();
  const timezones = SCHEDULE_TIMEZONES.includes(form.tz) ? SCHEDULE_TIMEZONES : [form.tz, ...SCHEDULE_TIMEZONES];

  if (!canEdit) {
    const rows: readonly (readonly [string, string])[] = [
      ["Модель", AI_AGENT_MODELS.find((model) => model.id === detail.model)?.label ?? detail.model],
      ["Расписание", describeSchedule(detail.scheduleCron, detail.scheduleTz)],
      ["Реагирует на", [detail.triggerWebsiteLead ? "новую заявку с сайта" : null, detail.triggerWhatsappInbound ? "новое сообщение в WhatsApp" : null].filter(Boolean).join(", ") || "ничего: запускается поручением или по расписанию"],
      ["Потолок расхода на запуск", detail.runBudgetUsd === 0 ? "без потолка" : formatUsd(detail.runBudgetUsd)],
    ];
    return (
      <section className="rounded-card border border-border bg-surface p-4" aria-labelledby="aia-settings-read" data-testid="v3-aia-settings-read">
        <h2 id="aia-settings-read" className="t-section text-fg">Параметры агента</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 @2xl:grid-cols-2">
          {rows.map(([name, value]) => (
            <div key={name}><dt className="t-meta text-fg-3">{name}</dt><dd className="t-body-compact text-fg">{value}</dd></div>
          ))}
        </dl>
        <p className="mt-4 t-meta text-fg-3">Параметры меняет системный администратор.</p>
        <RunNow run={run} agentKey={detail.key} prompt={effectivePrompt} canRunNow={canRunNow} note={runNowNote} />
      </section>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || problems.length > 0 || save.pending) return;
        save.submit({ key: detail.key, expected_version: String(detail.configVersion), patch: JSON.stringify(patch) });
      }}
      data-testid="v3-aia-settings"
    >
      <fieldset className="rounded-card border border-border bg-surface p-4">
        <legend className="float-left w-full t-section text-fg">Модель</legend>
        <div className="clear-both space-y-1 pt-2">
          {AI_AGENT_MODELS.map((model) => (
            <label key={model.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-nav px-2 py-2 hover:bg-surface-2/60">
              <input type="radio" name="aia-model" className="mt-1 size-4 accent-[var(--text)]" checked={form.model === model.id} onChange={() => set("model", model.id)} />
              <span className="t-body-compact"><span className="font-medium text-fg">{model.label}</span><span className="block text-fg-2">{model.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-border bg-surface p-4">
        <legend className="float-left w-full t-section text-fg">Расписание</legend>
        <p className="clear-both pt-1 t-body-compact text-fg-2">{describeSchedule(cron, form.tz)}</p>
        <div className="mt-3 grid gap-3 @2xl:grid-cols-3">
          <div>
            <label htmlFor="aia-kind" className={fieldLabelCls}>Как часто</label>
            <select id="aia-kind" className={inputCls} value={form.kind} onChange={(event) => set("kind", event.target.value as Kind)}>
              {(["none", "daily", "weekdays", "weekly"] as const).map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
              {form.kind === "custom" ? <option value="custom">{KIND_LABELS.custom}</option> : null}
            </select>
          </div>
          {form.kind !== "none" && form.kind !== "custom" ? (
            <div>
              <label htmlFor="aia-time" className={fieldLabelCls}>Время</label>
              <input id="aia-time" type="time" className={inputCls} value={form.time} onChange={(event) => set("time", event.target.value)} />
            </div>
          ) : null}
          {form.kind === "weekly" ? (
            <div>
              <label htmlFor="aia-weekday" className={fieldLabelCls}>День недели</label>
              <select id="aia-weekday" className={inputCls} value={form.weekday} onChange={(event) => set("weekday", Number(event.target.value))}>
                {SCHEDULE_WEEKDAY_OPTIONS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
              </select>
            </div>
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 @2xl:grid-cols-3">
          <div>
            <label htmlFor="aia-tz" className={fieldLabelCls}>Часовой пояс</label>
            <select id="aia-tz" className={inputCls} value={form.tz} onChange={(event) => set("tz", event.target.value)}>
              {timezones.map((tz) => <option key={tz} value={tz}>{timezoneLabel(tz)}</option>)}
            </select>
          </div>
        </div>
        <details className="mt-3" open={form.kind === "custom"}>
          <summary className="cursor-pointer t-label text-fg-2">Расширенно: cron для разработчиков</summary>
          <label htmlFor="aia-cron" className={`${fieldLabelCls} mt-2`}>Cron (минута час день месяц день_недели)</label>
          <input
            id="aia-cron"
            className={`${inputCls} max-w-xs font-mono`}
            value={form.cron}
            placeholder="0 9 * * 1"
            onChange={(event) => { set("cron", event.target.value); set("kind", "custom"); }}
          />
        </details>

        <div className="mt-4">
          <label htmlFor="aia-prompt" className={fieldLabelCls}>Поручение для запуска по расписанию</label>
          <textarea
            id="aia-prompt"
            rows={4}
            maxLength={8000}
            value={form.prompt}
            placeholder={defaultSchedulePrompt ?? "Расписание для этого агента не предусмотрено — напишите поручение сами."}
            onChange={(event) => set("prompt", event.target.value)}
            className="min-h-24 w-full resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2.5 text-base text-fg placeholder:text-fg-3 focus-visible:border-accent"
          />
          <p className="mt-1 t-meta text-fg-3">
            {form.prompt.trim() === "" ? (defaultSchedulePrompt ? "Пусто — используется стандартное поручение EVO (видно серым)." : "Пусто — по расписанию агенту нечего поручить, расписание не создаётся.") : "Используется ваше поручение."}
          </p>
        </div>
        <RunNow run={run} agentKey={detail.key} prompt={effectivePrompt} canRunNow={canRunNow} note={runNowNote} />
      </fieldset>

      <fieldset className="rounded-card border border-border bg-surface p-4">
        <legend className="float-left w-full t-section text-fg">Реагировать на</legend>
        <div className="clear-both space-y-1 pt-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-nav px-2 hover:bg-surface-2/60">
            <input type="checkbox" className="size-4 accent-[var(--text)]" checked={form.website} onChange={(event) => set("website", event.target.checked)} />
            <span className="t-body-compact text-fg">Новая заявка с сайта</span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-nav px-2 hover:bg-surface-2/60">
            <input type="checkbox" className="size-4 accent-[var(--text)]" checked={form.whatsapp} onChange={(event) => set("whatsapp", event.target.checked)} />
            <span className="t-body-compact text-fg">Новое входящее сообщение в WhatsApp</span>
          </label>
        </div>
        <p className="mt-1 max-w-[60ch] t-meta text-fg-3">События запускают агента только пока он включён и синхронизирован.</p>
      </fieldset>

      <fieldset className="rounded-card border border-border bg-surface p-4">
        <legend className="float-left w-full t-section text-fg">Расход и привязка</legend>
        <div className="clear-both grid gap-4 pt-3 @2xl:grid-cols-2">
          <div>
            <label htmlFor="aia-budget" className={fieldLabelCls}>Потолок расхода на один запуск, $</label>
            <input id="aia-budget" inputMode="decimal" className={`${inputCls} max-w-[10rem]`} value={form.budget} onChange={(event) => set("budget", event.target.value)} />
            <p className="mt-1 t-meta text-fg-3">0 — без потолка. Общие лимиты расходов владелец задаёт в Claude Console.</p>
          </div>
          <div>
            <label htmlFor="aia-claude-id" className={fieldLabelCls}>ID агента в Claude (если создан в Console)</label>
            <input id="aia-claude-id" className={`${inputCls} font-mono`} value={form.claudeId} placeholder="agent_…" onChange={(event) => set("claudeId", event.target.value)} />
            <p className="mt-1 t-meta text-fg-3">Пусто — агента создаст синхронизация.</p>
          </div>
        </div>
      </fieldset>

      {problems.length > 0 ? (
        <ul role="alert" className="space-y-0.5 t-body-compact text-danger" data-testid="v3-aia-settings-problems">
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btnCls} disabled={!dirty || problems.length > 0 || save.pending} data-testid="v3-aia-settings-save">
          {save.pending ? "Сохраняю…" : "Сохранить настройки"}
        </button>
        {dirty ? <button type="button" className={btnGhostCls} disabled={save.pending} onClick={() => setForm(base)}>Отменить правки</button> : null}
      </div>
      <ActionMessage state={save.state} testId="v3-aia-settings-message" />
    </form>
  );
}

function RunNow({
  run,
  agentKey,
  prompt,
  canRunNow,
  note,
}: Readonly<{
  run: ReturnType<typeof useAgentsAction>;
  agentKey: AiAgentDetail["key"];
  prompt: string;
  canRunNow: boolean;
  note: string | null;
}>) {
  const disabled = !canRunNow || !prompt || run.pending;
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-4">
      <button
        type="button"
        className={btnGhostCls}
        disabled={disabled}
        onClick={() => run.submit({ key: agentKey, text: prompt, send_authority: "0" })}
        data-testid="v3-aia-run-schedule-now"
      >
        {run.pending ? "Запускаю…" : "Запустить по расписанию сейчас"}
      </button>
      {!prompt ? <p className="t-meta text-fg-3">Нет поручения для расписания — запускать нечего.</p> : !canRunNow && note ? <p className="t-meta text-fg-3">{note}</p> : null}
      {run.state.status === "saved" && run.state.runId ? (
        <p role="status" className="t-body-compact text-fg-2">
          Запуск начат. <Link href={aiAgentHref(agentKey, { tab: "command", run: run.state.runId })} className="text-fg underline underline-offset-4">Открыть ход работы</Link>
        </p>
      ) : (
        <ActionMessage state={run.state} />
      )}
    </div>
  );
}
