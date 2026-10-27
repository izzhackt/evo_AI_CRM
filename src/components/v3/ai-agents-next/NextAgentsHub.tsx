import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { AI_AGENT_DEFAULTS } from "@/content/ai-agents";
import { HelpTip, StatTile } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AI_AGENT_GROUPS, AI_AGENT_GROUP_LABELS, type AiAgentListItem, type AiAgentsListResult } from "@/lib/ai-agents/contract";
import { aiAgentHref, formatUsdCents } from "@/lib/v3/ai-agents-view";

import { NextAgentCard } from "./NextAgentCard";
import { NextApiKeyMissing } from "./NextNotices";

const hasInstructionsOf = (agent: AiAgentListItem) => agent.hasInstructionsOverride || AI_AGENT_DEFAULTS[agent.key].hasInstructions;

/**
 * Хаб «ИИ-агенты» в «Новом виде»: четыре плитки за 7 дней, три группы карточек (Продажи / Аналитика / Кураторы),
 * ряд «Не настроены» и помощник Gemini. Данные и права те же, что у прежнего хаба; пояснения ушли за «?».
 */
export function NextAgentsHub({
  list,
  runtimeConfigured,
  preview = false,
}: Readonly<{ list: AiAgentsListResult; runtimeConfigured: boolean; preview?: boolean }>) {
  // Плитка — ссылка, только когда очередь одна и число — её: иначе ссылка вела бы в часть (карточки ведут в каждую).
  const withDrafts = list.agents.filter((agent) => agent.stats.draftsPending > 0);
  const pendingAgent = withDrafts.length === 1 ? withDrafts[0] : undefined;
  return (
    <div className="grid min-w-0 gap-6" data-testid="v3-aia-hub">
      {runtimeConfigured ? null : <NextApiKeyMissing />}
      <div role="group" aria-label="Показатели за 7 дней" className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
        <StatTile label="Включено агентов" value={list.summary.enabled} hint={`из ${list.agents.length}`} />
        <StatTile label="Запусков за 7 дней" value={list.summary.runs7d} />
        <StatTile label="Расход за 7 дней" value={formatUsdCents(list.summary.costCents7d)} />
        <StatTile
          label="Ждут решения"
          value={list.summary.draftsPending}
          href={pendingAgent && list.summary.draftsPending > 0 ? aiAgentHref(pendingAgent.key, { tab: "drafts" }) : undefined}
        />
      </div>

      <div className="grid gap-x-3 gap-y-6 @3xl:grid-cols-2">
        {AI_AGENT_GROUPS.map((group) => {
          const agents = list.agents.filter((agent) => agent.groupKey === group).sort((a, b) => a.sortOrder - b.sortOrder);
          if (agents.length === 0) return null;
          const ready = agents.filter(hasInstructionsOf);
          const unset = agents.filter((agent) => !hasInstructionsOf(agent));
          // Группа из одного агента стоит в одной колонке рядом с такой же; длинная — на всю ширину.
          return (
            <section key={group} aria-labelledby={`aia-group-${group}`} data-testid={`v3-aia-group-${group}`} className={agents.length > 1 ? "@3xl:col-span-2" : undefined}>
              <h2 id={`aia-group-${group}`} className="t-section mb-3 flex items-baseline gap-2 text-fg">
                {AI_AGENT_GROUP_LABELS[group]}
                <span className="font-normal tabular-nums text-fg-3">{agents.length}</span>
              </h2>
              {ready.length > 0 ? (
                <ul className={`grid gap-3 ${ready.length > 1 ? "@3xl:grid-cols-2" : ""}`}>
                  {ready.map((agent) => (
                    <NextAgentCard key={agent.key} agent={agent} now={list.now} canAsk={runtimeConfigured && !preview && !(agent.key === "director" && !list.isAdmin)} />
                  ))}
                </ul>
              ) : null}
              {unset.length > 0 ? (
                <ul className={`${ready.length > 0 ? "mt-3 " : ""}flex flex-wrap items-center gap-2`} aria-label="Агенты без правил">
                  <li className="pe-1 t-meta text-fg-3">Не настроены:</li>
                  {unset.map((agent) => (
                    <li key={agent.key} data-testid={`v3-aia-card-${agent.key}`}>
                      <Button variant="outline" asChild><Link href={aiAgentHref(agent.key)}>{agent.title}</Link></Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      <section aria-label="Помощник в чате WhatsApp" data-testid="v3-aia-gemini">
        <Card size="sm" className="relative flex-row items-center justify-between gap-2 px-4 transition-colors hover:border-border-strong has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus-ring motion-reduce:transition-none">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="t-item text-fg">
              <Link href="/v3/ai-agent" className="rounded-nav outline-none after:absolute after:inset-0 after:rounded-card">Помощник в чате WhatsApp</Link>
            </h2>
            <HelpTip label="Пояснение: Помощник в чате WhatsApp" className="z-10">Подсказывает ответ, сам ничего не отправляет.</HelpTip>
          </div>
          <ChevronRightIcon className="size-5 shrink-0 text-fg-3" aria-hidden="true" />
        </Card>
      </section>
    </div>
  );
}
