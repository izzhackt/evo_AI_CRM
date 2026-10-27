"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { DataTable, DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { salesRecordColumns } from "./SalesRecordCells";
import type { SalesRowData } from "./sales-next-types";

/** Панель записи, которую рисует сервер: просмотр или форма (`SalesRecordPreview`, `SalesRegisterForm`), шапка — прежние тексты. */
export type SalesSheetContent = Readonly<{
  title: string;
  description?: string;
  open: Readonly<{ href: string; label: string }> | null;
  extra: React.ReactNode;
  body: React.ReactNode;
}>;

/**
 * Таблица записей «Отчёта продаж» и панель записи. Запись открывается адресом (`?record=`, как раньше): ссылка работает, «Назад» закрывает
 * панель, а тело панели и её request_id приходят с сервера. Панель открывается сразу по нажатию (скелет под названием строки), пока
 * сервер присылает запись. Страницы и фильтры ведёт сервер, поэтому у таблицы нет ни своего поиска, ни своих страниц; строка поиска и фильтров
 * (`toolbar`) занимает всю строку инструментов таблицы, как у прежнего вида, — иначе поле поиска сжимается и обрезает подсказку. Подвал панели
 * есть, только когда в нём есть действие: пустая полоса с рамкой забирает высоту у формы на телефоне.
 */
export function SalesRecordsTable({ rows, openKey, sheet, listHref, toolbar, empty, showRest, showAction, count }: Readonly<{
  rows: readonly SalesRowData[];
  openKey: string | null;
  sheet: SalesSheetContent | null;
  listHref: string;
  toolbar: React.ReactNode;
  empty: React.ReactNode;
  showRest: boolean;
  showAction: boolean;
  count: number;
}>) {
  const router = useRouter();
  const columns = useMemo(() => salesRecordColumns({ showRest, showAction }), [showRest, showAction]);
  const [syncedKey, setSyncedKey] = useState(openKey);
  const [target, setTarget] = useState(openKey);
  if (syncedKey !== openKey) {
    setSyncedKey(openKey);
    setTarget(openKey);
  }
  // Последняя панель остаётся в состоянии: 200 мс закрытия она ещё видна, и пустой шапки не мигает.
  const [kept, setKept] = useState(sheet);
  if (sheet && kept !== sheet) setKept(sheet);
  const go = (key: string | null, href: string) => {
    setTarget(key);
    router.push(href, { scroll: false });
  };
  const confirmed = target === openKey;
  const ready = confirmed && sheet !== null;
  const open = target !== null && (confirmed ? sheet !== null : true);
  const targetRow = rows.find((row) => row.id === target) ?? null;
  const shown = ready ? sheet : open ? null : kept;
  return (
    <>
      <DataTable
        label={`Записи продаж: ${count}`}
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        onRowClick={(row) => go(row.id, row.href)}
        getRowLabel={(row) => row.name}
        searchable={false}
        paginate={false}
        toolbar={toolbar ? <div className="min-w-0 flex-1">{toolbar}</div> : null}
        empty={empty}
        columnMenu={false}
      />
      <DetailSheet
        open={open}
        onOpenChange={(next) => { if (!next) go(null, listHref); }}
        title={shown?.title ?? targetRow?.name ?? "Запись продажи"}
        description={shown?.description}
        footer={shown && (shown.open || shown.extra) ? (
          <>
            {shown.open ? <Button variant="outline" asChild><Link href={shown.open.href}>{shown.open.label}</Link></Button> : null}
            {shown.extra}
          </>
        ) : undefined}
      >
        {shown ? shown.body : (
          <div className="space-y-3" aria-busy="true">
            <p role="status" className="sr-only">Открываем запись…</p>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-11 w-40" />
          </div>
        )}
      </DetailSheet>
    </>
  );
}
