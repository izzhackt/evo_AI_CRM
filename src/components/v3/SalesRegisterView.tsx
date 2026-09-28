import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { getPlatformSalesLead } from "@/lib/platform-sales";
import { parseSalesUuid, type SalesRegisterWorkspace, type SalesRegisterIntakeOptions, type SalesRegisterRow } from "@/lib/platform-sales-register-contract";
import { readSalesRegisterWorkspace, readSalesRegisterIntakeOptions, readSalesRegisterWriteAccess, readSalesRegisterDirections, readSalesRegisterManagement } from "@/lib/v3/sales-register-source";
import { readMonthlyPaymentSummary } from "@/lib/v3/finance-entry-source";
import { readSalesCount } from "@/lib/v3/sales-numbers-source";
import type { SalesCountRead } from "@/lib/sales-numbers-contract";
import { SalesPeriodHeadline, salesHeadlinePeriod } from "./SalesPeriodHeadline";
import { financeMoney, type MonthlyPaymentSummaryRead } from "@/lib/platform-finance-entry-contract";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { SalesRegisterForm, SalesTargetForm } from "./SalesRegisterForms";
import { SalesRecordPreview, salesRecordPanelHeader } from "./SalesRecordPreview";
import { salesDirectionControl } from "@/lib/sales-register-directions";
import type { SalesRegisterManagementRead } from "@/lib/sales-register-management";
import {
  SALES_PAGE_SIZE, SALES_SUMMARY_MAX_PAGES, groupSalesLabels, recordsDative, recordsWord, salesLabelGroupOf, salesMoneySummary, salesPeriodSteps,
  SALES_NO_REMAINDER_TEXT, salesDay, salesReportMonth, salesRowContractPaid, salesRowNoRemainder, salesRowRemainder, salesRowReview, salesSummaryBasis,
  type SalesLabelGroup, type SalesMoneySummary,
} from "@/lib/sales-register-view";

import { FilterMenu, type FilterOption } from "./queue/FilterMenu";
import { attributeReturn, sidePanelSplit } from "./panel/side-panel";
import { SidePanel } from "./panel/SidePanel";
import { QueueFilterDisclosure } from "./queue/QueueFilterDisclosure";
import { salesManagersHref, salesReportContext, type SalesReportQuery, type SalesSaleSlice } from "@/lib/sales-register-navigation";
export type { SalesReportQuery } from "@/lib/sales-register-navigation";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
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
 * текста, суммы те же.
 */
const RECORD_COLUMNS = [
  "w-[17%] @min-[70rem]/sales-records:w-[16%]", "w-[17%] @min-[70rem]/sales-records:w-[19%]", "w-[13%]", "w-[6%] @min-[70rem]/sales-records:w-[5.5%]",
  "w-[11%] @min-[70rem]/sales-records:w-[9.5%]", "w-[11%] @min-[70rem]/sales-records:w-[9.5%]",
  "w-[11%] @min-[70rem]/sales-records:w-[9.5%]", "w-[14%] @min-[70rem]/sales-records:w-[18%]",
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
  },
} as const;
type RowLayout = keyof typeof ROW_LAYOUT;
/** Что показывает таблица при срезе из заголовка «Продажи» (Э2). */
const SALE_SLICE_TITLE: Record<SalesSaleSlice, string> = {
  undated: "Записи без даты продажи: в продажи не входят",
  other_sale_date: "Записи с датой продажи в другом месяце: в продажи этого периода не входят",
  filed_elsewhere: "Продажи периода, записанные в другой месяц отчёта",
};
/**
 * Переключатель строки инструментов — ссылка вида кнопки фильтра (`FILTER_BUTTON`
 * очереди; модуль клиентский, поэтому класс повторён здесь), выбранный —
 * `aria-current` и общий `.v3-choice`.
 */
const TOGGLE = "v3-choice inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";
const QUIET_LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";
const PANEL_HEADING = "sale-panel-title";

/**
 * «Отчёт продаж» роли, которая читает лиды, но не записи отчёта (Admissions
 * по миграции 173: `lead.read` без `sales.register.read`). До «Сегодня» она
 * видела «Лиды за период», «Динамику» и воронку на Главной; теперь они —
 * раздел «Динамика по дням» (`dynamics`), и страница — только он. Чтений
 * записей нет: их сервер этой роли не отдаёт.
 */
export function SalesDynamicsReport({ dynamics }: { dynamics: ReactNode }) {
  return <main className="mx-auto min-w-0 w-full max-w-[1240px] px-4 py-8 sm:px-6">
    <header className="min-w-0">
      <h1 className="t-page-title text-fg">Отчёт продаж</h1>
      <p className="t-meta mt-1 text-fg-3">Записи продаж вашей роли недоступны: здесь лиды за период и доска продаж.</p>
    </header>
    {dynamics}
  </main>;
}

/** Меню направления: одно имя на написания; у выбранной группы — её остальные написания. */
function labelOptions(groups: readonly SalesLabelGroup[], selected: string | null, href: (value: string | null) => string): FilterOption[] {
  const group = salesLabelGroupOf(groups, selected);
  const options: FilterOption[] = [{ key: "all", label: "Все", href: href(null), selected: !selected }];
  if (selected && !group) options.push({ key: "current", label: `Из фильтра: ${tidy(selected)}`, href: href(selected), selected: true });
  for (const one of groups) {
    options.push({ key: one.key, label: one.label, href: href(one.value), selected: selected === one.value });
    if (group?.key === one.key) {
      for (const variant of one.variants) {
        if (variant === one.value) continue;
        options.push({ key: `${one.key}:${variant}`, label: `другое написание: «${variant}»`, href: href(variant), selected: selected === variant });
      }
    }
  }
  return options;
}

/**
 * Меню менеджера (Э8.6, 253): один пункт на ключ написания — имя по таблице
 * владельца или самое частое написание — и число записей выборки после
 * выбора. Выбор — ключ; у кого есть «Менеджеры в отчёте», последний пункт
 * ведёт туда.
 */
function managerOptions(workspace: SalesRegisterWorkspace, selected: string | null, href: (value: string | null) => string, managersHref: string | null): FilterOption[] {
  const options: FilterOption[] = [{ key: "all", label: "Все", href: href(null), selected: !selected }];
  const current = workspace.managerKey;
  if (selected && current !== null && !workspace.managerOptions.some((option) => option.key === current)) {
    options.push({ key: "current", label: `Из фильтра: ${tidy(selected)}`, href: href(selected), selected: true });
  }
  for (const option of workspace.managerOptions) {
    options.push({ key: option.key, label: option.name, href: href(option.key), selected: option.key === current, count: option.count });
  }
  if (managersHref) options.push({ key: "managers", label: "Менеджеры в отчёте →", href: managersHref, selected: false });
  return options;
}

/** Все записи выборки для остатка: те же фильтры, страницы по 50, до 10 страниц. */
async function readSummaryRows(
  actor: ActivePlatformActor,
  first: SalesRegisterWorkspace,
  offset: number,
  selection: Omit<Parameters<typeof readSalesRegisterWorkspace>[1], "offset" | "recordId">,
): Promise<Readonly<{ rows: readonly SalesRegisterRow[] }> | Readonly<{ rows: null; reason: "too_many" | "unavailable" }>> {
  const pages = Math.ceil(first.totalCount / SALES_PAGE_SIZE);
  if (pages <= 1 && offset === 0) return { rows: first.rows };
  if (pages > SALES_SUMMARY_MAX_PAGES) return { rows: null, reason: "too_many" };
  const reads = await Promise.all(Array.from({ length: pages }, (_, index) => index * SALES_PAGE_SIZE).map((pageOffset) =>
    pageOffset === offset ? Promise.resolve(first) : readSalesRegisterWorkspace(actor, { ...selection, offset: pageOffset }).catch(() => null)));
  if (reads.some((read) => read === null || read.totalCount !== first.totalCount)) return { rows: null, reason: "unavailable" };
  const rows = reads.flatMap((read) => read!.rows);
  // Выборка сменилась между чтениями — числа не складываются, остатка нет.
  if (rows.length !== first.totalCount || new Set(rows.map((row) => row.id)).size !== rows.length) return { rows: null, reason: "unavailable" };
  return { rows };
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
  const total = basis?.total ?? workspace.totalCount;
  const within = [
    basis && basis.undated > 0 ? `${basis.undated} без даты продажи` : null,
    basis && basis.otherSaleDate > 0 ? `${basis.otherSaleDate} с датой продажи в другом ${yearOnly ? "году" : "месяце"}` : null,
  ].filter(Boolean).join(" и ");
  const recordsOf = filedElsewhere
    ? yearOnly ? "с датой продажи в этом году и месяцем отчёта в другом году" : "с датой продажи в этом месяце и другим месяцем отчёта"
    : `${yearOnly ? "года" : "месяца"} отчёта`;
  const caption = `Суммы по ${total.toLocaleString("ru-RU")} ${recordsDative(total)} ${recordsOf}${filtered ? ", с фильтрами" : ""}${within ? `, из них ${within}` : ""}`;
  // Суммы сервера (`totals`) не включают неуточнённые стоимость и оплату — как и прежде, это сказано числом.
  const unresolved = !summary && (workspace.unresolvedCostCount > 0 || workspace.unresolvedPaidCount > 0)
    ? `В денежные итоги не включены неуточнённые значения: стоимость — ${workspace.unresolvedCostCount}, оплата — ${workspace.unresolvedPaidCount}.` : null;
  const left = summary ? [
    summary.noCost > 0 ? `без стоимости — ${summary.noCost} ${recordsWord(summary.noCost)}` : null,
    summary.paidMissing > 0 ? `оплата не указана — ${summary.paidMissing} ${recordsWord(summary.paidMissing)}` : null,
    summary.paidUnclear > 0 ? `оплата не разобрана — ${summary.paidUnclear} ${recordsWord(summary.paidUnclear)}` : null,
  ].filter(Boolean).join(", ") : "";
  const cross = summary ? summary.cross.map((pair) => `${pair.costCurrency} → ${pair.paidCurrency} — стоимость в ${pair.costCurrency}, оплата в ${pair.paidCurrency} без суммы в валюте договора (${pair.count} ${recordsWord(pair.count)}): остаток не считается.`) : [];
  const footnote = [
    ...cross,
    summary ? null : reason === "too_many"
      ? `Остаток не посчитан: в выборке больше ${SALES_PAGE_SIZE * SALES_SUMMARY_MAX_PAGES} записей — сузьте период или фильтры.`
      : "Остаток не посчитан: не удалось прочитать все записи выборки — обновите страницу.",
    unresolved,
    left ? `Не вошли: ${left}.` : null,
    "Валюты не пересчитываются; это записи отчёта, не поступления за месяц.",
  ].filter(Boolean).join(" ");
  const head = "pb-1 ps-4 text-right font-medium sm:ps-10";
  const value = "py-1 ps-4 text-right align-baseline t-body-compact tabular-nums sm:ps-10";
  const label = "py-1 pe-3 text-left align-baseline";
  const lines = summary ? summary.lines.map((line) => ({ currency: line.currency, cost: line.costMinor, paid: line.paidMinor, rest: line.remainderMinor as number | null }))
    : workspace.totals.map((line) => ({ currency: line.currency, cost: line.costMinor, paid: line.paidMinor, rest: null }));
  return (
    <section aria-labelledby="sales-money-title" className="border-y border-border py-3" data-testid="sales-money-summary">
      <h2 id="sales-money-title" className="sr-only">Суммы по записям</h2>
      <p className="t-meta text-fg-2" data-money-basis={total}>{caption}</p>
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
                <th scope="row" className={`${label} whitespace-nowrap t-body-compact font-normal text-fg-2`}>
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
function SaleRow({ row, year, href, selected, showReportMonth, showRemainder, manager, layout }: Readonly<{
  row: SalesRegisterRow; year: number; href: string; selected: boolean; showReportMonth: boolean;
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
  const reviewText = review.state === "review" ? review.reasons.join(", ") : review.state === "checked" ? "Сверено" : "В архиве";
  const reviewTone = review.state === "review" ? "text-fg-2" : "text-fg-3";
  const reviewMark = compact && review.state === "review";
  const name = row.applicantName || "Имя не указано";
  const mono = "font-mono tabular-nums";
  // Оплата в другой валюте с суммой в валюте договора: остаток — от неё, и это сказано подсказкой.
  const remainderTitle = remainderWhy ?? (remainder && contract ? `${remainder}: стоимость ${cost} − оплачено в валюте договора ${contract}` : remainder);
  return (
    <tr role="row" id={`sale-${row.id}`} data-selected={selected ? "" : undefined}
      className={`relative grid scroll-mt-24 grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-1.5 ${at.row} ${selected ? "bg-surface-2" : "bg-surface hover:bg-surface-2"}`}>
      <th role="rowheader" scope="row" className={`min-w-0 font-normal ${at.name}`}>
        <Link href={href} scroll={false} aria-current={selected ? "true" : undefined} title={name}
          className={`flex min-h-11 min-w-0 ${reviewMark ? "flex-col justify-center" : "items-center"} t-item text-fg underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline`}>
          <span className="truncate">{name}</span>
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
        {row.signingDate ? <time dateTime={row.signingDate} className={`t-body-compact text-fg-2 ${mono}`}>{rowDate(row.signingDate, year)}</time> : <span className="t-body-compact text-fg-3">—</span>}
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
      <td role="cell" className={`${at.review} pe-4`}><span className={`block truncate t-body-compact ${reviewTone}`} title={reviewText}>{reviewText}</span></td>
      {/* Узкий контейнер: сведения строки под именем (широкий их не показывает); дата — JetBrains Mono,
          «Уточнить» — своей строкой целиком: причина не прячется за многоточием. */}
      <td role="cell" className={`col-span-2 min-w-0 pb-1 ${at.narrow}`}>
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
 * единственный сплошной красный. `dynamics` — раздел «Динамика по дням»
 * (графики и воронка, Э3) для ролей, читающих продажи; стоит под записями и
 * не показывается рядом с формой новой продажи.
 */
export async function SalesRegisterView({ actor, query, dynamics = null }: { actor: ActivePlatformActor; query: SalesReportQuery; dynamics?: ReactNode }) {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const { year, month, offset, searchQuery, saleSlice, saleSliceHref, valid, reportMonth, params, href, clearFiltersHref, importHref } = salesReportContext(query, {
    year: Number(now.find(p => p.type === "year")!.value), month: Number(now.find(p => p.type === "month")!.value),
  });
  const writeAccess = await readSalesRegisterWriteAccess(actor);
  const canManage = writeAccess === "allowed";
  const viewingRecord = Boolean(query.record);
  const creating = query.new === "true" && !viewingRecord;
  const editingRecord = viewingRecord && query.edit === "true";
  // Новая продажа — отдельная страница формы; всё остальное — список (и панель записи).
  const creatingForm = creating && canManage;
  const directionsPromise = !creatingForm ? readSalesRegisterDirections(actor).catch(() => null) : Promise.resolve(null);
  const managementPromise: Promise<SalesRegisterManagementRead> = valid && !creatingForm
    ? readSalesRegisterManagement(actor, month && query.archived !== "true" ? reportMonth : null)
    : Promise.resolve({ status: "denied" });
  const checkFinanceAccess = staffHasPermission(actor, "finance.read.full") && !isStaffPreview(actor);
  const selection = {
    year, month, archived: query.archived === "true", manager: query.manager, direction: query.direction,
    needsReview: query.review ? query.review === "true" : null, query: searchQuery, saleSlice,
  };
  let workspace: SalesRegisterWorkspace | null = null;
  let intakeOptions: SalesRegisterIntakeOptions | null = null;
  let cash: MonthlyPaymentSummaryRead | Readonly<{ status: "unavailable" }> | null = null;
  // «Продажи» периода по одному определению (Э2): не зависит от фильтров строк.
  const headlinePeriod = valid ? salesHeadlinePeriod(year, month) : null;
  let salesCount: SalesCountRead | null = null;
  // «Нужно уточнить · N»: то же чтение с отметкой; нет чтения — нет числа.
  let reviewCount: number | null = null;
  // «Оформить продажу» из Lead 360: имя лида для прежнего поиска формы.
  let initialLead: Readonly<{ id: string; query: string }> | null = null;
  if (valid) {
    const leadId = creatingForm && typeof query.lead === "string" ? parseSalesUuid(query.lead) : null;
    let reviewRead: number | null;
    [workspace, cash, intakeOptions, salesCount, reviewRead, initialLead] = await Promise.all([
      readSalesRegisterWorkspace(actor, { ...selection, offset, recordId: query.record ?? query.saved }).catch(() => null),
      checkFinanceAccess && month && !creatingForm ? readMonthlyPaymentSummary(actor, year, month)
        .catch(() => ({ status: "unavailable" as const })) : Promise.resolve(null),
      creatingForm ? readSalesRegisterIntakeOptions(actor).catch(() => null) : Promise.resolve(null),
      headlinePeriod && !creatingForm ? readSalesCount(actor, headlinePeriod) : Promise.resolve(null),
      !creatingForm && query.review !== "true"
        ? readSalesRegisterWorkspace(actor, { ...selection, needsReview: true, offset: 0 }).then((read) => read.totalCount, () => null)
        : Promise.resolve(null),
      leadId ? getPlatformSalesLead(actor, leadId).then((lead) => lead?.clientDisplayName ? { id: lead.leadId, query: lead.clientDisplayName } : null, () => null)
        : Promise.resolve(null),
    ]);
    reviewCount = query.review === "true" ? workspace?.totalCount ?? null : reviewRead;
  }
  const archiveView = query.archived === "true";
  // «Архив» — без сумм и остатка (как на сервере и до Э4): все страницы для остатка не читаются.
  const summaryRead = workspace && !creatingForm && !archiveView ? await readSummaryRows(actor, workspace, offset, selection) : null;
  const summary = summaryRead?.rows ? salesMoneySummary(summaryRead.rows) : null;
  const summaryBasis = summaryRead?.rows ? salesSummaryBasis(summaryRead.rows, { year, month }) : null;
  const management = await managementPromise;
  const canTarget = management.status === "ready" && management.data.canManageTarget;
  const canImport = management.status === "ready" && management.data.canImport;
  const managementUnavailable = management.status === "unavailable";
  // Hints only retain disabled drafts on a failed read; they never grant a write.
  const showTargetForm = canTarget || (managementUnavailable && !isStaffPreview(actor) && staffHasPermission(actor, "sales.register.target.manage"));
  const directions = await directionsPromise;
  const directionControl = salesDirectionControl(directions, query.direction);
  const rowFilters = Boolean(searchQuery || query.manager || query.direction || query.review || query.archived === "true");
  const hasFilters = rowFilters || Boolean(saleSlice);
  // Во «Весь год» и в срезе «записаны в другой месяц отчёта» у строк разные месяцы отчёта — его видно в строке.
  const showReportMonth = month === undefined || saleSlice === "filed_elsewhere";
  const saved = !creatingForm && !viewingRecord && query.saved && workspace?.selected?.id === query.saved ? workspace.selected : null;
  const target = management.status === "ready" ? management.data.target : null;
  const backHref = viewingRecord && workspace?.selected ? `${href()}#sale-${workspace.selected.id}` : href();
  const panelOpen = viewingRecord && !creatingForm;
  // Рядом с открытой записью — короткий набор столбцов (Э8.6), иначе полный.
  const layout: RowLayout = panelOpen ? "compact" : "full";
  // В «Архиве» нет столбца «Остаток» (предпоследний): его место делят остальные.
  const recordColumns = (panelOpen
    ? showReportMonth ? COMPACT_COLUMNS_WITH_REPORT_MONTH : COMPACT_COLUMNS
    : showReportMonth ? RECORD_COLUMNS_WITH_REPORT_MONTH : RECORD_COLUMNS)
    .filter((_, index, all) => !archiveView || index !== all.length - 2);
  const editing = editingRecord && canManage;
  // Шапка общей боковой панели (Э7): имя, строка контекста и «Открыть …» — прежние тексты записи.
  const panelHeader = panelOpen && workspace ? salesRecordPanelHeader(workspace.selected ?? null, editing) : null;
  // Запись открывается просмотром (Э8.6); «Исправить запись» — форма, «Отмена» формы — снова просмотр.
  const recordHref = workspace?.selected ? href({ record: workspace.selected.id }) : backHref;

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
    <div role="group" aria-label="Поиск и фильтры" className="mt-4 flex flex-wrap items-center gap-2 first:mt-0" data-testid="sales-report-toolbar">
      <form key={params.toString()} method="get" role="search" aria-label="Поиск по записям" className="min-w-48 flex-1 basis-48 md:max-w-xs">
        {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="relative block">
          <span className="sr-only">Имя, телефон или договор</span>
          <Icon name="search" size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input name="q" type="search" defaultValue={searchQuery ?? (typeof query.q === "string" ? query.q : "")} maxLength={200}
            placeholder="Имя, телефон или договор" enterKeyHint="search" autoComplete="off"
            className="h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface ps-10 pe-3 t-body text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent" />
        </label>
      </form>
      <QueueFilterDisclosure activeCount={activeCount}>
        <FilterMenu label="Менеджер" valueLabel={selectedManagerName}
          options={managerOptions(workspace, selectedManager, (value) => filterHref({ manager: value }), managersHref)}
          clearHref={selectedManager ? filterHref({ manager: null }) : null} />
        {directionControl.kind === "select" ? (
          <FilterMenu label="Направление" valueLabel={selectedDirection ? tidy(selectedDirection) : null}
            options={labelOptions(directionGroups, selectedDirection, (value) => filterHref({ direction: value }))}
            clearHref={selectedDirection ? filterHref({ direction: null }) : null} />
        ) : (
          // Список направлений не прочитан — ввод как в записи (прежнее поведение), применяется по Enter.
          <form method="get" className="inline-flex" aria-label="Направление">
            {Object.entries(hidden).filter(([name]) => name !== "direction").map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
            {searchQuery ? <input type="hidden" name="q" value={searchQuery} /> : null}
            <label className="block">
              <span className="sr-only">Направление</span>
              <input name="direction" defaultValue={directionControl.value} maxLength={1000} placeholder="Направление — как в записи"
                aria-invalid={directionControl.reason === "invalid" ? true : undefined}
                title={directionControl.reason === "invalid"
                  ? "Введите направление до 500 символов без переносов строк и служебных символов."
                  : "Не удалось загрузить список. Введите направление как в записи или обновите страницу."}
                className={`${inputCls} min-h-11 w-56`} />
            </label>
          </form>
        )}
        <div role="group" aria-label="Уточнения" className="inline-flex">
          <Link href={filterHref({ review: query.review === "true" ? null : "true" })} scroll={false}
            aria-current={query.review === "true" ? "true" : undefined} className={`${TOGGLE} rounded-e-none`} data-testid="sales-review-toggle">
            Нужно уточнить{reviewCount !== null ? <span className="tabular-nums">{" · "}{reviewCount}</span> : null}
          </Link>
          <Link href={filterHref({ review: query.review === "false" ? null : "false" })} scroll={false}
            aria-current={query.review === "false" ? "true" : undefined} className={`${TOGGLE} -ms-px rounded-s-none`}>
            Сверено
          </Link>
        </div>
        <Link href={filterHref(query.archived === "true" ? { archived: null } : { archived: "true", sale: null })} scroll={false}
          aria-current={query.archived === "true" ? "true" : undefined} className={TOGGLE}>
          Архив
        </Link>
        {hasFilters ? <Link href={clearFiltersHref} scroll={false} className={`${QUIET_LINK} px-2`}>Сбросить</Link> : null}
      </QueueFilterDisclosure>
    </div>
  ) : null;

  return <main className="mx-auto min-w-0 w-full max-w-[1240px] px-4 py-8 sm:px-6">
    {!creatingForm ? <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="t-page-title text-fg">Отчёт продаж</h1>
        {valid ? (
          <div role="group" aria-label="Период отчёта" className="flex items-center" data-testid="sales-period-stepper">
            <Link href={periodHref(steps.previous.year, steps.previous.month)} scroll={false}
              aria-label={month ? "Предыдущий месяц" : "Предыдущий год"}
              className="flex size-11 items-center justify-center rounded-ctl text-fg-2 hover:bg-surface-2 hover:text-fg">
              <Icon name="chevron-right" size={18} className="rotate-180" />
            </Link>
            <FilterMenu label={month ? `${MONTHS[month - 1]} ${year}` : `${year} год`} valueLabel={null}
              options={[
                ...MONTHS.map((title, index) => ({ key: String(index + 1), label: `${title} ${year}`, href: periodHref(year, index + 1), selected: month === index + 1 })),
                { key: "all", label: `Весь ${year} год`, href: periodHref(year, undefined), selected: month === undefined },
              ]} />
            <Link href={periodHref(steps.next.year, steps.next.month)} scroll={false}
              aria-label={month ? "Следующий месяц" : "Следующий год"}
              className="flex size-11 items-center justify-center rounded-ctl text-fg-2 hover:bg-surface-2 hover:text-fg">
              <Icon name="chevron-right" size={18} />
            </Link>
          </div>
        ) : null}
      </div>
      {workspace && canManage ? <Link href={href({ new: "true" })} className={`${btnCls} min-h-11`}>Добавить продажу</Link> : null}
    </div> : null}

    {writeAccess === "unavailable" ? <p role="alert" className="mt-4 text-sm text-fg-2">Не удалось проверить права на запись продажи. Обновите страницу перед добавлением или изменением.</p> : null}
    {(creating || editingRecord) && writeAccess === "denied" ? <p role="status" className="mt-4 text-sm text-fg-2">Добавление и исправление продаж доступны Sales Manager.</p> : null}
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
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 t-body-compact text-fg"><span className="break-words font-medium">{saved.applicantName}</span>
            <span className="text-fg-2"> · {dateLabel(saved.signingDate)} · {money(saved.serviceCostMinor, saved.serviceCostCurrency) ?? "Не уточнено"}</span></p>
          {saved.leadId ? <Link href={`/v3/profile?id=${encodeURIComponent(saved.leadId)}`} className={`${btnGhostCls} min-h-11`}>Открыть дело</Link> : null}
        </div>
      </section> : null}
      {!workspace ? <div role="alert" className="mt-8 space-y-3 border-s-2 border-border ps-4 text-sm text-fg-2">
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
            <p className="text-sm text-fg-2">{offset > 0 ? "Вернитесь к началу списка с теми же фильтрами." : hasFilters ? "Измените или сбросьте фильтры. Выбранный период сохранится." : "Выберите другой месяц или весь год в переключателе выше."}</p>
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
                  </tr>
                </thead>
                <tbody role="rowgroup" className={ROW_LAYOUT[layout].tbody}>
                  {workspace.rows.map((row) => <SaleRow key={row.id} row={row} year={year} href={rowHref(row)} layout={layout} manager={managerName(row)}
                    selected={row.id === (panelOpen ? query.record : saved?.id)} showReportMonth={showReportMonth} showRemainder={!archiveView} />)}
                </tbody>
              </table>
            </div>
          </div>}
          </div>
          <nav aria-label="Страницы отчёта" className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {offset > 0 ? <Link href={href({ offset: String(Math.max(0, offset - 50)) })} className={`${btnGhostCls} min-h-11`}>Назад</Link> : <span />}
            <span className="t-meta text-fg-3">{workspace.rows.length ? `${offset + 1}–${offset + workspace.rows.length} из ${workspace.totalCount}` : ""}</span>
            {workspace.hasMore ? <Link href={href({ offset: String(offset + 50) })} className={`${btnGhostCls} min-h-11`}>Далее</Link> : <span />}
          </nav>
        </div>
        {panelOpen && panelHeader ? (
          <SidePanel key={`${query.record}:${editing ? "edit" : "view"}`} closeHref={href()} backLabel="К отчёту" headingId={PANEL_HEADING}
            title={panelHeader.title} context={panelHeader.context} open={panelHeader.open}
            returnTo={query.record ? attributeReturn("id", `sale-${query.record}`, "a") : undefined}>
            {editing ? (
              <SalesRegisterForm key={query.record} record={workspace.selected ?? null}
                recordId={query.record ?? null} reportMonth={reportMonth} ownerOptions={workspace.ownerOptions}
                canChooseOwner={canManage} requestId={randomUUID()} archiveRequestId={randomUUID()} backHref={recordHref} readUnavailable={false}
                ownMembershipId={actor.membershipId} ownLabel={actor.displayName} panelHeadingId={PANEL_HEADING} />
            ) : (
              <SalesRecordPreview record={workspace.selected ?? null} backHref={backHref} panelHeadingId={PANEL_HEADING}
                managerName={workspace.selected ? managerName(workspace.selected) : null} year={year}
                editHref={canManage && workspace.selected ? href({ record: workspace.selected.id, edit: "true" }) : null} />
            )}
          </SidePanel>
        ) : null}
      </div>}
      {/* «Поступления и возвраты за месяц» — прежние чтение, тексты и состояния; с Э4 — под записями,
          строка на валюту вместо карточки. Как и прежде, только при прочитанном отчёте. */}
      {workspace && cash && cash.status !== "not_allowed" && month ? <section aria-labelledby="sales-cash-totals" className="mt-8 border-t border-border pt-4" data-testid="sales-cash-totals">
        <h2 id="sales-cash-totals" className="t-section text-fg">Поступления и возвраты за месяц</h2>
        <p className="mt-1 t-meta text-fg-2">Подтверждённые финансовые события всей организации по дате операции, время Бишкека. Фильтры строк продаж на этот блок не влияют. Расходы третьих сторон не являются выручкой EVO.</p>
        {cash.status === "unavailable" ? <p role="alert" className="mt-3 text-sm text-fg-2">Не удалось загрузить финансовую сводку. Обновите страницу, чтобы повторить.</p> : cash.totals.length === 0 ? <p className="mt-3 text-sm text-fg-2">В этом месяце подтверждённых финансовых событий нет.</p> : <ul className="mt-2 divide-y divide-border border-y border-border">{cash.totals.map(total => <li key={total.currency} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-2 py-2 t-body-compact text-fg-2">
          <span className="t-item text-fg">{total.currency}</span>
          <dl className="flex flex-wrap gap-x-5 gap-y-0.5">
            <div className="flex gap-1"><dt>Получено</dt><dd className="tabular-nums text-fg">{financeMoney(total.paymentsMinor, total.currency)}</dd></div>
            <div className="flex gap-1"><dt>Возвращено</dt><dd className="tabular-nums text-fg">{financeMoney(total.refundsMinor, total.currency)}</dd></div>
            <div className="flex gap-1 font-semibold text-fg"><dt>Итого</dt><dd className="tabular-nums">{financeMoney(total.netMinor, total.currency)}</dd></div>
          </dl>
        </li>)}</ul>}
      </section> : null}
      {dynamics}
      {(showTargetForm && month && query.archived !== "true") || canImport || managementUnavailable ? <div className="mt-8 space-y-5 border-t border-border pt-5">
        {managementUnavailable ? <p role="alert" className="text-sm text-fg-2">Не удалось проверить доступ к плану и переносу данных.</p> : null}
        {showTargetForm && month && query.archived !== "true" ? <details className="group"><summary className="flex min-h-12 w-fit cursor-pointer list-none items-center gap-2 rounded-nav t-item text-fg [&::-webkit-details-marker]:hidden">Изменить план месяца<Icon name="chevron-down" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" /></summary><SalesTargetForm key={reportMonth} reportMonth={reportMonth} target={target} requestId={randomUUID()} readUnavailable={!workspace || managementUnavailable} /></details> : null}
        {canImport && managersHref ? <div className="flex flex-wrap gap-3">
          <Link href={importHref} className={`${btnGhostCls} min-h-11`}>Перенос данных</Link>
          <Link href={managersHref} className={`${btnGhostCls} min-h-11`}>Менеджеры в отчёте</Link>
        </div> : null}
      </div> : null}
    </>}
  </main>;
}
