// «Чеки, ждущие оплату» (миграция 349): закрытый разбор ответа staff_case_pending_receipts_v1. Без ввода-вывода.
// Принятый в разборе документов «Чек об оплате» лежит здесь, пока финансы не привяжут его к оплате дела.
import { parseSalesUuid } from "./platform-sales-register-contract.ts";

export type PendingReceipt = Readonly<{ id: string; originalFilename: string; queuedAt: string }>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parsePendingReceipts(value: unknown, organizationId: string, studentCaseId: string): readonly PendingReceipt[] {
  if (!record(value) || !exact(value, ["organization_id", "student_case_id", "receipts"])
    || value.organization_id !== organizationId || value.student_case_id !== studentCaseId || !Array.isArray(value.receipts)) {
    throw new Error("Invalid pending receipts");
  }
  return Object.freeze(value.receipts.map((item): PendingReceipt => {
    if (!record(item) || !exact(item, ["pending_receipt_id", "original_filename", "queued_at"])) throw new Error("Invalid pending receipt");
    const id = parseSalesUuid(item.pending_receipt_id);
    if (!id || typeof item.original_filename !== "string" || item.original_filename.trim() === ""
      || typeof item.queued_at !== "string" || Number.isNaN(Date.parse(item.queued_at))) throw new Error("Invalid pending receipt");
    return Object.freeze({ id, originalFilename: item.original_filename, queuedAt: item.queued_at });
  }));
}

export type AllocateReceiptOutcome = "saved" | "invalid" | "forbidden" | "already_allocated" | "unavailable";
