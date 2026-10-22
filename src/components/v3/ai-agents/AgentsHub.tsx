import Link from "next/link";

import { AI_AGENT_DEFAULTS } from "@/content/ai-agents";
import {
  AI_AGENT_GROUPS,
  AI_AGENT_GROUP_LABELS,
  AI_AGENT_MODELS,
  AI_AGENT_RUN_STATUS_LABELS,
  type AiAgentListItem,
  type AiAgentsListResult,
} from "@/lib/ai-agents/contract";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { MetricCard, type Metric } from "@/components/v3/MetricCard";
import {
  aiAgentHref,
  aiAgentStateChip,
  formatUsdCents,
  pluralRu,
  relativeTimeRu,
} from "@/lib/v3/ai-agents-view";

import { RunsSparkline } from "./Charts";
import { ApiKeyMissingLine } from "./Notices";

/**
 * Хаб «ИИ-агенты» (контракт §D.3): полоса показателей, три группы карточек
 * (Продажи / Аналитика / Кураторы) и отдельная карточка Gemini-помощника.
 * Вся карточка — ссылка на страницу агента (заголовок растянут на карточку);
 * состояние — словом, спарклайн — запуски за 14 дней.
 */

const modelLabel = (id: string) => AI_AGENT_MODELS.find((model) => model.id === id)?.label.replace("Claude ", "") ?? id;

function AgentCard({ agent, now }: Readonly<{ agent: AiAgentListItem; now: string }>) {
  const hasInstructions = agent.hasInstructionsOverride || AI_AGENT_DEFAULTS[agent.key].hasInstructions;
  // Карточка не знает точного хеша настроек (его считает страница агента): «Нужна синхронизация» — по статусу.
  const state = aiAgentStateChip({ enabled: agent.enabled, hasInstructions, syncStatus: agent.sync.status, needsSync: false });
  const { stats } = agent;
  const lastRun = stats.lastRunAt
    ? `${relativeTimeRu(stats.lastRunAt, now)}${stats.lastRunStatus ? ` · ${AI_AGENT_RUN_STATUS_LABELS[stats.lastRunStatus]}` : ""}`
    : "ещё не запускался";
  return (
    <li
      data-testid={`v3-aia-card-${agent.key}`}
      className={`relative flex flex-col gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong motion-reduce:transition-none ${hasInstructions ? "" : "bg-transparent"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h3 className="t-item min-w-0 text-fg">
          <Link href={aiAgentHref(agent.key)} className="rounded-nav after:absolute after:inset-0 after:rounded-card">
            {agent.title}
          </Link>
        </h3>
        <StatusChip label={state.label} tone={state.tone} />
      </div>
      <p className={`t-body-compact line-clamp-2 ${hasInstructions ? "text-fg-2" : "text-fg-3"}`}>{agent.roleLine}</p>
      {hasInstructions ? (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <StatusChip label={agent.autoSend ? "Авто: вкл" : "Авто: выкл"} tone={agent.autoSend ? "warn" : "neutral"} />
            <span className="t-meta text-fg-3">{modelLabel(agent.model)}</span>
          </div>
          <div className="mt-auto flex items-end justify-between gap-4 pt-1">
            <dl className="grid min-w-0 gap-0.5 t-meta text-fg-2">
              <div><dt className="inline text-fg-3">Последний запуск: </dt><dd className="inline">{lastRun}</dd></div>
              <div><dt className="inline text-fg-3">Расход за 7 дней: </dt><dd className="inline tabular-nums">{formatUsdCents(stats.costCents7d)}</dd></div>
              {stats.draftsPending > 0 ? (
                <div className="font-medium text-fg">
                  {stats.draftsPending} {pluralRu(stats.draftsPending, ["черновик ждёт", "черновика ждут", "черновиков ждут"])} решения
                </div>
              ) : null}
            </dl>
            <div className="w-28 shrink-0">
              <RunsSparkline values={stats.runsPerDay14} />
              <p className="mt-1 t-meta text-fg-3">Запуски, 14 дней</p>
            </div>
          </div>
        </>
      ) : null}
    </li>
  );
}

export function AgentsHub({
  list,
  runtimeConfigured,
}: Readonly<{ list: AiAgentsListResult; runtimeConfigured: boolean }>) {
  const metrics: readonly Metric[] = [
    {
      label: "Включено агентов",
      value: list.summary.enabled,
      insteadOfDelta: list.summary.enabled === 0 ? "пока ни один не включён" : `из ${list.agents.length}`,
    },
    { label: "Запусков за 7 дней", value: list.summary.runs7d, insteadOfDelta: list.summary.runs7d === 0 ? "запусков ещё не было" : null },
    { label: "Расход за 7 дней", value: formatUsdCents(list.summary.costCents7d), insteadOfDelta: "лимиты — в Claude Console" },
    {
      label: "Ждут решения",
      value: list.summary.draftsPending,
      insteadOfDelta: list.summary.draftsPending === 0 ? "черновиков нет" : pluralRu(list.summary.draftsPending, ["черновик", "черновика", "черновиков"]),
    },
  ];
  return (
    <div className="space-y-6" data-testid="v3-aia-hub">
      {runtimeConfigured ? null : <ApiKeyMissingLine />}
      <ul className="grid grid-cols-2 gap-3 @4xl:grid-cols-4" aria-label="Показатели за 7 дней">
        {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </ul>

      <div className="grid gap-x-3 gap-y-6 @3xl:grid-cols-2">
        {AI_AGENT_GROUPS.map((group) => {
          const agents = list.agents.filter((agent) => agent.groupKey === group).sort((a, b) => a.sortOrder - b.sortOrder);
          if (agents.length === 0) return null;
          // Группа из одного агента стоит в одной колонке рядом с такой же; длинная — на всю ширину.
          return (
            <section
              key={group}
              aria-labelledby={`aia-group-${group}`}
              data-testid={`v3-aia-group-${group}`}
              className={agents.length > 1 ? "@3xl:col-span-2" : undefined}
            >
              <h2 id={`aia-group-${group}`} className="t-section mb-3 flex items-baseline gap-2 text-fg">
                {AI_AGENT_GROUP_LABELS[group]}
                <span className="font-normal tabular-nums text-fg-3">{agents.length}</span>
              </h2>
              <ul className={`grid gap-3 ${agents.length > 1 ? "@3xl:grid-cols-2" : ""}`}>
                {agents.map((agent) => <AgentCard key={agent.key} agent={agent} now={list.now} />)}
              </ul>
            </section>
          );
        })}
      </div>

      <section aria-labelledby="aia-gemini" data-testid="v3-aia-gemini">
        <h2 id="aia-gemini" className="t-section mb-3 text-fg">Помощник в чате (Gemini)</h2>
        <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong motion-reduce:transition-none">
          <div className="min-w-0">
            <h3 className="t-item text-fg">
              <Link href="/v3/ai-agent" className="rounded-nav after:absolute after:inset-0 after:rounded-card">ИИ-агент в чате WhatsApp</Link>
            </h3>
            <p className="mt-1 max-w-[56ch] t-body-compact text-fg-2">Подсказывает ответ в чате WhatsApp, сам ничего не отправляет.</p>
          </div>
          <p className="t-meta text-fg-3">Информация для агента, Лист сверки, Лаборатория, Автоответчик</p>
        </div>
      </section>
    </div>
  );
}
