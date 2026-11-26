import { financeMoney } from "./platform-finance-entry-contract.ts";

/**
 * Сумма и название записанного платежа у события «История» дела (`payment_detail`, миграция 376): только у
 * `finance.payment.record`. Сумма — в минимальных единицах, как во всех чтениях денег; название — обязательства
 * («Второй платёж»), `null`, если его нет или оно не прошло проверку текста.
 */
export type CasePaymentDetail = Readonly<{
  amountMinor: string;
  currency: string;
  kind: "payment" | "refund";
  label: string | null;
}>;

/** Разбор поля `payment_detail`; что-то не так — `null` (строка остаётся «Платёж записан»). */
export function parseCasePaymentDetail(value: unknown): CasePaymentDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const amount = row.amount_minor;
  if (!(typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0) && !(typeof amount === "string" && /^\d{1,18}$/u.test(amount))) return null;
  if (typeof row.currency !== "string" || !/^[A-Z]{3}$/u.test(row.currency)) return null;
  if (row.kind !== "payment" && row.kind !== "refund") return null;
  const label = typeof row.label === "string" && row.label.trim() !== "" && row.label.length <= 500 ? row.label.trim() : null;
  return Object.freeze({ amountMinor: String(amount), currency: row.currency, kind: row.kind, label });
}

/** «Записана оплата 500 USD · Второй платёж», «Записан возврат 120,50 USD». */
export function casePaymentLine(detail: CasePaymentDetail): string {
  const amount = financeMoney(detail.amountMinor, detail.currency).replace(/,00(?= [A-Z]{3}$)/u, "");
  return `${detail.kind === "refund" ? "Записан возврат" : "Записана оплата"} ${amount}${detail.label ? ` · ${detail.label}` : ""}`;
}
