import "server-only";

import type { PipelineLead, PipelineStage } from "@/components/v3/Pipeline";
import type { PlatformActor } from "@/lib/platform-auth";
import {
  listPlatformSalesLeads,
  type PlatformSalesCursor,
  type PlatformSalesLeadRow,
} from "@/lib/platform-sales";
import { ORG_TIMEZONE } from "@/lib/v3/period";

const PAGE_SIZE = 100;

/**
 * The board follows the canonical Supabase workflow vocabulary. A completed
 * admissions handoff is deliberately presented as a derived terminal column:
 * the queue exposes it through `linkedStudentCaseCount`, not through a second
 * sales-stage dictionary. The gate marker belongs to `qualified`, the exact
 * stage required by the canonical handoff command; contract/payment evidence
 * remains a separate server-side decision in the next replacement slice.
 */
const STAGES: readonly PipelineStage[] = [
  { key: "new", title: "Новые", gate: false, terminal: false },
  { key: "contacting", title: "Связались", gate: false, terminal: false },
  { key: "qualified", title: "Квалифицированы", gate: true, terminal: false },
  { key: "meeting_scheduled", title: "Встреча назначена", gate: false, terminal: false },
  { key: "meeting_completed", title: "Встреча проведена", gate: false, terminal: false },
  { key: "potential", title: "Потенциальные", gate: false, terminal: false },
  { key: "handed_off", title: "Переданы", gate: false, terminal: true },
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

/**
 * Read every visible canonical lead page. The cursor and lead-id checks make a
 * changing or malformed result fail closed instead of silently duplicating or
 * truncating the board and dashboard.
 */
export async function readAllCanonicalSalesLeads(
  actor: PlatformActor,
): Promise<readonly PlatformSalesLeadRow[]> {
  const rows: PlatformSalesLeadRow[] = [];
  const seenLeadIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: PlatformSalesCursor | null = null;

  for (;;) {
    const page = await listPlatformSalesLeads(actor, {
      pageSize: PAGE_SIZE,
      cursor,
    });

    for (const row of page.rows) {
      if (seenLeadIds.has(row.leadId)) {
        throw new Error("Canonical sales pagination returned a duplicate lead.");
      }
      seenLeadIds.add(row.leadId);
      rows.push(row);
    }

    if (!page.hasNext) return Object.freeze(rows);
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
}

export async function readPipelineLeads(
  actor: PlatformActor,
): Promise<readonly PipelineLead[]> {
  const rows = await readAllCanonicalSalesLeads(actor);
  const today = organizationDate(new Date());

  return rows.map((row) => ({
    id: row.leadId,
    name:
      row.clientDisplayName ??
      row.clientEmail ??
      row.clientPhone ??
      "Лид без имени",
    stageKey: row.linkedStudentCaseCount > 0 ? "handed_off" : row.stageKey,
    source: row.sourceKey,
    nextAction: row.nextActionText,
    nextActionAt: formatDueDate(row.nextActionDueDate),
    due: dueState(row.nextActionDueDate, today),
    href: `/v3/profile?id=${row.leadId}`,
  } satisfies PipelineLead));
}
