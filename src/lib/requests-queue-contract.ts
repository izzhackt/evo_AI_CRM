import { PLATFORM_SALES_STAGES, type PlatformSalesStage } from "./platform-sales-contract.ts";
import type { StudentApplication } from "./student-application-contract.ts";

/**
 * «Заявки» (Э3, 27.09.2026): контракт чтения `platform.staff_requests_queue_v2`
 * (миграция 250). Вкладка — источник, состояние — «Ждут разбора» или «Все»;
 * ждёт разбора лид без ответственного и не переданный, анкета `pending`,
 * консультация `requested`. Числа вкладок приходят из чтения при выбранном
 * состоянии; вид, который роль не читает, числа не имеет (null), а не ноль.
 */
export const REQUEST_SOURCE_FILTERS = ["all", "website", "whatsapp", "platform_application", "portal_consultation"] as const;
export type RequestSourceFilter = typeof REQUEST_SOURCE_FILTERS[number];
export const REQUEST_STATUS_FILTERS = ["waiting", "all"] as const;
export type RequestStatusFilter = typeof REQUEST_STATUS_FILTERS[number];
export const REQUEST_KINDS = ["lead", "application", "consultation"] as const;
export type RequestKind = typeof REQUEST_KINDS[number];
export type RequestKindState = "ready" | "forbidden";
/** Ключи чисел вкладок: у лидов два источника, у анкет и консультаций — по одному. */
export const REQUEST_TABS = ["website", "whatsapp", "application", "consultation"] as const;
export type RequestTab = typeof REQUEST_TABS[number];
export const REQUEST_TAB_SOURCE: Readonly<Record<RequestTab, Exclude<RequestSourceFilter, "all">>> = {
  website: "website", whatsapp: "whatsapp", application: "platform_application", consultation: "portal_consultation",
};
const TAB_KIND: Readonly<Record<RequestTab, RequestKind>> = {
  website: "lead", whatsapp: "lead", application: "application", consultation: "consultation",
};
export const REQUESTS_PAGE_SIZE = 50;

export type RequestFilters = Readonly<{
  source: RequestSourceFilter;
  status: RequestStatusFilter;
  limit: number;
}>;
export type RequestCursor = RequestFilters & Readonly<{
  v: 2; direction: "next" | "previous"; timestamp: string; kind: RequestKind; id: string;
}>;
export type RequestSelection = RequestFilters & Readonly<{ cursor: RequestCursor | null }>;
export type ConsultationRow = Readonly<{
  id: string; status: "requested" | "handled"; studentName: string;
  institutionId: string | null; institutionName: string | null; note: string | null;
  requestedAt: string; handledAt: string | null; handledByName: string | null;
}>;
/** Ответственный лида. Имени может не быть (профиль без имени): тогда — только «назначен». */
export type RequestLeadOwner = Readonly<{ membershipId: string; name: string | null }>;
/**
 * «Можно взять»: сервер принял бы смотрящего ответственным этого лида той же
 * командой, что у формы решения доски (`mutate_sales_lead_workflow`). Поля —
 * то, что команда требует повторить без изменений.
 */
export type RequestLeadTake = Readonly<{
  workflowVersion: string;
  stageKey: PlatformSalesStage;
  nextActionText: string | null;
  nextActionDueDate: string | null;
}>;
type RowBase = Readonly<{ id: string; occurredAt: string; personName: string }>;
export type RequestLeadRow = RowBase & Readonly<{
  kind: "lead"; source: "website" | "whatsapp"; email: string | null; phone: string | null; leadId: string;
  owner: RequestLeadOwner | null; handedOff: boolean; take: RequestLeadTake | null;
}>;
export type RequestApplicationRow = RowBase & Readonly<{
  kind: "application"; source: "platform_application"; email: string; leadId: string | null; application: StudentApplication;
}>;
export type RequestConsultationRow = RowBase & Readonly<{
  kind: "consultation"; source: "portal_consultation"; consultation: ConsultationRow;
}>;
export type RequestRow = RequestLeadRow | RequestApplicationRow | RequestConsultationRow;
export type RequestsQueue = Readonly<{
  rows: readonly RequestRow[];
  states: Readonly<Record<RequestKind, RequestKindState>>;
  counts: Readonly<Record<RequestTab, number | null>>;
  /** Последняя заявка выбранного источника в любом состоянии; null — заявок не было. */
  latestAt: string | null;
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
function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}
function sameFilters(value: Record<string, unknown>, filters: RequestFilters): boolean {
  return value.source === filters.source && value.status === filters.status && value.limit === filters.limit;
}
export function requestKindOfSource(source: Exclude<RequestSourceFilter, "all">): RequestKind {
  return source === "website" || source === "whatsapp" ? "lead" : source === "platform_application" ? "application" : "consultation";
}
export function requestKindSelected(kind: RequestKind, source: RequestSourceFilter): boolean {
  return source === "all" || requestKindOfSource(source) === kind;
}
export function parseRequestCursor(value: unknown, filters: RequestFilters): RequestCursor {
  if (!keys(value, "direction,id,kind,limit,source,status,timestamp,v")
    || value.v !== 2 || !sameFilters(value, filters)
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
  const status = params.status ?? "waiting";
  const limit = params.limit === undefined ? REQUESTS_PAGE_SIZE
    : typeof params.limit === "string" && /^[1-9]\d?$/u.test(params.limit) ? Number(params.limit) : NaN;
  if (!REQUEST_SOURCE_FILTERS.includes(source as RequestSourceFilter)
    || !REQUEST_STATUS_FILTERS.includes(status as RequestStatusFilter)
    || !Number.isInteger(limit) || limit < 1 || limit > REQUESTS_PAGE_SIZE
    || (params.cursor !== undefined && typeof params.cursor !== "string")) return invalid();
  const filters: RequestFilters = { source: source as RequestSourceFilter, status: status as RequestStatusFilter, limit };
  return { ...filters, cursor: params.cursor === undefined ? null : decodeRequestCursor(params.cursor as string, filters) };
}
/** Адрес очереди; `open` — запись в правой панели («kind:id»). */
export function requestsHref(selection: RequestSelection, open: string | null = null): string {
  const params = new URLSearchParams();
  if (selection.source !== "all") params.set("source", selection.source);
  if (selection.status !== "waiting") params.set("status", selection.status);
  if (selection.limit !== REQUESTS_PAGE_SIZE) params.set("limit", String(selection.limit));
  if (selection.cursor) params.set("cursor", encodeRequestCursor(selection.cursor));
  if (open) params.set("open", open);
  return `/v3/requests${params.size ? `?${params}` : ""}`;
}
/** Запись правой панели из адреса: «lead|application|consultation:uuid», иначе null. */
export function parseRequestOpen(value: unknown): Readonly<{ kind: RequestKind; id: string }> | null {
  if (typeof value !== "string") return null;
  const [kind, id, extra] = value.split(":");
  return extra === undefined && REQUEST_KINDS.includes(kind as RequestKind) && uuid(id) ? { kind: kind as RequestKind, id } : null;
}
export function requestOpenKey(row: Pick<RequestRow, "kind" | "id">): string {
  return `${row.kind}:${row.id}`;
}
export function parseRequestsReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1600 || !/^\/v3\/requests(?:\?|$)/u.test(value)) return null;
  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.pathname !== "/v3/requests" || url.hash || url.origin !== "https://internal.invalid") return null;
    const params: Record<string, string> = {};
    for (const [key, val] of url.searchParams) {
      if (!["source", "status", "limit", "cursor"].includes(key) || key in params) return null;
      params[key] = val;
    }
    return requestsHref(parseRequestSelection(params));
  } catch { return null; }
}
/**
 * Числа вкладок. «Все» — сумма видов, которые роль читает (это и есть то, что
 * показывает вкладка «Все»); ни одного читаемого вида — числа нет.
 */
export function requestTabCount(counts: RequestsQueue["counts"], source: RequestSourceFilter): number | null {
  if (source !== "all") {
    const tab = REQUEST_TABS.find((key) => REQUEST_TAB_SOURCE[key] === source)!;
    return counts[tab];
  }
  const known = REQUEST_TABS.map((tab) => counts[tab]).filter((count): count is number => count !== null);
  return known.length ? known.reduce((total, count) => total + count, 0) : null;
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
/** Вкладка строки: у лида — его источник, у анкеты и консультации — их вид. */
export function requestRowTab(row: Pick<RequestRow, "kind" | "source">): RequestTab {
  return row.source === "website" || row.source === "whatsapp" ? row.source : row.kind === "application" ? "application" : "consultation";
}
function selectedTabs(source: RequestSourceFilter): readonly RequestTab[] {
  return source === "all" ? REQUEST_TABS : REQUEST_TABS.filter((tab) => REQUEST_TAB_SOURCE[tab] === source);
}

function parseOwner(value: unknown): RequestLeadOwner | null {
  if (value === null) return null;
  if (!keys(value, "membershipId,name") || !uuid(value.membershipId)
    || (value.name !== null && (!text(value.name, 500) || !value.name.trim()))) return invalid();
  return { membershipId: value.membershipId, name: value.name as string | null };
}
function parseTake(value: unknown): RequestLeadTake | null {
  if (value === null) return null;
  if (!keys(value, "nextActionDueDate,nextActionText,stageKey,workflowVersion")
    || typeof value.workflowVersion !== "string" || !/^[1-9]\d{0,18}$/u.test(value.workflowVersion)
    || !PLATFORM_SALES_STAGES.includes(value.stageKey as PlatformSalesStage)
    || (value.nextActionText !== null && (!text(value.nextActionText, 500) || !value.nextActionText.trim()))
    || (value.nextActionDueDate !== null && !date(value.nextActionDueDate))
    || (value.nextActionText === null) !== (value.nextActionDueDate === null)) return invalid();
  return {
    workflowVersion: value.workflowVersion, stageKey: value.stageKey as PlatformSalesStage,
    nextActionText: value.nextActionText as string | null, nextActionDueDate: value.nextActionDueDate as string | null,
  };
}

export function parseRequestsQueue(
  value: unknown, organizationId: string, selection: RequestSelection,
  decodeApplication: (raw: unknown) => StudentApplication,
  decodeConsultation: (raw: unknown) => ConsultationRow,
): RequestsQueue {
  if (!keys(value, "counts,latestAt,limit,nextCursor,organizationId,previousCursor,rows,source,states,status,version")
    || value.version !== 2 || value.organizationId !== organizationId || !sameFilters(value, selection)
    || !keys(value.states, "application,consultation,lead")
    || !keys(value.counts, "application,consultation,website,whatsapp")
    || (value.latestAt !== null && !timestamp(value.latestAt))
    || !Array.isArray(value.rows) || value.rows.length > selection.limit) return invalid();
  const states = value.states as Record<RequestKind, RequestKindState>;
  const counts = value.counts as RequestsQueue["counts"];
  for (const kind of REQUEST_KINDS) if (states[kind] !== "ready" && states[kind] !== "forbidden") return invalid();
  // Нет чтения — нет числа: у закрытого роли вида число null, у читаемого — целое ≥ 0.
  for (const tab of REQUEST_TABS) {
    const count = counts[tab];
    if (states[TAB_KIND[tab]] === "ready" ? !Number.isSafeInteger(count) || (count as number) < 0 : count !== null) return invalid();
  }
  const latestAt = value.latestAt as string | null;
  const rows: RequestRow[] = value.rows.map((raw): RequestRow => {
    if (!record(raw) || !uuid(raw.id) || !timestamp(raw.occurredAt) || !text(raw.personName, 500) || !raw.personName.trim()
      || !REQUEST_KINDS.includes(raw.kind as RequestKind) || states[raw.kind as RequestKind] !== "ready"
      || (selection.source !== "all" && raw.source !== selection.source)
      || latestAt === null || raw.occurredAt > latestAt) return invalid();
    const base = { id: raw.id, occurredAt: raw.occurredAt, personName: raw.personName };
    if (raw.kind === "lead") {
      if (!keys(raw, "email,handedOff,id,kind,leadId,occurredAt,owner,personName,phone,source,take")
        || (raw.source !== "website" && raw.source !== "whatsapp") || raw.leadId !== raw.id
        || (raw.email !== null && !text(raw.email, 320)) || (raw.phone !== null && !text(raw.phone, 100))
        || typeof raw.handedOff !== "boolean") return invalid();
      const owner = parseOwner(raw.owner);
      const take = parseTake(raw.take);
      // Взять можно только лид без ответственного и не переданный; «Ждут разбора» — только такие.
      if ((take && (owner || raw.handedOff)) || (selection.status === "waiting" && (owner || raw.handedOff))) return invalid();
      return {
        ...base, kind: "lead", source: raw.source, leadId: raw.id, email: raw.email as string | null, phone: raw.phone as string | null,
        owner, handedOff: raw.handedOff, take,
      };
    }
    if (raw.kind === "application") {
      if (!keys(raw, "application,email,id,kind,leadId,occurredAt,personName,source") || raw.source !== "platform_application") return invalid();
      const application = decodeApplication(raw.application);
      if (application.id !== raw.id || application.email !== raw.email || application.canonicalLeadId !== raw.leadId
        || `${application.questionnaire.firstName} ${application.questionnaire.lastName}` !== raw.personName
        || Date.parse(application.submittedAt) !== Date.parse(raw.occurredAt)
        || (selection.status === "waiting" && application.status !== "pending")) return invalid();
      return { ...base, kind: "application", source: "platform_application", application, email: application.email, leadId: application.canonicalLeadId };
    }
    if (!keys(raw, "consultation,id,kind,occurredAt,personName,source") || raw.source !== "portal_consultation") return invalid();
    const consultation = decodeConsultation(raw.consultation);
    if (consultation.id !== raw.id || consultation.studentName !== raw.personName || Date.parse(consultation.requestedAt) !== Date.parse(raw.occurredAt)
      || (selection.status === "waiting" && consultation.status !== "requested")) return invalid();
    return { ...base, kind: "consultation", source: "portal_consultation", consultation };
  });
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && compare(position(rows[i - 1]), position(rows[i])) <= 0) return invalid();
    if (selection.cursor && (selection.cursor.direction === "next"
      ? compare(position(rows[i]), selection.cursor) >= 0 : compare(position(rows[i]), selection.cursor) <= 0)) return invalid();
  }
  if (new Set(rows.map((row) => `${row.kind}:${row.id}`)).size !== rows.length) return invalid();
  const tabs = selectedTabs(selection.source);
  for (const tab of tabs) {
    if (rows.filter((row) => requestRowTab(row) === tab).length > (counts[tab] ?? 0)) return invalid();
  }
  const knownCount = tabs.reduce((total, tab) => total + (counts[tab] ?? 0), 0);
  if (!selection.cursor && rows.length !== Math.min(knownCount, selection.limit)) return invalid();
  // Заявок источника не было вовсе — нет и строк ни в одном состоянии.
  if (latestAt === null && knownCount !== 0) return invalid();
  const nextCursor = value.nextCursor === null ? null : parseRequestCursor(value.nextCursor, selection);
  const previousCursor = value.previousCursor === null ? null : parseRequestCursor(value.previousCursor, selection);
  for (const [cursor, direction, boundary] of [[nextCursor, "next", rows.at(-1)], [previousCursor, "previous", rows[0]]] as const) {
    if (cursor && (cursor.direction !== direction || (boundary ? compare(cursor, position(boundary)) !== 0
      : !selection.cursor || compare(cursor, selection.cursor) !== 0 || cursor.direction === selection.cursor.direction))) return invalid();
  }
  return { rows, states, counts, latestAt, nextCursor, previousCursor };
}
