// Строгие декодеры чтений кабинета: порт src/lib/v3/portal-source.ts (веб).
// Веб-модуль начинается с `import "server-only"`, поэтому страж общих импортов его
// не пропускает; правила разбора здесь те же, а паритет закреплён тестами на
// синтетических строках (src/domain/__tests__/portal-source.test.ts).
// Любое отклонение формы: `PortalDecodeError` без текста данных. Экран берёт строку
// ошибки из словаря i18n, ответ сервера не показывается.
import {
  PLATFORM_OBLIGATION_CATEGORIES,
  PLATFORM_OBLIGATION_STATUSES,
  type PlatformObligationCategory,
  type PlatformObligationStatus,
} from "@web/lib/platform-case-operations-contract";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMPTZ_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const NOTIFICATION_CODE_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

export const STUDENT_PORTAL_DOCUMENT_ACTION_KINDS = ["upload_document", "replace_document"] as const;
export type StudentPortalDocumentActionKind = (typeof STUDENT_PORTAL_DOCUMENT_ACTION_KINDS)[number];

const EVO_ACTION_STATUSES = ["open", "in_progress", "blocked"] as const;
type EvoActionStatus = (typeof EVO_ACTION_STATUSES)[number];

export type StudentPortalDocumentAction = Readonly<{
  kind: StudentPortalDocumentActionKind;
  label: string;
  dueAt: string | null;
  documentSlotId: string;
}>;
export type StudentPortalPaymentAction = Readonly<{
  kind: "payment";
  label: string;
  /** Договорной транш может быть без срока (миграция 188). */
  dueAt: string | null;
  amountMinor: number;
  currency: string;
}>;
export type StudentPortalAction = StudentPortalDocumentAction | StudentPortalPaymentAction;

export type StudentPortalEvoAction = Readonly<{
  taskId: string;
  title: string;
  status: EvoActionStatus;
  dueAt: string | null;
  dueOn: string | null;
}>;

export type StudentPortalOverview = Readonly<{
  /** Исходное значение; подпись берётся из словаря `admission.stage.*`. */
  operationalStage: string;
  studentAction: StudentPortalAction | null;
  studentActions: readonly StudentPortalAction[];
  evoAction: StudentPortalEvoAction | null;
  curatorDisplayName: string | null;
}>;

export type StudentPortalPayment = Readonly<{
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
}>;

export type StudentPortalNotification = Readonly<{
  notificationId: string;
  category: string;
  eventCode: string;
  subjectLabel: string;
  detail: string | null;
  dueAt: string | null;
  createdAt: string;
  readAt: string | null;
}>;

/** Ошибка формы данных. Текст фиксированный: данные в него не попадают. */
export class PortalDecodeError extends Error {
  constructor() {
    super("portal:decode");
    this.name = "PortalDecodeError";
  }
}

function invalidShape(): never {
  throw new PortalDecodeError();
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidShape();
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) return invalidShape();
  return record;
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return invalidShape();
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalidShape() : normalized;
}

function requiredText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

function optionalText(value: unknown, maximum: number): string | null {
  return value === null ? null : requiredText(value, maximum);
}

function requiredDate(value: unknown): string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return invalidShape();
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return invalidShape();
  }
  return value;
}

function optionalDate(value: unknown): string | null {
  return value === null ? null : requiredDate(value);
}

function requiredTimestamp(value: unknown): string {
  if (typeof value !== "string") return invalidShape();
  const match = TIMESTAMPTZ_PATTERN.exec(value);
  const parsedTimestamp = Date.parse(value);
  if (!match || !Number.isFinite(parsedTimestamp)) return invalidShape();

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionalSecond = "", offsetText, offsetSign, offsetHourText = "0", offsetMinuteText = "0"] = match;
  requiredDate(`${yearText}-${monthText}-${dayText}`);

  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  if (offsetHour > 23 || offsetMinute > 59) return invalidShape();

  const offsetDirection = offsetText === "Z" || offsetSign === "+" ? 1 : -1;
  const offsetMilliseconds = offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  const localTimestamp = new Date(parsedTimestamp + offsetMilliseconds);
  const millisecond = Number(fractionalSecond.padEnd(3, "0").slice(0, 3));
  if (
    localTimestamp.getUTCFullYear() !== Number(yearText) ||
    localTimestamp.getUTCMonth() !== Number(monthText) - 1 ||
    localTimestamp.getUTCDate() !== Number(dayText) ||
    localTimestamp.getUTCHours() !== Number(hourText) ||
    localTimestamp.getUTCMinutes() !== Number(minuteText) ||
    localTimestamp.getUTCSeconds() !== Number(secondText) ||
    localTimestamp.getUTCMilliseconds() !== millisecond
  ) {
    return invalidShape();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null ? null : requiredTimestamp(value);
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  return typeof value === "string" && allowed.includes(value) ? (value as T[number]) : invalidShape();
}

function nonNegativeSafeInteger(value: unknown): number {
  let numeric: bigint;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    numeric = BigInt(value);
  } else if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    numeric = BigInt(value);
  } else {
    return invalidShape();
  }
  if (numeric > MAX_POSTGRES_BIGINT || numeric > BigInt(Number.MAX_SAFE_INTEGER)) return invalidShape();
  return Number(numeric);
}

function rows<T>(value: unknown, normalize: (row: unknown) => T, key?: (row: T) => string): readonly T[] {
  if (!Array.isArray(value)) return invalidShape();
  const seen = new Set<string>();
  return Object.freeze(
    value.map((raw) => {
      const row = normalize(raw);
      if (key) {
        const rowKey = key(row);
        if (seen.has(rowKey)) return invalidShape();
        seen.add(rowKey);
      }
      return row;
    }),
  );
}

/** Одна строка `student_portal_overview_v2()`. */
export function normalizeStudentPortalOverview(value: unknown): StudentPortalOverview {
  const row = exactRecord(value, [
    "operational_stage",
    "student_action_kind",
    "student_action_label",
    "student_action_due_at",
    "student_action_document_slot_id",
    "evo_action_task_id",
    "evo_action_title",
    "evo_action_status",
    "evo_action_due_at",
    "evo_action_due_on",
    "curator_display_name",
  ]);

  const studentActionKind = row.student_action_kind === null ? null : enumValue(row.student_action_kind, STUDENT_PORTAL_DOCUMENT_ACTION_KINDS);
  const studentActionLabel = optionalText(row.student_action_label, 500);
  const studentActionDueAt = optionalTimestamp(row.student_action_due_at);
  const studentActionDocumentSlotId = row.student_action_document_slot_id === null ? null : requiredUuid(row.student_action_document_slot_id);
  let studentAction: StudentPortalDocumentAction | null = null;
  if (studentActionKind === null) {
    if (studentActionLabel !== null || studentActionDueAt !== null || studentActionDocumentSlotId !== null) return invalidShape();
  } else {
    if (studentActionLabel === null || studentActionDocumentSlotId === null) return invalidShape();
    studentAction = Object.freeze({
      kind: studentActionKind,
      label: studentActionLabel,
      dueAt: studentActionDueAt,
      documentSlotId: studentActionDocumentSlotId,
    });
  }

  const evoActionTaskId = row.evo_action_task_id === null ? null : requiredUuid(row.evo_action_task_id);
  const evoActionTitle = optionalText(row.evo_action_title, 1000);
  const evoActionStatus = row.evo_action_status === null ? null : enumValue(row.evo_action_status, EVO_ACTION_STATUSES);
  const evoActionDueAt = optionalTimestamp(row.evo_action_due_at);
  const evoActionDueOn = optionalDate(row.evo_action_due_on);
  let evoAction: StudentPortalEvoAction | null = null;
  if (evoActionTaskId === null) {
    if (evoActionTitle !== null || evoActionStatus !== null || evoActionDueAt !== null || evoActionDueOn !== null) return invalidShape();
  } else {
    if (evoActionTitle === null || evoActionStatus === null || (evoActionDueAt !== null && evoActionDueOn !== null)) return invalidShape();
    evoAction = Object.freeze({ taskId: evoActionTaskId, title: evoActionTitle, status: evoActionStatus, dueAt: evoActionDueAt, dueOn: evoActionDueOn });
  }

  return Object.freeze({
    operationalStage: requiredText(row.operational_stage, 300),
    studentAction,
    studentActions: Object.freeze(studentAction ? [studentAction] : []),
    evoAction,
    curatorDisplayName: optionalText(row.curator_display_name, 200),
  });
}

/** Одна строка `student_portal_finance_v2()`. */
export function normalizeStudentPortalPayment(value: unknown): StudentPortalPayment {
  const row = exactRecord(value, [
    "obligation_label",
    "category",
    "amount_minor",
    "paid_minor",
    "refunded_minor",
    "outstanding_minor",
    "currency",
    "due_at",
    "derived_status",
    "overdue",
    "next_action",
  ]);
  const amountMinor = nonNegativeSafeInteger(row.amount_minor);
  const paidMinor = nonNegativeSafeInteger(row.paid_minor);
  const refundedMinor = nonNegativeSafeInteger(row.refunded_minor);
  const outstandingMinor = nonNegativeSafeInteger(row.outstanding_minor);
  const status = enumValue(row.derived_status, PLATFORM_OBLIGATION_STATUSES);
  if (
    amountMinor < 1 ||
    refundedMinor > paidMinor ||
    paidMinor - refundedMinor > amountMinor ||
    !Number.isSafeInteger(amountMinor - paidMinor + refundedMinor) ||
    outstandingMinor !== amountMinor - paidMinor + refundedMinor ||
    typeof row.overdue !== "boolean" ||
    row.overdue !== (status === "overdue") ||
    (status === "paid" ? outstandingMinor !== 0 : outstandingMinor === 0)
  ) {
    return invalidShape();
  }
  return Object.freeze({
    label: requiredText(row.obligation_label, 300),
    category: enumValue(row.category, PLATFORM_OBLIGATION_CATEGORIES),
    amountMinor,
    paidMinor,
    refundedMinor,
    outstandingMinor,
    currency: typeof row.currency === "string" && CURRENCY_PATTERN.test(row.currency) ? row.currency : invalidShape(),
    dueAt: optionalTimestamp(row.due_at),
    status,
    overdue: row.overdue,
    nextAction: optionalText(row.next_action, 1000),
  });
}

/** Одна строка `student_portal_notifications_v2()`. */
export function normalizeStudentPortalNotification(value: unknown): StudentPortalNotification {
  const row = exactRecord(value, ["notification_id", "category", "event_code", "subject_label", "detail", "due_at", "created_at", "read_at"]);
  const category = requiredText(row.category, 160);
  const eventCode = requiredText(row.event_code, 160);
  if (!NOTIFICATION_CODE_PATTERN.test(category) || !NOTIFICATION_CODE_PATTERN.test(eventCode)) return invalidShape();
  return Object.freeze({
    notificationId: requiredUuid(row.notification_id),
    category,
    eventCode,
    subjectLabel: requiredText(row.subject_label, 300),
    detail: optionalText(row.detail, 2000),
    dueAt: optionalTimestamp(row.due_at),
    createdAt: requiredTimestamp(row.created_at),
    readAt: optionalTimestamp(row.read_at),
  });
}

export function decodePayments(data: unknown): readonly StudentPortalPayment[] {
  return rows(data, normalizeStudentPortalPayment);
}

export function decodeNotifications(data: unknown): readonly StudentPortalNotification[] {
  return rows(data, normalizeStudentPortalNotification, (row) => row.notificationId);
}

/**
 * Обзор дела: ответ `student_portal_overview_v2` (0 или 1 строка) и начисления.
 * Нет строки: `null` (дело без плана). Очередь действий как в вебе: остаток к оплате
 * (кроме отменённых и списанных) встаёт к действию с документом, самый ранний срок
 * первым, без срока в конце, при равенстве порядок сохраняется.
 */
export function buildPortalOverview(overviewData: unknown, paymentsData: unknown): StudentPortalOverview | null {
  if (!Array.isArray(overviewData) || overviewData.length > 1) return invalidShape();
  const payments = decodePayments(paymentsData);
  if (overviewData.length === 0) return null;
  const overview = normalizeStudentPortalOverview(overviewData[0]);
  const choices: StudentPortalAction[] = [...overview.studentActions];
  for (const payment of payments) {
    if (payment.outstandingMinor > 0 && !["cancelled", "waived"].includes(payment.status)) {
      choices.push(
        Object.freeze({
          kind: "payment" as const,
          label: payment.label,
          dueAt: payment.dueAt,
          amountMinor: payment.outstandingMinor,
          currency: payment.currency,
        }),
      );
    }
  }
  choices.sort((left, right) => {
    const leftDue = left.dueAt ? Date.parse(left.dueAt) : Infinity;
    const rightDue = right.dueAt ? Date.parse(right.dueAt) : Infinity;
    if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
    return 0;
  });
  const studentActions = Object.freeze(choices);
  return Object.freeze({ ...overview, studentAction: studentActions[0] ?? null, studentActions });
}
