// «Чек к уже принятой оплате» (миграция 360): путь загрузки и разбор ответа. Чистый модуль, как `payment-center.ts`: ни next, ни DOM, ни React.
// Ответ маршрута разбирается строго: чужая форма - `null`, и страница просто просит обновить данные, а не показывает чужой текст.
export const PAYMENT_PROOF_UPLOAD_PATH = "/api/portal/payment-proofs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export type PaymentProofResult = Readonly<{ fileId: string; filename: string }>;

/** Ответ `POST /api/portal/payment-proofs` (200 или 201): ровно `payment_receipt_file_id` и `original_filename`. */
export function parsePaymentProofResult(value: unknown): PaymentProofResult | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== 2 || !Object.hasOwn(row, "payment_receipt_file_id") || !Object.hasOwn(row, "original_filename")) return null;
  const fileId = row.payment_receipt_file_id;
  const name = row.original_filename;
  if (typeof fileId !== "string" || !UUID.test(fileId) || typeof name !== "string") return null;
  const clean = Array.from(name.replace(CONTROL, "")).slice(0, 255).join("").trim();
  return Object.freeze({ fileId, filename: clean === "" ? "file" : clean });
}

/** Ссылка на файл оплаты для самого студента: тот же маршрут, что у чека в строке («receipt» - файл, привязанный к оплате). */
export function paymentProofFileHref(fileId: string): string {
  return `/api/portal/case-files/receipt/${encodeURIComponent(fileId)}/download`;
}
