import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { HelpTip } from "@/components/kit";
import { Card } from "@/components/ui/card";
import type { AiAgentListItem, AiAgentsListResult } from "@/lib/ai-agents/contract";
import type { AiAgentsActivity } from "@/lib/v3/ai-agents-source";
import { aiAgentIsRunnable } from "@/lib/v3/ai-agents-view";

import type { NextAgentsHasDefault } from "./agent-defaults";
import { NextAgentsFeed } from "./NextAgentsFeed";
import { NextAgentsAsk } from "./NextAgentsAsk";
import { NextAgentsKpis, NextAgentsNow } from "./NextAgentsNow";
import { NextAgentsDrafts, NextAgentsRoster } from "./NextAgentsSide";
import { NextApiKeyMissing } from "./NextNotices";

/**
 * Хаб «ИИ-агенты» (11.11.2026, по образцу Molar AI с Dribbble): тёмная полоса «Сейчас» с мини-графиком, ряд итогов,
 * лента «Что сделали агенты» и список агентов, справа «Спросить агента»; внизу помощник Gemini.
 * Данные и права те же; роль агента — по-прежнему за «?». `hasDefault` — у кого есть инструкция по умолчанию.
 */
export function NextAgentsHub({
  list,
  activity = null,
  runtimeConfigured,
  preview = false,
  hasDefault,
}: Readonly<{ list: AiAgentsListResult; activity?: AiAgentsActivity | null; runtimeConfigured: boolean; preview?: boolean; hasDefault: NextAgentsHasDefault }>) {
  const hasInstructionsOf = (agent: AiAgentListItem) => agent.hasInstructionsOverride || hasDefault[agent.key];
  const canAskOf = (agent: AiAgentListItem) => runtimeConfigured && !preview && !(agent.key === "director" && !list.isAdmin);
  // В панели — агенты с правилами; поручить можно только включённому и синхронизированному, иначе кнопка выключена со словами.
  const askable = list.agents.filter(hasInstructionsOf).sort((a, b) => a.sortOrder - b.sortOrder);
  const runnable = askable.filter((agent) => canAskOf(agent) && agent.enabled && aiAgentIsRunnable(agent.sync));
  const blockedNote = !runtimeConfigured ? "Ключ Claude API не задан — агентам пока нельзя поручать."
    : preview ? "В просмотре роли поручать нельзя."
      : runnable.length === 0 ? "Нет включённых агентов: включите агента на его странице." : null;
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-aia-hub">
      {runtimeConfigured ? null : <NextApiKeyMissing />}
      <div className="grid min-w-0 items-start gap-4 @6xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-4">
          <NextAgentsNow list={list} />
          <NextAgentsKpis list={list} />
          <div className="grid min-w-0 items-start gap-4 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <NextAgentsFeed runs={activity?.runs ?? []} agents={list.agents} now={list.now} partial={activity?.partial ?? false} />
            <div className="grid min-w-0 gap-4">
              <NextAgentsDrafts drafts={activity?.drafts ?? []} agents={list.agents} />
              <NextAgentsRoster agents={list.agents} now={list.now} canAskOf={canAskOf} hasInstructionsOf={hasInstructionsOf} canWriteRules={list.isAdmin && !preview} />
            </div>
          </div>
        </div>
        <div className="grid min-w-0 gap-4 @6xl:sticky @6xl:top-4">
          <NextAgentsAsk agents={(runnable.length > 0 ? runnable : askable).map((agent) => ({ key: agent.key, title: agent.title }))} blockedNote={blockedNote} />
        </div>
      </div>

      <section aria-label="Помощник в чате WhatsApp" data-testid="v3-aia-gemini">
        <Card size="sm" className="relative flex-row items-center justify-between gap-2 px-4 transition-colors hover:border-border-strong has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus-ring motion-reduce:transition-none">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="t-item text-fg">
              <Link href="/ai-agent" className="rounded-nav outline-none after:absolute after:inset-0 after:rounded-card">Помощник в чате WhatsApp</Link>
            </h2>
            <HelpTip label="Пояснение: Помощник в чате WhatsApp" className="z-10">Подсказывает ответ, сам ничего не отправляет.</HelpTip>
          </div>
          <ChevronRightIcon className="size-5 shrink-0 text-fg-3" aria-hidden="true" />
        </Card>
      </section>
    </div>
  );
}
