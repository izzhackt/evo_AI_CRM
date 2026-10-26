"use client";

import { useState } from "react";

import { DataTable, DetailSheet, KeyFacts, StatusBadge, WidgetCard, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { SAMPLE_REQUESTS, type SampleRequest } from "./kit-sample-data";

const COLUMNS: DataTableColumn<SampleRequest>[] = [
  { accessorKey: "name", header: "Имя", meta: { mobile: "title" }, enableHiding: false },
  { accessorKey: "source", header: "Источник" },
  { accessorKey: "stage", header: "Этап", cell: ({ row }) => <StatusBadge label={row.original.stage} tone={row.original.tone} /> },
  { accessorKey: "manager", header: "Ответственный", meta: { mobile: "hide" } },
  { accessorKey: "received", header: "Получена" },
  { accessorKey: "budget", header: "Бюджет, $", meta: { align: "end" }, cell: ({ row }) => (row.original.budget === null ? "—" : row.original.budget.toLocaleString("ru-RU")) },
];

/** Таблица и панель записи: нажатие на строку открывает `DetailSheet` с действиями записи. */
export function KitTable() {
  const [current, setCurrent] = useState<SampleRequest | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <WidgetCard
      title="Таблица"
      help="Поиск, сортировка по заголовку, видимость колонок, страницы. Строка открывает панель записи. Меньше 768 px таблица становится списком карточек."
      actions={<Button variant="outline" onClick={() => setLoading((value) => !value)} aria-pressed={loading}>Загрузка</Button>}
    >
      <DataTable label="Заявки (пример)" data={SAMPLE_REQUESTS} columns={COLUMNS} getRowId={(row) => row.id} onRowClick={setCurrent} loading={loading} pageSize={10} searchPlaceholder="Поиск по заявкам" />
      <DetailSheet
        open={current !== null}
        onOpenChange={(open) => { if (!open) setCurrent(null); }}
        title={current?.name ?? "Заявка"}
        help="Сюда вкладываются существующие формы и серверные действия записи; панель только показывает их."
        footer={<><Button variant="outline" onClick={() => setCurrent(null)}>Закрыть</Button><Button>Взять в работу</Button></>}
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
