import type { StudentApplication } from "./student-application-contract.ts";

export const REQUEST_SOURCE_FILTERS = ["all", "website", "platform_application", "whatsapp", "portal_consultation"] as const;
export type RequestSourceFilter = typeof REQUEST_SOURCE_FILTERS[number];
export const REQUEST_KINDS = ["lead", "application", "consultation"] as const;
export type RequestKind = typeof REQUEST_KINDS[number];
export type RequestKindState = "ready" | "forbidden" | "unavailable" | "not-requested";
export type RequestFilters = Readonly<{
  source: RequestSourceFilter;
  applicationStatus: "pending" | "all";
  consultationStatus: "all" | "requested" | "handled";
  limit: number;
}>;
export type RequestCursor = RequestFilters & Readonly<{
  v: 1; direction: "next" | "previous"; timestamp: string; kind: RequestKind; id: string;
}>;
export type RequestSelection = RequestFilters & Readonly<{ cursor: RequestCursor | null }>;
export type ConsultationRow = Readonly<{
  id: string; status: "requested" | "handled"; studentName: string;
  institutionId: string | null; institutionName: string | null; note: string | null;
  requestedAt: string; handledAt: string | null; handledByName: string | null;
}>;
type RowBase = Readonly<{ id: string; occurredAt: string; personName: string }>;
export type RequestRow =
  | RowBase & Readonly<{ kind: "lead"; source: "website" | "whatsapp"; email: string | null; phone: string | null; leadId: string }>
  | RowBase & Readonly<{ kind: "application"; source: "platform_application"; email: string; leadId: string | null; application: StudentApplication }>
  | RowBase & Readonly<{ kind: "consultation"; source: "portal_consultation"; consultation: ConsultationRow }>;
export type RequestsQueue = Readonly<{
  rows: readonly RequestRow[];
  states: Readonly<Record<RequestKind, RequestKindState>>;
  counts: Readonly<Record<RequestKind | "pendingApplications" | "openConsultations", number | null>>;
  nextCursor: RequestCursor | null; previousCursor: RequestCursor | null;
}>;

function invalid(): never { throw new Error("Requests queue unavailable."); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: unknown, expected: string): value is Record<string, unknown> {
  return record(value) && Object.keys(value).sort().join(",") === expected;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max; }
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 23) === value.slice(0, 23);
}
function sameFilters(value: Record<string, unknown>, filters: RequestFilters): boolean {
  return value.source === filters.source && value.applicationStatus === filters.applicationStatus
    && value.consultationStatus === filters.consultationStatus && value.limit === filters.limit;
}
export function requestKindSelected(kind: RequestKind, source: RequestSourceFilter): boolean {
  return source === "all" || (kind === "lead" ? source === "website" || source === "whatsapp"
    : source === (kind === "application" ? "platform_application" : "portal_consultation"));
}
export function parseRequestCursor(value: unknown, filters: RequestFilters): RequestCursor {
  if (!keys(value, "applicationStatus,consultationStatus,direction,id,kind,limit,source,timestamp,v")
    || value.v !== 1 || !sameFilters(value, filters)
    || (value.direction !== "next" && value.direction !== "previous")
    || !REQUEST_KINDS.includes(value.kind as RequestKind) || !requestKindSelected(value.kind as RequestKind, filters.source)
    || !timestamp(value.timestamp) || !uuid(value.id)) return invalid();
  return value as RequestCursor;
}
export function encodeRequestCursor(cursor: RequestCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
export function decodeRequestCursor(token: string, filters: RequestFilters): RequestCursor {
  if (token.length > 1000 || !/^[A-Za-z0-9_-]+$/u.test(token)) return invalid();
  try {
    const raw = atob(token.replaceAll("-", "+").replaceAll("_", "/"));
    if (btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "") !== token) return invalid();
    return parseRequestCursor(JSON.parse(raw), filters);
  } catch { return invalid(); }
}
export function parseRequestSelection(params: Readonly<Record<string, string | readonly string[] | undefined>>): RequestSelection {
  const source = params.source ?? "all";
  const applicationStatus = params.applications ?? "pending";
  const consultationStatus = params.consultations ?? "all";
  const limit = params.limit === undefined ? 50 : typeof params.limit === "string" && /^[1-9]\d?$/u.test(params.limit) ? Number(params.limit) : NaN;
  if (!REQUEST_SOURCE_FILTERS.includes(source as RequestSourceFilter)
    || (applicationStatus !== "pending" && applicationStatus !== "all")
    || (consultationStatus !== "all" && consultationStatus !== "requested" && consultationStatus !== "handled")
    || !Number.isInteger(limit) || limit < 1 || limit > 50
    || (params.cursor !== undefined && typeof params.cursor !== "string")) return invalid();
  const filters: RequestFilters = { source: source as RequestSourceFilter, applicationStatus, consultationStatus, limit };
  return { ...filters, cursor: params.cursor === undefined ? null : decodeRequestCursor(params.cursor as string, filters) };
}
export function requestsHref(selection: RequestSelection): string {
  const params = new URLSearchParams();
  if (selection.source !== "all") params.set("source", selection.source);
  if (selection.applicationStatus !== "pending") params.set("applications", selection.applicationStatus);
  if (selection.consultationStatus !== "all") params.set("consultations", selection.consultationStatus);
  if (selection.limit !== 50) params.set("limit", String(selection.limit));
  if (selection.cursor) params.set("cursor", encodeRequestCursor(selection.cursor));
  return `/v3/requests${params.size ? `?${params}` : ""}`;
}
export function parseRequestsReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1600 || !/^\/v3\/requests(?:\?|$)/u.test(value)) return null;
  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.pathname !== "/v3/requests" || url.hash || url.origin !== "https://internal.invalid") return null;
    const params: Record<string, string> = {};
    for (const [key, val] of url.searchParams) {
      if (!["source", "applications", "consultations", "limit", "cursor"].includes(key) || key in params) return null;
      params[key] = val;
    }
    return requestsHref(parseRequestSelection(params));
  } catch { return null; }
}
type Position = { timestamp: string; kind: RequestKind; id: string };
function compare(a: Position, b: Position): number {
  // Fixed UTC microseconds and ASCII kind/UUID use PostgreSQL's C ordering.
  for (const key of ["timestamp", "kind", "id"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return 0;
}
function position(row: RequestRow): Position { return { timestamp: row.occurredAt, kind: row.kind, id: row.id }; }

export function parseRequestsQueue(
  value: unknown, organizationId: string, selection: RequestSelection,
  decodeApplication: (raw: unknown) => StudentApplication,
  decodeConsultation: (raw: unknown) => ConsultationRow,
): RequestsQueue {
  if (!keys(value, "applicationStatus,consultationStatus,counts,limit,nextCursor,organizationId,previousCursor,rows,source,states,version")
    || value.version !== 1 || value.organizationId !== organizationId || !sameFilters(value, selection)
    || !keys(value.states, "application,consultation,lead")
    || !keys(value.counts, "application,consultation,lead,openConsultations,pendingApplications")
    || !Array.isArray(value.rows) || value.rows.length > selection.limit) return invalid();
  const states = value.states as Record<RequestKind, RequestKindState>;
  const counts = value.counts as RequestsQueue["counts"];
  for (const kind of REQUEST_KINDS) {
    if (!["ready", "forbidden", "unavailable", "not-requested"].includes(states[kind])
      || (states[kind] === "not-requested") === requestKindSelected(kind, selection.source)) return invalid();
    const count = counts[kind];
    if (states[kind] === "ready" ? !Number.isSafeInteger(count) || (count as number) < 0 : count !== null) return invalid();
  }
  for (const [count, kind] of [["pendingApplications", "application"], ["openConsultations", "consultation"]] as const) {
    if (states[kind] === "ready" ? !Number.isSafeInteger(counts[count]) || (counts[count] as number) < 0 : counts[count] !== null) return invalid();
  }
  if (counts.application !== null && counts.pendingApplications !== null
    && (selection.applicationStatus === "pending" ? counts.application !== counts.pendingApplications : counts.pendingApplications > counts.application)) return invalid();
  if (counts.consultation !== null && counts.openConsultations !== null
    && (selection.consultationStatus === "requested" ? counts.consultation !== counts.openConsultations
      : selection.consultationStatus === "all" && counts.openConsultations > counts.consultation)) return invalid();
  const rows: RequestRow[] = value.rows.map((raw): RequestRow => {
    if (!record(raw) || !uuid(raw.id) || !timestamp(raw.occurredAt) || !text(raw.personName, 500) || !raw.personName.trim()
      || !REQUEST_KINDS.includes(raw.kind as RequestKind) || states[raw.kind as RequestKind] !== "ready"
      || (selection.source !== "all" && raw.source !== selection.source)) return invalid();
    const base = { id: raw.id, occurredAt: raw.occurredAt, personName: raw.personName };
    if (raw.kind === "lead") {
      if (!keys(raw, "email,id,kind,leadId,occurredAt,personName,phone,source")
        || (raw.source !== "website" && raw.source !== "whatsapp") || raw.leadId !== raw.id
        || (raw.email !== null && !text(raw.email, 320)) || (raw.phone !== null && !text(raw.phone, 100))) return invalid();
      return { ...base, kind: "lead", source: raw.source, leadId: raw.id, email: raw.email as string | null, phone: raw.phone as string | null };
    }
    if (raw.kind === "application") {
      if (!keys(raw, "application,email,id,kind,leadId,occurredAt,personName,source") || raw.source !== "platform_application") return invalid();
      const application = decodeApplication(raw.application);
      if (application.id !== raw.id || application.email !== raw.email || application.canonicalLeadId !== raw.leadId
        || `${application.questionnaire.firstName} ${application.questionnaire.lastName}` !== raw.personName
        || Date.parse(application.submittedAt) !== Date.parse(raw.occurredAt)
        || (selection.applicationStatus === "pending" && application.status !== "pending")) return invalid();
      return { ...base, kind: "application", source: "platform_application", application, email: application.email, leadId: application.canonicalLeadId };
    }
    if (!keys(raw, "consultation,id,kind,occurredAt,personName,source") || raw.source !== "portal_consultation") return invalid();
    const consultation = decodeConsultation(raw.consultation);
    if (consultation.id !== raw.id || consultation.studentName !== raw.personName || Date.parse(consultation.requestedAt) !== Date.parse(raw.occurredAt)
      || (selection.consultationStatus !== "all" && consultation.status !== selection.consultationStatus)) return invalid();
    return { ...base, kind: "consultation", source: "portal_consultation", consultation };
  });
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && compare(position(rows[i - 1]), position(rows[i])) <= 0) return invalid();
    if (selection.cursor && (selection.cursor.direction === "next"
      ? compare(position(rows[i]), selection.cursor) >= 0 : compare(position(rows[i]), selection.cursor) <= 0)) return invalid();
  }
  if (new Set(rows.map((row) => `${row.kind}:${row.id}`)).size !== rows.length) return invalid();
  for (const kind of REQUEST_KINDS) {
    if (rows.filter((row) => row.kind === kind).length > (counts[kind] ?? 0)) return invalid();
  }
  const knownCount = REQUEST_KINDS.reduce((total, kind) => total + (counts[kind] ?? 0), 0);
  if (!selection.cursor && rows.length !== Math.min(knownCount, selection.limit)) return invalid();
  const nextCursor = value.nextCursor === null ? null : parseRequestCursor(value.nextCursor, selection);
  const previousCursor = value.previousCursor === null ? null : parseRequestCursor(value.previousCursor, selection);
  for (const [cursor, direction, boundary] of [[nextCursor, "next", rows.at(-1)], [previousCursor, "previous", rows[0]]] as const) {
    if (cursor && (cursor.direction !== direction || (boundary ? compare(cursor, position(boundary)) !== 0
      : !selection.cursor || compare(cursor, selection.cursor) !== 0 || cursor.direction === selection.cursor.direction))) return invalid();
  }
  return { rows, states, counts, nextCursor, previousCursor };
}
