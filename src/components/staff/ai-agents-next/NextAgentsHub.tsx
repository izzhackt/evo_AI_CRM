import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { HelpTip } from "@/components/kit";
import { Card } from "@/components/ui/card";
import type { AiAgentListItem, AiAgentsListResult } from "@/lib/ai-agents/contract";
import type { AiAgentsActivity } from "@/lib/v3/ai-agents-source";

import type { NextAgentsHasDefault } from "./agent-defaults";
import { NextAgentsFeed } from "./NextAgentsFeed";
import { NextAgentsNow } from "./NextAgentsNow";
import { NextAgentsDrafts, NextAgentsRoster } from "./NextAgentsSide";
import { NextApiKeyMissing } from "./NextNotices";

/**
 * Хаб «ИИ-агенты» (11.11.2026, по образцу Molar AI с Dribbble): сверху «Сейчас» — кто работает и итоги за 7 дней;
 * слева лента «Что сделали агенты»; справа «Ждут решения» и короткий список агентов с «Поручить»; внизу помощник Gemini.
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
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-aia-hub">
      {runtimeConfigured ? null : <NextApiKeyMissing />}
      <NextAgentsNow list={list} />
      <div className="grid min-w-0 items-start gap-4 @5xl:grid-cols-[minmax(0,1fr)_22rem]">
        <NextAgentsFeed runs={activity?.runs ?? []} agents={list.agents} now={list.now} partial={activity?.partial ?? false} />
        <div className="grid min-w-0 gap-4">
          <NextAgentsDrafts drafts={activity?.drafts ?? []} agents={list.agents} />
          <NextAgentsRoster agents={list.agents} now={list.now} canAskOf={canAskOf} hasInstructionsOf={hasInstructionsOf} canWriteRules={list.isAdmin && !preview} />
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
