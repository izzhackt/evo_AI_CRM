import type { PlatformActor } from "./platform-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const MAX_POSTGRES_BIGINT = "9223372036854775807";
const MAX_PROVIDER_REFERENCE_LENGTH = 512;

const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform communications are unavailable.";

export type PlatformConversationQueue = "sales" | "admissions";
export type PlatformConversationStatus = "open" | "closed";
export type PlatformWahaSessionName = "crm_primary";
// Provider provenance is immutable: old conversations may still name the
// retired session, but only PlatformWahaSessionName is a current runtime target.
export type PlatformMessageDirection = "inbound" | "outbound";
export type PlatformMessageLanguage = "ru" | "en" | "undetermined";
export type PlatformMessageWahaAckName =
  | "ERROR"
  | "PENDING"
  | "SERVER"
  | "DEVICE"
  | "READ"
  | "PLAYED";
export type PlatformMessageMediaKind =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "file";
export type PlatformMessageMediaArchivalStatus =
  | "pending"
  | "processing"
  | "archived"
  | "retryable_error"
  | "terminal_error";

export type PlatformMessageMedia = Readonly<{
  id: string;
  ordinal: number;
  mediaKind: PlatformMessageMediaKind;
  mimeType: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  archivalStatus: PlatformMessageMediaArchivalStatus;
  createdAt: string;
  archivedAt: string | null;
}>;

export type PlatformConversationSummary = Readonly<{
  id: string;
  studentCaseId: string | null;
  queue: PlatformConversationQueue;
  status: PlatformConversationStatus;
  subject: string;
  wahaSessionName: PlatformWahaSessionName;
  kommoAccountId: string | null;
  kommoConversationId: string | null;
  amocrmAccountId: string | null;
  amocrmLeadId: string | null;
  amocrmContactId: string | null;
  createdAt: string;
  sortAt: string;
}>;

export type PlatformConversationMessage = Readonly<{
  id: string;
  conversationId: string;
  direction: PlatformMessageDirection;
  bodyText: string;
  language: PlatformMessageLanguage;
  studentVisible: boolean;
  wahaSessionName: PlatformWahaSessionName | null;
  wahaMessageId: string | null;
  kommoAccountId: string | null;
  kommoConversationId: string | null;
  kommoMessageId: string | null;
  amocrmAccountId: string | null;
  amocrmLeadId: string | null;
  amocrmContactId: string | null;
  createdAt: string;
  media: readonly PlatformMessageMedia[];
  wahaAckName: PlatformMessageWahaAckName | null;
  wahaAckObservedAt: string | null;
}>;

export type PlatformWahaSessionHealth = Readonly<{
  sessionName: PlatformWahaSessionName;
  status: string;
  observedAt: string;
}>;

export type PlatformConversationThread = Readonly<{
  conversation: PlatformConversationSummary;
  messages: readonly PlatformConversationMessage[];
  nextMessageCursor: PlatformConversationCursor | null;
  hasOlderMessages: boolean;
}>;

export type PlatformConversationCursor = Readonly<{
  sortAt: string;
  id: string;
}>;

export type PlatformPageSlice<T> = Readonly<{
  rows: readonly T[];
  nextCursor: PlatformConversationCursor | null;
  hasNext: boolean;
}>;

export type PlatformConversationPageOptions = Readonly<{
  cursor?: PlatformConversationCursor | null;
  pageSize?: number;
  queue?: PlatformConversationQueue;
  status?: PlatformConversationStatus;
}>;

export type PlatformMessagePageOptions = Readonly<{
  cursor?: PlatformConversationCursor | null;
  pageSize?: number;
}>;

type PlatformCommunicationsRpcResponse = Readonly<{
  data: unknown;
  error: unknown;
}>;

type PlatformCommunicationsRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<PlatformCommunicationsRpcResponse>;
  }>;
}>;

export type PlatformCommunicationsDependencies = Readonly<{
  client?: PlatformCommunicationsRpcClient;
}>;

/**
 * The same public error is used for authorization, transport and response
 * validation failures so database and provider identifiers never cross the
 * repository boundary.
 */
export class PlatformCommunicationsRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformCommunicationsRepositoryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlatformRouteUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;

  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

export function isPlatformConversationId(value: string): boolean {
  return parsePlatformRouteUuid(value) !== null;
}

function parseRequiredText(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value;
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

function parseWahaAckName(value: unknown): PlatformMessageWahaAckName | null {
  return value === "ERROR" ||
    value === "PENDING" ||
    value === "SERVER" ||
    value === "DEVICE" ||
    value === "READ" ||
    value === "PLAYED"
    ? value
    : null;
}

function parseWahaAck(
  direction: unknown,
  name: unknown,
  observedAt: unknown,
): Readonly<{
  name: PlatformMessageWahaAckName | null;
  observedAt: string | null;
}> | null {
  if (name === null && observedAt === null) {
    return { name: null, observedAt: null };
  }

  const parsedName = parseWahaAckName(name);
  const parsedObservedAt = parseTimestamp(observedAt);
  if (direction !== "outbound" || parsedName === null || parsedObservedAt === null) {
    return null;
  }

  return { name: parsedName, observedAt: parsedObservedAt };
}

function parseOptionalProviderText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_PROVIDER_REFERENCE_LENGTH
  ) {
    return undefined;
  }
  return normalized;
}

function parseOptionalProviderInteger(
  value: unknown,
): string | null | undefined {
  if (value === null) return null;

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0
      ? String(value)
      : undefined;
  }

  if (
    typeof value === "string" &&
    POSITIVE_INTEGER_PATTERN.test(value) &&
    (value.length < MAX_POSTGRES_BIGINT.length ||
      (value.length === MAX_POSTGRES_BIGINT.length &&
        value <= MAX_POSTGRES_BIGINT))
  ) {
    return value;
  }

  return undefined;
}

function parseOptionalNonNegativeInteger(
  value: unknown,
): number | null | undefined {
  if (value === null) return null;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return value;
  }
  return undefined;
}

function parseRequiredNonNegativeInteger(value: unknown): number | undefined {
  if (value === null) return undefined;
  const parsed = parseOptionalNonNegativeInteger(value);
  return parsed === null ? undefined : parsed;
}

function parseOptionalMimeType(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 255) return undefined;
  return normalized;
}

function parseOptionalFileName(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 255) return undefined;
  return normalized;
}

function parseMediaKind(value: unknown): PlatformMessageMediaKind | null {
  return value === "image" ||
    value === "audio" ||
    value === "video" ||
    value === "pdf" ||
    value === "file"
    ? value
    : null;
}

function parseMediaArchivalStatus(
  value: unknown,
): PlatformMessageMediaArchivalStatus | null {
  return value === "pending" ||
    value === "processing" ||
    value === "archived" ||
    value === "retryable_error" ||
    value === "terminal_error"
    ? value
    : null;
}

function parseMessageMedia(
  value: unknown,
): readonly PlatformMessageMedia[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 16) return null;

  const seenIds = new Set<string>();
  const seenOrdinals = new Set<number>();

  return value.map((entry) => {
    if (!isRecord(entry)) return invalidShape();

    const id = parsePlatformRouteUuid(entry.id);
    const ordinal = parseRequiredNonNegativeInteger(entry.ordinal);
    const mediaKind = parseMediaKind(entry.media_kind);
    const mimeType = parseOptionalMimeType(entry.mime_type);
    const fileName = parseOptionalFileName(entry.file_name);
    const fileSizeBytes = parseOptionalNonNegativeInteger(entry.file_size_bytes);
    const archivalStatus = parseMediaArchivalStatus(entry.archival_status);
    const createdAt = parseTimestamp(entry.created_at);
    const archivedAt =
      entry.archived_at === null ? null : parseTimestamp(entry.archived_at);

    if (
      id === null ||
      ordinal === undefined ||
      mediaKind === null ||
      mimeType === undefined ||
      fileName === undefined ||
      fileSizeBytes === undefined ||
      archivalStatus === null ||
      createdAt === null ||
      archivedAt === undefined ||
      seenIds.has(id) ||
      seenOrdinals.has(ordinal) ||
      (archivalStatus === "archived" && archivedAt === null) ||
      (archivalStatus !== "archived" && archivedAt !== null)
    ) {
      return invalidShape();
    }

    seenIds.add(id);
    seenOrdinals.add(ordinal);

    return Object.freeze({
      id,
      ordinal,
      mediaKind,
      mimeType,
      fileName,
      fileSizeBytes,
      archivalStatus,
      createdAt,
      archivedAt,
    });
  });
}

function invalidShape(): never {
  throw new PlatformCommunicationsRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformCommunicationsRepositoryError) throw error;
  throw new PlatformCommunicationsRepositoryError();
}

function normalizePageSize(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value && value > 0 && value <= 100
    ? value
    : fallback;
}

function compactGetRpcArgs(
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== null && value !== undefined),
  );
}

export function parsePlatformConversationCursor(
  sortAt: unknown,
  id: unknown,
): PlatformConversationCursor | null {
  const parsedSortAt = parseTimestamp(sortAt);
  const parsedId = parsePlatformRouteUuid(id);
  return parsedSortAt && parsedId
    ? Object.freeze({ sortAt: parsedSortAt, id: parsedId })
    : null;
}

export function parsePlatformWahaSessionName(
  value: unknown,
): PlatformWahaSessionName | null {
  return value === "crm_primary" ? value : null;
}

/**
 * Converts the unknown PostgREST row into the only shape accepted by the UI.
 * It is exported so the boundary contract can be unit-tested without a live
 * database.
 */
export function normalizePlatformConversationSummary(
  value: unknown,
): PlatformConversationSummary {
  if (!isRecord(value)) return invalidShape();

  const id = parsePlatformRouteUuid(value.conversation_id);
  const studentCaseId =
    value.student_case_id === null
      ? null
      : parsePlatformRouteUuid(value.student_case_id);
  const subject = parseRequiredText(value.subject);
  const wahaSessionName = parsePlatformWahaSessionName(value.waha_session_name);
  const kommoAccountId = parseOptionalProviderInteger(value.kommo_account_id);
  const kommoConversationId = parseOptionalProviderText(
    value.kommo_conversation_id,
  );
  const amocrmAccountId = parseOptionalProviderInteger(
    value.amocrm_account_id,
  );
  const amocrmLeadId = parseOptionalProviderInteger(value.amocrm_lead_id);
  const amocrmContactId = parseOptionalProviderInteger(
    value.amocrm_contact_id,
  );
  const createdAt = parseTimestamp(value.created_at);
  const sortAt = parseTimestamp(value.sort_at);

  if (
    id === null ||
    (value.student_case_id !== null && studentCaseId === null) ||
    (value.queue !== "sales" && value.queue !== "admissions") ||
    (value.status !== "open" && value.status !== "closed") ||
    subject === null ||
    wahaSessionName === null ||
    kommoAccountId === undefined ||
    kommoConversationId === undefined ||
    amocrmAccountId === undefined ||
    amocrmLeadId === undefined ||
    amocrmContactId === undefined ||
    createdAt === null ||
    sortAt === null
  ) {
    return invalidShape();
  }

  return {
    id,
    studentCaseId,
    queue: value.queue,
    status: value.status,
    subject,
    wahaSessionName,
    kommoAccountId,
    kommoConversationId,
    amocrmAccountId,
    amocrmLeadId,
    amocrmContactId,
    createdAt,
    sortAt,
  };
}

/**
 * Converts and validates one message projection returned by the authenticated
 * platform RPC.
 */
export function normalizePlatformConversationMessage(
  value: unknown,
): PlatformConversationMessage {
  if (!isRecord(value)) return invalidShape();

  const id = parsePlatformRouteUuid(value.message_id);
  const conversationId = parsePlatformRouteUuid(value.conversation_id);
  const bodyText = parseRequiredText(value.body_text);
  const wahaSessionName =
    value.waha_session_name === null
      ? null
      : parsePlatformWahaSessionName(value.waha_session_name);
  const wahaMessageId = parseOptionalProviderText(value.waha_message_id);
  const kommoAccountId = parseOptionalProviderInteger(value.kommo_account_id);
  const kommoConversationId = parseOptionalProviderText(
    value.kommo_conversation_id,
  );
  const kommoMessageId = parseOptionalProviderText(value.kommo_message_id);
  const amocrmAccountId = parseOptionalProviderInteger(
    value.amocrm_account_id,
  );
  const amocrmLeadId = parseOptionalProviderInteger(value.amocrm_lead_id);
  const amocrmContactId = parseOptionalProviderInteger(
    value.amocrm_contact_id,
  );
  const createdAt = parseTimestamp(value.created_at);
  const media = parseMessageMedia(value.media);
  const wahaAck = parseWahaAck(
    value.direction,
    value.waha_ack_name,
    value.waha_ack_observed_at,
  );

  if (
    id === null ||
    conversationId === null ||
    (value.direction !== "inbound" && value.direction !== "outbound") ||
    bodyText === null ||
    (value.language !== "ru" &&
      value.language !== "en" &&
      value.language !== "undetermined") ||
    typeof value.student_visible !== "boolean" ||
    (value.waha_session_name !== null && wahaSessionName === null) ||
    wahaMessageId === undefined ||
    kommoAccountId === undefined ||
    kommoConversationId === undefined ||
    kommoMessageId === undefined ||
    amocrmAccountId === undefined ||
    amocrmLeadId === undefined ||
    amocrmContactId === undefined ||
    createdAt === null ||
    media === null ||
    wahaAck === null
  ) {
    return invalidShape();
  }

  return Object.freeze({
    id,
    conversationId,
    direction: value.direction,
    bodyText,
    language: value.language,
    studentVisible: value.student_visible,
    wahaSessionName,
    wahaMessageId,
    kommoAccountId,
    kommoConversationId,
    kommoMessageId,
    amocrmAccountId,
    amocrmLeadId,
    amocrmContactId,
    createdAt,
    media,
    wahaAckName: wahaAck.name,
    wahaAckObservedAt: wahaAck.observedAt,
  });
}

/**
 * Accepts only the bounded current WAHA health tuple returned by the
 * organization-scoped RPC. Provider payloads and identifiers are never read.
 */
export function normalizePlatformWahaSessionHealth(
  value: unknown,
): PlatformWahaSessionHealth {
  if (!isRecord(value)) return invalidShape();

  const sessionName = parsePlatformWahaSessionName(value.waha_session_name);
  const status = parseRequiredText(value.status);
  const observedAt = parseTimestamp(value.observed_at);
  if (
    sessionName === null ||
    status === null ||
    !/^[A-Z][A-Z0-9_]{0,63}$/.test(status) ||
    observedAt === null
  ) {
    return invalidShape();
  }

  return Object.freeze({ sessionName, status, observedAt });
}

function requireMessagingOrganization(actor: PlatformActor): string {
  if (
    (actor.platformRole !== "admin" &&
      actor.platformRole !== "sales" &&
      actor.platformRole !== "admissions") ||
    parsePlatformRouteUuid(actor.organizationId) === null
  ) {
    return invalidShape();
  }

  return actor.organizationId.toLowerCase();
}

async function getPlatformClient(
  injected?: PlatformCommunicationsRpcClient,
): Promise<PlatformCommunicationsRpcClient> {
  if (injected) return injected;

  // The dynamic import keeps the pure response validators testable in Node.
  // Repository calls still load the request-scoped Next.js server client and
  // can never fall back to the browser client or a service-role credential.
  if (typeof window !== "undefined") return invalidShape();

  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient() as unknown as PlatformCommunicationsRpcClient;
}

function normalizeConversationRows(
  value: unknown,
): PlatformConversationSummary[] {
  if (!Array.isArray(value)) return invalidShape();

  const seenIds = new Set<string>();
  return value.map((row) => {
    const conversation = normalizePlatformConversationSummary(row);
    if (seenIds.has(conversation.id)) return invalidShape();
    seenIds.add(conversation.id);
    return conversation;
  });
}

function normalizeMessageRows(
  value: unknown,
  conversationId: string,
): PlatformConversationMessage[] {
  if (!Array.isArray(value)) return invalidShape();

  const seenIds = new Set<string>();
  return value.map((row) => {
    const message = normalizePlatformConversationMessage(row);
    if (
      message.conversationId !== conversationId ||
      seenIds.has(message.id)
    ) {
      return invalidShape();
    }
    seenIds.add(message.id);
    return message;
  });
}

export async function listPlatformConversations(
  actor: PlatformActor,
  options?: PlatformConversationPageOptions,
  dependencies: PlatformCommunicationsDependencies = {},
): Promise<PlatformPageSlice<PlatformConversationSummary>> {
  try {
    const organizationId = requireMessagingOrganization(actor);
    const client = await getPlatformClient(dependencies.client);
    const pageSize = normalizePageSize(options?.pageSize, 50);
    const cursor = options?.cursor ?? null;
    const response = await client.schema("platform").rpc(
      "staff_communication_page",
      compactGetRpcArgs({
        p_organization_id: organizationId,
        p_limit: pageSize + 1,
        p_before_sort_at: cursor?.sortAt ?? null,
        p_before_conversation_id: cursor?.id ?? null,
        p_queue: options?.queue ?? null,
        p_status: options?.status ?? null,
        p_conversation_id: null,
      }),
      { get: true },
    );

    if (response.error) return invalidShape();

    // The RPC orders by the latest guarded conversation or persisted message,
    // then id. Preserve that authoritative queue order rather than inventing a
    // weaker client-side ordering.
    if (!Array.isArray(response.data)) return invalidShape();
    const seenIds = new Set<string>();
    const normalized = response.data.map((raw) => {
      if (!isRecord(raw)) return invalidShape();
      const row = normalizePlatformConversationSummary(raw);
      const rowCursor = parsePlatformConversationCursor(row.sortAt, row.id);
      if (rowCursor === null || seenIds.has(row.id)) return invalidShape();
      seenIds.add(row.id);
      return Object.freeze({ row, cursor: rowCursor });
    });
    const hasNext = normalized.length > pageSize;
    const page = normalized.slice(0, pageSize);
    return {
      rows: page.map((entry) => entry.row),
      nextCursor: hasNext ? page.at(-1)?.cursor ?? null : null,
      hasNext,
    };
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformConversationThread(
  actor: PlatformActor,
  id: string,
  options?: PlatformMessagePageOptions,
  dependencies: PlatformCommunicationsDependencies = {},
): Promise<PlatformConversationThread | null> {
  try {
    const organizationId = requireMessagingOrganization(actor);
    const conversationId = parsePlatformRouteUuid(id);
    if (conversationId === null) return null;

    const client = await getPlatformClient(dependencies.client);
    const summaryResponse = await client
      .schema("platform")
      .rpc("staff_communication_snapshot", {
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
      }, { get: true });

    if (
      summaryResponse.error ||
      !Array.isArray(summaryResponse.data) ||
      summaryResponse.data.length > 1
    ) {
      return invalidShape();
    }

    const conversations = normalizeConversationRows(summaryResponse.data);
    const conversation = conversations[0] ?? null;

    // Absence from the RLS-scoped queue is deliberately indistinguishable
    // from a nonexistent conversation.
    if (conversation === null) return null;

    const pageSize = normalizePageSize(options?.pageSize, 100);
    const cursor = options?.cursor ?? null;
    const messagesResponse = await client.schema("platform").rpc(
      "staff_conversation_message_page",
      compactGetRpcArgs({
        p_organization_id: organizationId,
        p_conversation_id: conversationId,
        p_limit: pageSize + 1,
        p_before_created_at: cursor?.sortAt ?? null,
        p_before_message_id: cursor?.id ?? null,
      }),
      { get: true },
    );

    if (messagesResponse.error) return invalidShape();

    // The RPC returns newest-first so the keyset can move toward older data.
    // Reverse only the visible page for the transcript's chronological UI.
    const newestFirst = normalizeMessageRows(
      messagesResponse.data,
      conversationId,
    );
    const hasOlderMessages = newestFirst.length > pageSize;
    const pageNewestFirst = newestFirst.slice(0, pageSize);
    const oldestVisible = pageNewestFirst.at(-1);

    return {
      conversation,
      messages: [...pageNewestFirst].reverse(),
      nextMessageCursor: hasOlderMessages && oldestVisible
        ? Object.freeze({ sortAt: oldestVisible.createdAt, id: oldestVisible.id })
        : null,
      hasOlderMessages,
    };
  } catch (error) {
    return failClosed(error);
  }
}

export async function getPlatformWahaSessionHealth(
  actor: PlatformActor,
  sessionName: PlatformWahaSessionName,
): Promise<PlatformWahaSessionHealth | null> {
  try {
    const organizationId = requireMessagingOrganization(actor);
    const requestedSessionName = parsePlatformWahaSessionName(sessionName);
    if (requestedSessionName === null) return invalidShape();
    const client = await getPlatformClient();
    const response = await client
      .schema("platform")
      .rpc("staff_waha_session_health", {
        p_organization_id: organizationId,
        p_waha_session_name: requestedSessionName,
      }, {
        get: true,
      });

    if (response.error || !Array.isArray(response.data) || response.data.length > 1) {
      return invalidShape();
    }

    if (response.data.length === 0) return null;
    const health = normalizePlatformWahaSessionHealth(response.data[0]);
    return health.sessionName === requestedSessionName ? health : invalidShape();
  } catch (error) {
    return failClosed(error);
  }
}
