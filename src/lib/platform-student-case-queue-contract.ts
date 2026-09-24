/**
 * «Студенты» work queue and the editable «Следующий шаг / Срок» — client-safe
 * contract for migration 241 (platform.staff_student_case_queue_v1,
 * platform.staff_student_case_queue_counts_v1, platform.set_case_next_action_v1).
 *
 * Strict, fail-closed decoding in the style of platform-admissions.ts: a
 * response that does not match the SQL contract exactly is rejected rather
 * than rendered. MUST stay free of server-only imports so the future client
 * panel can import the types and the input parser.
 */
import {
  ADMISSIONS_ATTENTION,
  ADMISSIONS_DIRECTIONS,
  type AdmissionsAttention,
  type AdmissionsDirection,
} from "./platform-admissions-playbook-contract.ts";
import {
  ADMISSIONS_PIPELINE_STAGES,
  type AdmissionsPipelineStage,
} from "./platform-admissions-pipeline-contract.ts";

/** Tabs of the queue, in display order. «Ждут куратора» is an Admin tab in the UI. */
export const STUDENT_CASE_QUEUE_VIEWS = ["mine", "needs_action", "active", "needs_curator", "closed"] as const;
export type StudentCaseQueueView = (typeof STUDENT_CASE_QUEUE_VIEWS)[number];

/** No name sort: its keyset cursor would carry the student name into the URL. */
export const STUDENT_CASE_QUEUE_SORTS = ["due", "updated"] as const;
export type StudentCaseQueueSort = (typeof STUDENT_CASE_QUEUE_SORTS)[number];

/** Bands of the due sort, in order; the SQL computes them against the Bishkek day. */
export const CASE_NEXT_ACTION_BANDS = ["overdue", "today", "this_week", "later", "undated", "no_step"] as const;
export type CaseNextActionBand = (typeof CASE_NEXT_ACTION_BANDS)[number];

export const STUDENT_CASE_QUEUE_PAGE_SIZE_MAX = 100;
export const STUDENT_CASE_QUEUE_QUERY_MAX_LENGTH = 200;
export const CASE_NEXT_ACTION_MAX_LENGTH = 1000;

const DIRECTION_FILTERS = [...ADMISSIONS_DIRECTIONS, "unknown"] as const;
export type StudentCaseQueueDirectionFilter = (typeof DIRECTION_FILTERS)[number];

const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, "i");
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const DUE_CURSOR_PATTERN = new RegExp(`^due\\|([012])\\|(\\d{4}-\\d{2}-\\d{2}|infinity)\\|(${UUID_SOURCE})$`);
const UPDATED_CURSOR_PATTERN = new RegExp(
  `^updated\\|(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z)\\|(${UUID_SOURCE})$`,
);
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const BIGINT_MAX = "9223372036854775807";
// Reads tolerate the tab/newline historic rows may hold (same rule as the
// 078 page decoder); writes are one line (see parseCaseNextActionInput).
const READ_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const WRITE_CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

export type StudentCaseQueueFilters = Readonly<{
  direction?: StudentCaseQueueDirectionFilter | null;
  curatorMembershipId?: string | null;
  pipelineStage?: AdmissionsPipelineStage | null;
  query?: string | null;
}>;

export type StudentCaseQueueRequest = StudentCaseQueueFilters &
  Readonly<{
    view: StudentCaseQueueView;
    sort?: StudentCaseQueueSort;
    cursor?: string | null;
    pageSize?: number;
  }>;

export type StudentCaseChecklistCounts = Readonly<{
  total: number;
  submitted: number;
  correctionRequired: number;
  rejected: number;
  approved: number;
  missing: number;
}>;

export type StudentCaseQueueRow = Readonly<{
  studentCaseId: string;
  studentDisplayName: string;
  state: "pending" | "active" | "closed";
  admissionsDirection: AdmissionsDirection | null;
  targetCountry: string | null;
  targetDegree: string | null;
  /** «Этап» in the words of «Воронка поступления». */
  pipelineStage: AdmissionsPipelineStage;
  pipelineHidden: boolean;
  nextAction: string | null;
  nextActionDueOn: string | null;
  dueBand: CaseNextActionBand;
  /** Decimal bigint; send it back as the expected version of the next write. */
  admissionsVersion: string;
  currentCuratorMembershipId: string | null;
  currentCuratorDisplayName: string | null;
  isMine: boolean;
  attentionFlags: readonly AdmissionsAttention[];
  overdueTaskCount: number;
  /** null: the actor cannot read this case's documents (нет чтения — нет числа). */
  documents: StudentCaseChecklistCounts | null;
  updatedAt: string;
  cursor: string;
}>;

export type StudentCaseQueuePage = Readonly<{
  view: StudentCaseQueueView;
  sort: StudentCaseQueueSort;
  today: string;
  rows: readonly StudentCaseQueueRow[];
  nextCursor: string | null;
}>;

export type StudentCaseQueueCounts = Readonly<{
  view: StudentCaseQueueView;
  today: string;
  total: number;
  views: Readonly<Record<StudentCaseQueueView, number>>;
  bands: Readonly<Record<CaseNextActionBand, number>>;
  directions: readonly Readonly<{ direction: StudentCaseQueueDirectionFilter; count: number }>[];
  curators: readonly Readonly<{ membershipId: string; displayName: string | null; isMe: boolean; count: number }>[];
  stages: readonly Readonly<{ pipelineStage: AdmissionsPipelineStage; count: number }>[];
}>;

export type CaseNextActionInput = Readonly<{
  nextAction: string | null;
  dueOn: string | null;
}>;

export type CaseNextActionReceipt = Readonly<{
  studentCaseId: string;
  nextAction: string | null;
  nextActionDueOn: string | null;
  admissionsVersion: string;
  cleared: boolean;
  requestId: string;
  changedAt: string;
}>;

export type CaseNextActionStatus =
  | "saved"
  | "invalid"
  | "forbidden"
  | "preview"
  | "stale"
  | "not_active"
  | "request_conflict"
  | "unavailable";

export class StudentCaseQueueContractError extends Error {
  constructor() {
    super("Student case queue data is unavailable.");
    this.name = "StudentCaseQueueContractError";
  }
}

function invalid(): never {
  throw new StudentCaseQueueContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) return invalid();
  return value as T[number];
}

export function parseQueueUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function requiredUuid(value: unknown): string {
  return parseQueueUuid(value) ?? invalid();
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function requiredText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return invalid();
  const normalized = value.trim();
  if (normalized.length === 0 || [...normalized].length > maxLength || READ_CONTROL_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function optionalText(value: unknown, maxLength: number): string | null {
  return value === null ? null : requiredText(value, maxLength);
}

/** A real proleptic-Gregorian calendar day in YYYY-MM-DD, year 0001-9999. */
export function isQueueCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requiredDate(value: unknown): string {
  return isQueueCalendarDate(value) ? value : invalid();
}

function optionalDate(value: unknown): string | null {
  return value === null ? null : requiredDate(value);
}

function requiredTimestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMPTZ_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    return invalid();
  }
  return value;
}

function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) return invalid();
  return parsed;
}

function positiveCount(value: unknown): number {
  const parsed = count(value);
  return parsed > 0 ? parsed : invalid();
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}

function versionText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(value) ||
    value.length > BIGINT_MAX.length ||
    (value.length === BIGINT_MAX.length && value > BIGINT_MAX)
  ) {
    return invalid();
  }
  return value;
}

/**
 * The opaque keyset cursor the SQL returned for a row, validated exactly like
 * the SQL does. It carries a rank, a date or timestamp and a case id — never
 * a name — so it is safe in a URL.
 */
export function parseStudentCaseQueueCursor(value: unknown, sort: StudentCaseQueueSort): string | null {
  if (typeof value !== "string") return null;
  if (sort === "due") {
    const match = DUE_CURSOR_PATTERN.exec(value);
    if (!match) return null;
    const dated = match[2] !== "infinity";
    if ((match[1] === "0") !== dated || (dated && !isQueueCalendarDate(match[2]))) return null;
    return value;
  }
  const match = UPDATED_CURSOR_PATTERN.exec(value);
  return match && Number.isFinite(Date.parse(match[1])) ? value : null;
}

function normalizeQuery(value: string | null | undefined): string | null {
  const query = value?.trim() || null;
  if (query !== null && ([...query].length > STUDENT_CASE_QUEUE_QUERY_MAX_LENGTH || READ_CONTROL_PATTERN.test(query))) {
    return invalid();
  }
  return query;
}

function filterArguments(filters: StudentCaseQueueFilters): Record<string, unknown> {
  return {
    p_direction: filters.direction == null ? null : oneOf(filters.direction, DIRECTION_FILTERS),
    p_curator_membership_id: filters.curatorMembershipId == null ? null : requiredUuid(filters.curatorMembershipId),
    p_pipeline_stage: filters.pipelineStage == null ? null : oneOf(filters.pipelineStage, ADMISSIONS_PIPELINE_STAGES),
    p_query: normalizeQuery(filters.query),
  };
}

/** GET-safe arguments: unset filters are omitted so SQL NULL defaults apply. */
function compact(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== undefined));
}

export function studentCaseQueuePageSize(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= STUDENT_CASE_QUEUE_PAGE_SIZE_MAX
    ? value
    : 25;
}

export function buildStudentCaseQueueRpcArguments(request: StudentCaseQueueRequest): Record<string, unknown> {
  const sort = request.sort ?? "due";
  oneOf(sort, STUDENT_CASE_QUEUE_SORTS);
  const cursor = request.cursor == null ? null : parseStudentCaseQueueCursor(request.cursor, sort) ?? invalid();
  return compact({
    p_view: oneOf(request.view, STUDENT_CASE_QUEUE_VIEWS),
    p_limit: studentCaseQueuePageSize(request.pageSize),
    p_sort: sort,
    p_cursor: cursor,
    ...filterArguments(request),
  });
}

export function buildStudentCaseQueueCountsRpcArguments(
  view: StudentCaseQueueView,
  filters: StudentCaseQueueFilters = {},
): Record<string, unknown> {
  return compact({ p_view: oneOf(view, STUDENT_CASE_QUEUE_VIEWS), ...filterArguments(filters) });
}

function attentionFlags(value: unknown): readonly AdmissionsAttention[] {
  if (!Array.isArray(value) || value.length > ADMISSIONS_ATTENTION.length) return invalid();
  const flags = value.map((flag) => oneOf(flag, ADMISSIONS_ATTENTION));
  return new Set(flags).size === flags.length ? Object.freeze(flags) : invalid();
}

function checklist(value: unknown): StudentCaseChecklistCounts | null {
  if (value === null) return null;
  if (!isRecord(value)) return invalid();
  const counts = Object.freeze({
    total: count(value.total),
    submitted: count(value.submitted),
    correctionRequired: count(value.correction_required),
    rejected: count(value.rejected),
    approved: count(value.approved),
    missing: count(value.missing),
  });
  const parts = counts.submitted + counts.correctionRequired + counts.rejected + counts.approved + counts.missing;
  return parts <= counts.total ? counts : invalid();
}

export function normalizeStudentCaseQueueRow(value: unknown, sort: StudentCaseQueueSort): StudentCaseQueueRow {
  if (!isRecord(value)) return invalid();
  const nextAction = optionalText(value.next_action, CASE_NEXT_ACTION_MAX_LENGTH);
  const nextActionDueOn = optionalDate(value.next_action_due_on);
  const dueBand = oneOf(value.due_band, CASE_NEXT_ACTION_BANDS);
  // The band is a function of the two fields; an inconsistent row is refused.
  if ((dueBand === "no_step") !== (nextAction === null)) return invalid();
  if ((dueBand === "undated") !== (nextAction !== null && nextActionDueOn === null)) return invalid();
  const cursor = parseStudentCaseQueueCursor(value.cursor, sort) ?? invalid();
  const studentCaseId = requiredUuid(value.student_case_id);
  if (!cursor.endsWith(`|${studentCaseId}`)) return invalid();
  const currentCuratorMembershipId = optionalUuid(value.current_curator_membership_id);
  const isMine = requiredBoolean(value.is_mine);
  if (isMine && currentCuratorMembershipId === null) return invalid();
  return Object.freeze({
    studentCaseId,
    studentDisplayName: requiredText(value.student_display_name, 200),
    state: oneOf(value.state, ["pending", "active", "closed"] as const),
    admissionsDirection: value.admissions_direction === null ? null : oneOf(value.admissions_direction, ADMISSIONS_DIRECTIONS),
    targetCountry: optionalText(value.target_country, 200),
    targetDegree: optionalText(value.target_degree, 200),
    pipelineStage: oneOf(value.pipeline_stage, ADMISSIONS_PIPELINE_STAGES),
    pipelineHidden: requiredBoolean(value.pipeline_hidden),
    nextAction,
    nextActionDueOn,
    dueBand,
    admissionsVersion: versionText(value.admissions_version),
    currentCuratorMembershipId,
    currentCuratorDisplayName: optionalText(value.current_curator_display_name, 200),
    isMine,
    attentionFlags: attentionFlags(value.attention_flags),
    overdueTaskCount: count(value.overdue_task_count),
    documents: checklist(value.documents),
    updatedAt: requiredTimestamp(value.updated_at),
    cursor,
  });
}

export function normalizeStudentCaseQueuePage(value: unknown, request: StudentCaseQueueRequest): StudentCaseQueuePage {
  const sort = request.sort ?? "due";
  const pageSize = studentCaseQueuePageSize(request.pageSize);
  if (!isRecord(value) || value.view !== request.view || value.sort !== sort) return invalid();
  if (!Array.isArray(value.rows) || value.rows.length > pageSize) return invalid();
  const seen = new Set<string>();
  const rows = value.rows.map((raw) => {
    const row = normalizeStudentCaseQueueRow(raw, sort);
    if (seen.has(row.studentCaseId)) return invalid();
    seen.add(row.studentCaseId);
    return row;
  });
  let nextCursor: string | null = null;
  if (value.next_cursor !== null) {
    nextCursor = parseStudentCaseQueueCursor(value.next_cursor, sort) ?? invalid();
    // A next page exists only after a full page, and resumes after its last row.
    if (rows.length !== pageSize || rows.at(-1)?.cursor !== nextCursor) return invalid();
  }
  return Object.freeze({ view: request.view, sort, today: requiredDate(value.today), rows: Object.freeze(rows), nextCursor });
}

function exactCountRecord<const K extends readonly string[]>(value: unknown, keys: K): Readonly<Record<K[number], number>> {
  if (!isRecord(value) || Object.keys(value).length !== keys.length) return invalid();
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, count(value[key])])) as Record<K[number], number>);
}

function uniqueList<T>(value: unknown, normalize: (raw: unknown) => T, key: (item: T) => string): readonly T[] {
  if (!Array.isArray(value) || value.length > 500) return invalid();
  const seen = new Set<string>();
  return Object.freeze(value.map((raw) => {
    const item = normalize(raw);
    if (seen.has(key(item))) return invalid();
    seen.add(key(item));
    return item;
  }));
}

export function normalizeStudentCaseQueueCounts(value: unknown, view: StudentCaseQueueView): StudentCaseQueueCounts {
  if (!isRecord(value) || value.view !== view) return invalid();
  const views = exactCountRecord(value.views, STUDENT_CASE_QUEUE_VIEWS);
  const bands = exactCountRecord(value.bands, CASE_NEXT_ACTION_BANDS);
  const total = count(value.total);
  const bandTotal = CASE_NEXT_ACTION_BANDS.reduce((sum, band) => sum + bands[band], 0);
  // The tab of the requested view, its total and its bands count the same rows.
  if (total !== views[view] || total !== bandTotal) return invalid();
  return Object.freeze({
    view,
    today: requiredDate(value.today),
    total,
    views,
    bands,
    directions: uniqueList(value.directions, (raw) => {
      if (!isRecord(raw)) return invalid();
      return Object.freeze({ direction: oneOf(raw.direction, DIRECTION_FILTERS), count: positiveCount(raw.count) });
    }, (item) => item.direction),
    curators: uniqueList(value.curators, (raw) => {
      if (!isRecord(raw)) return invalid();
      return Object.freeze({
        membershipId: requiredUuid(raw.membership_id),
        displayName: optionalText(raw.display_name, 200),
        isMe: requiredBoolean(raw.is_me),
        count: positiveCount(raw.count),
      });
    }, (item) => item.membershipId),
    stages: uniqueList(value.stages, (raw) => {
      if (!isRecord(raw)) return invalid();
      return Object.freeze({ pipelineStage: oneOf(raw.pipeline_stage, ADMISSIONS_PIPELINE_STAGES), count: positiveCount(raw.count) });
    }, (item) => item.pipelineStage),
  });
}

/**
 * Validates the form input exactly as platform.set_case_next_action_v1 does:
 * the step is trimmed (same Unicode whitespace set), one line, at most 1000
 * characters; the date is optional; blank step and no date clears the step; a
 * date without a step is refused. Returns null when the input is invalid.
 */
export function parseCaseNextActionInput(nextAction: unknown, dueOn: unknown): CaseNextActionInput | null {
  if (typeof nextAction !== "string" || typeof dueOn !== "string") return null;
  const text = nextAction.trim() || null;
  const date = dueOn.trim() || null;
  if (text !== null && ([...text].length > CASE_NEXT_ACTION_MAX_LENGTH || WRITE_CONTROL_PATTERN.test(text))) return null;
  if (date !== null && !isQueueCalendarDate(date)) return null;
  if (text === null && date !== null) return null;
  return Object.freeze({ nextAction: text, dueOn: date });
}

/** The version the write expects; the largest bigint cannot be incremented, so the SQL refuses it. */
export function parseExpectedAdmissionsVersion(value: unknown): string | null {
  try {
    const version = versionText(value);
    return version === BIGINT_MAX ? null : version;
  } catch {
    return null;
  }
}

/** The committed receipt must describe exactly this write; anything else is unknown. */
export function normalizeCaseNextActionReceipt(
  value: unknown,
  expected: Readonly<{ organizationId: string; studentCaseId: string; requestId: string }>,
): CaseNextActionReceipt {
  if (!isRecord(value)) return invalid();
  const nextAction = optionalText(value.next_action, CASE_NEXT_ACTION_MAX_LENGTH);
  const nextActionDueOn = optionalDate(value.next_action_due_on);
  const cleared = requiredBoolean(value.cleared);
  if (
    requiredUuid(value.organization_id) !== expected.organizationId ||
    requiredUuid(value.student_case_id) !== expected.studentCaseId ||
    requiredUuid(value.request_id) !== expected.requestId ||
    cleared !== (nextAction === null) ||
    (nextAction === null && nextActionDueOn !== null)
  ) {
    return invalid();
  }
  const admissionsVersion = versionText(value.admissions_version);
  if (admissionsVersion === "0") return invalid();
  return Object.freeze({
    studentCaseId: expected.studentCaseId,
    nextAction,
    nextActionDueOn,
    admissionsVersion,
    cleared,
    requestId: expected.requestId,
    changedAt: requiredTimestamp(value.changed_at),
  });
}

/** Maps a PostgREST error of set_case_next_action_v1 to an honest status. */
export function caseNextActionStatusFromRpcError(error: unknown): Exclude<CaseNextActionStatus, "saved" | "preview"> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : null;
  const message = typeof error.message === "string" ? error.message.trim() : null;
  if (code === "42501") return "forbidden";
  if (code === "PT409") return "stale";
  if (code === "22023") {
    if (message === "case_next_action_request_conflict") return "request_conflict";
    if (message === "case_next_action_case_not_active") return "not_active";
    return "invalid";
  }
  return "unavailable";
}
