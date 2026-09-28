import { staffCan, staffHasPermission } from "../platform-access.ts";
import type { PlatformAdmissionsTaskQueueRow } from "../platform-admissions-task-contract.ts";
import {
  normalizePlatformAdmissionsTaskQueueRow,
  parsePlatformAdmissionsTaskQueueCursor,
} from "../platform-admissions-workspace.ts";
import type { PlatformActor } from "../platform-auth.ts";
import { platformTaskDeadlineSortTime } from "../platform-task-deadline.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const UNDATED_SENTINEL_MS = platformTaskDeadlineSortTime(null, null);

export type CalendarUndatedTaskCursor = Readonly<{
  sortAt: string;
  caseTaskId: string;
}>;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

export type CalendarRpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type CalendarContractDependencies = Readonly<{
  client?: CalendarRpcClient;
}>;

/**
 * Что календарь может читать. Сроков подачи в вузы в календаре нет (решение
 * владельца 28.09: они только в «Университетах»); «Сегодня» (`today-source.ts`)
 * их с 28.09 тоже не читает — того чтения здесь больше нет.
 */
export type CalendarReadAccess = Readonly<{ tasks: boolean }>;

export class CalendarContractError extends Error {
  constructor() {
    super("V3 calendar data is unavailable.");
    this.name = "CalendarContractError";
  }
}

function invalidShape(): never {
  throw new CalendarContractError();
}

function failClosed(error: unknown): never {
  if (error instanceof CalendarContractError) throw error;
  throw new CalendarContractError();
}

function requiredUuid(value: unknown): string {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : invalidShape();
}

function pageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_PAGE_SIZE
    ? value
    : invalidShape();
}

type TimestampOrderKey = Readonly<{
  milliseconds: number;
  subMillisecondMicroseconds: number;
}>;

/** Preserve PostgreSQL's six-digit fractional precision without BigInt output. */
function timestampOrderKey(value: string): TimestampOrderKey {
  const match = TIMESTAMPTZ_PATTERN.exec(value);
  const milliseconds = Date.parse(value);
  if (match === null || !Number.isFinite(milliseconds)) return invalidShape();
  const microseconds = (match[1] ?? "").padEnd(6, "0");
  return Object.freeze({
    milliseconds,
    subMillisecondMicroseconds: Number(microseconds.slice(3)),
  });
}

function compareTimestampKeys(left: TimestampOrderKey, right: TimestampOrderKey): number {
  if (left.milliseconds !== right.milliseconds) {
    return left.milliseconds < right.milliseconds ? -1 : 1;
  }
  if (left.subMillisecondMicroseconds === right.subMillisecondMicroseconds) {
    return 0;
  }
  return left.subMillisecondMicroseconds < right.subMillisecondMicroseconds ? -1 : 1;
}

function isUndatedSentinel(value: string): boolean {
  const key = timestampOrderKey(value);
  return key.milliseconds === UNDATED_SENTINEL_MS &&
    key.subMillisecondMicroseconds === 0;
}

function requireCalendarActor(actor: PlatformActor): string {
  if (!staffCan(actor, "admissions.read")) {
    return invalidShape();
  }
  return requiredUuid(actor.organizationId);
}

function requireCalendarPermission(actor: PlatformActor, permission: "task.manage" | "application.manage"): string {
  const organizationId = permission === "task.manage" ? requiredUuid(actor.organizationId) : requireCalendarActor(actor);
  if (!staffHasPermission(actor, permission)) return invalidShape();
  return organizationId;
}

export function parseCalendarUndatedTaskCursor(
  sortAt: unknown,
  caseTaskId: unknown,
): CalendarUndatedTaskCursor | null {
  const cursor = parsePlatformAdmissionsTaskQueueCursor(sortAt, caseTaskId);
  return cursor !== null && isUndatedSentinel(cursor.sortAt)
    ? Object.freeze({ sortAt: cursor.sortAt, caseTaskId: cursor.caseTaskId })
    : null;
}

/**
 * Migration 119 owns the dated task projection, while Calendar owns exhausting
 * it across pages. Recheck the complete keyset boundary here so an out-of-order
 * or cursor-regressing provider page fails closed before any row is rendered.
 */
export function assertCalendarDatedTaskPageOrder(
  rows: readonly PlatformAdmissionsTaskQueueRow[],
  cursor: Readonly<{ sortAt: string; caseTaskId: string }> | null,
): void {
  let previousSortAt = cursor === null ? null : timestampOrderKey(cursor.sortAt);
  let previousTaskId = cursor?.caseTaskId ?? null;

  for (const row of rows) {
    const sortAt = timestampOrderKey(row.sortAt);
    const timestampOrder = previousSortAt === null
      ? 1
      : compareTimestampKeys(sortAt, previousSortAt);
    const afterPrevious = previousSortAt === null ||
      timestampOrder > 0 ||
      (
        timestampOrder === 0 &&
        previousTaskId !== null &&
        row.caseTaskId > previousTaskId
      );
    if (!afterPrevious) return invalidShape();
    previousSortAt = sortAt;
    previousTaskId = row.caseTaskId;
  }
}

async function getCalendarClient(): Promise<CalendarRpcClient> {
  const { createSupabaseServerClient } = await import("../supabase/server.ts");
  return createSupabaseServerClient() as unknown as CalendarRpcClient;
}

export async function listCalendarUndatedTaskPage(
  actor: PlatformActor,
  options: Readonly<{
    pageSize?: number;
    cursor?: CalendarUndatedTaskCursor | null;
  }> = {},
  dependencies: CalendarContractDependencies = {},
): Promise<Readonly<{
  rows: readonly PlatformAdmissionsTaskQueueRow[];
  nextCursor: CalendarUndatedTaskCursor | null;
}>> {
  try {
    const organizationId = requireCalendarPermission(actor, "task.manage");
    const normalizedPageSize = pageSize(options.pageSize);
    const requestedLimit = normalizedPageSize + 1;
    const cursor = options.cursor
      ? parseCalendarUndatedTaskCursor(
          options.cursor.sortAt,
          options.cursor.caseTaskId,
        ) ?? invalidShape()
      : null;
    const client = dependencies.client ?? await getCalendarClient();
    const response = await client.schema("platform").rpc(
      "staff_case_task_undated_page",
      {
        p_limit: requestedLimit,
        ...(cursor
          ? {
              p_after_sort_at: cursor.sortAt,
              p_after_case_task_id: cursor.caseTaskId,
            }
          : {}),
      },
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > requestedLimit
    ) {
      return invalidShape();
    }
    const seen = new Set<string>();
    let previousTaskId = cursor?.caseTaskId ?? null;
    const rows = response.data.map((value) => {
      const row = normalizePlatformAdmissionsTaskQueueRow(value, organizationId);
      if (
        row.dueAt !== null ||
        row.dueOn !== null ||
        !isUndatedSentinel(row.sortAt) ||
        (previousTaskId !== null && row.caseTaskId <= previousTaskId) ||
        seen.has(row.caseTaskId)
      ) {
        return invalidShape();
      }
      seen.add(row.caseTaskId);
      previousTaskId = row.caseTaskId;
      return row;
    });
    const hasNext = rows.length > normalizedPageSize;
    const page = rows.slice(0, normalizedPageSize);
    const last = page.at(-1);
    return Object.freeze({
      rows: Object.freeze(page),
      nextCursor: hasNext && last
        ? Object.freeze({ sortAt: last.sortAt, caseTaskId: last.caseTaskId })
        : null,
    });
  } catch (error) {
    return failClosed(error);
  }
}
