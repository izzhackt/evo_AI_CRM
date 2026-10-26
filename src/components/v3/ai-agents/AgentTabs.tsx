import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import { AI_AGENT_TABS, aiAgentHref, type AiAgentTab } from "@/lib/v3/ai-agents-view";
import type { AiAgentKey } from "@/lib/ai-agents/contract";

/**
 * Шесть вкладок страницы агента настоящими ссылками `?tab=` (контракт §D.4).
 * `bare` — в строке шапки чата «Поручить» (`AgentChatShell`), без линии под рядом;
 * на остальных вкладках ряд стоит над содержимым (`AgentBody`).
 */
export function AgentTabs({
  agentKey,
  title,
  tab,
  draftsPending,
  bare = false,
}: Readonly<{
  agentKey: AiAgentKey;
  title: string;
  tab: AiAgentTab;
  draftsPending: number;
  bare?: boolean;
}>) {
  return (
    <QueueViewTabs
      bare={bare}
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
