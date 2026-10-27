"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DataTable, DetailSheet, type DataTableColumn } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

import type { RequestSheetContent } from "./RequestSheetBody";
import type { NextRequestRow } from "./requests-next-rows";

/** Колонки «Заявок»: ячейки готовы на сервере (`cells`), таблица сортирует и ищет по словам, которые видит человек. */
const COLUMNS: DataTableColumn<NextRequestRow>[] = [
  { id: "name", accessorFn: (row) => row.name, header: "Заявка", meta: { mobile: "title" }, enableHiding: false, cell: ({ row }) => row.original.cells.name },
  { id: "source", accessorFn: (row) => row.source, header: "Источник", cell: ({ row }) => row.original.cells.source },
  {
    id: "received",
    accessorFn: (row) => row.received,
    header: "Пришла",
    sortFn: (a, b) => (a.original.sortAt < b.original.sortAt ? -1 : a.original.sortAt > b.original.sortAt ? 1 : 0),
    cell: ({ row }) => row.original.cells.received,
  },
  { id: "triage", accessorFn: (row) => row.triage, header: "Разбор", meta: { label: "Разбор" }, cell: ({ row }) => row.original.cells.triage },
];

/**
 * Таблица «Заявок» и панель записи. Запись открывается адресом (`?open=`), как и раньше: ссылка работает, «Назад»
 * закрывает панель, а содержимое панели и её request_id приходят с сервера. Панель открывается сразу по нажатию
 * (скелет под названием строки), пока сервер присылает запись; закрытие — тоже сразу. Состояние таблицы (поиск,
 * сортировка, страница) переживает открытие и закрытие панели.
 */
export function RequestsNextTable({
  rows,
  openKey,
  sheet,
  listHref,
  toolbar,
  empty,
}: Readonly<{
  rows: readonly NextRequestRow[];
  /** Запись, открытая адресом; null — панели нет. */
  openKey: string | null;
  /** Панель найденной записи; null — запись не найдена (взята и ушла из «Ждут разбора») или не открыта. */
  sheet: RequestSheetContent | null;
  listHref: string;
  toolbar: React.ReactNode;
  empty: React.ReactNode;
}>) {
  const router = useRouter();
  // Нажатая строка видна сразу, а адрес и запись с сервера догоняют её; пришедший адрес — главнее нажатого.
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
  // Адрес пришёл (`target === openKey`): панель есть, пока сервер нашёл запись; не пришёл — скелет под названием строки.
  const confirmed = target === openKey;
  const ready = confirmed && sheet !== null;
  const open = target !== null && (confirmed ? sheet !== null : true);
  const targetRow = rows.find((row) => row.key === target) ?? null;
  const shown = ready ? sheet : open ? null : kept;

  return (
    <>
      <DataTable
        label="Заявки"
        data={rows}
        columns={COLUMNS}
        getRowId={(row) => row.key}
        onRowClick={(row) => go(row.key, row.openHref)}
        pageSize={50}
        searchPlaceholder="Найти на странице"
        toolbar={toolbar}
        empty={empty}
        columnMenu={false}
      />
      <DetailSheet
        open={open}
        onOpenChange={(next) => { if (!next) go(null, listHref); }}
        title={shown?.title ?? targetRow?.name ?? "Заявка"}
        description={shown?.description}
        footer={shown?.footer}
      >
        {shown ? shown.body : (
          <div className="space-y-3" aria-busy="true">
            <p role="status" className="sr-only">Открываем заявку…</p>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-11 w-40" />
          </div>
        )}
      </DetailSheet>
    </>
  );
}
