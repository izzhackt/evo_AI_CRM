import "../../../ai-agents.css";

import Link from "next/link";
import { notFound } from "next/navigation";

import { AI_AGENT_DEFAULTS } from "@/content/ai-agents";
import { AgentBody } from "@/components/v3/ai-agents/AgentBody";
import { AgentChatShell } from "@/components/v3/ai-agents/AgentChatShell";
import { AgentSwitches } from "@/components/v3/ai-agents/AgentSwitches";
import { AgentTabs } from "@/components/v3/ai-agents/AgentTabs";
import { NextAgentPage } from "@/components/v3/ai-agents-next/NextAgentPage";
import { NextAgentUnavailable } from "@/components/v3/ai-agents-next/NextAgentUnavailable";
import { NotReady, Unavailable } from "@/components/v3/ai-agents/Notices";
import { Icon } from "@/components/icons";
import { PartShell } from "@/components/v3/PartShell";
import { taskComposerAccess } from "@/components/v3/tasks/task-composer-access";
import { AI_AGENT_CATALOG, isAiAgentKey } from "@/lib/ai-agents/contract";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isNextUi } from "@/lib/ui-next";
import { v3SectionTitle } from "@/lib/v3/navigation";
import { computeAiAgentConfigHash, resolveAiAgentsMcpUrl } from "@/lib/server/ai-agents/config-hash";
import { aiAgentsRuntimeAvailability, aiAgentsWhatsappDailyCapCents, readAiAgentWhatsappCap, reconcileAiAgentRuns } from "@/lib/server/ai-agents/runtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  aiAgentHref,
  aiAgentNeedsSync,
  aiAgentRoleLine,
  AI_AGENT_CONVERSATIONS_MAX,
  AI_AGENT_CONVERSATIONS_READ,
  AI_AGENTS_HUB_HREF,
  ownCommandRuns,
  toConversationRow,
  type AiAgentConversationRow,
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

/**
 * Вкладка браузера называет агента и раздел (названия берутся из каталога: чтения базы для заголовка не нужно);
 * слово раздела — то же, что у пункта меню (`v3SectionTitle`), как у карточки лида.
 */
export async function generateMetadata({ params }: Readonly<{ params: Promise<{ key: string }> }>) {
  const { key } = await params;
  const section = v3SectionTitle(`/v3/ai-agents/${key}`) ?? "ИИ-агенты";
  const title = AI_AGENT_CATALOG.find((entry) => entry.key === key)?.title;
  return { title: title ? `${title} — ${section}` : section };
}

type Query = Record<string, string | string[] | undefined>;
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

/**
 * Страница агента (контракт §D.4): шапка с переключателями «Включён» и «Авто»
 * (меняет только системный администратор), шесть вкладок настоящими ссылками
 * `?tab=`: Обзор · Поручить · Запуски · Черновики · Инструкция · Настройки.
 * Читается только то, что нужно выбранной вкладке; хеш «нужна синхронизация»
 * считает сервер. Неизвестный ключ или вкладка — 404. «Поручить» — чат на
 * всю рабочую область (`AgentChatShell`: тонкая шапка в одну строку, без
 * потолка 1240 px, высота окна) и получает собственные разговоры сотрудника.
 * «Новый вид» (27.10.2026): те же чтения и те же свойства, другой вид — только настоящему администратору с включённым
 * переключателем (`isNextUi`); остальные видят прежний вид без изменений.
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
  const nextUi = await isNextUi(actor);
  if (nextUi && read.status !== "available") return <NextAgentUnavailable agentKey={key} status={read.status} />;
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
  let resume = { runId: null as string | null, sendAuthority: false, run: null as AiAgentConversationRow | null };
  if (tab === "command") {
    if (route.runId && runRead?.status === "available" && runRead.data.run.agentKey === key) {
      resume = { runId: route.runId, sendAuthority: runRead.data.run.sendAuthority, run: toConversationRow(runRead.data.run) };
    } else if (!route.runId && !route.fresh) {
      const nowMs = Date.parse(now);
      const mine = conversations.find((run) => nowMs - Date.parse(run.startedAt) < TWELVE_HOURS);
      if (mine) resume = { runId: mine.id, sendAuthority: mine.sendAuthority, run: mine };
    }
  }
  const taskAccess = taskComposerAccess(actor);
  // Строка лимита на «Настройках»: расход и резерв из базы (то, что решает приём события); не прочиталось — расход из графика.
  const whatsappCapState = tab === "settings" && runtime.configured && !preview
    ? await readAiAgentWhatsappCap({ staffClient: await createSupabaseServerClient(), actor }, { key, runBudgetUsd: detail.runBudgetUsd })
    : null;

  const bodyProps = {
    detail,
    tab,
    now,
    canEdit,
    canManage,
    preview,
    runtimeConfigured: runtime.configured,
    needsSync,
    digests: digestsRead,
    runs: runsRead,
    runsLimit: route.runsLimit,
    run: runRead,
    runId: route.runId,
    drafts: draftsRead,
    draftsFilter: route.draftsFilter,
    resume,
    conversations,
    canMakeTasks: taskAccess.staff || taskAccess.case,
    viewerName: actor.displayName,
    whatsappDailyCapCents: aiAgentsWhatsappDailyCapCents(),
    whatsappCapState,
  };
  if (nextUi) return <NextAgentPage {...bodyProps} />;

  const switches = (
    <AgentSwitches
      agentKey={key}
      enabled={detail.enabled}
      autoSend={detail.autoSend}
      configVersion={detail.configVersion}
      hasInstructions={hasInstructions}
      canEdit={canEdit}
    />
  );
  const content = <AgentBody {...bodyProps} />;

  // «Поручить» — чат на всю рабочую область (оболочка отдаёт колонку высотой в окно по `isFillRoute`).
  if (tab === "command") {
    return (
      <AgentChatShell
        testId="v3-ai-agent-page"
        title={detail.title}
        roleLine={aiAgentRoleLine(detail.roleLine)}
        tabs={<AgentTabs bare agentKey={key} title={detail.title} tab={tab} draftsPending={detail.stats.draftsPending} />}
        switches={switches}
      >
        {content}
      </AgentChatShell>
    );
  }
  return (
    <PartShell title={detail.title} testId="v3-ai-agent-page" back={back} meta={aiAgentRoleLine(detail.roleLine)} action={switches}>
      {content}
    </PartShell>
  );
}
