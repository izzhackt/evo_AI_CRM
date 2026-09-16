// Extends the existing disposable D2 browser run. No provider calls or direct
// business-table writes: only the application fixture uses a canonical staff RPC.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import PizZip from "pizzip";
import { normalizeDocumentPackageExportReceipt, normalizeDocumentExportWorkspaceV2 } from "../../src/lib/document-export-artifacts.ts";
import { DOCUMENT_EXPORT_MIME, DOCUMENT_PACKAGE_MAX_BYTES, DOCUMENT_PACKAGE_MIME } from "../../src/lib/document-export-artifact-contract.ts";

const BUCKET = "platform-document-exports";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export class PackageProofError extends Error { constructor(code) { super(code); this.code = code; } }
function check(condition, code) { if (!condition) throw new PackageProofError(code); }
export function exportBucketMimeTypesValid(types) {
  return Array.isArray(types) && JSON.stringify([...types].sort())
    === JSON.stringify([DOCUMENT_EXPORT_MIME, "application/pdf", DOCUMENT_PACKAGE_MIME].sort());
}

/** Independent ZIP decoding, not the production renderer or its manifest builder. */
export function verifyPersistedPackageZip(bytes, receipt, sources) {
  check(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= DOCUMENT_PACKAGE_MAX_BYTES
    && receipt?.kind === "package" && receipt.state === "ready" && receipt.can_download
    && receipt.mode === "final" && receipt.mime_type === DOCUMENT_PACKAGE_MIME
    && receipt.output_bytes === bytes.length && receipt.output_sha256 === sha256(bytes), "PACKAGE_OUTPUT_MISMATCH");
  check(Array.isArray(sources) && sources.length === receipt.package.item_count && sources.length > 0
    && new Set(sources.map(source => source.id)).size === sources.length
    && sources.every(source => UUID.test(source.id) && source.kind === "generated" && source.mode === "final"
      && Buffer.isBuffer(source.bytes) && source.bytes.length > 0), "PACKAGE_SELECTION_INVALID");
  let zip; let manifest;
  try { zip = new PizZip(bytes); manifest = JSON.parse(zip.file("manifest.json").asText()); }
  catch { throw new PackageProofError("PACKAGE_ZIP_INVALID"); }
  const paths = sources.map(source => `generated/${source.id}.docx`);
  check(JSON.stringify(Object.keys(zip.files).sort()) === JSON.stringify([...paths, "manifest.json", "README.txt"].sort()),
    "PACKAGE_ENTRIES_CHANGED");
  check(manifest.schemaVersion === 1 && manifest.rendererVersion === "evo-partner-packet-zip-v1"
    && manifest.packetId === receipt.package.id && manifest.studentCaseId === receipt.student_case_id
    && manifest.inputSha256 === receipt.input_snapshot_sha256 && manifest.mode === "final"
    && Array.isArray(manifest.items) && manifest.items.length === sources.length, "PACKAGE_MANIFEST_MISMATCH");
  for (const source of sources) {
    const path = `generated/${source.id}.docx`;
    const rows = manifest.items.filter(item => item.id === source.id);
    check(rows.length === 1 && rows[0].kind === "generated" && rows[0].mode === "final"
      && rows[0].path === path && rows[0].mimeType === DOCUMENT_EXPORT_MIME
      && rows[0].sizeBytes === source.bytes.length && rows[0].sha256 === sha256(source.bytes), "PACKAGE_MANIFEST_SOURCE_MISMATCH");
    check(zip.file(path).asNodeBuffer().equals(source.bytes), "PACKAGE_ENTRY_BYTES_CHANGED");
  }
  check(zip.file("README.txt").asText().includes("This is not a submission or delivery receipt.")
    && !zip.file("README.txt").asText().includes("DRAFT"), "PACKAGE_FINAL_LABEL_INVALID");
  return { sha256: sha256(bytes), bytes: bytes.length, selectedEntries: sources.length,
    selectedEntryBytesVerified: true, finalExcludesDraft: true };
}

export function verifyPackageStorage(bytes, receipt, stored, organizationId) {
  check(stored?.id === receipt.id && stored.organization_id === organizationId
    && stored.student_case_id === receipt.student_case_id && stored.kind === "package" && stored.state === "ready"
    && stored.receipt_id === receipt.receipt_id && stored.package_id === receipt.package.id
    && stored.application_id === receipt.package.application_id && stored.mode === receipt.mode
    && stored.mime_type === DOCUMENT_PACKAGE_MIME && stored.workspace_revision === receipt.workspace_revision
    && stored.input_snapshot_sha256 === receipt.input_snapshot_sha256, "PACKAGE_STORED_RECEIPT_MISMATCH");
  check(stored.bucket_id === BUCKET && stored.bucket_public === false
    && Number(stored.bucket_limit) === DOCUMENT_PACKAGE_MAX_BYTES && exportBucketMimeTypesValid(stored.bucket_mimes)
    && UUID.test(stored.storage_object_id) && stored.object_name === `${organizationId}/${receipt.student_case_id}/${receipt.id}.zip`,
  "PACKAGE_PRIVATE_STORAGE_INVALID");
  check(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= DOCUMENT_PACKAGE_MAX_BYTES
    && bytes.length === receipt.output_bytes && bytes.length === Number(stored.output_bytes)
    && sha256(bytes) === receipt.output_sha256 && sha256(bytes) === stored.output_sha256, "PACKAGE_STORED_BYTES_MISMATCH");
}

export async function provePersistedPackage({ browser, page, client, storage, sql, config, caseId,
  finalReceipt, draftReceipt, inventory, onStage, onPage, onBrowserError, onBrowserWarning }) {
  const rpc = async (name, args) => {
    const result = await client.schema("platform").rpc(name, args);
    check(!result.error, "PACKAGE_CANONICAL_FIXTURE_FAILED"); return result.data;
  };
  const workspace = () => rpc("partner_packet_workspace_v2", { p_case_id: caseId });
  onStage("PACKAGE_APPLICATION_FIXTURE");
  const application = await rpc("create_university_application", { p_organization_id: config.organizationId,
    p_student_case_id: caseId, p_institution_name: "Synthetic ZIP University", p_program_name: "Synthetic Computer Science",
    p_status: "preparation", p_evidence_reference: null, p_note: "Fictional isolated ZIP proof; no real submission",
    p_is_primary: false, p_university_deadline_on: null, p_country: null, p_degree: null,
    p_expected_version: 0, p_request_id: randomUUID() });
  check(UUID.test(application?.university_application_id) && Number(application.version) === 1, "PACKAGE_APPLICATION_INVALID");
  const applicationId = application.university_application_id;
  const before = await inventory();
  const initial = await workspace();
  check(initial.packets.length === 0 && initial.generatedExports.some(file => file.id === finalReceipt.id && file.mode === "final")
    && !initial.generatedExports.some(file => file.id === draftReceipt.id), "PACKAGE_SELECTION_BASELINE_INVALID");
  const packetUrl = `${config.appOrigin}/v3/profile?case=${caseId}&tab=route`;
  const exportUrl = `${config.appOrigin}/api/v3/student-cases/${caseId}/document-exports`;
  onStage("PACKAGE_UI_PREPARATION");
  const documentResponse = await page.goto(packetUrl, { waitUntil: "domcontentloaded" });
  onStage("PACKAGE_SSR_PREPARATION_CONTROLS");
  check(documentResponse?.status() === 200, "PACKAGE_SSR_DOCUMENT_UNAVAILABLE");
  // Inspect the actual document only in memory; never retain HTML or field values.
  const documentHtml = await documentResponse.text();
  const form = documentHtml.match(/<details\b[^>]*\bid="partner-packets"[\s\S]*?<form\b[^>]*>([\s\S]*?)<\/form>/u)?.[1];
  const fieldset = form?.match(/<fieldset\b([^>]*)>([\s\S]*?)<\/fieldset>/u);
  const save = form?.match(/<button\b([^>]*)>Зафиксировать пакет<\/button>/u);
  const disabled = attributes => typeof attributes === "string" && /(?:^|\s)disabled(?:\s|=|$)/u.test(attributes);
  check(fieldset && /<select\b/u.test(fieldset[2]) && /<input\b[^>]*type="checkbox"/u.test(fieldset[2])
    && save, "PACKAGE_SSR_PREPARATION_FORM_MISSING");
  check(disabled(fieldset[1]) && disabled(save[1]), "PACKAGE_SSR_CONTROLS_NOT_DISABLED");
  const panel = page.locator("#partner-packets");
  onStage("PACKAGE_UI_OPEN_PANEL");
  await panel.locator(":scope > summary").click();
  onStage("PACKAGE_UI_SELECT_APPLICATION");
  const applicationSelect = panel.getByRole("combobox", { name: "Заявление", exact: true });
  await applicationSelect.selectOption(applicationId);
  await expect(applicationSelect).toHaveValue(applicationId);
  onStage("PACKAGE_UI_SELECT_FINAL");
  await panel.getByRole("checkbox", { name: /Анкета студента · Word · Финальный/u }).check();
  await expect(panel.getByRole("checkbox", { name: /Анкета студента · Word · Черновик/u })).toHaveCount(0);
  onStage("PACKAGE_UI_SAVE_CLICK");
  await panel.getByRole("button", { name: "Зафиксировать пакет", exact: true }).click();
  onStage("PACKAGE_UI_SAVE_READBACK");
  await expect.poll(async () => (await workspace()).packets.length).toBe(1);
  const packet = (await workspace()).packets[0];
  check(packet.applicationId === applicationId && packet.files.length === 0 && packet.generatedExports.length === 1
    && packet.generatedExports[0].id === finalReceipt.id, "PACKAGE_UI_SELECTION_CHANGED");
  const packetDetails = panel.locator("details").filter({ hasText: packet.id });
  onStage("PACKAGE_UI_OPEN_SAVED_COMPOSITION");
  await expect(packetDetails).toHaveCount(1);
  await packetDetails.locator(":scope > summary").click();
  onStage("PACKAGE_UI_GENERATION");
  let automaticDownload = false;
  const observeDownload = () => { automaticDownload = true; };
  page.on("download", observeDownload);
  const [response] = await Promise.all([
    page.waitForResponse(result => result.url() === exportUrl && result.request().method() === "POST"),
    packetDetails.getByRole("button", { name: "Сохранить финальный ZIP", exact: true }).click(),
  ]);
  check(response.status() === 200, "PACKAGE_UI_GENERATION_FAILED");
  const receipt = normalizeDocumentPackageExportReceipt((await response.json()).artifact, caseId);
  check(receipt.state === "ready" && receipt.can_download && receipt.mode === "final"
    && receipt.package.id === packet.id && receipt.package.application_id === applicationId
    && receipt.package.item_count === 1 && receipt.workspace_revision === packet.revision, "PACKAGE_UI_RECEIPT_INVALID");
  const row = target => target.locator('#partner-packets [aria-label="Сохранённые файлы"]').getByRole("listitem")
    .filter({ hasText: "Пакет документов · ZIP · Финальный" });
  await expect(row(page)).toHaveCount(1);
  await expect(row(page).getByText(/ · Сохранён$/u)).toBeVisible();
  page.off("download", observeDownload);
  check(!automaticDownload, "PACKAGE_GENERATION_AUTO_DOWNLOADED");
  const after = await inventory();
  check(after.artifacts.length === before.artifacts.length + 1 && after.objects.length === before.objects.length + 1,
    "PACKAGE_GENERATION_COUNT_INVALID");
  const sources = [{ id: finalReceipt.id, kind: "generated", mode: "final", bytes: readFileSync(resolve(config.evidenceDir, "final.docx")) }];
  const download = async (target, currentReceipt, filename) => {
    const unchanged = await inventory();
    const [file] = await Promise.all([target.waitForEvent("download"), row(target).getByRole("button", { name: "Скачать файл", exact: true }).click()]);
    check(await file.failure() === null, "PACKAGE_BROWSER_DOWNLOAD_FAILED");
    const bytes = readFileSync(await file.path());
    const proof = verifyPersistedPackageZip(bytes, currentReceipt, sources);
    const [stored] = await sql`SELECT artifact.*, object.id AS storage_object_id, bucket.public AS bucket_public,
        bucket.file_size_limit AS bucket_limit, bucket.allowed_mime_types AS bucket_mimes
      FROM platform_private.document_export_artifacts AS artifact
      JOIN storage.objects AS object ON object.bucket_id = artifact.bucket_id AND object.name = artifact.object_name
      JOIN storage.buckets AS bucket ON bucket.id = object.bucket_id
      WHERE artifact.id = ${receipt.id}::uuid AND artifact.organization_id = ${config.organizationId}::uuid
        AND artifact.student_case_id = ${caseId}::uuid`;
    verifyPackageStorage(bytes, currentReceipt, stored, config.organizationId);
    const storedResponse = await storage.from(BUCKET).download(stored.object_name);
    check(!storedResponse.error && storedResponse.data, "PACKAGE_STORAGE_READBACK_FAILED");
    const storedBytes = Buffer.from(await storedResponse.data.arrayBuffer());
    verifyPackageStorage(storedBytes, currentReceipt, stored, config.organizationId);
    check(storedBytes.equals(bytes), "PACKAGE_DOWNLOAD_BYTES_CHANGED");
    const [grant] = await sql`SELECT count(*)::integer AS verified FROM platform_private.document_export_download_grants
      WHERE artifact_id = ${receipt.id}::uuid AND consumed_at IS NOT NULL AND completion ->> 'verified' = 'true'`;
    check(grant.verified > 0, "PACKAGE_DOWNLOAD_NOT_VERIFIED");
    check(JSON.stringify(await inventory()) === JSON.stringify(unchanged), "PACKAGE_DOWNLOAD_CHANGED_HISTORY");
    writeFileSync(resolve(config.evidenceDir, filename), bytes, { mode: 0o600, flag: "wx" });
    return proof;
  };
  onStage("PACKAGE_STORAGE_DOWNLOAD");
  const proof = await download(page, receipt, "package.zip");
  // Independent context: no copied cookies/local storage or API-created browser session.
  const freshContext = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  let freshComplete = false;
  try {
    await freshContext.route("**/*", route => [config.appOrigin, config.apiOrigin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const fresh = await freshContext.newPage(); fresh.setDefaultTimeout(30_000); onPage(fresh);
    fresh.on("pageerror", error => onBrowserError("page", error.stack ?? error.message));
    fresh.on("console", message => { if (message.type() === "error") onBrowserError("console", message.text(), message.location()); if (message.type() === "warning") onBrowserWarning(); });
    onStage("PACKAGE_FRESH_LOGIN");
    await fresh.goto(`${config.appOrigin}/login`, { waitUntil: "domcontentloaded" });
    await fresh.locator("#staff-email").fill(config.email);
    await fresh.locator("#staff-password").fill(config.password);
    await fresh.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await expect(fresh.getByTestId("v3-shell")).toHaveAttribute("data-system-role", "admin");
    await expect(fresh.getByTestId("v3-shell")).toHaveAttribute("data-presentation-role", "actual");
    onStage("PACKAGE_COLD_HISTORY");
    const [historyResponse] = await Promise.all([
      fresh.waitForResponse(result => result.url() === `${exportUrl}?schema_version=2` && result.request().method() === "GET"),
      fresh.goto(packetUrl, { waitUntil: "domcontentloaded" }),
    ]);
    check(historyResponse.status() === 200, "PACKAGE_COLD_HISTORY_FAILED");
    const history = normalizeDocumentExportWorkspaceV2(await historyResponse.json(), caseId);
    check(history.artifacts.length === 3 && history.artifacts.filter(item => item.kind === "student_profile").length === 2
      && history.artifacts.filter(item => item.kind === "package").length === 1, "PACKAGE_COLD_HISTORY_COUNT_INVALID");
    const saved = history.artifacts.find(item => item.id === receipt.id);
    check(saved?.kind === "package" && saved.state === "ready" && saved.can_download
      && saved.receipt_id === receipt.receipt_id && saved.output_sha256 === receipt.output_sha256
      && saved.output_bytes === receipt.output_bytes, "PACKAGE_COLD_RECEIPT_CHANGED");
    await fresh.locator("#partner-packets > summary").click();
    const coldProof = await download(fresh, saved, "package-history.zip");
    check(coldProof.sha256 === proof.sha256 && JSON.stringify(await inventory()) === JSON.stringify(after), "PACKAGE_COLD_HISTORY_CHANGED");
    await expect(fresh.locator("[data-nextjs-dialog-overlay], [data-nextjs-error-dialog]")).toHaveCount(0);
    await fresh.screenshot({ path: resolve(config.evidenceDir, "package-history.png"), fullPage: true });
    freshComplete = true;
  } finally {
    // On failure leave this page alive for the parent's bounded failure evidence;
    // the existing outer browser cleanup still closes every context afterwards.
    if (freshComplete) { onPage(page); await freshContext.close(); }
  }
  return { ...proof, realUiPreparation: true, realUiGeneration: true, privateStorageReadback: true,
    freshLoginHistorySameBytes: true, downloadsCreateNoArtifacts: true };
}
