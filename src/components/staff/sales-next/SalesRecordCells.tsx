import { StatusBadge, type DataTableColumn } from "@/components/kit";
import { SalesWithdrawalControl } from "@/components/staff/SalesWithdrawal";

import type { SalesRowData } from "./sales-next-types";

const MONO = "font-mono tabular-nums";
const dash = <span className="text-fg-3">—</span>;

const text = (id: string, header: string, value: (row: SalesRowData) => string, wide = true): DataTableColumn<SalesRowData> => ({
  id, header, accessorFn: value, meta: { wide, mobile: "hide", label: header },
  cell: ({ row }) => <span className="block max-w-48 truncate text-fg-2" title={value(row.original) || undefined}>{value(row.original) || "—"}</span>,
});

/**
 * Колонки таблицы «Отчёта продаж» по таблице владельца (06.11.2026): ФИО студента, страна, стоимость, дата подписания, оплачено, ДОЛГ
 * (стоимость − оплачено; красным и словом, когда больше нуля), университет, программа, интейк, статус, менеджер. Суммы — как записаны, в
 * своей валюте, без пересчёта. Под именем — слово отказа и «Уточнить: …» словами записи; на телефоне там же страна и дата (карточка
 * показывает три данных: стоимость, оплачено, долг). Дополнительные оплаты в записи отчёта пока не хранятся — колонки нет, пока их
 * нечем заполнить. «Убрать» / «Вернуть» — прежняя кнопка с прежним request_id.
 */
export function salesRecordColumns({ showRest, showAction }: Readonly<{ showRest: boolean; showAction: boolean }>): DataTableColumn<SalesRowData>[] {
  const money = (id: string, header: string, text: (row: SalesRowData) => string | null, sort: (row: SalesRowData) => number | null, title?: (row: SalesRowData) => string | null): DataTableColumn<SalesRowData> => ({
    id, header, accessorFn: (row) => sort(row) ?? -1, meta: { align: "end" },
    cell: ({ row }) => <span className="block truncate tabular-nums" title={title?.(row.original) ?? text(row.original) ?? undefined}>{text(row.original) ?? "—"}</span>,
  });
  const dateCell = (one: SalesRowData) => (
    <span className="grid text-fg-2">
      {one.signingDate && one.dateDay ? <time dateTime={one.signingDate} className={MONO}>{one.dateDay}{one.dateYear ? <span className="block t-meta" data-sale-year={one.dateYear}><span className="sr-only">.</span>{one.dateYear}</span> : null}</time> : dash}
      {one.reportMonth ? <time dateTime={one.reportMonth.dateTime} className={`t-meta ${MONO}`} data-report-month={one.reportMonth.dateTime} title={`Месяц отчёта: ${one.reportMonth.words}`}><span className="sr-only">месяц отчёта </span>{one.reportMonth.compact}</time> : null}
    </span>
  );
  return [
    {
      id: "name", header: "ФИО студента", accessorFn: (row) => row.name, meta: { mobile: "title", label: "Студент" }, enableHiding: false,
      cell: ({ row }) => {
        const one = row.original;
        // «Сверено» — норма, её не пишем; «Уточнить: …», «Статус не указан» и «В архиве» остаются на виду под именем.
        const note = one.reviewText === "Сверено" ? null : one.reviewTone === "review" ? `Уточнить: ${one.reviewText}` : one.reviewText;
        const phoneLine = [one.country, one.signingDate && one.dateDay ? `${one.dateDay}${one.dateYear ? `.${one.dateYear}` : ""}` : null].filter(Boolean).join(" · ");
        return (
          <span className="grid min-w-0 max-w-56 gap-0.5">
            <span className="block truncate" title={one.name}>{one.name}</span>
            {phoneLine ? <span className="block truncate t-meta text-fg-3 md:hidden">{phoneLine}</span> : null}
            {one.refusal ? <span className="flex max-w-full" data-row-withdrawal={one.refusal.tone}><StatusBadge label={one.refusal.word} tone={one.refusal.tone} wrap /></span> : null}
            {note ? <span className={`block truncate t-meta ${one.reviewTone === "review" ? "text-fg-2" : "text-fg-3"}`} title={note} data-row-review="">{note}</span> : null}
          </span>
        );
      },
    },
    { ...text("country", "Страна", (row) => row.country, false), meta: { mobile: "hide", label: "Страна" } },
    money("cost", "Стоимость", (row) => row.cost, (row) => row.costMinor),
    {
      id: "date", header: "Дата подписания", accessorFn: (row) => row.signingDate ?? "", sortUndefined: "last", meta: { mobile: "hide", label: "Дата подписания" },
      cell: ({ row }) => dateCell(row.original),
    },
    money("paid", "Оплачено", (row) => row.paid, (row) => row.paidMinor, (row) => row.paidTitle),
    ...(showRest ? [{
      id: "rest", header: "Долг", accessorFn: (row: SalesRowData) => row.debtMinor ?? -1, meta: { align: "end", label: "Долг" } as const,
      cell: ({ row }: { row: { original: SalesRowData } }) => {
        const one = row.original;
        const owed = one.debtMinor !== null && one.debtMinor > 0;
        return (
          <span className={`block truncate font-medium tabular-nums ${owed ? "text-danger" : "text-fg-2"}`} title={one.remainderTitle ?? undefined} data-no-remainder={one.noRemainder ?? undefined} data-debt={owed ? "" : undefined}>
            {owed ? <span className="sr-only">Долг: </span> : null}{one.remainder ?? "—"}{one.noRemainder ? <span className="sr-only"> ({one.remainderTitle})</span> : null}
          </span>
        );
      },
    } satisfies DataTableColumn<SalesRowData>] : []),
    text("university", "Университет", (row) => row.university),
    text("program", "Программа", (row) => row.program),
    text("intake", "Интейк", (row) => row.intake),
    text("status", "Статус", (row) => row.status),
    text("manager", "Менеджер", (row) => row.manager),
    ...(showAction ? [{
      id: "action", header: "Действие", enableSorting: false, enableHiding: false, accessorFn: () => "", meta: { mobile: "hide" } as const,
      cell: ({ row }: { row: { original: SalesRowData } }) => row.original.action
        ? <SalesWithdrawalControl record={{ id: row.original.id, version: row.original.action.version }} name={row.original.name} withdrawn={row.original.action.withdrawn} requestId={row.original.action.requestId} />
        : null,
    } satisfies DataTableColumn<SalesRowData>] : []),
  ];
}
