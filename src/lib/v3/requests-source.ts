import "server-only";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { StudentApplication } from "@/lib/student-application-contract";
import { createSupabaseServerClient } from "../supabase/server";
import { readAllCanonicalSalesLeads } from "./pipeline-source";
import { loadStudentApplicationQueue } from "./student-application-source";

/**
 * Продажи → «Заявки»: one unified intake queue (unified workflow S1, plan
 * §3/§4). Filter pills read the REAL source_key values already used
 * elsewhere: 'website' (170_platform_website_lead_intake.sql),
 * 'whatsapp' (085_platform_waha_receive_only_sales.sql) and
 * 'platform_application' (this slice's canonical lead link, migration 180).
 * 'portal_consultation' (PORT-5b, migration 197) is not a lead source: the
 * pill switches the screen to the portal consultation section instead of
 * filtering RequestRow entries.
 */
// Pill order follows the plan text verbatim: Все | Сайт | Платформа | WhatsApp;
// the additive consultation section comes last.
export const REQUEST_SOURCE_FILTERS = ["all", "website", "platform_application", "whatsapp", "portal_consultation"] as const;
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
  /** True when rows were cut: the lead read hit its safety cap OR the queue's own lead slice dropped older rows. */
  truncated: boolean;
  /**
   * The two sources are gated differently (anketa queue needs the admissions
   * review triad, leads need sales.read). Each side fails independently so a
   * Sales member still sees whatever their role can read (plan §3).
   */
  applicationsUnavailable: boolean;
  leadsUnavailable: boolean;
}>;

function byRecency(a: RequestRow, b: RequestRow): number {
  return Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
}

export async function loadRequestsQueue(actor: ActivePlatformActor): Promise<RequestsQueue> {
  const [applicationResult, leadResult] = await Promise.allSettled([
    loadStudentApplicationQueue(),
    readAllCanonicalSalesLeads(actor),
  ]);

  const applicationRows: RequestRow[] = applicationResult.status === "fulfilled"
    ? applicationResult.value.applications
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
      }))
    : [];

  const eligibleLeadRows: RequestRow[] = leadResult.status === "fulfilled"
    ? leadResult.value.rows
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
    : [];
  const leadRows = eligibleLeadRows.slice(0, MAX_LEAD_ROWS);

  const rows = Object.freeze([...applicationRows, ...leadRows].sort(byRecency));
  return Object.freeze({
    rows,
    pendingApplicationCount: applicationRows.length,
    truncated:
      (leadResult.status === "fulfilled" && leadResult.value.truncated)
      || eligibleLeadRows.length > MAX_LEAD_ROWS,
    applicationsUnavailable: applicationResult.status === "rejected",
    leadsUnavailable: leadResult.status === "rejected",
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

/**
 * «Кабинет: консультации» (PORT-5b, миграция 197): запросы консультации из
 * студенческого кабинета в той же очереди «Заявки». Guard живёт в RPC
 * (реальное разрешение очереди lead.read, admin included); здесь — транспорт
 * и строгий разбор, любое отклонение формы — честная ошибка.
 */
export type PortalConsultationRow = Readonly<{
  id: string;
  status: "requested" | "handled";
  studentName: string;
  institutionId: string | null;
  institutionName: string | null;
  note: string | null;
  requestedAt: string;
  handledAt: string | null;
  handledByName: string | null;
}>;

export type PortalConsultationQueue = Readonly<{
  items: readonly PortalConsultationRow[];
  nextOffset: number | null;
  openCount: number;
}>;

const CONSULTATION_ROW_KEYS =
  "handledAt,handledByName,id,institutionId,institutionName,note,requestedAt,status,studentName";

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parsePortalConsultationRow(value: unknown): PortalConsultationRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Consultation row shape");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== CONSULTATION_ROW_KEYS
    || !isUuid(row.id)
    || (row.status !== "requested" && row.status !== "handled")
    || typeof row.studentName !== "string" || !row.studentName.trim() || row.studentName.length > 200
    || (row.institutionId !== null && !isUuid(row.institutionId))
    || (row.institutionName !== null && (typeof row.institutionName !== "string" || row.institutionName.length > 300))
    || (row.note !== null && (typeof row.note !== "string" || row.note.length > 500))
    || !isIsoDate(row.requestedAt)
    || (row.status === "handled") !== (row.handledAt !== null)
    || (row.handledAt !== null && !isIsoDate(row.handledAt))
    || (row.handledByName !== null && (typeof row.handledByName !== "string" || row.handledByName.length > 200))
  ) throw new Error("Consultation row shape");
  return Object.freeze({
    id: row.id,
    status: row.status as PortalConsultationRow["status"],
    studentName: row.studentName,
    institutionId: row.institutionId as string | null,
    institutionName: row.institutionName as string | null,
    note: row.note as string | null,
    requestedAt: row.requestedAt,
    handledAt: row.handledAt as string | null,
    handledByName: row.handledByName as string | null,
  });
}

export async function loadPortalConsultationQueue(offset = 0): Promise<PortalConsultationQueue> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Consultation page offset");
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .schema("platform")
    .rpc("staff_portal_consultation_requests_v1", { p_offset: offset });
  if (error || data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Consultation queue unavailable");
  }
  const page = data as Record<string, unknown>;
  if (Object.keys(page).sort().join(",") !== "items,nextOffset,openCount"
    || !Array.isArray(page.items) || page.items.length > 50
    || !(page.nextOffset === null || (Number.isSafeInteger(page.nextOffset) && Number(page.nextOffset) > 0))
    || !Number.isSafeInteger(page.openCount) || Number(page.openCount) < 0
  ) throw new Error("Consultation queue unavailable");
  return Object.freeze({
    items: Object.freeze(page.items.map(parsePortalConsultationRow)),
    nextOffset: page.nextOffset as number | null,
    openCount: page.openCount as number,
  });
}
