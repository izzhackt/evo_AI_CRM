import { staffCanAccessRoute } from "@/lib/platform-access";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { btnCls, btnGhostCls } from "@/components/ui";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { SalesRegisterWorkspace, SalesRegisterRow } from "@/lib/platform-sales-register-contract";
import { SalesRecordLeadFact, SalesRecordLeadMenu } from "./SalesRecordLeadLink";
import { readSalesRegisterPage } from "@/lib/v3/sales-register-page";
import { salesMoneyParts } from "@/lib/sales-register-money-view";
import { SalesPeriodStepper } from "./sales-report/SalesPeriodStepper";
import { SalesReportToolbar } from "./sales-report/SalesReportToolbar";
import { SalesPeriodHeadline } from "./SalesPeriodHeadline";
import { financeMoney } from "@/lib/platform-finance-entry-contract";
import { SalesRegisterForm, SalesTargetForm } from "./SalesRegisterForms";
import { SalesRecordPreview, salesRecordPanelHeader } from "./SalesRecordPreview";
import { SalesWithdrawalControl } from "./SalesWithdrawal";
import { StatusChip } from "./blocks/StatusChip";
import { salesWithdrawalWord } from "@/lib/v3/wording";
import {
  SALES_STATUS_MISSING_TEXT, groupSalesLabels, recordsWord, salesLabelGroupOf, salesPeriodSteps,
  SALES_NO_REMAINDER_TEXT, salesDay, salesDayParts, salesReportMonth, salesRowContractPaid, salesRowNoRemainder, salesRowRemainder, salesRowReview,
  salesWithdrawalTone,
  type SalesMoneySummary,
} from "@/lib/sales-register-view";

import { attributeReturn, sidePanelSplit } from "./panel/side-panel";
import { SidePanel } from "./panel/SidePanel";
import { salesManagersHref, type SalesReportQuery, type SalesSaleSlice } from "@/lib/sales-register-navigation";
export type { SalesReportQuery } from "@/lib/sales-register-navigation";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const money = (minor: number | null, currency: string | null) => minor === null || !currency ? null : `${number.format(minor / 100)} ${currency}`;
const dateLabel = (date: string | null) => date ? date.split("-").reverse().join(".") : "Дата не указана";
const rowDate = salesDay;
const tidy = (value: string) => value.trim().replace(/\s+/gu, " ");
const reportMonthOf = salesReportMonth;
/**
 * Ширины столбцов по содержимому: каждый столбец сумм — по «120 000 KGS»
 * целиком (с полями около 103 px: от 60rem, 960 px, — 11%, от 70rem — 9,5%),
 * остальное — тексту. От 70rem (≈1440) имя, «Страна · программа», менеджер и
 * причина помещаются; уже (≈1280) места на всё нет — сужается текст
 * (подсказка с полным), а не суммы. Во «Весь год» и в срезе «записаны в
 * другой месяц отчёта» есть столбец «Месяц отчёта»: его место берётся у
 * текста, суммы те же. «Дата» (и в коротком наборе) — по «ДД.ММ»: год
 * продажи другого года — второй строкой под датой (12 px), а не «ДД.ММ.ГГ».
 */
const RECORD_COLUMNS = [
  "w-[17%] @min-[70rem]/sales-records:w-[16%]", "w-[17%] @min-[70rem]/sales-records:w-[19%]", "w-[13%]", "w-[6%] @min-[70rem]/sales-records:w-[5.5%]",
  "w-[11%] @min-[70rem]/sales-records:w-[9.5%]", "w-[11%] @min-[70rem]/sales-records:w-[9.5%]",
  "w-[11%] @min-[70rem]/sales-records:w-[9.5%]", "w-[14%] @min-[70rem]/sales-records:w-[18%]",
];
/**
 * Те же столбцы с узким столбцом действия «Убрать» / «Вернуть» (307; только у тех, кто может
 * менять записи, и не в «Архиве»). Столбцы сумм не уже 9,5 %: «120 000 KGS» по-прежнему целиком.
 */
const RECORD_COLUMNS_ACTION = [
  "w-[15%] @min-[70rem]/sales-records:w-[19%]", "w-[14%] @min-[70rem]/sales-records:w-[12.5%]", "w-[11%] @min-[70rem]/sales-records:w-[12%]", "w-[6%] @min-[70rem]/sales-records:w-[5.5%]",
  "w-[11%] @min-[70rem]/sales-records:w-[9.5%]", "w-[11%] @min-[70rem]/sales-records:w-[9.5%]",
  "w-[11%] @min-[70rem]/sales-records:w-[9.5%]", "w-[11%] @min-[70rem]/sales-records:w-[14%]", "w-[10%] @min-[70rem]/sales-records:w-[8.5%]",
];
const RECORD_COLUMNS_WITH_REPORT_MONTH_ACTION = [
  "w-[14%]", "w-[11%] @min-[70rem]/sales-records:w-[14%]", "w-[10%] @min-[70rem]/sales-records:w-[13%]", "w-[6%] @min-[70rem]/sales-records:w-[5.5%]",
  "w-[8%] @min-[70rem]/sales-records:w-[7%]",
  "w-[11%] @min-[70rem]/sales-records:w-[9.5%]", "w-[11%] @min-[70rem]/sales-records:w-[9.5%]",
  "w-[11%] @min-[70rem]/sales-records:w-[9.5%]", "w-[10%] @min-[70rem]/sales-records:w-[9.5%]", "w-[8%] @min-[70rem]/sales-records:w-[8.5%]",
];
const RECORD_COLUMNS_WITH_REPORT_MONTH = [
  "w-[17%] @min-[70rem]/sales-records:w-[15%]", "w-[13%] @min-[70rem]/sales-records:w-[16%]", "w-[11%] @min-[70rem]/sales-records:w-[13%]", "w-[6%] @min-[70rem]/sales-records:w-[5.5%]",
  "w-[8%] @min-[70rem]/sales-records:w-[7%]",
  "w-[11%] @min-[70rem]/sales-records:w-[9.5%]", "w-[11%] @min-[70rem]/sales-records:w-[9.5%]",
  "w-[11%] @min-[70rem]/sales-records:w-[9.5%]", "w-[12%] @min-[70rem]/sales-records:w-[15%]",
];
/**
 * Э8.6: при открытой записи список рядом с панелью остаётся таблицей с
 * короткими столбцами «Студент · Дата · Стоимость · Оплачено · Остаток ·
 * Уточнить» (страна, программа и менеджер — в панели). Колонка списка рядом с
 * панелью — около 33rem при 1280 и 43rem от 1440; таблица — от 32rem, уже —
 * строки стопкой. Сумма «120 000 KGS» с полями — около 99 px: от 32rem (512 px)
 * это 19,5% колонки, от 42rem (672 px) — 15%, и суммы не режутся ни при какой
 * ширине таблицы. Уже 42rem столбцу «Уточнить» места нет: у помеченной
 * строки под именем — строка «Уточнить: …» (12 px, нейтральная), причина
 * целиком — подсказкой и в панели записи.
 */
const COMPACT_COLUMNS = ["w-[30.5%] @min-[42rem]/sales-records:w-[25%]", "w-[11%] @min-[42rem]/sales-records:w-[8.5%]",
  "w-[19.5%] @min-[42rem]/sales-records:w-[15%]", "w-[19.5%] @min-[42rem]/sales-records:w-[15%]",
  "w-[19.5%] @min-[42rem]/sales-records:w-[15%]", "w-[0%] @min-[42rem]/sales-records:w-[21.5%]"];
/**
 * «Весь год» и срез «в другой месяц отчёта» рядом с открытой записью: месяц
 * отчёта — второй строкой под датой («09.2026», 12 px, JetBrains Mono), а не
 * своим столбцом: столбцу на 33rem места нет без того, чтобы резать суммы или
 * имя. Столбцы те же, что у месяца; «Дата» чуть шире — под «09.2026».
 */
const COMPACT_COLUMNS_WITH_REPORT_MONTH = ["w-[29%] @min-[42rem]/sales-records:w-[25%]", "w-[12.5%] @min-[42rem]/sales-records:w-[10%]",
  "w-[19.5%] @min-[42rem]/sales-records:w-[15%]", "w-[19.5%] @min-[42rem]/sales-records:w-[15%]",
  "w-[19.5%] @min-[42rem]/sales-records:w-[15%]", "w-[0%] @min-[42rem]/sales-records:w-[20%]"];
/**
 * Классы строки для двух наборов столбцов: полный — таблица от 60rem
 * контейнера, короткий (запись открыта) — от 32rem. Классы целиком: их
 * находит сборщик Tailwind.
 */
const ROW_LAYOUT = {
  full: {
    table: "block w-full text-left @min-[60rem]/sales-records:table @min-[60rem]/sales-records:table-fixed",
    colgroup: "hidden @min-[60rem]/sales-records:table-column-group",
    thead: "sr-only @min-[60rem]/sales-records:not-sr-only @min-[60rem]/sales-records:table-header-group",
    tbody: "block divide-y divide-border border-y border-border @min-[60rem]/sales-records:table-row-group",
    row: "@min-[60rem]/sales-records:table-row @min-[60rem]/sales-records:p-0",
    name: "@min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:ps-4 @min-[60rem]/sales-records:pe-3 @min-[60rem]/sales-records:align-middle",
    cell: "hidden min-w-0 px-3 align-middle @min-[60rem]/sales-records:table-cell",
    date: "@min-[60rem]/sales-records:px-2",
    money: "hidden min-w-0 px-2 text-right align-middle @min-[60rem]/sales-records:table-cell",
    rest: "@min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:px-2 @min-[60rem]/sales-records:align-middle",
    restWord: "@min-[60rem]/sales-records:sr-only",
    narrow: "@min-[60rem]/sales-records:hidden",
    review: "hidden min-w-0 px-3 align-middle @min-[60rem]/sales-records:table-cell",
    reviewHead: "",
    reviewMark: "",
    // Отказ (307): ребро — левая граница первой ячейки на таблице и самой строки в стопке; слово — чип под именем.
    edgeRow: "shadow-[inset_3px_0_0_0_var(--sale-edge)] @min-[60rem]/sales-records:shadow-none",
    edgeName: "@min-[60rem]/sales-records:shadow-[inset_3px_0_0_0_var(--sale-edge)]",
    // «Убрать» / «Вернуть»: в стопке — третья клетка первой строки (имя | остаток | действие), в таблице — свой столбец (одна ячейка на оба вида).
    action: "min-w-0 self-center @min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:pe-2 @min-[60rem]/sales-records:text-right @min-[60rem]/sales-records:align-middle",
  },
  compact: {
    table: "block w-full text-left @min-[32rem]/sales-records:table @min-[32rem]/sales-records:table-fixed",
    colgroup: "hidden @min-[32rem]/sales-records:table-column-group",
    thead: "sr-only @min-[32rem]/sales-records:not-sr-only @min-[32rem]/sales-records:table-header-group",
    tbody: "block divide-y divide-border border-y border-border @min-[32rem]/sales-records:table-row-group",
    row: "@min-[32rem]/sales-records:table-row @min-[32rem]/sales-records:p-0",
    name: "@min-[32rem]/sales-records:table-cell @min-[32rem]/sales-records:ps-3 @min-[32rem]/sales-records:pe-2 @min-[32rem]/sales-records:align-middle",
    cell: "hidden min-w-0 px-1.5 align-middle @min-[32rem]/sales-records:table-cell",
    date: "",
    money: "hidden min-w-0 px-1.5 text-right align-middle @min-[32rem]/sales-records:table-cell",
    rest: "@min-[32rem]/sales-records:table-cell @min-[32rem]/sales-records:px-1.5 @min-[32rem]/sales-records:align-middle",
    restWord: "@min-[32rem]/sales-records:sr-only",
    narrow: "@min-[32rem]/sales-records:hidden",
    review: "hidden min-w-0 ps-3 align-middle @min-[42rem]/sales-records:table-cell",
    reviewHead: "hidden @min-[42rem]/sales-records:table-cell",
    // Таблица без столбца «Уточнить» (32–42rem): помеченная строка говорит о себе под именем.
    reviewMark: "hidden @min-[32rem]/sales-records:block @min-[42rem]/sales-records:hidden",
    edgeRow: "shadow-[inset_3px_0_0_0_var(--sale-edge)] @min-[32rem]/sales-records:shadow-none",
    edgeName: "@min-[32rem]/sales-records:shadow-[inset_3px_0_0_0_var(--sale-edge)]",
    // Рядом с открытой записью (таблица от 32rem) то же действие стоит в её панели; в стопке (телефон) оно есть и в строке.
    action: "self-center @min-[32rem]/sales-records:hidden",
  },
} as const;
type RowLayout = keyof typeof ROW_LAYOUT;
/** Цвет ребра отказной строки — токен тона, ребро рисует `edgeRow` / `edgeName` (только у отказа). */
const EDGE_TONE = { warn: "[--sale-edge:var(--warn)]", danger: "[--sale-edge:var(--danger)]" } as const;
/** Что показывает таблица при срезе из заголовка «Продажи» (Э2). */
export const SALE_SLICE_TITLE: Record<SalesSaleSlice, string> = {
  undated: "Записи без даты продажи: в продажи не входят",
  other_sale_date: "Записи с датой продажи в другом месяце: в продажи этого периода не входят",
  filed_elsewhere: "Продажи периода, записанные в другой месяц отчёта",
};
const PANEL_HEADING = "sale-panel-title";

/**
 * «Отчёт продаж» роли, которая читает лиды, но не записи отчёта (Admissions
 * по миграции 173: `lead.read` без `sales.register.read`). До «Сегодня» она
 * видела «Лиды за период», «Динамику» и воронку на Главной; теперь они —
 * раздел «Динамика по дням» (`dynamics`), и страница — только он. Чтений
 * записей нет: их сервер этой роли не отдаёт.
 */
export function SalesDynamicsReport({ dynamics }: { dynamics: ReactNode }) {
  return <main className="mx-auto min-w-0 w-full max-w-[1240px] px-4 py-8 sm:px-6 min-[1600px]:max-w-[1480px]">
    <header className="min-w-0">
      <h1 className="t-page-title text-fg">Отчёт продаж</h1>
      <p className="t-meta mt-1 text-fg-3">Записи продаж вашей роли недоступны: здесь лиды за период и доска продаж.</p>
    </header>
    {dynamics}
  </main>;
}

/**
 * Суммы выборки по валютам — выровненная таблица: подписи столбцов один раз,
 * числа по правому краю. Остаток — только внутри одной валюты; оплата в
 * другой валюте — отдельной строкой пары валют без остатка. Подпись над
 * таблицей называет основу сумм (записи месяца отчёта, а в срезе «записаны в
 * другой месяц отчёта» — продажи периода с другим месяцем отчёта), чтобы она
 * не спорила с «N продаж» заголовка (по дате продажи); сноска — одна строка.
 * Нет всех строк выборки — суммы сервера по записям, и неуточнённые значения,
 * которых в них нет, названы числом. Пустая оплата — неизвестна, не ноль:
 * такие записи в суммы и остаток не входят и названы в сноске. В «Архиве»
 * сумм нет (как на сервере, 247) — вместо них `ArchiveBasis`.
 */
function MoneySummary({ workspace, summary, basis, reason, filtered, yearOnly, filedElsewhere }: Readonly<{
  workspace: SalesRegisterWorkspace; summary: SalesMoneySummary | null;
  basis: Readonly<{ total: number; undated: number; otherSaleDate: number }> | null;
  reason: "too_many" | "unavailable" | null; filtered: boolean; yearOnly: boolean;
  /** Срез `sale=filed_elsewhere`: продажи периода, записанные в другой месяц отчёта. */
  filedElsewhere: boolean;
}>) {
  if (workspace.totalCount === 0) return null;
  // Отказные записи (307) стоят в таблице, но не в суммах: их число и оплаченное по ним названы отдельной строкой.
  const refused = workspace.withdrawn;
  const total = basis?.total ?? workspace.totalCount - refused.count;
  const refusalLine = refused.count > 0 ? (
    <p className="mt-1.5 t-meta text-fg-2" data-testid="sales-withdrawn-summary" data-withdrawn-count={refused.count}>
      Отказ — {refused.count.toLocaleString("ru-RU")} {recordsWord(refused.count)}
      {refused.paid.length > 0 ? `; по ним оплачено ${refused.paid.map((line) => money(line.paidMinor, line.currency)).join(" и ")}` : ""}.
      {" "}В продажи и суммы ниже они не входят.
    </p>
  ) : null;
  if (total === 0 && refusalLine) {
    return (
      <section aria-labelledby="sales-money-title" className="border-y border-border py-3" data-testid="sales-money-summary">
        <h2 id="sales-money-title" className="sr-only">Суммы по записям</h2>
        {refusalLine}
      </section>
    );
  }
  const { caption, footnote, lines } = salesMoneyParts({ workspace, summary, basis, reason, filtered, yearOnly, filedElsewhere, total });
  const head = "pb-1 ps-4 text-right font-medium sm:ps-10";
  const value = "py-1 ps-4 text-right align-baseline t-body-compact tabular-nums sm:ps-10";
  const label = "py-1 pe-3 text-left align-baseline";
  return (
    <section aria-labelledby="sales-money-title" className="border-y border-border py-3" data-testid="sales-money-summary">
      <h2 id="sales-money-title" className="sr-only">Суммы по записям</h2>
      <p className="t-meta text-fg-2" data-money-basis={total}>{caption}</p>
      {refusalLine}
      {lines.length > 0 || (summary?.cross.length ?? 0) > 0 ? (
        <table className="mt-1.5 w-full sm:w-auto" data-testid="sales-money-table">
          <caption className="sr-only">Стоимость, оплачено и остаток по валютам</caption>
          <thead>
            <tr className="t-caption text-fg-2">
              <th scope="col" className="pb-1 pe-3 text-left font-medium"><span className="sr-only">Валюта</span></th>
              <th scope="col" className={head}>Стоимость</th>
              <th scope="col" className={head}>{summary ? "Оплачено" : "Оплачено по записям"}</th>
              {summary ? <th scope="col" className={head}>Остаток</th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.currency} data-money-line={line.currency}>
                <th scope="row" className={`${label} t-item text-fg`}>{line.currency}</th>
                <td className={`${value} text-fg`}>{number.format(line.cost / 100)}</td>
                <td className={`${value} text-fg`}>{number.format(line.paid / 100)}</td>
                {summary ? <td className={`${value} font-medium text-fg`}>{line.rest === null ? "—" : number.format(line.rest / 100)}</td> : null}
              </tr>
            ))}
            {summary?.cross.map((pair) => (
              <tr key={`${pair.costCurrency}>${pair.paidCurrency}`} data-money-cross={`${pair.costCurrency}>${pair.paidCurrency}`}>
                <th scope="row" title={`Стоимость в ${pair.costCurrency}, оплата в ${pair.paidCurrency} без суммы в валюте договора — ${pair.count} ${recordsWord(pair.count)}`}
                  className={`${label} whitespace-nowrap t-body-compact font-normal text-fg-2`}>
                  {pair.costCurrency} → {pair.paidCurrency}
                  <span className="sr-only">: стоимость в {pair.costCurrency}, оплата в {pair.paidCurrency}, {pair.count} {recordsWord(pair.count)}</span>
                </th>
                <td className={`${value} text-fg`}>{money(pair.costMinor, pair.costCurrency)}</td>
                <td className={`${value} text-fg`}>{money(pair.paidMinor, pair.paidCurrency)}</td>
                <td className={`${value} text-fg-3`}>—<span className="sr-only">остаток не считается</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="mt-1.5 t-meta text-fg-3">{footnote}</p>
    </section>
  );
}

/**
 * «Архив»: сколько записей в архиве по выборке — без сумм и остатка. Сервер
 * архиву итогов не отдаёт (247: `IF p_archived THEN totals:='[]'`), запись
 * в архиве не входит в рабочие итоги; до Э4 здесь было «Записей в архиве N».
 */
function ArchiveBasis({ count, yearOnly, filtered }: Readonly<{ count: number; yearOnly: boolean; filtered: boolean }>) {
  if (count === 0) return null;
  const text = `В архиве — ${count.toLocaleString("ru-RU")} ${recordsWord(count)} ${yearOnly ? "года" : "месяца"} отчёта${filtered ? ", с фильтрами" : ""}. `
    + "Архивные записи не входят в рабочие итоги: суммы и остаток по ним не считаются.";
  return <p className="border-y border-border py-3 t-meta text-fg-2" data-testid="sales-archive-basis" data-archive-count={count}>{text}</p>;
}

/**
 * Строка записи: одна линия на широком контейнере, две–три строки на узком.
 * `layout` — полный набор столбцов или короткий рядом с открытой записью (Э8.6).
 */
function SaleRow({ row, year, href, selected, showReportMonth, showRemainder, manager, layout, action, actionColumn }: Readonly<{
  row: SalesRegisterRow; year: number; href: string; selected: boolean; showReportMonth: boolean;
  /** «Убрать» / «Вернуть» этой записи (307); null — действия нет (роль без права, «Архив», запись в архиве). */
  action: ReactNode | null;
  /** В таблице есть столбец действия: у каждой строки он занят или пуст. */
  actionColumn: boolean;
  /** В «Архиве» столбца «Остаток» нет: архивные записи в рабочие итоги не входят. */
  showRemainder: boolean;
  /** Имя менеджера по ключу (таблица владельца или написание), 253. */
  manager: string;
  layout: RowLayout;
}>) {
  const at = ROW_LAYOUT[layout];
  const compact = layout === "compact";
  const review = salesRowReview(row);
  const cost = money(row.serviceCostMinor, row.serviceCostCurrency);
  const paid = money(row.paidMinor, row.paidCurrency);
  const contractMinor = salesRowContractPaid(row);
  const contract = contractMinor === null ? null : money(contractMinor, row.serviceCostCurrency);
  const remainderMinor = salesRowRemainder(row);
  const remainder = remainderMinor === null ? null : money(remainderMinor, row.serviceCostCurrency);
  const noRemainder = salesRowNoRemainder(row);
  const remainderWhy = noRemainder === null ? null : SALES_NO_REMAINDER_TEXT[noRemainder];
  const place = [row.country, row.program].map((part) => tidy(part)).filter(Boolean).join(" · ");
  const reportMonth = showReportMonth ? reportMonthOf(row.reportMonth) : null;
  const saleDay = row.signingDate ? salesDayParts(row.signingDate, year) : null;
  // Не указанный статус оплаты как единственная причина — тихое слово, не «Уточнить» (24.10.2026).
  const reviewText = review.state === "review" ? review.reasons.join(", ") : review.state === "checked" ? "Сверено"
    : review.state === "status_missing" ? SALES_STATUS_MISSING_TEXT : "В архиве";
  const reviewTone = review.state === "review" ? "text-fg-2" : "text-fg-3";
  const reviewMark = compact && review.state === "review";
  const name = row.applicantName || "Имя не указано";
  // Отказ (307): слово чипом под именем и ребро цвета тона; заливки строки нет.
  const refusal = row.withdrawal;
  const refusalWord = refusal ? salesWithdrawalWord(refusal.kind) : null;
  const refusalTone = refusal ? salesWithdrawalTone(refusal.kind) : null;
  const edge = refusalWord && refusalTone ? EDGE_TONE[refusalTone] : "";
  const mono = "font-mono tabular-nums";
  // Оплата в другой валюте с суммой в валюте договора: остаток — от неё, и это сказано подсказкой.
  const remainderTitle = remainderWhy ?? (remainder && contract ? `${remainder}: стоимость ${cost} − оплачено в валюте договора ${contract}` : remainder);
  return (
    <tr role="row" id={`sale-${row.id}`} data-selected={selected ? "" : undefined}
      data-withdrawn={refusal ? refusal.kind : undefined}
      className={`relative grid scroll-mt-24 ${action ? "grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto]"} gap-x-3 px-4 py-1.5 ${at.row} ${refusalWord ? `${edge} ${at.edgeRow}` : ""} ${selected ? "bg-surface-2" : "bg-surface hover:bg-surface-2"}`}>
      <th role="rowheader" scope="row" className={`min-w-0 font-normal ${at.name} ${refusalWord ? at.edgeName : ""}`}>
        <Link href={href} scroll={false} aria-current={selected ? "true" : undefined} title={name}
          className={`flex min-h-11 min-w-0 ${reviewMark || refusalWord ? "flex-col justify-center" : "items-center"} t-item text-fg underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline`}>
          <span className="max-w-full truncate">{name}</span>
          {refusalWord && refusalTone ? <span className="mt-0.5 flex max-w-full" data-row-withdrawal={refusalTone}>
            <StatusChip label={refusalWord} tone={refusalTone} size="sm" wrap />
          </span> : null}
          {/* Рядом с записью уже 42rem столбца «Уточнить» нет: помеченная строка — строкой под именем. */}
          {reviewMark ? <span className={`truncate t-meta text-fg-2 ${at.reviewMark}`} title={`Уточнить: ${reviewText}`} data-row-review-mark="">
            Уточнить: {reviewText}
          </span> : null}
        </Link>
      </th>
      {compact ? null : <>
        <td role="cell" className={at.cell}><span className="block truncate t-body-compact text-fg-2" title={place || undefined}>{place || "—"}</span></td>
        <td role="cell" className={at.cell}><span className="block truncate t-body-compact text-fg-2" title={manager || undefined}>{manager || "—"}</span></td>
      </>}
      <td role="cell" className={`${at.cell} ${at.date}`}>
        {/* Ячейке хватает «ДД.ММ»: год другой продажи — второй строкой под датой (12 px), не «28.12.25» поверх «Стоимости». */}
        {saleDay ? <time dateTime={row.signingDate ?? undefined} className={`t-body-compact text-fg-2 ${mono}`}>{saleDay.day}{saleDay.year
          ? <span className="block t-meta" data-sale-year={saleDay.year}><span className="sr-only">.</span>{saleDay.year}</span> : null}</time>
          : <span className="t-body-compact text-fg-3">—</span>}
        {/* Рядом с записью месяц отчёта — второй строкой под датой: своему столбцу там места нет. */}
        {compact && reportMonth ? <time dateTime={reportMonth.dateTime} data-report-month={reportMonth.dateTime}
          className={`block t-meta text-fg-2 ${mono}`} title={`Месяц отчёта: ${reportMonth.words}`}>
          <span className="sr-only">месяц отчёта </span>{reportMonth.compact}
        </time> : null}
      </td>
      {/* Месяц отчёта — своим столбцом («Весь год», срез «в другой месяц отчёта»), плотно: «09.2026». */}
      {reportMonth && !compact ? <td role="cell" className={`${at.cell} ${at.date}`} data-report-month={reportMonth.dateTime}>
        <time dateTime={reportMonth.dateTime} className={`block truncate t-body-compact text-fg-2 ${mono}`} title={`Месяц отчёта: ${reportMonth.words}`}>{reportMonth.compact}</time>
      </td> : null}
      {/* Суммы — узкие поля и подсказка с суммой: число не прячется за многоточием молча. */}
      <td role="cell" className={at.money}><span className="block truncate t-body-compact tabular-nums text-fg" title={cost ?? undefined}>{cost ?? "—"}</span></td>
      <td role="cell" className={at.money}><span className="block truncate t-body-compact tabular-nums text-fg-2"
        title={paid && contract ? `${paid}; в валюте договора ${contract}` : paid ?? undefined}>{paid ?? "—"}</span></td>
      {/* Нет остатка — «—» и причина (подсказкой и для чтения с экрана): неизвестная оплата — не ноль. */}
      {showRemainder ? <td role="cell" className={`self-center text-right ${at.rest}`}>
        <span className="block truncate t-body-compact tabular-nums text-fg" title={remainderTitle ?? undefined} data-no-remainder={noRemainder ?? undefined}>
          <span className={`t-meta text-fg-2 ${at.restWord}`}>остаток </span>{remainder ?? "—"}
          {remainderWhy ? <span className="sr-only"> ({remainderWhy})</span> : null}
        </span>
      </td> : null}
      <td role="cell" className={`${at.review} pe-4`}><span className={`block truncate ${review.state === "status_missing" ? "t-meta" : "t-body-compact"} ${reviewTone}`} title={reviewText}>{reviewText}</span></td>
      {/* «Убрать» / «Вернуть»: справа от имени в стопке (телефон) и своим столбцом в полной таблице. */}
      {action || actionColumn ? <td role="cell" className={at.action}>{action}</td> : null}
      {/* Узкий контейнер: сведения строки под именем (широкий их не показывает); дата — JetBrains Mono,
          «Уточнить» — своей строкой целиком: причина не прячется за многоточием. */}
      <td role="cell" className={`col-span-full min-w-0 pb-1 ${at.narrow}`}>
        <p className="truncate t-meta text-fg-2">
          {row.signingDate ? <time dateTime={row.signingDate} className="font-mono tabular-nums">{rowDate(row.signingDate, year)}</time> : "без даты"}
          {[manager, place].filter(Boolean).map((part) => ` · ${part}`).join("")}
        </p>
        {reportMonth ? <p className="truncate t-meta text-fg-2" data-report-month={reportMonth.dateTime}>Месяц отчёта: {reportMonth.words}</p> : null}
        {cost || paid ? <p className="truncate t-meta tabular-nums text-fg-2">
          {[cost ? `стоимость ${cost}` : null, paid ? `оплачено ${paid}${contract ? ` (${contract} в валюте договора)` : ""}` : row.paidRaw.trim() ? null : SALES_NO_REMAINDER_TEXT.paid_missing]
            .filter(Boolean).join(" · ")}
        </p> : null}
        <p className={`break-words t-meta ${reviewTone}`} data-row-review="">
          {review.state === "review" ? `Уточнить: ${reviewText}` : reviewText}
        </p>
      </td>
    </tr>
  );
}

/**
 * «Отчёт продаж» (Э4, 27.09.2026) — месячный взгляд без коробок: переключатель
 * месяца «‹ Сентябрь 2026 ›», заголовок «N продаж из плана M», суммы по
 * валютам с остатком только внутри одной валюты, одна строка инструментов
 * (применяется сразу) и строки в одну линию; клик по строке открывает правую
 * панель с прежней формой записи, список остаётся. «Добавить продажу» —
 * единственный сплошной красный. Убранная продажа (307) остаётся строкой с чипом «Отказ …» и
 * ребром цвета тона, в «Продажи» и суммы не входит; «Убрать» / «Вернуть» стоит в строке и в
 * панели открытой записи. `dynamics` — раздел «Динамика по дням»
 * (графики и воронка, Э3) для ролей, читающих продажи; стоит под записями и
 * не показывается рядом с формой новой продажи.
 */
export async function SalesRegisterView({ actor, query, dynamics = null }: { actor: ActivePlatformActor; query: SalesReportQuery; dynamics?: ReactNode }) {
  const {
    year, month, offset, searchQuery, saleSlice, saleSliceHref, valid, reportMonth, params, href, clearFiltersHref, importHref, writeAccess, canManage, creating, editingRecord, creatingForm, workspace, intakeOptions, cash, headlinePeriod, salesCount, reviewCount, initialLead, archiveView, summaryRead, summary, summaryBasis, canImport, managementUnavailable, showTargetForm, directions, directionControl, rowFilters, hasFilters, showReportMonth, saved, savedCaseId, canOpenSavedCase, target, backHref, panelOpen, editing, linkedRecord, leadLink, showLeadRow, recordHref,
  } = await readSalesRegisterPage(actor, query);
  // Рядом с открытой записью — короткий набор столбцов (Э8.6), иначе полный.
  const layout: RowLayout = panelOpen ? "compact" : "full";
  // В «Архиве» нет столбца «Остаток» (предпоследний): его место делят остальные.
  // «Убрать» / «Вернуть» (307): у тех, кто может менять записи, не в «Архиве». Рядом с открытой записью то же действие стоит в её панели.
  const showAction = canManage && !archiveView && !creatingForm;
  const actionColumn = showAction && !panelOpen;
  const recordColumns = (panelOpen
    ? showReportMonth ? COMPACT_COLUMNS_WITH_REPORT_MONTH : COMPACT_COLUMNS
    : showReportMonth
      ? actionColumn ? RECORD_COLUMNS_WITH_REPORT_MONTH_ACTION : RECORD_COLUMNS_WITH_REPORT_MONTH
      : actionColumn ? RECORD_COLUMNS_ACTION : RECORD_COLUMNS)
    .filter((_, index, all) => !archiveView || index !== all.length - 2);
  // Шапка общей боковой панели (Э7): имя, строка контекста и «Открыть …» — прежние тексты записи.
  const panelHeader = panelOpen && workspace ? salesRecordPanelHeader(workspace.selected ?? null, editing) : null;

  // Адреса строки инструментов: те же параметры, без страницы — выбор сразу применяется.
  const filterHref = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params);
    next.delete("offset");
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return `/v3/main?${next.toString()}`;
  };
  const periodHref = (nextYear: number, nextMonth: number | undefined) => filterHref({ year: String(nextYear), month: nextMonth ? String(nextMonth) : "all" });
  const rowHref = (row: SalesRegisterRow) => href({ record: row.id });
  const managersHref = canImport ? salesManagersHref(query) : null;
  // «Перенос данных» живёт в Настройки → Платформа. Держателю права `sales.register.import` без доступа к настройкам
  // (право выдаётся и обычной роли) остаётся тихая ссылка здесь — иначе у него не было бы входа.
  const importLinkHere = canImport && !staffCanAccessRoute(actor, "/v3/settings");
  const managerName = (row: SalesRegisterRow) => workspace?.managerOptions.find((option) => option.key === row.managerKey)?.name ?? tidy(row.managerLabel);
  const directionGroups = groupSalesLabels(directions ?? []);
  const selectedManager = query.manager || null;
  const selectedManagerName = workspace && workspace.managerKey !== null
    ? workspace.managerOptions.find((option) => option.key === workspace!.managerKey)?.name ?? tidy(selectedManager ?? "") : selectedManager ? tidy(selectedManager) : null;
  const selectedDirection = directionControl.value || null;
  const directionGroup = salesLabelGroupOf(directionGroups, selectedDirection);
  const variantNote = directionGroup && directionGroup.variants.length > 1;
  const activeCount = [query.manager, query.direction, query.review, query.archived === "true" ? "1" : "", saleSlice].filter(Boolean).length;
  const steps = salesPeriodSteps(year, month);
  const hidden = Object.fromEntries([...params.entries()].filter(([key]) => key !== "q" && key !== "offset"));

  const toolbar = workspace ? (
    <SalesReportToolbar workspace={workspace} query={query} params={params} searchQuery={searchQuery} hidden={hidden} activeCount={activeCount}
      selectedManager={selectedManager} selectedManagerName={selectedManagerName} directionControl={directionControl} directionGroups={directionGroups}
      selectedDirection={selectedDirection} filterHref={filterHref} managersHref={managersHref} reviewCount={reviewCount} hasFilters={hasFilters}
      clearFiltersHref={clearFiltersHref} />
  ) : null;

  return <main className="mx-auto min-w-0 w-full max-w-[1240px] px-4 py-8 sm:px-6 min-[1600px]:max-w-[1480px]">
    {!creatingForm ? <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="t-page-title text-fg">Отчёт продаж</h1>
        {valid ? <SalesPeriodStepper year={year} month={month} steps={steps} periodHref={periodHref} /> : null}
      </div>
      {workspace && canManage ? <Link href={href({ new: "true" })} className={`${btnCls} min-h-11`}>Добавить продажу</Link> : null}
    </div> : null}

    {writeAccess === "unavailable" ? <p role="alert" className="mt-4 t-body-compact text-fg-2">Не удалось проверить права на запись продажи. Обновите страницу перед добавлением или изменением.</p> : null}
    {(creating || editingRecord) && writeAccess === "denied" ? <p role="status" className="mt-4 t-body-compact text-fg-2">Добавление и исправление продаж доступны Sales Manager.</p> : null}
    {creatingForm ? <div className="max-w-[860px]">
      <SalesRegisterForm key="new" record={null} recordId={null} reportMonth={reportMonth} ownerOptions={workspace?.ownerOptions ?? []}
        canChooseOwner={canManage} requestId={randomUUID()} archiveRequestId={randomUUID()} backHref={backHref} readUnavailable={!workspace}
        ownMembershipId={actor.membershipId} ownLabel={actor.displayName} intakeOptions={intakeOptions} initialLead={initialLead} />
    </div> : <>
      {salesCount && headlinePeriod ? <div className="mt-3">
        <SalesPeriodHeadline read={salesCount} label={headlinePeriod.label} retryHref={href()}
          filtered={hasFilters} sliceHref={saleSliceHref} target={month && query.archived !== "true" ? target?.targetCount ?? null : null} />
      </div> : null}
      {saved ? <section id="saved-sale" aria-labelledby="saved-sale-title" className="mt-4 scroll-mt-4 border-y border-border py-3">
        <h2 id="saved-sale-title" className="t-item text-fg">Продажа добавлена</h2>
        {savedCaseId ? <p className="mt-0.5 t-body-compact text-fg-2">Дело студента создано и передано куратору.</p> : null}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 t-body-compact text-fg"><span className="break-words font-medium">{saved.applicantName}</span>
            <span className="text-fg-2"> · {dateLabel(saved.signingDate)} · {money(saved.serviceCostMinor, saved.serviceCostCurrency) ?? "Не уточнено"}</span></p>
          {canOpenSavedCase && savedCaseId ? <Link href={`/v3/profile?case=${encodeURIComponent(savedCaseId)}`} className={`${btnGhostCls} min-h-11`}>Открыть дело</Link>
            : saved.leadId ? <Link href={`/v3/profile?id=${encodeURIComponent(saved.leadId)}`} className={`${btnGhostCls} min-h-11`}>Открыть дело</Link> : null}
        </div>
      </section> : null}
      {!workspace ? <div role="alert" className="mt-8 space-y-3 border-s-2 border-border ps-4 t-body-compact text-fg-2">
        <p>{searchQuery === null ? "Введите поисковый запрос до 200 символов без переносов строк." : valid ? "Не удалось загрузить отчёт. Проверьте подключение и повторите загрузку." : "Проверьте год, месяц и номер страницы."}</p>
        <Link href="/v3/main?view=sales" className={`${btnGhostCls} min-h-11`}>Открыть текущий месяц</Link>
      </div> : <div className={sidePanelSplit(panelOpen, "mt-4")}>
        {/* Э8.6: суммы, строка инструментов и записи — одной колонкой рядом с панелью: открытая
            запись начинается вровень со сводкой и держится рядом при прокрутке. */}
        <div className="min-w-0">
          {archiveView ? <ArchiveBasis count={workspace.totalCount} yearOnly={month === undefined}
            filtered={Boolean(searchQuery || query.manager || query.direction || query.review)} />
            : <MoneySummary workspace={workspace} summary={summary} basis={summaryBasis} yearOnly={month === undefined}
              reason={summaryRead && summaryRead.rows === null ? summaryRead.reason : null}
              filedElsewhere={saleSlice === "filed_elsewhere"} filtered={saleSlice === "filed_elsewhere" ? rowFilters : hasFilters} />}
          {toolbar}
          {variantNote ? <p className="mt-2 t-meta text-fg-2" data-testid="sales-variant-note">
            Фильтр направления точный: показаны записи с выбранным написанием. Другие написания — в том же меню; сведение к списку направлений — отдельный шаг.
          </p> : null}
          {saleSlice && headlinePeriod ? <p role="status" className="mt-2 flex flex-wrap items-center gap-x-3 t-body-compact text-fg-2" data-sale-slice={saleSlice}>
            <span>{SALE_SLICE_TITLE[saleSlice]} — {headlinePeriod.label}.</span>
            <Link href={clearFiltersHref} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-fg">Все записи периода</Link>
          </p> : null}
          <div className="mt-3">
          {workspace.rows.length === 0 ? <div className="space-y-2 border-t border-border py-12 text-center">
            <p className="text-base font-medium text-fg">{offset > 0 ? "На этой странице записей нет." : hasFilters ? "По выбранным фильтрам записей не найдено." : "В выбранном периоде записей нет."}</p>
            <p className="t-body-compact text-fg-2">{offset > 0 ? "Вернитесь к началу списка с теми же фильтрами." : hasFilters ? "Измените или сбросьте фильтры. Выбранный период сохранится." : "Выберите другой месяц или весь год в переключателе выше."}</p>
            {offset > 0 ? <Link href={href({ offset: "0" })} className={`${btnGhostCls} min-h-11`}>К началу списка</Link>
              : hasFilters ? <Link href={clearFiltersHref} className={`${btnGhostCls} min-h-11`}>Сбросить фильтры</Link> : null}
          </div> : <div className="@container/sales-records">
            <div role="region" aria-label="Записи продаж" tabIndex={0} className="relative max-w-full overflow-x-auto border-t border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <table role="table" className={ROW_LAYOUT[layout].table} data-layout={layout}>
                <caption className="sr-only">{`Продажи: ${workspace.totalCount} ${recordsWord(workspace.totalCount)}`}</caption>
                {/* Ширины по содержимому (`RECORD_COLUMNS`, рядом с записью — `COMPACT_COLUMNS`): суммы целиком, сужается текст. */}
                <colgroup className={ROW_LAYOUT[layout].colgroup}>
                  {recordColumns.map((width, index) => <col key={index} className={width} />)}
                </colgroup>
                <thead role="rowgroup" className={ROW_LAYOUT[layout].thead}>
                  <tr role="row" className="t-caption text-fg-2">
                    <th role="columnheader" scope="col" className={`py-2 font-medium ${panelOpen ? "ps-3 pe-2" : "ps-4 pe-3"}`}>Студент</th>
                    {panelOpen ? null : <>
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Страна · программа</th>
                      <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Менеджер</th>
                    </>}
                    {/* Рядом с записью месяц отчёта — второй строкой под датой; так и в заголовке. */}
                    {panelOpen && showReportMonth ? <th role="columnheader" scope="col" className="px-1.5 py-2 font-medium" title="Дата продажи и под ней месяц отчёта">
                      Дата<span className="block">Месяц<span className="sr-only"> отчёта</span></span>
                    </th> : <th role="columnheader" scope="col" className={`${panelOpen ? "px-1.5" : "px-3"} py-2 font-medium`}>Дата</th>}
                    {/* Узкий столбец: подпись переносится в две строки («Месяц / отчёта»), а не режется. */}
                    {showReportMonth && !panelOpen ? <th role="columnheader" scope="col" className="px-2 py-2 font-medium">Месяц отчёта</th> : null}
                    <th role="columnheader" scope="col" className={`${panelOpen ? "px-1.5" : "px-2"} py-2 text-right font-medium`}>Стоимость</th>
                    <th role="columnheader" scope="col" className={`${panelOpen ? "px-1.5" : "px-2"} py-2 text-right font-medium`}>Оплачено</th>
                    {archiveView ? null : <th role="columnheader" scope="col" className={`${panelOpen ? "px-1.5" : "px-2"} py-2 text-right font-medium`}>Остаток</th>}
                    <th role="columnheader" scope="col" className={`py-2 pe-4 ps-3 font-medium ${ROW_LAYOUT[layout].reviewHead}`}>Уточнить</th>
                    {actionColumn ? <th role="columnheader" scope="col" className="py-2 pe-2 font-medium"><span className="sr-only">Действие</span></th> : null}
                  </tr>
                </thead>
                <tbody role="rowgroup" className={ROW_LAYOUT[layout].tbody}>
                  {workspace.rows.map((row) => <SaleRow key={row.id} row={row} year={year} href={rowHref(row)} layout={layout} manager={managerName(row)}
                    selected={row.id === (panelOpen ? query.record : saved?.id)} showReportMonth={showReportMonth} showRemainder={!archiveView}
                    actionColumn={actionColumn}
                    action={showAction && !row.archived ? <SalesWithdrawalControl record={{ id: row.id, version: row.version }} name={row.applicantName}
                      withdrawn={row.withdrawal !== null} requestId={randomUUID()} /> : null} />)}
                </tbody>
              </table>
            </div>
          </div>}
          </div>
          {offset > 0 || workspace.hasMore ? <nav aria-label="Страницы отчёта" className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {offset > 0 ? <Link href={href({ offset: String(Math.max(0, offset - 50)) })} className={`${btnGhostCls} min-h-11`}>Назад</Link> : <span />}
            <span className="t-meta text-fg-3">{workspace.rows.length ? `${offset + 1}–${offset + workspace.rows.length} из ${workspace.totalCount}` : ""}</span>
            {workspace.hasMore ? <Link href={href({ offset: String(offset + 50) })} className={`${btnGhostCls} min-h-11`}>Далее</Link> : <span />}
          </nav> : null}
        </div>
        {panelOpen && panelHeader ? (
          <SidePanel key={`${query.record}:${editing ? "edit" : "view"}`} closeHref={href()} backLabel="К отчёту" headingId={PANEL_HEADING}
            title={panelHeader.title} context={panelHeader.context} open={panelHeader.open}
            actions={leadLink && leadLink.visible && canManage && linkedRecord ? (
              <SalesRecordLeadMenu record={{ id: linkedRecord.id, version: linkedRecord.version }} leadName={leadLink.name} requestId={randomUUID()} />
            ) : null}
            returnTo={query.record ? attributeReturn("id", `sale-${query.record}`, "a") : undefined}>
            {editing ? (
              <SalesRegisterForm key={query.record} record={workspace.selected ?? null}
                recordId={query.record ?? null} reportMonth={reportMonth} ownerOptions={workspace.ownerOptions}
                canChooseOwner={canManage} requestId={randomUUID()} archiveRequestId={randomUUID()} backHref={recordHref} readUnavailable={false}
                ownMembershipId={actor.membershipId} ownLabel={actor.displayName} panelHeadingId={PANEL_HEADING} />
            ) : (
              <SalesRecordPreview record={workspace.selected ?? null} backHref={backHref} panelHeadingId={PANEL_HEADING}
                managerName={workspace.selected ? managerName(workspace.selected) : null} year={year}
                editHref={canManage && workspace.selected ? href({ record: workspace.selected.id, edit: "true" }) : null}
                withdrawalAction={canManage && workspace.selected && !workspace.selected.archived ? (
                  <SalesWithdrawalControl record={{ id: workspace.selected.id, version: workspace.selected.version }} name={workspace.selected.applicantName}
                    withdrawn={workspace.selected.withdrawal !== null} requestId={randomUUID()} align="start" />
                ) : null}
                leadRow={showLeadRow && linkedRecord ? (
                  <SalesRecordLeadFact link={leadLink} canManage={canManage} record={{ id: linkedRecord.id, version: linkedRecord.version }} requestId={randomUUID()} />
                ) : null} />
            )}
          </SidePanel>
        ) : null}
      </div>}
      {/* «Поступления и возвраты за месяц» — прежние чтение, тексты и состояния; с Э4 — под записями,
          строка на валюту вместо карточки. Как и прежде, только при прочитанном отчёте. */}
      {workspace && cash && cash.status !== "not_allowed" && month ? <section aria-labelledby="sales-cash-totals" className="mt-8 border-t border-border pt-4" data-testid="sales-cash-totals">
        <h2 id="sales-cash-totals" className="t-section text-fg">Поступления и возвраты за месяц</h2>
        <p className="mt-1 t-meta text-fg-2">Подтверждённые финансовые события всей организации по дате операции, время Бишкека. Фильтры строк продаж на этот блок не влияют. Расходы третьих сторон не являются выручкой EVO.</p>
        {cash.status === "unavailable" ? <p role="alert" className="mt-3 t-body-compact text-fg-2">Не удалось загрузить финансовую сводку. Обновите страницу, чтобы повторить.</p> : cash.totals.length === 0 ? <p className="mt-3 t-body-compact text-fg-2">В этом месяце подтверждённых финансовых событий нет.</p> : <ul className="mt-2 divide-y divide-border border-y border-border">{cash.totals.map(total => <li key={total.currency} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-2 py-2 t-body-compact text-fg-2">
          <span className="t-item text-fg">{total.currency}</span>
          <dl className="flex flex-wrap gap-x-5 gap-y-0.5">
            <div className="flex gap-1"><dt>Получено</dt><dd className="tabular-nums text-fg">{financeMoney(total.paymentsMinor, total.currency)}</dd></div>
            <div className="flex gap-1"><dt>Возвращено</dt><dd className="tabular-nums text-fg">{financeMoney(total.refundsMinor, total.currency)}</dd></div>
            <div className="flex gap-1 font-semibold text-fg"><dt>Итого</dt><dd className="tabular-nums">{financeMoney(total.netMinor, total.currency)}</dd></div>
          </dl>
        </li>)}</ul>}
      </section> : null}
      {dynamics}
      {(showTargetForm && month && query.archived !== "true") || importLinkHere || managementUnavailable ? <div className="mt-8 space-y-5 border-t border-border pt-5">
        {managementUnavailable ? <p role="alert" className="t-body-compact text-fg-2">Не удалось проверить доступ к плану и переносу данных.</p> : null}
        {showTargetForm && month && query.archived !== "true" ? <details className="group"><summary className="flex min-h-12 w-fit cursor-pointer list-none items-center gap-2 rounded-nav t-item text-fg [&::-webkit-details-marker]:hidden">Изменить план месяца<Icon name="chevron-down" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" /></summary><SalesTargetForm key={reportMonth} reportMonth={reportMonth} target={target} requestId={randomUUID()} readUnavailable={!workspace || managementUnavailable} /></details> : null}
        {importLinkHere ? <Link href={importHref} className="t-label inline-flex min-h-11 items-center text-fg-2 underline underline-offset-4 hover:text-fg">Перенос данных</Link> : null}
      </div> : null}
    </>}
  </main>;
}
