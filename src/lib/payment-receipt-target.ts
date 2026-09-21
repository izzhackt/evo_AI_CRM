/** Closed server-RPC projections; no authority is inferred from successful decoding. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)) ? row : null;
}
function id(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
export function decodeReceiptUploadTarget(value: unknown, organizationId: string, paymentEventId: string) {
  const row = record(value, ["organization_id", "student_case_id", "payment_event_id"]);
  if (!row || !id(row.organization_id) || !id(row.student_case_id) || !id(row.payment_event_id)
    || row.organization_id !== organizationId || row.payment_event_id !== paymentEventId) return null;
  return { organizationId: row.organization_id, studentCaseId: row.student_case_id, paymentEventId: row.payment_event_id };
}
export function decodeReceiptDownloadTarget(value: unknown, organizationId: string, studentCaseId: string, fileId: string) {
  const row = record(value, ["organization_id", "student_case_id", "payment_receipt_file_id", "storage_object_name"]);
  if (!row || !id(row.organization_id) || !id(row.student_case_id) || !id(row.payment_receipt_file_id)
    || row.organization_id !== organizationId || row.student_case_id !== studentCaseId || row.payment_receipt_file_id !== fileId
    || typeof row.storage_object_name !== "string" || row.storage_object_name.length > 512) return null;
  const prefix = `payment-receipts/${organizationId}/${studentCaseId}/`;
  if (!row.storage_object_name.startsWith(prefix) || !id(row.storage_object_name.slice(prefix.length))) return null;
  return { storageObjectName: row.storage_object_name };
}
export function receiptTargetErrorStatus(error: { code?: string } | null): 403 | 503 {
  return error?.code === "42501" ? 403 : 503;
}
