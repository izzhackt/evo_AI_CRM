import type { SalesRegisterWorkspace } from "@/lib/platform-sales-register-contract";
import type { MonthlyPaymentSummaryRead } from "@/lib/platform-finance-entry-contract";
import { financeMoney } from "@/lib/platform-finance-entry-contract";
import type { SalesCountRead } from "@/lib/sales-numbers-contract";
import { salesMoneyParts, type SalesMoneyBasis } from "@/lib/sales-register-money-view";
import { recordsWord, type SalesMoneySummary } from "@/lib/sales-register-view";
import type { SalesSaleSlice } from "@/lib/sales-register-navigation";

import { salesMoney } from "./sales-next-rows";
import type { SalesCashData, SalesHeadlineData, SalesMoneyData } from "./sales-next-types";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const records = (count: number) => `${count.toLocaleString("ru-RU")} ${recordsWord(count)}`;

/**
 * «Продажи» периода (Э2) — число по одному определению, план (Э4), и слова о том, что в число не входит и где это смотреть
 * (`sale=<срез>`): те же тексты, что у прежнего заголовка отчёта (`SalesPeriodHeadline`). Роль без чтения отчёта — ничего.
 */
export function salesHeadlineData(read: SalesCountRead, ctx: Readonly<{
  label: string;
  retryHref: string;
  filtered: boolean;
  sliceHref: (slice: SalesSaleSlice) => string;
  target: number | null;
}>): SalesHeadlineData | null {
  if (read.status === "denied") return null;
  if (read.status === "unavailable") return { kind: "error", text: `Не удалось посчитать продажи за ${ctx.label}.`, retryHref: ctx.retryHref };
  const { sales, undated, otherSaleDate, filedElsewhere } = read.count;
  const notIn = [
    undated > 0 ? { text: `без даты продажи — ${records(undated)}`, href: ctx.sliceHref("undated") } : null,
    otherSaleDate > 0 ? { text: `дата продажи в другом месяце — ${records(otherSaleDate)}`, href: ctx.sliceHref("other_sale_date") } : null,
  ].filter((item) => item !== null);
  return {
    kind: "ok",
    sales,
    target: ctx.target,
    basis: `по дате продажи, без архива${ctx.filtered ? " и без фильтров" : ""}`,
    left: ctx.target === null ? null : sales >= ctx.target ? "план выполнен" : `осталось ${(ctx.target - sales).toLocaleString("ru-RU")}`,
    notes: [
      ...(notIn.length > 0 ? [{ lead: "Не входят:", links: notIn }] : []),
      ...(filedElsewhere > 0 ? [{ lead: "Входят из другого месяца отчёта:", links: [{ text: records(filedElsewhere), href: ctx.sliceHref("filed_elsewhere") }] }] : []),
    ],
  };
}

/** «Суммы по записям»: подпись с основой, сноска (что не вошло и почему остатка нет) и строки по валютам — слова те же, что у прежнего вида. */
export function salesMoneyData(args: Readonly<{
  workspace: SalesRegisterWorkspace;
  summary: SalesMoneySummary | null;
  basis: SalesMoneyBasis | null;
  reason: "too_many" | "unavailable" | null;
  filtered: boolean;
  yearOnly: boolean;
  filedElsewhere: boolean;
}>): SalesMoneyData | null {
  const { workspace, summary, basis } = args;
  if (workspace.totalCount === 0) return null;
  const refused = workspace.withdrawn;
  const total = basis?.total ?? workspace.totalCount - refused.count;
  const refusal = refused.count > 0
    ? `Отказ — ${records(refused.count)}${refused.paid.length > 0 ? `; по ним оплачено ${refused.paid.map((line) => salesMoney(line.paidMinor, line.currency)).join(" и ")}` : ""}. В продажи и суммы ниже они не входят.`
    : null;
  const parts = salesMoneyParts({ ...args, total });
  if (total === 0 && refusal) return { caption: "", refusal, lines: [], showRest: false, cross: [], footnote: "" };
  return {
    caption: parts.caption,
    refusal,
    lines: parts.lines.map((line) => ({ currency: line.currency, cost: number.format(line.cost / 100), paid: number.format(line.paid / 100), rest: line.rest === null ? null : number.format(line.rest / 100) })),
    showRest: summary !== null,
    cross: (summary?.cross ?? []).map((pair) => ({
      key: `${pair.costCurrency}>${pair.paidCurrency}`,
      label: `${pair.costCurrency} → ${pair.paidCurrency}`,
      title: `Стоимость в ${pair.costCurrency}, оплата в ${pair.paidCurrency} без суммы в валюте договора — ${records(pair.count)}`,
      sr: `: стоимость в ${pair.costCurrency}, оплата в ${pair.paidCurrency}, ${records(pair.count)}`,
      cost: salesMoney(pair.costMinor, pair.costCurrency),
      paid: salesMoney(pair.paidMinor, pair.paidCurrency),
    })),
    footnote: parts.footnote,
  };
}

/** «В архиве — N записей…»: у архива сумм нет (как на сервере, 247). */
export function salesArchiveText(count: number, yearOnly: boolean, filtered: boolean): string | null {
  if (count === 0) return null;
  return `В архиве — ${records(count)} ${yearOnly ? "года" : "месяца"} отчёта${filtered ? ", с фильтрами" : ""}. Архивные записи не входят в рабочие итоги: суммы и остаток по ним не считаются.`;
}

/** «Поступления и возвраты за месяц»: подтверждённые события всей организации; нет права — блока нет. */
export function salesCashData(cash: MonthlyPaymentSummaryRead | Readonly<{ status: "unavailable" }> | null): SalesCashData | null {
  if (cash === null || cash.status === "not_allowed") return null;
  if (cash.status === "unavailable") return { kind: "unavailable" };
  if (cash.totals.length === 0) return { kind: "empty" };
  return {
    kind: "ok",
    totals: cash.totals.map((total) => ({ currency: total.currency, payments: financeMoney(total.paymentsMinor, total.currency), refunds: financeMoney(total.refundsMinor, total.currency), net: financeMoney(total.netMinor, total.currency) })),
  };
}
