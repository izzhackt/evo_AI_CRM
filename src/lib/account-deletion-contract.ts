/**
 * Удаление аккаунта по запросу (миграция 280, PLAN_CHANGES 07.10.2026 и
 * упрощение для 1.0 от 08.10.2026). Клиент-безопасные типы и строгий разбор
 * ответов RPC: любое отклонение формы — null, экран показывает честную
 * ошибку, а не выдуманное состояние.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/u;

/** Срок обработки по решению владельца: запрос + 30 дней. */
export const ACCOUNT_DELETION_DAYS = 30;

/** Слово для подтверждения автоматического удаления в CRM (вводится вручную). */
export const ACCOUNT_DELETION_CONFIRM_WORD = "удалить";

/** Слово для подтверждения «Отметить выполненным» (ручная обработка). */
export const ACCOUNT_DELETION_DONE_WORD = "выполнено";

/** Заметка Admin к ручной обработке: что сделано, без личных данных. */
export const ACCOUNT_DELETION_NOTE_MIN = 10;
export const ACCOUNT_DELETION_NOTE_MAX = 2000;

/**
 * Браузер со старой сессией удалённого аккаунта: этот маршрут спрашивает
 * Auth, и если пользователя нет, выходит локально и ведёт на
 * `/login?notice=account_deleted` («Аккаунт удалён»).
 */
export const ACCOUNT_DELETED_PATH = "/auth/account-deleted";
export const ACCOUNT_DELETED_NOTICE = "account_deleted";

/** Ошибка Supabase Auth «пользователя из токена больше нет» (`user_not_found`). */
export function isDeletedAuthUserError(error: unknown): boolean {
  return error !== null && typeof error === "object" && (error as { code?: unknown }).code === "user_not_found";
}

export type OwnAccountDeletion = Readonly<{
  requestId: string;
  status: "requested" | "processing";
  requestedAt: string;
  dueAt: string;
}>;

export type AccountDeletionKind = "student" | "applicant";
export type AccountDeletionStatus = "requested" | "processing" | "completed";
export type ConfirmationEmailStatus = "sent" | "failed" | "not_configured" | "no_address";

/**
 * Как обрабатывается запрос. «automatic» — простой аккаунт: база сама удаляет
 * строки, связанные с аккаунтом внешними ключами. «manual» — всё остальное:
 * команда работает по инструкции, Admin отмечает выполненным.
 */
export type AccountDeletionMode = "automatic" | "manual";

/** Почему аккаунт не простой (коды базы, account_deletion_blockers). */
export type AccountDeletionReason =
  | "staff" | "case" | "application_converted" | "lead" | "client"
  | "payment" | "contract_file" | "whatsapp" | "other_records";

/** Вход в аккаунт: работает, отключён (мягкое удаление Auth) или удалён. */
export type AccountDeletionLogin = "active" | "disabled" | "absent";

const REASONS: readonly AccountDeletionReason[] = [
  "staff", "case", "application_converted", "lead", "client", "payment", "contract_file", "whatsapp", "other_records",
];
const COUNT_KEYS = ["application", "profile", "consultations", "favourites", "tests", "journal"] as const;

export type AccountDeletionCounts = Readonly<Record<(typeof COUNT_KEYS)[number], number>>;

export type AccountDeletionQueueRow = Readonly<{
  id: string;
  kind: AccountDeletionKind;
  status: AccountDeletionStatus;
  mode: AccountDeletionMode;
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

export type AccountDeletionDetail = AccountDeletionQueueRow & Readonly<{
  reasons: readonly AccountDeletionReason[];
  /** Таблицы с другими записями, которые ссылаются на аккаунт (для технического администратора). */
  otherTables: readonly string[];
  /** Сколько собственных строк удаляется (открытый простой) или удалено (выполненный автоматически). */
  counts: AccountDeletionCounts;
  login: AccountDeletionLogin;
  manualNote: string | null;
  processingStartedBy: string | null;
  completedBy: string | null;
}>;

/** Ответ шагов обработки: process, complete, mark done, record email. */
export type AccountDeletionStep = Readonly<{
  id: string;
  status: "processing" | "completed";
  mode: AccountDeletionMode | null;
  authUserId: string | null;
  /** Адрес для письма, пока его статус не записан. */
  email: string | null;
  emailStatus: ConfirmationEmailStatus | null;
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

function isMode(value: unknown): value is AccountDeletionMode {
  return value === "automatic" || value === "manual";
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
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
    || !isMode(row.mode)
    || typeof row.displayName !== "string" || row.displayName.trim() === ""
    || !(row.email === null || typeof row.email === "string")
    || !nullable(row.studentCaseId, uuid)
    || !timestamp(row.requestedAt) || !timestamp(row.dueAt) || typeof row.overdue !== "boolean"
    || !nullable(row.processingStartedAt, timestamp) || !nullable(row.completedAt, timestamp)
    || !nullable(row.confirmationEmailStatus, isEmailStatus)) return null;
  return {
    id: row.id, kind: row.kind, status: row.status, mode: row.mode, displayName: row.displayName,
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

function counts(value: unknown): AccountDeletionCounts | null {
  const row = record(value);
  if (!row) return null;
  // Выполненный вручную запрос счётчиков не имеет: пустой объект — нули.
  if (Object.keys(row).length === 0) return Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])) as AccountDeletionCounts;
  if (Object.keys(row).sort().join(",") !== [...COUNT_KEYS].sort().join(",")
    || !COUNT_KEYS.every((key) => count(row[key]))) return null;
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, row[key]])) as AccountDeletionCounts;
}

export function parseAccountDeletionDetail(value: unknown): AccountDeletionDetail | null {
  const base = queueRow(value);
  const row = record(value);
  if (!base || !row) return null;
  const parsedCounts = counts(row.counts);
  if (!Array.isArray(row.reasons) || !row.reasons.every((reason) => REASONS.includes(reason as AccountDeletionReason))
    || !Array.isArray(row.otherTables)
    || !row.otherTables.every((table) => typeof table === "string" && /^[a-z_]+\.[a-z0-9_]+$/u.test(table))
    || !parsedCounts
    || (row.login !== "active" && row.login !== "disabled" && row.login !== "absent")
    || !(row.manualNote === null || typeof row.manualNote === "string")
    || !(row.processingStartedBy === null || typeof row.processingStartedBy === "string")
    || !(row.completedBy === null || typeof row.completedBy === "string")) return null;
  return {
    ...base,
    reasons: row.reasons as AccountDeletionReason[],
    otherTables: row.otherTables as string[],
    counts: parsedCounts,
    login: row.login,
    manualNote: row.manualNote as string | null,
    processingStartedBy: row.processingStartedBy as string | null,
    completedBy: row.completedBy as string | null,
  };
}

/** Ответ process / complete / mark done / record email. */
export function parseAccountDeletionStep(value: unknown): AccountDeletionStep | null {
  const row = record(value);
  if (!row || !uuid(row.id) || (row.status !== "processing" && row.status !== "completed")
    || !(row.mode === null || isMode(row.mode)) || !nullable(row.authUserId, uuid)
    || !(row.email === null || typeof row.email === "string") || !nullable(row.emailStatus, isEmailStatus)) return null;
  return {
    id: row.id, status: row.status, mode: row.mode as AccountDeletionMode | null,
    authUserId: row.authUserId as string | null, email: row.email as string | null,
    emailStatus: row.emailStatus as ConfirmationEmailStatus | null,
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

/**
 * Заметка «Отметить выполненным»: перевод строки браузера (CRLF) приводится
 * к LF, края обрезаются; null, если длина вне 10..2000 или есть управляющие
 * символы, кроме перевода строки (база проверяет то же самое).
 */
export function normalizeAccountDeletionNote(value: string): string | null {
  const note = value.replace(/\r\n?/gu, "\n").trim();
  if (note.length < ACCOUNT_DELETION_NOTE_MIN || note.length > ACCOUNT_DELETION_NOTE_MAX || /[\u0001-\u0009\u000b-\u001f\u007f]/u.test(note)) {
    return null;
  }
  return note;
}
