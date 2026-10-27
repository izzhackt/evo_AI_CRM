"use client";

import { PhoneIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DataTable, DetailSheet, EmptyState, KeyFacts, StatTile, StatusBadge, type DataTableColumn } from "@/components/kit";
import {
  AI_AUTOSEND_MODE_LABEL, AI_AUTOSEND_QUALIFICATION, aiAutosendDate, aiAutosendNight, aiAutosendTime,
  type AiAutosendSummaryItem, type AiAutosendSummaryRead,
} from "@/lib/v3/ai-agent-autosend";
import type { AiRead } from "@/lib/v3/ai-agent-source";

import { plural } from "./ai-document-model";
import { AiUnavailableNext } from "./AiUnavailableNext";

type Item = AiAutosendSummaryItem & { key: string };

const countsLine = (item: AiAutosendSummaryItem, shadow: boolean) => [
  plural(item.considered, "сообщение", "сообщения", "сообщений"),
  item.answered > 0 ? plural(item.answered, shadow ? "ответ бы" : "ответ", shadow ? "ответа бы" : "ответа", shadow ? "ответов бы" : "ответов") : null,
  item.finalPhrase ? "финальная фраза" : null,
].filter(Boolean).join(" · ");

function columns(shadow: boolean): DataTableColumn<Item>[] {
  return [
    {
      id: "chat", accessorFn: (item) => item.conversationTitle ?? "", header: "Чат", meta: { mobile: "title" }, enableHiding: false,
      cell: ({ row }) => (
        <span className="block min-w-0" data-testid="v3-ai-autosend-summary-item" data-hidden={row.original.hidden || undefined}>
          <span className={`block font-medium ${row.original.conversationTitle ? "text-fg" : "text-fg-3"}`}>{row.original.conversationTitle ?? "Чат недоступен"}</span>
          <span className="block t-meta text-fg-3">{countsLine(row.original, shadow)}</span>
        </span>
      ),
    },
    {
      id: "call", accessorFn: (item) => item.callDate ?? "", header: "Звонок",
      cell: ({ row }) => row.original.callDate ? <span className="inline-flex items-center gap-1.5"><PhoneIcon aria-hidden="true" className="size-4 shrink-0 text-fg-3" />Позвонить {aiAutosendDate(row.original.callDate)}</span>
        : row.original.hidden ? null : <span className="text-fg-3">Звонок не назначен</span>,
    },
    { id: "country", accessorFn: (item) => item.qualification.country ?? "", header: "Страна", meta: { wide: true }, cell: ({ row }) => row.original.qualification.country ?? <span className="text-fg-3">—</span> },
  ];
}

function ItemSheet({ item }: Readonly<{ item: Item }>) {
  const qualification = AI_AUTOSEND_QUALIFICATION.filter(([key]) => item.qualification[key]);
  return (
    <div className="grid gap-4">
      {item.hidden ? null : qualification.length > 0
        ? <KeyFacts columns={2} facts={qualification.map(([key, label]) => ({ label, value: item.qualification[key] }))} />
        : <p className="t-body-compact text-fg-3">Квалификация не собрана.</p>}
      {item.reasons.length > 0 ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 t-meta text-fg-2" aria-label="Причины решений">
          {item.reasons.map((reason) => <li key={reason.ru}>{reason.ru}{reason.count > 1 ? <span className="tabular-nums text-fg-3"> ×{reason.count}</span> : null}</li>)}
        </ul>
      ) : null}
      {item.callDate ? (
        <p className="flex items-start gap-1.5 t-body-compact text-fg">
          <PhoneIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-3" />
          <span>Позвонить {aiAutosendDate(item.callDate)}{item.taskId ? <> · <Link href={`/v3/tasks?task=${item.taskId}`} className="underline underline-offset-4">задача</Link></> : item.taskSkipped ? <span className="text-fg-3"> · задача не создана</span> : null}</span>
        </p>
      ) : null}
      {item.conversationId ? <Link href={`/v3/inbox?conversation=${item.conversationId}`} className="inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4">Открыть чат</Link> : null}
    </div>
  );
}

/**
 * «Утренняя сводка»: ночь с интервалом, четыре числа и таблица чатов (сколько сообщений рассмотрено и отвечено, звонок), строка открывает панель
 * с тем, что собрано о клиенте, причинами решений и задачей «Позвонить». Ночь проверки без отправки названа словами; сводки ещё нет — так и сказано.
 */
export function AiAutosendSummaryView({ read, retryHref }: Readonly<{ read: AiRead<AiAutosendSummaryRead>; retryHref: string }>) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (read.status !== "available") return <AiUnavailableNext what="сводку" retryHref={retryHref} />;
  const summary = read.data.summary;
  if (!summary) {
    return <div className="rounded-card border border-border bg-surface" data-testid="v3-ai-autosend-summary-empty"><EmptyState title="Сводок пока нет — первая появится утром после первой ночи." /></div>;
  }
  const shadow = summary.shadow;
  const items: Item[] = summary.items.map((item, index) => ({ ...item, key: item.conversationId ?? `hidden-${index}` }));
  const open = items.find((item) => item.key === openKey) ?? null;
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-ai-autosend-summary" data-shadow={shadow || undefined}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 t-item text-fg">
        Ночь {aiAutosendNight(summary.intervalStart)}, {aiAutosendTime(summary.intervalStart)}–{aiAutosendTime(summary.intervalEnd)}
        {shadow ? <StatusBadge label={AI_AUTOSEND_MODE_LABEL.shadow} tone="info" /> : null}
        {summary.ready ? null : <StatusBadge label="Собирается" />}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Диалогов" value={summary.counts.conversations} />
        <StatTile label="Сообщений рассмотрено" value={summary.counts.considered} />
        <StatTile label={shadow ? "Ответил бы" : "Ответов"} value={summary.counts.answered} />
        <StatTile label="Позвонить" value={summary.counts.finalPhrases} />
      </div>
      <DataTable
        label="Чаты ночной сводки"
        data={items}
        columns={columns(shadow)}
        getRowId={(item) => item.key}
        getRowLabel={(item) => item.conversationTitle ?? "Чат недоступен"}
        onRowClick={(item) => setOpenKey(item.key)}
        searchPlaceholder="Найти чат"
        columnMenu={false}
        paginate={false}
        empty={<EmptyState title="Ночью клиенты не писали." />}
      />
      <DetailSheet open={open !== null} onOpenChange={(next) => { if (!next) setOpenKey(null); }} title={open?.conversationTitle ?? "Чат недоступен"} description={open ? countsLine(open, shadow) : undefined}>
        {open ? <ItemSheet item={open} /> : null}
      </DetailSheet>
    </div>
  );
}
