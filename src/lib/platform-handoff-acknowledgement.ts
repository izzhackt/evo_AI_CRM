import type { PlatformActor } from "./platform-auth";

export type HandoffDecision = "accepted" | "clarification_requested";
export type HandoffResponse = Readonly<{
  acknowledgementId: string;
  decision: HandoffDecision;
  clarification: string | null;
  agreedContactDate: string | null;
  createdAt: string;
}>;
export type HandoffAcknowledgement = Readonly<{
  organizationId: string;
  studentCaseId: string;
  assignmentEventId: string | null;
  canRespond: boolean;
  current: HandoffResponse | null;
}>;
export type SalesHandoffAcknowledgement = Readonly<{
  canRespond: false;
  current: Pick<HandoffResponse, "decision" | "clarification" | "agreedContactDate"> | null;
}>;
export type HandoffResponseInput = Readonly<{
  studentCaseId: string;
  assignmentEventId: string;
  expectedAcknowledgementId: string | null;
  decision: HandoffDecision;
  clarification: string | null;
  agreedContactDate: string | null;
  requestId: string;
}>;
export type HandoffResponseErrorReason = "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable";
export class HandoffResponseError extends Error {
  readonly reason: HandoffResponseErrorReason;
  constructor(reason: HandoffResponseErrorReason = "unavailable") {
    super("Handoff response is unavailable.");
    this.name = "HandoffResponseError";
    this.reason = reason;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const RESPONSE_KEYS = ["acknowledgement_id", "decision", "clarification", "agreed_contact_date", "created_at"];
function fail(reason: HandoffResponseErrorReason = "unavailable"): never {
  throw new HandoffResponseError(reason);
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) return fail();
  return value as Record<string, unknown>;
}
export function handoffUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value)
    && value !== "00000000-0000-0000-0000-000000000000" ? value.toLowerCase() : null;
}
function requiredUuid(value: unknown): string {
  return handoffUuid(value) ?? fail();
}
function optionalUuid(value: unknown): string | null {
  return value === null ? null : requiredUuid(value);
}
export function handoffContactDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
    || value < "0001-01-01") return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
export function parseHandoffResponseInput(value: unknown): HandoffResponseInput | null {
  try {
    const row = record(value, ["studentCaseId", "assignmentEventId", "expectedAcknowledgementId",
      "decision", "clarification", "agreedContactDate", "requestId"]);
    const studentCaseId = handoffUuid(row.studentCaseId);
    const assignmentEventId = handoffUuid(row.assignmentEventId);
    const expectedAcknowledgementId = optionalUuid(row.expectedAcknowledgementId);
    const decision = row.decision;
    const clarification = row.clarification === null ? null
      : typeof row.clarification === "string" ? row.clarification.trim() : fail();
    const agreedContactDate = row.agreedContactDate === null ? null : handoffContactDate(row.agreedContactDate);
    if (!studentCaseId || !assignmentEventId || typeof row.requestId !== "string"
      || !REQUEST_UUID.test(row.requestId)
      || (decision !== "accepted" && decision !== "clarification_requested")
      || (decision === "accepted" && clarification !== null)
      || (decision === "clarification_requested" && !clarification)
      || (clarification !== null && ([...clarification].length > 2000 || CONTROLS.test(clarification)))
      || (row.agreedContactDate !== null && agreedContactDate === null)) return null;
    return Object.freeze({ studentCaseId, assignmentEventId, expectedAcknowledgementId,
      decision, clarification, agreedContactDate, requestId: row.requestId.toLowerCase() });
  } catch { return null; }
}
function responseFields(row: Record<string, unknown>): NonNullable<SalesHandoffAcknowledgement["current"]> {
  if (row.decision !== "accepted" && row.decision !== "clarification_requested") return fail();
  const clarification = row.clarification;
  if ((row.decision === "accepted" && clarification !== null)
    || (row.decision === "clarification_requested" && (typeof clarification !== "string"
      || !clarification.trim() || clarification.trim() !== clarification
      || [...clarification].length > 2000 || CONTROLS.test(clarification)))) return fail();
  const agreedContactDate = row.agreed_contact_date === null ? null : handoffContactDate(row.agreed_contact_date);
  if (row.agreed_contact_date !== null && agreedContactDate === null) return fail();
  return Object.freeze({ decision: row.decision, clarification: clarification as string | null, agreedContactDate });
}
function response(value: unknown): HandoffResponse {
  const row = record(value, RESPONSE_KEYS);
  const fields = responseFields(row);
  if (typeof row.created_at !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(row.created_at)
    || !Number.isFinite(Date.parse(row.created_at))) return fail();
  return Object.freeze({ acknowledgementId: requiredUuid(row.acknowledgement_id),
    ...fields, createdAt: row.created_at });
}
export function normalizeHandoffAcknowledgement(
  value: unknown, organizationId: string, studentCaseId: string,
): HandoffAcknowledgement {
  const row = record(value, ["organization_id", "student_case_id", "assignment_event_id", "can_respond", "current"]);
  if (requiredUuid(row.organization_id) !== organizationId
    || requiredUuid(row.student_case_id) !== studentCaseId || typeof row.can_respond !== "boolean") return fail();
  const assignmentEventId = optionalUuid(row.assignment_event_id);
  if (assignmentEventId === null && (row.can_respond || row.current !== null)) return fail();
  return Object.freeze({ organizationId, studentCaseId, assignmentEventId,
    canRespond: row.can_respond, current: row.current === null ? null : response(row.current) });
}
function rpcFailure(error: unknown): never {
  const row = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return fail(row.code === "42501" ? "forbidden" : row.code === "40001" ? "stale"
    : row.code === "22023" && String(row.message).includes("already used") ? "request_conflict"
    : row.code === "22023" ? "invalid" : "unavailable");
}
async function client() {
  if (typeof window !== "undefined") return fail();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}
export async function getHandoffAcknowledgement(actor: PlatformActor, studentCaseId: string): Promise<HandoffAcknowledgement> {
  if (!handoffUuid(studentCaseId) || !handoffUuid(actor.organizationId)) return fail("invalid");
  if (actor.authorityRole !== "admin" && actor.authorityRole !== "admissions") return fail("forbidden");
  const result = await (await client()).schema("platform").rpc("staff_student_case_handoff_acknowledgement",
    { p_student_case_id: studentCaseId });
  if (result.error) return rpcFailure(result.error);
  const snapshot = normalizeHandoffAcknowledgement(result.data, actor.organizationId, studentCaseId);
  if (snapshot.canRespond && actor.authorityRole !== "admissions" && actor.authorityRole !== "admin") return fail();
  return snapshot;
}
export function normalizeSalesHandoffAcknowledgement(
  value: unknown, organizationId: string, leadId: string, studentCaseId: string,
): SalesHandoffAcknowledgement {
  const row = record(value, ["organization_id", "lead_id", "student_case_id", "can_respond", "current"]);
  if (requiredUuid(row.organization_id) !== organizationId || requiredUuid(row.lead_id) !== leadId
    || requiredUuid(row.student_case_id) !== studentCaseId || row.can_respond !== false) return fail();
  return Object.freeze({ canRespond: false, current: row.current === null ? null
    : responseFields(record(row.current, ["decision", "clarification", "agreed_contact_date"])) });
}
export async function getSalesHandoffAcknowledgement(
  actor: PlatformActor, leadId: string, studentCaseId: string,
): Promise<SalesHandoffAcknowledgement> {
  if (!handoffUuid(leadId) || !handoffUuid(studentCaseId) || !handoffUuid(actor.organizationId)) return fail("invalid");
  if (actor.authorityRole !== "admin" && actor.authorityRole !== "sales") return fail("forbidden");
  const result = await (await client()).schema("platform").rpc("staff_lead_handoff_acknowledgement", { p_lead_id: leadId });
  if (result.error) return rpcFailure(result.error);
  return normalizeSalesHandoffAcknowledgement(result.data, actor.organizationId, leadId, studentCaseId);
}
export async function respondToHandoff(actor: PlatformActor, input: HandoffResponseInput): Promise<HandoffResponse> {
  const parsed = parseHandoffResponseInput(input);
  if (!parsed || !handoffUuid(actor.organizationId)) return fail("invalid");
  // Actual Admin may be the assigned curator without changing identity. The RPC
  // rechecks current ownership and the exact assignment event, never a preview role.
  if (actor.authorityRole !== "admissions" && actor.authorityRole !== "admin") return fail("forbidden");
  const result = await (await client()).schema("platform").rpc("respond_student_case_handoff", {
    p_organization_id: actor.organizationId, p_student_case_id: parsed.studentCaseId,
    p_assignment_event_id: parsed.assignmentEventId,
    p_expected_acknowledgement_id: parsed.expectedAcknowledgementId,
    p_decision: parsed.decision, p_clarification: parsed.clarification,
    p_agreed_contact_date: parsed.agreedContactDate, p_request_id: parsed.requestId,
  });
  if (result.error) return rpcFailure(result.error);
  const row = record(result.data, [...RESPONSE_KEYS, "organization_id", "student_case_id", "assignment_event_id", "request_id"]);
  if (requiredUuid(row.organization_id) !== actor.organizationId
    || requiredUuid(row.student_case_id) !== parsed.studentCaseId
    || requiredUuid(row.assignment_event_id) !== parsed.assignmentEventId
    || requiredUuid(row.request_id) !== parsed.requestId) return fail();
  const saved = response(Object.fromEntries(RESPONSE_KEYS.map((key) => [key, row[key]])));
  if (saved.decision !== parsed.decision || saved.clarification !== parsed.clarification
    || saved.agreedContactDate !== parsed.agreedContactDate) return fail();
  return saved;
}
