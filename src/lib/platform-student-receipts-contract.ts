// Клиентски безопасный разбор «Чеков на проверке» и реквизитов для оплаты в CRM (миграция 358).
// Тот же приём и стиль, что у platform-case-agreement-contract.ts: строгий разбор, любое отклонение формы - исключение.
import { parseSalesDate, parseSalesUuid } from "./platform-sales-register-contract.ts";

export type StudentReceiptStatus = "pending" | "accepted" | "rejected";

export type StudentReceiptDue = Readonly<{
  id: string;
  label: string;
  currency: string;
  outstandingMinor: string;
}>;

export type StudentReceipt = Readonly<{
  id: string;
  studentCaseId: string;
  studentDisplayName: string;
  /** Платёж, который указал студент (может быть пусто: тогда платёж выберет сотрудник). */
  paymentObligationId: string | null;
  paymentLabel: string | null;
  amountMinor: string;
  currency: string;
  paidOn: string;
  originalFilename: string;
  submittedAt: string;
  status: StudentReceiptStatus;
  rejectReason: string | null;
  reviewedAt: string | null;
  canReview: boolean;
  /** Платежи дела с остатком: из них сотрудник выбирает платёж для чека. */
  dues: readonly StudentReceiptDue[];
}>;

export type StudentReceiptQueue = Readonly<{
  organizationId: string;
  total: number;
  receipts: readonly StudentReceipt[];
}>;

export type PaymentDetailsAdmin = Readonly<{
  organizationId: string;
  versionNo: number;
  text: string;
  hasQr: boolean;
  qrFilename: string | null;
  updatedAt: string | null;
  updatedByDisplayName: string | null;
}>;

export type StudentReceiptActionStatus = "idle" | "saved" | "invalid" | "forbidden" | "not_pending" | "obligation_required" | "request_conflict" | "unavailable";
export type StudentReceiptActionState = Readonly<{ status: StudentReceiptActionStatus; requestId: string; message: string | null }>;

function fail(): never {
  throw new Error("Student receipts are unavailable.");
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : fail();
}
/** Для показа: усечение по символам без падения страницы; не строка - чужая форма. */
function text(value: unknown, max = 1000): string {
  if (typeof value !== "string") return fail();
  const points = Array.from(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""));
  return points.length > max ? points.slice(0, max).join("") : points.join("");
}
function optionalText(value: unknown, max = 1000): string | null {
  return value === null ? null : text(value, max);
}
function id(value: unknown): string {
  return parseSalesUuid(value) ?? fail();
}
function integer(value: unknown): string {
  const result = text(value, 40);
  return /^\d+$/.test(result) ? result : fail();
}
function currency(value: unknown): string {
  const result = text(value, 3);
  return /^[A-Z]{3}$/.test(result) ? result : fail();
}
function time(value: unknown): string {
  const result = text(value, 40);
  return Number.isFinite(Date.parse(result)) ? result : fail();
}
function day(value: unknown): string {
  const result = text(value, 10);
  return parseSalesDate(result) ? result : fail();
}
function list(value: unknown, max: number): unknown[] {
  return Array.isArray(value) && value.length <= max ? value : fail();
}

export function parseStudentReceiptQueue(value: unknown, organizationId: string): StudentReceiptQueue {
  const row = record(value);
  if (row.organization_id !== organizationId) fail();
  const total = row.total;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) fail();
  const receipts = list(row.receipts, 200).map((raw): StudentReceipt => {
    const r = record(raw);
    const status = r.status;
    if (status !== "pending" && status !== "accepted" && status !== "rejected") fail();
    if (typeof r.can_review !== "boolean") fail();
    return {
      id: id(r.receipt_id),
      studentCaseId: id(r.student_case_id),
      studentDisplayName: text(r.student_display_name, 300),
      paymentObligationId: r.payment_obligation_id === null ? null : id(r.payment_obligation_id),
      paymentLabel: optionalText(r.payment_label, 500),
      amountMinor: integer(r.amount_minor),
      currency: currency(r.currency),
      paidOn: day(r.paid_on),
      originalFilename: text(r.original_filename, 512),
      submittedAt: time(r.submitted_at),
      status,
      rejectReason: optionalText(r.reject_reason, 1000),
      reviewedAt: r.reviewed_at === null ? null : time(r.reviewed_at),
      canReview: r.can_review,
      dues: list(r.dues, 500).map((rawDue): StudentReceiptDue => {
        const d = record(rawDue);
        return { id: id(d.payment_obligation_id), label: text(d.label, 500), currency: currency(d.currency), outstandingMinor: integer(d.outstanding_minor) };
      }),
    };
  });
  if (new Set(receipts.map((receipt) => receipt.id)).size !== receipts.length) fail();
  return { organizationId, total, receipts };
}

export function parsePaymentDetailsAdmin(value: unknown, organizationId: string): PaymentDetailsAdmin {
  const row = record(value);
  if (row.organization_id !== organizationId) fail();
  const version = row.version_no;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) fail();
  if (typeof row.has_qr !== "boolean") fail();
  return {
    organizationId,
    versionNo: version,
    text: text(row.text, 4000),
    hasQr: row.has_qr,
    qrFilename: optionalText(row.qr_filename, 255),
    updatedAt: row.updated_at === null ? null : time(row.updated_at),
    updatedByDisplayName: optionalText(row.updated_by_display_name, 300),
  };
}
