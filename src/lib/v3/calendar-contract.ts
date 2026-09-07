import type { PlatformAdmissionsTaskQueueRow } from "../platform-admissions-task-contract.ts";
import {
  normalizePlatformAdmissionsTaskQueueRow,
  parsePlatformAdmissionsTaskQueueCursor,
} from "../platform-admissions-workspace.ts";
import type { PlatformActor } from "../platform-auth.ts";
import { platformTaskDeadlineSortTime } from "../platform-task-deadline.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const UNDATED_SENTINEL_MS = platformTaskDeadlineSortTime(null, null);

export const CALENDAR_APPLICATION_STATUSES = [
  "preparation",
  "ready",
  "submitted",
  "under_review",
  "offer",
] as const;

export type CalendarApplicationStatus =
  (typeof CALENDAR_APPLICATION_STATUSES)[number];

export type CalendarApplicationDeadlineRow = Readonly<{
  applicationId: string;
  studentCaseId: string;
  studentDisplayName: string;
  universityName: string;
  programName: string;
  status: CalendarApplicationStatus;
  deadline: string;
}>;

export type CalendarApplicationDeadlineCursor = Readonly<{
  deadline: string;
  applicationId: string;
}>;

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

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidShape();
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return invalidShape();
  }
  return record;
}

function requiredUuid(value: unknown): string {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : invalidShape();
}

function requiredText(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > max
  ) {
    return invalidShape();
  }
  return value;
}

function requiredDate(value: unknown): string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return invalidShape();
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return invalidShape();
  }
  return value;
}

function pageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_PAGE_SIZE
    ? value
    : invalidShape();
}

function requireCalendarActor(actor: PlatformActor): string {
  if (actor.platformRole !== "admin" && actor.platformRole !== "admissions") {
    return invalidShape();
  }
  return requiredUuid(actor.organizationId);
}

function normalizeApplicationStatus(value: unknown): CalendarApplicationStatus {
  return typeof value === "string" &&
    CALENDAR_APPLICATION_STATUSES.includes(value as CalendarApplicationStatus)
    ? (value as CalendarApplicationStatus)
    : invalidShape();
}

export function parseCalendarUndatedTaskCursor(
  sortAt: unknown,
  caseTaskId: unknown,
): CalendarUndatedTaskCursor | null {
  const cursor = parsePlatformAdmissionsTaskQueueCursor(sortAt, caseTaskId);
  return cursor !== null && Date.parse(cursor.sortAt) === UNDATED_SENTINEL_MS
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
  let previousSortAt = cursor === null ? null : Date.parse(cursor.sortAt);
  let previousTaskId = cursor?.caseTaskId ?? null;

  for (const row of rows) {
    const sortAt = Date.parse(row.sortAt);
    const afterPrevious = previousSortAt === null ||
      sortAt > previousSortAt ||
      (
        sortAt === previousSortAt &&
        previousTaskId !== null &&
        row.caseTaskId > previousTaskId
      );
    if (!Number.isFinite(sortAt) || !afterPrevious) return invalidShape();
    previousSortAt = sortAt;
    previousTaskId = row.caseTaskId;
  }
}

export function normalizeCalendarApplicationDeadlineRow(
  value: unknown,
): CalendarApplicationDeadlineRow {
  const row = exactRecord(value, [
    "application_id",
    "student_case_id",
    "student_display_name",
    "university_name",
    "program_name",
    "application_status",
    "deadline",
  ]);
  return Object.freeze({
    applicationId: requiredUuid(row.application_id),
    studentCaseId: requiredUuid(row.student_case_id),
    studentDisplayName: requiredText(row.student_display_name, 200),
    universityName: requiredText(row.university_name, 500),
    programName: requiredText(row.program_name, 500),
    status: normalizeApplicationStatus(row.application_status),
    deadline: requiredDate(row.deadline),
  });
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
    const organizationId = requireCalendarActor(actor);
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
        Date.parse(row.sortAt) !== UNDATED_SENTINEL_MS ||
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

export async function listCalendarApplicationDeadlinePage(
  actor: PlatformActor,
  options: Readonly<{
    pageSize?: number;
    cursor?: CalendarApplicationDeadlineCursor | null;
    from: string;
    to: string;
  }>,
  dependencies: CalendarContractDependencies = {},
): Promise<Readonly<{
  rows: readonly CalendarApplicationDeadlineRow[];
  nextCursor: CalendarApplicationDeadlineCursor | null;
}>> {
  try {
    requireCalendarActor(actor);
    const normalizedPageSize = pageSize(options.pageSize);
    const requestedLimit = normalizedPageSize + 1;
    const from = requiredDate(options.from);
    const to = requiredDate(options.to);
    if (to < from) return invalidShape();
    const cursor = options.cursor
      ? Object.freeze({
          deadline: requiredDate(options.cursor.deadline),
          applicationId: requiredUuid(options.cursor.applicationId),
        })
      : null;
    const client = dependencies.client ?? await getCalendarClient();
    const response = await client.schema("platform").rpc(
      "staff_application_deadline_page",
      {
        p_limit: requestedLimit,
        p_due_from: from,
        p_due_to: to,
        ...(cursor
          ? {
              p_after_deadline: cursor.deadline,
              p_after_application_id: cursor.applicationId,
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
    let previousDeadline = cursor?.deadline ?? null;
    let previousApplicationId = cursor?.applicationId ?? null;
    const rows = response.data.map((value) => {
      const row = normalizeCalendarApplicationDeadlineRow(value);
      const afterPrevious = previousDeadline === null ||
        row.deadline > previousDeadline ||
        (
          row.deadline === previousDeadline &&
          previousApplicationId !== null &&
          row.applicationId > previousApplicationId
        );
      if (
        row.deadline < from ||
        row.deadline > to ||
        !afterPrevious ||
        seen.has(row.applicationId)
      ) {
        return invalidShape();
      }
      seen.add(row.applicationId);
      previousDeadline = row.deadline;
      previousApplicationId = row.applicationId;
      return row;
    });
    const hasNext = rows.length > normalizedPageSize;
    const page = rows.slice(0, normalizedPageSize);
    const last = page.at(-1);
    return Object.freeze({
      rows: Object.freeze(page),
      nextCursor: hasNext && last
        ? Object.freeze({
            deadline: last.deadline,
            applicationId: last.applicationId,
          })
        : null,
    });
  } catch (error) {
    return failClosed(error);
  }
}

export async function readNearestCalendarApplicationDeadline(
  actor: PlatformActor,
  dependencies: CalendarContractDependencies = {},
): Promise<CalendarApplicationDeadlineRow | null> {
  try {
    requireCalendarActor(actor);
    const client = dependencies.client ?? await getCalendarClient();
    const response = await client.schema("platform").rpc(
      "staff_nearest_application_deadline",
      {},
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > 1
    ) {
      return invalidShape();
    }
    return response.data[0]
      ? normalizeCalendarApplicationDeadlineRow(response.data[0])
      : null;
  } catch (error) {
    return failClosed(error);
  }
}
