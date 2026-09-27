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
import { SalesRecordPreview } from "./SalesRecordPreview";
import { salesDirectionControl } from "@/lib/sales-register-directions";
import type { SalesRegisterManagementRead } from "@/lib/sales-register-management";
import {
  SALES_PAGE_SIZE, SALES_SUMMARY_MAX_PAGES, groupSalesLabels, recordsWord, salesLabelGroupOf, salesMoneySummary, salesPeriodSteps,
  salesRowRemainder, salesRowReview, type SalesLabelGroup, type SalesMoneySummary,
} from "@/lib/sales-register-view";

import type { V3Look } from "./blocks/look";
import { FilterMenu, type FilterOption } from "./queue/FilterMenu";
import { QueueDetailPanel } from "./queue/QueueDetailPanel";
import { QueueFilterDisclosure } from "./queue/QueueFilterDisclosure";
import { salesReportContext, type SalesReportQuery, type SalesSaleSlice } from "@/lib/sales-register-navigation";
export type { SalesReportQuery } from "@/lib/sales-register-navigation";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const money = (minor: number | null, currency: string | null) => minor === null || !currency ? null : `${number.format(minor / 100)} ${currency}`;
const dateLabel = (date: string | null) => date ? date.split("-").reverse().join(".") : "Дата не указана";
/** Плотная дата строки: «ДД.ММ», другой год — «ДД.ММ.ГГ» (DESIGN.md). */
const rowDate = (date: string, year: number) => {
  const [y, m, d] = date.split("-");
  return Number(y) === year ? `${d}.${m}` : `${d}.${m}.${y.slice(2)}`;
};
const tidy = (value: string) => value.trim().replace(/\s+/gu, " ");
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

/** Меню варианта фильтра: одно имя на написания; у выбранной группы — её остальные написания. */
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

/** Суммы выборки по валютам: остаток — только внутри одной валюты, оплата в другой валюте — отдельно. */
function MoneySummary({ workspace, summary, reason, filtered }: Readonly<{
  workspace: SalesRegisterWorkspace; summary: SalesMoneySummary | null; reason: "too_many" | "unavailable" | null; filtered: boolean;
}>) {
  if (workspace.totalCount === 0) return null;
  const amount = (minor: number, currency: string) => <span className="tabular-nums text-fg">{money(minor, currency)}</span>;
  return (
    <section aria-labelledby="sales-money-title" className="mt-4 border-y border-border py-3" data-testid="sales-money-summary">
      <h2 id="sales-money-title" className="sr-only">Суммы по записям</h2>
      {summary ? <>
        {summary.lines.length > 0 ? (
          <ul aria-label="Денежные итоги по валютам" className="space-y-1">
            {summary.lines.map((line) => (
              <li key={line.currency} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-2 t-body-compact text-fg-2" data-money-line={line.currency}>
                <span className="t-item text-fg">{line.currency}</span>
                <span className="flex flex-wrap gap-x-5 gap-y-0.5">
                  <span>Стоимость {amount(line.costMinor, line.currency)}</span>
                  <span>Оплачено {amount(line.paidMinor, line.currency)}</span>
                  <span>Остаток {amount(line.remainderMinor, line.currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {summary.cross.length > 0 ? (
          <p className="mt-1.5 t-meta text-fg-2" data-money-cross="">
            Оплата в другой валюте — в остаток не входит:{" "}
            {summary.cross.map((pair, index) => (
              <span key={`${pair.costCurrency}${pair.paidCurrency}`}>
                {index > 0 ? "; " : null}
                стоимость в {pair.costCurrency}, оплата в {pair.paidCurrency} — {pair.count} {recordsWord(pair.count)}:{" "}
                <span className="tabular-nums">{money(pair.costMinor, pair.costCurrency)}</span>, оплачено{" "}
                <span className="tabular-nums">{money(pair.paidMinor, pair.paidCurrency)}</span>
              </span>
            ))}
          </p>
        ) : null}
        {summary.noCost > 0 || summary.paidUnclear > 0 ? (
          <p className="mt-1 t-meta text-fg-2">
            Не вошли в суммы:{" "}
            {[summary.noCost > 0 ? `без стоимости — ${summary.noCost} ${recordsWord(summary.noCost)}` : null,
              summary.paidUnclear > 0 ? `оплата не разобрана — ${summary.paidUnclear} ${recordsWord(summary.paidUnclear)}` : null].filter(Boolean).join("; ")}.
          </p>
        ) : null}
      </> : <>
        {workspace.totals.length > 0 ? (
          <ul aria-label="Денежные итоги по валютам" className="space-y-1">
            {workspace.totals.map((total) => (
              <li key={total.currency} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-2 t-body-compact text-fg-2">
                <span className="t-item text-fg">{total.currency}</span>
                <span className="flex flex-wrap gap-x-5 gap-y-0.5">
                  <span>Стоимость {amount(total.costMinor, total.currency)}</span>
                  <span>Оплачено по записям {amount(total.paidMinor, total.currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 t-meta text-fg-2">
          {reason === "too_many"
            ? `Остаток не посчитан: в выборке больше ${SALES_PAGE_SIZE * SALES_SUMMARY_MAX_PAGES} записей — сузьте период или фильтры.`
            : "Остаток не посчитан: не удалось прочитать все записи выборки. Обновите страницу."}
        </p>
      </>}
      <p className="mt-1 t-meta text-fg-3">
        Суммы по записям {filtered ? "выборки" : "периода"}, не поступления за месяц; валюты не пересчитываются.
      </p>
    </section>
  );
}

/** Строка записи: одна линия на широком контейнере, две–три строки на узком. */
function SaleRow({ row, year, href, selected, showReportMonth }: Readonly<{
  row: SalesRegisterRow; year: number; href: string; selected: boolean; showReportMonth: boolean;
}>) {
  const review = salesRowReview(row);
  const cost = money(row.serviceCostMinor, row.serviceCostCurrency);
  const paid = money(row.paidMinor, row.paidCurrency);
  const remainderMinor = salesRowRemainder(row);
  const remainder = remainderMinor === null ? null : money(remainderMinor, row.serviceCostCurrency);
  const remainderWhy = remainderMinor !== null ? null : row.serviceCostMinor === null ? "нет стоимости"
    : row.paidMinor === null ? "оплата не разобрана" : "оплата в другой валюте";
  const place = [row.country, row.program].map((part) => tidy(part)).filter(Boolean).join(" · ");
  const manager = tidy(row.managerLabel);
  const reportMonth = showReportMonth ? `Месяц отчёта: ${MONTHS[Number(row.reportMonth.slice(5, 7)) - 1]} ${row.reportMonth.slice(0, 4)}` : null;
  const reviewText = review.state === "review" ? review.reasons.join(", ") : review.state === "checked" ? "Сверено" : "В архиве";
  const reviewTone = review.state === "review" ? "text-fg-2" : "text-fg-3";
  const name = row.applicantName || "Имя не указано";
  const cell = "hidden min-w-0 px-3 align-middle @min-[60rem]/sales-records:table-cell";
  const mono = "font-mono tabular-nums";
  return (
    <tr role="row" id={`sale-${row.id}`} data-selected={selected ? "" : undefined}
      className={`relative grid scroll-mt-24 grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-1.5 @min-[60rem]/sales-records:table-row @min-[60rem]/sales-records:p-0 ${selected ? "bg-surface-2" : "bg-surface hover:bg-surface-2"}`}>
      <th role="rowheader" scope="row" className="min-w-0 font-normal @min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:ps-4 @min-[60rem]/sales-records:pe-3 @min-[60rem]/sales-records:align-middle">
        <Link href={href} scroll={false} aria-current={selected ? "true" : undefined} title={name}
          className="flex min-h-11 min-w-0 items-center t-item text-fg underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline">
          <span className="truncate">{name}</span>
        </Link>
      </th>
      <td role="cell" className={cell}><span className="block truncate t-body-compact text-fg-2" title={place || undefined}>{place || "—"}</span></td>
      <td role="cell" className={cell}><span className="block truncate t-body-compact text-fg-2" title={manager || undefined}>{manager || "—"}</span></td>
      <td role="cell" className={cell} title={reportMonth ?? undefined}>
        {row.signingDate ? <time dateTime={row.signingDate} className={`t-body-compact text-fg-2 ${mono}`}>{rowDate(row.signingDate, year)}</time> : <span className="t-body-compact text-fg-3">—</span>}
        {reportMonth ? <span className="sr-only">. {reportMonth}</span> : null}
      </td>
      <td role="cell" className={`${cell} text-right`}><span className="block truncate t-body-compact tabular-nums text-fg">{cost ?? "—"}</span></td>
      <td role="cell" className={`${cell} text-right`}><span className="block truncate t-body-compact tabular-nums text-fg-2">{paid ?? "—"}</span></td>
      <td role="cell" className="self-center text-right @min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:px-3 @min-[60rem]/sales-records:align-middle">
        <span className="block truncate t-body-compact tabular-nums text-fg" title={remainderWhy ?? undefined}>
          <span className="t-meta text-fg-2 @min-[60rem]/sales-records:sr-only">остаток </span>{remainder ?? "—"}
        </span>
      </td>
      <td role="cell" className={`${cell} pe-4`}><span className={`block truncate t-body-compact ${reviewTone}`} title={reviewText}>{reviewText}</span></td>
      {/* Узкий контейнер: сведения строки — одной-двумя строками под именем (широкий их не показывает). */}
      <td role="cell" className="col-span-2 min-w-0 pb-1 @min-[60rem]/sales-records:hidden">
        <p className="truncate t-meta text-fg-2">
          {[row.signingDate ? rowDate(row.signingDate, year) : "без даты", manager || null, place || null].filter(Boolean).join(" · ")}
        </p>
        <p className="truncate t-meta text-fg-2">
          {[cost ? `стоимость ${cost}` : null, paid ? `оплачено ${paid}` : null, reviewText].filter(Boolean).join(" · ")}
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
export async function SalesRegisterView({ actor, query, dynamics = null, look }: { actor: ActivePlatformActor; query: SalesReportQuery; dynamics?: ReactNode; look?: V3Look }) {
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
  const summaryRead = workspace && !creatingForm ? await readSummaryRows(actor, workspace, offset, selection) : null;
  const summary = summaryRead?.rows ? salesMoneySummary(summaryRead.rows) : null;
  const management = await managementPromise;
  const canTarget = management.status === "ready" && management.data.canManageTarget;
  const canImport = management.status === "ready" && management.data.canImport;
  const managementUnavailable = management.status === "unavailable";
  // Hints only retain disabled drafts on a failed read; they never grant a write.
  const showTargetForm = canTarget || (managementUnavailable && !isStaffPreview(actor) && staffHasPermission(actor, "sales.register.target.manage"));
  const directions = await directionsPromise;
  const directionControl = salesDirectionControl(directions, query.direction);
  const hasFilters = Boolean(searchQuery || query.manager || query.direction || query.review || query.archived === "true" || saleSlice);
  const saved = !creatingForm && !viewingRecord && query.saved && workspace?.selected?.id === query.saved ? workspace.selected : null;
  const target = management.status === "ready" ? management.data.target : null;
  const backHref = viewingRecord && workspace?.selected ? `${href()}#sale-${workspace.selected.id}` : href();
  const panelOpen = viewingRecord && !creatingForm;

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
  // Запись открывается в панели: у того, кто исправляет продажи, — сразу форма записи.
  const rowHref = (row: SalesRegisterRow) => href(canManage ? { record: row.id, edit: "true" } : { record: row.id });
  const managerGroups = groupSalesLabels(workspace?.managerLabels ?? []);
  const directionGroups = groupSalesLabels(directions ?? []);
  const selectedManager = query.manager || null;
  const selectedDirection = directionControl.value || null;
  const managerGroup = salesLabelGroupOf(managerGroups, selectedManager);
  const directionGroup = salesLabelGroupOf(directionGroups, selectedDirection);
  const variantNote = managerGroup && managerGroup.variants.length > 1 ? "менеджера" : directionGroup && directionGroup.variants.length > 1 ? "направления" : null;
  const activeCount = [query.manager, query.direction, query.review, query.archived === "true" ? "1" : "", saleSlice].filter(Boolean).length;
  const steps = salesPeriodSteps(year, month);
  const hidden = Object.fromEntries([...params.entries()].filter(([key]) => key !== "q" && key !== "offset"));

  const toolbar = workspace ? (
    <div role="group" aria-label="Поиск и фильтры" className="mt-4 flex flex-wrap items-center gap-2" data-testid="sales-report-toolbar">
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
        <FilterMenu label="Менеджер" valueLabel={selectedManager ? tidy(selectedManager) : null}
          options={labelOptions(managerGroups, selectedManager, (value) => filterHref({ manager: value }))}
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
          filtered={hasFilters} sliceHref={saleSliceHref} target={month && query.archived !== "true" ? target?.targetCount ?? null : null} look={look} />
      </div> : null}
      {saved ? <section id="saved-sale" aria-labelledby="saved-sale-title" className="mt-4 scroll-mt-4 border-y border-border py-3">
        <h2 id="saved-sale-title" className="t-item text-fg">Продажа добавлена</h2>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 t-body-compact text-fg"><span className="break-words font-medium">{saved.applicantName}</span>
            <span className="text-fg-2"> · {dateLabel(saved.signingDate)} · {money(saved.serviceCostMinor, saved.serviceCostCurrency) ?? "Не уточнено"}</span></p>
          {saved.leadId ? <Link href={`/v3/profile?id=${encodeURIComponent(saved.leadId)}`} className={`${btnGhostCls} min-h-11`}>Открыть дело</Link> : null}
        </div>
      </section> : null}
      {workspace ? <MoneySummary workspace={workspace} summary={summary} reason={summaryRead && summaryRead.rows === null ? summaryRead.reason : null} filtered={hasFilters} /> : null}
      {toolbar}
      {variantNote ? <p className="mt-2 t-meta text-fg-2" data-testid="sales-variant-note">
        Фильтр точный: показаны записи с выбранным написанием {variantNote}. Другие написания — в том же меню; сведение к сотрудникам и списку направлений — отдельный шаг.
      </p> : null}
      {saleSlice && headlinePeriod ? <p role="status" className="mt-2 flex flex-wrap items-center gap-x-3 t-body-compact text-fg-2" data-sale-slice={saleSlice}>
        <span>{SALE_SLICE_TITLE[saleSlice]} — {headlinePeriod.label}.</span>
        <Link href={clearFiltersHref} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-fg">Все записи периода</Link>
      </p> : null}
      {!workspace ? <div role="alert" className="mt-8 space-y-3 border-s-2 border-border ps-4 text-sm text-fg-2">
        <p>{searchQuery === null ? "Введите поисковый запрос до 200 символов без переносов строк." : valid ? "Не удалось загрузить отчёт. Проверьте подключение и повторите загрузку." : "Проверьте год, месяц и номер страницы."}</p>
        <Link href="/v3/main?view=sales" className={`${btnGhostCls} min-h-11`}>Открыть текущий месяц</Link>
      </div> : <div className={panelOpen ? "mt-3 xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start xl:gap-6" : "mt-3"}>
        <div className="min-w-0">
          {workspace.rows.length === 0 ? <div className="space-y-2 border-t border-border py-12 text-center">
            <p className="text-base font-medium text-fg">{offset > 0 ? "На этой странице записей нет." : hasFilters ? "По выбранным фильтрам записей не найдено." : "В выбранном периоде записей нет."}</p>
            <p className="text-sm text-fg-2">{offset > 0 ? "Вернитесь к началу списка с теми же фильтрами." : hasFilters ? "Измените или сбросьте фильтры. Выбранный период сохранится." : "Выберите другой месяц или весь год в переключателе выше."}</p>
            {offset > 0 ? <Link href={href({ offset: "0" })} className={`${btnGhostCls} min-h-11`}>К началу списка</Link>
              : hasFilters ? <Link href={clearFiltersHref} className={`${btnGhostCls} min-h-11`}>Сбросить фильтры</Link> : null}
          </div> : <div className="@container/sales-records">
            <div role="region" aria-label="Записи продаж" tabIndex={0} className="relative max-w-full overflow-x-auto border-t border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <table role="table" className="block w-full text-left @min-[60rem]/sales-records:table @min-[60rem]/sales-records:table-fixed">
                <caption className="sr-only">{`Продажи: ${workspace.totalCount} ${recordsWord(workspace.totalCount)}`}</caption>
                <colgroup className="hidden @min-[60rem]/sales-records:table-column-group">
                  <col className="w-[18%]" /><col className="w-[17%]" /><col className="w-[12%]" /><col className="w-[7%]" />
                  <col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[16%]" />
                </colgroup>
                <thead role="rowgroup" className="sr-only @min-[60rem]/sales-records:not-sr-only @min-[60rem]/sales-records:table-header-group">
                  <tr role="row" className="t-caption text-fg-2">
                    <th role="columnheader" scope="col" className="py-2 ps-4 pe-3 font-medium">Студент</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Страна · программа</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Менеджер</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 font-medium">Дата</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 text-right font-medium">Стоимость</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 text-right font-medium">Оплачено</th>
                    <th role="columnheader" scope="col" className="px-3 py-2 text-right font-medium">Остаток</th>
                    <th role="columnheader" scope="col" className="py-2 ps-3 pe-4 font-medium">Уточнить</th>
                  </tr>
                </thead>
                <tbody role="rowgroup" className="block divide-y divide-border border-y border-border @min-[60rem]/sales-records:table-row-group">
                  {workspace.rows.map((row) => <SaleRow key={row.id} row={row} year={year} href={rowHref(row)}
                    selected={row.id === (panelOpen ? query.record : saved?.id)} showReportMonth={month === undefined || saleSlice === "filed_elsewhere"} />)}
                </tbody>
              </table>
            </div>
          </div>}
          <nav aria-label="Страницы отчёта" className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {offset > 0 ? <Link href={href({ offset: String(Math.max(0, offset - 50)) })} className={`${btnGhostCls} min-h-11`}>Назад</Link> : <span />}
            <span className="t-meta text-fg-3">{workspace.rows.length ? `${offset + 1}–${offset + workspace.rows.length} из ${workspace.totalCount}` : ""}</span>
            {workspace.hasMore ? <Link href={href({ offset: String(offset + 50) })} className={`${btnGhostCls} min-h-11`}>Далее</Link> : <span />}
          </nav>
        </div>
        {panelOpen ? (
          <QueueDetailPanel closeHref={href()} backLabel="К отчёту" headingId={PANEL_HEADING}>
            {editingRecord && canManage ? (
              <SalesRegisterForm key={query.record} record={workspace.selected ?? null}
                recordId={query.record ?? null} reportMonth={reportMonth} ownerOptions={workspace.ownerOptions}
                canChooseOwner={canManage} requestId={randomUUID()} archiveRequestId={randomUUID()} backHref={backHref} readUnavailable={false}
                ownMembershipId={actor.membershipId} ownLabel={actor.displayName} panelHeadingId={PANEL_HEADING} />
            ) : (
              <SalesRecordPreview record={workspace.selected ?? null} backHref={backHref} panelHeadingId={PANEL_HEADING}
                editHref={canManage && workspace.selected ? href({ record: workspace.selected.id, edit: "true" }) : null} />
            )}
          </QueueDetailPanel>
        ) : null}
      </div>}
      {cash && cash.status !== "not_allowed" && month ? <section aria-labelledby="sales-cash-totals" className="mt-8 border-t border-border pt-4">
        <h2 id="sales-cash-totals" className="t-section text-fg">Поступления и возвраты за месяц</h2>
        <p className="mt-1 t-meta text-fg-2">Подтверждённые финансовые события всей организации по дате операции, время Бишкека. Фильтры строк продаж на этот блок не влияют. Расходы третьих сторон не являются выручкой EVO.</p>
        {cash.status === "unavailable" ? <p role="alert" className="mt-3 text-sm text-fg-2">Не удалось загрузить финансовую сводку. Обновите страницу, чтобы повторить.</p> : cash.totals.length === 0 ? <p className="mt-3 text-sm text-fg-2">В этом месяце подтверждённых финансовых событий нет.</p> : <ul className="mt-2 divide-y divide-border border-y border-border">{cash.totals.map(total => <li key={total.currency} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-2 py-2 t-body-compact text-fg-2">
          <span className="t-item text-fg">{total.currency}</span>
          <span className="flex flex-wrap gap-x-5 gap-y-0.5">
            <span>Получено <span className="tabular-nums text-fg">{financeMoney(total.paymentsMinor, total.currency)}</span></span>
            <span>Возвращено <span className="tabular-nums text-fg">{financeMoney(total.refundsMinor, total.currency)}</span></span>
            <span className="font-semibold text-fg">Итого <span className="tabular-nums">{financeMoney(total.netMinor, total.currency)}</span></span>
          </span>
        </li>)}</ul>}
      </section> : null}
      {dynamics}
      {(showTargetForm && month && query.archived !== "true") || canImport || managementUnavailable ? <div className="mt-8 space-y-5 border-t border-border pt-5">
        {managementUnavailable ? <p role="alert" className="text-sm text-fg-2">Не удалось проверить доступ к плану и переносу данных.</p> : null}
        {showTargetForm && month && query.archived !== "true" ? <details><summary className="cursor-pointer py-3 text-sm font-medium">Изменить план месяца</summary><SalesTargetForm key={reportMonth} reportMonth={reportMonth} target={target} requestId={randomUUID()} readUnavailable={!workspace || managementUnavailable} /></details> : null}
        {canImport ? <Link href={importHref} className={`${btnGhostCls} min-h-11`}>Перенос данных</Link> : null}
      </div> : null}
    </>}
  </main>;
}
