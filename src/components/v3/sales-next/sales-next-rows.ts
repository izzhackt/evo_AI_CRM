import type { SalesRegisterRow } from "@/lib/platform-sales-register-contract";
import {
  SALES_NO_REMAINDER_TEXT, SALES_STATUS_MISSING_TEXT, salesDayParts, salesReportMonth, salesRowContractPaid, salesRowNoRemainder, salesRowRemainder,
  salesRowReview, salesWithdrawalTone,
} from "@/lib/sales-register-view";
import { salesWithdrawalWord } from "@/lib/v3/wording";

import type { SalesRowData } from "./sales-next-types";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
/** «120 000 KGS»; нет суммы или валюты — null (в ячейке «—»). */
export const salesMoney = (minor: number | null, currency: string | null): string | null => (minor === null || !currency ? null : `${number.format(minor / 100)} ${currency}`);
export const salesTidy = (value: string): string => value.trim().replace(/\s+/gu, " ");

/**
 * Строка таблицы «Отчёта продаж» нового вида — те же слова и правила, что у строки прежнего вида (`SaleRow`): сумма в валюте договора
 * у оплаты в другой валюте, остаток или причина, почему его нет, «Уточнить: …» словами сервера, отказ (307) словом и тоном.
 */
export function salesRowData(row: SalesRegisterRow, ctx: Readonly<{
  year: number;
  href: string;
  manager: string;
  showReportMonth: boolean;
  /** Идентификатор запроса «Убрать» / «Вернуть» — его выдаёт сервер страницы; null — действия нет. */
  actionRequestId: string | null;
}>): SalesRowData {
  const review = salesRowReview(row);
  const cost = salesMoney(row.serviceCostMinor, row.serviceCostCurrency);
  const paid = salesMoney(row.paidMinor, row.paidCurrency);
  const contractMinor = salesRowContractPaid(row);
  const contract = contractMinor === null ? null : salesMoney(contractMinor, row.serviceCostCurrency);
  const remainderMinor = salesRowRemainder(row);
  const remainder = remainderMinor === null ? null : salesMoney(remainderMinor, row.serviceCostCurrency);
  const noRemainder = salesRowNoRemainder(row);
  const why = noRemainder === null ? null : SALES_NO_REMAINDER_TEXT[noRemainder];
  const day = row.signingDate ? salesDayParts(row.signingDate, ctx.year) : null;
  const word = row.withdrawal ? salesWithdrawalWord(row.withdrawal.kind) : null;
  return {
    id: row.id,
    href: ctx.href,
    name: row.applicantName || "Имя не указано",
    place: [row.country, row.program].map(salesTidy).filter(Boolean).join(" · "),
    manager: ctx.manager,
    signingDate: row.signingDate,
    dateDay: day?.day ?? null,
    dateYear: day?.year ?? null,
    reportMonth: ctx.showReportMonth ? salesReportMonth(row.reportMonth) : null,
    cost,
    costMinor: row.serviceCostMinor,
    paid,
    paidTitle: paid && contract ? `${paid}; в валюте договора ${contract}` : paid,
    paidMinor: row.paidMinor,
    remainder,
    remainderTitle: why ?? (remainder && contract ? `${remainder}: стоимость ${cost} − оплачено в валюте договора ${contract}` : remainder),
    noRemainder: why,
    reviewText: review.state === "review" ? review.reasons.join(", ") : review.state === "checked" ? "Сверено" : review.state === "status_missing" ? SALES_STATUS_MISSING_TEXT : "В архиве",
    reviewTone: review.state === "review" ? "review" : "quiet",
    refusal: row.withdrawal && word ? { word, tone: salesWithdrawalTone(row.withdrawal.kind) } : null,
    action: ctx.actionRequestId ? { version: row.version, withdrawn: row.withdrawal !== null, requestId: ctx.actionRequestId } : null,
  };
}
