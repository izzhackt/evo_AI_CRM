"use client";

import { useState } from "react";

import { HelpTip, KeyFacts, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AI_AGENT_MODELS, type AiAgentDetail } from "@/lib/ai-agents/contract";
import { dailyCapLine, dailyCapValue } from "@/lib/ai-agents/daily-cap";
import { startAiAgentRunAction, updateAiAgentAction } from "@/lib/platform-ai-agents-actions";
import { describeSchedule, formatUsd } from "@/lib/v3/ai-agents-view";

import { ActionMessage } from "@/components/v3/ai-agents/Notices";
import { useAgentsAction } from "@/components/v3/ai-agents/useAgentsAction";
import { useDirtyGuard } from "@/components/v3/ai-agents/useDirtyGuard";
import { STATIC_BAR, STICKY_BAR } from "./buttons";
import { initialSettings, settingsPatch, settingsProblems, type SettingsValues } from "./next-settings-model";
import { NextModelCard } from "./NextModelCard";
import { NextRunNow } from "./NextRunNow";
import { NextScheduleCard } from "./NextScheduleCard";
import { NextSyncCard, type NextSyncCardProps } from "./NextSyncCard";

type WhatsappCap = Readonly<{ capCents: number; spentTodayCents: number; reservedCents?: number }>;

/**
 * «Настройки» агента в «Новом виде»: сгруппированные карточки (модель и расход, расписание и события, синхронизация с
 * Claude) и одна панель «Сохранить настройки» — уходит один патч, только изменённые поля, то же `ai_agents_update_v1`.
 * ID агента в Claude правится в панели «Технические данные» карточки синхронизации (одна кнопка, без пустой карточки);
 * правка уходит тем же патчем. Не администратор видит те же значения карточкой «Параметры агента». Форма возвращается к
 * значениям сервера только когда версия настроек сменилась (запись прошла), а не при каждой перерисовке страницы.
 */
export function NextSettings({
  detail, defaultSchedulePrompt, canEdit, canRunNow, runNowNote, whatsappCap = null, sync,
}: Readonly<{ detail: AiAgentDetail; defaultSchedulePrompt: string | null; canEdit: boolean; canRunNow: boolean; runNowNote: string | null; whatsappCap?: WhatsappCap | null; /** Карточка синхронизации: стоит перед панелью «Сохранить настройки». */ sync: Omit<NextSyncCardProps, "idField"> }>) {
  const base = initialSettings(detail);
  const [form, setForm] = useState(base);
  const [seenVersion, setSeenVersion] = useState(detail.configVersion);
  if (seenVersion !== detail.configVersion) { setSeenVersion(detail.configVersion); setForm(initialSettings(detail)); }
  const save = useAgentsAction(updateAiAgentAction);
  const run = useAgentsAction(startAiAgentRunAction);
  const set = <K extends keyof SettingsValues>(name: K, value: SettingsValues[K]) => setForm((previous) => ({ ...previous, [name]: value }));

  const problems = settingsProblems(form);
  const patch = settingsPatch(form, base, detail, problems);
  const dirty = Object.keys(patch).length > 0;
  useDirtyGuard(dirty && canEdit);
  const effectivePrompt = (detail.schedulePromptOverride ?? defaultSchedulePrompt ?? "").trim();
  const capState = { whatsappOn: detail.triggerWhatsappInbound, reservedCents: whatsappCap?.reservedCents ?? 0 };
  const runNow = <NextRunNow run={run} agentKey={detail.key} prompt={effectivePrompt} canRunNow={canRunNow} note={runNowNote} budgetUsd={detail.runBudgetUsd} />;

  if (!canEdit) {
    const events = [detail.triggerWebsiteLead ? "новую заявку с сайта" : null, detail.triggerWhatsappInbound ? "новое сообщение в WhatsApp" : null].filter(Boolean).join(", ");
    return (
      <div className="grid gap-4" data-testid="v3-aia-settings-read">
        <WidgetCard title="Параметры агента" help="Параметры меняет системный администратор." footer={effectivePrompt ? runNow : undefined}>
          <KeyFacts columns={2} facts={[
            { label: "Модель", value: AI_AGENT_MODELS.find((model) => model.id === detail.model)?.label ?? detail.model },
            { label: "Расписание", value: describeSchedule(detail.scheduleCron, detail.scheduleTz) },
            { label: "Реагирует на", value: events || "ничего" },
            { label: "Потолок расхода на запуск", value: detail.runBudgetUsd === 0 ? "без потолка" : formatUsd(detail.runBudgetUsd) },
            { label: "Лимит на WhatsApp", value: whatsappCap ? dailyCapValue(whatsappCap.capCents, whatsappCap.spentTodayCents, capState) : null },
          ]} />
        </WidgetCard>
        <NextSyncCard {...sync} />
      </div>
    );
  }

  const idProblem = problems.find((problem) => problem.startsWith("ID агента"));
  // ID агента правится в панели «Технические данные»: несохранённая правка поднимает панель «Сохранить настройки» под карточками.
  const idField = (
    <div className="grid gap-1.5" data-testid="v3-aia-claude-id">
      <div className="flex items-center gap-1.5">
        <Label htmlFor="aia-claude-id">ID агента в Claude</Label>
        <HelpTip label="Пояснение: ID агента в Claude">Пусто — синхронизация подключит уже созданного агента EVO или создаст нового. Чтобы получить нового, сначала архивируйте прежнего в Claude Console.</HelpTip>
      </div>
      <Input id="aia-claude-id" className="font-mono" value={form.claudeId} placeholder="agent_…" aria-invalid={idProblem ? true : undefined} onChange={(event) => set("claudeId", event.target.value)} />
      <p className="t-meta text-warn">Смена ID привязывает другого агента Claude.</p>
      {idProblem ? <p className="t-meta text-danger">{idProblem}</p> : null}
    </div>
  );

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => { event.preventDefault(); if (dirty && problems.length === 0 && !save.pending) save.submit({ key: detail.key, expected_version: String(detail.configVersion), patch: JSON.stringify(patch) }); }}
      data-testid="v3-aia-settings"
    >
      <NextModelCard form={form} set={set} capLine={whatsappCap ? dailyCapLine(whatsappCap.capCents, whatsappCap.spentTodayCents, capState) : null} />
      <NextScheduleCard form={form} set={set} defaultPrompt={defaultSchedulePrompt} footer={effectivePrompt ? runNow : undefined} />
      <NextSyncCard {...sync} idField={idField} />
      {problems.length > 0 ? (
        <ul role="alert" className="grid gap-0.5 t-body-compact text-danger" data-testid="v3-aia-settings-problems">
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      ) : null}
      <div className={dirty ? STICKY_BAR : STATIC_BAR}>
        <Button type="submit" disabled={!dirty || problems.length > 0 || save.pending} data-testid="v3-aia-settings-save">{save.pending ? "Сохраняю…" : "Сохранить настройки"}</Button>
        {dirty ? <Button type="button" variant="outline" disabled={save.pending} onClick={() => setForm(base)}>Отменить правки</Button> : null}
        <ActionMessage state={save.state} testId="v3-aia-settings-message" />
      </div>
    </form>
  );
}
