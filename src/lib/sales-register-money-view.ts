import type { SalesRegisterWorkspace } from "@/lib/platform-sales-register-contract";
import { SALES_PAGE_SIZE, SALES_SUMMARY_MAX_PAGES, recordsDative, recordsWord, type SalesMoneySummary } from "@/lib/sales-register-view";

/**
 * Слова и строки «Сумм по записям» «Отчёта продаж» — общие у прежнего вида (`MoneySummary`) и «Нового вида»: подпись с основой сумм,
 * сноска (что не вошло и почему остатка нет), строки по валютам. Чистая функция: правила текста в одном месте. Вынесена из
 * `SalesRegisterView.tsx` без изменений.
 */
export type SalesMoneyBasis = Readonly<{ total: number; undated: number; otherSaleDate: number }>;
export type SalesMoneyRow = Readonly<{ currency: string; cost: number; paid: number; rest: number | null }>;

export function salesMoneyParts({ workspace, summary, basis, reason, filtered, yearOnly, filedElsewhere, total }: Readonly<{
  workspace: SalesRegisterWorkspace;
  summary: SalesMoneySummary | null;
  basis: SalesMoneyBasis | null;
  reason: "too_many" | "unavailable" | null;
  filtered: boolean;
  yearOnly: boolean;
  /** Срез `sale=filed_elsewhere`: продажи периода, записанные в другой месяц отчёта. */
  filedElsewhere: boolean;
  total: number;
}>): Readonly<{ caption: string; footnote: string; lines: readonly SalesMoneyRow[] }> {
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
  // Пары валют названы в строках таблицы («USD → KGS», число записей — подсказкой и для чтения с экрана):
  // сноска говорит правило один раз, а не пересказывает каждую строку.
  const cross = summary && summary.cross.length > 0
    ? "Остаток не считается, если оплата в другой валюте и нет суммы в валюте договора."
    : null;
  const footnote = [
    cross,
    summary ? null : reason === "too_many"
      ? `Остаток не посчитан: в выборке больше ${SALES_PAGE_SIZE * SALES_SUMMARY_MAX_PAGES} записей — сузьте период или фильтры.`
      : "Остаток не посчитан: не удалось прочитать все записи выборки — обновите страницу.",
    unresolved,
    left ? `Не вошли: ${left}.` : null,
    "Валюты не пересчитываются; это записи отчёта, не поступления за месяц.",
  ].filter(Boolean).join(" ");
  const lines: SalesMoneyRow[] = summary ? summary.lines.map((line) => ({ currency: line.currency, cost: line.costMinor, paid: line.paidMinor, rest: line.remainderMinor as number | null }))
    : workspace.totals.map((line) => ({ currency: line.currency, cost: line.costMinor, paid: line.paidMinor, rest: null }));
  return { caption, footnote, lines };
}
