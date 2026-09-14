// Real local product HTTP/UI proof; external services are never mocked here.
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import postgres from "postgres";
import { configuration, requireProof, ProofError, proofPathClass, writeFailureEvidence } from "./student-profile-fields-browser-proof.mjs";
import { templateAcceptanceAppSpec, requireTemplateAcceptanceImages,
  startTemplateAcceptanceApp, cleanupTemplateAcceptanceApp, TEMPLATE_PROOF_CHECKS,
  validateTemplatePendingReceipt } from "./university-template-ingress-acceptance.mjs";
import { normalizeUniversityTemplateIngressReceipt, normalizeUniversityTemplateInspectionMetadata } from "../../src/lib/university-template-ingress.ts";
import { proveUniversityTemplateMapping } from "./university-template-mapping-browser-proof.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const hash = value => createHash("sha256").update(value).digest("hex");
export function assertUnknownTemplateOutcome(unknown, lostReplyVerified) {
  requireProof(lostReplyVerified && unknown.ingress?.state === "unknown" && unknown.ingress.can_reconcile
    && unknown.inspection === "pending" && unknown.receipt_id === null, "UNKNOWN_OUTCOME_NOT_PROVEN");
}
export function assertExactTemplateReplay(replayed, status) {
  requireProof(replayed.replayed && replayed.inspection_receipt_id === status.receipt_id, "EXACT_UPLOAD_REPLAY_CHANGED");
}
export async function syntheticTemplatePdf() {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  page.drawText("Synthetic University Blank - no applicant information", { x: 30, y: 750,
    size: 12, font: await pdf.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
async function seedCatalogue(client, organizationId) {
  const command = async (name, args) => {
    const { data, error } = await client.schema("platform").rpc(name, {
      ...args, p_organization_id: organizationId, p_request_id: randomUUID(),
    }).abortSignal(AbortSignal.timeout(10_000));
    requireProof(!error, "SYNTHETIC_CATALOGUE_COMMAND_FAILED"); return data;
  };
  const content = { name: "Synthetic Ingress University", country: "MY", city: "Synthetic city",
    overview: "Synthetic local acceptance catalogue, not an actual university offer.", websiteUrl: "https://example.com",
    sourceUrl: "https://example.com/synthetic-template", verifiedOn: "2026-09-14", notes: "Disposable synthetic fixture only", photoKey: null,
    programs: [{ id: "synthetic-program", title: "Synthetic programme", level: "bachelor", duration: null,
      language: "English", summary: "Synthetic test", sourceUrl: "https://example.com/synthetic-template", intakes: [] }] };
  const staged = await command("stage_university_catalog_publication", { p_institution_id: null, p_base_version: 0,
    p_content: content, p_reason: "Synthetic local template ingress acceptance" });
  requireProof(UUID.test(staged?.draftId) && staged.status === "saved", "SYNTHETIC_CATALOGUE_DRAFT_INVALID");
  const published = await command("review_university_catalog_publication", { p_draft_id: staged.draftId, p_decision: "publish" });
  requireProof(UUID.test(published?.institutionId) && published.status === "published", "SYNTHETIC_CATALOGUE_PUBLICATION_INVALID");
  return published.institutionId;
}

async function main() {
  let config, sql, client, storage, browser, spec, diagnosticPage, stage = "IMAGE_GATE", appCleaned = false;
  const counts = { error: 0, warning: 0, page: 0, console: 0 }, http = { LOGIN: null, MAIN: null };
  const browserErrors = new Set(); let pending;
  const timer = setTimeout(() => {
    // Hard host lifetime: no hung browser may leave its owned app running.
    try { if (spec) cleanupTemplateAcceptanceApp(spec.appName); } catch { /* outer harness still owns cleanup */ }
    process.stderr.write("UNIVERSITY_TEMPLATE_INGRESS_ERROR:LIFETIME_EXCEEDED\n"); process.exit(1);
  }, 480_000); // Two distinct workflows, one stack; upload deadlines are unchanged.
  try {
    const images = requireTemplateAcceptanceImages();
    config = configuration("university-template-ingress");
    const serviceKey = process.env.EVO_PLATFORM_SUPABASE_SECRET_KEY;
    requireProof(typeof serviceKey === "string" && serviceKey.length >= 16, "LOCAL_SERVICE_KEY_REQUIRED");
    spec = templateAcceptanceAppSpec({ imageId: images.productionImage, revision: images.revision, projectId: config.projectId,
      scannerName: process.env.EVO_D4_TEMPLATE_SCANNER, appName: process.env.EVO_D4_TEMPLATE_APP_NAME, appPort: Number(new URL(config.appOrigin).port) });
    stage = "APPLICATION_START";
    const { identity, lostReplyVerified } = await startTemplateAcceptanceApp(spec, { publishableKey: config.publishableKey, serviceKey, organizationId: config.organizationId },
      process.env.EVO_D4_TEMPLATE_SUPABASE_WORKDIR);
    sql = postgres(config.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });
    client = createClient(config.apiOrigin, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    storage = createClient(config.apiOrigin, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    stage = "REAL_ADMIN_AUTH";
    const login = await client.auth.signInWithPassword({ email: config.email, password: config.password });
    requireProof(!login.error && UUID.test(login.data.user?.id), "REAL_ADMIN_AUTH_FAILED");
    const [baseline] = await sql`SELECT (SELECT count(*) FROM platform_private.university_form_templates)::integer AS templates,
      (SELECT count(*) FROM platform_private.university_form_inspection_receipts)::integer AS receipts`;
    requireProof(baseline.templates === 0 && baseline.receipts === 0, "TEMPLATE_FIXTURE_NOT_EMPTY");
    stage = "LOCAL_BUCKET";
    const bucket = await storage.storage.createBucket("platform-document-templates", { public: false, fileSizeLimit: 20971520,
      allowedMimeTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] });
    requireProof(!bucket.error, "LOCAL_TEMPLATE_BUCKET_CREATE_FAILED");
    const readBucket = await storage.storage.getBucket("platform-document-templates");
    requireProof(!readBucket.error && readBucket.data.public === false && Number(readBucket.data.file_size_limit) === 20971520,
      "LOCAL_TEMPLATE_BUCKET_READBACK_FAILED");
    stage = "SYNTHETIC_CATALOGUE"; const catalogId = await seedCatalogue(client, config.organizationId);
    const bytes = await syntheticTemplatePdf(), sha256 = hash(bytes);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 1000 } });
    context.on("page", page => {
      page.on("pageerror", () => { counts.error++; counts.page++; browserErrors.add("PAGE_ERROR"); });
      page.on("console", message => { if (message.type() === "error") { counts.error++; counts.console++; browserErrors.add("CONSOLE_ERROR"); }
        if (message.type() === "warning") counts.warning++; });
    });
    context.on("response", response => {
      const route = proofPathClass(response.url(), config.appOrigin);
      if (Object.hasOwn(http, route)) http[route] = response.status();
    });
    await context.route("**/*", route => [config.appOrigin, config.apiOrigin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage(); diagnosticPage = page; page.setDefaultTimeout(30_000);
    stage = "LOGIN_DOCUMENT"; await page.goto(`${config.appOrigin}/login`, { waitUntil: "domcontentloaded" });
    stage = "LOGIN_EMAIL"; await page.locator("#staff-email").fill(config.email);
    stage = "LOGIN_PASSWORD"; await page.locator("#staff-password").fill(config.password);
    stage = "LOGIN_SUBMIT";
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    stage = "AUTHENTICATED_SHELL";
    await expect(page.getByTestId("v3-shell")).toHaveAttribute("data-system-role", "admin");
    stage = "ACTUAL_ROLE";
    await expect(page.getByTestId("v3-shell")).toHaveAttribute("data-presentation-role", "actual");
    stage = "CATALOGUE_UI"; await page.goto(`${config.appOrigin}/v3/universities`, { waitUntil: "domcontentloaded" });
    await page.locator(`a[href="/v3/universities/${catalogId}"]`).first().click();
    await page.locator(`a[href="/v3/universities/${catalogId}/forms"]`).click();
    stage = "CREATE_UI"; await page.getByRole("link", { name: "Добавить бланк", exact: true }).click();
    await page.getByLabel("Название бланка", { exact: true }).fill("Synthetic PDF blank");
    await page.getByRole("button", { name: "Создать бланк", exact: true }).click();
    await page.getByRole("link", { name: "Загрузить файл", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/v3/universities/${catalogId}/forms\\?template=`));
    const templateId = new URL(page.url()).searchParams.get("template"); requireProof(UUID.test(templateId), "TEMPLATE_UI_ID_INVALID");
    stage = "UPLOAD_UI";
    await page.getByLabel("Файл университета", { exact: true }).setInputFiles({ name: "synthetic-template.pdf", mimeType: "application/pdf", buffer: bytes });
    await page.getByLabel("Откуда получен бланк", { exact: true }).fill("https://example.com/synthetic-template");
    await page.getByLabel("Дата получения", { exact: true }).fill("2026-09-14");
    const uploaded = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/source"));
    await page.getByRole("button", { name: "Загрузить файл", exact: true }).click();
    const request = await uploaded;
    const route = new URL(request.url()); const match = /^\/api\/v3\/university-forms\/([^/]+)\/versions\/([^/]+)\/source$/u.exec(route.pathname);
    requireProof(match?.[1] === templateId && UUID.test(match?.[2]) && route.origin === config.appOrigin
      && hash(request.postDataBuffer()) === sha256, "EXACT_UI_UPLOAD_INVALID");
    const versionId = match[2];
    await expect(page.getByRole("button", { name: "Проверить завершение загрузки", exact: true })).toBeVisible({ timeout: 100_000 });
    stage = "STATUS";
    const readStatus = async () => {
      const response = await context.request.get(`${route}/status`); requireProof(response.status() === 200, "TEMPLATE_STATUS_FAILED");
      return normalizeUniversityTemplateInspectionMetadata(await response.json(), templateId, versionId);
    };
    stage = "LOST_STORAGE_REPLY";
    const unknown = await readStatus();
    await expect.poll(lostReplyVerified, { timeout: 3000 }).toBe(true);
    assertUnknownTemplateOutcome(unknown, lostReplyVerified());
    await page.getByRole("button", { name: "Проверить завершение загрузки", exact: true }).click();
    await expect(page.getByRole("link", { name: "Открыть исходный файл", exact: true })).toBeVisible();
    const status = await readStatus(); requireProof(status.ingress?.state === "verified" && status.inspection === "verified"
      && status.manifest?.format === "pdf" && status.manifest.slots.length === 0 && status.manifest.pageSizes.length === 1, "TEMPLATE_NOT_VERIFIED");
    stage = "EXACT_REPLAY";
    const headers = request.headers(); const replay = await context.request.post(route.href, { data: bytes,
      headers: { origin: config.appOrigin, "content-type": "application/pdf", "if-match": headers["if-match"], "idempotency-key": headers["idempotency-key"] } });
    requireProof(replay.status() === 200, "EXACT_UPLOAD_REPLAY_FAILED");
    const replayed = normalizeUniversityTemplateIngressReceipt(await replay.json(), templateId, versionId);
    assertExactTemplateReplay(replayed, status);
    stage = "COLD_RESUME"; await page.goto(`${config.appOrigin}/v3/universities/${catalogId}/forms`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /Synthetic PDF blank/u }).click();
    await expect(page.getByRole("link", { name: "Открыть исходный файл", exact: true })).toBeVisible();
    stage = "GUARDED_SOURCE"; const source = await context.request.get(route.href);
    requireProof(source.status() === 200 && source.headers()["cache-control"] === "private, no-store" && hash(await source.body()) === sha256, "GUARDED_SOURCE_MISMATCH");
    const stored = await storage.storage.from("platform-document-templates").download(`${config.organizationId}/${templateId}/${versionId}.pdf`);
    requireProof(!stored.error && hash(Buffer.from(await stored.data.arrayBuffer())) === sha256, "PRIVATE_STORAGE_MISMATCH");
    stage = "IMMUTABLE_RECEIPT";
    const [fact] = await sql`SELECT count(*)::integer AS receipts,
      bool_and(r.source_sha256=${sha256} AND r.source_byte_size=${bytes.length} AND r.inspector_image_sha256=${images.productionImage}
      AND r.inspector_revision='evo-university-template-v1' AND a.runtime_revision=${images.revision} AND a.state='verified'
      AND a.scan_proof->>'sha256Hex'=${sha256}) AS valid
      FROM platform_private.university_form_inspection_receipts r JOIN platform_private.university_template_ingresses a ON a.inspection_receipt_id=r.id
      WHERE r.template_version_id=${versionId}::uuid AND r.organization_id=${config.organizationId}::uuid`;
    requireProof(fact.receipts === 1 && fact.valid === true, "IMMUTABLE_TEMPLATE_RECEIPT_INVALID");
    await page.screenshot({ path: resolve(config.evidenceDir, "template-ingress.png"), fullPage: true });
    const mapping = await proveUniversityTemplateMapping({ page, context, client, storage, config, catalogId,
      stage: value => { stage = value; } });
    requireProof(counts.error === 0, "BROWSER_RUNTIME_ERRORS");
    pending = { schema: "evo-university-template-ingress-acceptance/v1", synthetic: true, businessAcceptance: false,
      providerAcceptance: false, fullD4Acceptance: false, cleanupVerified: false,
      ...Object.fromEntries(TEMPLATE_PROOF_CHECKS.map(key => [key, true])), localProjectId: config.projectId,
      sourceSha256: sha256, sourceBytes: bytes.length, browserErrorCount: counts.error, browserWarningCount: counts.warning,
      images, runtimeIdentity: identity, mapping };
  } catch (error) {
    try { await writeFailureEvidence({ config, page: diagnosticPage, stage, error, http, browserErrors,
      browserWarningCount: counts.warning, counts }); }
    catch { process.stderr.write("UNIVERSITY_TEMPLATE_INGRESS_DIAGNOSTIC_UNAVAILABLE\n"); }
    const code = error instanceof ProofError ? error.code : stage;
    process.stderr.write(`UNIVERSITY_TEMPLATE_INGRESS_ERROR:${code}\n`); process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {}); client?.auth.stopAutoRefresh(); storage?.auth.stopAutoRefresh(); await sql?.end({ timeout: 5 }).catch(() => {});
    try { if (spec) { cleanupTemplateAcceptanceApp(spec.appName); appCleaned = true; } }
    catch { process.stderr.write("UNIVERSITY_TEMPLATE_INGRESS_APP_CLEANUP_FAILED\n"); process.exitCode = 1; }
    clearTimeout(timer);
  }
  if (pending && appCleaned && !process.exitCode) {
    validateTemplatePendingReceipt(pending, config.projectId);
    writeFileSync(resolve(config.evidenceDir, "acceptance.pending.json"), JSON.stringify(pending, null, 2), { mode: 0o600, flag: "wx" });
    process.stdout.write("UNIVERSITY_TEMPLATE_INGRESS_RECORDED\n");
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
