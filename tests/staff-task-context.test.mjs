import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { plainTextLinks } from "../src/lib/plain-text-links.ts";
import { parseStaffTaskCommand, STAFF_TASK_FORM_FIELDS } from "../src/lib/platform-staff-task-contract.ts";

test("chat link tokenizer preserves every character and only anchors explicit safe web URLs", () => {
  const body = 'Ссылка (https://example.org/a(b)). Потом https://example.org/x?q=1&v=2! <script>x</script> javascript:alert(1)';
  const parts = plainTextLinks(body);
  assert.equal(parts.map((part) => part.text).join(""), body);
  assert.deepEqual(parts.filter((part) => part.href).map((part) => part.text), ["https://example.org/a(b)", "https://example.org/x?q=1&v=2"]);
  for (const bad of ["javascript:https://example.org", "https://user:pass@example.org", "https://", "www.example.org"]) {
    assert.equal(plainTextLinks(bad).some((part) => part.href), false);
    assert.equal(plainTextLinks(bad).map((part) => part.text).join(""), bad);
  }
});

const request = "ba7cfb44-5c43-4de7-8cdd-588ef10cd25b";
const task = "57ce9b97-43fb-4563-9c61-b8c6cf901a7b";
const lead = "f8dc6154-9d8d-4475-afc4-9f35167fbbdd";
function fields(overrides = {}) {
  return new Map(STAFF_TASK_FORM_FIELDS.map((name) => [name, ({ operation: "create", request_id: request,
    expected_version: "0", status: "open", title: "Связаться", assignee_membership_id: task,
    priority: "normal", deadline_kind: "none", ...overrides })[name] ?? ""]));
}
test("lead task and chat task provenance are exclusive and version-bound", () => {
  const input = { source_lead_id: lead, source_lead_version: "3" };
  assert.equal(parseStaffTaskCommand(fields(input)).p_source_lead_id, lead);
  assert.equal(parseStaffTaskCommand(fields({ ...input, source_lead_version: "" })), null);
  assert.equal(parseStaffTaskCommand(fields({ ...input, source_message_id: task, source_message_version: "1" })), null);
  assert.equal(parseStaffTaskCommand(fields({ ...input, operation: "edit", task_id: task, expected_version: "1" })), null);
});
test("completion notes are bounded and only accompany completion", () => {
  const input = { operation: "status", task_id: task, expected_version: "2", status: "done", title: "",
    assignee_membership_id: "", priority: "", deadline_kind: "", completion_note: "Позвонил, договорились о встрече." };
  assert.equal(parseStaffTaskCommand(fields(input)).p_completion_note, input.completion_note);
  assert.equal(parseStaffTaskCommand(fields({ ...input, status: "open" })), null);
  assert.equal(parseStaffTaskCommand(fields({ ...input, completion_note: "a".repeat(4001) })), null);
  assert.equal(parseStaffTaskCommand(fields({ ...input, completion_note: "bad\u0001" })), null);
});
test("task context SQL binds provenance and outcome to canonical authority and receipts", () => {
  const sql = readFileSync(new URL("../supabase/migrations/147_platform_staff_task_leads_results.sql", import.meta.url), "utf8");
  assert.match(sql, /private\.platform_can_read_canonical_lead/g);
  assert.match(sql, /REFERENCES platform\.staff_task_events\(organization_id,staff_task_id,version\)/);
  assert.match(sql, /staff_task_receipts WHERE request_id=p_request_id/);
  assert.match(sql, /staff_lead_task_links ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /staff_task_outcomes FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /prior\.input IS DISTINCT FROM payload/);
  assert.doesNotMatch(sql, /UPDATE platform\.leads/);
});

test("linked lead context uses canonical authority without requiring Sales-only access", () => {
  const sql = readFileSync(new URL("../supabase/migrations/147_platform_staff_task_leads_results.sql", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/app/(v3)/v3/tasks/page.tsx", import.meta.url), "utf8");
  const pipeline = readFileSync(new URL("../src/components/v3/Pipeline.tsx", import.meta.url), "utf8");
  assert.match(sql, /CREATE FUNCTION platform\.staff_task_lead_context/);
  assert.match(sql, /LEFT JOIN platform\.clients/);
  assert.match(page, /readStaffTaskLeadContext\(actor, sourceLeadId\)/);
  assert.doesNotMatch(page, /getPlatformSalesLead/);
  assert.match(page, /sourceLead\.canOpenPipeline/);
  assert.match(pipeline, /actorRole === "admin" \|\| lead\.workflow\.currentOwnerMembershipId === actorMembershipId/);
});
