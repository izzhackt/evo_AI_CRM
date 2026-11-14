import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { HelpTip } from "@/components/kit";
import { Card } from "@/components/ui/card";
import type { AiAgentListItem, AiAgentsListResult } from "@/lib/ai-agents/contract";
import type { AiAgentsPending } from "@/lib/v3/ai-agents-source";

import type { NextAgentsHasDefault } from "./agent-defaults";
import { NextAgentsNow } from "./NextAgentsNow";
import { NextAgentsDrafts, NextAgentsRoster } from "./NextAgentsSide";
import { NextApiKeyMissing } from "./NextNotices";

/**
 * Хаб «ИИ-агенты» (11.11.2026, по образцу Molar AI с Dribbble; отзыв владельца к #1449, 12.11.2026): тёмная полоса
 * «Сейчас» с тремя числами за 7 дней, «Ждут решения», когда есть черновики, и список агентов — «Поручить» в строке агента
 * сразу открывает его чат. Ленты запусков нет (она — «История работы» агента); внизу помощник Gemini.
 * Данные и права те же; роль агента — по-прежнему за «?». `hasDefault` — у кого есть инструкция по умолчанию.
 */
export function NextAgentsHub({
  list,
  pending = null,
  runtimeConfigured,
  preview = false,
  hasDefault,
}: Readonly<{ list: AiAgentsListResult; pending?: AiAgentsPending | null; runtimeConfigured: boolean; preview?: boolean; hasDefault: NextAgentsHasDefault }>) {
  const hasInstructionsOf = (agent: AiAgentListItem) => agent.hasInstructionsOverride || hasDefault[agent.key];
  const canAskOf = (agent: AiAgentListItem) => runtimeConfigured && !preview && !(agent.key === "director" && !list.isAdmin);
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-aia-hub">
      {runtimeConfigured ? null : <NextApiKeyMissing />}
      <NextAgentsNow list={list} runtimeConfigured={runtimeConfigured} />
      {pending?.partial ? <p className="t-meta text-warn" data-testid="v3-aia-pending-partial">Черновики не загрузились — список «Ждут решения» может быть неполным.</p> : null}
      <NextAgentsDrafts drafts={pending?.drafts ?? []} total={pending?.total ?? null} agents={list.agents} />
      <NextAgentsRoster agents={list.agents} now={list.now} canAskOf={canAskOf} hasInstructionsOf={hasInstructionsOf} canWriteRules={list.isAdmin && !preview} />

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
