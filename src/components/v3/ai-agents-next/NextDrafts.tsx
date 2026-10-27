"use client";

import { useMemo, useRef, useState } from "react";
import { MailCheckIcon } from "lucide-react";

import { DataTable, DetailSheet, EmptyState, SectionTabs, StatusBadge, type DataTableColumn } from "@/components/kit";
import { AI_AGENT_DRAFT_CHANNEL_LABELS, type AiAgentDraftRow, type AiAgentDraftStatus, type AiAgentKey } from "@/lib/ai-agents/contract";
import { aiAgentHref, draftStatusWords, formatDateTimeRu, plainPreview, relativeTimeRu } from "@/lib/v3/ai-agents-view";
import { WAZZUP_READ_ONLY_LINE, isReceiveOnlyDraft } from "@/lib/v3/wazzup-words";

import { AgentAlert } from "./NextNotices";
import { DraftCard } from "@/components/v3/ai-agents/DraftCard";

const CLOSE_CONFIRM = "Есть несохранённые изменения. Закрыть без сохранения?";
/** Срок называется, только когда он близок (как в карточке черновика): «действует до …» у каждой строки — шум. */
const SOON_MS = 24 * 60 * 60 * 1000;
const target = (draft: AiAgentDraftRow) => `${AI_AGENT_DRAFT_CHANNEL_LABELS[draft.channel]}${draft.targetLabel ? ` · ${draft.targetLabel}` : ""}`;
const reply = (draft: AiAgentDraftRow) => plainPreview(draft.editedText ?? draft.text, 200);

/**
 * Состояние словом и под ним то, что нельзя пропустить, не открывая строку: почему черновик остался в очереди или не
 * ушёл («WhatsApp сейчас не подключён») и что срок близок. Полные слова и подсказка «Подключите WhatsApp…» — в панели.
 * Черновик WhatsApp, который EVO отправить не может (Wazzup, `receive_only`), - не сбой, а задуманное: строка говорит ту же
 * фразу «Только чтение…», что карточка в панели, и не тревожным цветом.
 */
function StatusCell({ draft, now }: Readonly<{ draft: AiAgentDraftRow; now: string }>) {
  const words = draftStatusWords(draft);
  const receiveOnly = draft.status === "pending" && isReceiveOnlyDraft(draft.channel, draft.failureCode);
  const note = receiveOnly ? WAZZUP_READ_ONLY_LINE : draft.status === "pending" || draft.status === "failed" ? words.note : null;
  const noteTone = receiveOnly ? "text-fg-2" : words.tone === "danger" ? "text-danger" : "text-warn";
  const soon = draft.status === "pending" && Date.parse(draft.expiresAt) - Date.parse(now) < SOON_MS;
  return (
    <span className="grid min-w-0 max-w-[18rem] justify-items-end gap-1 text-right md:justify-items-start md:text-left">
      <StatusBadge label={words.label} tone={words.tone} />
      {note ? <span className={`t-meta ${noteTone}`} data-testid="v3-aia-draft-note">{note}</span> : null}
      {soon ? <span className="t-meta text-warn" data-testid="v3-aia-draft-expires">действует до {formatDateTimeRu(draft.expiresAt, now)}</span> : null}
    </span>
  );
}

function columnsFor(now: string): DataTableColumn<AiAgentDraftRow>[] {
  return [
    { id: "status", header: "Состояние", accessorFn: (draft) => draftStatusWords(draft).label, cell: ({ row }) => <StatusCell draft={row.original} now={now} />, meta: { label: "Состояние" } },
    {
      // На телефоне ответ агента — вторая строка заголовка карточки (слева, не в правом столбце «подпись — значение»); на широком экране он в своей колонке.
      id: "target", header: "Кому", accessorFn: target, meta: { label: "Кому", mobile: "title" }, enableHiding: false,
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="block break-words">{target(row.original)}</span>
          <span className="mt-0.5 line-clamp-2 break-words t-meta text-fg-3 md:hidden">{reply(row.original)}</span>
        </span>
      ),
    },
    { id: "text", header: "Ответ агента", accessorFn: reply, cell: ({ row }) => <span className="line-clamp-2 max-w-[36rem] break-words text-fg-2">{reply(row.original)}</span>, meta: { label: "Ответ агента", mobile: "hide" } },
    { id: "created", header: "Создан", accessorFn: (draft) => draft.createdAt, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-fg-3">{relativeTimeRu(row.original.createdAt, now)}</span>, meta: { label: "Создан", align: "end" } },
  ];
}

/**
 * «На одобрение» в «Новом виде»: ряд «Ждут решения · Все», таблица черновиков, строка открывает панель с настоящей
 * карточкой черновика (`DraftCard`: правка текста, «Одобрить и отправить», «Отклонить» — те же серверные действия).
 * Выбранный черновик держится в состоянии: после решения сервер уже не вернёт его в «Ждут решения», а панель
 * остаётся со словом результата («Отправлено»), пока сотрудник её не закроет. Закрытие с правкой спрашивает.
 * Сервер отдаёт не больше последних 50 черновиков: таблица показывает их все без страниц и без «из N», а когда в очереди
 * больше, так и говорит — «Показаны последние 50 из 140»; поиск тогда назван поиском среди показанных.
 */
export function NextDrafts({
  agentKey, drafts, counts, filter, canManage, now,
}: Readonly<{ agentKey: AiAgentKey; drafts: readonly AiAgentDraftRow[]; counts: Readonly<Record<AiAgentDraftStatus, number>>; filter: "pending" | "all"; canManage: boolean; now: string }>) {
  const all = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const total = filter === "pending" ? counts.pending : all;
  const capped = total > drafts.length;
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
        getRowLabel={target}
        searchPlaceholder={capped ? "Поиск среди показанных" : "Поиск по черновикам"}
        paginate={false}
        columnMenu={false}
        empty={<div data-testid="v3-aia-drafts-empty"><EmptyState icon={MailCheckIcon} title={filter === "pending" ? "Нет черновиков, которые ждут решения." : "Черновиков не было."} /></div>}
      />
      {capped ? <p className="t-meta text-fg-3" data-testid="v3-aia-drafts-capped">Показаны последние {drafts.length} из {total}</p> : null}
      <DetailSheet open={open} onOpenChange={onOpenChange} title={current ? target(current) : "Черновик"} description={current ? `Создан ${relativeTimeRu(current.createdAt, now)}` : undefined}>
        <div ref={body}>{current ? <DraftCard key={current.id} draft={current} canManage={canManage} now={now} bare /> : null}</div>
      </DetailSheet>
    </div>
  );
}
