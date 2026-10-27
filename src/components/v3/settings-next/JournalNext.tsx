"use client";

import { DownloadIcon } from "lucide-react";
import Link from "next/link";

import { DataTable, EmptyState, StatusBadge, WidgetCard, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { BoardSegments } from "@/components/v3/board/Board";

import type { JournalNextRow, SettingsJournalProps } from "./settings-next-types";

const columns: DataTableColumn<JournalNextRow>[] = [
  {
    id: "event", accessorFn: (row) => row.event, header: "Событие", meta: { mobile: "title" }, enableHiding: false,
    cell: ({ row }) => <span className="font-medium text-fg [overflow-wrap:anywhere]">{row.original.event}</span>,
  },
  { id: "at", accessorFn: (row) => row.at, header: "Когда", cell: ({ row }) => <span className="tabular-nums">{row.original.at}</span> },
  { id: "actor", accessorFn: (row) => row.actor, header: "Кто", cell: ({ row }) => <StatusBadge label={row.original.actor} /> },
  {
    id: "object", accessorFn: (row) => row.object ?? "", header: "Объект",
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-x-2">
        {row.original.object}
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
 * у таблицы нет своих страниц и поиск идёт по показанным строкам; ссылка есть и тогда, когда названных событий на странице нет (иначе
 * дальше журнал пришлось бы листать правкой адреса). Слова журнала считает сервер (`journalNextProps`): таблицы слов в клиентский кусок не
 * едут. Выключенный или недоступный журнал — слова, не «0».
 */
export function JournalNext(props: SettingsJournalProps) {
  const { notice, types } = props;
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-journal">
      {types ? <BoardSegments label="Тип записи" showLabel items={types.map((type) => ({ key: type.key, title: type.title, count: type.count, href: type.href, active: type.active }))} /> : null}
      {props.exportEnabled ? (
        <WidgetCard
          headingLevel={3}
          title="Экспорт журнала"
          help={props.exportHelp}
          actions={(
            <form action="/api/platform-audit/export" method="post" encType="application/x-www-form-urlencoded" data-testid="v3-audit-export">
              <input type="hidden" name="request_id" value={props.exportRequestId} />
              <input type="hidden" name="start_at" value={props.exportStartAt} />
              <input type="hidden" name="end_at" value={props.exportEndAt} />
              {props.exportObjectType ? <input type="hidden" name="resource_types" value={props.exportObjectType} /> : null}
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
            action={notice.retry ? <Button variant="outline" asChild><Link href={props.retryHref}>Повторить</Link></Button> : undefined}
          />
        </div>
      ) : null}
      {props.unnamed > 0 ? <p className="t-meta text-fg-3">{props.unnamed} {words(props.unnamed)}</p> : null}
      {props.rows.length || props.nextHref ? (
        <div className="grid min-w-0 gap-3" data-testid="v3-journal">
          {props.rows.length ? (
            <DataTable
              label="Журнал действий"
              data={props.rows}
              columns={columns}
              getRowId={(row) => row.id}
              searchPlaceholder="Найти среди показанных"
              columnMenu={false}
              paginate={false}
            />
          ) : null}
          {props.nextHref ? <div><Button variant="outline" asChild><Link href={props.nextHref}>Следующие события</Link></Button></div> : null}
          {props.rows.length ? <p className="t-meta text-fg-3">Для событий указан тип участника: сотрудник, сервис или система. Личные данные участников не показываются.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
