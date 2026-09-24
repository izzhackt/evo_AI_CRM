// «Студенты» queue backend (migration 241): unit tests of the typed contract,
// the write's input/receipt/error mapping and the wording it relies on.
// These supplement, never replace, the real-Postgres boundary suite
// supabase/tests/platform_case_next_action_queue.sql (checkpoint 241 in
// scripts/test-postgres-authorization.sh), which proves authorization,
// replay, conflicts, paging, counts and the staff-only boundary (the Student
// projections never return the step) against the actual SQL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CASE_NEXT_ACTION_BANDS,
  STUDENT_CASE_QUEUE_SORTS,
  STUDENT_CASE_QUEUE_VIEWS,
  StudentCaseQueueContractError,
  buildStudentCaseQueueCountsRpcArguments,
  buildStudentCaseQueueRpcArguments,
  caseNextActionStatusFromRpcError,
  normalizeCaseNextActionReceipt,
  normalizeStudentCaseQueueCounts,
  normalizeStudentCaseQueuePage,
  parseCaseNextActionInput,
  parseExpectedAdmissionsVersion,
  parseStudentCaseQueueCursor,
} from "../src/lib/platform-student-case-queue-contract.ts";
import { PlatformCaseNextActionError, setCaseNextAction } from "../src/lib/platform-student-case-queue.ts";
import { ADMISSIONS_PIPELINE_STAGES } from "../src/lib/platform-admissions-pipeline-contract.ts";
import { caseNextActionOutcome, journalEvent } from "../src/lib/v3/wording.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = source("supabase/migrations/241_platform_case_next_action_queue.sql");
const suite = source("supabase/tests/platform_case_next_action_queue.sql");
const actions = source("src/lib/platform-case-next-action-actions.ts");
const serverModule = source("src/lib/platform-student-case-queue.ts");

const ORG = "24100000-0000-4000-8000-000000000001";
const CASE_A = "24100000-0000-4000-8000-000000000501";
const CASE_B = "24100000-0000-4000-8000-000000000502";
const CURATOR = "24100000-0000-4000-8000-000000000303";
const REQUEST = "5b0d7c0e-2d4f-4c1a-9a7e-3f2b1c0d9e8f";
const rejects = (fn) => assert.throws(fn, StudentCaseQueueContractError);

function row(overrides = {}) {
  return {
    student_case_id: CASE_A,
    student_display_name: "Synthetic Student",
    state: "active",
    admissions_direction: "EUROPE",
    target_country: "CZ",
    target_degree: "Bachelor",
    pipeline_stage: "documents",
    pipeline_hidden: false,
    next_action: "Позвонить студенту",
    next_action_due_on: "2026-09-23",
    due_band: "overdue",
    admissions_version: "4",
    current_curator_membership_id: CURATOR,
    current_curator_display_name: "Synthetic Curator",
    is_mine: true,
    attention_flags: ["overdue"],
    overdue_task_count: 0,
    documents: { total: 5, submitted: 1, correction_required: 1, rejected: 1, approved: 1, missing: 1 },
    updated_at: "2026-09-25T10:00:00.123456+06:00",
    cursor: `due|0|2026-09-23|${CASE_A}`,
    ...overrides,
  };
}

test("vocabularies match the SQL contract exactly", () => {
  assert.deepEqual([...STUDENT_CASE_QUEUE_VIEWS], ["mine", "needs_action", "active", "needs_curator", "closed"]);
  assert.deepEqual([...STUDENT_CASE_QUEUE_SORTS], ["due", "updated"]);
  assert.deepEqual([...CASE_NEXT_ACTION_BANDS], ["overdue", "today", "this_week", "later", "undated", "no_step"]);
  assert.match(migration, /p_view NOT IN \('mine', 'needs_action', 'active', 'needs_curator', 'closed'\)/u);
  assert.match(migration, /p_sort NOT IN \('due', 'updated'\)/u);
  for (const band of CASE_NEXT_ACTION_BANDS) assert.match(migration, new RegExp(`'${band}'`, "u"));
  const stageChecks = [...migration.matchAll(/p_pipeline_stage NOT IN \(([^)]*)\)/gu)];
  assert.equal(stageChecks.length, 2, "queue and counts both validate the board stage");
  for (const check of stageChecks) {
    assert.deepEqual([...check[1].matchAll(/'([a-z_]+)'/gu)].map((match) => match[1]), [...ADMISSIONS_PIPELINE_STAGES]);
  }
});

test("next-step input mirrors the SQL: trim, one line, 1000 characters, date needs a step", () => {
  assert.deepEqual(parseCaseNextActionInput("  Позвонить \u00a0", ""), { nextAction: "Позвонить", dueOn: null });
  assert.deepEqual(parseCaseNextActionInput("Шаг", " 2026-09-30 "), { nextAction: "Шаг", dueOn: "2026-09-30" });
  assert.deepEqual(parseCaseNextActionInput(" \t\u3000", ""), { nextAction: null, dueOn: null }, "blank clears");
  assert.equal(parseCaseNextActionInput("", "2026-09-30"), null, "a date without a step");
  assert.equal(parseCaseNextActionInput("Строка\nвторая", ""), null, "newline inside");
  assert.equal(parseCaseNextActionInput("a\u2028b", ""), null, "line separator inside");
  assert.equal(parseCaseNextActionInput("a\u0085b", ""), null, "C1 control inside");
  assert.equal(parseCaseNextActionInput("я".repeat(1000), "")?.nextAction?.length, 1000);
  assert.equal(parseCaseNextActionInput("я".repeat(1001), ""), null);
  assert.equal(parseCaseNextActionInput("😀".repeat(1000), "")?.nextAction, "😀".repeat(1000), "code points, not UTF-16 units");
  assert.equal(parseCaseNextActionInput("😀".repeat(1001), ""), null);
  for (const date of ["2026-02-30", "2026-13-01", "26-09-30", "2026-9-30", "0000-01-01", "infinity"]) {
    assert.equal(parseCaseNextActionInput("Шаг", date), null, date);
  }
  assert.deepEqual(parseCaseNextActionInput("Шаг", "2028-02-29"), { nextAction: "Шаг", dueOn: "2028-02-29" });
  assert.equal(parseCaseNextActionInput(null, ""), null);
  assert.equal(parseCaseNextActionInput("Шаг", undefined), null);
});

test("expected versions are decimal bigints within range", () => {
  for (const value of ["0", "1", "9223372036854775806"]) assert.equal(parseExpectedAdmissionsVersion(value), value);
  for (const value of ["-1", "01", "1.0", "9223372036854775807", "9223372036854775808", "", " 1", 1, null]) {
    assert.equal(parseExpectedAdmissionsVersion(value), null, String(value));
  }
});

test("keyset cursors are validated like the SQL and carry no personal data", () => {
  assert.equal(parseStudentCaseQueueCursor(`due|0|2026-09-23|${CASE_A}`, "due"), `due|0|2026-09-23|${CASE_A}`);
  assert.equal(parseStudentCaseQueueCursor(`due|1|infinity|${CASE_A}`, "due"), `due|1|infinity|${CASE_A}`);
  assert.equal(parseStudentCaseQueueCursor(`due|2|infinity|${CASE_A}`, "due"), `due|2|infinity|${CASE_A}`);
  const updated = `updated|2026-09-25T04:00:00.123456Z|${CASE_A}`;
  assert.equal(parseStudentCaseQueueCursor(updated, "updated"), updated);
  for (const [value, sort] of [
    [`due|0|infinity|${CASE_A}`, "due"],
    [`due|1|2026-09-23|${CASE_A}`, "due"],
    [`due|0|2026-02-30|${CASE_A}`, "due"],
    [`due|3|infinity|${CASE_A}`, "due"],
    ["due|0|2026-09-23|5B0D7C0E-2D4F-4C1A-9A7E-3F2B1C0D9E8F", "due"],
    [`due|0|2026-09-23|${CASE_A}`, "updated"],
    [updated, "due"],
    [`updated|2026-09-25T04:00:00Z|${CASE_A}`, "updated"],
    [`name|Synthetic Student|${CASE_A}`, "due"],
    ["", "due"],
    [null, "due"],
  ]) {
    assert.equal(parseStudentCaseQueueCursor(value, sort), null, String(value));
  }
});

test("RPC arguments omit unset filters and refuse anything the SQL would refuse", () => {
  assert.deepEqual(buildStudentCaseQueueRpcArguments({ view: "mine" }), { p_view: "mine", p_limit: 25, p_sort: "due" });
  assert.deepEqual(buildStudentCaseQueueRpcArguments({
    view: "active", sort: "updated", pageSize: 50, cursor: `updated|2026-09-25T04:00:00.123456Z|${CASE_A}`,
    direction: "unknown", curatorMembershipId: CURATOR.toUpperCase(), pipelineStage: "visa", query: "  Иван  ",
  }), {
    p_view: "active", p_limit: 50, p_sort: "updated", p_cursor: `updated|2026-09-25T04:00:00.123456Z|${CASE_A}`,
    p_direction: "unknown", p_curator_membership_id: CURATOR, p_pipeline_stage: "visa", p_query: "Иван",
  });
  assert.equal(buildStudentCaseQueueRpcArguments({ view: "mine", pageSize: 500 }).p_limit, 25);
  assert.deepEqual(buildStudentCaseQueueCountsRpcArguments("closed", { query: " " }), { p_view: "closed" });
  rejects(() => buildStudentCaseQueueRpcArguments({ view: "everything" }));
  rejects(() => buildStudentCaseQueueRpcArguments({ view: "mine", sort: "name" }));
  rejects(() => buildStudentCaseQueueRpcArguments({ view: "mine", direction: "XX" }));
  rejects(() => buildStudentCaseQueueRpcArguments({ view: "mine", pipelineStage: "nowhere" }));
  rejects(() => buildStudentCaseQueueRpcArguments({ view: "mine", curatorMembershipId: "not-a-uuid" }));
  rejects(() => buildStudentCaseQueueRpcArguments({ view: "mine", query: "x".repeat(201) }));
  rejects(() => buildStudentCaseQueueRpcArguments({ view: "mine", sort: "updated", cursor: `due|0|2026-09-23|${CASE_A}` }));
});

test("a queue page decodes exactly and fails closed on any inconsistency", () => {
  const request = { view: "mine", sort: "due", pageSize: 2 };
  const second = row({
    student_case_id: CASE_B, next_action: null, next_action_due_on: null, due_band: "no_step",
    documents: null, is_mine: true, attention_flags: [], cursor: `due|2|infinity|${CASE_B}`,
  });
  const page = normalizeStudentCaseQueuePage({
    view: "mine", sort: "due", today: "2026-09-25", rows: [row(), second], next_cursor: `due|2|infinity|${CASE_B}`,
  }, request);
  assert.equal(page.rows.length, 2);
  assert.equal(page.nextCursor, `due|2|infinity|${CASE_B}`);
  assert.deepEqual(page.rows[0].documents, { total: 5, submitted: 1, correctionRequired: 1, rejected: 1, approved: 1, missing: 1 });
  assert.equal(page.rows[0].pipelineStage, "documents");
  assert.equal(page.rows[0].admissionsVersion, "4");
  assert.equal(page.rows[1].documents, null, "no document read: no numbers, not zeros");
  assert.equal(page.rows[1].dueBand, "no_step");

  const base = { view: "mine", sort: "due", today: "2026-09-25", rows: [row()], next_cursor: null };
  assert.equal(normalizeStudentCaseQueuePage(base, request).rows.length, 1);
  rejects(() => normalizeStudentCaseQueuePage({ ...base, view: "active" }, request));
  rejects(() => normalizeStudentCaseQueuePage({ ...base, sort: "updated" }, request));
  rejects(() => normalizeStudentCaseQueuePage({ ...base, rows: [row(), row()] }, request), "duplicate id");
  rejects(() => normalizeStudentCaseQueuePage({ ...base, next_cursor: `due|0|2026-09-23|${CASE_A}` }, request), "next page after a short page");
  rejects(() => normalizeStudentCaseQueuePage({ ...base, rows: [row(), second], next_cursor: `due|0|2026-09-23|${CASE_A}` }, request), "cursor not at the last row");
  rejects(() => normalizeStudentCaseQueuePage({ ...base, rows: [row({ due_band: "today" })].slice(0, 1).map((r) => ({ ...r, due_band: "no_step" })) }, request), "band contradicts the step");
  rejects(() => normalizeStudentCaseQueuePage({ ...base, rows: [row({ next_action_due_on: null, due_band: "overdue" })] }, request), "undated row labelled overdue");
  rejects(() => normalizeStudentCaseQueuePage({ ...base, rows: [row({ cursor: `due|0|2026-09-23|${CASE_B}` })] }, request), "cursor of another row");
  rejects(() => normalizeStudentCaseQueuePage({ ...base, rows: [row({ pipeline_stage: "intake" })] }, request), "operational stage is not a board stage");
  rejects(() => normalizeStudentCaseQueuePage({ ...base, rows: [row({ documents: { total: 1, submitted: 1, correction_required: 1, rejected: 0, approved: 0, missing: 0 } })] }, request));
  rejects(() => normalizeStudentCaseQueuePage({ ...base, rows: [row({ is_mine: true, current_curator_membership_id: null })] }, request));
  rejects(() => normalizeStudentCaseQueuePage({ ...base, rows: [row({ attention_flags: ["overdue", "overdue"] })] }, request));
  rejects(() => normalizeStudentCaseQueuePage({ ...base, rows: [row({ admissions_version: 4 })] }, request), "bigint must stay text");
  rejects(() => normalizeStudentCaseQueuePage({ ...base, today: "2026-02-30" }, request));
});

test("counts decode only when the tab, total and bands agree", () => {
  const counts = {
    view: "mine", today: "2026-09-25", total: 3,
    views: { mine: 3, needs_action: 1, active: 9, needs_curator: 0, closed: 2 },
    bands: { overdue: 1, today: 1, this_week: 0, later: 0, undated: 0, no_step: 1 },
    directions: [{ direction: "EUROPE", count: 2 }, { direction: "unknown", count: 1 }],
    curators: [{ membership_id: CURATOR, display_name: "Synthetic Curator", is_me: true, count: 3 }],
    stages: [{ pipeline_stage: "documents", count: 3 }],
  };
  const decoded = normalizeStudentCaseQueueCounts(counts, "mine");
  assert.equal(decoded.views.closed, 2);
  assert.equal(decoded.curators[0].isMe, true);
  assert.equal(decoded.directions[1].direction, "unknown");
  rejects(() => normalizeStudentCaseQueueCounts(counts, "active"));
  rejects(() => normalizeStudentCaseQueueCounts({ ...counts, total: 4 }, "mine"));
  rejects(() => normalizeStudentCaseQueueCounts({ ...counts, bands: { ...counts.bands, later: 1 } }, "mine"));
  rejects(() => normalizeStudentCaseQueueCounts({ ...counts, views: { ...counts.views, extra: 1 } }, "mine"));
  rejects(() => normalizeStudentCaseQueueCounts({ ...counts, curators: [...counts.curators, ...counts.curators] }, "mine"));
  rejects(() => normalizeStudentCaseQueueCounts({ ...counts, stages: [{ pipeline_stage: "documents", count: 0 }] }, "mine"));
});

test("a receipt is accepted only for this exact committed write", () => {
  const expected = { organizationId: ORG, studentCaseId: CASE_A, requestId: REQUEST };
  const receipt = {
    organization_id: ORG, student_case_id: CASE_A, next_action: "Шаг", next_action_due_on: "2026-09-30",
    admissions_version: "5", cleared: false, request_id: REQUEST, changed_at: "2026-09-25T10:00:00.123456+06:00",
  };
  assert.deepEqual(normalizeCaseNextActionReceipt(receipt, expected), {
    studentCaseId: CASE_A, nextAction: "Шаг", nextActionDueOn: "2026-09-30", admissionsVersion: "5",
    cleared: false, requestId: REQUEST, changedAt: "2026-09-25T10:00:00.123456+06:00",
  });
  assert.equal(normalizeCaseNextActionReceipt({ ...receipt, next_action: null, next_action_due_on: null, cleared: true }, expected).cleared, true);
  rejects(() => normalizeCaseNextActionReceipt({ ...receipt, request_id: CASE_B }, expected));
  rejects(() => normalizeCaseNextActionReceipt({ ...receipt, student_case_id: CASE_B }, expected));
  rejects(() => normalizeCaseNextActionReceipt({ ...receipt, cleared: true }, expected));
  rejects(() => normalizeCaseNextActionReceipt({ ...receipt, next_action: null, cleared: true }, expected), "date without a step");
  rejects(() => normalizeCaseNextActionReceipt({ ...receipt, admissions_version: "0" }, expected), "a write always bumps the version");
});

test("RPC errors map to honest statuses", () => {
  assert.equal(caseNextActionStatusFromRpcError({ code: "42501", message: "Student case is unavailable" }), "forbidden");
  assert.equal(caseNextActionStatusFromRpcError({ code: "PT409", message: "case_next_action_version_conflict" }), "stale");
  assert.equal(caseNextActionStatusFromRpcError({ code: "22023", message: "case_next_action_request_conflict" }), "request_conflict");
  assert.equal(caseNextActionStatusFromRpcError({ code: "22023", message: "case_next_action_case_not_active" }), "not_active");
  assert.equal(caseNextActionStatusFromRpcError({ code: "22023", message: "case_next_action_invalid" }), "invalid");
  assert.equal(caseNextActionStatusFromRpcError({ code: "57014", message: "canceling statement" }), "unavailable");
  assert.equal(caseNextActionStatusFromRpcError(null), "unavailable");
  for (const message of ["case_next_action_invalid", "case_next_action_request_conflict", "case_next_action_case_not_active", "case_next_action_version_conflict"]) {
    assert.match(migration, new RegExp(`RAISE EXCEPTION '${message}'`, "u"), message);
  }
});

test("the write refuses malformed commands before any network call", async () => {
  const actor = { organizationId: ORG, systemRole: "staff", permissionKeys: ["case.read.full"] };
  const command = { studentCaseId: CASE_A, expectedVersion: "0", nextAction: "Шаг", dueOn: null, requestId: REQUEST };
  for (const bad of [{ studentCaseId: "x" }, { requestId: "x" }, { expectedVersion: "-1" }, { expectedVersion: "9223372036854775808" }]) {
    await assert.rejects(setCaseNextAction(actor, { ...command, ...bad }), (error) =>
      error instanceof PlatformCaseNextActionError && error.status === "invalid");
  }
});

test("every outcome has Russian copy and «История» knows the new event", () => {
  for (const status of ["saved", "invalid", "forbidden", "preview", "stale", "not_active", "request_conflict", "unavailable"]) {
    assert.ok(caseNextActionOutcome(status), status);
  }
  assert.equal(caseNextActionOutcome("saved"), "Следующий шаг сохранён.");
  assert.equal(caseNextActionOutcome("saved", true), "Следующий шаг снят.");
  assert.equal(caseNextActionOutcome("teleported"), null);
  const added = [...migration.matchAll(/'(case\.[a-z.]+)'\]::TEXT\[\]\)\$new\$/gu)].map((match) => match[1]);
  assert.deepEqual(added, ["case.next.action.change"]);
  for (const action of added) assert.ok(journalEvent(action), action);
  assert.match(migration, /INSERT INTO platform\.audit_events[\s\S]*'case\.next\.action\.change', 'student_case'/u);
});

test("migration 241 is forward-only, definer-safe and reuses the route-command authority", () => {
  assert.match(migration, /^BEGIN;$/mu);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /\bDROP\b|ALTER TABLE|CREATE OR REPLACE FUNCTION|session_replication_role|DISABLE\s+(?:ROW LEVEL SECURITY|TRIGGER)/iu);
  for (const name of ["set_case_next_action_v1", "staff_student_case_queue_v1", "staff_student_case_queue_counts_v1"]) {
    assert.match(migration, new RegExp(`CREATE FUNCTION platform\\.${name}\\(`, "u"));
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION platform\\.${name}\\([^)]*\\)\\s+FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;`, "u"));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION platform\\.${name}\\([^)]*\\)\\s+TO authenticated;`, "u"));
  }
  assert.equal(migration.match(/SECURITY DEFINER SET search_path = ''/gu)?.length, 3);
  assert.match(migration, /platform_private\.u7_require_case_workspace_actor\(p_student_case_id\)[\s\S]*platform_private\.lock_p2d_request\(p_request_id\)[\s\S]*platform_private\.admissions_lock_case\(p_student_case_id, 'case\.route\.manage'\)/u);
  assert.match(migration, /admissions_version = admissions_version \+ 1/u);
  assert.match(migration, /private\.platform_can_read_student_case\(c\.organization_id, c\.id\)/u);
  assert.match(migration, /private\.platform_can_read_document_full\(c\.organization_id, c\.id\)/u);
  assert.match(migration, /RAISE EXCEPTION 'staff_student_case_activity_source_anchor_drift'/u);
  assert.match(migration, /NOT BETWEEN 1 AND 100/u);
});

test("the staff next step never reaches the Student projections", () => {
  const block = migration.match(/DO \$a241_portal\$[\s\S]*?\$a241_portal\$;/u)?.[0] ?? "";
  assert.match(block, /ARRAY\['platform\.student_portal_cases\(\)', 'platform\.student_portal_profile\(\)'\]/u);
  assert.match(block, /replace\(original, 'student_case\.next_action,', 'NULL::TEXT,'\)/u);
  assert.match(block, /RAISE EXCEPTION 'student_portal_next_action_anchor_drift: %', target;/u);
  assert.match(migration, /COMMENT ON FUNCTION platform\.student_portal_cases\(\) IS\s+'[^']*next_action is always NULL since 241/u);
  assert.match(migration, /COMMENT ON FUNCTION platform\.student_portal_profile\(\) IS\s+'[^']*case_next_action is always NULL since 241/u);
  assert.match(suite, /the Student reads the own case, with no next step in student_portal_cases/u);
  assert.match(suite, /the staff text appears in no column of either Student projection/u);
  assert.match(suite, /the Student cannot write the step of the own case/u);
});

test("the SQL one-line rule is exactly the TypeScript one over the whole BMP", () => {
  const literal = migration.match(/normalized ~ U&'\[([^\]]+)\]'/u)?.[1];
  assert.ok(literal, "explicit, locale-independent control class");
  assert.doesNotMatch(migration, /\[\[:cntrl:\]\]/u);
  const ranges = [...literal.matchAll(/\\([0-9A-F]{4})(?:-\\([0-9A-F]{4}))?/gu)]
    .map((match) => [parseInt(match[1], 16), parseInt(match[2] ?? match[1], 16)]);
  const sqlRefuses = (code) => ranges.some(([from, to]) => code >= from && code <= to);
  for (let code = 1; code <= 0xffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const tsRefuses = parseCaseNextActionInput(`a${String.fromCharCode(code)}b`, "") === null;
    if (tsRefuses !== sqlRefuses(code)) assert.fail(`U+${code.toString(16).padStart(4, "0")}: TypeScript ${tsRefuses}, SQL ${sqlRefuses(code)}`);
  }
});

test("the real-Postgres suite runs at checkpoint 241 of the Migration boundary job", () => {
  const script = source("scripts/test-postgres-authorization.sh");
  assert.match(script, /== 241_\* \]\]; then\s+docker exec "\$container_name" \\\s+psql -X -v ON_ERROR_STOP=1 -h 127\.0\.0\.1 -U postgres -d "\$test_database" \\\s+-f \/workspace\/supabase\/tests\/platform_case_next_action_queue\.sql/u);
  assert.match(suite, /^BEGIN;$/mu);
  assert.match(suite, /^ROLLBACK;\s*$/mu);
  assert.match(suite, /N241_CASE_NEXT_ACTION_QUEUE_SUITE_PASS/u);
  assert.doesNotMatch(suite, /@(?!example\.invalid)[a-z0-9-]+\.[a-z]/iu, "synthetic addresses only");
});

test("the server action authorizes, never writes in role preview and keeps the request id for unknown outcomes", () => {
  assert.match(actions, /^"use server";/u);
  assert.match(actions, /if \(isStaffPreview\(actor\)\) return outcome\("preview", requestId\);/u);
  assert.match(actions, /if \(!staffCan\(actor, "admissions\.write"\)\) return outcome\("forbidden", requestId\);/u);
  assert.match(actions, /exactActionStringFields\(form, CASE_NEXT_ACTION_FIELDS\)/u);
  assert.match(actions, /status === "request_conflict" \|\| requestId === null \? randomUUID\(\) : requestId/u);
  assert.match(actions, /revalidatePath\("\/v3\/profile"\)/u);
  assert.match(serverModule, /\.rpc\("staff_student_case_queue_v1", args, \{ get: true \}\)/u);
  assert.match(serverModule, /\.rpc\("staff_student_case_queue_counts_v1", args, \{ get: true \}\)/u);
  assert.match(serverModule, /\.rpc\("set_case_next_action_v1", \{/u);
  assert.doesNotMatch(source("src/lib/platform-student-case-queue-contract.ts"), /^import[^;]*from "[^"]*(?:supabase|server-only|next\/)/mu);
});
