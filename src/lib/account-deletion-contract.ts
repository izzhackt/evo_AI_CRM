/**
 * Удаление аккаунта по запросу (миграция 279, PLAN_CHANGES 07.10.2026).
 * Клиент-безопасные типы и строгий разбор ответов RPC: любое отклонение
 * формы — null, экран показывает честную ошибку, а не выдуманное состояние.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/u;

/** Срок обработки по решению владельца: запрос + 30 дней. */
export const ACCOUNT_DELETION_DAYS = 30;

/** Слово для подтверждения удаления в CRM (вводится вручную). */
export const ACCOUNT_DELETION_CONFIRM_WORD = "удалить";

export type OwnAccountDeletion = Readonly<{
  requestId: string;
  status: "requested" | "processing";
  requestedAt: string;
  dueAt: string;
}>;

export type AccountDeletionKind = "student" | "applicant";
export type AccountDeletionStatus = "requested" | "processing" | "completed";
export type ConfirmationEmailStatus = "sent" | "failed" | "not_configured" | "no_address";

export type AccountDeletionQueueRow = Readonly<{
  id: string;
  kind: AccountDeletionKind;
  status: AccountDeletionStatus;
  displayName: string;
  email: string | null;
  studentCaseId: string | null;
  requestedAt: string;
  dueAt: string;
  overdue: boolean;
  processingStartedAt: string | null;
  completedAt: string | null;
  confirmationEmailStatus: ConfirmationEmailStatus | null;
}>;

export type AccountDeletionCounts = Readonly<{
  delete: Readonly<Record<string, number>>;
  anonymize: Readonly<Record<string, number>>;
  remain: Readonly<Record<string, number>>;
  deleted: Readonly<Record<string, number>> | null;
}>;

export type AccountDeletionDetail = AccountDeletionQueueRow & Readonly<{
  processingStartedBy: string | null;
  completedBy: string | null;
  pendingFiles: number;
  authAccountExists: boolean;
  counts: AccountDeletionCounts;
}>;

export type AccountDeletionStorageObject = Readonly<{ bucket: string; name: string }>;

export type AccountDeletionProcessed = Readonly<{
  id: string;
  status: "processing" | "completed";
  authUserId: string | null;
  email: string | null;
  storageObjects: readonly AccountDeletionStorageObject[];
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function nullable<T>(value: unknown, check: (v: unknown) => v is T): value is T | null {
  return value === null || check(value);
}

function isEmailStatus(value: unknown): value is ConfirmationEmailStatus {
  return value === "sent" || value === "failed" || value === "not_configured" || value === "no_address";
}

function counts(value: unknown): Readonly<Record<string, number>> | null {
  const row = record(value);
  if (!row) return null;
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(row)) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0) return null;
    out[key] = item;
  }
  return out;
}

/**
 * own_account_deletion_request_v1 / request_account_deletion_v2. `null` —
 * открытого запроса нет; `undefined` — форма ответа не та (ошибка чтения).
 */
export function parseOwnAccountDeletion(value: unknown): OwnAccountDeletion | null | undefined {
  if (value === null) return null;
  const row = record(value);
  if (!row || Object.keys(row).sort().join(",") !== "dueAt,requestId,requestedAt,status") return undefined;
  if (!uuid(row.requestId) || (row.status !== "requested" && row.status !== "processing")
    || !timestamp(row.requestedAt) || !timestamp(row.dueAt)) return undefined;
  return { requestId: row.requestId, status: row.status, requestedAt: row.requestedAt, dueAt: row.dueAt };
}

function queueRow(value: unknown): AccountDeletionQueueRow | null {
  const row = record(value);
  if (!row) return null;
  if (!uuid(row.id) || (row.kind !== "student" && row.kind !== "applicant")
    || (row.status !== "requested" && row.status !== "processing" && row.status !== "completed")
    || typeof row.displayName !== "string" || row.displayName.trim() === ""
    || !(row.email === null || typeof row.email === "string")
    || !nullable(row.studentCaseId, uuid)
    || !timestamp(row.requestedAt) || !timestamp(row.dueAt) || typeof row.overdue !== "boolean"
    || !nullable(row.processingStartedAt, timestamp) || !nullable(row.completedAt, timestamp)
    || !nullable(row.confirmationEmailStatus, isEmailStatus)) return null;
  return {
    id: row.id, kind: row.kind, status: row.status, displayName: row.displayName,
    email: row.email as string | null, studentCaseId: row.studentCaseId as string | null,
    requestedAt: row.requestedAt, dueAt: row.dueAt, overdue: row.overdue,
    processingStartedAt: row.processingStartedAt as string | null,
    completedAt: row.completedAt as string | null,
    confirmationEmailStatus: row.confirmationEmailStatus as ConfirmationEmailStatus | null,
  };
}

/** staff_account_deletion_queue_v1: одна неверная строка — ошибка чтения всего списка. */
export function parseAccountDeletionQueue(value: unknown): readonly AccountDeletionQueueRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: AccountDeletionQueueRow[] = [];
  for (const item of value) {
    const row = queueRow(item);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

export function parseAccountDeletionDetail(value: unknown): AccountDeletionDetail | null {
  const base = queueRow(value);
  const row = record(value);
  if (!base || !row) return null;
  const rawCounts = record(row.counts);
  const del = counts(rawCounts?.delete);
  const anonymize = counts(rawCounts?.anonymize);
  const remain = counts(rawCounts?.remain);
  const deleted = rawCounts?.deleted === undefined ? null : counts(rawCounts.deleted);
  if (!rawCounts || !del || !anonymize || !remain || (rawCounts.deleted !== undefined && !deleted)
    || !(row.processingStartedBy === null || typeof row.processingStartedBy === "string")
    || !(row.completedBy === null || typeof row.completedBy === "string")
    || typeof row.pendingFiles !== "number" || !Number.isInteger(row.pendingFiles) || row.pendingFiles < 0
    || typeof row.authAccountExists !== "boolean") return null;
  return {
    ...base,
    processingStartedBy: row.processingStartedBy as string | null,
    completedBy: row.completedBy as string | null,
    pendingFiles: row.pendingFiles,
    authAccountExists: row.authAccountExists,
    counts: { delete: del, anonymize, remain, deleted },
  };
}

export function parseAccountDeletionProcessed(value: unknown): AccountDeletionProcessed | null {
  const row = record(value);
  if (!row || !uuid(row.id) || (row.status !== "processing" && row.status !== "completed")
    || !nullable(row.authUserId, uuid) || !(row.email === null || typeof row.email === "string")
    || !Array.isArray(row.storageObjects)) return null;
  const objects: AccountDeletionStorageObject[] = [];
  for (const item of row.storageObjects) {
    const object = record(item);
    if (!object || typeof object.bucket !== "string" || typeof object.name !== "string"
      || object.bucket === "" || object.name === "" || object.name.includes("..")) return null;
    objects.push({ bucket: object.bucket, name: object.name });
  }
  return {
    id: row.id, status: row.status, authUserId: row.authUserId as string | null,
    email: row.email as string | null, storageObjects: objects,
  };
}

/** Дата для людей: «06.11.2026» по Бишкеку (организация работает по нему). */
export function accountDeletionDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bishkek",
  }).format(new Date(iso));
}

function bishkekDay(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bishkek",
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000;
}

/**
 * Сколько календарных дней по Бишкеку до даты срока: в день запроса это
 * 30, в день срока 0; отрицательное значит, что срок прошёл.
 */
export function accountDeletionDaysLeft(dueAt: string, now: Date): number {
  return bishkekDay(new Date(dueAt)) - bishkekDay(now);
}
