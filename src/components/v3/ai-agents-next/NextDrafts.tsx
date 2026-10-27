"use client";

import { useMemo, useRef, useState } from "react";
import { MailCheckIcon } from "lucide-react";

import { DataTable, DetailSheet, EmptyState, SectionTabs, StatusBadge, type DataTableColumn } from "@/components/kit";
import { AI_AGENT_DRAFT_CHANNEL_LABELS, type AiAgentDraftRow, type AiAgentDraftStatus, type AiAgentKey } from "@/lib/ai-agents/contract";
import { aiAgentHref, draftStatusWords, plainPreview, relativeTimeRu } from "@/lib/v3/ai-agents-view";

import { AgentAlert } from "./NextNotices";
import { DraftCard } from "@/components/v3/ai-agents/DraftCard";

const CLOSE_CONFIRM = "Есть несохранённые изменения. Закрыть без сохранения?";
const target = (draft: AiAgentDraftRow) => `${AI_AGENT_DRAFT_CHANNEL_LABELS[draft.channel]}${draft.targetLabel ? ` · ${draft.targetLabel}` : ""}`;

function columnsFor(now: string): DataTableColumn<AiAgentDraftRow>[] {
  return [
    { id: "status", header: "Состояние", accessorFn: (draft) => draftStatusWords(draft).label, cell: ({ row }) => { const words = draftStatusWords(row.original); return <StatusBadge label={words.label} tone={words.tone} />; }, meta: { label: "Состояние" } },
    { id: "target", header: "Кому", accessorFn: target, meta: { label: "Кому", mobile: "title" }, enableHiding: false },
    { id: "text", header: "Ответ агента", accessorFn: (draft) => plainPreview(draft.editedText ?? draft.text, 200), cell: ({ row }) => <span className="line-clamp-2 max-w-[36rem] break-words text-fg-2">{plainPreview(row.original.editedText ?? row.original.text, 200)}</span>, meta: { label: "Ответ агента" } },
    { id: "created", header: "Создан", accessorFn: (draft) => draft.createdAt, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-fg-3">{relativeTimeRu(row.original.createdAt, now)}</span>, meta: { label: "Создан", align: "end" } },
  ];
}

/**
 * «На одобрение» в «Новом виде»: ряд «Ждут решения · Все», таблица черновиков, строка открывает панель с настоящей
 * карточкой черновика (`DraftCard`: правка текста, «Одобрить и отправить», «Отклонить» — те же серверные действия).
 * Выбранный черновик держится в состоянии: после решения сервер уже не вернёт его в «Ждут решения», а панель
 * остаётся со словом результата («Отправлено»), пока сотрудник её не закроет. Закрытие с правкой спрашивает.
 */
export function NextDrafts({
  agentKey, drafts, counts, filter, canManage, now,
}: Readonly<{ agentKey: AiAgentKey; drafts: readonly AiAgentDraftRow[]; counts: Readonly<Record<AiAgentDraftStatus, number>>; filter: "pending" | "all"; canManage: boolean; now: string }>) {
  const all = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const columns = useMemo(() => columnsFor(now), [now]);
  const [current, setCurrent] = useState<AiAgentDraftRow | null>(null);
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  function onOpenChange(next: boolean) {
    if (!next) {
      const field = body.current?.querySelector<HTMLTextAreaElement>("textarea");
      if (current && field && field.value.trim() !== current.text.trim() && !window.confirm(CLOSE_CONFIRM)) return;
    }
    setOpen(next);
  }

  return (
    <div className="grid min-w-0 gap-3" data-testid="v3-aia-drafts">
      {all > 0 ? (
        <SectionTabs label="Какие черновики показать" value={filter} tabs={[
          { key: "pending", label: "Ждут решения", count: counts.pending, href: aiAgentHref(agentKey, { tab: "drafts" }) },
          { key: "all", label: "Все", count: all, href: aiAgentHref(agentKey, { tab: "drafts", show: "all" }) },
        ]} />
      ) : null}
      {!canManage && counts.pending > 0 ? <AgentAlert tone="muted" testId="v3-aia-drafts-readonly">Решает сотрудник с правом управлять ИИ-агентами.</AgentAlert> : null}
      <DataTable
        key={filter}
        label="Черновики агента"
        data={drafts}
        columns={columns}
        getRowId={(draft) => draft.id}
        onRowClick={(draft) => { setCurrent(draft); setOpen(true); }}
        searchPlaceholder="Поиск по черновикам"
        pageSize={25}
        columnMenu={false}
        empty={<div data-testid="v3-aia-drafts-empty"><EmptyState icon={MailCheckIcon} title={filter === "pending" ? "Нет черновиков, которые ждут решения." : "Черновиков не было."} /></div>}
      />
      <DetailSheet open={open} onOpenChange={onOpenChange} title={current ? target(current) : "Черновик"} description={current ? `Создан ${relativeTimeRu(current.createdAt, now)}` : undefined}>
        <div ref={body}>{current ? <DraftCard key={current.id} draft={current} canManage={canManage} now={now} /> : null}</div>
      </DetailSheet>
    </div>
  );
}
