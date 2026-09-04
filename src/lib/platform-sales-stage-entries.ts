import type { PlatformActor } from "./platform-auth.ts";
import {
  PLATFORM_SALES_STAGES,
  type PlatformSalesStage,
} from "./platform-sales-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ROW_KEYS = [
  "organization_id",
  "lead_id",
  "stage_key",
  "entered_at",
  "entered_on",
  "request_id",
] as const;
const MAX_COHORT_DAYS = 366;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const ENTRY_DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bishkek",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type PlatformSalesStageEntryClient = Readonly<{
  schema(schema: "platform"): Readonly<{
    rpc(
      functionName: string,
      args: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ): PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformSalesStageEntry = Readonly<{
  organizationId: string;
  leadId: string;
  stageKey: PlatformSalesStage;
  enteredAt: string;
  enteredOn: string;
  requestId: string;
}>;

export type PlatformSalesStageEntryCursor = Readonly<{
  enteredAt: string;
  requestId: string;
}>;

export type PlatformSalesStageEntryPage = Readonly<{
  rows: readonly PlatformSalesStageEntry[];
  nextCursor: PlatformSalesStageEntryCursor | null;
  hasNext: boolean;
}>;

export type PlatformSalesStageEntryPageOptions = Readonly<{
  from: string;
  to: string;
  pageSize?: number;
  cursor?: PlatformSalesStageEntryCursor | null;
}>;

export type PlatformSalesStageEntryDependencies = Readonly<{
  client?: PlatformSalesStageEntryClient;
}>;

export class PlatformSalesStageEntryError extends Error {
  constructor() {
    super("Platform sales stage history is unavailable.");
    this.name = "PlatformSalesStageEntryError";
  }
}

function invalid(): never {
  throw new PlatformSalesStageEntryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...ROW_KEYS].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return invalid();
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? invalid() : normalized;
}

function date(value: unknown): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return invalid();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : invalid();
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMPTZ_PATTERN.test(value)) return invalid();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? invalid() : value;
}

function organizationDate(value: string): string {
  const formatted = ENTRY_DATE_PARTS.formatToParts(new Date(value));
  const year = formatted.find((part) => part.type === "year")?.value;
  const month = formatted.find((part) => part.type === "month")?.value;
  const day = formatted.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : invalid();
}

function timestampMicroseconds(value: string): bigint {
  const fraction = value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1]
    ?.padEnd(6, "0") ?? "000000";
  return BigInt(new Date(value).getTime()) * BigInt(1_000) + BigInt(fraction.slice(3));
}

function compareCursors(
  left: PlatformSalesStageEntryCursor,
  right: PlatformSalesStageEntryCursor,
): number {
  const leftMicroseconds = timestampMicroseconds(left.enteredAt);
  const rightMicroseconds = timestampMicroseconds(right.enteredAt);
  return leftMicroseconds !== rightMicroseconds
    ? leftMicroseconds < rightMicroseconds ? -1 : 1
    : left.requestId.localeCompare(right.requestId);
}

function stage(value: unknown): PlatformSalesStage {
  return typeof value === "string"
    && (PLATFORM_SALES_STAGES as readonly string[]).includes(value)
    ? value as PlatformSalesStage
    : invalid();
}

function pageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_PAGE_SIZE
    ? value
    : invalid();
}

function cohortDays(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay))
      / 86_400_000,
  ) + 1;
}

export function normalizePlatformSalesStageEntry(
  value: unknown,
  expectedOrganizationId: string,
): PlatformSalesStageEntry {
  if (!isRecord(value) || !exactKeys(value)) return invalid();
  const organizationId = uuid(value.organization_id);
  if (organizationId !== uuid(expectedOrganizationId)) return invalid();
  const enteredAt = timestamp(value.entered_at);
  const enteredOn = date(value.entered_on);
  if (organizationDate(enteredAt) !== enteredOn) return invalid();
  return Object.freeze({
    organizationId,
    leadId: uuid(value.lead_id),
    stageKey: stage(value.stage_key),
    enteredAt,
    enteredOn,
    requestId: uuid(value.request_id),
  });
}

export function parsePlatformSalesStageEntryCursor(
  enteredAt: unknown,
  requestId: unknown,
): PlatformSalesStageEntryCursor | null {
  const normalizedEnteredAt = timestamp(enteredAt);
  const normalizedRequestId = uuid(requestId);
  return Object.freeze({
    enteredAt: normalizedEnteredAt,
    requestId: normalizedRequestId,
  });
}

function normalizeCursor(
  value: PlatformSalesStageEntryCursor | null | undefined,
): PlatformSalesStageEntryCursor | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return invalid();
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "enteredAt" || keys[1] !== "requestId") {
    return invalid();
  }
  return parsePlatformSalesStageEntryCursor(value.enteredAt, value.requestId);
}

async function getPlatformClient(): Promise<PlatformSalesStageEntryClient> {
  if (typeof window !== "undefined") return invalid();
  const { createSupabaseServerClient } = await import("./supabase/server.ts");
  return createSupabaseServerClient() as unknown as PlatformSalesStageEntryClient;
}

export async function listPlatformSalesStageEntries(
  actor: PlatformActor,
  options: PlatformSalesStageEntryPageOptions,
  dependencies: PlatformSalesStageEntryDependencies = {},
): Promise<PlatformSalesStageEntryPage> {
  try {
    const organizationId = uuid(actor.organizationId);
    const normalizedFrom = date(options.from);
    const normalizedTo = date(options.to);
    const normalizedPageSize = pageSize(options.pageSize);
    const normalizedCursor = normalizeCursor(options.cursor);
    const days = cohortDays(normalizedFrom, normalizedTo);
    if (
      (actor.platformRole !== "admin" && actor.platformRole !== "sales")
      || days < 1
      || days > MAX_COHORT_DAYS
    ) {
      return invalid();
    }

    const client = dependencies.client ?? await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_sales_stage_entry_cohort",
      {
        p_from_date: normalizedFrom,
        p_to_date: normalizedTo,
        p_limit: normalizedPageSize + 1,
        ...(normalizedCursor
          ? {
              p_cursor_entered_at: normalizedCursor.enteredAt,
              p_cursor_request_id: normalizedCursor.requestId,
            }
          : {}),
      },
      { get: true },
    );
    if (
      response.error !== null
      || !Array.isArray(response.data)
      || response.data.length > normalizedPageSize + 1
    ) {
      return invalid();
    }

    const seenIdentities = new Set<string>();
    const normalized = [];
    let previousCursor = normalizedCursor;
    for (const row of response.data) {
      const entry = normalizePlatformSalesStageEntry(row, organizationId);
      const identity = `${entry.leadId}:${entry.stageKey}`;
      if (seenIdentities.has(identity)) return invalid();
      seenIdentities.add(identity);
      const cursor = parsePlatformSalesStageEntryCursor(entry.enteredAt, entry.requestId);
      if (
        cursor === null
        || cursor.enteredAt !== entry.enteredAt
        || cursor.requestId !== entry.requestId
        || (previousCursor !== null && compareCursors(cursor, previousCursor) <= 0)
      ) {
        return invalid();
      }
      normalized.push(Object.freeze({ entry, cursor }));
      previousCursor = cursor;
    }
    const pageEntries = normalized.slice(0, normalizedPageSize);
    const hasNext = normalized.length > normalizedPageSize;
    return Object.freeze({
      rows: Object.freeze(pageEntries.map((row) => row.entry)),
      nextCursor: hasNext ? pageEntries.at(-1)?.cursor ?? null : null,
      hasNext,
    });
  } catch (error) {
    if (error instanceof PlatformSalesStageEntryError) throw error;
    return invalid();
  }
}
