import { StatusBadge, type DataTableColumn } from "@/components/kit";
import { SalesWithdrawalControl } from "@/components/staff/SalesWithdrawal";

import type { SalesRowData } from "./sales-next-types";

const MONO = "font-mono tabular-nums";
const dash = <span className="text-fg-3">—</span>;
/** Как прежняя колонка «Страна»: без учёта регистра («малайзия» — вместе с «Малайзия»). */
const byText = new Intl.Collator("ru", { sensitivity: "base" }).compare;

/** Поля одной ячейки через « · »: на экране — значения, для читалки — с именем поля («Страна: Малайзия»). Пустые не рисуются. */
function fields(items: ReadonlyArray<readonly [label: string | null, value: string]>) {
  const shown = items.filter(([, value]) => value);
  if (shown.length === 0) return null;
  return shown.map(([label, value], index) => (
    <span key={label ?? value}>
      {/* Пробел — до скрытой точки: пробел сразу после aria-hidden Chrome выбрасывает, и читалка склеивает соседние поля. */}
      {index > 0 ? <>{" "}<span aria-hidden="true">·</span>{" "}</> : null}
      {label ? <span className="sr-only">{`${label}: `}</span> : null}{value}
    </span>
  ));
}

/**
 * Колонки таблицы «Отчёта продаж» по таблице владельца (06.11.2026): ФИО студента, страна, стоимость, дата подписания, оплачено, ДОЛГ
 * (стоимость − оплачено; красным и словом, когда больше нуля), университет, программа, интейк, статус, менеджер. 15.11.2026 (решение
 * упростить отчёт): одиннадцать столбцов не помещались и на 1920 px (прокрутка вбок, имя обрезано до «Алина Пере…»), поэтому родственные поля
 * стоят в одной ячейке двумя строками — ни одно не убрано с экрана: колонка «Страна» от 64rem ширины таблицы раскрывается в «Страну и
 * программу» (под ней университет и интейк; уже — только страна, как раньше, остальное — в панели записи), статус оплаты — под «Оплачено».
 * Имя и заметки под ним переносятся, а не обрезаются; суммы не переносятся и не обрезаются; строка выровнена по первой строке ячеек.
 * Суммы — как записаны, в своей валюте, без пересчёта. Под именем — слово отказа и «Уточнить: …» словами записи; на телефоне там же
 * страна и дата (карточка показывает три данных: стоимость, оплачено, долг). «Убрать» / «Вернуть» — прежняя кнопка с прежним request_id.
 */
export function salesRecordColumns({ showRest, showAction }: Readonly<{ showRest: boolean; showAction: boolean }>): DataTableColumn<SalesRowData>[] {
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
        // Одна сжимаемая дорожка сетки: длинное слово без пробелов (адрес почты) переносится внутри ячейки, а не ложится на соседнюю.
        // Таблица уже 48rem прокручивается вбок при любом минимуме — там имени больше места и строки ниже; шире — минимум 7rem.
        return (
          <span className="grid min-w-40 max-w-60 grid-cols-1 gap-0.5 @3xl:min-w-28">
            <span className="block break-words">{one.name}</span>
            {phoneLine ? <span className="block truncate t-meta text-fg-3 md:hidden">{phoneLine}</span> : null}
            {one.refusal ? <span className="flex max-w-full" data-row-withdrawal={one.refusal.tone}><StatusBadge label={one.refusal.word} tone={one.refusal.tone} wrap /></span> : null}
            {note ? <span className={`block break-words t-meta ${one.reviewTone === "review" ? "text-fg-2" : "text-fg-3"}`} data-row-review="">{note}</span> : null}
          </span>
        );
      },
    },
    {
      // Сортировка — по стране, затем по программе (как прежняя колонка «Страна»); подпись — по ширине таблицы.
      id: "place", accessorFn: (row) => row.country, sortFn: (left, right) => byText(left.original.country, right.original.country) || byText(left.original.program, right.original.program),
      header: () => <><span className="@5xl:hidden">Страна</span><span className="hidden @5xl:inline">Страна и программа</span></>,
      meta: { mobile: "hide", label: "Страна и программа" },
      cell: ({ row }) => {
        const one = row.original;
        const more = fields([["Университет", one.university], [null, one.intake ? `интейк ${one.intake}` : ""]]);
        return (
          // Узкая таблица — только страна, как прежняя колонка: целиком до 12rem, длиннее — с многоточием (полное — в подсказке и в панели);
          // широкая — сжимаемая дорожка в 9–16rem, длинное слово переносится внутри. Страны нет — «—», и рядом с программой тоже.
          <span className="block text-fg-2 @5xl:grid @5xl:min-w-36 @5xl:max-w-64 @5xl:grid-cols-1 @5xl:gap-0.5" data-sale-place="">
            <span className="block max-w-48 truncate @5xl:hidden" title={one.country || undefined}>{one.country || dash}</span>
            <span className="hidden break-words @5xl:block">{one.country || one.program ? fields([["Страна", one.country || "—"], ["Программа", one.program]]) : dash}</span>
            {more ? <span className="hidden break-words t-meta text-fg-3 @5xl:block">{more}</span> : null}
          </span>
        );
      },
    },
    {
      id: "cost", header: "Стоимость", accessorFn: (row) => row.costMinor ?? -1, meta: { align: "end" },
      cell: ({ row }) => <span className="block whitespace-nowrap tabular-nums">{row.original.cost ?? "—"}</span>,
    },
    {
      // Таблица уже 68rem — заголовок в две строки (перенос задан, поэтому стрелка сортировки стоит у текста, а не у края колонки); порог
      // другой, чем у «Страны и программы» (64rem): ширина не прыгает на обоих сразу.
      id: "date", header: () => <span className="text-start">Дата <br className="@[68rem]:hidden" />подписания</span>, accessorFn: (row) => row.signingDate ?? "", sortUndefined: "last", meta: { mobile: "hide", label: "Дата подписания" },
      cell: ({ row }) => dateCell(row.original),
    },
    {
      id: "paid", header: "Оплачено", accessorFn: (row) => row.paidMinor ?? -1, meta: { align: "end", label: "Оплачено" },
      cell: ({ row }) => {
        const one = row.original;
        // Статус оплаты — как записан в отчёте, под суммой; от 60rem «Частично оплачено» в одну строку; на телефоне карточка, как раньше, без него.
        return (
          <span className="grid justify-items-end gap-0.5">
            <span className="whitespace-nowrap tabular-nums" title={one.paidTitle ?? undefined}>{one.paid ?? "—"}</span>
            {one.status ? <span className="hidden max-w-40 break-words text-end t-meta text-fg-3 md:block @[60rem]:min-w-30" data-sale-status=""><span className="sr-only">Статус: </span>{one.status}</span> : null}
          </span>
        );
      },
    },
    ...(showRest ? [{
      id: "rest", header: "Долг", accessorFn: (row: SalesRowData) => row.debtMinor ?? -1, meta: { align: "end", label: "Долг" } as const,
      cell: ({ row }: { row: { original: SalesRowData } }) => {
        const one = row.original;
        const owed = one.debtMinor !== null && one.debtMinor > 0;
        return (
          <span className={`block whitespace-nowrap font-medium tabular-nums ${owed ? "text-danger" : "text-fg-2"}`} title={one.remainderTitle ?? undefined} data-no-remainder={one.noRemainder ?? undefined} data-debt={owed ? "" : undefined}>
            {owed ? <span className="sr-only">Долг: </span> : null}{one.remainder ?? "—"}{one.noRemainder ? <span className="sr-only"> ({one.remainderTitle})</span> : null}
          </span>
        );
      },
    } satisfies DataTableColumn<SalesRowData>] : []),
    {
      id: "manager", header: "Менеджер", accessorFn: (row) => row.manager, meta: { wide: true, mobile: "hide", label: "Менеджер" },
      cell: ({ row }) => <span className="block min-w-20 max-w-44 break-words text-fg-2">{row.original.manager || "—"}</span>,
    },
    ...(showAction ? [{
      id: "action", header: "Действие", enableSorting: false, enableHiding: false, accessorFn: () => "", meta: { mobile: "hide" } as const,
      cell: ({ row }: { row: { original: SalesRowData } }) => row.original.action
        // −12 px сверху и снизу: подпись кнопки (44 px) встаёт на линию первой строки, а строка не становится выше.
        ? <span className="-my-3 block" data-sale-action=""><SalesWithdrawalControl record={{ id: row.original.id, version: row.original.action.version }} name={row.original.name} withdrawn={row.original.action.withdrawn} requestId={row.original.action.requestId} /></span>
        : null,
    } satisfies DataTableColumn<SalesRowData>] : []),
  ];
}
