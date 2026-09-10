import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  handoffContactDate, parseHandoffResponseInput, normalizeHandoffAcknowledgement, normalizeSalesHandoffAcknowledgement,
  HandoffResponseError,
} from "../src/lib/platform-handoff-acknowledgement.ts";

// Pure boundary values only. No staff/customer records or mocked RPC success.
const organizationId = randomUUID();
const studentCaseId = randomUUID();
const assignmentEventId = randomUUID();
const input = () => ({ studentCaseId, assignmentEventId, expectedAcknowledgementId: null,
  decision: "accepted", clarification: null, agreedContactDate: null, requestId: randomUUID() });
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("contact date is optional, date-only and never invented or rolled over", () => {
  assert.equal(parseHandoffResponseInput(input()).agreedContactDate, null);
  assert.equal(handoffContactDate("2028-02-29"), "2028-02-29");
  for (const value of ["2026-02-29", "2026-04-31", "0000-01-01", "2026-09-08T12:00:00Z", "", null]) {
    assert.equal(handoffContactDate(value), null);
  }
});

test("decision inputs reject extra fields, missing assignment and unsupported response", () => {
  for (const patch of [
    { actorId: randomUUID() }, { assignmentEventId: null }, { decision: "handoff" },
    { requestId: "retry" }, { expectedAcknowledgementId: "old" },
    { clarification: "accepted must not hide a request" }, { agreedContactDate: "2026-02-29" },
  ]) assert.equal(parseHandoffResponseInput({ ...input(), ...patch }), null);
});

test("clarification is concrete bounded prose; surrounding Unicode spaces normalize", () => {
  const value = { ...input(), decision: "clarification_requested", clarification: "\u00a0Уточните следующий шаг.\u00a0" };
  assert.equal(parseHandoffResponseInput(value).clarification, "Уточните следующий шаг.");
  for (const clarification of [null, " ", "\u00a0", "a\u0001", "a".repeat(2001)]) {
    assert.equal(parseHandoffResponseInput({ ...value, clarification }), null);
  }
  assert.ok(parseHandoffResponseInput({ ...value, clarification: "😀".repeat(2000) }));
});

test("safe projection is exact, tenant-bound and cannot respond without assignment", () => {
  const row = { organization_id: organizationId, student_case_id: studentCaseId,
    assignment_event_id: assignmentEventId, can_respond: false, current: null };
  const normalized = normalizeHandoffAcknowledgement(row, organizationId, studentCaseId);
  assert.equal(normalized.canRespond, false);
  for (const patch of [{ organization_id: randomUUID() }, { student_case_id: randomUUID() },
    { raw_audit: {} }, { assignment_event_id: null, can_respond: true }, { can_respond: "true" }]) {
    assert.throws(() => normalizeHandoffAcknowledgement({ ...row, ...patch }, organizationId, studentCaseId), HandoffResponseError);
  }
});

test("migration preserves completed handoff, binds current assignment and appends one audit", () => {
  const sql = read("supabase/migrations/130_platform_curator_handoff_acknowledgement.sql");
  assert.match(sql, /ORDER BY assignment\.new_scope_version DESC LIMIT 1/);
  assert.match(sql, /assignment_id IS DISTINCT FROM p_assignment_event_id/);
  assert.match(sql, /current_response\.id IS DISTINCT FROM p_expected_acknowledgement_id/);
  assert.match(sql, /actor\.actor_role <> 'curator'/);
  assert.match(sql, /response\.curator_membership_id IS DISTINCT FROM actor\.actor_membership_id/);
  assert.match(sql, /request_id UUID NOT NULL UNIQUE/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.equal((sql.match(/INSERT INTO platform\.audit_events/g) ?? []).length, 1);
  assert.match(sql, /case\.handoff\.acknowledge/);
  assert.match(sql, /case\.handoff\.clarification/);
  assert.doesNotMatch(sql, /UPDATE platform\.student_cases|INSERT INTO platform\.(tasks|student_case_tasks|sales_admissions_handoffs)/);
  const afterState = sql.slice(sql.indexOf("jsonb_build_object('acknowledgement_id', response.id"), sql.indexOf("'Curator handoff response recorded'"));
  assert.doesNotMatch(afterState, /clarification/);
});

test("Sales summary accepts only current decision/prose/date, never response history or action permission", () => {
  const leadId = randomUUID();
  const row = { organization_id: organizationId, lead_id: leadId, student_case_id: studentCaseId,
    can_respond: false, current: { decision: "clarification_requested", clarification: "Уточните следующий шаг.", agreed_contact_date: null } };
  assert.deepEqual(normalizeSalesHandoffAcknowledgement(row, organizationId, leadId, studentCaseId), {
    canRespond: false, current: { decision: "clarification_requested", clarification: "Уточните следующий шаг.", agreedContactDate: null },
  });
  for (const patch of [{ can_respond: true }, { lead_id: randomUUID() }, { organization_id: randomUUID() },
    { current: { ...row.current, assignment_event_id: assignmentEventId } }, { history: [] }]) {
    assert.throws(() => normalizeSalesHandoffAcknowledgement({ ...row, ...patch }, organizationId, leadId, studentCaseId), HandoffResponseError);
  }
  const sql = read("supabase/migrations/130_platform_curator_handoff_acknowledgement.sql");
  assert.match(sql, /SELECT \* INTO handoff FROM platform\.staff_lead_admissions_handoff\(p_lead_id\)/);
  assert.match(sql, /handoff\.case_id IS NULL OR handoff\.handed_off_at IS NULL/);
});

test("form keeps controlled input on errors and uses real authority not role preview", () => {
  const form = read("src/components/v3/profile/ProfileSalesTransition.tsx");
  const repository = read("src/lib/platform-handoff-acknowledgement.ts");
  const actions = read("src/lib/platform-handoff-acknowledgement-actions.ts");
  assert.match(form, /value=\{clarification\}/);
  assert.match(form, /value=\{contactDate\}/);
  assert.match(form, /pending \|\| needsRefresh \|\| unchanged/);
  assert.match(form, /submittedContext === currentContext/);
  assert.doesNotMatch(form.slice(form.indexOf("export function ProfileHandoffAcknowledgement")), /setClarification\(""\)|setContactDate\(""\)/);
  assert.match(repository, /actor\.authorityRole !== "admissions" && actor\.authorityRole !== "admin"/);
  assert.doesNotMatch(repository, /presentationRole/);
  assert.match(actions, /exactActionStringFields\(form, FIELDS\)/);
  assert.match(actions, /actor\.presentationRole !== actor\.authorityRole/);
  assert.match(actions, /await respondToHandoff\(actor, input\)/);
});
