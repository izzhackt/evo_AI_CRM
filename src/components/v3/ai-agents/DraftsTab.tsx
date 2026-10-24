import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import type { AiAgentDraftRow, AiAgentDraftStatus, AiAgentKey } from "@/lib/ai-agents/contract";
import { aiAgentHref } from "@/lib/v3/ai-agents-view";

import { DraftList } from "./DraftList";

/**
 * Очередь «Черновиков» (контракт §D.4, п. 4): по умолчанию ждущие решения, «Все» — вся история.
 * Заголовка и пересказа правил нет: вкладка уже называется «Черновики», а «уходят только
 * после одобрения» говорит кнопка «Одобрить и отправить». Фильтр появляется, когда черновики
 * вообще были; пустая очередь — одна строка.
 */
export function DraftsTab({
  agentKey,
  drafts,
  counts,
  filter,
  canManage,
  now,
}: Readonly<{
  agentKey: AiAgentKey;
  drafts: readonly AiAgentDraftRow[];
  counts: Readonly<Record<AiAgentDraftStatus, number>>;
  filter: "pending" | "all";
  canManage: boolean;
  now: string;
}>) {
  const all = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return (
    <section className="space-y-4" aria-labelledby="aia-drafts" data-testid="v3-aia-drafts">
      <h2 id="aia-drafts" className="sr-only">Черновики</h2>
      {all > 0 ? (
        <QueueViewTabs
          label="Какие черновики показать"
          tabs={[
            { key: "pending", label: "Ждут решения", count: counts.pending, current: filter === "pending", href: aiAgentHref(agentKey, { tab: "drafts" }) },
            { key: "all", label: "Все", count: all, current: filter === "all", href: aiAgentHref(agentKey, { tab: "drafts", show: "all" }) },
          ]}
        />
      ) : null}
      {!canManage && counts.pending > 0 ? (
        <p className="t-body-compact text-fg-2" data-testid="v3-aia-drafts-readonly">Решает сотрудник с правом управлять ИИ-агентами.</p>
      ) : null}
      <DraftList drafts={drafts} canManage={canManage} now={now} emptyText={filter === "pending" ? "Нет черновиков, которые ждут решения." : "Черновиков не было."} />
    </section>
  );
}
