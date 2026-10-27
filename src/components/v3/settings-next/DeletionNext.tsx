"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DataTable, DetailSheet, EmptyState, StatusBadge, type DataTableColumn } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";
import { modeText } from "@/components/v3/settings/AccountDeletionSection";
import { accountDeletionDate, accountDeletionDueText, accountDeletionKindWord, type AccountDeletionQueueRow } from "@/lib/account-deletion-contract";
import type { AccountDeletionDetailRead, AccountDeletionQueueRead } from "@/lib/v3/account-deletion-source";

import { DeletionDetailBody } from "./DeletionDetailBody";
import { deletionStatusBadge } from "./deletion-rows";

const Day = ({ at }: Readonly<{ at: string }>) => <time dateTime={at} className="tabular-nums">{accountDeletionDate(at)}</time>;

function columns(now: Date): DataTableColumn<AccountDeletionQueueRow>[] {
  return [
    {
      id: "person", accessorFn: (row) => row.displayName, header: "Человек", meta: { mobile: "title" }, enableHiding: false,
      cell: ({ row }) => (
        <span className="block min-w-0" data-request={row.original.id} data-status={row.original.status} data-mode={row.original.mode} data-overdue={row.original.overdue || undefined}>
          <span className="block font-medium text-fg [overflow-wrap:anywhere]">{row.original.displayName}</span>
          <span className="block break-all t-meta text-fg-3">{accountDeletionKindWord(row.original.kind, row.original.applicationSubmitted)}{row.original.email ? ` · ${row.original.email}` : ""}</span>
        </span>
      ),
    },
    {
      id: "due", accessorFn: (row) => row.dueAt, header: "Срок",
      cell: ({ row }) => {
        const due = accountDeletionDueText(row.original, now);
        return <span className="flex flex-wrap items-center gap-1.5"><span className={row.original.overdue ? "font-medium text-danger" : undefined}><Day at={row.original.dueAt} /></span><StatusBadge tone={due.tone === "danger" ? "danger" : due.tone === "warn" ? "warn" : "neutral"} label={due.text} /></span>;
      },
    },
    {
      id: "state", accessorFn: (row) => row.status, header: "Состояние", meta: { label: "Состояние" },
      cell: ({ row }) => <span className="block">{deletionStatusBadge(row.original)}<span className="block t-meta text-fg-2">{modeText(row.original)}{row.original.status === "completed" && row.original.completedAt ? <>, <Day at={row.original.completedAt} /></> : null}</span></span>,
    },
    { id: "requested", accessorFn: (row) => row.requestedAt, header: "Запрос", meta: { wide: true }, cell: ({ row }) => <Day at={row.original.requestedAt} /> },
  ];
}

/**
 * «Запросы на удаление»: очередь (человек, срок со словом, состояние) и запрос в панели. Запрос открывается адресом `?request=`, как
 * раньше: ссылку можно переслать, «Назад» закрывает панель, а содержимое приходит с сервера (скелет под названием, пока оно идёт).
 * Закрытие возвращает к очереди. Просроченное остаётся красным словом на виду.
 */
export function DeletionNext({ queue, detail, listHref, nowIso }: Readonly<{ queue: AccountDeletionQueueRead | undefined; detail: AccountDeletionDetailRead | null; listHref: string; nowIso: string }>) {
  const router = useRouter();
  const now = new Date(nowIso);
  const openKey = detail === null ? null : detail.status === "ready" ? detail.detail.id : "missing";
  const [synced, setSynced] = useState(openKey);
  const [target, setTarget] = useState(openKey);
  if (synced !== openKey) { setSynced(openKey); setTarget(openKey); }
  const go = (key: string | null, href: string) => { setTarget(key); router.push(href, { scroll: false }); };
  const confirmed = target === openKey;
  const ready = confirmed && detail !== null;
  const rows = queue?.status === "ready" ? queue.rows : null;
  const targetRow = rows?.find((row) => row.id === target) ?? null;
  const title = ready && detail.status === "ready" ? detail.detail.displayName : targetRow?.displayName ?? "Запрос на удаление";
  if (!rows) {
    return (
      <div role={queue?.status === "forbidden" ? undefined : "alert"} className="rounded-card border border-border bg-surface" data-testid="v3-deletions-unavailable">
        <EmptyState tone={queue?.status === "forbidden" ? "neutral" : "danger"}
          title={queue?.status === "forbidden" ? "Запросы на удаление видит и выполняет только администратор." : "Не удалось загрузить запросы на удаление. Обновите страницу."} />
      </div>
    );
  }
  const openCount = rows.filter((row) => row.status !== "completed").length;
  return (
    <div className="grid min-w-0 gap-3" data-testid="v3-deletions">
      <p className="t-body-compact text-fg-2" data-testid="v3-deletions-summary">{openCount === 0 ? "Открытых запросов нет." : `Открытых запросов: ${openCount}.`}</p>
      <DataTable
        label="Запросы на удаление аккаунта"
        data={rows}
        columns={columns(now)}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.displayName}
        onRowClick={(row) => go(row.id, `${listHref}&request=${encodeURIComponent(row.id)}`)}
        searchPlaceholder="Найти запрос"
        columnMenu={false}
        empty={<div data-testid="v3-deletions-empty"><EmptyState title="Запросов на удаление нет" description="Запрос появится здесь, когда человек нажмёт «Удалить аккаунт» в кабинете или в приложении iPhone. Срок — 30 дней с даты запроса." /></div>}
      />
      <DetailSheet open={target !== null} onOpenChange={(next) => { if (!next) go(null, listHref); }} title={title}
        description={ready && detail.status === "ready" ? `${accountDeletionKindWord(detail.detail.kind, detail.detail.applicationSubmitted)}${detail.detail.email ? ` · ${detail.detail.email}` : ""}` : undefined}>
        {ready ? <DeletionDetailBody read={detail} nowIso={nowIso} /> : (
          <div className="grid gap-3" aria-busy="true"><p role="status" className="sr-only">Открываем запрос…</p><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-24 w-full" /></div>
        )}
      </DetailSheet>
    </div>
  );
}
