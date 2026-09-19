// OTH-1 «Воронка поступления» — source-contract pins only. No Supabase
// credentials in this environment (same convention as
// tests/platform-lead-sale-conditions-migration.test.mjs): the migration is
// read and pattern-matched, not applied or executed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// The client-safe contract lives in its own module so the client board never
// traces supabase/server into the bundle (Build gate); the server module
// re-exports it.
const contract = source("src/lib/platform-admissions-pipeline-contract.ts");
const serverModule = source("src/lib/platform-admissions-pipeline.ts");
const board = source("src/components/v3/AdmissionsPipelineBoard.tsx");
const actions = source("src/lib/platform-admissions-pipeline-actions.ts");
const page = source("src/app/(v3)/v3/admissions-pipeline/page.tsx");
const migration = source("supabase/migrations/186_platform_admissions_pipeline_board.sql");
const fixedRolePolicy = source("src/lib/fixed-role-policy.ts");
const navigation = source("src/lib/v3/navigation.ts");

const STAGE_KEYS = [
  "new",
  "shortlist",
  "documents",
  "ready_to_submit",
  "awaiting_decision",
  "confirmed",
  "visa",
  "predeparture",
  "arrived",
];

test("the 9 pipeline stage keys exist exactly once each, in order, in ADMISSIONS_PIPELINE_STAGES", () => {
  const arrayText = contract.slice(
    contract.indexOf("export const ADMISSIONS_PIPELINE_STAGES = ["),
    contract.indexOf("] as const;", contract.indexOf("export const ADMISSIONS_PIPELINE_STAGES = [")),
  );
  for (const key of STAGE_KEYS) {
    const matches = arrayText.match(new RegExp(`"${key}"`, "gu")) ?? [];
    assert.equal(matches.length, 1, `"${key}" should appear exactly once in ADMISSIONS_PIPELINE_STAGES: found ${matches.length}`);
  }
  assert.deepEqual([...arrayText.matchAll(/"([a-z_]+)"/gu)].map((m) => m[1]), STAGE_KEYS);
});

test("the board never calls the fact-gated admissions playbook RPC or imports its actions", () => {
  // The board's OWN module (contract) never calls the playbook transition RPC
  // by name and never imports the playbook's server actions — the specific,
  // checkable claim the task asks for (a bare textual ban on the words
  // "operational_stage"/"admissions_version" would also flag this file's own
  // header comment explaining that it does NOT touch them).
  for (const file of [contract, serverModule, board, actions, page]) {
    assert.doesNotMatch(file, /\.rpc\(\s*"transition_case_admissions_v1"/u);
  }
  assert.doesNotMatch(board, /from "@\/lib\/platform-admissions-playbook/u);
  assert.doesNotMatch(board, /platform-admissions-actions/u);
  assert.doesNotMatch(actions, /platform-admissions-playbook/u);
});

test("the card menu offers «Переместить в…» and «Убрать из воронки», grouped by tab", () => {
  assert.match(board, /Переместить в…/u);
  assert.match(board, /Убрать из воронки/u);
  assert.match(board, /data-testid="v3-admissions-pipeline-move"/u);
  assert.match(board, /data-testid="v3-admissions-pipeline-board"/u);
  assert.match(board, /data-testid="v3-admissions-pipeline-card"/u);
  assert.match(board, /ADMISSIONS_PIPELINE_TAB_STAGES\[tabKey\]\.filter\(\(stage\) => stage !== row\.pipelineStage\)/u);
});

test("a failed move renders a role=\"alert\" error and reverts the optimistic move", () => {
  assert.match(board, /role="alert"/u);
  assert.match(board, /studentCaseId === studentCaseId \? \{ \.\.\.row, pipelineStage: previousStage \}/u);
  assert.match(board, /if \(result\.status !== "saved"\)/u);
});

test("quiet UI: no explanatory helper paragraph, empty column is silent, empty board is one line", () => {
  assert.doesNotMatch(board, /Пусто/u);
  assert.match(board, /Дел в работе нет\./u);
});

test("moving to the other tab offers a same-card inline link to switch tabs", () => {
  assert.match(board, /crossTabHint/u);
  assert.match(board, /Открыть в «\{admissionsPipelineTab\(hint\.tab\)\}»/u);
});

test("the route is registered as admissions.read-gated in fixed-role-policy", () => {
  assert.match(fixedRolePolicy, /"\/v3\/admissions-pipeline",/u);
  const anyOf = fixedRolePolicy.slice(
    fixedRolePolicy.indexOf("const ROUTE_CAPABILITY_ANY_OF"),
    fixedRolePolicy.indexOf("} as const satisfies Record<FixedRoleRoute", fixedRolePolicy.indexOf("const ROUTE_CAPABILITY_ANY_OF")),
  );
  assert.match(anyOf, /"\/v3\/admissions-pipeline":\s*\["admissions\.read"\]/u);
});

test("the navigation entry is the first item of the Поступление group", () => {
  const group = navigation.slice(navigation.indexOf('id: "admissions",'), navigation.indexOf('id: "sales-report"') > -1 ? navigation.length : navigation.length);
  const admissionsGroupStart = navigation.indexOf('id: "admissions",');
  const linksStart = navigation.indexOf("links: [", admissionsGroupStart);
  const firstLinkEnd = navigation.indexOf("},", linksStart);
  const firstLink = navigation.slice(linksStart, firstLinkEnd);
  assert.match(firstLink, /id: "admissions-pipeline"/u);
  assert.match(firstLink, /href: "\/v3\/admissions-pipeline"/u);
  assert.match(firstLink, /label: "Воронка"/u);
  void group;
});

test("migration 186 continues the contiguous source ledger", async () => {
  const { expectedMigrationVersions } = await import("../scripts/fast-release-ledger-gate.mjs");
  const { fileURLToPath } = await import("node:url");
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("185") && versions.includes("186"));
});

test("migration is transactional and fails closed on source drift, like 181/182/185", () => {
  assert.match(migration, /^BEGIN;$/mu);
  assert.match(migration, /^COMMIT;\s*$/mu);
  assert.match(migration, /RAISE EXCEPTION/u);
  assert.doesNotMatch(migration, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
});

test("student_cases gains exactly the 9-key pipeline_stage CHECK plus pipeline_hidden_at", () => {
  assert.match(migration, /ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'new' CHECK \(pipeline_stage IN \(/u);
  const checkBlock = migration.slice(
    migration.indexOf("CHECK (pipeline_stage IN ("),
    migration.indexOf("ADD COLUMN pipeline_hidden_at"),
  );
  for (const key of STAGE_KEYS) {
    assert.match(checkBlock, new RegExp(`'${key}'`), key);
  }
  assert.match(migration, /ADD COLUMN pipeline_hidden_at TIMESTAMPTZ NULL;/u);
});

test("the migration proves pipeline_stage/pipeline_hidden_at never trip admissions_case_command_guard (137)", () => {
  assert.match(migration, /admissions_case_command_guard/u);
  assert.match(migration, /never (?:trip|need)s? an admissions_version bump|never (?:trips|needs) an admissions_version bump/iu);
});

test("move_case_pipeline_v1 is SECURITY DEFINER, search_path-locked and REVOKE/GRANT-paired to authenticated only", () => {
  assert.match(migration, /CREATE FUNCTION platform\.move_case_pipeline_v1\(\s*p_organization_id UUID, p_student_case_id UUID, p_stage TEXT, p_remove BOOLEAN, p_request_id UUID\s*\)/u);
  const fn = migration.slice(
    migration.indexOf("CREATE FUNCTION platform.move_case_pipeline_v1("),
    migration.indexOf("REVOKE ALL ON FUNCTION platform.move_case_pipeline_v1"),
  );
  assert.match(fn, /SECURITY DEFINER/u);
  assert.match(fn, /SET search_path = ''/u);
  assert.match(fn, /platform_private\.staff_can_access\(p_organization_id, actor\.membership_id, 'case\.update\.append', 'student_case', p_student_case_id\)/u);
  assert.match(fn, /'Case is not active in this pipeline' USING ERRCODE = '22023'/u);
  assert.match(fn, /INSERT INTO platform\.audit_events/u);
  assert.match(fn, /'case\.pipeline\.move'/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION platform\.move_case_pipeline_v1\(UUID, UUID, TEXT, BOOLEAN, UUID\)\s*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION platform\.move_case_pipeline_v1\(UUID, UUID, TEXT, BOOLEAN, UUID\)\s*TO authenticated;/u,
  );
});

test("move_case_pipeline_v1 replays by (organization_id,request_id) receipt, not by re-running the mutation", () => {
  const fn = migration.slice(
    migration.indexOf("CREATE FUNCTION platform.move_case_pipeline_v1("),
    migration.indexOf("REVOKE ALL ON FUNCTION platform.move_case_pipeline_v1"),
  );
  assert.match(fn, /pg_advisory_xact_lock\(hashtextextended\('case-pipeline:' \|\| p_organization_id::TEXT \|\| ':' \|\| p_student_case_id::TEXT, 0\)\)/u);
  assert.match(fn, /fingerprint := md5\(jsonb_build_object\(/u);
  assert.match(fn, /RETURN prior\.receipt;/u);
  assert.match(fn, /'case_pipeline_request_id_conflict' USING ERRCODE = '22023'/u);
});

test("no optimistic version on the pipeline field — the one-line last-write-wins decision is documented", () => {
  const fn = migration.slice(
    migration.indexOf("CREATE FUNCTION platform.move_case_pipeline_v1("),
    migration.indexOf("REVOKE ALL ON FUNCTION platform.move_case_pipeline_v1"),
  );
  assert.doesNotMatch(fn, /p_expected_version|expected_version/u);
  assert.match(migration, /Deliberately no optimistic version check/u);
});

test("staff_admissions_pipeline_board_v1 is a NEW read RPC and does not widen staff_student_case_page", () => {
  assert.match(
    migration,
    /CREATE FUNCTION platform\.staff_admissions_pipeline_board_v1\(\s*p_curator_membership_id UUID DEFAULT NULL, p_direction TEXT DEFAULT NULL,\s*p_country TEXT DEFAULT NULL, p_query TEXT DEFAULT NULL\s*\)/u,
  );
  assert.doesNotMatch(migration, /ALTER FUNCTION platform\.staff_student_case_page|CREATE OR REPLACE FUNCTION platform\.staff_student_case_page/u);
  const fn = migration.slice(
    migration.indexOf("CREATE FUNCTION platform.staff_admissions_pipeline_board_v1("),
    migration.indexOf("REVOKE ALL ON FUNCTION platform.staff_admissions_pipeline_board_v1"),
  );
  assert.match(fn, /SECURITY DEFINER/u);
  assert.match(fn, /SET search_path = ''/u);
  assert.match(fn, /private\.platform_can_read_student_case\(c\.organization_id, c\.id\)/u);
  assert.match(fn, /platform_private\.admissions_attention_flags\(c\.id\)/u);
  assert.match(fn, /c\.state = 'active'/u);
  assert.match(fn, /c\.pipeline_hidden_at IS NULL/u);
  assert.match(fn, /LIMIT 401/u);
  assert.match(fn, /LIMIT 400/u);
  assert.match(fn, /'truncated', \(SELECT count\(\*\) FROM visible\) > 400/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION platform\.staff_admissions_pipeline_board_v1\(UUID, TEXT, TEXT, TEXT\)\s*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION platform\.staff_admissions_pipeline_board_v1\(UUID, TEXT, TEXT, TEXT\)\s*TO authenticated;/u,
  );
});

test("the new audit action is added to the p7a_safe_audit_actions allowlist, same rename-and-replace pattern as 179/181", () => {
  assert.match(migration, /RENAME TO p7a_safe_audit_actions_pre_admissions_pipeline_board;/u);
  assert.match(migration, /ARRAY\['case\.pipeline\.move'\]::TEXT\[\]/u);
});
