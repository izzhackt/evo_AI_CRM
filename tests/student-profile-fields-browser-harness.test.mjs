import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localOrigin, proofExceptionCategory, proofPathClass, summarizeStudentProfileAppLog, SYNTHETIC_EXPECTED_VALUES, SYNTHETIC_REQUIRED_VALUES } from "../scripts/lib/student-profile-fields-browser-proof.mjs";
import { PROFILE_FIELDS, PROFILE_REQUIRED_FIELD_KEYS } from "../src/lib/student-profile-fields.ts";

const harness = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
const runnerUrl = new URL("../scripts/lib/student-profile-fields-browser-proof.mjs", import.meta.url);

test("local endpoints require explicit loopback HTTP ports and no credentials or paths", () => {
  assert.equal(localOrigin("http://127.0.0.1:43210/"), "http://127.0.0.1:43210");
  assert.equal(localOrigin("http://localhost:43211"), "http://localhost:43211");
  for (const origin of ["https://example.test", "http://localhost", "http://127.0.0.1:3000/private",
    "http://name:secret@localhost:4000", "http://localhost:4000/?q=value", "http://localhost:4000/#fragment"]) {
    assert.throws(() => localOrigin(origin));
  }
});

test("synthetic scenario covers exactly the real nine required bounded fields", () => {
  assert.equal(PROFILE_REQUIRED_FIELD_KEYS.length, 9);
  assert.deepEqual(Object.keys(SYNTHETIC_REQUIRED_VALUES).sort(), [...PROFILE_REQUIRED_FIELD_KEYS].sort());
  assert.equal(SYNTHETIC_REQUIRED_VALUES.mobile_phone, "+1 202 555 0101");
  assert.deepEqual(SYNTHETIC_EXPECTED_VALUES, { ...SYNTHETIC_REQUIRED_VALUES, mobile_phone: "+12025550101" });
  for (const [key, value] of Object.entries(SYNTHETIC_REQUIRED_VALUES)) {
    const definition = PROFILE_FIELDS.find(field => field.key === key);
    assert.ok(value.length > 0 && [...value].length <= definition.maxLength);
  }
});

test("D2 bounded mode follows local Auth bootstrap and exits before unrelated suites", () => {
  assert.match(harness, /--student-profile-fields-only/u);
  const start = harness.indexOf('if [[ "$student_profile_fields_only" == "1" ]]');
  assert.ok(start > harness.indexOf("LOCAL_SUPABASE_ADMIN_BOOTSTRAPPED"));
  const branch = harness.slice(start, harness.indexOf("\nfi", start));
  assert.match(branch, /start_app configured unavailable blocked provider-not-authorized enabled/u);
  assert.match(branch, /student_profile_fields_browser_assert/u);
  assert.match(branch, /assert_no_secret_or_payload_logs/u);
  assert.match(branch, /exit 0/u);
  assert.doesNotMatch(branch, /provision_local_staff|start_clamav_scanner|start_isolated_waha_service|v3_browser_gate/u);
  assert.match(harness, /trap cleanup EXIT/u);
  assert.match(harness, /stop --no-backup/u);
});

test("bounded Admissions mode preserves real setup and the end-of-workflow Storage receipt", () => {
  const start = harness.indexOf('if [[ "$admissions_workflow_only" == "1" ]]');
  assert.ok(start > harness.indexOf("\nprovision_local_staff_and_fixtures\n"));
  assert.ok(start > harness.indexOf("\nstart_clamav_scanner\n"));
  const end = harness.indexOf("\nfi\nsupabase_staff_auth_browser_assert configured", start);
  assert.ok(end > start);
  const branch = harness.slice(start, end);
  assert.match(branch, /supabase_staff_auth_browser_assert configured 'real contract, payment and handoff open one Supabase Student 360 with role-safe access\|Admissions manages one real private company file through V3'/u);
  assert.ok(branch.indexOf("verify_p4_admissions_storage_acceptance") > branch.indexOf("supabase_staff_auth_browser_assert"));
  assert.ok(branch.indexOf("assert_no_secret_or_payload_logs") > branch.indexOf("verify_p4_admissions_storage_acceptance"));
  assert.match(branch, /summarizeStudentProfileAppLog/u);
  assert.match(branch, /statSync\(logPath\)\.size <= 4 \* 1024 \* 1024/u);
  assert.match(branch, /no full-gate pass is implied/u);
  assert.match(branch, /echo "LOCAL_ADMISSIONS_WORKFLOW_VERIFIED"\n  exit 0/u);
  assert.doesNotMatch(branch, /V3 Supabase Auth, canonical-data and browser quality gate passed/u);
  assert.match(harness.slice(end), /\nfi\nsupabase_staff_auth_browser_assert configured\nv3_browser_gate/u);
});

test("D2 runner uses real login and product field actions, not request mocks or Auth bypass", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  assert.match(runner, /#staff-email/u);
  assert.match(runner, /#staff-password/u);
  assert.match(runner, /Войти в CRM/u);
  assert.match(runner, /Начать анкету/u);
  assert.match(runner, /Подтвердить значение/u);
  assert.match(runner, /Подтвердить пустое значение/u);
  assert.match(runner, /Сверено, оставить мои правки/u);
  assert.match(runner, /current\.value === expectedValue/u);
  assert.match(runner, /confirm\(page, key, value, SYNTHETIC_EXPECTED_VALUES\[key\]\)/u);
  assert.match(runner, /const finalValues = \{ \.\.\.SYNTHETIC_EXPECTED_VALUES/u);
  assert.doesNotMatch(runner, /route\.fulfill|addInitScript|setStorageState|generateLink|setSession|auth\.admin|\.rpc\("(?:start|review|begin|complete)_student_profile/u);
});

test("the full release proof exercises D2 once after existing no-mutation checks on the same stack", () => {
  const fullStart = harness.indexOf("\nstart_clamav_scanner\nstart_isolated_waha_service\nstart_app configured configured local-service");
  assert.ok(fullStart > 0);
  const configured = harness.slice(fullStart, harness.indexOf("\nstop_app\nstart_app configured unavailable", fullStart));
  assert.equal(configured.match(/^student_profile_fields_browser_assert$/gm)?.length, 1);
  assert.ok(configured.indexOf("student_profile_fields_browser_assert")
    > configured.indexOf("platform_communications_browser_assert configured"));
  assert.ok(configured.lastIndexOf("assert_no_secret_or_payload_logs")
    > configured.indexOf("student_profile_fields_browser_assert"));
  assert.equal(configured.match(/^start_app /gm)?.length, 2);
});

test("D2 proof binds isolated Docker ownership, downloads and real export audit", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  assert.match(runner, /com\.supabase\.cli\.workdir/u);
  assert.match(runner, /com\.supabase\.cli\.project/u);
  assert.match(runner, /LOCAL_RUNTIME_NOT_OWNED/u);
  assert.match(runner, /waitForEvent\("download"/u);
  assert.match(runner, /student_profile_export_attempts/u);
  assert.match(runner, /output_sha256/u);
  assert.match(runner, /word\/document\.xml/u);
  assert.match(runner, /STUDENT_PROFILE_FIELDS_BROWSER_VERIFIED/u);
  assert.match(runner, /page\.on\("pageerror"/u);
  assert.match(runner, /page\.on\("console"/u);
  assert.match(runner, /BROWSER_RUNTIME_ERRORS/u);
  assert.match(runner, /PAGE_TITLE_INVALID/u);
  assert.doesNotMatch(runner, /console\.(?:log|error)\(error|process\.stderr\.write\(error/u);
});

test("failure evidence separates login from profile rendering and never emits raw diagnostic payloads", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  const login = runner.indexOf('stage = "LOGIN_DOCUMENT"');
  const submit = runner.indexOf('stage = "LOGIN_SUBMIT"');
  const shell = runner.indexOf('stage = "AUTHENTICATED_SHELL"');
  const navigation = runner.indexOf('stage = "PROFILE_NAVIGATION"');
  const readiness = runner.indexOf('stage = "PROFILE_START_CONTROL"');
  assert.ok(login >= 0 && submit > login && shell > submit && navigation > shell && readiness > navigation);
  assert.match(runner, /"failure\.json"/u);
  assert.match(runner, /"failure\.png"/u);
  assert.match(runner, /await writeFailureEvidence/u);
  assert.match(runner, /mask: \[page\.locator\("input, textarea"\)\]/u);
  assert.match(runner, /!snapshot\.passwordControlPresent/u);
  assert.doesNotMatch(runner, /(?:error|message)\.(?:stack|message)|page\.content\(|storageState\(/u);
});

test("safe diagnostic classes discard query strings, credentials, exception text and stack", () => {
  const origin = "http://127.0.0.1:43210";
  assert.equal(proofPathClass(`${origin}/v3/profile?case=synthetic&token=not-for-output`, origin), "PROFILE");
  assert.equal(proofPathClass(`${origin}/login?error=private-detail`, origin), "LOGIN");
  assert.equal(proofPathClass("https://example.test/private", origin), "OTHER_ORIGIN");
  assert.equal(proofPathClass("not a URL", origin), "UNAVAILABLE");
  assert.equal(proofExceptionCategory(new TypeError("private text")), "TYPE_ERROR");
  assert.equal(proofExceptionCategory({ name: "TimeoutError", message: "private text", stack: "private stack" }), "TIMEOUT");
  assert.equal(proofExceptionCategory({ name: "CustomFailure", message: "private text" }), "OTHER_ERROR");
});

test("server diagnostics retain only known static errors and repository stack locations", () => {
  const summary = summarizeStudentProfileAppLog([
    " ⨯ Error [PlatformStudentHandoffRepositoryError]: Platform Student handoff data is unavailable. {",
    "    at failure (src/lib/platform-student-handoff.ts:342:9)",
    "    at oneRow (/private/tmp/secret-directory/src/lib/platform-student-handoff.ts:1197:12)",
    "    at unknownSensitiveName (src/lib/platform-student-handoff.ts:1200:4)",
    "    at privateValue (https://private.example.test/token:50:2)",
    "  private diagnostic payload with secret sentinel and private@example.test",
    "Error: private payload must never be retained",
    "TypeError: Platform Student handoff data is unavailable. appended-secret",
    "GET /v3/profile?case=private-id&token=private-token 500",
  ].join("\n"));
  assert.deepEqual(summary.errorClasses, ["Error", "PlatformStudentHandoffRepositoryError", "TypeError"]);
  assert.deepEqual(summary.staticMessages, ["Platform Student handoff data is unavailable."]);
  assert.deepEqual(summary.repositoryFrames, [
    { function: "failure", file: "src/lib/platform-student-handoff.ts", line: 342, column: 9 },
    { function: "oneRow", file: "src/lib/platform-student-handoff.ts", line: 1197, column: 12 },
  ]);
  assert.doesNotMatch(JSON.stringify(summary), /secret|private|password|bearer|https:|GET|appended/u);
  assert.deepEqual(summarizeStudentProfileAppLog("random customer data"), {
    errorClasses: [], staticMessages: [], repositoryFrames: [],
  });
});

test("D2 failure extracts the owned application log before cleanup and keeps raw logs private", () => {
  const block = harness.slice(harness.indexOf("student_profile_fields_browser_assert()"), harness.indexOf('\ncd "$repo_root"'));
  const extraction = block.indexOf("--summarize-owned-app-log");
  assert.ok(extraction > 0 && extraction < block.indexOf('fail "The bounded real Student Profile'));
  assert.match(block, /EVO_D2_APP_LOG="\$app_log"/u);
  assert.match(block, /EVO_D2_RUNTIME_DIR="\$tmp_dir"/u);
  const runner = readFileSync(runnerUrl, "utf8");
  assert.match(runner, /"server-failure\.json"/u);
  assert.match(runner, /APP_LOG_NOT_OWNED/u);
  assert.doesNotMatch(block, /(?:cat|tail|sed).*\$app_log/u);
});

test("upstream synthetic case uses normal canonical handoff instead of missing handoff rows", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  for (const command of ["create_manual_sales_lead", "mutate_sales_lead_workflow", "confirm_contract",
    "confirm_first_payment", "handoff_lead_to_admissions", "staff_student_case_handoff_context"]) {
    assert.ok(runner.includes(`"${command}"`), command);
  }
  assert.match(runner, /p_handoff_mode: "normal"/u);
  assert.match(runner, /Fictional local payment: no funds transferred/u);
  assert.match(runner, /PROFILE_NOT_ABSENT/u);
  assert.match(runner, /CHECKLIST_NOT_ABSENT/u);
  assert.doesNotMatch(runner, /INSERT INTO platform\.(?:record_scopes|student_cases|sales_admissions_handoffs)|exceptional_override/u);
});
