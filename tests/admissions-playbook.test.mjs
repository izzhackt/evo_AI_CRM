import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ADMISSIONS_APPLICATION_FIELDS, ADMISSIONS_CASE_FIELDS, ADMISSIONS_DIRECTIONS, ADMISSIONS_STAGES, ADMISSIONS_VISA_FIELDS, validateAdmissionsFields } from "../src/lib/platform-admissions-playbook-contract.ts";
import { admissionsCommandRpc, parseAdmissionsCommand } from "../src/lib/platform-admissions-playbook-command.ts";
import { admissionsReportPeriod } from "../src/lib/admissions-report-period.ts";
import { normalizeAdmissionsPlaybook, normalizeAdmissionsReceipt, normalizeAdmissionsSummary, normalizeAdmissionsWorkspace } from "../src/lib/v3/admissions-source.ts";
import { buildPlatformStudentCasePageRpcArguments, normalizePlatformStudentCaseQueueRow } from "../src/lib/platform-admissions.ts";

const CASE = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-09-09T12:00:00+00:00";
const base = { caseId: CASE, requestId: REQUEST, expectedVersion: "0" };
const configure = { ...base, operation: "configure", direction: "CN", playbookVersionId: ID, nextAction: "Принять передачу", nextActionDueOn: "2026-09-10" };

test("Admissions command input is exact, typed and cannot supply actor/org/score fields", () => {
  assert.deepEqual(parseAdmissionsCommand(configure), configure);
  for (const extra of ["organizationId", "actorId", "studentId", "score", "scopeVersion", "force"]) assert.equal(parseAdmissionsCommand({ ...configure, [extra]: "injected" }), null);
  for (const patch of [{ requestId: "" }, { expectedVersion: 0 }, { expectedVersion: "-1" }, { expectedVersion: "9223372036854775808" }, { nextActionDueOn: "2026-02-30" }, { direction: "RU" }, { playbookVersionId: null }, { nextAction: "" }, { nextAction: "a".repeat(1001) }]) assert.equal(parseAdmissionsCommand({ ...configure, ...patch }), null);
  assert.ok(parseAdmissionsCommand({ ...configure, direction: "EUROPE", playbookVersionId: null }));
  assert.equal(parseAdmissionsCommand({ ...configure, direction: "EUROPE" }), null);
});

test("all five commands bind exact case, expected revision, and replay ID", () => {
  const commands = [configure,
    { ...base, operation: "facts", facts: { arrivalOn: "2026-09-09", arrivalEvidence: "Подтверждение студента" }, primaryApplicationId: ID, routeApprovalStatus: "approved", nextAction: "Проверить прибытие", nextActionDueOn: "2026-09-10" },
    { ...base, operation: "transition", stage: "arrival_and_adaptation", outcome: "arrived", reason: "Прибытие подтверждено" },
    { ...base, operation: "application", applicationId: ID, details: { decisionType: "pre_admission" } },
    { ...base, operation: "visa", visaCaseId: ID, details: { entryVisaApplicability: "needs_confirmation" } },
  ];
  assert.equal(commands.length, 5);
  for (const input of commands) {
    const command = parseAdmissionsCommand(input); assert.ok(command, input.operation);
    const rpc = admissionsCommandRpc(command);
    assert.equal(rpc.args.p_student_case_id, CASE); assert.equal(rpc.args.p_expected_version, "0"); assert.equal(rpc.args.p_request_id, REQUEST);
    assert.equal(rpc.args.p_organization_id, undefined);
  }
});

test("facts reject unknown fields/types/bad dates; unknown is not an invented approval", () => {
  for (const fields of [ADMISSIONS_CASE_FIELDS, ADMISSIONS_APPLICATION_FIELDS, ADMISSIONS_VISA_FIELDS]) {
    assert.throws(() => validateAdmissionsFields({ fake: "yes" }, fields));
    assert.throws(() => validateAdmissionsFields({ [fields[0].key]: true }, fields));
    assert.deepEqual(validateAdmissionsFields({ [fields[0].key]: " " }, fields), {});
    assert.equal(new Set(fields.map((field) => field.key)).size, fields.length);
  }
  assert.throws(() => validateAdmissionsFields({ eValStatus: "confirmed" }, ADMISSIONS_VISA_FIELDS));
  assert.throws(() => validateAdmissionsFields({ arrivalOn: "2026-02-30" }, ADMISSIONS_CASE_FIELDS));
  assert.deepEqual(validateAdmissionsFields({ eValStatus: "pending" }, ADMISSIONS_VISA_FIELDS), { eValStatus: "pending" });
});

test("reviewed seed content round-trips through the actual allowlisted UI projection", () => {
  for (const file of ["china-v1.json", "malaysia-v1.json"]) {
    const raw = JSON.parse(readFileSync(new URL(`../supabase/admissions-content/${file}`, import.meta.url), "utf8"));
    const normalized = normalizeAdmissionsPlaybook({ ...raw, id: ID, publishedAt: NOW, unexpectedField: "must-not-serialize" });
    assert.equal(normalized.unexpectedField, undefined);
    assert.equal(normalized.content.stages.length, 7);
    assert.deepEqual(normalized.content.stages.map((item) => item.key), ADMISSIONS_STAGES);
    assert.deepEqual(normalized.content.messages, raw.content.messages);
    assert.ok(normalized.content.messages.length >= 12);
    assert.throws(() => normalizeAdmissionsPlaybook({ ...raw, id: ID, publishedAt: NOW, content: { ...raw.content, stages: raw.content.stages.slice(1) } }));
  }
});

test("workspace verifies case and organization, excludes unlisted data and rejects unknown facts", () => {
  const row = { case: { id: CASE, organizationId: ORG, direction: null, playbookVersionId: null, version: "0", stage: "intake", outcome: null, state: "active", primaryApplicationId: null, routeApprovalStatus: "draft", nextAction: null, nextActionDueOn: null, facts: {}, personalTest: "secret" }, playbook: null, applications: [], visa: null, handoff: { personalTest: "secret" }, gates: [], events: [], assessments: "secret" };
  const result = normalizeAdmissionsWorkspace(row, ORG, CASE);
  assert.doesNotMatch(JSON.stringify(result), /secret|personalTest|assessments/);
  assert.throws(() => normalizeAdmissionsWorkspace(row, ID, CASE));
  assert.throws(() => normalizeAdmissionsWorkspace(row, ORG, ID));
  assert.throws(() => normalizeAdmissionsWorkspace({ ...row, case: { ...row.case, facts: { assessedEnglish: "C1" } } }, ORG, CASE));
  assert.throws(() => normalizeAdmissionsWorkspace({ ...row, case: { ...row.case, primaryApplicationId: ID } }, ORG, CASE));
});

test("receipt mismatch is never presented as successful mutation", () => {
  const row = { caseId: CASE, version: "2", requestId: REQUEST, changedAt: NOW, applicationId: ID, privateData: "hidden" };
  assert.equal(normalizeAdmissionsReceipt(row, { caseId: CASE, requestId: REQUEST, applicationId: ID }).version, "2");
  assert.equal(normalizeAdmissionsReceipt(row, { requestId: REQUEST }).privateData, undefined);
  for (const expected of [{ caseId: ID, requestId: REQUEST }, { requestId: ID }, { visaCaseId: ID, requestId: REQUEST }]) assert.throws(() => normalizeAdmissionsReceipt(row, expected));
  assert.throws(() => normalizeAdmissionsReceipt({ ...row, version: 2 }, { requestId: REQUEST }));
});

test("directory passes typed filters to server before paging, not browser post-filter", () => {
  assert.deepEqual(buildPlatformStudentCasePageRpcArguments({ pageSize: 25, direction: "MY", curatorMembershipId: ID, attention: "awaiting_partner" }), { p_limit: 26, p_direction: "MY", p_curator_membership_id: ID, p_attention: "awaiting_partner" });
  assert.equal(buildPlatformStudentCasePageRpcArguments({ direction: "unknown" }).p_direction, "unknown");
  for (const options of [{ direction: "else" }, { attention: "done" }, { curatorMembershipId: "arbitrary" }]) assert.throws(() => buildPlatformStudentCasePageRpcArguments(options));
  assert.equal(typeof normalizePlatformStudentCaseQueueRow, "function");
});

test("manager summary keeps stock distinct from period events and rejects invalid counts", () => {
  const stock = ADMISSIONS_DIRECTIONS.map((direction) => ({ direction, active: 0, overdue: 0, awaiting_ack: 0, awaiting_partner: 0, submitted: 0, decisions: 0, visas: 0, arrivals: 0, arrived: 0, cancelled: 0 }));
  const row = { periodFrom: "2026-09-01", periodTo: "2026-09-30", stock, periodArrivals: [{ direction: "CN", count: 3 }] };
  assert.equal(normalizeAdmissionsSummary(row).periodArrivals[0].count, 3);
  assert.equal(normalizeAdmissionsSummary(row).stock[0].arrived, 0);
  assert.throws(() => normalizeAdmissionsSummary({ ...row, stock: [{ ...stock[0], active: -1 }] }));
  assert.throws(() => normalizeAdmissionsSummary({ ...row, stock: [stock[0], stock[0]] }));
});

test("calendar month handling uses real inclusive dates, including leap years", () => {
  assert.deepEqual(admissionsReportPeriod("2028-02"), { month: "2028-02", from: "2028-02-01", to: "2028-02-29" });
  assert.equal(admissionsReportPeriod("2026-02").to, "2026-02-28");
  assert.equal(admissionsReportPeriod(undefined, new Date("2026-08-31T20:00:00Z")).month, "2026-09");
  for (const value of ["", "2026-13", "2026-2", "2026-02-01", "1900-01"]) assert.equal(admissionsReportPeriod(value), null);
});

test("new UI keeps manual copy, scoped actions and one memory-only editor", () => {
  const action = readFileSync(new URL("../src/lib/platform-admissions-playbook-actions.ts", import.meta.url), "utf8");
  assert.match(action, /await requirePlatformStaffActor\(\)/);
  assert.doesNotMatch(action, /service_role|serviceRole|console\./);
  const editor = readFileSync(new URL("../src/components/v3/profile/AdmissionsRouteEditor.tsx", import.meta.url), "utf8");
  assert.match(editor, /pending\.current \?\?/); assert.match(editor, /installAssessmentExitGuard/);
  assert.doesNotMatch(editor, /localStorage|sessionStorage|createClient|console\./);
  const messages = readFileSync(new URL("../src/components/v3/profile/AdmissionsMessageTemplates.tsx", import.meta.url), "utf8");
  assert.match(messages, /clipboard\.writeText/); assert.match(messages, /Скопировано/);
  assert.doesNotMatch(messages, /fetch\(|supabase|sendMessage|api\/waha/);
});
