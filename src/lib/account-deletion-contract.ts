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

/**
 * Браузер со старой сессией удалённого аккаунта (ревью 279, п. 4): этот
 * маршрут спрашивает Auth, и если пользователя нет, выходит локально и ведёт
 * на `/login?notice=account_deleted` («Аккаунт удалён»).
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

/**
 * «Проверить вручную» (дополнение к 279 от 08.10: удаляется только своё).
 * Запись вне собственных данных аккаунта, где есть его телефон, email или
 * номер паспорта, либо которой пользуется ещё кто-то. Сама она не меняется:
 * Admin решает по каждой.
 */
export type AccountDeletionReviewKind = "chat" | "lead" | "client" | "case";
export type AccountDeletionReviewReason = "phone" | "email" | "passport" | "shared" | "linked";
export type AccountDeletionReviewDecision = "erased" | "not_subject";

export type AccountDeletionAmocrm = Readonly<{
  contactIds: readonly string[];
  leadIds: readonly string[];
  /** Команды CRM→amoCRM, отправленные без ответа (номера нет). */
  dispatchedCommands: number;
}>;

export type AccountDeletionReviewFacts = Readonly<{
  messages?: number;
  lastMessageAt?: string | null;
  caseId?: string | null;
  caseName?: string | null;
  leadId?: string | null;
  stage?: string | null;
  lifecycle?: string | null;
  createdAt?: string | null;
  leads?: number;
  cases?: number;
  state?: string | null;
  hasAccount?: boolean;
}>;

export type AccountDeletionReviewItem = Readonly<{
  kind: AccountDeletionReviewKind;
  id: string;
  reasons: readonly AccountDeletionReviewReason[];
  /** Запись ещё есть (удалённого чата уже нет). */
  exists: boolean;
  title: string | null;
  facts: AccountDeletionReviewFacts;
  /** Можно удалить или обезличить отсюда (дело со своим аккаунтом студента нельзя). */
  canErase: boolean;
  decision: AccountDeletionReviewDecision | null;
  decidedAt: string | null;
  decidedBy: string | null;
  amocrm: AccountDeletionAmocrm;
}>;

export type AccountDeletionDetail = AccountDeletionQueueRow & Readonly<{
  processingStartedBy: string | null;
  completedBy: string | null;
  pendingFiles: number;
  authAccountExists: boolean;
  counts: AccountDeletionCounts;
  /** Связи с amoCRM (свои записи и удалённые из списка проверки): нужна отметка Admin. */
  amocrmContacts: number;
  amocrm: AccountDeletionAmocrm;
  review: readonly AccountDeletionReviewItem[];
  /** Записи списка проверки без решения: пока они есть, удалить аккаунт нельзя. */
  reviewOpen: number;
}>;

export type AccountDeletionStorageObject = Readonly<{ bucket: string; name: string }>;

export type AccountDeletionProcessed = Readonly<{
  id: string;
  status: "processing" | "completed";
  authUserId: string | null;
  email: string | null;
  storageObjects: readonly AccountDeletionStorageObject[];
  /**
   * Связи с amoCRM: свои записи на первой обработке и записи, удалённые из
   * списка проверки. Больше нуля: завершить можно только с отметкой Admin,
   * что контакт и сделка в amoCRM удалены (база проверяет это сама).
   */
  amocrmContacts: number;
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

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function amocrmLinks(value: unknown): AccountDeletionAmocrm | null {
  const row = record(value);
  if (!row || !Array.isArray(row.contactIds) || !Array.isArray(row.leadIds) || !count(row.dispatchedCommands)
    || ![...row.contactIds, ...row.leadIds].every((id) => typeof id === "string" && /^\d{1,20}$/u.test(id))) return null;
  return { contactIds: row.contactIds as string[], leadIds: row.leadIds as string[], dispatchedCommands: row.dispatchedCommands };
}

const REVIEW_KINDS: readonly AccountDeletionReviewKind[] = ["chat", "lead", "client", "case"];
const REVIEW_REASONS: readonly AccountDeletionReviewReason[] = ["phone", "email", "passport", "shared", "linked"];
const NULLABLE_TEXT_FACTS = ["caseName", "stage", "lifecycle", "state"] as const;

function reviewFacts(value: unknown): AccountDeletionReviewFacts | null {
  const row = record(value);
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(row)) {
    const ok = key === "messages" || key === "leads" || key === "cases" ? count(item)
      : key === "lastMessageAt" || key === "createdAt" ? nullable(item, timestamp)
        : key === "caseId" || key === "leadId" ? nullable(item, uuid)
          : (NULLABLE_TEXT_FACTS as readonly string[]).includes(key) ? item === null || typeof item === "string"
            : key === "hasAccount" ? typeof item === "boolean" : false;
    if (!ok) return null;
    out[key] = item;
  }
  return out as AccountDeletionReviewFacts;
}

function reviewItem(value: unknown): AccountDeletionReviewItem | null {
  const row = record(value);
  if (!row || !REVIEW_KINDS.includes(row.kind as AccountDeletionReviewKind) || !uuid(row.id)
    || !Array.isArray(row.reasons) || row.reasons.length === 0
    || !row.reasons.every((reason) => REVIEW_REASONS.includes(reason as AccountDeletionReviewReason))
    || typeof row.exists !== "boolean" || !(row.title === null || typeof row.title === "string")
    || typeof row.canErase !== "boolean"
    || !(row.decision === null || row.decision === "erased" || row.decision === "not_subject")
    || !nullable(row.decidedAt, timestamp) || !(row.decidedBy === null || typeof row.decidedBy === "string")) return null;
  const facts = reviewFacts(row.facts);
  const amocrm = amocrmLinks(row.amocrm);
  if (!facts || !amocrm) return null;
  return {
    kind: row.kind as AccountDeletionReviewKind, id: row.id, reasons: row.reasons as AccountDeletionReviewReason[],
    exists: row.exists, title: row.title as string | null, facts, canErase: row.canErase,
    decision: row.decision as AccountDeletionReviewDecision | null, decidedAt: row.decidedAt as string | null,
    decidedBy: row.decidedBy as string | null, amocrm,
  };
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
  const amocrm = amocrmLinks(row.amocrm);
  const review = Array.isArray(row.review) ? row.review.map(reviewItem) : null;
  if (!rawCounts || !del || !anonymize || !remain || (rawCounts.deleted !== undefined && !deleted)
    || !(row.processingStartedBy === null || typeof row.processingStartedBy === "string")
    || !(row.completedBy === null || typeof row.completedBy === "string")
    || !count(row.pendingFiles) || typeof row.authAccountExists !== "boolean"
    || !count(row.amocrmContacts) || !amocrm || !review || review.some((item) => item === null)
    || !count(row.reviewOpen)) return null;
  return {
    ...base,
    processingStartedBy: row.processingStartedBy as string | null,
    completedBy: row.completedBy as string | null,
    pendingFiles: row.pendingFiles,
    authAccountExists: row.authAccountExists,
    counts: { delete: del, anonymize, remain, deleted },
    amocrmContacts: row.amocrmContacts,
    amocrm,
    review: review as AccountDeletionReviewItem[],
    reviewOpen: row.reviewOpen,
  };
}

/** resolve_account_deletion_candidate_v1: решение по одной записи списка проверки. */
export function parseAccountDeletionReviewDecision(value: unknown): Readonly<{
  kind: AccountDeletionReviewKind; id: string; decision: AccountDeletionReviewDecision;
}> | null {
  const row = record(value);
  if (!row || !REVIEW_KINDS.includes(row.kind as AccountDeletionReviewKind) || !uuid(row.id)
    || (row.decision !== "erased" && row.decision !== "not_subject") || !timestamp(row.decidedAt)) return null;
  return { kind: row.kind as AccountDeletionReviewKind, id: row.id, decision: row.decision };
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
  // Completed requests answer without the amoCRM count (nothing is left to do).
  const amocrm = row.amocrmContacts ?? (row.status === "completed" ? 0 : undefined);
  if (!count(amocrm)) return null;
  return {
    id: row.id, status: row.status, authUserId: row.authUserId as string | null,
    email: row.email as string | null, storageObjects: objects, amocrmContacts: amocrm,
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
