import Link from "next/link";

import { AI_AGENT_DEFAULTS } from "@/content/ai-agents";
import {
  AI_AGENT_GROUPS,
  AI_AGENT_GROUP_LABELS,
  AI_AGENT_RUN_STATUS_LABELS,
  type AiAgentListItem,
  type AiAgentsListResult,
} from "@/lib/ai-agents/contract";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { MetricCard, type Metric } from "@/components/v3/MetricCard";
import {
  aiAgentHref,
  aiAgentIsRunnable,
  aiAgentRoleLine,
  aiAgentStateChip,
  formatUsdCents,
  pluralRu,
  relativeTimeRu,
} from "@/lib/v3/ai-agents-view";

import { RunsSparkline } from "./Charts";
import { ApiKeyMissingLine } from "./Notices";
import { PendingTile } from "./PendingTile";

/**
 * Хаб «ИИ-агенты» (контракт §D.3): полоса показателей, три группы карточек
 * (Продажи / Аналитика / Кураторы) и отдельная карточка Gemini-помощника.
 * Вся карточка — ссылка на страницу агента (заголовок растянут на карточку), а
 * «Поручить» и очередь черновиков — отдельные ссылки поверх неё. Состояние — словом,
 * спарклайн — запуски за 14 дней. Агенты без инструкции не занимают карточек: они
 * одной строкой «Не настроены» со ссылками.
 */

const hasInstructionsOf = (agent: AiAgentListItem) => agent.hasInstructionsOverride || AI_AGENT_DEFAULTS[agent.key].hasInstructions;
const LINK_ON_CARD = "relative z-10 inline-flex min-h-11 items-center rounded-nav t-label text-fg underline-offset-4 hover:underline";

function AgentCard({
  agent,
  now,
  canAsk,
}: Readonly<{ agent: AiAgentListItem; now: string; canAsk: boolean }>) {
  // Карточка не знает точного хеша настроек (его считает страница агента): «Нужна синхронизация» — по статусу.
  const state = aiAgentStateChip({ enabled: agent.enabled, hasInstructions: true, syncStatus: agent.sync.status, needsSync: false });
  const { stats } = agent;
  const lastRun = stats.lastRunAt
    ? `${relativeTimeRu(stats.lastRunAt, now)}${stats.lastRunStatus ? ` · ${AI_AGENT_RUN_STATUS_LABELS[stats.lastRunStatus]}` : ""}`
    : "ещё не запускался";
  const runnable = canAsk && agent.enabled && aiAgentIsRunnable(agent.sync);
  return (
    <li
      data-testid={`v3-aia-card-${agent.key}`}
      className="relative flex flex-col gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus-ring motion-reduce:transition-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h3 className="t-item min-w-0 text-fg">
          <Link href={aiAgentHref(agent.key)} className="rounded-nav outline-none after:absolute after:inset-0 after:rounded-card">
            {agent.title}
          </Link>
        </h3>
        <span className="flex flex-wrap items-center gap-1.5">
          {agent.autoSend ? <StatusChip label="Авто: вкл" tone="warn" title="Агент сам пишет клиентам и студентам без одобрения" /> : null}
          <StatusChip label={state.label} tone={state.tone} />
        </span>
      </div>
      <p className="t-body-compact line-clamp-2 text-fg-2">{aiAgentRoleLine(agent.roleLine)}</p>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pt-1">
        <dl className="grid min-w-0 gap-0.5 t-meta text-fg-2">
          <div><dt className="inline text-fg-3">Последний запуск: </dt><dd className="inline">{lastRun}</dd></div>
          <div><dt className="inline text-fg-3">Расход за 7 дней: </dt><dd className="inline tabular-nums">{formatUsdCents(stats.costCents7d)}</dd></div>
        </dl>
        <div className="w-28 shrink-0 @max-md:w-full">
          <RunsSparkline values={stats.runsPerDay14} />
          <p className="mt-1 t-meta text-fg-3">Запуски, 14 дней</p>
        </div>
      </div>
      {runnable || stats.draftsPending > 0 ? (
        <div className="-mb-2 flex flex-wrap items-center gap-x-5">
          {runnable ? <Link href={aiAgentHref(agent.key, { tab: "command" })} className={LINK_ON_CARD} data-testid={`v3-aia-ask-${agent.key}`}>Поручить →</Link> : null}
          {stats.draftsPending > 0 ? (
            <Link href={aiAgentHref(agent.key, { tab: "drafts" })} className={`${LINK_ON_CARD} font-medium`} data-testid={`v3-aia-drafts-${agent.key}`}>
              {stats.draftsPending} {pluralRu(stats.draftsPending, ["черновик ждёт", "черновика ждут", "черновиков ждут"])} решения
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function AgentsHub({
  list,
  runtimeConfigured,
  preview = false,
}: Readonly<{ list: AiAgentsListResult; runtimeConfigured: boolean; /** Просмотр роли ничего не меняет и не поручает. */ preview?: boolean }>) {
  // Плитка с общим числом — ссылка, только когда очередь одна и число — её: иначе ссылка вела бы в часть (карточки ведут в каждую).
  const withDrafts = list.agents.filter((agent) => agent.stats.draftsPending > 0);
  const pendingAgent = withDrafts.length === 1 ? withDrafts[0] : undefined;
  const metrics: readonly Metric[] = [
    { label: "Включено агентов", value: list.summary.enabled, insteadOfDelta: `из ${list.agents.length}` },
    { label: "Запусков за 7 дней", value: list.summary.runs7d, insteadOfDelta: null },
    { label: "Расход за 7 дней", value: formatUsdCents(list.summary.costCents7d), insteadOfDelta: null },
  ];
  return (
    <div className="space-y-6" data-testid="v3-aia-hub">
      {runtimeConfigured ? null : <ApiKeyMissingLine />}
      <ul className="grid grid-cols-2 gap-3 @4xl:grid-cols-4" aria-label="Показатели за 7 дней">
        {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
        {pendingAgent && list.summary.draftsPending > 0
          ? <PendingTile value={list.summary.draftsPending} href={aiAgentHref(pendingAgent.key, { tab: "drafts" })} />
          : <MetricCard metric={{ label: "Ждут решения", value: list.summary.draftsPending, insteadOfDelta: null }} />}
      </ul>

      <div className="grid gap-x-3 gap-y-6 @3xl:grid-cols-2">
        {AI_AGENT_GROUPS.map((group) => {
          const agents = list.agents.filter((agent) => agent.groupKey === group).sort((a, b) => a.sortOrder - b.sortOrder);
          if (agents.length === 0) return null;
          const ready = agents.filter(hasInstructionsOf);
          const unset = agents.filter((agent) => !hasInstructionsOf(agent));
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
              {ready.length > 0 ? (
                <ul className={`grid gap-3 ${ready.length > 1 ? "@3xl:grid-cols-2" : ""}`}>
                  {ready.map((agent) => (
                    <AgentCard key={agent.key} agent={agent} now={list.now} canAsk={runtimeConfigured && !preview && !(agent.key === "director" && !list.isAdmin)} />
                  ))}
                </ul>
              ) : null}
              {unset.length > 0 ? (
                <ul className={`${ready.length > 0 ? "mt-3 " : ""}flex flex-wrap items-center gap-2`} aria-label="Агенты без правил">
                  <li className="pe-1 t-meta text-fg-3">Не настроены:</li>
                  {unset.map((agent) => (
                    <li key={agent.key} data-testid={`v3-aia-card-${agent.key}`}>
                      <Link
                        href={aiAgentHref(agent.key)}
                        className="inline-flex min-h-11 items-center rounded-nav border border-border px-3 t-label text-fg-2 hover:border-border-strong hover:bg-surface-2 hover:text-fg"
                      >
                        {agent.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      <section aria-label="Помощник в чате WhatsApp" data-testid="v3-aia-gemini">
        <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus-ring motion-reduce:transition-none">
          <h2 className="t-item text-fg">
            <Link href="/v3/ai-agent" className="rounded-nav outline-none after:absolute after:inset-0 after:rounded-card">Помощник в чате WhatsApp</Link>
          </h2>
          <p className="t-body-compact text-fg-2">Подсказывает ответ, сам ничего не отправляет.</p>
        </div>
      </section>
    </div>
  );
}
