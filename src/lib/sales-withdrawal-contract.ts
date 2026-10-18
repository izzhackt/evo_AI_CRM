/**
 * «Убрать» / «Вернуть» в «Отчёте продаж» (миграция 307, слова владельца 18.10): итог
 * команды `set_sales_register_withdrawal_v1` для формы и разбор её квитанции точными
 * ключами — той же, что у `manage_sales_register_v2` и `link_sales_record_lead_v1`
 * (organization_id / record_id / version / operation / request_id).
 */
import { parseSalesInteger } from "./platform-sales-register-contract.ts";

export type SalesWithdrawalActionState = Readonly<{
  status: "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "archived" | "unavailable";
  requestId: string; recordId: string | null;
  /** Что именно сохранено (только при `saved`): по нему читалка получает «убрана» или «возвращена». */
  operation: "withdraw" | "withdraw_undo" | null;
}>;

export function parseSalesWithdrawalReceipt(raw: unknown, expected: Readonly<{
  organizationId: string; recordId: string; requestId: string; expectedVersion: number; operation: "withdraw" | "withdraw_undo";
}>): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).length !== 5 || r.organization_id !== expected.organizationId || r.record_id !== expected.recordId
    || r.operation !== expected.operation || r.request_id !== expected.requestId) return null;
  const version = parseSalesInteger(r.version);
  return version === expected.expectedVersion + 1 ? version : null;
}

/** Заметка к отказу: одна строка до 500 символов, без служебных символов; пустая — нет заметки (`""`). */
export function parseSalesWithdrawalNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const note = value.trim();
  return [...note].length <= 500 && !/[\u0000-\u001f\u007f]/u.test(note) ? note : null;
}
