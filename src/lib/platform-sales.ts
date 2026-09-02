import type { PlatformActor } from "./platform-auth";

const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform sales data is unavailable.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WORKFLOW_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_DETAIL_PROJECTION_ITEMS = 25;

export const PLATFORM_SALES_STAGES = [
  "new",
  "contacting",
  "qualified",
  "meeting_scheduled",
  "meeting_completed",
  "potential",
] as const;

export const PLATFORM_SALES_DUE_FILTERS = [
  "all",
  "scheduled",
  "unscheduled",
  "due_today",
  "overdue",
] as const;

export const PLATFORM_SALES_CONNECTION_FILTERS = [
  "all",
  "connected",
  "unconnected",
] as const;

export const PLATFORM_SALES_ASSIGNMENT_FILTERS = [
  "all",
  "mine",
  "unassigned",
] as const;

const PLATFORM_SALES_CONVERSATION_QUEUES = ["sales", "curator"] as const;
const PLATFORM_SALES_CONVERSATION_STATUSES = ["open", "closed"] as const;

const QUEUE_ROW_KEYS = [
  "sort_at",
  "organization_id",
  "lead_id",
  "client_id",
  "client_display_name",
  "client_email",
  "client_phone",
  "current_owner_membership_id",
  "current_owner_display_name",
  "stage_key",
  "source_key",
  "lifecycle_state",
  "next_action_text",
  "next_action_due_date",
  "workflow_version",
  "is_connected",
  "open_duplicate_candidate_count",
  "linked_student_case_count",
  "linked_conversation_count",
  "created_at",
  "updated_at",
] as const;

const DETAIL_ROW_KEYS = [
  ...QUEUE_ROW_KEYS.filter((key) => key !== "sort_at"),
  "external_identifiers",
  "provenance",
  "linked_student_cases",
  "linked_conversations",
] as const;

const LINKED_CONVERSATION_KEYS = [
  "conversation_id",
  "subject",
  "queue",
  "status",
  "updated_at",
] as const;

const LEAD_CONVERSATION_LINK_KEYS = ["linked"] as const;

export type PlatformSalesStage = (typeof PLATFORM_SALES_STAGES)[number];
export type PlatformSalesDueFilter =
  (typeof PLATFORM_SALES_DUE_FILTERS)[number];
export type PlatformSalesConnectionFilter =
  (typeof PLATFORM_SALES_CONNECTION_FILTERS)[number];
export type PlatformSalesAssignmentFilter =
  (typeof PLATFORM_SALES_ASSIGNMENT_FILTERS)[number];
export type PlatformSalesRepositoryErrorReason = "unavailable";

export type PlatformSalesCursor = Readonly<{
  updatedAt: string;
  id: string;
}>;

export type PlatformSalesLeadRow = Readonly<{
  organizationId: string;
  leadId: string;
  clientId: string | null;
  clientDisplayName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  currentOwnerMembershipId: string | null;
  currentOwnerDisplayName: string | null;
  stageKey: PlatformSalesStage;
  sourceKey: string;
  lifecycleState: "open";
  nextActionText: string | null;
  nextActionDueDate: string | null;
  workflowVersion: string;
  isConnected: boolean;
  openDuplicateCandidateCount: number;
  linkedStudentCaseCount: number;
  linkedConversationCount: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformSalesLinkedConversation = Readonly<{
  conversationId: string;
  subject: string;
  queue: (typeof PLATFORM_SALES_CONVERSATION_QUEUES)[number];
  status: (typeof PLATFORM_SALES_CONVERSATION_STATUSES)[number];
  updatedAt: string;
}>;

export type PlatformSalesLeadDetail = Readonly<
  PlatformSalesLeadRow & {
    linkedConversations: readonly PlatformSalesLinkedConversation[];
  }
>;

export type PlatformSalesLeadQueuePage = Readonly<{
  rows: readonly PlatformSalesLeadRow[];
  nextCursor: PlatformSalesCursor | null;
  hasNext: boolean;
}>;

export type PlatformSalesLeadPage = PlatformSalesLeadQueuePage;

export type PlatformSalesLeadPageOptions = Readonly<{
  cursor?: PlatformSalesCursor | null;
  pageSize?: number;
  connectionFilter?: PlatformSalesConnectionFilter;
  stageFilter?: PlatformSalesStage | "all";
  assignmentFilter?: PlatformSalesAssignmentFilter;
  ownerMembershipId?: string | null;
  dueFilter?: PlatformSalesDueFilter;
  query?: string;
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type PlatformSalesRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformSalesRepositoryDependencies = Readonly<{
  client?: PlatformSalesRpcClient;
}>;

export class PlatformSalesRepositoryError extends Error {
  readonly reason: PlatformSalesRepositoryErrorReason = "unavailable";

  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformSalesRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformSalesRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformSalesRepositoryError) throw error;
  return invalidShape();
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

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return invalidShape();
  }
  return value as T[number];
}

export function parsePlatformSalesStage(
  value: unknown,
): PlatformSalesStage | null {
  return typeof value === "string" &&
      PLATFORM_SALES_STAGES.includes(value as PlatformSalesStage)
    ? (value as PlatformSalesStage)
    : null;
}

export function parsePlatformSalesDueFilter(
  value: unknown,
): PlatformSalesDueFilter | null {
  return typeof value === "string" &&
      PLATFORM_SALES_DUE_FILTERS.includes(value as PlatformSalesDueFilter)
    ? (value as PlatformSalesDueFilter)
    : null;
}

export function parsePlatformSalesUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function requiredUuid(value: unknown): string {
  return parsePlatformSalesUuid(value) ?? invalidShape();
}

function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}

function parseTimestamp(value: unknown): string | null {
  return typeof value === "string" &&
      TIMESTAMPTZ_PATTERN.test(value) &&
      parseDate(value.slice(0, 10)) !== null &&
      Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function requiredTimestamp(value: unknown): string {
  return parseTimestamp(value) ?? invalidShape();
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function optionalDate(value: unknown): string | null {
  return value === null ? null : parseDate(value) ?? invalidShape();
}

function parsePostgresBigint(value: unknown, allowZero: boolean): string | null {
  const candidate =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : null;
  if (
    candidate === null ||
    !/^(?:0|[1-9]\d*)$/.test(candidate) ||
    (!allowZero && candidate === "0") ||
    candidate.length > POSTGRES_BIGINT_MAX.length ||
    (candidate.length === POSTGRES_BIGINT_MAX.length &&
      candidate > POSTGRES_BIGINT_MAX)
  ) {
    return null;
  }
  return candidate;
}

function positiveBigint(value: unknown): string {
  return parsePostgresBigint(value, false) ?? invalidShape();
}

function nonNegativeBigintCount(value: unknown): number {
  const parsed = parsePostgresBigint(value, true);
  if (parsed === null) return invalidShape();
  const asBigint = BigInt(parsed);
  if (asBigint > BigInt(Number.MAX_SAFE_INTEGER)) return invalidShape();
  return Number(asBigint);
}

function requiredBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalidShape();
}

function requiredText(value: unknown, maximumLength = 10_000): string {
  if (typeof value !== "string") return invalidShape();
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return invalidShape();
  }
  return normalized;
}

function optionalText(
  value: unknown,
  maximumLength = 10_000,
): string | null {
  return value === null ? null : requiredText(value, maximumLength);
}

function requiredWorkflowKey(value: unknown): string {
  if (typeof value !== "string" || !WORKFLOW_KEY_PATTERN.test(value)) {
    return invalidShape();
  }
  return value;
}

export function parsePlatformSalesCursor(
  updatedAt: unknown,
  id: unknown,
): PlatformSalesCursor | null {
  const normalizedUpdatedAt = parseTimestamp(updatedAt);
  const normalizedId = parsePlatformSalesUuid(id);
  return normalizedUpdatedAt && normalizedId
    ? Object.freeze({ updatedAt: normalizedUpdatedAt, id: normalizedId })
    : null;
}

function normalizePageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_PAGE_SIZE
    ? value
    : invalidShape();
}

function normalizeQuery(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || CONTROL_CHARACTER_PATTERN.test(value)) {
    return invalidShape();
  }
  const normalized = value.trim();
  if (normalized.length > 200) return invalidShape();
  return normalized || null;
}

function normalizeCursor(
  value: PlatformSalesCursor | null | undefined,
): PlatformSalesCursor | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["updatedAt", "id"])) {
    return invalidShape();
  }
  return parsePlatformSalesCursor(value.updatedAt, value.id) ?? invalidShape();
}

function requireActorOrganization(actor: PlatformActor): string {
  if (!isRecord(actor)) return invalidShape();
  return requiredUuid(actor.organizationId);
}

function normalizeClientProjection(
  clientIdValue: unknown,
  displayNameValue: unknown,
  emailValue: unknown,
  phoneValue: unknown,
): Readonly<{
  clientId: string | null;
  clientDisplayName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
}> {
  const clientId = optionalUuid(clientIdValue);
  const clientDisplayName = optionalText(displayNameValue, 500);
  const clientEmail = optionalText(emailValue, 500);
  const clientPhone = optionalText(phoneValue, 100);
  if (
    (clientId === null &&
      (clientDisplayName !== null || clientEmail !== null || clientPhone !== null)) ||
    (clientId !== null && clientDisplayName === null)
  ) {
    return invalidShape();
  }
  return Object.freeze({
    clientId,
    clientDisplayName,
    clientEmail,
    clientPhone,
  });
}

function normalizeOwnerProjection(
  membershipIdValue: unknown,
  displayNameValue: unknown,
): Readonly<{
  currentOwnerMembershipId: string | null;
  currentOwnerDisplayName: string | null;
}> {
  const currentOwnerMembershipId = optionalUuid(membershipIdValue);
  const currentOwnerDisplayName = optionalText(displayNameValue, 500);
  if ((currentOwnerMembershipId === null) !== (currentOwnerDisplayName === null)) {
    return invalidShape();
  }
  return Object.freeze({ currentOwnerMembershipId, currentOwnerDisplayName });
}

function normalizeLeadRow(
  value: Record<string, unknown>,
  organizationId: string,
): PlatformSalesLeadRow {
  const parsedOrganizationId = requiredUuid(value.organization_id);
  if (parsedOrganizationId !== organizationId) return invalidShape();
  const client = normalizeClientProjection(
    value.client_id,
    value.client_display_name,
    value.client_email,
    value.client_phone,
  );
  const owner = normalizeOwnerProjection(
    value.current_owner_membership_id,
    value.current_owner_display_name,
  );
  const nextActionText = optionalText(value.next_action_text, 500);
  const nextActionDueDate = optionalDate(value.next_action_due_date);
  if ((nextActionText === null) !== (nextActionDueDate === null)) {
    return invalidShape();
  }
  const stageKey = parsePlatformSalesStage(value.stage_key) ?? invalidShape();
  if (value.lifecycle_state !== "open") return invalidShape();

  return Object.freeze({
    organizationId,
    leadId: requiredUuid(value.lead_id),
    ...client,
    ...owner,
    stageKey,
    sourceKey: requiredWorkflowKey(value.source_key),
    lifecycleState: "open",
    nextActionText,
    nextActionDueDate,
    workflowVersion: positiveBigint(value.workflow_version),
    isConnected: requiredBoolean(value.is_connected),
    openDuplicateCandidateCount: nonNegativeBigintCount(
      value.open_duplicate_candidate_count,
    ),
    linkedStudentCaseCount: nonNegativeBigintCount(
      value.linked_student_case_count,
    ),
    linkedConversationCount: nonNegativeBigintCount(
      value.linked_conversation_count,
    ),
    createdAt: requiredTimestamp(value.created_at),
    updatedAt: requiredTimestamp(value.updated_at),
  });
}

function requireBoundedRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_DETAIL_PROJECTION_ITEMS ||
    value.some((item) => !isRecord(item))
  ) {
    return invalidShape();
  }
  return value;
}

function normalizeLinkedConversations(
  value: unknown,
): readonly PlatformSalesLinkedConversation[] {
  const projections = requireBoundedRecordArray(value);
  const seenIds = new Set<string>();
  return Object.freeze(
    projections.map((projection) => {
      const row = requireExactRecord(projection, LINKED_CONVERSATION_KEYS);
      const conversationId = requiredUuid(row.conversation_id);
      if (seenIds.has(conversationId)) return invalidShape();
      seenIds.add(conversationId);
      return Object.freeze({
        conversationId,
        subject: requiredText(row.subject),
        queue: oneOf(row.queue, PLATFORM_SALES_CONVERSATION_QUEUES),
        status: oneOf(row.status, PLATFORM_SALES_CONVERSATION_STATUSES),
        updatedAt: requiredTimestamp(row.updated_at),
      });
    }),
  );
}

async function getPlatformClient(): Promise<PlatformSalesRpcClient> {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient() as unknown as PlatformSalesRpcClient;
}

export async function listPlatformSalesLeads(
  actor: PlatformActor,
  options: PlatformSalesLeadPageOptions = {},
  dependencies: PlatformSalesRepositoryDependencies = {},
): Promise<PlatformSalesLeadQueuePage> {
  try {
    const organizationId = requireActorOrganization(actor);
    const pageSize = normalizePageSize(options.pageSize);
    const cursor = normalizeCursor(options.cursor);
    const connectionFilter = oneOf(
      options.connectionFilter ?? "all",
      PLATFORM_SALES_CONNECTION_FILTERS,
    );
    const stageFilter = options.stageFilter ?? "all";
    if (
      stageFilter !== "all" &&
      parsePlatformSalesStage(stageFilter) === null
    ) {
      return invalidShape();
    }
    const assignmentFilter = oneOf(
      options.assignmentFilter ?? "all",
      PLATFORM_SALES_ASSIGNMENT_FILTERS,
    );
    const ownerMembershipId =
      options.ownerMembershipId === null ||
      options.ownerMembershipId === undefined
        ? null
        : requiredUuid(options.ownerMembershipId);
    const dueFilter =
      parsePlatformSalesDueFilter(options.dueFilter ?? "all") ?? invalidShape();
    const query = normalizeQuery(options.query);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_sales_lead_page",
      {
        p_limit: pageSize + 1,
        p_connection_filter: connectionFilter,
        p_stage_filter: stageFilter,
        p_assignment_filter: assignmentFilter,
        p_due_filter: dueFilter,
        ...(cursor
          ? {
              p_cursor_updated_at: cursor.updatedAt,
              p_cursor_id: cursor.id,
            }
          : {}),
        ...(ownerMembershipId
          ? { p_owner_membership_id: ownerMembershipId }
          : {}),
        ...(query ? { p_query: query } : {}),
      },
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > pageSize + 1
    ) {
      return invalidShape();
    }

    const seenLeadIds = new Set<string>();
    const normalized = response.data.map((value) => {
      const raw = requireExactRecord(value, QUEUE_ROW_KEYS);
      const row = normalizeLeadRow(raw, organizationId);
      const rowCursor = parsePlatformSalesCursor(raw.sort_at, row.leadId);
      if (
        rowCursor === null ||
        rowCursor.updatedAt !== row.updatedAt ||
        seenLeadIds.has(row.leadId)
      ) {
        return invalidShape();
      }
      seenLeadIds.add(row.leadId);
      return Object.freeze({ row, cursor: rowCursor });
    });
    const hasNext = normalized.length > pageSize;
    const page = normalized.slice(0, pageSize);
    return Object.freeze({
      rows: Object.freeze(page.map((entry) => entry.row)),
      nextCursor: hasNext ? page.at(-1)?.cursor ?? null : null,
      hasNext,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformSalesLead(
  actor: PlatformActor,
  leadId: string,
  dependencies: PlatformSalesRepositoryDependencies = {},
): Promise<PlatformSalesLeadDetail | null> {
  try {
    const organizationId = requireActorOrganization(actor);
    const normalizedLeadId = requiredUuid(leadId);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_sales_lead_detail",
      { p_lead_id: normalizedLeadId },
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > 1
    ) {
      return invalidShape();
    }
    if (response.data.length === 0) return null;

    const raw = requireExactRecord(response.data[0], DETAIL_ROW_KEYS);
    const row = normalizeLeadRow(raw, organizationId);
    if (row.leadId !== normalizedLeadId) return invalidShape();
    requireBoundedRecordArray(raw.external_identifiers);
    requireBoundedRecordArray(raw.provenance);
    requireBoundedRecordArray(raw.linked_student_cases);
    const linkedConversations = normalizeLinkedConversations(
      raw.linked_conversations,
    );
    if (linkedConversations.length > row.linkedConversationCount) {
      return invalidShape();
    }
    return Object.freeze({ ...row, linkedConversations });
  } catch (error) {
    return failClosed(error);
  }
}

export async function isPlatformLeadConversationLinked(
  actor: PlatformActor,
  leadId: string,
  conversationId: string,
  dependencies: PlatformSalesRepositoryDependencies = {},
): Promise<boolean> {
  try {
    const organizationId = requireActorOrganization(actor);
    const normalizedLeadId = requiredUuid(leadId);
    const normalizedConversationId = requiredUuid(conversationId);
    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_canonical_lead_conversation_link",
      {
        p_organization_id: organizationId,
        p_lead_id: normalizedLeadId,
        p_conversation_id: normalizedConversationId,
      },
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length !== 1
    ) {
      return invalidShape();
    }

    const row = requireExactRecord(
      response.data[0],
      LEAD_CONVERSATION_LINK_KEYS,
    );
    return requiredBoolean(row.linked);
  } catch (error) {
    return failClosed(error);
  }
}
