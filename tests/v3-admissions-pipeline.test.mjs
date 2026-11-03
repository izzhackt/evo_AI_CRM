// OTH-1 «Воронка поступления» — source-contract pins only. No Supabase
// credentials in this environment (same convention as
// tests/platform-lead-sale-conditions-migration.test.mjs): the migration is
// read and pattern-matched, not applied or executed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// The client-safe contract lives in its own module so the client board never
// traces supabase/server into the bundle (Build gate); the server module
// re-exports it.
const contract = source("src/lib/platform-admissions-pipeline-contract.ts");
const serverModule = source("src/lib/platform-admissions-pipeline.ts");
// The board is the component plus the engine and the card menu that «Новый вид» shares (27.10.2026: `useAdmissionsBoard`,
// `AdmissionsCardMenu`, `board-model`, moved out of the component without changes): the source pins read all four.
const board = [
  "src/components/v3/admissions-board/useAdmissionsBoard.ts",
  "src/components/v3/admissions-board/AdmissionsCardMenu.tsx", "src/components/v3/admissions-board/board-model.ts",
  "src/components/v3/admissions-pipeline-next/AdmissionsBoardNext.tsx", "src/components/v3/admissions-pipeline-next/AdmissionsCardNext.tsx",
  "src/components/v3/admissions-pipeline-next/AdmissionsColumnNext.tsx", "src/components/v3/admissions-pipeline-next/AdmissionsNotices.tsx",
].map(source).join("\n");
const boardPrimitive = source("src/components/v3/board/Board.tsx");
const actions = source("src/lib/platform-admissions-pipeline-actions.ts");
const page = source("src/app/(v3)/v3/admissions-pipeline/page.tsx");
const migration = source("supabase/migrations/187_platform_admissions_pipeline_board.sql");
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
  // Boards 25.09: the menu is a top-layer popover (TopLayerMenu) carrying the same test id.
  assert.match(board, /testId="v3-admissions-pipeline-move"/u);
  assert.match(board, /data-testid="v3-admissions-pipeline-board"/u);
  assert.match(board, /data-testid="v3-admissions-pipeline-card"/u);
  assert.match(board, /ADMISSIONS_PIPELINE_TAB_STAGES\[tabKey\]\.filter\(\(stage\) => stage !== row\.pipelineStage\)/u);
  assert.match(board, /tabTargets\(tab\)\.map/u, "this tab's stages first");
  assert.match(board, /\{admissionsPipelineTab\(otherTab\)\}\s*<Icon name="chevron-down"/u, "the other tab folds behind its own name");
  assert.doesNotMatch(board, /Другой раздел/u, "no vague «other section» label");
  assert.match(board, /tabTargets\(otherTab\)\.map/u, "the other tab's stages behind its name");
  // «Открыть дело» is the card's name link: the menu does not repeat it.
  assert.doesNotMatch(board.match(/function (?:CardMenu|AdmissionsCardMenu)[\s\S]*?\n\}\n/u)?.[0] ?? "", /Открыть дело/u);
});

test("a failed move renders a role=\"alert\" error and reverts the optimistic move", () => {
  assert.match(board, /role="alert"/u);
  assert.match(board, /studentCaseId === studentCaseId \? \{ \.\.\.row, pipelineStage: previousStage \}/u);
  assert.match(board, /if \(result\.status !== "saved"\)/u);
});

test("quiet UI: no explanatory helper paragraph, empty column is one quiet shared line, empty board is one line", () => {
  assert.doesNotMatch(board, /Пусто/u);
  // Boards 25.09: both boards share the empty-column line of the Board primitive.
  assert.match(boardPrimitive, /BOARD_EMPTY = \{ leads: "Нет лидов", cases: "Нет дел" \}/u);
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
  assert.match(firstLink, /label: "Воронка поступления"/u);
  void group;
});

test("migration 187 continues the contiguous source ledger", async () => {
  const { expectedMigrationVersions } = await import("../scripts/release/fast-release-ledger-gate.mjs");
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

const CASE_ID = "7d1f0c3a-5b2e-4c1d-9a8b-0e6f5d4c3b2a";
// Boards 25.09: one DOM for the narrow list and the wide grid, so exactly one card menu renders.
const boardRow = {
  studentCaseId: CASE_ID, studentDisplayName: "Студент Синтетический", targetCountry: "CN", primaryInstitutionName: null,
  currentCuratorMembershipId: null, currentCuratorDisplayName: null, pipelineStage: "documents",
  awaitingAck: false, overdue: false, needsReply: false,
};

// --- «Отменить» с проверкой версии (Э7, миграция 251) -------------------------

const undoMigration = source("supabase/migrations/251_platform_pipeline_move_undo.sql");
const undoSuite = source("supabase/tests/platform_pipeline_move_undo.sql");
const accessMigration = source("supabase/migrations/244_platform_access_by_permissions.sql");


test("the undo rules: the card goes where the server says, else where the confirmed move left it", () => {
  const require = createRequire(import.meta.url);
  void require;
  const code = ts.transpileModule(source("src/components/v3/board/board-undo.ts"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", code)(mod, mod.exports);
  const { BOARD_UNDO_MS, boardUndoOffer, placeAfterRefusedUndo } = mod.exports;
  assert.equal(BOARD_UNDO_MS, 6000, "about 6 seconds, as «Задачи»");
  const offer = boardUndoOffer({ key: "k", row: boardRow, toStage: "visa", version: 4, focus: true }, 1_000);
  assert.deepEqual({ pending: offer.pending, completedAt: offer.completedAt, expiresAt: offer.expiresAt }, { pending: false, completedAt: 1_000, expiresAt: 7_000 });
  const other = { ...boardRow, studentCaseId: "00000000-0000-4000-8000-000000000002", pipelineStage: "new" };
  const moved = [{ ...boardRow, pipelineStage: "documents" }, other];
  assert.deepEqual(placeAfterRefusedUndo(moved, offer, { stage: "arrived", hidden: false }).map((row) => row.pipelineStage), ["arrived", "new"]);
  assert.deepEqual(placeAfterRefusedUndo(moved, offer, { stage: "arrived", hidden: true }), [other]);
  assert.deepEqual(placeAfterRefusedUndo(moved, offer, null).map((row) => row.pipelineStage), ["visa", "new"]);
  assert.deepEqual(placeAfterRefusedUndo([other], offer, { stage: "visa", hidden: false }).map((row) => row.studentCaseId), [other.studentCaseId, CASE_ID]);
});

test("the conflict refusal decodes the current position; the pre-check refuses a bad version locally", async () => {
  const pipelineModule = await import("../src/lib/platform-admissions-pipeline.ts");
  const moved = pipelineModule.moveCasePipelineErrorFromRpc({ code: "PT409", message: "case_pipeline_moved",
    details: JSON.stringify({ pipeline_stage: "visa", pipeline_hidden: false, pipeline_version: 6 }) });
  assert.equal(moved.status, "moved");
  assert.deepEqual({ ...moved.current }, { pipelineStage: "visa", pipelineHidden: false, pipelineVersion: 6 });
  for (const details of [null, "not json", JSON.stringify({ pipeline_stage: "bogus", pipeline_hidden: false, pipeline_version: 6 }),
    JSON.stringify({ pipeline_stage: "visa", pipeline_hidden: false, pipeline_version: 0 })]) {
    const error = pipelineModule.moveCasePipelineErrorFromRpc({ code: "PT409", message: "case_pipeline_moved", details });
    assert.equal(error.status, "moved");
    assert.equal(error.current, null, `undecodable detail: ${details}`);
  }
  assert.equal(pipelineModule.moveCasePipelineErrorFromRpc({ code: "PT409", message: "other" }).status, "unavailable");
  assert.equal(pipelineModule.moveCasePipelineErrorFromRpc({ code: "42501", message: "case_pipeline_forbidden" }).status, "forbidden");
  const actor = { organizationId: "25100000-0000-4000-8000-000000000001", systemRole: "staff", permissionKeys: ["case.read.full", "case.update.append"] };
  for (const expectedVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(pipelineModule.moveCasePipeline(actor, { studentCaseId: CASE_ID, requestId: "25100000-0000-4000-8000-000000003001",
      stage: "documents", expectedVersion }), (error) => error.status === "unavailable", String(expectedVersion));
  }
});

test("the board writes only through v2 (251); the action checks the version and revalidates a stale board", () => {
  assert.match(serverModule, /\.rpc\("move_case_pipeline_v2", \{[\s\S]*p_expected_version: expectedVersion,/u);
  assert.doesNotMatch(serverModule, /move_case_pipeline_v1"/u);
  assert.match(actions, /Number\.isSafeInteger\(input\.expectedVersion\) \|\| input\.expectedVersion < 1/u);
  assert.match(actions, /if \(error\.status === "moved"\) \{\s*\/\/[^\n]*\n\s*revalidatePath\("\/v3\/admissions-pipeline"\);/u);
  assert.match(board, /moveCasePipelineAction\(\{ studentCaseId, requestId, stage: fromStage, expectedVersion: offer\.version \}\)/u);
  assert.match(board, /if \(!undo \|\| undo\.pending \|\| held\) return;/u);
  assert.match(board, /focus: via === "menu"/u, "a menu move puts focus on «Отменить», a drag does not");
});

test("migration 251 is forward-only and additive: a version column with its trigger and v2 beside the untouched v1", () => {
  assert.match(undoMigration, /^BEGIN;$/mu);
  assert.match(undoMigration, /^COMMIT;\s*$/mu);
  // Outside the function bodies: no data change — the column default is the backfill.
  const statements = undoMigration.replace(/\$([a-z0-9_]*)\$[\s\S]*?\$\1\$/gu, "");
  assert.doesNotMatch(statements, /\bDROP\s+(?:FUNCTION|TABLE|TRIGGER|POLICY|COLUMN)\b|\bTRUNCATE\b|^\s*UPDATE\b|^\s*DELETE\b|^\s*INSERT\b/imu,
    "no data change: the column default is the backfill");
  assert.match(statements, /ALTER TABLE platform\.student_cases\s+ADD COLUMN pipeline_version/u);
  assert.doesNotMatch(undoMigration, /CREATE OR REPLACE FUNCTION platform\.move_case_pipeline_v1/u, "v1 keeps working for the running release");
  assert.match(undoMigration, /ADD COLUMN pipeline_version BIGINT NOT NULL DEFAULT 1\s+CONSTRAINT student_cases_pipeline_version_check CHECK \(pipeline_version >= 1\);/u);
  assert.match(undoMigration, /CREATE TRIGGER student_cases_pipeline_version\s+BEFORE UPDATE ON platform\.student_cases\s+FOR EACH ROW\s+WHEN \(/u);
  assert.match(undoMigration, /NEW\.pipeline_version := OLD\.pipeline_version \+ 1;/u);
  assert.match(undoMigration, /NEW\.pipeline_version := OLD\.pipeline_version;/u);
  assert.match(undoMigration, /a251_pipeline_move_source_drift/u, "fails closed if v1's body drifted");
  const fn = undoMigration.slice(undoMigration.indexOf("CREATE FUNCTION platform.move_case_pipeline_v2("),
    undoMigration.indexOf("REVOKE ALL ON FUNCTION platform.move_case_pipeline_v2"));
  assert.match(fn, /p_expected_version BIGINT DEFAULT NULL\s*\) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS \$\$/u);
  // The gate and the lock are v1's after 244, byte for byte.
  for (const line of [
    "AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'case.update.append');",
    "PERFORM pg_advisory_xact_lock(hashtextextended('case-pipeline:' || p_organization_id::TEXT || ':' || p_student_case_id::TEXT, 0));",
    "'actor', actor.membership_id, 'case', p_student_case_id, 'stage', p_stage, 'remove', p_remove",
  ]) {
    assert.ok(fn.includes(line), line);
    assert.ok(accessMigration.includes(line), `244: ${line}`);
  }
  assert.doesNotMatch(fn, /platform_role\s*(?:NOT\s+)?IN\s*\(|platform_role\s*<>|platform_role\s*=/u);
  // Replay first, then the case check, then the version: a refused caller learns no position.
  const replay = fn.indexOf("RETURN prior.receipt;");
  const access = fn.indexOf("platform_private.staff_can_access(p_organization_id, actor.membership_id, 'case.update.append', 'student_case', p_student_case_id)");
  const moved = fn.indexOf("RAISE EXCEPTION 'case_pipeline_moved' USING ERRCODE = 'PT409',");
  assert.ok(replay > 0 && access > replay && moved > access, "replay → per-case access → version");
  assert.match(fn, /DETAIL = jsonb_build_object\(\s*'pipeline_stage', case_row\.pipeline_stage,\s*'pipeline_hidden', case_row\.pipeline_hidden_at IS NOT NULL,\s*'pipeline_version', case_row\.pipeline_version\s*\)::TEXT;/u);
  assert.match(fn, /'pipeline_version', case_row\.pipeline_version, 'request_id', p_request_id/u);
  assert.match(undoMigration, /REVOKE ALL ON FUNCTION platform\.move_case_pipeline_v2\(UUID, UUID, TEXT, BOOLEAN, UUID, BIGINT\)\s*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u);
  assert.match(undoMigration, /GRANT EXECUTE ON FUNCTION platform\.move_case_pipeline_v2\(UUID, UUID, TEXT, BOOLEAN, UUID, BIGINT\)\s*TO authenticated;/u);
  assert.doesNotMatch(undoMigration, /GRANT [A-Z ,]+ TO (anon|service_role|PUBLIC)/u);
});

test("migration 251 continues the contiguous source ledger and runs its real-Postgres suite at its checkpoint", async () => {
  const { expectedMigrationVersions } = await import("../scripts/release/fast-release-ledger-gate.mjs");
  const { fileURLToPath } = await import("node:url");
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("250") && versions.includes("251"));
  assert.match(source("scripts/test-runners/test-postgres-authorization.sh"),
    /== 251_\* \]\]; then\s+docker exec "\$container_name" \\\s+psql -X -v ON_ERROR_STOP=1 -h 127\.0\.0\.1 -U postgres -d "\$test_database" \\\s+-f \/workspace\/supabase\/tests\/platform_pipeline_move_undo\.sql/u);
  assert.match(undoSuite, /^BEGIN;$/mu);
  assert.match(undoSuite, /^ROLLBACK;\s*$/mu);
  assert.match(undoSuite, /N251_PIPELINE_MOVE_UNDO_SUITE_PASS/u);
  assert.match(undoSuite, /= ARRAY\[35, 36, 23, 12, 16\], 'role bundles have the production key counts/u);
  assert.match(undoSuite, /"current_role" IS NULL AND current_bundle_id IS NULL/u);
  assert.doesNotMatch(undoSuite, /@(?!example\.invalid)[a-z0-9-]+\.[a-z]/iu, "synthetic addresses only");
  for (const claim of ["'case_pipeline_moved'", "away and back", "a direct write of the version is put back",
    "an accepted undo replays its receipt before the version check", "a v1 move bumps the version (trigger)",
    "'the Sales Manager cannot move (no case.update.append), even the case it sold'", "'anon cannot execute v2'"]) {
    assert.ok(undoSuite.includes(claim), claim);
  }
});
