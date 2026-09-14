// Extends the existing real local ingress run; never starts another stack.
// Browser plugin not available: use the repository's existing Playwright flow.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import PizZip from "pizzip";
import { requireProof } from "./student-profile-fields-browser-proof.mjs";
import { getPlatformUniversityFormWorkspace, getPlatformPublishedUniversityForms,
  getPlatformUniversityTemplateInspection } from "../../src/lib/platform-university-forms.ts";
import { parseUniversityTemplateSourcePreview } from "../../src/lib/university-template-preview.ts";
import { validateTemplateMappingProof } from "./university-template-mapping-evidence.mjs";

const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

/** Actual inert DOCX bytes, not an inspection or rendered-result fixture. */
export function syntheticMappingDocx() {
  const zip = new PizZip();
  const paragraphs = ["Name: ____", ...Array.from({ length: 10 }, (_, index) => `Reference ${index + 1}: ____`),
    "Date of birth: ____", "Signature: ____"];
  const parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  };
  for (const [name, content] of Object.entries(parts)) zip.file(name, content, { date: new Date("2020-01-01T00:00:00Z"), createFolders: false });
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** UI -> real Auth/RPC/native/Storage -> cold publication readback. No providers. */
export async function proveUniversityTemplateMapping({ page, context, client, storage, config, catalogId, stage }) {
  const bytes = syntheticMappingDocx(), sha256 = hash(bytes);
  const base = `${config.appOrigin}/v3/universities/${catalogId}/forms`;
  stage("DOCX_CREATE_UI");
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(base);
  requireProof((await page.title()).trim().length > 0, "DOCX_PAGE_TITLE_MISSING");
  await expect(page.getByRole("heading", { name: "Бланки университета", exact: true })).toBeVisible();
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  await page.getByRole("link", { name: "Добавить бланк", exact: true }).click();
  await page.getByLabel("Название бланка", { exact: true }).fill("Synthetic DOCX mapping blank");
  await page.getByRole("button", { name: "Создать бланк", exact: true }).click();
  await page.getByRole("link", { name: "Загрузить файл", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === new URL(base).pathname
    && UUID.test(url.searchParams.get("template")));
  const templateId = new URL(page.url()).searchParams.get("template");
  requireProof(UUID.test(templateId), "DOCX_TEMPLATE_ID_INVALID");
  stage("DOCX_UPLOAD_UI");
  await page.getByLabel("Файл университета", { exact: true }).setInputFiles({ name: "synthetic-mapping.docx", mimeType: MIME, buffer: bytes });
  await page.getByLabel("Откуда получен бланк", { exact: true }).fill("https://example.com/synthetic-mapping");
  await page.getByLabel("Дата получения", { exact: true }).fill("2026-09-14");
  const upload = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/source"));
  await page.getByRole("button", { name: "Загрузить файл", exact: true }).click();
  const request = await upload, route = new URL(request.url());
  const match = /^\/api\/v3\/university-forms\/([^/]+)\/versions\/([^/]+)\/source$/u.exec(route.pathname);
  requireProof(route.origin === config.appOrigin && match?.[1] === templateId && UUID.test(match?.[2])
    && hash(request.postDataBuffer()) === sha256, "DOCX_UPLOAD_BYTES_CHANGED");
  const versionId = match[2];
  await expect(page.getByRole("link", { name: "Открыть исходный файл", exact: true })).toBeVisible({ timeout: 100_000 });
  const inspection = await getPlatformUniversityTemplateInspection(client, { p_template_id: templateId, p_template_version_id: versionId });
  requireProof(inspection.inspection === "verified" && inspection.template_sha256 === sha256 && inspection.manifest?.format === "docx"
    && inspection.manifest.slots.length === 13 && inspection.manifest.slots[12].editable === false, "DOCX_INSPECTION_INVALID");
  const stored = await storage.storage.from("platform-document-templates").download(`${config.organizationId}/${templateId}/${versionId}.docx`);
  requireProof(!stored.error && hash(Buffer.from(await stored.data.arrayBuffer())) === sha256, "DOCX_STORAGE_BYTES_CHANGED");
  stage("DOCX_NATIVE_PREVIEW");
  const manifestDigest = hash(JSON.stringify(inspection.manifest));
  for (const offset of [0, 10]) {
    const response = await context.request.get(`${route.href}/preview?offset=${offset}`);
    requireProof(response.status() === 200 && response.headers()["cache-control"] === "private, no-store", "DOCX_PREVIEW_READ_FAILED");
    const preview = parseUniversityTemplateSourcePreview(await response.json(), { sha256, byteLength: bytes.length,
      manifestDigest, offset, slots: inspection.manifest.slots });
    requireProof(preview && preview.totalSlots === 13 && preview.slots[0].id === `p-${offset + 1}`, "DOCX_PREVIEW_BINDING_FAILED");
  }
  stage("DOCX_MAPPING_UI");
  const workspaceUrl = `${base}?template=${templateId}&version=${versionId}`;
  await page.goto(workspaceUrl, { waitUntil: "domcontentloaded" });
  const row = text => page.getByLabel("Фрагменты исходного бланка", { exact: true }).getByText(text, { exact: true }).locator("..");
  await row("Name: ____").getByLabel("Данные из анкеты", { exact: true }).selectOption("student_first_name");
  await row("Name: ____").getByLabel("Обязательное поле", { exact: true }).check();
  await page.getByRole("button", { name: "Следующие фрагменты", exact: true }).click();
  await row("Date of birth: ____").getByLabel("Данные из анкеты", { exact: true }).selectOption("date_of_birth");
  await row("Date of birth: ____").getByLabel("Формат даты", { exact: true }).selectOption("DD.MM.YYYY");
  const signature = row("Signature: ____").getByLabel("Данные из анкеты", { exact: true });
  await expect(signature.locator("option")).toHaveCount(2);
  await signature.selectOption("manual");
  await page.getByRole("button", { name: "Предыдущие фрагменты", exact: true }).click();
  await expect(row("Name: ____").getByLabel("Данные из анкеты", { exact: true })).toHaveValue("student_first_name");
  await expect(row("Name: ____").getByLabel("Обязательное поле", { exact: true })).toBeChecked();
  await page.screenshot({ path: resolve(config.evidenceDir, "template-mapping-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Сохранить настройку", exact: true }).click();
  await expect(page.getByText("Настройка сохранена. Следующий шаг — сверка полей с бланком.", { exact: true })).toBeVisible();
  const workspace = () => getPlatformUniversityFormWorkspace(client, { p_template_id: templateId, p_version_id: versionId });
  const saved = await workspace(), mapping = saved.mappings[0];
  requireProof(mapping?.mappings.length === 3 && mapping.review === null && saved.publication === null, "DOCX_MAPPING_NOT_SAVED");
  const selected = Object.fromEntries(mapping.mappings.map(field => [field.slotId, field]));
  requireProof(selected["p-1"]?.sourceKey === "student_first_name" && selected["p-1"].required
    && selected["p-12"]?.sourceKey === "date_of_birth" && selected["p-12"].format === "DD.MM.YYYY"
    && selected["p-13"]?.manual && selected["p-13"].sourceKey === null, "DOCX_MAPPING_VALUES_CHANGED");
  stage("DOCX_REVIEW_UI");
  await page.getByRole("link", { name: "Открыть обновлённый бланк", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Сохранённые поля и исходный бланк", exact: true })).toBeVisible();
  await expect(row("Name: ____")).toContainText("Имя");
  await page.getByRole("button", { name: "Следующие фрагменты", exact: true }).click();
  await expect(row("Date of birth: ____")).toContainText("31.12.2026");
  await expect(row("Signature: ____")).toContainText("Вручную");
  await expect(page.getByRole("button", { name: "Проверить настройку", exact: true })).toBeDisabled();
  await page.getByLabel("Я сверил поля с исходным бланком", { exact: true }).check();
  await page.getByRole("button", { name: "Проверить настройку", exact: true }).click();
  await expect(page.getByText("Результат проверки сохранён.", { exact: true })).toBeVisible();
  const reviewed = await workspace();
  requireProof(reviewed.mappings[0].id === mapping.id && reviewed.mappings[0].review?.decision === "approved"
    && reviewed.publication === null, "DOCX_REVIEW_AUTO_PUBLISHED");
  stage("DOCX_PUBLICATION_UI");
  await page.getByRole("link", { name: "Открыть обновлённый бланк", exact: true }).click();
  await expect(row("Name: ____")).toContainText("Имя");
  await expect(page.getByRole("button", { name: "Разрешить заполнение", exact: true })).toBeDisabled();
  await page.getByLabel("Использовать эту настройку для заполнения бланка", { exact: true }).check();
  await page.getByRole("button", { name: "Разрешить заполнение", exact: true }).click();
  await expect(page.getByText("Бланк доступен для заполнения.", { exact: true })).toBeVisible();
  await page.goto(workspaceUrl, { waitUntil: "domcontentloaded" });
  const published = await workspace();
  requireProof(published.publication?.mapping_id === mapping.id && published.publication.mapping_sha256 === mapping.sha256
    && published.publication.review_id === reviewed.mappings[0].review.id && published.publication.template_sha256 === sha256,
  "DOCX_PUBLICATION_BINDING_FAILED");
  const available = await getPlatformPublishedUniversityForms(client, { p_catalog_institution_id: catalogId });
  requireProof(available.items.some(item => item.id === templateId && item.publication.mapping_id === mapping.id), "DOCX_PUBLISHED_LIST_MISSING");
  stage("DOCX_MOBILE_RESUME");
  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole("link", { name: "Настроить поля", exact: true }).click();
  await expect(row("Name: ____").getByLabel("Данные из анкеты", { exact: true })).toHaveValue("student_first_name");
  requireProof(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "DOCX_MOBILE_OVERFLOW");
  await page.screenshot({ path: resolve(config.evidenceDir, "template-mapping-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  stage("DOCX_ARCHIVE_HISTORY");
  await page.goto(workspaceUrl, { waitUntil: "domcontentloaded" });
  await expect(row("Name: ____")).toContainText("Имя");
  await page.locator("summary").filter({ hasText: "Убрать бланк в архив" }).click();
  await expect(page.getByRole("button", { name: "Убрать бланк в архив", exact: true })).toBeDisabled();
  await page.getByLabel("Убрать бланк из доступных для заполнения", { exact: true }).check();
  await page.getByRole("button", { name: "Убрать бланк в архив", exact: true }).click();
  await expect(page.getByText("Бланк перемещён в архив.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Открыть обновлённый бланк", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic DOCX mapping blank", exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: "История настроек" }).click();
  await page.locator(`a[href$="&mapping=${mapping.id}"]`).click();
  const archived = await workspace();
  requireProof(archived.template.archived && !archived.can_manage && archived.publication === null
    && archived.mappings.some(item => item.id === mapping.id), "ARCHIVED_MAPPING_HISTORY_LOST");
  await expect(page.getByRole("button", { name: "Разрешить заполнение", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Открыть исходный файл", exact: true })).toHaveCount(0);
  const archivedSource = await context.request.get(route.href);
  requireProof(archivedSource.status() === 409, "ARCHIVED_SOURCE_ACCESS_NOT_REJECTED");
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  return validateTemplateMappingProof({ templateId, versionId, mappingId: mapping.id,
    sourceSha256: sha256, sourceBytes: bytes.length, mappingSha256: mapping.sha256,
    actualDocxUpload: true, actualSourcePreview: true, actualMappingSave: true, actualReadOnlyReview: true, actualExplicitReview: true,
    actualExplicitPublication: true, coldResume: true, responsiveScreenshots: true, archivedHistoryReadable: true,
    pageIdentityVerified: true, noFrameworkOverlay: true,
    generatedFormAcceptance: false, fullD4Acceptance: false, businessAcceptance: false });
}
