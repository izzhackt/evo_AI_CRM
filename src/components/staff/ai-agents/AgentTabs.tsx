import { QueueViewTabs } from "@/components/staff/queue/QueueViewTabs";
import { AI_AGENT_TABS, aiAgentHref, type AiAgentTab } from "@/lib/v3/ai-agents-view";
import type { AiAgentKey } from "@/lib/ai-agents/contract";

/**
 * Шесть вкладок страницы агента настоящими ссылками `?tab=` (контракт §D.4).
 * `bare` (строка шапки чата «Поручить») больше ничего не меняет: с 14.11.2026 у всех рядов вкладок нет линии под рядом.
 */
export function AgentTabs({
  agentKey,
  title,
  tab,
  draftsPending,
}: Readonly<{
  agentKey: AiAgentKey;
  title: string;
  tab: AiAgentTab;
  draftsPending: number;
  bare?: boolean;
}>) {
  return (
    <QueueViewTabs
      label={`Разделы агента «${title}»`}
      tabs={AI_AGENT_TABS.map((one) => ({
        key: one.key,
        label: one.label,
        count: one.key === "drafts" && draftsPending > 0 ? draftsPending : null,
        current: one.key === tab,
        href: aiAgentHref(agentKey, { tab: one.key }),
      }))}
    />
  );
}
