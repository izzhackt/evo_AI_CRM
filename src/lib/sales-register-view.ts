/**
 * «Отчёт продаж» без коробок (Э4, 27.09.2026): чистая логика показа без
 * React — сведение вариантов фильтров для меню, причины «Уточнить» из полей
 * записи, остаток по валютам и шаги месяца. Данные не меняются: всё считается
 * из уже прочитанных строк; нет чтения — нет числа.
 */
import type { SalesRegisterRow } from "./platform-sales-register-contract.ts";

/**
 * Вариант фильтра в меню: одно имя на написания, которые отличаются только
 * пробелами по краям, двойными пробелами и регистром. Только показ: фильтр
 * отчёта по-прежнему точный, поэтому группа выбирает одно написание
 * (`value`), а остальные (`variants`) остаются выбираемыми. Сведение к
 * сотрудникам и списку направлений — позже, по таблице владельца.
 */
export type SalesLabelGroup = Readonly<{
  key: string;
  /** Текст без лишних пробелов — что видно в меню. */
  label: string;
  /** Написание, которое выбирает строка меню. */
  value: string;
  /** Все написания группы в порядке чтения, включая `value`. */
  variants: readonly string[];
}>;

const tidy = (value: string) => value.trim().replace(/\s+/gu, " ");

export function groupSalesLabels(values: readonly string[]): readonly SalesLabelGroup[] {
  const groups = new Map<string, { label: string; value: string | null; variants: string[] }>();
  for (const raw of values) {
    const label = tidy(raw);
    if (!label) continue;
    const key = label.toLocaleLowerCase("ru");
    const group = groups.get(key) ?? { label, value: null, variants: [] };
    if (group.variants.includes(raw)) continue;
    group.variants.push(raw);
    // Представитель — написание без лишних пробелов, если оно есть.
    if (group.value === null && raw === label) {
      group.value = raw;
      group.label = label;
    }
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => Object.freeze({
      key,
      label: group.label,
      value: group.value ?? group.variants[0],
      variants: Object.freeze([...group.variants]),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

/** Группа, в которую входит выбранное написание; null — такого написания в списке нет. */
export function salesLabelGroupOf(groups: readonly SalesLabelGroup[], value: string | null | undefined): SalesLabelGroup | null {
  if (!value) return null;
  return groups.find((group) => group.variants.includes(value)) ?? null;
}

export type SalesRowReview =
  | Readonly<{ state: "archived" }>
  | Readonly<{ state: "checked" }>
  | Readonly<{ state: "review"; reasons: readonly string[] }>;

/**
 * «Уточнить» строки: причины — только то, чего не хватает в самой записи;
 * если запись отмечена «Нужно уточнить», а в полях всё есть, причина не
 * придумывается — «причина не записана».
 */
export function salesRowReview(row: SalesRegisterRow): SalesRowReview {
  if (row.archived) return { state: "archived" };
  if (!row.needsReview) return { state: "checked" };
  const reasons: string[] = [];
  if (row.signingDate === null) reasons.push("нет даты продажи");
  if (row.serviceCostMinor === null) reasons.push(row.serviceCostRaw.trim() ? "стоимость не разобрана" : "нет стоимости");
  if (row.paidMinor === null && row.paidRaw.trim()) reasons.push("оплата не разобрана");
  if (row.serviceCostCurrency && row.paidCurrency && row.serviceCostCurrency !== row.paidCurrency) reasons.push("оплата в другой валюте");
  if (!row.managerLabel.trim()) reasons.push("нет менеджера");
  return { state: "review", reasons: reasons.length ? reasons : ["причина не записана"] };
}

/**
 * Почему у записи нет остатка; null — остаток считается. Пустая оплата —
 * «неизвестна» (подсказка формы: «Если сумма неизвестна, оставьте сумму и
 * валюту пустыми»; сервер считает её неуточнённой), а не ноль. Запись в
 * архиве в рабочие итоги не входит — и остатка у неё нет.
 */
export type SalesNoRemainderReason = "archived" | "no_cost" | "paid_unclear" | "paid_missing" | "other_currency";

export function salesRowNoRemainder(row: SalesRegisterRow): SalesNoRemainderReason | null {
  if (row.archived) return "archived";
  if (row.serviceCostMinor === null || row.serviceCostCurrency === null) return "no_cost";
  if (row.paidMinor === null) return row.paidRaw.trim() ? "paid_unclear" : "paid_missing";
  if (row.paidCurrency !== row.serviceCostCurrency) return "other_currency";
  return null;
}

export const SALES_NO_REMAINDER_TEXT: Readonly<Record<SalesNoRemainderReason, string>> = {
  archived: "в архиве",
  no_cost: "нет стоимости",
  paid_unclear: "оплата не разобрана",
  paid_missing: "оплата не указана",
  other_currency: "оплата в другой валюте",
};

/**
 * Остаток записи в её валюте: стоимость минус указанная оплата (оплата 0 —
 * тоже указанная). Нет стоимости, оплата не указана или не разобрана, в
 * другой валюте, запись в архиве — остатка нет (null): неизвестное не
 * считается нулём, валюты не пересчитываются.
 */
export function salesRowRemainder(row: SalesRegisterRow): number | null {
  if (salesRowNoRemainder(row) !== null) return null;
  return row.serviceCostMinor! - row.paidMinor!;
}

export type SalesMoneyLine = Readonly<{ currency: string; costMinor: number; paidMinor: number; remainderMinor: number; count: number }>;
export type SalesCrossCurrency = Readonly<{ costCurrency: string; paidCurrency: string; costMinor: number; paidMinor: number; count: number }>;
export type SalesMoneySummary = Readonly<{
  /** По валюте стоимости: записи, где оплата в той же валюте или её нет. */
  lines: readonly SalesMoneyLine[];
  /** Оплата в другой валюте — отдельно, по паре валют. */
  cross: readonly SalesCrossCurrency[];
  /** Без суммы стоимости. */
  noCost: number;
  /** Сумма оплаты не разобрана. */
  paidUnclear: number;
  /** Оплата не указана (неизвестна): не ноль, в суммы не входит. */
  paidMissing: number;
}>;

/**
 * Суммы по валютам — только из записей рабочего отчёта (не архива): строка
 * валюты — записи с указанными стоимостью и оплатой в одной валюте, поэтому
 * «Стоимость − Оплачено = Остаток»; оплата в другой валюте — парой без
 * остатка; без стоимости, с неразобранной или неуказанной оплатой — не
 * входят и названы числом.
 */
export function salesMoneySummary(rows: readonly SalesRegisterRow[]): SalesMoneySummary {
  const lines = new Map<string, { costMinor: number; paidMinor: number; remainderMinor: number; count: number }>();
  const cross = new Map<string, { costCurrency: string; paidCurrency: string; costMinor: number; paidMinor: number; count: number }>();
  let noCost = 0;
  let paidUnclear = 0;
  let paidMissing = 0;
  for (const row of rows) {
    const why = salesRowNoRemainder(row);
    if (why === "archived") continue;
    if (why === "no_cost") { noCost += 1; continue; }
    if (why === "paid_unclear") { paidUnclear += 1; continue; }
    if (why === "paid_missing") { paidMissing += 1; continue; }
    const costCurrency = row.serviceCostCurrency!;
    const costMinor = row.serviceCostMinor!;
    const paidMinor = row.paidMinor!;
    if (why === "other_currency") {
      const paidCurrency = row.paidCurrency ?? "";
      const key = `${costCurrency}>${paidCurrency}`;
      const pair = cross.get(key) ?? { costCurrency, paidCurrency, costMinor: 0, paidMinor: 0, count: 0 };
      pair.costMinor += costMinor;
      pair.paidMinor += paidMinor;
      pair.count += 1;
      cross.set(key, pair);
      continue;
    }
    const line = lines.get(costCurrency) ?? { costMinor: 0, paidMinor: 0, remainderMinor: 0, count: 0 };
    line.costMinor += costMinor;
    line.paidMinor += paidMinor;
    line.remainderMinor += costMinor - paidMinor;
    line.count += 1;
    lines.set(costCurrency, line);
  }
  return Object.freeze({
    lines: Object.freeze([...lines.entries()].map(([currency, line]) => Object.freeze({ currency, ...line }))
      .sort((a, b) => a.currency.localeCompare(b.currency))),
    cross: Object.freeze([...cross.values()].map((pair) => Object.freeze({ ...pair }))
      .sort((a, b) => `${a.costCurrency}${a.paidCurrency}`.localeCompare(`${b.costCurrency}${b.paidCurrency}`))),
    noCost,
    paidUnclear,
    paidMissing,
  });
}

/**
 * На чём стоят суммы: записи выборки по месяцу (или году) отчёта — не то же,
 * что «N продаж» заголовка (по дате продажи). Сколько из них без даты продажи
 * и сколько с датой продажи вне периода — чтобы два числа рядом не спорили.
 */
export function salesSummaryBasis(
  rows: readonly Pick<SalesRegisterRow, "signingDate">[],
  period: Readonly<{ year: number; month: number | undefined }>,
): Readonly<{ total: number; undated: number; otherSaleDate: number }> {
  const prefix = period.month === undefined ? `${period.year}-` : `${period.year}-${String(period.month).padStart(2, "0")}-`;
  let undated = 0;
  let otherSaleDate = 0;
  for (const row of rows) {
    if (row.signingDate === null) undated += 1;
    else if (!row.signingDate.startsWith(prefix)) otherSaleDate += 1;
  }
  return { total: rows.length, undated, otherSaleDate };
}

/** «по 1 записи», «по 9 записям», «по 21 записи». */
export function recordsDative(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? "записи" : "записям";
}

/** Сколько записей по выборке сервер отдаёт страницей; остаток читает все страницы до этого предела. */
export const SALES_PAGE_SIZE = 50;
export const SALES_SUMMARY_MAX_PAGES = 10;

/** Соседние периоды переключателя: месяц — на месяц, «весь год» — на год. */
export function salesPeriodSteps(year: number, month: number | undefined): Readonly<{
  previous: Readonly<{ year: number; month: number | undefined }>;
  next: Readonly<{ year: number; month: number | undefined }>;
}> {
  if (month === undefined) return { previous: { year: year - 1, month }, next: { year: year + 1, month } };
  return {
    previous: month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 },
    next: month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 },
  };
}

/** «5 продаж», «1 продажа», «3 продажи». */
export function salesWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  return tens >= 11 && tens <= 14 ? "продаж" : ones === 1 ? "продажа" : ones >= 2 && ones <= 4 ? "продажи" : "продаж";
}

/** «1 запись», «3 записи», «5 записей». */
export function recordsWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  return tens >= 11 && tens <= 14 ? "записей" : ones === 1 ? "запись" : ones >= 2 && ones <= 4 ? "записи" : "записей";
}
