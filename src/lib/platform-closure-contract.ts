/**
 * «Закрыть лид» и «Завершить дело» (migration 246) — the shared contract of
 * the two commands and two reads: fixed reason/outcome keys, input parsing
 * and exact decoding of the RPC results. Isomorphic: the dialogs import the
 * keys and the input check, the server wrappers import the decoders. Every
 * permission and state rule stays in SQL; nothing here is a security check.
 */

/** Причины закрытия лида (порядок — порядок в окне). */
export const LEAD_CLOSE_REASONS = ["no_response", "other_agency", "budget", "duplicate", "other"] as const;
export type LeadCloseReason = (typeof LEAD_CLOSE_REASONS)[number];

/** Исходы завершённого дела (порядок — порядок в окне). */
export const CASE_CLOSE_OUTCOMES = ["enrolled", "declined", "not_admitted", "other"] as const;
export type CaseCloseOutcome = (typeof CASE_CLOSE_OUTCOMES)[number];

/** Текст «Другое» — одна строка до 500 символов (то же правило в SQL 246). */
export const CLOSURE_NOTE_MAX_LENGTH = 500;

export type ClosureStatus =
  | "saved"
  | "invalid"
  | "forbidden"
  | "preview"
  | "stale"
  | "handed_off"
  | "request_conflict"
  | "unavailable";

export type LeadClosureReceipt = Readonly<{
  leadId: string;
  lifecycle: "open" | "closed";
  reason: LeadCloseReason | null;
  note: string | null;
  workflowVersion: string;
  changedAt: string;
}>;

export type CaseClosureReceipt = Readonly<{
  studentCaseId: string;
  state: "active" | "closed";
  outcome: CaseCloseOutcome | null;
  note: string | null;
  closedAt: string | null;
  admissionsVersion: string;
  changedAt: string;
}>;

export type ClosedLeadRow = Readonly<{
  leadId: string;
  name: string | null;
  ownerName: string | null;
  stageKey: string;
  workflowVersion: string;
  /** null — лид закрыт не этой командой: даты и причины нет. */
  closedAt: string | null;
  reason: LeadCloseReason | null;
  note: string | null;
  closedByName: string | null;
  canManage: boolean;
}>;

export type ClosedLeadsPage = Readonly<{ rows: readonly ClosedLeadRow[]; nextCursor: string | null }>;

export type CaseClosure = Readonly<{
  studentCaseId: string;
  state: "pending" | "active" | "closed";
  admissionsVersion: string;
  closedAt: string | null;
  outcome: CaseCloseOutcome | null;
  note: string | null;
  closedByName: string | null;
  canChange: boolean;
}>;

export class ClosureContractError extends Error {
  constructor() {
    super("Closure result has an unexpected shape.");
    this.name = "ClosureContractError";
  }
}

function invalid(): never {
  throw new ClosureContractError();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const BIGINT_MAX = "9223372036854775807";
const CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Одна строка: управляющие C0 и C1, U+2028 и U+2029 — то же правило, что в SQL 246.
const CONTROL_PATTERN = /[\u0001-\u001F\u007F-\u009F\u2028\u2029]/u;
// Пробелы по краям, которые SQL 246 срезает (btrim по тому же набору).
const EDGE_SPACE = new RegExp(String.raw`^[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$`, "gu");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseClosureUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function requiredUuid(value: unknown): string {
  return parseClosureUuid(value) ?? invalid();
}

function requiredTimestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) return invalid();
  return value;
}

function optionalTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredTimestamp(value);
}

function optionalText(value: unknown, max = 1000): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > max) return invalid();
  return value;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}

/** Версия — десятичный текст bigint (PostgREST передаёт его без потерь). */
export function parseClosureVersion(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value) || value.length > BIGINT_MAX.length
    || (value.length === BIGINT_MAX.length && value > BIGINT_MAX)) return null;
  return value;
}

function requiredVersion(value: unknown): string {
  return parseClosureVersion(value) ?? invalid();
}

export function parseLeadCloseReason(value: unknown): LeadCloseReason | null {
  return LEAD_CLOSE_REASONS.find((key) => key === value) ?? null;
}

export function parseCaseCloseOutcome(value: unknown): CaseCloseOutcome | null {
  return CASE_CLOSE_OUTCOMES.find((key) => key === value) ?? null;
}

function optionalReason(value: unknown): LeadCloseReason | null {
  if (value === null || value === undefined) return null;
  return parseLeadCloseReason(value) ?? invalid();
}

function optionalOutcome(value: unknown): CaseCloseOutcome | null {
  if (value === null || value === undefined) return null;
  return parseCaseCloseOutcome(value) ?? invalid();
}

/**
 * Проверка ввода окна закрытия — та же, что в SQL: ключ из списка; текст
 * только у «Другое», и там он обязателен; одна строка до 500 символов.
 * Возвращает нормализованный текст или ошибку для поля.
 */
export function closureNoteInput(
  key: string | null,
  rawNote: string,
): Readonly<{ ok: true; note: string | null }> | Readonly<{ ok: false; error: "key" | "note_required" | "note_invalid" }> {
  if (key === null) return { ok: false, error: "key" };
  if (key !== "other") return { ok: true, note: null };
  const note = rawNote.replace(EDGE_SPACE, "");
  if (note === "") return { ok: false, error: "note_required" };
  if (note.length > CLOSURE_NOTE_MAX_LENGTH || CONTROL_PATTERN.test(note)) return { ok: false, error: "note_invalid" };
  return { ok: true, note };
}

/** Maps a PostgREST error of the two 246 commands to an honest status. */
export function closureStatusFromRpcError(error: unknown): Exclude<ClosureStatus, "saved" | "preview"> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : null;
  const message = typeof error.message === "string" ? error.message.trim() : null;
  if (code === "42501") return "forbidden";
  if (code === "PT409") return "stale";
  if (code === "55000" && message === "lead_lifecycle_handed_off") return "handed_off";
  if (code === "22023") {
    if (message === "lead_lifecycle_request_conflict" || message === "case_closure_request_conflict") return "request_conflict";
    return "invalid";
  }
  return "unavailable";
}

export function normalizeLeadClosureReceipt(
  value: unknown,
  expected: Readonly<{ organizationId: string; leadId: string; requestId: string; closed: boolean }>,
): LeadClosureReceipt {
  if (!isRecord(value)) return invalid();
  const lifecycle = value.lifecycle === "open" || value.lifecycle === "closed" ? value.lifecycle : invalid();
  const reason = optionalReason(value.reason);
  const note = optionalText(value.note, CLOSURE_NOTE_MAX_LENGTH);
  if (requiredUuid(value.organization_id) !== expected.organizationId
    || requiredUuid(value.lead_id) !== expected.leadId
    || requiredUuid(value.request_id) !== expected.requestId
    || (lifecycle === "closed") !== expected.closed
    || (lifecycle === "closed") !== (reason !== null)
    || (note !== null && reason !== "other")) return invalid();
  return Object.freeze({
    leadId: expected.leadId,
    lifecycle,
    reason,
    note,
    workflowVersion: requiredVersion(value.workflow_version),
    changedAt: requiredTimestamp(value.changed_at),
  });
}

export function normalizeCaseClosureReceipt(
  value: unknown,
  expected: Readonly<{ organizationId: string; studentCaseId: string; requestId: string; closed: boolean }>,
): CaseClosureReceipt {
  if (!isRecord(value)) return invalid();
  const state = value.state === "active" || value.state === "closed" ? value.state : invalid();
  const outcome = optionalOutcome(value.outcome);
  const note = optionalText(value.note, CLOSURE_NOTE_MAX_LENGTH);
  const closedAt = optionalTimestamp(value.closed_at);
  if (requiredUuid(value.organization_id) !== expected.organizationId
    || requiredUuid(value.student_case_id) !== expected.studentCaseId
    || requiredUuid(value.request_id) !== expected.requestId
    || (state === "closed") !== expected.closed
    || (state === "closed") !== (outcome !== null)
    || (state === "closed") !== (closedAt !== null)
    || (note !== null && outcome !== "other")) return invalid();
  const admissionsVersion = requiredVersion(value.admissions_version);
  if (admissionsVersion === "0") return invalid();
  return Object.freeze({
    studentCaseId: expected.studentCaseId,
    state,
    outcome,
    note,
    closedAt,
    admissionsVersion,
    changedAt: requiredTimestamp(value.changed_at),
  });
}

export function parseClosedLeadsCursor(value: unknown): string | null {
  return typeof value === "string" && CURSOR_PATTERN.test(value) ? value : null;
}

export function normalizeClosedLeadsPage(value: unknown, organizationId: string, limit: number): ClosedLeadsPage {
  if (!isRecord(value) || requiredUuid(value.organization_id) !== organizationId || !Array.isArray(value.rows)
    || value.rows.length > limit) return invalid();
  const seen = new Set<string>();
  const rows = value.rows.map((raw): ClosedLeadRow => {
    if (!isRecord(raw)) return invalid();
    const leadId = requiredUuid(raw.lead_id);
    if (seen.has(leadId)) return invalid();
    seen.add(leadId);
    const reason = optionalReason(raw.reason);
    const note = optionalText(raw.note, CLOSURE_NOTE_MAX_LENGTH);
    const closedAt = optionalTimestamp(raw.closed_at);
    if ((closedAt === null && reason !== null) || (note !== null && reason !== "other")) return invalid();
    const stageKey = typeof raw.stage_key === "string" && /^[a-z][a-z0-9_.-]{0,63}$/.test(raw.stage_key) ? raw.stage_key : invalid();
    return Object.freeze({
      leadId,
      name: optionalText(raw.client_display_name, 500),
      ownerName: optionalText(raw.owner_display_name, 500),
      stageKey,
      workflowVersion: requiredVersion(raw.workflow_version),
      closedAt,
      reason,
      note,
      closedByName: optionalText(raw.closed_by_display_name, 500),
      canManage: requiredBoolean(raw.can_manage),
    });
  });
  const nextCursor = value.next_cursor === null ? null : parseClosedLeadsCursor(value.next_cursor) ?? invalid();
  return Object.freeze({ rows: Object.freeze(rows), nextCursor });
}

export function normalizeCaseClosure(value: unknown, organizationId: string, studentCaseId: string): CaseClosure {
  if (!isRecord(value) || requiredUuid(value.organization_id) !== organizationId
    || requiredUuid(value.student_case_id) !== studentCaseId) return invalid();
  const state = value.state === "pending" || value.state === "active" || value.state === "closed" ? value.state : invalid();
  const closedAt = optionalTimestamp(value.closed_at);
  const outcome = optionalOutcome(value.outcome);
  const note = optionalText(value.note, CLOSURE_NOTE_MAX_LENGTH);
  if ((state === "closed") !== (closedAt !== null) || (state !== "closed" && outcome !== null)
    || (note !== null && outcome !== "other")) return invalid();
  return Object.freeze({
    studentCaseId,
    state,
    admissionsVersion: requiredVersion(value.admissions_version),
    closedAt,
    outcome,
    note,
    closedByName: optionalText(value.closed_by_display_name, 500),
    canChange: requiredBoolean(value.can_change),
  });
}
