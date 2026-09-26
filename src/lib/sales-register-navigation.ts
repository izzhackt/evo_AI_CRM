import { parseSalesRegisterDirection } from "./sales-register-directions.ts";
import { parseSalesRegisterSearchQuery } from "./sales-register-search.ts";

export type SalesReportQuery = Readonly<{
  year?: string; month?: string; offset?: string; record?: string; new?: string; archived?: string;
  manager?: string; direction?: string; review?: string; saved?: string; edit?: string; q?: string; mode?: string;
}>;

const REPORT_KEYS = ["year", "month", "offset", "q", "manager", "direction", "review", "archived"] as const;

/** Explicit record/editor/result destinations retain the existing report route. */
export function isSalesImportQuery(query: Readonly<Record<string, unknown>>): boolean {
  return query.mode === "import" && ["record", "new", "edit", "saved"].every(key => query[key] === undefined);
}

/** The caller supplies the current organization period; navigation never chooses another clock. */
export function salesReportContext(query: Readonly<Record<string, unknown>>, current: Readonly<{ year: number; month: number }>) {
  const year = query.year === undefined ? current.year : typeof query.year === "string" ? Number(query.year) : NaN;
  const month = query.month === undefined ? current.month : query.month === "all" ? undefined
    : typeof query.month === "string" ? Number(query.month) : NaN;
  const offset = query.offset === undefined ? 0 : typeof query.offset === "string" ? Number(query.offset) : NaN;
  const searchQuery = parseSalesRegisterSearchQuery(query.q);
  const valid = REPORT_KEYS.every(key => query[key] === undefined || typeof query[key] === "string")
    && searchQuery !== null && Number.isInteger(year) && year >= 1900 && year <= 2100
    && (query.year === undefined || (typeof query.year === "string" && /^\d{4}$/.test(query.year)))
    && (month === undefined || (Number.isInteger(month) && month >= 1 && month <= 12))
    && Number.isInteger(offset) && offset >= 0 && offset <= 1_000_000
    && (query.manager === undefined || (typeof query.manager === "string" && query.manager.length <= 300))
    && parseSalesRegisterDirection(query.direction) !== null
    && (query.review === undefined || (typeof query.review === "string" && ["", "true", "false"].includes(query.review)));

  const params = new URLSearchParams({ view: "sales", year: String(year), month: month ? String(month) : "all" });
  const clearFiltersHref = `/v3/main?${params.toString()}`;
  if (searchQuery) params.set("q", searchQuery);
  if (query.archived === "true") params.set("archived", "true");
  for (const key of ["manager", "direction", "review"] as const) {
    if (typeof query[key] === "string" && query[key]) params.set(key, query[key]);
  }
  if (valid && offset > 0) params.set("offset", String(offset));

  // Invalid values stay visible when returning to the report for correction.
  // Only single strings from this allowlist can enter a link; never returnTo/host.
  if (!valid) {
    for (const key of REPORT_KEYS) {
      if (typeof query[key] === "string") params.set(key, query[key]);
      else if (query[key] !== undefined) params.delete(key);
    }
  }
  const href = (extra: Readonly<Record<string, string>> = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(extra)) next.set(key, value);
    return `/v3/main?${next.toString()}`;
  };
  return {
    valid, year, month, offset, searchQuery, params, href, clearFiltersHref,
    reportHref: href(), importHref: href({ mode: "import" }),
    reportMonth: `${year}-${String(month ?? current.month).padStart(2, "0")}-01`,
  };
}

/** Якорь раздела «Динамика по дням» внизу отчёта. */
export const SALES_DYNAMICS_ANCHOR = "sales-dynamics";

/**
 * Параметры отчёта, которые раздел «Динамика по дням» несёт в своих ссылках
 * периода и форме диапазона: выбор периода не сбрасывает месяц, фильтры и
 * страницу отчёта. Только одиночные строки из списка ключей отчёта.
 */
export function salesDynamicsCarry(query: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  const carry: Record<string, string> = { view: "sales" };
  for (const key of REPORT_KEYS) {
    const value = query[key];
    if (typeof value === "string" && value !== "") carry[key] = value;
  }
  return carry;
}

/** Ссылка периода раздела: `/v3/main?view=sales&…&period=week#sales-dynamics`. */
export function salesDynamicsHref(
  query: Readonly<Record<string, unknown>>,
  period: Readonly<{ key: string; from?: string; to?: string }>,
): string {
  const params = new URLSearchParams(salesDynamicsCarry(query));
  params.set("period", period.key);
  if (period.key === "custom" && period.from && period.to) {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  return `/v3/main?${params.toString()}#${SALES_DYNAMICS_ANCHOR}`;
}
