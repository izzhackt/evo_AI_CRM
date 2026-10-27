import { StatusBadge, type DataTableColumn } from "@/components/kit";
import { SalesWithdrawalControl } from "@/components/v3/SalesWithdrawal";

import type { SalesRowData } from "./sales-next-types";

const MONO = "font-mono tabular-nums";
const dash = <span className="text-fg-3">—</span>;

/**
 * Колонки таблицы «Отчёта продаж»: имя (название строки; под ним слово отказа и «Уточнить: …» словами записи), страна · программа с менеджером
 * (колонка второго плана, сведения есть и в панели), дата продажи (год другой продажи и месяц отчёта — второй строкой), суммы по правому
 * краю и «Убрать» / «Вернуть» (прежняя кнопка с прежним request_id). На телефоне в карточке: имя, дата, стоимость, оплачено.
 */
export function salesRecordColumns({ showRest, showAction }: Readonly<{ showRest: boolean; showAction: boolean }>): DataTableColumn<SalesRowData>[] {
  const money = (id: string, header: string, text: (row: SalesRowData) => string | null, sort: (row: SalesRowData) => number | null, title?: (row: SalesRowData) => string | null, mobile?: "hide"): DataTableColumn<SalesRowData> => ({
    id, header, accessorFn: (row) => sort(row) ?? -1, meta: { align: "end", ...(mobile ? { mobile } : {}) },
    cell: ({ row }) => <span className="block truncate tabular-nums" title={title?.(row.original) ?? text(row.original) ?? undefined}>{text(row.original) ?? "—"}</span>,
  });
  return [
    {
      id: "name", header: "Студент", accessorFn: (row) => row.name, meta: { mobile: "title" }, enableHiding: false,
      cell: ({ row }) => {
        const one = row.original;
        // «Сверено» — норма, её не пишем; «Уточнить: …», «Статус не указан» и «В архиве» остаются на виду под именем.
        const note = one.reviewText === "Сверено" ? null : one.reviewTone === "review" ? `Уточнить: ${one.reviewText}` : one.reviewText;
        return (
          <span className="grid min-w-0 max-w-56 gap-0.5">
            <span className="block truncate" title={one.name}>{one.name}</span>
            {one.refusal ? <span className="flex max-w-full" data-row-withdrawal={one.refusal.tone}><StatusBadge label={one.refusal.word} tone={one.refusal.tone} wrap /></span> : null}
            {note ? <span className={`block truncate t-meta ${one.reviewTone === "review" ? "text-fg-2" : "text-fg-3"}`} title={note} data-row-review="">{note}</span> : null}
          </span>
        );
      },
    },
    {
      id: "place", header: "Страна · программа", accessorFn: (row) => `${row.place} ${row.manager}`, meta: { wide: true, mobile: "hide", label: "Страна · программа" },
      cell: ({ row }) => (
        <span className="grid min-w-0 max-w-56">
          <span className="block truncate text-fg-2" title={row.original.place || undefined}>{row.original.place || "—"}</span>
          <span className="block truncate t-meta text-fg-3" title={row.original.manager || undefined}>{row.original.manager}</span>
        </span>
      ),
    },
    {
      id: "date", header: "Дата", accessorFn: (row) => row.signingDate ?? "", sortUndefined: "last",
      cell: ({ row }) => {
        const one = row.original;
        return (
          <span className="grid text-fg-2">
            {one.signingDate && one.dateDay ? <time dateTime={one.signingDate} className={MONO}>{one.dateDay}{one.dateYear ? <span className="block t-meta" data-sale-year={one.dateYear}><span className="sr-only">.</span>{one.dateYear}</span> : null}</time> : dash}
            {one.reportMonth ? <time dateTime={one.reportMonth.dateTime} className={`t-meta ${MONO}`} data-report-month={one.reportMonth.dateTime} title={`Месяц отчёта: ${one.reportMonth.words}`}><span className="sr-only">месяц отчёта </span>{one.reportMonth.compact}</time> : null}
          </span>
        );
      },
    },
    money("cost", "Стоимость", (row) => row.cost, (row) => row.costMinor),
    money("paid", "Оплачено", (row) => row.paid, (row) => row.paidMinor, (row) => row.paidTitle),
    ...(showRest ? [{
      id: "rest", header: "Остаток", accessorFn: (row: SalesRowData) => row.remainder ?? "", meta: { align: "end", mobile: "hide" } as const,
      cell: ({ row }: { row: { original: SalesRowData } }) => <span className="block truncate font-medium tabular-nums" title={row.original.remainderTitle ?? undefined} data-no-remainder={row.original.noRemainder ?? undefined}>{row.original.remainder ?? "—"}{row.original.noRemainder ? <span className="sr-only"> ({row.original.remainderTitle})</span> : null}</span>,
    } satisfies DataTableColumn<SalesRowData>] : []),
    ...(showAction ? [{
      id: "action", header: "Действие", enableSorting: false, enableHiding: false, accessorFn: () => "", meta: { mobile: "hide" } as const,
      cell: ({ row }: { row: { original: SalesRowData } }) => row.original.action
        ? <SalesWithdrawalControl record={{ id: row.original.id, version: row.original.action.version }} name={row.original.name} withdrawn={row.original.action.withdrawn} requestId={row.original.action.requestId} />
        : null,
    } satisfies DataTableColumn<SalesRowData>] : []),
  ];
}
