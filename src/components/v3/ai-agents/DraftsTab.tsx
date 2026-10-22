import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import type { AiAgentDraftRow, AiAgentDraftStatus, AiAgentKey } from "@/lib/ai-agents/contract";
import { aiAgentHref } from "@/lib/v3/ai-agents-view";

import { DraftCard } from "./DraftCard";

/** Очередь «Черновиков» (контракт §D.4, п. 4): по умолчанию ждущие решения, «Все» — вся история. */
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
      <div>
        <h2 id="aia-drafts" className="t-section text-fg">Черновики</h2>
        <p className="mt-1 max-w-[62ch] t-body-compact text-fg-2">
          Сообщения клиентам и студентам, которые агент подготовил при выключенном Авто. Они уходят только после вашего одобрения.
        </p>
      </div>
      <QueueViewTabs
        label="Какие черновики показать"
        tabs={[
          { key: "pending", label: "Ждут решения", count: counts.pending, current: filter === "pending", href: aiAgentHref(agentKey, { tab: "drafts" }) },
          { key: "all", label: "Все", count: all, current: filter === "all", href: aiAgentHref(agentKey, { tab: "drafts", show: "all" }) },
        ]}
      />
      {drafts.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-4 py-5 t-body-compact text-fg-2" data-testid="v3-aia-drafts-empty">
          {filter === "pending"
            ? "Черновиков, которые ждут решения, нет. Когда агент подготовит сообщение клиенту, оно появится здесь."
            : "Агент ещё не готовил черновиков."}
        </p>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => <DraftCard key={`${draft.id}-${draft.status}`} draft={draft} canManage={canManage} now={now} />)}
        </div>
      )}
    </section>
  );
}
