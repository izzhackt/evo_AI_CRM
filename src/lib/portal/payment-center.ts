// «Оплата» студента одним чтением (миграция 358, `platform.student_portal_payment_center_v1`): реквизиты, платежи с историей
// и чеки без платежа. Чистый модуль: его берут и веб, и приложение (страж общих импортов), поэтому здесь нет next, DOM и
// относительных импортов вне src/lib. Форму ответа разбирает строгий разборщик: любое отклонение - `null`, текст данных не
// выходит наружу.
import {
  PLATFORM_OBLIGATION_CATEGORIES,
  PLATFORM_OBLIGATION_STATUSES,
  type PlatformObligationCategory,
  type PlatformObligationStatus,
} from "../platform-case-operations-contract.ts";

export const PAYMENT_RECEIPT_UPLOAD_PATH = "/api/portal/payment-receipts";
/** Предел файла (как у чеков сотрудников и документов). */
export const PAYMENT_RECEIPT_MAX_BYTES = 25 * 1024 * 1024;
export const PAYMENT_RECEIPT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

export type PaymentEntryKind = "payment" | "refund" | "receipt";
export type PaymentEntryStatus = "accepted" | "review" | "rejected";
/** `receipt` - файл, привязанный к оплате; `student_receipt` - ещё не принятый или отклонённый чек студента. */
export type PaymentEntryFileKind = "receipt" | "student_receipt";

export type PaymentEntry = Readonly<{
  kind: PaymentEntryKind;
  entryId: string;
  status: PaymentEntryStatus;
  amountMinor: number;
  currency: string;
  /** День по Бишкеку, `YYYY-MM-DD`. */
  onDate: string;
  rejectReason: string | null;
  fileKind: PaymentEntryFileKind | null;
  fileId: string | null;
  filename: string | null;
}>;

/** Те же поля, что у `StudentPortalPayment` (веб и приложение), плюс идентификатор платежа и история. */
export type PaymentDue = Readonly<{
  obligationId: string;
  label: string;
  category: PlatformObligationCategory;
  amountMinor: number;
  paidMinor: number;
  refundedMinor: number;
  outstandingMinor: number;
  currency: string;
  dueAt: string | null;
  status: PlatformObligationStatus;
  overdue: boolean;
  nextAction: string | null;
  entries: readonly PaymentEntry[];
}>;

export type PaymentDetails = Readonly<{
  text: string;
  hasQr: boolean;
  /** Идентификатор версии: по нему скачивается QR (`payment_details_qr`). */
  qrId: string | null;
  updatedAt: string;
}>;

export type PaymentCenter = Readonly<{
  details: PaymentDetails | null;
  dues: readonly PaymentDue[];
  /** Чеки без платежа (на проверке или отклонённые). */
  unassigned: readonly PaymentEntry[];
  canUpload: boolean;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const STATUSES: readonly PaymentEntryStatus[] = ["accepted", "review", "rejected"];
const KINDS: readonly PaymentEntryKind[] = ["payment", "refund", "receipt"];
const FILE_KINDS: readonly PaymentEntryFileKind[] = ["receipt", "student_receipt"];

class Mismatch extends Error {}
const fail = (): never => {
  throw new Mismatch("payment center shape");
};
const record = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  const present = Object.keys(row);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(row, key)) ? row : fail();
};
const uuid = (value: unknown): string => (typeof value === "string" && UUID.test(value) ? value : fail());
const optionalUuid = (value: unknown): string | null => (value === null ? null : uuid(value));
/**
 * Текст для показа: управляющие знаки убираются, слишком длинное усекается по символам (не по байтам). Страница студента не должна
 * ломаться целиком из-за одного странного имени файла, подписи платежа или причины отказа; не строка - по-прежнему чужая форма.
 */
const CONTROL_ALL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const text = (value: unknown, max: number): string => {
  if (typeof value !== "string") return fail();
  const clean = value.replace(CONTROL_ALL, "");
  const points = Array.from(clean);
  return points.length > max ? points.slice(0, max).join("") : clean;
};
const optionalText = (value: unknown, max: number): string | null => (value === null ? null : text(value, max));
const money = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail());
const currency = (value: unknown): string => (typeof value === "string" && CURRENCY.test(value) ? value : fail());
const day = (value: unknown): string => (typeof value === "string" && DAY.test(value) && Number.isFinite(Date.parse(value)) ? value : fail());
const timestamp = (value: unknown): string => (typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fail());
const oneOf = <T extends string>(list: readonly T[], value: unknown): T =>
  typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : fail();

function entry(value: unknown): PaymentEntry {
  const row = record(value, ["kind", "entry_id", "status", "amount_minor", "currency", "on_date", "reject_reason", "file_kind", "file_id", "filename"]);
  const fileId = optionalUuid(row.file_id);
  const fileKind = row.file_kind === null ? null : oneOf(FILE_KINDS, row.file_kind);
  const rawFilename = optionalText(row.filename, 255);
  if ((fileId === null) !== (fileKind === null) || (fileId === null) !== (rawFilename === null)) fail();
  const filename = rawFilename === null ? null : rawFilename.trim() === "" ? "file" : rawFilename;
  const status = oneOf(STATUSES, row.status);
  const reasonText = optionalText(row.reject_reason, 1000);
  const rejectReason = reasonText !== null && reasonText.trim() === "" ? "—" : reasonText;
  if ((status === "rejected") !== (rejectReason !== null)) fail();
  const amountMinor = money(row.amount_minor);
  if (amountMinor < 1) fail();
  return Object.freeze({
    kind: oneOf(KINDS, row.kind),
    entryId: uuid(row.entry_id),
    status,
    amountMinor,
    currency: currency(row.currency),
    onDate: day(row.on_date),
    rejectReason,
    fileKind,
    fileId,
    filename,
  });
}

function due(value: unknown): PaymentDue {
  const row = record(value, [
    "obligation_id", "label", "category", "amount_minor", "paid_minor", "refunded_minor", "outstanding_minor", "currency", "due_at",
    "derived_status", "overdue", "next_action", "entries",
  ]);
  const amountMinor = money(row.amount_minor);
  const paidMinor = money(row.paid_minor);
  const refundedMinor = money(row.refunded_minor);
  const outstandingMinor = money(row.outstanding_minor);
  if (amountMinor < 1 || refundedMinor > paidMinor || outstandingMinor !== amountMinor - paidMinor + refundedMinor || typeof row.overdue !== "boolean") fail();
  if (!Array.isArray(row.entries) || row.entries.length > 500) fail();
  return Object.freeze({
    obligationId: uuid(row.obligation_id),
    label: text(row.label, 300),
    category: oneOf(PLATFORM_OBLIGATION_CATEGORIES, row.category),
    amountMinor,
    paidMinor,
    refundedMinor,
    outstandingMinor,
    currency: currency(row.currency),
    dueAt: row.due_at === null ? null : timestamp(row.due_at),
    status: oneOf(PLATFORM_OBLIGATION_STATUSES, row.derived_status),
    overdue: row.overdue as boolean,
    nextAction: optionalText(row.next_action, 1000),
    entries: Object.freeze((row.entries as unknown[]).map(entry)),
  });
}

function details(value: unknown): PaymentDetails | null {
  if (value === null) return null;
  const row = record(value, ["text", "has_qr", "qr_id", "updated_at"]);
  if (typeof row.has_qr !== "boolean") return fail();
  const qrId = optionalUuid(row.qr_id);
  if (row.has_qr !== (qrId !== null)) fail();
  return Object.freeze({ text: text(row.text, 4000), hasQr: row.has_qr, qrId, updatedAt: timestamp(row.updated_at) });
}

/** Строгий разбор ответа; чужая форма - `null`. */
export function parsePaymentCenter(value: unknown): PaymentCenter | null {
  try {
    const row = record(value, ["details", "dues", "unassigned", "can_upload"]);
    if (!Array.isArray(row.dues) || row.dues.length > 500 || !Array.isArray(row.unassigned) || row.unassigned.length > 500) return fail();
    if (typeof row.can_upload !== "boolean") return fail();
    const dues = row.dues.map(due);
    if (new Set(dues.map((item) => item.obligationId)).size !== dues.length) return fail();
    return Object.freeze({
      details: details(row.details),
      dues: Object.freeze(dues),
      unassigned: Object.freeze(row.unassigned.map(entry)),
      canUpload: row.can_upload,
    });
  } catch (error) {
    if (error instanceof Mismatch) return null;
    throw error;
  }
}

/** «1 000,50» / «1000.5» -> целые минорные единицы строкой; пусто, ноль, больше 14 знаков или три знака после запятой - `null`. */
export function receiptAmountToMinor(input: string): string | null {
  const value = input.replace(/[\s ]/g, "");
  if (!/^\d{1,14}([.,]\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return amount > BigInt(0) && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? amount.toString() : null;
}

/** Целые минорные единицы -> текст для поля ввода («1000.5» без разделителей тысяч). */
export function minorToReceiptInput(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const fraction = minor % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

/** Код ошибки маршрута загрузки -> ключ строки словаря `admission`. */
export const PAYMENT_RECEIPT_ERROR_KEYS = {
  file_too_large: "receiptErrorTooLarge",
  unsupported_mime_type: "receiptErrorFileType",
  file_signature_mismatch: "receiptErrorSignature",
  malware_detected: "receiptErrorScan",
  malware_scan_unconfirmed: "receiptErrorUnavailable",
  malware_scanner_unavailable: "receiptErrorUnavailable",
  invalid_upload: "receiptErrorInvalid",
  invalid_multipart: "receiptErrorInvalid",
  multipart_required: "receiptErrorInvalid",
  invalid_fields: "receiptErrorInvalid",
  receipt_invalid: "receiptErrorInvalid",
  receipt_invalid_date: "receiptErrorDate",
  receipt_currency_mismatch: "receiptErrorCurrency",
  receipt_duplicate: "receiptErrorDuplicate",
  receipt_too_many: "receiptErrorTooMany",
  receipt_forbidden: "receiptErrorForbidden",
  upload_not_authorized: "receiptErrorForbidden",
  authentication_required: "receiptErrorSession",
  unauthorized: "receiptErrorSession",
} as const;
export type PaymentReceiptErrorKey = (typeof PAYMENT_RECEIPT_ERROR_KEYS)[keyof typeof PAYMENT_RECEIPT_ERROR_KEYS] | "receiptErrorUnavailable";

export function paymentReceiptErrorKey(code: unknown): PaymentReceiptErrorKey {
  return typeof code === "string" && Object.hasOwn(PAYMENT_RECEIPT_ERROR_KEYS, code)
    ? PAYMENT_RECEIPT_ERROR_KEYS[code as keyof typeof PAYMENT_RECEIPT_ERROR_KEYS]
    : "receiptErrorUnavailable";
}
