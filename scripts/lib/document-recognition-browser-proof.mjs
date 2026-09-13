#!/usr/bin/env node
// Real disposable Auth/UI/ClamAV/Storage proof. No provider acceptance implied.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { PROFILE_GROUP_LABELS } from "../../src/lib/student-profile-fields.ts";
import { normalizeDocumentRecognitionRequest, normalizeDocumentRecognitionReceipt } from "../../src/lib/document-recognition.ts";
import { configuration, seedCase, requireProof, ProofError, proofPathClass, writeFailureEvidence,
  writeOwnedAppLogDiagnostic } from "./student-profile-fields-browser-proof.mjs";
import { requireAcceptanceImages, runImagePredispatchProof } from "./document-recognition-acceptance-image.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const TECHNICAL_CONFIG = Object.freeze({ enabled: true, projectId: "synthetic-local-preflight",
  model: "gemini-local-preflight-only", configVersion: "local-preflight-v1", pricingPolicyVersion: "synthetic-price-v1",
  paidProjectId: "synthetic-local-preflight", paidEligibilityReference: "local-only-no-billing-proof",
  perJobBudgetMicros: 10000, dailyOrgBudgetMicros: 100000, inputTokenCeiling: 10000, outputTokenCeiling: 6000,
  inputMicrosPerMillionTokens: 100000, outputMicrosPerMillionTokens: 200000 });

async function main() {
  let config; let sql; let client; let browser; let page; let stage = "IMAGE_GATE";
  const browserErrors = new Set(); const counts = { console: 0, page: 0 };
  const http = { LOGIN: null, MAIN: null, PROFILE: null }; let browserWarningCount = 0;
  try {
    const images = requireAcceptanceImages();
    config = configuration("document-recognition");
    requireProof(!process.env.EVO_PLATFORM_GEMINI_API_KEY && !process.env.GEMINI_API_KEY, "PROVIDER_KEY_NOT_ALLOWED");
    sql = postgres(config.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });
    client = createClient(config.apiOrigin, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { caseId } = await seedCase(sql, config, client, value => { stage = value; });
    const snapshot = async () => {
      const result = await client.schema("platform").rpc("staff_student_profile_fields", { p_student_case_id: caseId });
      requireProof(!result.error && result.data?.student_case_id === caseId, "PROFILE_SNAPSHOT_FAILED"); return result.data;
    };
    stage = "TECHNICAL_CONFIG_FIXTURE";
    const [baseline] = await sql`SELECT (SELECT count(*) FROM platform_private.document_recognition_configs)::integer AS configs,
      (SELECT count(*) FROM platform_private.document_recognition_jobs)::integer AS jobs`;
    requireProof(baseline.configs === 0 && baseline.jobs === 0, "RECOGNITION_FIXTURE_NOT_EMPTY");
    // This is a labelled disposable-local configuration fixture, not a provider
    // readiness record. No scan/storage/claim/outcome facts are inserted here.
    await sql`INSERT INTO platform_private.document_recognition_configs
      (organization_id, config, registry_version, prompt_policy_version, enabled)
      VALUES (${config.organizationId}::uuid, ${sql.json(TECHNICAL_CONFIG)}, 'evo-profile-61-v1', 'extract-v1', TRUE)`;
    requireProof((await snapshot()).profile === null, "PROFILE_NOT_ABSENT");
    const [initialCase] = await sql`SELECT applied_country_requirement_version_id FROM platform.student_cases WHERE id=${caseId}::uuid`;
    requireProof(initialCase.applied_country_requirement_version_id === null, "CHECKLIST_NOT_ABSENT");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 1000 } });
    context.on("page", target => {
      target.on("pageerror", () => { counts.page += 1; browserErrors.add("PAGE_ERROR"); });
      target.on("console", message => {
        if (message.type() === "error") { counts.console += 1; browserErrors.add("CONSOLE_ERROR"); }
        if (message.type() === "warning") browserWarningCount += 1;
      });
    });
    context.on("response", response => { const key = proofPathClass(response.url(), config.appOrigin); if (Object.hasOwn(http, key)) http[key] = response.status(); });
    // Requests to the actual local application/Auth are continued, never fulfilled.
    await context.route("**/*", route => [config.appOrigin, config.apiOrigin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    page = await context.newPage(); page.setDefaultTimeout(30_000);
    stage = "LOGIN_DOCUMENT"; await page.goto(`${config.appOrigin}/login`, { waitUntil: "domcontentloaded" });
    stage = "LOGIN_EMAIL"; await page.locator("#staff-email").fill(config.email);
    stage = "LOGIN_PASSWORD"; await page.locator("#staff-password").fill(config.password);
    stage = "LOGIN_SUBMIT"; await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    stage = "ACTUAL_ADMIN_SHELL";
    await expect(page.getByTestId("v3-shell")).toHaveAttribute("data-system-role", "admin");
    await expect(page.getByTestId("v3-shell")).toHaveAttribute("data-presentation-role", "actual");
    const profileUrl = `${config.appOrigin}/v3/profile?case=${caseId}&tab=anketa`;
    stage = "PROFILE_START"; await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Начать анкету", exact: true }).click();
    await expect.poll(async () => (await snapshot()).profile?.revision).toBe(1);
    stage = "CONFIRMED_EMPTY";
    const group = page.getByRole("button", { name: new RegExp(`^${PROFILE_GROUP_LABELS.mother} ·`) });
    if (await group.getAttribute("aria-expanded") !== "true") await group.click();
    await page.locator('button[aria-controls="profile-field-mother_employer-editor"]').click();
    const editor = page.locator("#profile-field-mother_employer-editor");
    await editor.getByRole("button", { name: "Оставить поле пустым", exact: true }).click();
    await editor.getByRole("button", { name: "Подтвердить пустое значение", exact: true }).click();
    await expect.poll(async () => { const field = (await snapshot()).fields.find(item => item.field_key === "mother_employer");
      return field?.review_state === "confirmed" && field.value === null && field.reviewed_at !== null; }).toBe(true);
    const confirmed = await snapshot();
    requireProof(confirmed.profile.revision === 2, "PROFILE_REVISION_INVALID");
    stage = "DOCUMENT_CHECKLIST";
    const documentUrl = `${config.appOrigin}/v3/profile?case=${caseId}&tab=documents`;
    await page.goto(documentUrl, { waitUntil: "domcontentloaded" });
    const form = page.getByTestId("v3-document-checklist-create");
    await form.locator('input[name="label"]').fill("D3 synthetic public EVO logo");
    await form.locator('input[name="group_label"]').fill("D3 technical acceptance");
    await form.locator('button[type="submit"]').click();
    const row = () => page.getByTestId("v3-document-item").filter({ hasText: "D3 synthetic public EVO logo" });
    await expect(row()).toHaveAttribute("data-document-presence", "absent");
    stage = "REAL_DOCUMENT_UPLOAD";
    const bytes = readFileSync(resolve(REPO, "public/brand/evo-logo.png"));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const upload = row().getByTestId("v3-document-upload-form");
    await upload.locator('input[name="file"]').setInputFiles({ name: "d3-synthetic-public-logo.png", mimeType: "image/png", buffer: bytes });
    await expect(upload.locator('input[name="request_id"]')).not.toHaveValue("");
    await upload.locator('button[type="submit"]').click();
    await expect(row().getByTestId("v3-document-upload-status")).toHaveAttribute("data-outcome", "saved");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(row()).toHaveAttribute("data-document-presence", "present");
    const href = await row().getByTestId("v3-document-download").getAttribute("href");
    const versionId = href?.split("/")[4]; requireProof(UUID.test(versionId ?? ""), "SOURCE_VERSION_INVALID");
    const download = await context.request.get(new URL(href, config.appOrigin).href);
    requireProof(download.status() === 200 && (await download.body()).equals(bytes), "PRIVATE_STORAGE_DOWNLOAD_MISMATCH");
    stage = "REAL_SCAN_AND_STORAGE_EVIDENCE";
    const [source] = await sql`SELECT v.document_slot_id, v.sha256_hex, v.byte_size, b.bucket_id,
      s.scanned_sha256_hex, s.scanner_engine, s.scanner_engine_version, s.scanner_signature_version, s.scanner_protocol
      FROM platform.document_versions v JOIN platform_private.document_storage_bindings b
        ON b.document_version_id=v.id AND b.organization_id=v.organization_id
      JOIN platform_private.document_malware_scan_attestations s ON s.id=v.malware_scan_attestation_id
      WHERE v.organization_id=${config.organizationId}::uuid AND v.student_case_id=${caseId}::uuid AND v.id=${versionId}::uuid`;
    requireProof(source?.sha256_hex === sha256 && Number(source.byte_size) === bytes.length
      && source.bucket_id === "platform-documents" && source.scanned_sha256_hex === sha256
      && source.scanner_engine === "ClamAV" && source.scanner_protocol === "clamd-zinstream-v1"
      && /^[0-9][0-9A-Za-z.+~-]{0,63}$/u.test(source.scanner_engine_version)
      && /^[1-9][0-9]{0,18}$/u.test(source.scanner_signature_version), "SCAN_STORAGE_PROOF_INVALID");
    const endpoint = `${config.appOrigin}/api/v3/student-cases/${caseId}/document-recognition-jobs`;
    const panel = () => row().getByTestId("document-recognition");
    stage = "RECOGNITION_ENQUEUE_UI";
    await panel().getByRole("button", { name: "Извлечение полей", exact: true }).click();
    await panel().getByRole("button", { name: "Извлечь поля", exact: true }).click();
    await panel().getByRole("checkbox").check();
    const responsePromise = page.waitForResponse(response => response.url() === endpoint && response.request().method() === "POST");
    await panel().getByRole("button", { name: "Подтвердить запуск", exact: true }).click();
    const response = await responsePromise;
    requireProof(response.status() === 202, "ENQUEUE_NOT_ACCEPTED");
    const command = normalizeDocumentRecognitionRequest(response.request().postDataJSON());
    const receipt = normalizeDocumentRecognitionReceipt(await response.json());
    requireProof(command.source_version_id === versionId && command.expected_profile_revision === 2
      && command.retry_of_job_id === null && receipt.state === "queued" && !receipt.replayed, "ENQUEUE_RECEIPT_INVALID");
    stage = "SAME_SESSION_REPLAY";
    // Actual same-origin session API; reuses the exact successful UI command.
    // This validates replay, not the separate unknown-response UI condition.
    const replayResponse = await context.request.post(endpoint, { headers: { Origin: config.appOrigin }, data: command });
    requireProof(replayResponse.status() === 202, "REPLAY_NOT_ACCEPTED");
    const replay = normalizeDocumentRecognitionReceipt(await replayResponse.json());
    requireProof(replay.job_id === receipt.job_id && replay.state === "queued" && replay.replayed, "REPLAY_CREATED_ANOTHER_JOB");
    stage = "COLD_HISTORY";
    await page.reload({ waitUntil: "domcontentloaded" });
    await panel().getByRole("button", { name: "Извлечение полей", exact: true }).click();
    await expect(panel().getByTestId("document-recognition-job")).toHaveAttribute("data-state", "queued");
    const [queue] = await sql`SELECT count(*)::integer AS count FROM platform_private.document_recognition_jobs`;
    requireProof(queue.count === 1, "READ_OR_REPLAY_CREATED_JOB");
    stage = "LINUX_SOURCE_PREFLIGHT";
    const preflight = runImagePredispatchProof(images, config, { jobId: receipt.job_id,
      sourceVersionId: versionId, sourceSha256: sha256, sourceBytes: bytes.length });
    stage = "PREDISPATCH_DATABASE_READBACK";
    const [proof] = await sql`SELECT j.state='cancelled' AND j.failure_code='cancelled' AND j.cleanup_state='not_uploaded'
      AND j.upload_started_at IS NULL AND j.generate_started_at IS NULL AND j.reservation_released_at IS NOT NULL
      AND j.reserved_cost_micros=2200 AND j.source_pages=${preflight.sourcePages}
      AND j.processing_fingerprint=${preflight.processingFingerprint} AND a.source_preflight_policy_version='document-source-v1'
      AND a.stage='cancelled' AND a.token_count_receipt IS NULL AND a.result IS NULL AND a.published_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM platform_private.document_recognition_provider_files)
      AND NOT EXISTS (SELECT 1 FROM platform_private.document_recognition_proposal_links) AS predispatch_only,
      (SELECT count(*)::integer FROM platform.document_access_events e WHERE e.request_id=a.id
        AND e.id=${preflight.accessEventId}::uuid AND e.organization_id=j.organization_id AND e.student_case_id=j.student_case_id
        AND e.document_slot_id=j.source_document_slot_id AND e.document_version_id=j.source_version_id
        AND e.access_purpose='document_recognition' AND e.contract_reference='d3-source-v1') AS access_events
      FROM platform_private.document_recognition_jobs j JOIN platform_private.document_recognition_attempts a ON a.job_id=j.id
      WHERE j.id=${receipt.job_id}::uuid AND a.id=${preflight.attemptId}::uuid`;
    requireProof(proof?.predispatch_only === true && proof.access_events === 1, "PREDISPATCH_FACTS_INVALID");
    requireProof(JSON.stringify(await snapshot()) === JSON.stringify(confirmed), "PROFILE_CHANGED_WITHOUT_REVIEW");
    stage = "CANCELLED_HISTORY_UI";
    await panel().getByRole("button", { name: "Обновить историю", exact: true }).click();
    await expect(panel().getByTestId("document-recognition-job")).toHaveAttribute("data-state", "cancelled");
    await expect(panel()).toContainText("Передача не начиналась");
    await expect(page.locator("[data-nextjs-dialog-overlay], [data-nextjs-error-dialog]")).toHaveCount(0);
    requireProof(browserErrors.size === 0, "BROWSER_RUNTIME_ERRORS");
    await page.screenshot({ path: resolve(config.evidenceDir, "recognition-predispatch.png"), fullPage: true });
    writeFileSync(resolve(config.evidenceDir, "acceptance.json"), JSON.stringify({ schema: "evo-d3-local-predispatch-acceptance/v1",
      synthetic: true, businessAcceptance: false, providerAcceptance: false, fullWorkerAcceptance: false,
      realAdminAuth: true, realUiEnqueue: true, sameSessionReplay: true, coldHistory: true,
      actualClamAV: true, privateStorageDownloadEqual: true, realLinuxSourcePreflight: true,
      confirmedEmptyUnchanged: true, cancelledBeforeProvider: true, reservationReleased: true,
      sourceAccessEvents: 1, jobs: 1, providerIntents: 0, providerFiles: 0, proposals: 0,
      browserErrorCount: 0, browserWarningCount, images, preflight }, null, 2), { mode: 0o600, flag: "wx" });
    process.stdout.write("DOCUMENT_RECOGNITION_PREDISPATCH_VERIFIED\n");
  } catch (error) {
    try { await writeFailureEvidence({ config, page, stage, error, http, browserErrors, browserWarningCount, counts }); }
    catch { process.stderr.write("DOCUMENT_RECOGNITION_BROWSER_DIAGNOSTIC:UNAVAILABLE\n"); }
    process.stderr.write(`DOCUMENT_RECOGNITION_BROWSER_ERROR:${error instanceof ProofError ? error.code : stage}\n`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {}); client?.auth.stopAutoRefresh(); await sql?.end({ timeout: 5 }).catch(() => {});
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--summarize-owned-app-log") writeOwnedAppLogDiagnostic("document-recognition");
  else await main();
}
