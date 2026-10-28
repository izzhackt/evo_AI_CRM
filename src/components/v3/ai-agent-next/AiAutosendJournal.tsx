"use client";

import Link from "next/link";
import { useState } from "react";

import { DataTable, DetailSheet, EmptyState, KeyFacts, StatusBadge, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { BoardSegments } from "@/components/v3/board/Board";
import { aiAgentHref, type AiAutosendRoute } from "@/lib/v3/ai-agent";
import {
  AI_AUTOSEND_JOURNAL_FILTERS, AI_AUTOSEND_STATUS_LABEL, AI_AUTOSEND_STATUS_TONE, aiAutosendJournalFinalReason, aiAutosendJournalReason, aiAutosendShortDayTime,
  type AiAutosendJournal, type AiAutosendJournalRow,
} from "@/lib/v3/ai-agent-autosend";
import type { AiRead } from "@/lib/v3/ai-agent-source";

import { AiUnavailableNext } from "./AiUnavailableNext";

const metaOf = (row: AiAutosendJournalRow) => [
  row.kind === "final_phrase" ? "финальная фраза" : row.kind === "answer" ? "ответ" : null,
  row.mode === "live_test" ? "живой тест" : null,
  row.language && row.language !== "ru" ? row.language.toUpperCase() : null,
].filter(Boolean).join(" · ");

const columns: DataTableColumn<AiAutosendJournalRow>[] = [
  { id: "at", accessorFn: (row) => row.at, header: "Когда", meta: { mobile: "title" }, enableHiding: false, cell: ({ row }) => <time dateTime={row.original.at} className="whitespace-nowrap font-mono tabular-nums">{aiAutosendShortDayTime(row.original.at)}</time> },
  { id: "chat", accessorFn: (row) => row.conversationTitle ?? "", header: "Чат", cell: ({ row }) => row.original.conversationTitle ?? <span className="text-fg-3">Чат недоступен</span> },
  { id: "status", accessorFn: (row) => AI_AUTOSEND_STATUS_LABEL[row.status], header: "Решение", cell: ({ row }) => <span data-testid="v3-ai-autosend-journal-row" data-status={row.original.status}><StatusBadge label={AI_AUTOSEND_STATUS_LABEL[row.original.status]} tone={AI_AUTOSEND_STATUS_TONE[row.original.status]} /></span> },
  {
    id: "text", accessorFn: (row) => `${aiAutosendJournalReason(row) ?? ""} ${row.text ?? ""}`, header: "Причина или текст", meta: { wide: true },
    cell: ({ row }) => <span className={`block max-w-prose truncate ${row.original.status === "failed" ? "text-danger" : "text-fg-2"}`}>{aiAutosendJournalReason(row.original) ?? row.original.text ?? ""}</span>,
  },
];

function RowSheet({ row }: Readonly<{ row: AiAutosendJournalRow }>) {
  const reason = aiAutosendJournalReason(row);
  const finalReason = aiAutosendJournalFinalReason(row);
  return (
    <div className="grid gap-4">
      <KeyFacts columns={2} facts={[
        { label: "Решение", value: <StatusBadge label={AI_AUTOSEND_STATUS_LABEL[row.status]} tone={AI_AUTOSEND_STATUS_TONE[row.status]} /> },
        { label: "Вид", value: metaOf(row) || null },
        { label: "Когда", value: <span className="font-mono tabular-nums">{aiAutosendShortDayTime(row.at)}</span> },
      ]} />
      {reason ? <p className={`t-body-compact ${row.status === "failed" ? "text-danger" : "text-fg-2"}`}>{reason}</p> : null}
      {finalReason ? <p className="t-body-compact text-fg-2" data-testid="v3-ai-autosend-final-reason">{finalReason}</p> : null}
      {row.text ? <p className="whitespace-pre-wrap break-words t-body-compact text-fg" lang={row.language ?? undefined}>{row.text}</p>
        : row.textHidden ? <p className="t-meta text-fg-3">Текст виден тем, кто может читать этот чат.</p> : null}
      {row.conversationTitle ? <div><Button variant="outline" asChild><Link href={`/v3/inbox?conversation=${row.conversationId}`}>Открыть чат</Link></Button></div> : null}
    </div>
  );
}

/** «Журнал решений» автоответчика: фильтр «Показать» (ссылки `?status=`), таблица решений и панель решения с причиной и текстом (текст виден тем, кто читает чат). */
export function AiAutosendJournalView({ read, route, retryHref }: Readonly<{ read: AiRead<AiAutosendJournal>; route: AiAutosendRoute; retryHref: string }>) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (read.status !== "available") return <AiUnavailableNext what="журнал" retryHref={retryHref} />;
  const open = read.data.items.find((row) => row.id === openId) ?? null;
  return (
    <div className="grid min-w-0 gap-3" data-testid="v3-ai-autosend-journal">
      <div data-testid="v3-ai-autosend-journal-filter">
        <BoardSegments label="Показать" showLabel items={AI_AUTOSEND_JOURNAL_FILTERS.map((filter) => ({
          key: filter.key, title: filter.label, count: null, active: route.journalFilter === filter.key,
          href: aiAgentHref("autosend", { view: "journal", status: filter.key === "all" ? null : filter.key }),
        }))} />
      </div>
      <DataTable
        label="Журнал решений"
        data={read.data.items}
        columns={columns}
        getRowId={(row) => row.id}
        getRowLabel={(row) => `${row.conversationTitle ?? "Чат недоступен"}, ${aiAutosendShortDayTime(row.at)}`}
        onRowClick={(row) => setOpenId(row.id)}
        searchPlaceholder="Найти решение"
        columnMenu={false}
        paginate={false}
        empty={<EmptyState title={route.journalFilter === "all" ? "Решений пока нет — первые появятся ночью, когда напишет клиент." : "Таких решений нет."} />}
      />
      {read.data.next ? <p className="t-meta text-fg-3">Показаны последние {read.data.items.length} решений.</p> : null}
      <DetailSheet open={open !== null} onOpenChange={(next) => { if (!next) setOpenId(null); }} title={open?.conversationTitle ?? "Чат недоступен"}>
        {open ? <RowSheet row={open} /> : null}
      </DetailSheet>
    </div>
  );
}
