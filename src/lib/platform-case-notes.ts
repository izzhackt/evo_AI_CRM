import type { PlatformActor } from "./platform-auth";

/**
 * Repository for append-only human case notes (migration 117).
 *
 * A note belongs to exactly one subject — a lead or a student case — and is
 * never edited or deleted: a correction is a newer note. All reads and writes
 * go through the guarded platform RPCs; this module validates every shape in
 * both directions and fails closed on anything unexpected.
 */

const SAFE_REPOSITORY_ERROR_MESSAGE = "Platform case notes are unavailable.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const REQUEST_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
/**
 * Notes are multi-line prose: newline, carriage return and tab stay allowed
 * while every other control character is rejected — the exact database rule.
 */
const NOTE_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DISPLAY_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const PLATFORM_CASE_NOTE_MAX_BODY_LENGTH = 4000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function hasValidCaseNoteCodePointLength(value: string): boolean {
  let codePointLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const followingCodeUnit = value.charCodeAt(index + 1);
      if (followingCodeUnit < 0xdc00 || followingCodeUnit > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }

    codePointLength += 1;
    if (codePointLength > PLATFORM_CASE_NOTE_MAX_BODY_LENGTH) return false;
  }

  return codePointLength > 0;
}

const NOTE_ROW_KEYS = [
  "organization_id",
  "case_note_id",
  "lead_id",
  "student_case_id",
  "body",
  "created_by_membership_id",
  "author_display_name",
  "created_at",
] as const;

const NOTE_RECEIPT_KEYS = [
  "organization_id",
  "lead_id",
  "student_case_id",
  "body",
  "request_id",
  "case_note_id",
  "created_by_membership_id",
  "created_at",
] as const;

const SUBJECT_KEYS = ["leadId", "studentCaseId"] as const;
const CREATE_INPUT_KEYS = ["subject", "body", "requestId"] as const;

export type PlatformCaseNoteSubject = Readonly<{
  leadId: string | null;
  studentCaseId: string | null;
}>;

export type PlatformCaseNote = Readonly<{
  organizationId: string;
  caseNoteId: string;
  leadId: string | null;
  studentCaseId: string | null;
  body: string;
  createdByMembershipId: string;
  authorDisplayName: string;
  createdAt: string;
}>;

export type PlatformCaseNoteCursor = Readonly<{
  createdAt: string;
  id: string;
}>;

export type PlatformCaseNotePage = Readonly<{
  rows: readonly PlatformCaseNote[];
  nextCursor: PlatformCaseNoteCursor | null;
  hasNext: boolean;
}>;

export type PlatformCaseNotePageOptions = Readonly<{
  cursor?: PlatformCaseNoteCursor | null;
  limit?: number;
}>;

export type PlatformCaseNoteCreateInput = Readonly<{
  subject: PlatformCaseNoteSubject;
  body: string;
  requestId: string;
}>;

export type PlatformCaseNoteReceipt = Readonly<{
  requestId: string;
  organizationId: string;
  leadId: string | null;
  studentCaseId: string | null;
  body: string;
  caseNoteId: string;
  createdByMembershipId: string;
  createdAt: string;
}>;

export type PlatformCaseNoteRepositoryErrorReason = "unavailable";

export type PlatformCaseNoteMutationErrorReason =
  | "invalid"
  | "forbidden"
  | "request_conflict"
  | "unavailable";

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type PlatformCaseNoteRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformCaseNoteRepositoryDependencies = Readonly<{
  client?: PlatformCaseNoteRpcClient;
}>;

export class PlatformCaseNoteRepositoryError extends Error {
  readonly reason: PlatformCaseNoteRepositoryErrorReason = "unavailable";

  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformCaseNoteRepositoryError";
  }
}

export class PlatformCaseNoteMutationError extends Error {
  readonly reason: PlatformCaseNoteMutationErrorReason;

  constructor(reason: PlatformCaseNoteMutationErrorReason) {
    super("Platform case note write failed.");
    this.name = "PlatformCaseNoteMutationError";
    this.reason = reason;
  }
}

function invalidShape(): never {
  throw new PlatformCaseNoteRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformCaseNoteRepositoryError) throw error;
  return invalidShape();
}

function mutationFailure(reason: PlatformCaseNoteMutationErrorReason): never {
  throw new PlatformCaseNoteMutationError(reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function requireExactRecord(
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, expected)) return invalidShape();
  return value;
}

export function parsePlatformCaseNoteUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function requiredUuid(value: unknown): string {
  return parsePlatformCaseNoteUuid(value) ?? invalidShape();
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function parseTimestamp(value: unknown): string | null {
  return typeof value === "string" &&
      TIMESTAMPTZ_PATTERN.test(value) &&
      Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function requiredTimestamp(value: unknown): string {
  return parseTimestamp(value) ?? invalidShape();
}

function timestampEpochMicroseconds(value: string): bigint {
  const match = TIMESTAMPTZ_PATTERN.exec(value);
  const dateTime = match?.[1];
  const offset = match?.[3];
  if (!dateTime || !offset) return invalidShape();

  const epochMilliseconds = Date.parse(`${dateTime}${offset}`);
  if (!Number.isSafeInteger(epochMilliseconds)) return invalidShape();

  const fractionalMicroseconds = (match[2] ?? "").padEnd(6, "0");
  return BigInt(epochMilliseconds) * BigInt(1_000) +
    BigInt(fractionalMicroseconds || "0");
}

function compareCaseNoteKeys(
  left: PlatformCaseNoteCursor,
  right: PlatformCaseNoteCursor,
): number {
  const leftCreatedAt = timestampEpochMicroseconds(left.createdAt);
  const rightCreatedAt = timestampEpochMicroseconds(right.createdAt);
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt < rightCreatedAt ? -1 : 1;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function parsePlatformCaseNoteBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !hasValidCaseNoteCodePointLength(normalized) ||
    NOTE_CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function requiredDisplayText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    DISPLAY_CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return invalidShape();
  }
  return normalized;
}

function requiredNoteBody(value: unknown): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    value !== normalized ||
    !hasValidCaseNoteCodePointLength(normalized) ||
    NOTE_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

export function parsePlatformCaseNoteSubject(
  value: unknown,
): PlatformCaseNoteSubject | null {
  if (!isRecord(value) || !hasExactKeys(value, SUBJECT_KEYS)) return null;
  const leadId =
    value.leadId === null ? null : parsePlatformCaseNoteUuid(value.leadId);
  const studentCaseId = value.studentCaseId === null
    ? null
    : parsePlatformCaseNoteUuid(value.studentCaseId);
  if (
    (value.leadId !== null && leadId === null) ||
    (value.studentCaseId !== null && studentCaseId === null) ||
    (leadId === null) === (studentCaseId === null)
  ) {
    return null;
  }
  return Object.freeze({ leadId, studentCaseId });
}

export function parsePlatformCaseNoteCursor(
  createdAt: unknown,
  id: unknown,
): PlatformCaseNoteCursor | null {
  const normalizedCreatedAt = parseTimestamp(createdAt);
  const normalizedId = parsePlatformCaseNoteUuid(id);
  return normalizedCreatedAt && normalizedId
    ? Object.freeze({ createdAt: normalizedCreatedAt, id: normalizedId })
    : null;
}

function requireSubject(value: unknown): PlatformCaseNoteSubject {
  return parsePlatformCaseNoteSubject(value) ?? invalidShape();
}

function normalizeCursor(
  value: PlatformCaseNoteCursor | null | undefined,
): PlatformCaseNoteCursor | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["createdAt", "id"])) {
    return invalidShape();
  }
  return parsePlatformCaseNoteCursor(value.createdAt, value.id) ??
    invalidShape();
}

function normalizePageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_PAGE_SIZE
    ? value
    : invalidShape();
}

function requireActorOrganization(actor: PlatformActor): string {
  if (!isRecord(actor)) return invalidShape();
  return requiredUuid(actor.organizationId);
}

function normalizeNoteRow(
  value: unknown,
  organizationId: string,
  subject: PlatformCaseNoteSubject,
): PlatformCaseNote {
  const raw = requireExactRecord(value, NOTE_ROW_KEYS);
  const leadId = optionalUuid(raw.lead_id);
  const studentCaseId = optionalUuid(raw.student_case_id);
  if (
    requiredUuid(raw.organization_id) !== organizationId ||
    leadId !== subject.leadId ||
    studentCaseId !== subject.studentCaseId
  ) {
    return invalidShape();
  }
  return Object.freeze({
    organizationId,
    caseNoteId: requiredUuid(raw.case_note_id),
    leadId,
    studentCaseId,
    body: requiredNoteBody(raw.body),
    createdByMembershipId: requiredUuid(raw.created_by_membership_id),
    authorDisplayName: requiredDisplayText(raw.author_display_name, 500),
    createdAt: requiredTimestamp(raw.created_at),
  });
}

async function getPlatformClient(): Promise<PlatformCaseNoteRpcClient> {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return await createSupabaseServerClient() as unknown as
    PlatformCaseNoteRpcClient;
}

export async function readCaseNotes(
  actor: PlatformActor,
  subject: PlatformCaseNoteSubject,
  options: PlatformCaseNotePageOptions = {},
  dependencies: PlatformCaseNoteRepositoryDependencies = {},
): Promise<PlatformCaseNotePage> {
  try {
    const organizationId = requireActorOrganization(actor);
    const normalizedSubject = requireSubject(subject);
    const pageSize = normalizePageSize(options.limit);
    const cursor = normalizeCursor(options.cursor);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "list_case_notes",
      {
        p_lead_id: normalizedSubject.leadId,
        p_student_case_id: normalizedSubject.studentCaseId,
        p_limit: pageSize + 1,
        ...(cursor
          ? {
              p_before_created_at: cursor.createdAt,
              p_before_note_id: cursor.id,
            }
          : {}),
      },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > pageSize + 1
    ) {
      return invalidShape();
    }

    const seenNoteIds = new Set<string>();
    const normalized = response.data.map((value) => {
      const row = normalizeNoteRow(value, organizationId, normalizedSubject);
      if (seenNoteIds.has(row.caseNoteId)) return invalidShape();
      seenNoteIds.add(row.caseNoteId);
      return row;
    });
    let previousKey = cursor;
    for (const row of normalized) {
      const currentKey = {
        createdAt: row.createdAt,
        id: row.caseNoteId,
      };
      if (previousKey && compareCaseNoteKeys(currentKey, previousKey) >= 0) {
        return invalidShape();
      }
      previousKey = currentKey;
    }
    const hasNext = normalized.length > pageSize;
    const page = normalized.slice(0, pageSize);
    const lastRow = page.at(-1) ?? null;
    return Object.freeze({
      rows: Object.freeze(page),
      nextCursor: hasNext && lastRow
        ? Object.freeze({
            createdAt: lastRow.createdAt,
            id: lastRow.caseNoteId,
          })
        : null,
      hasNext,
    });
  } catch (error) {
    return failClosed(error);
  }
}

function normalizeCreateInput(
  value: PlatformCaseNoteCreateInput,
): PlatformCaseNoteCreateInput {
  if (!isRecord(value) || !hasExactKeys(value, CREATE_INPUT_KEYS)) {
    return mutationFailure("invalid");
  }
  const subject = parsePlatformCaseNoteSubject(value.subject);
  const body = parsePlatformCaseNoteBody(value.body);
  const requestId =
    typeof value.requestId === "string" &&
      REQUEST_UUID_PATTERN.test(value.requestId)
      ? value.requestId.toLowerCase()
      : null;
  if (!subject || !body || !requestId) return mutationFailure("invalid");
  return Object.freeze({ subject, body, requestId });
}

function mutationErrorFromRpc(error: unknown): PlatformCaseNoteMutationError {
  if (!isRecord(error)) {
    return new PlatformCaseNoteMutationError("unavailable");
  }
  const code = typeof error.code === "string" ? error.code : null;
  const message =
    typeof error.message === "string" ? error.message.trim() : "";
  const reason: PlatformCaseNoteMutationErrorReason = code === "42501"
    ? "forbidden"
    : code === "22023" && message.includes("was already used")
      ? "request_conflict"
      : code === "22023"
        ? "invalid"
        : "unavailable";
  return new PlatformCaseNoteMutationError(reason);
}

function normalizeReceipt(
  value: unknown,
  actorOrganizationId: string,
  input: PlatformCaseNoteCreateInput,
): PlatformCaseNoteReceipt {
  const raw = requireExactRecord(value, NOTE_RECEIPT_KEYS);
  const organizationId = requiredUuid(raw.organization_id);
  const leadId = optionalUuid(raw.lead_id);
  const studentCaseId = optionalUuid(raw.student_case_id);
  const body = requiredNoteBody(raw.body);
  const requestId = requiredUuid(raw.request_id);
  if (
    organizationId !== actorOrganizationId ||
    leadId !== input.subject.leadId ||
    studentCaseId !== input.subject.studentCaseId ||
    body !== input.body ||
    requestId !== input.requestId
  ) {
    return invalidShape();
  }
  return Object.freeze({
    requestId,
    organizationId,
    leadId,
    studentCaseId,
    body,
    caseNoteId: requiredUuid(raw.case_note_id),
    createdByMembershipId: requiredUuid(raw.created_by_membership_id),
    createdAt: requiredTimestamp(raw.created_at),
  });
}

export async function createCaseNote(
  actor: PlatformActor,
  input: PlatformCaseNoteCreateInput,
  dependencies: PlatformCaseNoteRepositoryDependencies = {},
): Promise<PlatformCaseNoteReceipt> {
  let normalizedInput: PlatformCaseNoteCreateInput;
  let organizationId: string;
  try {
    organizationId = requireActorOrganization(actor);
    normalizedInput = normalizeCreateInput(input);
  } catch (error) {
    if (error instanceof PlatformCaseNoteMutationError) throw error;
    throw new PlatformCaseNoteMutationError("unavailable");
  }

  try {
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc("create_case_note", {
      p_organization_id: organizationId,
      p_lead_id: normalizedInput.subject.leadId,
      p_student_case_id: normalizedInput.subject.studentCaseId,
      p_body: normalizedInput.body,
      p_request_id: normalizedInput.requestId,
    });
    if (response.error) throw mutationErrorFromRpc(response.error);
    return normalizeReceipt(response.data, organizationId, normalizedInput);
  } catch (error) {
    if (error instanceof PlatformCaseNoteMutationError) throw error;
    throw new PlatformCaseNoteMutationError("unavailable");
  }
}
