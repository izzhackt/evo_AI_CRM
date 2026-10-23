import "../../../ai-agents.css";

import Link from "next/link";
import { notFound } from "next/navigation";

import { AI_AGENT_DEFAULTS } from "@/content/ai-agents";
import { AgentBody } from "@/components/v3/ai-agents/AgentBody";
import { AgentSwitches } from "@/components/v3/ai-agents/AgentSwitches";
import { NotReady, Unavailable } from "@/components/v3/ai-agents/Notices";
import { Icon } from "@/components/icons";
import { PartShell } from "@/components/v3/PartShell";
import { taskComposerAccess } from "@/components/v3/tasks/task-composer-access";
import { isAiAgentKey, type AiAgentRunRow } from "@/lib/ai-agents/contract";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { computeAiAgentConfigHash, resolveAiAgentsMcpUrl } from "@/lib/server/ai-agents/config-hash";
import { aiAgentsRuntimeAvailability, reconcileAiAgentRuns } from "@/lib/server/ai-agents/runtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  aiAgentHref,
  aiAgentNeedsSync,
  AI_AGENT_CONVERSATIONS_MAX,
  AI_AGENT_CONVERSATIONS_READ,
  AI_AGENTS_HUB_HREF,
  ownCommandRuns,
  parseAiAgentRoute,
} from "@/lib/v3/ai-agents-view";
import {
  readAiAgent,
  readAiAgentDigests,
  readAiAgentDrafts,
  readAiAgentRun,
  readAiAgentRuns,
} from "@/lib/v3/ai-agents-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "ИИ-агенты" };

type Query = Record<string, string | string[] | undefined>;
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

/**
 * Страница агента (контракт §D.4): шапка с переключателями «Включён» и «Авто»
 * (меняет только системный администратор), шесть вкладок настоящими ссылками
 * `?tab=`: Обзор · Поручить · Запуски · Черновики · Инструкция · Настройки.
 * Читается только то, что нужно выбранной вкладке; хеш «нужна синхронизация»
 * считает сервер. Неизвестный ключ или вкладка — 404. «Поручить» занимает
 * высоту окна (`fill`) и получает собственные разговоры сотрудника.
 */
export default async function AiAgentPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ key: string }>; searchParams: Promise<Query> }>) {
  const { key } = await params;
  if (!isAiAgentKey(key)) notFound();
  const route = parseAiAgentRoute(await searchParams);
  if (!route) notFound();
  const actor = await requireV3PageActor("/v3/ai-agents");
  const preview = isStaffPreview(actor);
  const runtime = aiAgentsRuntimeAvailability();
  if (runtime.configured && !preview) {
    try { await reconcileAiAgentRuns({ staffClient: await createSupabaseServerClient(), actor }, { key }); } catch { /* сверка ленивая */ }
  }

  const read = await readAiAgent(actor, key);
  if (read.status === "missing") notFound();
  const back = (
    <Link href={AI_AGENTS_HUB_HREF} className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-nav t-label text-fg-2 hover:text-fg">
      <Icon name="arrow-left" size={16} /> Все ИИ-агенты
    </Link>
  );
  if (read.status !== "available") {
    return (
      <PartShell title="ИИ-агенты" testId="v3-ai-agent-page" back={back}>
        {read.status === "not_ready" ? <NotReady /> : <Unavailable what="агента" retryHref={aiAgentHref(key)} denied={read.status === "denied"} />}
      </PartShell>
    );
  }
  const detail = read.data;
  const canEdit = actor.systemRole === "admin" && !preview;
  const canManage = staffHasPermission(actor, "ai.agent.manage");
  const hasInstructions = detail.hasInstructionsOverride || AI_AGENT_DEFAULTS[key].hasInstructions;

  // «Нужна синхронизация»: хеш настроек, который ушёл в Claude, против текущего. Не смог посчитать — не гадаем.
  let needsSync = false;
  try {
    const current = computeAiAgentConfigHash({
      key, title: detail.title, model: detail.model, instructionsOverride: detail.instructionsOverride,
      scheduleCron: detail.scheduleCron, scheduleTz: detail.scheduleTz, schedulePromptOverride: detail.schedulePromptOverride,
      enabled: detail.enabled, mcpUrl: resolveAiAgentsMcpUrl(),
    });
    needsSync = aiAgentNeedsSync(detail.sync.status, detail.sync.configHash, current);
  } catch { needsSync = false; }

  const tab = route.tab;
  const now = new Date().toISOString();
  const [digestsRead, runsRead, runRead, draftsRead, conversationsRead] = await Promise.all([
    tab === "overview" ? readAiAgentDigests(actor, { key, limit: 6 }) : Promise.resolve(null),
    tab === "runs" && !route.runId ? readAiAgentRuns(actor, key, { limit: route.runsLimit + 1 }) : Promise.resolve(null),
    (tab === "runs" || tab === "command") && route.runId ? readAiAgentRun(actor, route.runId) : Promise.resolve(null),
    tab === "drafts" ? readAiAgentDrafts(actor, { key, status: route.draftsFilter === "pending" ? "pending" : null, limit: 50 }) : Promise.resolve(null),
    // «Мои разговоры» — собственные поручения сотрудника этому агенту (RPC без изменений: фильтр здесь).
    tab === "command" ? readAiAgentRuns(actor, key, { limit: AI_AGENT_CONVERSATIONS_READ }) : Promise.resolve(null),
  ]);
  const conversations = conversationsRead?.status === "available"
    ? ownCommandRuns(conversationsRead.data.runs, actor.displayName, AI_AGENT_CONVERSATIONS_MAX)
    : [];

  // «Поручить» восстанавливает разговор: `?run=` или последний `command`-запуск этого сотрудника за 12 часов.
  // `?new=1` («Новый разговор») автоподхват пропускает: перезагрузка после него показывает пустой разговор.
  let resume = { runId: null as string | null, sendAuthority: false, run: null as AiAgentRunRow | null };
  if (tab === "command") {
    if (route.runId && runRead?.status === "available" && runRead.data.run.agentKey === key) {
      resume = { runId: route.runId, sendAuthority: runRead.data.run.sendAuthority, run: runRead.data.run };
    } else if (!route.runId && !route.fresh) {
      const nowMs = Date.parse(now);
      const mine = conversations.find((run) => nowMs - Date.parse(run.startedAt) < TWELVE_HOURS);
      if (mine) resume = { runId: mine.id, sendAuthority: mine.sendAuthority, run: mine };
    }
  }
  const taskAccess = taskComposerAccess(actor);

  return (
    <PartShell
      title={detail.title}
      testId="v3-ai-agent-page"
      back={back}
      // «Поручить» — чат во всю высоту окна (оболочка отдаёт страницу целиком по `isFillRoute`).
      fill={tab === "command"}
      meta={detail.roleLine}
      action={
        <AgentSwitches
          agentKey={key}
          enabled={detail.enabled}
          autoSend={detail.autoSend}
          configVersion={detail.configVersion}
          hasInstructions={hasInstructions}
          canEdit={canEdit}
          variant="header"
        />
      }
    >
      <AgentBody
        detail={detail}
        tab={tab}
        now={now}
        canEdit={canEdit}
        canManage={canManage}
        preview={preview}
        runtimeConfigured={runtime.configured}
        needsSync={needsSync}
        digests={digestsRead}
        runs={runsRead}
        runsLimit={route.runsLimit}
        run={runRead}
        runId={route.runId}
        drafts={draftsRead}
        draftsFilter={route.draftsFilter}
        resume={resume}
        conversations={conversations}
        canMakeTasks={taskAccess.staff || taskAccess.case}
      />
    </PartShell>
  );
}
