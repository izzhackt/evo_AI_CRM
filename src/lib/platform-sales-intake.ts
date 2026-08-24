import type { PlatformActor } from "./platform-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const SAFE_REPOSITORY_ERROR_MESSAGE = "Platform Sales intake is unavailable.";
export const PLATFORM_SALES_INTAKE_MAX_PAGE_SIZE = 50;

export const PLATFORM_SALES_INTAKE_STATES = [
  "queued",
  "retrying",
  "received",
  "manual_review",
  "unsupported",
  "terminal_failure",
] as const;

export type PlatformSalesIntakeState =
  (typeof PLATFORM_SALES_INTAKE_STATES)[number];

export type PlatformSalesIntakeCursor = Readonly<{
  sortAt: string;
  workItemId: string;
}>;

export type PlatformSalesIntakeRow = Readonly<{
  sortAt: string;
  workItemId: string;
  state: PlatformSalesIntakeState;
  attemptCount: number;
  availableAt: string;
  providerOccurredAt: string;
  conversationId: string | null;
  canonicalLeadId: string | null;
  canonicalClientId: string | null;
  clientDisplayName: string | null;
  subject: string | null;
  messagePreview: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformSalesIntakePage = Readonly<{
  rows: readonly PlatformSalesIntakeRow[];
  nextCursor: PlatformSalesIntakeCursor | null;
  hasNext: boolean;
}>;

export type PlatformSalesIntakePageOptions = Readonly<{
  cursor?: PlatformSalesIntakeCursor | null;
  pageSize?: number;
  state?: PlatformSalesIntakeState | null;
  query?: string | null;
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformSalesIntakeDependencies = Readonly<{
  client?: RpcClient;
}>;

export class PlatformSalesIntakeRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformSalesIntakeRepositoryError";
  }
}

function invalidShape(): never {
  throw new PlatformSalesIntakeRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformSalesIntakeRepositoryError) throw error;
  throw new PlatformSalesIntakeRepositoryError();
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

function parseOptionalText(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function parseState(value: unknown): PlatformSalesIntakeState | null {
  return PLATFORM_SALES_INTAKE_STATES.find((state) => state === value) ?? null;
}

function requireOrganization(actor: PlatformActor): string {
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

function normalizePageSize(value: number | undefined): number {
  if (value === undefined) return 25;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > PLATFORM_SALES_INTAKE_MAX_PAGE_SIZE
  ) {
    return invalidShape();
  }
  return value;
}

function normalizeQuery(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200) return invalidShape();
  return normalized;
}

function compactArgs(
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== null && value !== undefined),
  );
}

async function getClient(injected?: RpcClient): Promise<RpcClient> {
  if (injected) return injected;
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient() as unknown as RpcClient;
}

export function parsePlatformSalesIntakeCursor(
  sortAt: unknown,
  workItemId: unknown,
): PlatformSalesIntakeCursor | null {
  if (sortAt === undefined && workItemId === undefined) return null;
  const parsedSortAt = parseTimestamp(sortAt);
  const parsedWorkItemId = parseUuid(workItemId);
  if (parsedSortAt === null || parsedWorkItemId === null) return invalidShape();
  return Object.freeze({ sortAt: parsedSortAt, workItemId: parsedWorkItemId });
}

export function normalizePlatformSalesIntakeRow(
  value: unknown,
): PlatformSalesIntakeRow {
  if (!isRecord(value)) return invalidShape();

  const sortAt = parseTimestamp(value.sort_at);
  const workItemId = parseUuid(value.work_item_id);
  const state = parseState(value.intake_state);
  const attemptCount = value.attempt_count;
  const availableAt = parseTimestamp(value.available_at);
  const providerOccurredAt = parseTimestamp(value.provider_occurred_at);
  const conversationId = parseOptionalUuid(value.conversation_id);
  const canonicalLeadId = parseOptionalUuid(value.canonical_lead_id);
  const canonicalClientId = parseOptionalUuid(value.canonical_client_id);
  const clientDisplayName = parseOptionalText(value.client_display_name, 500);
  const subject = parseOptionalText(value.subject, 500);
  const messagePreview = parseOptionalText(value.message_preview, 500);
  const errorCode =
    value.error_code === null
      ? null
      : typeof value.error_code === "string" &&
          ERROR_CODE_PATTERN.test(value.error_code)
        ? value.error_code
        : undefined;
  const createdAt = parseTimestamp(value.created_at);
  const updatedAt = parseTimestamp(value.updated_at);

  const requiresCanonical =
    state === "received" || state === "manual_review";
  if (
    sortAt === null ||
    workItemId === null ||
    state === null ||
    typeof attemptCount !== "number" ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 0 ||
    availableAt === null ||
    providerOccurredAt === null ||
    conversationId === undefined ||
    canonicalLeadId === undefined ||
    canonicalClientId === undefined ||
    clientDisplayName === undefined ||
    subject === undefined ||
    messagePreview === undefined ||
    errorCode === undefined ||
    createdAt === null ||
    updatedAt === null ||
    (requiresCanonical &&
      (conversationId === null ||
        canonicalLeadId === null ||
        canonicalClientId === null ||
        clientDisplayName === null ||
        subject === null ||
        messagePreview === null ||
        errorCode !== null))
  ) {
    return invalidShape();
  }

  return Object.freeze({
    sortAt,
    workItemId,
    state,
    attemptCount,
    availableAt,
    providerOccurredAt,
    conversationId,
    canonicalLeadId,
    canonicalClientId,
    clientDisplayName,
    subject,
    messagePreview,
    errorCode,
    createdAt,
    updatedAt,
  });
}

export async function listPlatformSalesIntake(
  actor: PlatformActor,
  options: PlatformSalesIntakePageOptions = {},
  dependencies: PlatformSalesIntakeDependencies = {},
): Promise<PlatformSalesIntakePage> {
  try {
    const organizationId = requireOrganization(actor);
    const pageSize = normalizePageSize(options.pageSize);
    const cursor =
      options.cursor === null || options.cursor === undefined
        ? null
        : parsePlatformSalesIntakeCursor(
            options.cursor.sortAt,
            options.cursor.workItemId,
          );
    const state =
      options.state === null || options.state === undefined
        ? null
        : parseState(options.state) ?? invalidShape();
    const query = normalizeQuery(options.query);
    const client = await getClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "staff_waha_sales_intake_page",
      compactArgs({
        p_organization_id: organizationId,
        p_limit: pageSize + 1,
        p_before_sort_at: cursor?.sortAt ?? null,
        p_before_work_item_id: cursor?.workItemId ?? null,
        p_state: state,
        p_query: query,
      }),
      { get: true },
    );

    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > pageSize + 1
    ) {
      return invalidShape();
    }

    const seen = new Set<string>();
    let previousCursor: PlatformSalesIntakeCursor | null = null;
    const normalized = response.data.map((raw) => {
      const row = normalizePlatformSalesIntakeRow(raw);
      const rowCursor = Object.freeze({
        sortAt: row.sortAt,
        workItemId: row.workItemId,
      });
      if (seen.has(row.workItemId)) return invalidShape();
      if (state !== null && row.state !== state) return invalidShape();
      if (previousCursor !== null) {
        const timestampOrder =
          timestampMicros(previousCursor.sortAt) - timestampMicros(row.sortAt);
        if (
          timestampOrder < BigInt(0) ||
          (timestampOrder === BigInt(0) &&
            previousCursor.workItemId <= row.workItemId)
        ) {
          return invalidShape();
        }
      }
      seen.add(row.workItemId);
      previousCursor = rowCursor;
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

export async function isPlatformLeadConversationLinked(
  actor: PlatformActor,
  leadIdInput: string,
  conversationIdInput: string,
  dependencies: PlatformSalesIntakeDependencies = {},
): Promise<boolean> {
  try {
    const organizationId = requireOrganization(actor);
    const leadId = parseUuid(leadIdInput);
    const conversationId = parseUuid(conversationIdInput);
    if (leadId === null || conversationId === null) return false;
    const client = await getClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "staff_canonical_lead_conversation_link",
      {
        p_organization_id: organizationId,
        p_lead_id: leadId,
        p_conversation_id: conversationId,
      },
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length !== 1 ||
      !isRecord(response.data[0]) ||
      typeof response.data[0].linked !== "boolean"
    ) {
      return invalidShape();
    }
    return response.data[0].linked;
  } catch (error) {
    return failClosed(error);
  }
}
