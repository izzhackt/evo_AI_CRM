import "server-only";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { StudentApplication } from "@/lib/student-application-contract";
import { readAllCanonicalSalesLeads } from "./pipeline-source";
import { loadStudentApplicationQueue } from "./student-application-source";

/**
 * Продажи → «Заявки»: one unified intake queue (unified workflow S1, plan
 * §3/§4). Filter pills read the REAL source_key values already used
 * elsewhere: 'website' (170_platform_website_lead_intake.sql),
 * 'whatsapp' (085_platform_waha_receive_only_sales.sql) and
 * 'platform_application' (this slice's canonical lead link, migration 180).
 */
// Pill order follows the plan text verbatim: Все | Сайт | Платформа | WhatsApp.
export const REQUEST_SOURCE_FILTERS = ["all", "website", "platform_application", "whatsapp"] as const;
export type RequestSourceFilter = (typeof REQUEST_SOURCE_FILTERS)[number];

const LEAD_ROW_SOURCE_KEYS = ["website", "whatsapp"] as const;
/** Informational-only lead rows (no decision here); bound so the queue stays a queue, not a full export. */
const MAX_LEAD_ROWS = 100;

export type RequestRow =
  | Readonly<{
      kind: "application";
      id: string;
      source: "platform_application";
      occurredAt: string;
      personName: string;
      email: string;
      /** Null until submit-time linking or approval creates the canonical lead. */
      leadId: string | null;
      application: StudentApplication;
    }>
  | Readonly<{
      kind: "lead";
      id: string;
      source: "website" | "whatsapp";
      occurredAt: string;
      personName: string;
      email: string | null;
      phone: string | null;
      leadId: string;
    }>;

export type RequestsQueue = Readonly<{
  rows: readonly RequestRow[];
  /** Pending platform applications awaiting a decision — the queue's own headline count. */
  pendingApplicationCount: number;
  /** True when the lead read hit its safety cap; the newest leads still show first. */
  truncated: boolean;
}>;

function byRecency(a: RequestRow, b: RequestRow): number {
  return Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
}

export async function loadRequestsQueue(actor: ActivePlatformActor): Promise<RequestsQueue> {
  const [applicationQueue, leadRead] = await Promise.all([
    loadStudentApplicationQueue(),
    readAllCanonicalSalesLeads(actor),
  ]);

  const applicationRows: RequestRow[] = applicationQueue.applications
    .filter((application) => application.status === "pending")
    .map((application) => Object.freeze({
      kind: "application" as const,
      id: application.id,
      source: "platform_application" as const,
      occurredAt: application.submittedAt,
      personName: `${application.questionnaire.firstName} ${application.questionnaire.lastName}`,
      email: application.email,
      leadId: application.canonicalLeadId,
      application,
    }));

  const leadRows: RequestRow[] = leadRead.rows
    .filter((row): row is typeof row & { sourceKey: "website" | "whatsapp" } =>
      (LEAD_ROW_SOURCE_KEYS as readonly string[]).includes(row.sourceKey))
    .map((row) => Object.freeze({
      kind: "lead" as const,
      id: row.leadId,
      source: row.sourceKey,
      occurredAt: row.updatedAt,
      personName: row.clientDisplayName ?? row.clientEmail ?? row.clientPhone ?? "Без имени",
      email: row.clientEmail,
      phone: row.clientPhone,
      leadId: row.leadId,
    }))
    .sort(byRecency)
    .slice(0, MAX_LEAD_ROWS);

  const rows = Object.freeze([...applicationRows, ...leadRows].sort(byRecency));
  return Object.freeze({
    rows,
    pendingApplicationCount: applicationRows.length,
    truncated: leadRead.truncated,
  });
}

export function filterRequestsQueue(queue: RequestsQueue, filter: RequestSourceFilter): readonly RequestRow[] {
  return filter === "all" ? queue.rows : queue.rows.filter((row) => row.source === filter);
}

export function parseRequestSourceFilter(value: string | undefined): RequestSourceFilter {
  return (REQUEST_SOURCE_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as RequestSourceFilter)
    : "all";
}
