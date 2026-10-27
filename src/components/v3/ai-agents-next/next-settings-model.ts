import type { AiAgentDetail, AiAgentModelId } from "@/lib/ai-agents/contract";
import { cronFromPlan, isValidCron, parseCronPlan, type ScheduleKind } from "@/lib/v3/ai-agents-view";

/**
 * Форма «Настроек» агента: начальные значения, проверка и патч. Правила те же, что у `SettingsForm` прежнего вида
 * (тот же `ai_agents_update_v1`): уходит один патч — только изменённые поля. Чистые функции, без React.
 */
export type ScheduleChoice = ScheduleKind | "custom";
export const SCHEDULE_CHOICE_LABELS: Readonly<Record<ScheduleChoice, string>> = {
  none: "Нет", daily: "Каждый день", weekdays: "По будням", weekly: "Раз в неделю", custom: "Своё расписание",
};
export const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
export const MINUTE_STEPS = Array.from({ length: 12 }, (_, step) => String(step * 5).padStart(2, "0"));
const CLAUDE_AGENT_ID = /^agent_[A-Za-z0-9]{8,64}$/u;

export function initialSettings(detail: AiAgentDetail) {
  const plan = parseCronPlan(detail.scheduleCron);
  return {
    model: detail.model as AiAgentModelId,
    kind: (plan === "custom" ? "custom" : plan.kind) as ScheduleChoice,
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
export type SettingsValues = ReturnType<typeof initialSettings>;

export function settingsCron(form: SettingsValues): string | null {
  return form.kind === "custom" ? (form.cron.trim() === "" ? null : form.cron.trim()) : cronFromPlan({ kind: form.kind, time: form.time, weekday: form.weekday });
}

export function settingsProblems(form: SettingsValues): string[] {
  const problems: string[] = [];
  const cron = settingsCron(form);
  const budget = Number(form.budget.replace(",", "."));
  if (form.kind === "custom" && cron !== null && !isValidCron(cron)) problems.push("Cron: пять полей из цифр и знаков * / , - (например, 0 9 * * 1).");
  if (form.kind !== "custom" && form.kind !== "none" && !/^([01]\d|2[0-3]):[0-5]\d$/u.test(form.time)) problems.push("Время расписания — в формате ЧЧ:ММ.");
  if (form.budget.trim() === "" || !Number.isFinite(budget) || budget < 0 || budget > 100) problems.push("Потолок расхода — число от 0 до 100 долларов.");
  if (form.claudeId.trim() !== "" && !CLAUDE_AGENT_ID.test(form.claudeId.trim())) problems.push("ID агента в Claude начинается с «agent_».");
  if (form.prompt.length > 8000) problems.push("Поручение для расписания — не длиннее 8000 знаков.");
  return problems;
}

export function settingsPatch(form: SettingsValues, base: SettingsValues, detail: AiAgentDetail, problems: readonly string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const cron = settingsCron(form);
  const budget = Number(form.budget.replace(",", "."));
  if (form.model !== base.model) patch.model = form.model;
  if (cron !== detail.scheduleCron) patch.scheduleCron = cron;
  if (form.tz !== base.tz) patch.scheduleTz = form.tz;
  if (form.prompt.trim() !== base.prompt.trim()) patch.schedulePromptOverride = form.prompt.trim() === "" ? null : form.prompt;
  if (form.website !== base.website) patch.triggerWebsiteLead = form.website;
  if (form.whatsapp !== base.whatsapp) patch.triggerWhatsappInbound = form.whatsapp;
  if (problems.length === 0 && String(budget) !== String(detail.runBudgetUsd)) patch.runBudgetUsd = budget;
  if (form.claudeId.trim() !== base.claudeId) patch.claudeAgentId = form.claudeId.trim() === "" ? null : form.claudeId.trim();
  return patch;
}
