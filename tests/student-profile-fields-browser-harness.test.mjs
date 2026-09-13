import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localOrigin, proofExceptionCategory, proofPathClass, summarizeStudentProfileAppLog, verifyDocumentExportBucket, verifyStoredDocumentExport, SYNTHETIC_EXPECTED_VALUES, SYNTHETIC_REQUIRED_VALUES } from "../scripts/lib/student-profile-fields-browser-proof.mjs";
import { PROFILE_FIELDS, PROFILE_REQUIRED_FIELD_KEYS } from "../src/lib/student-profile-fields.ts";
import { DOCUMENT_EXPORT_MAX_BYTES, DOCUMENT_EXPORT_MIME, DOCUMENT_EXPORT_TEMPLATE_SHA256 } from "../src/lib/document-export-artifact-contract.ts";

const harness = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
const runnerUrl = new URL("../scripts/lib/student-profile-fields-browser-proof.mjs", import.meta.url);

test("profile-only acceptance waits for owned cleanup and fails closed on stop or absence-readback failure", () => {
  const newStart = harness.indexOf("student_profile_cleanup() {");
  const start = newStart < 0 ? harness.indexOf("cleanup() {") : newStart;
  const functions = harness.slice(start, harness.indexOf("\ntrap cleanup EXIT", start));
  for (const failure of ["supabase-stop", "remaining-container", "remaining-network", "remaining-volume", "container-read", "network-read", "volume-read", "original-exit", "proof-not-ready", "malformed-pending", "wrong-project", ""]) {
    const root = mkdtempSync(join(tmpdir(), "evo-profile-cleanup-unit-"));
    try {
      const evidence = join(root, "evidence"); mkdirSync(evidence);
      const ownedTmp = join(root, "evo-database-foundation.synthetic"); mkdirSync(ownedTmp);
      const lock = join(root, "lock"); mkdirSync(lock); writeFileSync(join(lock, "pid"), "123\n");
      writeFileSync(join(evidence, "acceptance.pending.json"), JSON.stringify({
        schema: "evo-student-profile-browser-proof/v2", synthetic: true, businessAcceptance: false,
        localProjectId: "evo-local-0123456789abcdef", cleanupVerified: false, realAdminAuth: true,
        persistentArtifacts: 2, generationSeparateFromDownload: true, exactRequestReplayWithoutDuplicate: true,
        coldHistorySameBytes: true, historicalDraftDownload: true, downloadsCreateNoArtifacts: true,
      }));
      if (failure === "malformed-pending") writeFileSync(join(evidence, "acceptance.pending.json"), "{");
      if (failure === "wrong-project") {
        const pending = JSON.parse(readFileSync(join(evidence, "acceptance.pending.json"), "utf8"));
        writeFileSync(join(evidence, "acceptance.pending.json"), JSON.stringify({ ...pending, localProjectId: "evo-local-fedcba9876543210" }));
      }
      // Exercise the actual EXIT functions. Only local command boundaries are
      // synthetic: this never calls a Docker daemon, database or provider.
      const result = spawnSync("bash", ["-c", `set -Eeuo pipefail
${functions}
npx() { [[ "$FAILURE" != supabase-stop ]]; }
docker() {
  case "$1 $2" in
    'ps -a')
      [[ "$FAILURE" != container-read ]] || return 1
      [[ "$FAILURE" != remaining-container ]] || echo supabase_db_evo-local-0123456789abcdef;;
    'network ls')
      [[ "$FAILURE" != network-read ]] || return 1
      [[ "$FAILURE" != remaining-network ]] || echo supabase_network_evo-local-0123456789abcdef;;
    'volume ls')
      [[ "$FAILURE" != volume-read ]] || return 1
      [[ "$FAILURE" != remaining-volume ]] || echo supabase_storage_evo-local-0123456789abcdef;;
    *) return 91;;
  esac
}
student_profile_fields_only=1; student_profile_project_id=evo-local-0123456789abcdef
student_profile_evidence_dir="$EVIDENCE"; student_profile_proof_ready=1
[[ "$FAILURE" != proof-not-ready ]] || student_profile_proof_ready=0
supabase_started=1; supabase_workdir="$OWNED_TMP/local-supabase"
app_pid=""; waha_pid=""; clamav_container_name=""; clamav_signature_volume=""
tmp_dir="$OWNED_TMP"; repo_root="$ROOT"; node_bin="$NODE"
supabase_lock_acquired=1; supabase_lock_dir="$LOCK"; supabase_lock_pid_file="$LOCK/pid"
runtime_inventory_cleanup=0
trap cleanup EXIT
[[ "$FAILURE" != original-exit ]] || exit 1
exit 0
`], { encoding: "utf8", timeout: 5000, env: { ...process.env, FAILURE: failure, EVIDENCE: evidence,
        OWNED_TMP: ownedTmp, ROOT: root, NODE: process.execPath, LOCK: lock, TMPDIR: root } });
      assert.equal(result.status, failure ? 1 : 0, `${failure || "success"}: ${result.stderr}`);
      assert.equal(result.stdout.includes("STUDENT_PROFILE_FIELDS_BROWSER_VERIFIED"), !failure, failure);
      assert.equal(existsSync(join(evidence, "acceptance.json")), !failure, failure);
      if (failure && !["original-exit", "proof-not-ready", "malformed-pending", "wrong-project"].includes(failure)) {
        assert.ok(existsSync(ownedTmp));
        assert.ok(existsSync(join(evidence, "acceptance.pending.json")));
        assert.match(result.stderr, /STUDENT_PROFILE_FIELDS_CLEANUP_FAILED/u);
      } else {
        assert.equal(existsSync(ownedTmp), false);
        assert.equal(existsSync(lock), false);
        if (!failure) assert.equal(JSON.parse(readFileSync(join(evidence, "acceptance.json"), "utf8")).cleanupVerified, true);
        if (["malformed-pending", "wrong-project"].includes(failure)) assert.match(result.stderr, /STUDENT_PROFILE_FIELDS_RECEIPT_FINALIZATION_FAILED/u);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("cleanup for all other foundation modes remains byte-identical", () => {
  const marker = "  # Existing full/staff/admissions cleanup remains unchanged below.\n";
  const start = harness.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length);
  const body = harness.slice(start, harness.indexOf("\n}\ntrap cleanup EXIT", start));
  assert.equal(createHash("sha256").update(body).digest("hex"), "366d0877f9a5d2a199479edcaaf0523b5060e8eeec0dac169ef084dd58ac178d");
});

test("local export bucket is checked before any synthetic business mutation", () => {
  const valid = { id: "platform-document-exports", public: false, file_size_limit: DOCUMENT_EXPORT_MAX_BYTES, allowed_mime_types: [DOCUMENT_EXPORT_MIME] };
  assert.doesNotThrow(() => verifyDocumentExportBucket(valid));
  for (const change of [{ id: "platform-documents" }, { public: true }, { file_size_limit: 25 * 1024 * 1024 }, { allowed_mime_types: ["application/pdf"] }, { allowed_mime_types: null }]) {
    assert.throws(() => verifyDocumentExportBucket({ ...valid, ...change }), /EXPORT_BUCKET_NOT_READY/u);
  }
  assert.throws(() => verifyDocumentExportBucket(null), /EXPORT_BUCKET_NOT_READY/u);
  const runner = readFileSync(runnerUrl, "utf8");
  const check = runner.indexOf("verifyDocumentExportBucket(bucket.data)");
  assert.ok(check > runner.indexOf("await storage.getBucket(EXPORT_BUCKET)"));
  assert.ok(check < runner.indexOf("await seedCase("));
});

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
  const start = harness.indexOf('if [[ "$student_profile_fields_only" == "1" ]]', harness.indexOf("LOCAL_SUPABASE_ADMIN_BOOTSTRAPPED"));
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

test("D2 proof binds isolated Docker ownership, ready receipts and real persistent bytes", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  assert.match(runner, /com\.supabase\.cli\.workdir/u);
  assert.match(runner, /com\.supabase\.cli\.project/u);
  assert.match(runner, /LOCAL_RUNTIME_NOT_OWNED/u);
  assert.match(runner, /waitForEvent\("download"/u);
  assert.match(runner, /\["db", "kong", "storage"\]/u);
  assert.match(runner, /platform_private\.document_export_artifacts/u);
  assert.match(runner, /JOIN storage\.objects/u);
  assert.match(runner, /storage\.from\(EXPORT_BUCKET\)\.download\(stored\.object_name\)/u);
  assert.match(runner, /storedBytes\.equals\(bytes\)/u);
  assert.match(runner, /document_export_download_grants/u);
  assert.doesNotMatch(runner, /student_profile_export_attempts|Скачать черновик|Скачать финальную анкету/u);
  assert.match(runner, /output_sha256/u);
  assert.match(runner, /word\/document\.xml/u);
  assert.match(runner, /STUDENT_PROFILE_FIELDS_BROWSER_VERIFIED/u);
  assert.match(runner, /page\.on\("pageerror"/u);
  assert.match(runner, /page\.on\("console"/u);
  assert.match(runner, /BROWSER_RUNTIME_ERRORS/u);
  assert.match(runner, /PAGE_TITLE_INVALID/u);
  assert.doesNotMatch(runner, /console\.(?:log|error)\(error|process\.stderr\.write\(error/u);
});

test("persistent UI proof separates generation, exact replay and cold historical downloads without regeneration", () => {
  const runner = readFileSync(runnerUrl, "utf8");
  for (const label of ["Сформировать черновик", "Сформировать финальную анкету", "Скачать файл", "Сохранённые файлы",
    "Предыдущая версия анкеты", "Текущая версия анкеты"]) assert.ok(runner.includes(label), label);
  assert.match(runner, /GENERATION_DOWNLOADED_AUTOMATICALLY/u);
  assert.match(runner, /postDataJSON\(\)/u);
  assert.match(runner, /page\.request\.post\(exportUrl, \{ data: finalExport\.command, headers: \{ origin: config\.appOrigin \}/u);
  assert.match(runner, /PERSISTENT_REPLAY_DUPLICATED_OR_CHANGED/u);
  assert.match(runner, /const cold = await context\.newPage\(\)/u);
  assert.match(runner, /normalizeDocumentExportWorkspace\(await historyResponse\.json\(\), caseId\)/u);
  assert.match(runner, /coldDraft\.sha256 === draft\.sha256 && coldFinal\.sha256 === final\.sha256/u);
  assert.match(runner, /DOWNLOAD_CHANGED_ARTIFACT_HISTORY/u);
  assert.match(runner, /lostReplyReconciliationExercised: false/u);
  const hook = harness.slice(harness.indexOf("student_profile_fields_browser_assert()"), harness.indexOf('\ncd "$repo_root"'));
  assert.match(hook, /EVO_D2_STORAGE_SERVICE_KEY="\$supabase_service_role_key"/u);
  assert.match(hook, /for secret in "\$supabase_service_role_key"/u);
  assert.doesNotMatch(runner, /storage\.from\([^)]*\)\.(?:upload|update|remove)|\.rpc\("(?:prepare|begin|seal|complete|reconcile)_document_export/u);
});

function persistentFixture() {
  const id = "aaaa0000-0000-4000-8000-000000000001";
  const organizationId = "aaaa0000-0000-4000-8000-000000000002";
  const caseId = "aaaa0000-0000-4000-8000-000000000003";
  const bytes = Buffer.from("synthetic stored bytes");
  const receipt = { id, student_case_id: caseId, receipt_id: "aaaa0000-0000-4000-8000-000000000004",
    state: "ready", can_download: true, profile_revision: 14, mode: "final", workspace_revision: "b".repeat(64),
    input_snapshot_sha256: "c".repeat(64), output_sha256: createHash("sha256").update(bytes).digest("hex"), output_bytes: bytes.length };
  const stored = { ...receipt, organization_id: organizationId, template_sha256: DOCUMENT_EXPORT_TEMPLATE_SHA256,
    bucket_id: "platform-document-exports", bucket_public: false, bucket_limit: DOCUMENT_EXPORT_MAX_BYTES,
    bucket_mimes: [DOCUMENT_EXPORT_MIME], storage_object_id: "aaaa0000-0000-4000-8000-000000000005",
    object_name: `${organizationId}/${caseId}/${id}.docx` };
  return { bytes, receipt, stored, organizationId };
}

test("Storage proof requires identical ready receipt, private object scope and downloaded bytes", () => {
  const { bytes, receipt, stored, organizationId } = persistentFixture();
  assert.deepEqual(verifyStoredDocumentExport(bytes, receipt, stored, organizationId), {
    sha256: receipt.output_sha256, bytes: bytes.length, persisted: true, privateStorageReadback: true,
  });
  for (const change of [{ state: "pending" }, { can_download: false }, { profile_revision: 15 },
    { id: "aaaa0000-0000-4000-8000-000000000006" }, { workspace_revision: "d".repeat(64) }]) {
    assert.throws(() => verifyStoredDocumentExport(bytes, { ...receipt, ...change }, stored, organizationId), /PERSISTENT_RECEIPT_MISMATCH/u);
  }
  for (const change of [{ bucket_public: true }, { bucket_limit: 25 * 1024 * 1024 }, { bucket_mimes: ["application/pdf"] },
    { bucket_id: "platform-documents" }, { object_name: "wrong/object.docx" }, { storage_object_id: null }]) {
    assert.throws(() => verifyStoredDocumentExport(bytes, receipt, { ...stored, ...change }, organizationId), /PERSISTENT_STORAGE_BOUNDARY_INVALID/u);
  }
  assert.throws(() => verifyStoredDocumentExport(Buffer.from("different bytes"), receipt, stored, organizationId), /PERSISTENT_STORAGE_BYTES_MISMATCH/u);
  assert.throws(() => verifyStoredDocumentExport(bytes, receipt, { ...stored, output_sha256: "0".repeat(64) }, organizationId), /PERSISTENT_STORAGE_BYTES_MISMATCH/u);
  assert.throws(() => verifyStoredDocumentExport(bytes, receipt, null, organizationId), /PERSISTENT_RECEIPT_MISMATCH/u);
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
