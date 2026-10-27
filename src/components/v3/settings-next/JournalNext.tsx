"use client";

import { DownloadIcon } from "lucide-react";
import Link from "next/link";

import { DataTable, EmptyState, StatusBadge, WidgetCard, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { BoardSegments } from "@/components/v3/board/Board";
import type { JournalEntry } from "@/components/v3/settings/types";
import { journalNotice } from "@/lib/v3/settings-journal-contract";
import { journalActor, journalEvent, journalEventText, journalObject } from "@/lib/v3/wording";

import type { SettingsJournalProps } from "./settings-next-types";

type EventRow = Extract<JournalEntry, { kind: "event" }>;

const columns: DataTableColumn<EventRow>[] = [
  {
    id: "event", accessorFn: (row) => journalEventText(row.transition, row.directionChange) ?? "", header: "Событие", meta: { mobile: "title" }, enableHiding: false,
    cell: ({ row }) => <span className="font-medium text-fg [overflow-wrap:anywhere]">{journalEventText(row.original.transition, row.original.directionChange)}</span>,
  },
  { id: "at", accessorFn: (row) => row.at, header: "Когда", cell: ({ row }) => <span className="tabular-nums">{row.original.at}</span> },
  { id: "actor", accessorFn: (row) => journalActor(row.role) ?? "", header: "Кто", cell: ({ row }) => <StatusBadge label={journalActor(row.original.role) ?? ""} /> },
  {
    id: "object", accessorFn: (row) => journalObject(row.objectType) ?? "", header: "Объект",
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-x-2">
        {journalObject(row.original.objectType) ?? null}
        {row.original.objectId ? <span className="font-mono t-meta text-fg-3">#{row.original.objectId.slice(0, 8)}</span> : null}
        {row.original.profileHref ? <Link href={row.original.profileHref} className="text-fg-2 underline underline-offset-4 hover:text-fg">открыть профиль</Link> : null}
      </span>
    ),
  },
];

const words = (n: number) => {
  const tens = n % 100;
  const ones = n % 10;
  return tens >= 11 && tens <= 14 ? "событий без названия" : ones === 1 ? "событие без названия" : ones >= 2 && ones <= 4 ? "события без названия" : "событий без названия";
};

/**
 * «Журнал действий»: фильтр по типу записи (ссылки: адрес несёт выбор — отфильтрованный журнал можно переслать), экспорт CSV за 30 дней
 * (та же форма и поля, request_id выдаёт сервер) и таблица событий. Листают его ссылкой «Следующие события» (курсор сервера), поэтому
 * у таблицы нет своих страниц и поиск идёт по показанным строкам. Выключенный или недоступный журнал — слова, не «0».
 */
export function JournalNext(props: SettingsJournalProps) {
  const events = props.entries.filter((entry): entry is EventRow => entry.kind === "event");
  const named = events.filter((entry) => journalEvent(entry.transition) !== null);
  const unnamed = events.length - named.length;
  const notice = journalNotice(props.status, props.active, events.length);
  const { active } = props;
  const items = [
    { key: "all", title: "Все", count: null, href: props.hrefs.all, active: !active.objectType },
    ...props.facets.objectTypes.flatMap((type) => {
      const word = journalObject(type.key);
      return word === null ? [] : [{ key: type.key, title: word, count: type.count, href: props.hrefs.types[type.key], active: active.objectType === type.key }];
    }),
  ];
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-journal">
      {props.facets.objectTypes.length > 0 || active.objectType ? <BoardSegments label="Тип записи" showLabel items={items} /> : null}
      {props.exportEnabled ? (
        <WidgetCard
        headingLevel={3}
          title="Экспорт журнала"
          help={`Последние 30 дней · ${active.objectType ? (journalObject(active.objectType) ?? "выбранный тип объекта") : "все объекты"} · все участники.`}
          actions={(
            <form action="/api/platform-audit/export" method="post" encType="application/x-www-form-urlencoded" data-testid="v3-audit-export">
              <input type="hidden" name="request_id" value={props.exportRequestId} />
              <input type="hidden" name="start_at" value={props.exportStartAt} />
              <input type="hidden" name="end_at" value={props.exportEndAt} />
              {active.objectType ? <input type="hidden" name="resource_types" value={active.objectType} /> : null}
              <Button type="submit" variant="outline"><DownloadIcon aria-hidden="true" />Скачать CSV</Button>
            </form>
          )}
        />
      ) : null}
      {notice ? (
        <div data-testid="v3-journal-notice" data-journal-status={props.status} role={notice.retry ? "alert" : undefined} className="rounded-card border border-border bg-surface">
          <EmptyState
            tone={notice.retry ? "danger" : "neutral"}
            title={notice.text}
            description={notice.detail ?? undefined}
            action={notice.retry ? <Button variant="outline" asChild><Link href={props.hrefs.retry}>Повторить</Link></Button> : undefined}
          />
        </div>
      ) : null}
      {unnamed > 0 ? <p className="t-meta text-fg-3">{unnamed} {words(unnamed)}</p> : null}
      {named.length ? (
        <div className="grid min-w-0 gap-3" data-testid="v3-journal">
          <DataTable
            label="Журнал действий"
            data={named}
            columns={columns}
            getRowId={(row) => row.id}
            searchPlaceholder="Найти среди показанных"
            columnMenu={false}
            paginate={false}
          />
          {props.hrefs.next ? <div><Button variant="outline" asChild><Link href={props.hrefs.next}>Следующие события</Link></Button></div> : null}
          <p className="t-meta text-fg-3">Для событий указан тип участника: сотрудник, сервис или система. Личные данные участников не показываются.</p>
        </div>
      ) : null}
    </div>
  );
}
