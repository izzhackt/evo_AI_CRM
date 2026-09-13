import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PRODUCTION_MODULES, validateImageEvidence, normalizePredispatchReceipt } from "../scripts/lib/document-recognition-acceptance-image.mjs";
import { TECHNICAL_CONFIG } from "../scripts/lib/document-recognition-browser-proof.mjs";
import { proofScope } from "../scripts/lib/student-profile-fields-browser-proof.mjs";
import { parseDocumentRecognitionProviderConfig, maximumDocumentRecognitionCostMicros } from "../src/lib/server/gemini-document-recognition.ts";
import { resolveNodeTestPlan } from "../scripts/run-node-test-suite.mjs";
import { classifyChangedEntries } from "../scripts/classify-pr-changes.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const harness = read("scripts/test-postgres-v2-foundation.sh");
const runner = read("scripts/lib/document-recognition-browser-proof.mjs");
const driver = read("scripts/lib/document-recognition-predispatch-proof.mjs");
const image = read("scripts/lib/document-recognition-acceptance-image.mjs");
const docker = read("scripts/Dockerfile.document-recognition-acceptance");
const revision = "a".repeat(40), hash = "b".repeat(64), productionId = `sha256:${"c".repeat(64)}`, acceptanceId = `sha256:${"d".repeat(64)}`;
function imageEvidence() {
  const runtime = { inspectorSha256: hash, launcherSha256: hash, nodeSha256: hash, treeSha256: hash };
  const modules = Object.fromEntries(PRODUCTION_MODULES.map(path => [path, hash]));
  return { production: { Id: productionId, Os: "linux", Architecture: "arm64", Config: { Labels: { "org.opencontainers.image.revision": revision } } },
    acceptance: { Id: acceptanceId, Os: "linux", Architecture: "arm64", Config: { Labels: {
      "evo.d3.acceptance.production-image": productionId, "evo.d3.acceptance.revision": revision } } },
    runtimeProduction: runtime, runtimeAcceptance: { ...runtime }, modules, expectedModules: { ...modules }, revision };
}

test("image evidence binds actual artifact and module hashes, not labels alone", () => {
  const input = imageEvidence(); const result = validateImageEvidence(input);
  assert.equal(result.productionImage, productionId); assert.equal(result.acceptanceImage, acceptanceId);
  assert.deepEqual(result.modules, input.expectedModules); assert.deepEqual(result.runtime, input.runtimeProduction);
  const changedModule = imageEvidence(); changedModule.modules[PRODUCTION_MODULES[0]] = "e".repeat(64);
  assert.throws(() => validateImageEvidence(changedModule), { code: "PRODUCTION_MODULE_MISMATCH" });
  const changedRuntime = imageEvidence(); changedRuntime.runtimeAcceptance.inspectorSha256 = "e".repeat(64);
  assert.throws(() => validateImageEvidence(changedRuntime), { code: "RUNTIME_ARTIFACT_MISMATCH" });
  const changedRevision = imageEvidence(); changedRevision.acceptance.Config.Labels["evo.d3.acceptance.revision"] = "f".repeat(40);
  assert.throws(() => validateImageEvidence(changedRevision), { code: "COMBINED_IMAGE_REVISION_MISMATCH" });
});

test("measured predispatch receipt requires the same source and explicit non-provider scope", () => {
  const expected = { jobId: "a0000000-0000-4000-8000-000000000001", sourceSha256: hash, sourceBytes: 130 };
  const value = { schema: "evo-d3-predispatch/v1", jobId: expected.jobId,
    attemptId: "a0000000-0000-4000-8000-000000000002", accessEventId: "a0000000-0000-4000-8000-000000000003",
    sourceSha256: hash, sourceBytes: 130, sourcePages: 1, sourcePolicy: "document-source-v1", processingFingerprint: hash, providerDispatch: false };
  assert.deepEqual(normalizePredispatchReceipt(value, expected), value);
  assert.throws(() => normalizePredispatchReceipt({ ...value, sourceBytes: 131 }, expected), { code: "PREDISPATCH_RECEIPT_INVALID" });
  assert.throws(() => normalizePredispatchReceipt({ ...value, providerDispatch: true }, expected), { code: "PREDISPATCH_RECEIPT_INVALID" });
});

test("disposable configuration meets real config shape while disclaiming billing proof", () => {
  assert.deepEqual(parseDocumentRecognitionProviderConfig(TECHNICAL_CONFIG), TECHNICAL_CONFIG);
  assert.equal(maximumDocumentRecognitionCostMicros(TECHNICAL_CONFIG), 2200);
  assert.equal(TECHNICAL_CONFIG.paidEligibilityReference, "local-only-no-billing-proof");
  assert.equal(TECHNICAL_CONFIG.model, "gemini-local-preflight-only");
  assert.match(runner, /INSERT INTO platform_private\.document_recognition_configs/u);
  assert.doesNotMatch(runner, /INSERT INTO platform(?:_private)?\.(?:document_versions|document_storage_bindings|document_malware_scan_attestations|document_recognition_jobs|document_recognition_attempts|document_recognition_provider_files)/u);
});

test("new proof scope preserves default D2 environment and evidence boundaries", () => {
  assert.deepEqual(proofScope(), { kind: "student-profile-fields", prefix: "EVO_D2", marker: "STUDENT_PROFILE_FIELDS" });
  assert.deepEqual(proofScope("document-recognition"), { kind: "document-recognition", prefix: "EVO_D3", marker: "DOCUMENT_RECOGNITION" });
  assert.throws(() => proofScope("unrecognized"), { code: "PROOF_SCOPE_INVALID" });
});

test("D3 mode fails before the foundation lock when immutable images are absent", () => {
  const env = { ...process.env }; delete env.EVO_D3_COMBINED_IMAGE; delete env.EVO_D3_ACCEPTANCE_IMAGE;
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--experimental-strip-types", "scripts/lib/document-recognition-acceptance-image.mjs"], {
    cwd: new URL("..", import.meta.url), env, encoding: "utf8", timeout: 15_000,
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, "");
  assert.match(result.stderr, /DOCUMENT_RECOGNITION_IMAGE_GATE:COMBINED_RUNTIME_IMAGE_REQUIRED/u);
  const gate = harness.indexOf("scripts/lib/document-recognition-acceptance-image.mjs");
  assert.ok(gate > 0 && gate < harness.indexOf('mkdir "$supabase_lock_dir"'));
  assert.match(image, /git", \["status", "--porcelain"\]/u);
  assert.match(image, /encoding: "buffer"/u);
  assert.match(image, /NATIVE_RUNTIME_IMAGE_REQUIRED/u);
});

test("bounded mode starts real scanner and existing app but no unrelated provider suites", () => {
  const start = harness.indexOf('if [[ "$document_recognition_only" == "1" ]]', harness.indexOf('\ncd "$repo_root"'));
  const branch = harness.slice(start, harness.indexOf("\nfi", start));
  assert.ok(start > harness.indexOf("LOCAL_SUPABASE_ADMIN_BOOTSTRAPPED"));
  assert.match(branch, /start_clamav_scanner/u); assert.match(branch, /document_recognition_browser_assert/u);
  assert.match(branch, /start_app configured unavailable blocked provider-not-authorized enabled/u);
  assert.match(branch, /assert_no_secret_or_payload_logs/u); assert.match(branch, /exit 0/u);
  assert.doesNotMatch(branch, /start_isolated_waha_service|provision_local_staff|v3_browser_gate/u);
  assert.match(harness, /trap cleanup EXIT/u);
});

test("actual UI and same-session replay keep source facts and human review separate", () => {
  for (const text of ["#staff-email", "#staff-password", "Начать анкету", "Подтвердить пустое значение",
    "v3-document-upload-form", "document_malware_scan_attestations", "Подтвердить запуск", "context.request.post(endpoint",
    "REPLAY_CREATED_ANOTHER_JOB", "coldHistory: true", "PREDISPATCH_FACTS_INVALID", "PROFILE_CHANGED_WITHOUT_REVIEW"])
    assert.ok(runner.includes(text), text);
  assert.match(runner, /public\/brand\/evo-logo\.png/u);
  assert.match(runner, /JSON\.stringify\(await snapshot\(\)\) === JSON\.stringify\(confirmed\)/u);
  assert.match(runner, /providerAcceptance: false, fullWorkerAcceptance: false/u);
  assert.doesNotMatch(runner, /route\.fulfill|addInitScript|setStorageState|setSession|auth\.admin|generateLink/u);
});

test("acceptance-only Linux orchestration imports real source/inspector/RPC and cancels before provider", () => {
  for (const path of ["document-recognition-source.ts", "document-source-preflight.ts", "platform-supabase-service-client.ts", "document-recognition.ts"])
    assert.ok(driver.includes(path), path);
  assert.match(driver, /loadDocumentRecognitionSource\(/u); assert.match(driver, /await inspectDocumentSource\(/u);
  assert.match(driver, /canonicalDocumentRecognitionFingerprint\(/u);
  assert.match(driver, /"seal_document_recognition_preflight"/u);
  assert.match(driver, /"finish_document_recognition_preflight"/u); assert.match(driver, /p_failure_code: "cancelled"/u);
  assert.doesNotMatch(driver, /import .*gemini|import .*document-recognition-worker|begin_document_recognition_upload|begin_document_recognition_generation/u);
  assert.match(docker, /FROM combined AS document-recognition-acceptance/u);
  assert.doesNotMatch(read("Dockerfile"), /document-recognition-predispatch-proof|document-recognition-acceptance/u);
  assert.match(image, /container:supabase_kong_/u); assert.match(image, /input: JSON\.stringify/u);
  assert.match(image, /ACCEPTANCE_CONTAINER_CLEANUP_FAILED/u);
});

test("D3 failure diagnostics precede cleanup without raw application logs", () => {
  const block = harness.slice(harness.indexOf("document_recognition_browser_assert()"), harness.indexOf('\ncd "$repo_root"'));
  assert.ok(block.indexOf("--summarize-owned-app-log") < block.indexOf('fail "D3 actual local'));
  assert.match(block, /EVO_D3_APP_LOG="\$app_log"/u); assert.match(block, /EVO_D3_RUNTIME_DIR="\$tmp_dir"/u);
  assert.doesNotMatch(block, /(?:cat|tail|sed).*\$app_log/u);
});

test("ordinary CI manifest includes acceptance contract checks once, not the real stack", () => {
  const packageJson = JSON.parse(read("package.json"));
  const plan = resolveNodeTestPlan({ packageJson, repositoryRoot: new URL("..", import.meta.url).pathname });
  assert.equal(plan.files.filter(path => path === "tests/document-recognition-acceptance-harness.test.mjs").length, 1);
  assert.equal(plan.files.includes("scripts/lib/document-recognition-browser-proof.mjs"), false);
  const classified = classifyChangedEntries(["scripts/Dockerfile.document-recognition-acceptance",
    "scripts/lib/document-recognition-predispatch-proof.mjs", "scripts/lib/document-recognition-acceptance-image.mjs"]
    .map(path => ({ status: "A", paths: [path] })));
  assert.equal(classified.unknown, false);
});
