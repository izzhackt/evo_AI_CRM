import type { PlatformActor } from "./platform-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const MAX_DETAIL_REFERENCES = 25;
export const PLATFORM_CANONICAL_MAX_PAGE_SIZE = 50;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform canonical records are unavailable.";

export const PLATFORM_CANONICAL_CLIENT_LIFECYCLE_STATES = [
  "active",
  "inactive",
  "merged",
] as const;

export const PLATFORM_CANONICAL_LEAD_LIFECYCLE_STATES = [
  "open",
  "converted",
  "disqualified",
  "archived",
] as const;

export type PlatformCanonicalClientLifecycleState =
  (typeof PLATFORM_CANONICAL_CLIENT_LIFECYCLE_STATES)[number];
export type PlatformCanonicalLeadLifecycleState =
  (typeof PLATFORM_CANONICAL_LEAD_LIFECYCLE_STATES)[number];

export type PlatformCanonicalCursor = Readonly<{
  updatedAt: string;
  id: string;
}>;

export type PlatformCanonicalLeadSummary = Readonly<{
  organizationId: string;
  id: string;
  clientId: string | null;
  clientDisplayName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  currentOwnerMembershipId: string | null;
  currentOwnerDisplayName: string | null;
  stageKey: string;
  sourceKey: string;
  lifecycleState: PlatformCanonicalLeadLifecycleState;
  openDuplicateCandidateCount: number;
  hasOpenDuplicateCandidates: boolean;
  linkedStudentCaseCount: number;
  linkedConversationCount: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformCanonicalClientSummary = Readonly<{
  organizationId: string;
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  lifecycleState: PlatformCanonicalClientLifecycleState;
  openDuplicateCandidateCount: number;
  hasOpenDuplicateCandidates: boolean;
  linkedLeadCount: number;
  linkedStudentCaseCount: number;
  linkedConversationCount: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformCanonicalExternalIdentifier = Readonly<{
  id: string;
  sourceSystem: string;
  externalObjectType: string;
  externalIdentifier: string;
  observedAt: string;
  importedAt: string | null;
  sourceRef: string | null;
}>;

export type PlatformCanonicalProvenance = Readonly<{
  id: string;
  sourceSystem: string;
  evidenceType: string;
  observedAt: string;
  importedAt: string | null;
  sourceRef: string | null;
  recordedAt: string;
}>;

export type PlatformCanonicalLinkedStudentCase = Readonly<{
  id: string;
  studentDisplayName: string;
  operationalStage: string;
  state: "pending" | "active" | "closed";
  updatedAt: string;
}>;

export type PlatformCanonicalLinkedConversation = Readonly<{
  id: string;
  subject: string;
  queue: "sales" | "curator";
  status: "open" | "closed";
  updatedAt: string;
}>;

export type PlatformCanonicalLinkedLead = Readonly<{
  id: string;
  stageKey: string;
  lifecycleState: PlatformCanonicalLeadLifecycleState;
  sourceKey: string;
  currentOwnerMembershipId: string | null;
  currentOwnerDisplayName: string | null;
  updatedAt: string;
}>;

export type PlatformCanonicalLeadDetail = PlatformCanonicalLeadSummary &
  Readonly<{
    externalIdentifiers: readonly PlatformCanonicalExternalIdentifier[];
    provenance: readonly PlatformCanonicalProvenance[];
    linkedStudentCases: readonly PlatformCanonicalLinkedStudentCase[];
    linkedConversations: readonly PlatformCanonicalLinkedConversation[];
  }>;

export type PlatformCanonicalClientDetail = PlatformCanonicalClientSummary &
  Readonly<{
    externalIdentifiers: readonly PlatformCanonicalExternalIdentifier[];
    provenance: readonly PlatformCanonicalProvenance[];
    linkedLeads: readonly PlatformCanonicalLinkedLead[];
    linkedStudentCases: readonly PlatformCanonicalLinkedStudentCase[];
    linkedConversations: readonly PlatformCanonicalLinkedConversation[];
  }>;

export type PlatformCanonicalPage<T> = Readonly<{
  rows: readonly T[];
  nextCursor: PlatformCanonicalCursor | null;
  hasNext: boolean;
}>;

export type PlatformCanonicalLeadPageOptions = Readonly<{
  cursor?: PlatformCanonicalCursor | null;
  pageSize?: number;
  stageKey?: string;
  lifecycleState?: PlatformCanonicalLeadLifecycleState;
  query?: string;
}>;

export type PlatformCanonicalClientPageOptions = Readonly<{
  cursor?: PlatformCanonicalCursor | null;
  pageSize?: number;
  lifecycleState?: PlatformCanonicalClientLifecycleState;
  query?: string;
}>;

type PlatformCanonicalRpcResponse = Readonly<{
  data: unknown;
  error: unknown;
}>;

type PlatformCanonicalRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<PlatformCanonicalRpcResponse>;
  }>;
}>;

export type PlatformCanonicalRecordsDependencies = Readonly<{
  client?: PlatformCanonicalRpcClient;
}>;

/**
 * Authorization, transport, and response-shape failures deliberately share a
 * single public error so database details do not escape the server boundary.
 */
export class PlatformCanonicalRecordsRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformCanonicalRecordsRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformCanonicalRecordsRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformCanonicalRecordsRepositoryError) throw error;
  throw new PlatformCanonicalRecordsRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function parseOptionalUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parseUuid(value) ?? undefined;
}

function parseTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return null;
  }
  return value;
}

function timestampMicros(value: string): bigint {
  const fraction = /(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/
    .exec(value)?.[1]
    ?.padEnd(6, "0") ?? "000000";
  return BigInt(Date.parse(value)) * BigInt(1_000) + BigInt(fraction.slice(3));
}

function compareTimestamps(left: string, right: string): -1 | 0 | 1 {
  const leftMicros = timestampMicros(left);
  const rightMicros = timestampMicros(right);
  return leftMicros < rightMicros ? -1 : leftMicros > rightMicros ? 1 : 0;
}

function parseRequiredText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : null;
}

function parseOptionalText(
  value: unknown,
  maxLength = 500,
): string | null | undefined {
  if (value === null) return null;
  return parseRequiredText(value, maxLength) ?? undefined;
}

function parseOptionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parseTimestamp(value) ?? undefined;
}

function parseKey(value: unknown): string | null {
  return typeof value === "string" && KEY_PATTERN.test(value) ? value : null;
}

function parseNonNegativeCount(value: unknown): number | null {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : null;
}

function parseLeadLifecycleState(
  value: unknown,
): PlatformCanonicalLeadLifecycleState | null {
  return value === "open" ||
      value === "converted" ||
      value === "disqualified" ||
      value === "archived"
    ? value
    : null;
}

function parseClientLifecycleState(
  value: unknown,
): PlatformCanonicalClientLifecycleState | null {
  return value === "active" || value === "inactive" || value === "merged"
    ? value
    : null;
}

function normalizePageSize(value: number | undefined): number {
  if (value === undefined) return PLATFORM_CANONICAL_MAX_PAGE_SIZE;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > PLATFORM_CANONICAL_MAX_PAGE_SIZE
  ) {
    return invalidShape();
  }
  return value;
}

function normalizeCursorOption(
  value: PlatformCanonicalCursor | null | undefined,
): PlatformCanonicalCursor | null {
  if (value == null) return null;
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, "updatedAt") ||
    !Object.hasOwn(value, "id")
  ) {
    return invalidShape();
  }
  return parsePlatformCanonicalCursor(value.updatedAt, value.id) ?? invalidShape();
}

function normalizeOptionalKey(value: unknown): string | null {
  if (value === undefined) return null;
  return parseKey(value) ?? invalidShape();
}

function normalizeOptionalLeadLifecycleState(
  value: unknown,
): PlatformCanonicalLeadLifecycleState | null {
  if (value === undefined) return null;
  return parseLeadLifecycleState(value) ?? invalidShape();
}

function normalizeOptionalClientLifecycleState(
  value: unknown,
): PlatformCanonicalClientLifecycleState | null {
  if (value === undefined) return null;
  return parseClientLifecycleState(value) ?? invalidShape();
}

function normalizeOptionalQuery(value: unknown): string | null {
  if (value === undefined) return null;
  return parseRequiredText(value, 200) ?? invalidShape();
}

function compactGetRpcArgs(
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== null && value !== undefined),
  );
}

function requireCanonicalOrganization(actor: PlatformActor): string {
  const organizationId = parseUuid(actor.organizationId);
  if (
    organizationId === null ||
    (actor.platformRole !== "admin" &&
      actor.platformRole !== "sales" &&
      actor.platformRole !== "curator")
  ) {
    return invalidShape();
  }
  return organizationId;
}

async function getPlatformClient(
  injected?: PlatformCanonicalRpcClient,
): Promise<PlatformCanonicalRpcClient> {
  if (injected) return injected;
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient() as unknown as PlatformCanonicalRpcClient;
}

function assertDescendingCursors(
  previous: PlatformCanonicalCursor,
  current: PlatformCanonicalCursor,
): void {
  const timestampOrder = compareTimestamps(previous.updatedAt, current.updatedAt);
  if (
    timestampOrder < 0 ||
    (timestampOrder === 0 && previous.id <= current.id)
  ) {
    return invalidShape();
  }
}

function parseBoundedArray<T>(
  value: unknown,
  parser: (entry: unknown) => T,
  idOf: (entry: T) => string,
  sortAtOf: (entry: T) => string,
): readonly T[] {
  if (!Array.isArray(value) || value.length > MAX_DETAIL_REFERENCES) {
    return invalidShape();
  }

  const seenIds = new Set<string>();
  const parsed = value.map((entry) => {
    const normalized = parser(entry);
    const id = idOf(normalized);
    if (seenIds.has(id)) return invalidShape();
    seenIds.add(id);
    return normalized;
  });

  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];
    if (!previous || !current) return invalidShape();
    const timestampOrder = compareTimestamps(
      sortAtOf(previous),
      sortAtOf(current),
    );
    if (
      timestampOrder < 0 ||
      (timestampOrder === 0 && idOf(previous) <= idOf(current))
    ) {
      return invalidShape();
    }
  }

  return Object.freeze(parsed);
}

function normalizeExternalIdentifier(
  value: unknown,
): PlatformCanonicalExternalIdentifier {
  if (!isRecord(value)) return invalidShape();
  const id = parseUuid(value.id);
  const sourceSystem = parseKey(value.source_system);
  const externalObjectType = parseKey(value.external_object_type);
  const externalIdentifier = parseRequiredText(value.external_identifier, 512);
  const observedAt = parseTimestamp(value.observed_at);
  const importedAt = parseOptionalTimestamp(value.imported_at);
  const sourceRef = parseOptionalText(value.source_ref, 1_024);
  if (
    id === null ||
    sourceSystem === null ||
    externalObjectType === null ||
    externalIdentifier === null ||
    observedAt === null ||
    importedAt === undefined ||
    sourceRef === undefined ||
    (importedAt !== null && compareTimestamps(importedAt, observedAt) < 0)
  ) {
    return invalidShape();
  }
  return Object.freeze({
    id,
    sourceSystem,
    externalObjectType,
    externalIdentifier,
    observedAt,
    importedAt,
    sourceRef,
  });
}

function normalizeProvenance(value: unknown): PlatformCanonicalProvenance {
  if (!isRecord(value)) return invalidShape();
  const id = parseUuid(value.id);
  const sourceSystem = parseKey(value.source_system);
  const evidenceType = parseKey(value.evidence_type);
  const observedAt = parseTimestamp(value.observed_at);
  const importedAt = parseOptionalTimestamp(value.imported_at);
  const sourceRef = parseOptionalText(value.source_ref, 1_024);
  const recordedAt = parseTimestamp(value.recorded_at);
  if (
    id === null ||
    sourceSystem === null ||
    evidenceType === null ||
    observedAt === null ||
    importedAt === undefined ||
    sourceRef === undefined ||
    recordedAt === null ||
    (importedAt !== null && compareTimestamps(importedAt, observedAt) < 0)
  ) {
    return invalidShape();
  }
  return Object.freeze({
    id,
    sourceSystem,
    evidenceType,
    observedAt,
    importedAt,
    sourceRef,
    recordedAt,
  });
}

function normalizeLinkedStudentCase(
  value: unknown,
): PlatformCanonicalLinkedStudentCase {
  if (!isRecord(value)) return invalidShape();
  const id = parseUuid(value.student_case_id);
  const studentDisplayName = parseRequiredText(value.student_display_name, 500);
  const operationalStage = parseKey(value.operational_stage);
  const updatedAt = parseTimestamp(value.updated_at);
  if (
    id === null ||
    studentDisplayName === null ||
    operationalStage === null ||
    (value.state !== "pending" &&
      value.state !== "active" &&
      value.state !== "closed") ||
    updatedAt === null
  ) {
    return invalidShape();
  }
  return Object.freeze({
    id,
    studentDisplayName,
    operationalStage,
    state: value.state,
    updatedAt,
  });
}

function normalizeLinkedConversation(
  value: unknown,
): PlatformCanonicalLinkedConversation {
  if (!isRecord(value)) return invalidShape();
  const id = parseUuid(value.conversation_id);
  const subject = parseRequiredText(value.subject, 500);
  const updatedAt = parseTimestamp(value.updated_at);
  if (
    id === null ||
    subject === null ||
    (value.queue !== "sales" && value.queue !== "curator") ||
    (value.status !== "open" && value.status !== "closed") ||
    updatedAt === null
  ) {
    return invalidShape();
  }
  return Object.freeze({
    id,
    subject,
    queue: value.queue,
    status: value.status,
    updatedAt,
  });
}

function normalizeLinkedLead(value: unknown): PlatformCanonicalLinkedLead {
  if (!isRecord(value)) return invalidShape();
  const id = parseUuid(value.lead_id);
  const stageKey = parseKey(value.stage_key);
  const lifecycleState = parseLeadLifecycleState(value.lifecycle_state);
  const sourceKey = parseKey(value.source_key);
  const currentOwnerMembershipId = parseOptionalUuid(
    value.current_owner_membership_id,
  );
  const currentOwnerDisplayName = parseOptionalText(
    value.current_owner_display_name,
    500,
  );
  const updatedAt = parseTimestamp(value.updated_at);
  if (
    id === null ||
    stageKey === null ||
    lifecycleState === null ||
    sourceKey === null ||
    currentOwnerMembershipId === undefined ||
    currentOwnerDisplayName === undefined ||
    updatedAt === null ||
    (currentOwnerMembershipId === null
      ? currentOwnerDisplayName !== null
      : currentOwnerDisplayName === null)
  ) {
    return invalidShape();
  }
  return Object.freeze({
    id,
    stageKey,
    lifecycleState,
    sourceKey,
    currentOwnerMembershipId,
    currentOwnerDisplayName,
    updatedAt,
  });
}

function parseExternalIdentifiers(
  value: unknown,
): readonly PlatformCanonicalExternalIdentifier[] {
  return parseBoundedArray(
    value,
    normalizeExternalIdentifier,
    (entry) => entry.id,
    (entry) => entry.observedAt,
  );
}

function parseProvenance(
  value: unknown,
): readonly PlatformCanonicalProvenance[] {
  return parseBoundedArray(
    value,
    normalizeProvenance,
    (entry) => entry.id,
    (entry) => entry.observedAt,
  );
}

function parseLinkedStudentCases(
  value: unknown,
): readonly PlatformCanonicalLinkedStudentCase[] {
  return parseBoundedArray(
    value,
    normalizeLinkedStudentCase,
    (entry) => entry.id,
    (entry) => entry.updatedAt,
  );
}

function parseLinkedConversations(
  value: unknown,
): readonly PlatformCanonicalLinkedConversation[] {
  return parseBoundedArray(
    value,
    normalizeLinkedConversation,
    (entry) => entry.id,
    (entry) => entry.updatedAt,
  );
}

function parseLinkedLeads(
  value: unknown,
): readonly PlatformCanonicalLinkedLead[] {
  return parseBoundedArray(
    value,
    normalizeLinkedLead,
    (entry) => entry.id,
    (entry) => entry.updatedAt,
  );
}

export function parsePlatformCanonicalCursor(
  updatedAt: unknown,
  id: unknown,
): PlatformCanonicalCursor | null {
  if (updatedAt === null && id === null) return null;

  const parsedUpdatedAt = parseTimestamp(updatedAt);
  const parsedId = parseUuid(id);
  if (parsedUpdatedAt === null || parsedId === null) return invalidShape();

  return Object.freeze({ updatedAt: parsedUpdatedAt, id: parsedId });
}

export function normalizePlatformCanonicalLeadSummary(
  value: unknown,
): PlatformCanonicalLeadSummary {
  if (!isRecord(value)) return invalidShape();

  const organizationId = parseUuid(value.organization_id);
  const id = parseUuid(value.lead_id);
  const clientId = parseOptionalUuid(value.client_id);
  const clientDisplayName = parseOptionalText(value.client_display_name, 500);
  const clientEmail = parseOptionalText(value.client_email, 320);
  const clientPhone = parseOptionalText(value.client_phone, 64);
  const currentOwnerMembershipId = parseOptionalUuid(
    value.current_owner_membership_id,
  );
  const currentOwnerDisplayName = parseOptionalText(
    value.current_owner_display_name,
    500,
  );
  const stageKey = parseKey(value.stage_key);
  const sourceKey = parseKey(value.source_key);
  const lifecycleState = parseLeadLifecycleState(value.lifecycle_state);
  const openDuplicateCandidateCount = parseNonNegativeCount(
    value.open_duplicate_candidate_count,
  );
  const linkedStudentCaseCount = parseNonNegativeCount(
    value.linked_student_case_count,
  );
  const linkedConversationCount = parseNonNegativeCount(
    value.linked_conversation_count,
  );
  const createdAt = parseTimestamp(value.created_at);
  const updatedAt = parseTimestamp(value.updated_at);
  const sortAt = value.sort_at === undefined
    ? updatedAt
    : parseTimestamp(value.sort_at);

  if (
    organizationId === null ||
    id === null ||
    clientId === undefined ||
    clientDisplayName === undefined ||
    clientEmail === undefined ||
    clientPhone === undefined ||
    currentOwnerMembershipId === undefined ||
    currentOwnerDisplayName === undefined ||
    stageKey === null ||
    sourceKey === null ||
    lifecycleState === null ||
    openDuplicateCandidateCount === null ||
    linkedStudentCaseCount === null ||
    linkedConversationCount === null ||
    createdAt === null ||
    updatedAt === null ||
    sortAt === null ||
    compareTimestamps(updatedAt, createdAt) < 0 ||
    compareTimestamps(sortAt, updatedAt) !== 0 ||
    (clientId === null
      ? clientDisplayName !== null || clientEmail !== null || clientPhone !== null
      : clientDisplayName === null) ||
    (currentOwnerMembershipId === null
      ? currentOwnerDisplayName !== null
      : currentOwnerDisplayName === null)
  ) {
    return invalidShape();
  }

  return Object.freeze({
    organizationId,
    id,
    clientId,
    clientDisplayName,
    clientEmail,
    clientPhone,
    currentOwnerMembershipId,
    currentOwnerDisplayName,
    stageKey,
    sourceKey,
    lifecycleState,
    openDuplicateCandidateCount,
    hasOpenDuplicateCandidates: openDuplicateCandidateCount > 0,
    linkedStudentCaseCount,
    linkedConversationCount,
    createdAt,
    updatedAt,
  });
}

export function normalizePlatformCanonicalClientSummary(
  value: unknown,
): PlatformCanonicalClientSummary {
  if (!isRecord(value)) return invalidShape();

  const organizationId = parseUuid(value.organization_id);
  const id = parseUuid(value.client_id);
  const displayName = parseRequiredText(value.display_name, 500);
  const email = parseOptionalText(value.email, 320);
  const phone = parseOptionalText(value.phone, 64);
  const lifecycleState = parseClientLifecycleState(value.lifecycle_state);
  const openDuplicateCandidateCount = parseNonNegativeCount(
    value.open_duplicate_candidate_count,
  );
  const linkedLeadCount = parseNonNegativeCount(value.linked_lead_count);
  const linkedStudentCaseCount = parseNonNegativeCount(
    value.linked_student_case_count,
  );
  const linkedConversationCount = parseNonNegativeCount(
    value.linked_conversation_count,
  );
  const createdAt = parseTimestamp(value.created_at);
  const updatedAt = parseTimestamp(value.updated_at);
  const sortAt = value.sort_at === undefined
    ? updatedAt
    : parseTimestamp(value.sort_at);

  if (
    organizationId === null ||
    id === null ||
    displayName === null ||
    email === undefined ||
    phone === undefined ||
    lifecycleState === null ||
    openDuplicateCandidateCount === null ||
    linkedLeadCount === null ||
    linkedStudentCaseCount === null ||
    linkedConversationCount === null ||
    createdAt === null ||
    updatedAt === null ||
    sortAt === null ||
    compareTimestamps(updatedAt, createdAt) < 0 ||
    compareTimestamps(sortAt, updatedAt) !== 0
  ) {
    return invalidShape();
  }

  return Object.freeze({
    organizationId,
    id,
    displayName,
    email,
    phone,
    lifecycleState,
    openDuplicateCandidateCount,
    hasOpenDuplicateCandidates: openDuplicateCandidateCount > 0,
    linkedLeadCount,
    linkedStudentCaseCount,
    linkedConversationCount,
    createdAt,
    updatedAt,
  });
}

export function normalizePlatformCanonicalLeadDetail(
  value: unknown,
): PlatformCanonicalLeadDetail {
  if (!isRecord(value)) return invalidShape();
  const summary = normalizePlatformCanonicalLeadSummary(value);
  const externalIdentifiers = parseExternalIdentifiers(
    value.external_identifiers,
  );
  const provenance = parseProvenance(value.provenance);
  const linkedStudentCases = parseLinkedStudentCases(value.linked_student_cases);
  const linkedConversations = parseLinkedConversations(
    value.linked_conversations,
  );

  if (
    summary.linkedStudentCaseCount < linkedStudentCases.length ||
    summary.linkedConversationCount < linkedConversations.length
  ) {
    return invalidShape();
  }

  return Object.freeze({
    ...summary,
    externalIdentifiers,
    provenance,
    linkedStudentCases,
    linkedConversations,
  });
}

export function normalizePlatformCanonicalClientDetail(
  value: unknown,
): PlatformCanonicalClientDetail {
  if (!isRecord(value)) return invalidShape();
  const summary = normalizePlatformCanonicalClientSummary(value);
  const externalIdentifiers = parseExternalIdentifiers(
    value.external_identifiers,
  );
  const provenance = parseProvenance(value.provenance);
  const linkedLeads = parseLinkedLeads(value.linked_leads);
  const linkedStudentCases = parseLinkedStudentCases(value.linked_student_cases);
  const linkedConversations = parseLinkedConversations(
    value.linked_conversations,
  );

  if (
    summary.linkedLeadCount < linkedLeads.length ||
    summary.linkedStudentCaseCount < linkedStudentCases.length ||
    summary.linkedConversationCount < linkedConversations.length
  ) {
    return invalidShape();
  }

  return Object.freeze({
    ...summary,
    externalIdentifiers,
    provenance,
    linkedLeads,
    linkedStudentCases,
    linkedConversations,
  });
}

export async function listPlatformCanonicalLeads(
  actor: PlatformActor,
  options?: PlatformCanonicalLeadPageOptions,
  dependencies: PlatformCanonicalRecordsDependencies = {},
): Promise<PlatformCanonicalPage<PlatformCanonicalLeadSummary>> {
  try {
    const organizationId = requireCanonicalOrganization(actor);
    const pageSize = normalizePageSize(options?.pageSize);
    const cursor = normalizeCursorOption(options?.cursor);
    const stageKey = normalizeOptionalKey(options?.stageKey);
    const lifecycleState = normalizeOptionalLeadLifecycleState(
      options?.lifecycleState,
    );
    const query = normalizeOptionalQuery(options?.query);
    const client = await getPlatformClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "staff_canonical_lead_page",
      compactGetRpcArgs({
        p_limit: pageSize + 1,
        p_before_sort_at: cursor?.updatedAt ?? null,
        p_before_lead_id: cursor?.id ?? null,
        p_stage_key: stageKey,
        p_lifecycle_state: lifecycleState,
        p_query: query,
      }),
      { get: true },
    );
    const data = response.data;

    if (
      response.error ||
      !Array.isArray(data) ||
      data.length > pageSize + 1
    ) {
      return invalidShape();
    }

    const seenIds = new Set<string>();
    const normalized = data.map((raw, index) => {
      if (!isRecord(raw)) return invalidShape();
      const row = normalizePlatformCanonicalLeadSummary(raw);
      const rowCursor = parsePlatformCanonicalCursor(raw.sort_at, raw.lead_id);
      if (
        rowCursor === null ||
        row.organizationId !== organizationId ||
        seenIds.has(row.id) ||
        (stageKey !== null && row.stageKey !== stageKey) ||
        (lifecycleState !== null && row.lifecycleState !== lifecycleState)
      ) {
        return invalidShape();
      }
      const previous = normalizedCursorAt(data, index - 1);
      if (previous !== null) assertDescendingCursors(previous, rowCursor);
      seenIds.add(row.id);
      return Object.freeze({ row, cursor: rowCursor });
    });

    const hasNext = normalized.length > pageSize;
    const visible = normalized.slice(0, pageSize);
    return Object.freeze({
      rows: Object.freeze(visible.map((entry) => entry.row)),
      nextCursor: hasNext ? visible.at(-1)?.cursor ?? null : null,
      hasNext,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformCanonicalClients(
  actor: PlatformActor,
  options?: PlatformCanonicalClientPageOptions,
  dependencies: PlatformCanonicalRecordsDependencies = {},
): Promise<PlatformCanonicalPage<PlatformCanonicalClientSummary>> {
  try {
    const organizationId = requireCanonicalOrganization(actor);
    const pageSize = normalizePageSize(options?.pageSize);
    const cursor = normalizeCursorOption(options?.cursor);
    const lifecycleState = normalizeOptionalClientLifecycleState(
      options?.lifecycleState,
    );
    const query = normalizeOptionalQuery(options?.query);
    const client = await getPlatformClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "staff_canonical_client_page",
      compactGetRpcArgs({
        p_limit: pageSize + 1,
        p_before_sort_at: cursor?.updatedAt ?? null,
        p_before_client_id: cursor?.id ?? null,
        p_lifecycle_state: lifecycleState,
        p_query: query,
      }),
      { get: true },
    );
    const data = response.data;

    if (
      response.error ||
      !Array.isArray(data) ||
      data.length > pageSize + 1
    ) {
      return invalidShape();
    }

    const seenIds = new Set<string>();
    const normalized = data.map((raw, index) => {
      if (!isRecord(raw)) return invalidShape();
      const row = normalizePlatformCanonicalClientSummary(raw);
      const rowCursor = parsePlatformCanonicalCursor(raw.sort_at, raw.client_id);
      if (
        rowCursor === null ||
        row.organizationId !== organizationId ||
        seenIds.has(row.id) ||
        (lifecycleState !== null && row.lifecycleState !== lifecycleState)
      ) {
        return invalidShape();
      }
      const previous = normalizedCursorAt(data, index - 1);
      if (previous !== null) assertDescendingCursors(previous, rowCursor);
      seenIds.add(row.id);
      return Object.freeze({ row, cursor: rowCursor });
    });

    const hasNext = normalized.length > pageSize;
    const visible = normalized.slice(0, pageSize);
    return Object.freeze({
      rows: Object.freeze(visible.map((entry) => entry.row)),
      nextCursor: hasNext ? visible.at(-1)?.cursor ?? null : null,
      hasNext,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformCanonicalLead(
  actor: PlatformActor,
  id: string,
  dependencies: PlatformCanonicalRecordsDependencies = {},
): Promise<PlatformCanonicalLeadDetail | null> {
  try {
    const organizationId = requireCanonicalOrganization(actor);
    const leadId = parseUuid(id);
    if (leadId === null) return null;
    const client = await getPlatformClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "staff_canonical_lead_detail",
      { p_lead_id: leadId },
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
    const detail = normalizePlatformCanonicalLeadDetail(response.data[0]);
    if (detail.id !== leadId || detail.organizationId !== organizationId) {
      return invalidShape();
    }
    return detail;
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformCanonicalClient(
  actor: PlatformActor,
  id: string,
  dependencies: PlatformCanonicalRecordsDependencies = {},
): Promise<PlatformCanonicalClientDetail | null> {
  try {
    const organizationId = requireCanonicalOrganization(actor);
    const clientId = parseUuid(id);
    if (clientId === null) return null;
    const client = await getPlatformClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "staff_canonical_client_detail",
      { p_client_id: clientId },
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
    const detail = normalizePlatformCanonicalClientDetail(response.data[0]);
    if (detail.id !== clientId || detail.organizationId !== organizationId) {
      return invalidShape();
    }
    return detail;
  } catch (error) {
    return failClosed(error);
  }
}

function normalizedCursorAt(
  rows: readonly unknown[],
  index: number,
): PlatformCanonicalCursor | null {
  if (index < 0) return null;
  const row = rows[index];
  if (!isRecord(row)) return invalidShape();
  return parsePlatformCanonicalCursor(row.sort_at, row.lead_id ?? row.client_id);
}
