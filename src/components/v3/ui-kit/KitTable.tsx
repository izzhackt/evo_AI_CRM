"use client";

import { useMemo, useState } from "react";

import { DataTable, DetailSheet, KeyFacts, StatusBadge, WidgetCard, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { SAMPLE_REQUESTS, type SampleRequest } from "./kit-sample-data";

/**
 * Колонки примера. Имя — ссылка, «Действие» — кнопка: нажатие на них не открывает панель записи (ни на строке, ни
 * на карточке телефона), а само имя и действие работают как обычно. На карточке видны заголовок и три данных,
 * поэтому «Источник» и «Получена» там скрыты, чтобы действие поместилось.
 */
function columnsFor(taken: readonly string[], take: (id: string) => void): DataTableColumn<SampleRequest>[] {
  return [
    { accessorKey: "name", header: "Имя", meta: { mobile: "title" }, enableHiding: false, cell: ({ row }) => <a href={`#${row.original.id}`} className="inline-flex min-h-11 items-center rounded-nav underline-offset-2 hover:underline">{row.original.name}</a> },
    { accessorKey: "source", header: "Источник", meta: { mobile: "hide" } },
    { accessorKey: "stage", header: "Этап", cell: ({ row }) => <StatusBadge label={row.original.stage} tone={row.original.tone} /> },
    { accessorKey: "manager", header: "Ответственный", meta: { mobile: "hide" } },
    { accessorKey: "received", header: "Получена", meta: { mobile: "hide" } },
    { accessorKey: "budget", header: "Бюджет, $", meta: { align: "end" }, cell: ({ row }) => (row.original.budget === null ? "—" : row.original.budget.toLocaleString("ru-RU")) },
    {
      id: "action",
      header: "Действие",
      enableSorting: false,
      cell: ({ row }) => (taken.includes(row.original.id) ? <StatusBadge label="Взята" tone="ok" /> : <Button variant="outline" onClick={() => take(row.original.id)}>Взять</Button>),
    },
  ];
}

/** Таблица и панель записи: нажатие на строку открывает `DetailSheet` с действиями записи. */
export function KitTable() {
  // Последняя выбранная запись остаётся в состоянии и после закрытия: панель 200 мс уезжает, и пустой она не мигает.
  const [current, setCurrent] = useState<SampleRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [taken, setTaken] = useState<readonly string[]>([]);
  const columns = useMemo(() => columnsFor(taken, (id) => setTaken((ids) => [...ids, id])), [taken]);
  return (
    <WidgetCard
      title="Таблица"
      help="Поиск, сортировка по заголовку, видимость колонок, страницы. Строка открывает панель записи. Меньше 768 px таблица становится списком карточек."
      actions={<Button variant="outline" onClick={() => setLoading((value) => !value)} aria-pressed={loading}>Загрузка</Button>}
    >
      <DataTable label="Заявки (пример)" data={SAMPLE_REQUESTS} columns={columns} getRowId={(row) => row.id} onRowClick={(row) => { setCurrent(row); setOpen(true); }} getRowLabel={(row) => row.name} loading={loading} pageSize={10} searchPlaceholder="Поиск по заявкам" />
      <DetailSheet
        open={open}
        onOpenChange={setOpen}
        title={current?.name ?? "Заявка"}
        help="Сюда вкладываются существующие формы и серверные действия записи; панель только показывает их."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Закрыть</Button><Button>Взять в работу</Button></>}
      >
        {current ? (
          <KeyFacts columns={2} facts={[
            { label: "Источник", value: current.source },
            { label: "Этап", value: <StatusBadge label={current.stage} tone={current.tone} /> },
            { label: "Ответственный", value: current.manager },
            { label: "Получена", value: current.received },
            { label: "Бюджет, $", value: current.budget === null ? null : current.budget.toLocaleString("ru-RU") },
          ]} />
        ) : null}
      </DetailSheet>
    </WidgetCard>
  );
}
