import "server-only";

import type { PipelineLead, PipelineStage } from "@/components/v3/Pipeline";
import type { PlatformActor } from "@/lib/platform-auth";
import {
  listPlatformSalesOwnerOptions,
  listPlatformSalesLeads,
  type PlatformSalesCursor,
  type PlatformSalesDueFilter,
  type PlatformSalesLeadRow,
  type PlatformSalesOwnerOptionsPage,
  type PlatformSalesStage,
} from "@/lib/platform-sales";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { FUNNEL_STEP, leadStage } from "@/lib/v3/wording";

const PAGE_SIZE = 100;
const OWNER_PAGE_SIZE = 100;
/**
 * Верхняя граница пагинации: 4000 лидов. Дальше чтение честно останавливается
 * с признаком truncated — доска показывает факт усечения, а когорта главной
 * отказывается считать по неполным данным.
 */
const MAX_LEAD_PAGES = 40;

/**
 * Фильтры доски. `due: "today"` — слово адресной строки; в RPC оно называется
 * `due_today`, и перевод живёт здесь, а не в странице.
 */
export type PipelineBoardFilters = Readonly<{
  query: string | null;
  /**
   * «handed_off» — производная колонка: в базе переданный лид остаётся в
   * своей канонической стадии, а колонку определяет связанное дело. Поэтому
   * фильтр по ней применяется после чтения, а не в RPC.
   */
  stage: PlatformSalesStage | "handed_off" | "all";
  due: "overdue" | "today" | "unscheduled" | "all";
  assignment: "unassigned" | "mine" | "all";
  ownerMembershipId: string | null;
}>;

export const PIPELINE_BOARD_NO_FILTERS: PipelineBoardFilters = Object.freeze({
  query: null,
  stage: "all",
  due: "all",
  assignment: "all",
  ownerMembershipId: null,
});

const RPC_DUE_FILTER: Record<
  PipelineBoardFilters["due"],
  PlatformSalesDueFilter
> = Object.freeze({
  all: "all",
  overdue: "overdue",
  today: "due_today",
  unscheduled: "unscheduled",
});

function requiredStageTitle(key: string): string {
  const title = leadStage(key);
  if (title === null) {
    throw new Error("Canonical sales workflow returned an unknown stage.");
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * The board follows the canonical Supabase workflow vocabulary. A completed
 * admissions handoff is deliberately presented as a derived terminal column:
 * the queue exposes it through `linkedStudentCaseCount`, not through a second
 * sales-stage dictionary. The gate marker belongs to `qualified`, the exact
 * stage required by the canonical handoff command; contract/payment evidence
 * remains a separate server-side decision rendered on the V3 person profile.
 */
const STAGES: readonly PipelineStage[] = [
  { key: "new", title: requiredStageTitle("new"), gate: false, terminal: false },
  { key: "contacting", title: requiredStageTitle("contacting"), gate: false, terminal: false },
  { key: "qualified", title: requiredStageTitle("qualified"), gate: true, terminal: false },
  { key: "meeting_scheduled", title: requiredStageTitle("meeting_scheduled"), gate: false, terminal: false },
  { key: "meeting_completed", title: requiredStageTitle("meeting_completed"), gate: false, terminal: false },
  { key: "potential", title: requiredStageTitle("potential"), gate: false, terminal: false },
  { key: "handed_off", title: FUNNEL_STEP.handed, gate: false, terminal: true },
];

const DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: ORG_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function readPipelineStages(): readonly PipelineStage[] {
  return STAGES;
}

export async function readPipelineOwnerOptions(
  actor: PlatformActor,
): Promise<PlatformSalesOwnerOptionsPage> {
  return listPlatformSalesOwnerOptions(actor, { pageSize: OWNER_PAGE_SIZE });
}

function organizationDate(value: Date): string {
  const parts = DATE_PARTS.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to resolve the EVO organization date.");
  }
  return `${year}-${month}-${day}`;
}

function formatDueDate(value: string | null): string | null {
  if (value === null) return null;
  const [, month, day] = value.split("-");
  if (!month || !day) {
    throw new Error("Canonical sales data returned an invalid due date.");
  }
  return `${day}.${month}`;
}

function dueState(
  dueDate: string | null,
  today: string,
): PipelineLead["due"] {
  if (dueDate === null) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return "later";
}

function stageAgeDays(stageEnteredAt: string, today: string): number {
  const enteredOn = organizationDate(new Date(stageEnteredAt));
  const elapsed = Math.round(
    (Date.parse(`${today}T00:00:00.000Z`) -
      Date.parse(`${enteredOn}T00:00:00.000Z`)) /
      86_400_000,
  );
  if (!Number.isSafeInteger(elapsed) || elapsed < 0) {
    throw new Error("Canonical sales data returned a future stage entry.");
  }
  return elapsed;
}

/**
 * Read every visible canonical lead page. The cursor and lead-id checks make a
 * changing or malformed result fail closed instead of silently duplicating or
 * truncating the board and dashboard. Filters are applied by the RPC itself,
 * so a filtered read pays for the matching pages only; the board still renders
 * every stage column and simply finds some of them empty.
 */
export type CanonicalSalesLeadsRead = Readonly<{
  rows: readonly PlatformSalesLeadRow[];
  /** true — верхняя граница чтения достигнута, дальше лиды не читались. */
  truncated: boolean;
}>;

export async function readAllCanonicalSalesLeads(
  actor: PlatformActor,
  filters: PipelineBoardFilters = PIPELINE_BOARD_NO_FILTERS,
): Promise<CanonicalSalesLeadsRead> {
  const rows: PlatformSalesLeadRow[] = [];
  const seenLeadIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: PlatformSalesCursor | null = null;

  for (let pageIndex = 0; pageIndex < MAX_LEAD_PAGES; pageIndex += 1) {
    const page = await listPlatformSalesLeads(actor, {
      pageSize: PAGE_SIZE,
      cursor,
      stageFilter: filters.stage === "handed_off" ? "all" : filters.stage,
      assignmentFilter: filters.assignment,
      dueFilter: RPC_DUE_FILTER[filters.due],
      ...(filters.ownerMembershipId
        ? { ownerMembershipId: filters.ownerMembershipId }
        : {}),
      ...(filters.query ? { query: filters.query } : {}),
    });

    for (const row of page.rows) {
      if (seenLeadIds.has(row.leadId)) {
        throw new Error("Canonical sales pagination returned a duplicate lead.");
      }
      seenLeadIds.add(row.leadId);
      rows.push(row);
    }

    if (!page.hasNext) {
      return Object.freeze({ rows: Object.freeze(rows), truncated: false });
    }
    if (!page.nextCursor) {
      throw new Error("Canonical sales pagination stopped without a cursor.");
    }

    const cursorKey = `${page.nextCursor.updatedAt}:${page.nextCursor.id}`;
    if (seenCursors.has(cursorKey)) {
      throw new Error("Canonical sales pagination did not advance.");
    }
    seenCursors.add(cursorKey);
    cursor = page.nextCursor;
  }

  return Object.freeze({ rows: Object.freeze(rows), truncated: true });
}

export type PipelineBoardRead = Readonly<{
  leads: readonly PipelineLead[];
  truncated: boolean;
}>;

export async function readPipelineLeads(
  actor: PlatformActor,
  filters: PipelineBoardFilters = PIPELINE_BOARD_NO_FILTERS,
): Promise<PipelineBoardRead> {
  const read = await readAllCanonicalSalesLeads(actor, filters);
  const today = organizationDate(new Date());

  const mapped = read.rows.map((row) => {
    const stageKey = row.linkedStudentCaseCount > 0
      ? "handed_off" as const
      : row.stageKey;
    return {
      id: row.leadId,
      name:
        row.clientDisplayName ??
        row.clientEmail ??
        row.clientPhone ??
        "Лид без имени",
      stageKey,
      source: row.sourceKey,
      nextAction: row.nextActionText,
      nextActionAt: formatDueDate(row.nextActionDueDate),
      due: dueState(row.nextActionDueDate, today),
      stageAgeDays: stageKey === "handed_off"
        ? null
        : stageAgeDays(row.stageEnteredAt, today),
      latestNote: row.latestNote,
      href: `/v3/profile?id=${row.leadId}`,
      workflow: Object.freeze({
        leadId: row.leadId,
        currentOwnerMembershipId: row.currentOwnerMembershipId,
        currentOwnerDisplayName: row.currentOwnerDisplayName,
        stageKey: row.stageKey,
        nextActionText: row.nextActionText,
        nextActionDueDate: row.nextActionDueDate,
        workflowVersion: row.workflowVersion,
      }),
    } satisfies PipelineLead;
  });

  // Фильтр стадии сверяется с ПРОИЗВОДНОЙ стадией: переданный лид живёт в
  // колонке «Переданы» независимо от stage_key, и наоборот — фильтр по
  // канонической стадии не должен вываливать переданных в их старую колонку.
  const leads =
    filters.stage === "all"
      ? mapped
      : mapped.filter((lead) => lead.stageKey === filters.stage);

  return Object.freeze({
    leads: Object.freeze(leads),
    truncated: read.truncated,
  });
}
