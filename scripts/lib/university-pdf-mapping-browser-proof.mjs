// Actual PDF editor continuation inside the same owned Auth/Storage/native stack.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { getPlatformUniversityFormWorkspace } from "../../src/lib/platform-university-forms.ts";
import { parseUniversityTemplatePageMetadata } from "../../src/lib/university-template-page.ts";
import { requireProof } from "./student-profile-fields-browser-proof.mjs";
import { TEMPLATE_PDF_MAPPING_CHECKS, validateTemplatePdfMappingProof } from "./university-template-mapping-evidence.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export async function proveUniversityPdfMapping({ page, context, client, config, catalogId, templateId, versionId, status, sourceBytes, stage }) {
  const base = `${config.appOrigin}/v3/universities/${catalogId}/forms?template=${templateId}&version=${versionId}`;
  const source = `${config.appOrigin}/api/v3/university-forms/${templateId}/versions/${versionId}/source`;
  stage("PDF_PAGE_HTTP");
  const response = await context.request.get(`${source}/page?page=1`), headers = response.headers();
  requireProof(response.status() === 200 && headers["content-type"] === "image/png" && headers["cache-control"] === "private, no-store", "PDF_PAGE_READ_FAILED");
  const metadata = parseUniversityTemplatePageMetadata(JSON.parse(headers["x-evo-template-page"]), {
    sha256: status.template_sha256, byteLength: sourceBytes, manifestDigest: hash(JSON.stringify(status.manifest)), page: 1, pageSizes: status.manifest.pageSizes,
  });
  const png = await response.body();
  requireProof(metadata && metadata.pngSha256 === hash(png) && metadata.pngByteLength === png.length, "PDF_PAGE_BINDING_FAILED");
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(base); requireProof((await page.title()).trim().length > 0, "PDF_TITLE_MISSING");
  await expect(page.getByRole("heading", { name: "Бланки университета", exact: true })).toBeVisible();
  const image = () => page.getByRole("img", { name: "Страница 1", exact: true });
  await expect(image()).toBeVisible();
  stage("PDF_POINTER_REGION");
  await page.getByRole("button", { name: "Выделить область", exact: true }).click();
  const box = await image().boundingBox(); requireProof(box?.width > 0 && box.height > 0, "PDF_IMAGE_BOX_MISSING");
  const p = (x, y) => ({ x: box.x + x * box.width / 612, y: box.y + y * box.height / 792 });
  const start = p(72, 240), end = p(272, 270);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
  await expect(page.getByLabel("Данные из анкеты", { exact: true })).toBeVisible();
  await page.getByLabel("Данные из анкеты", { exact: true }).selectOption("student_first_name");
  await page.getByLabel("Обязательное поле", { exact: true }).check();
  stage("PDF_NUMERIC_KEYBOARD");
  await page.locator("summary").filter({ hasText: "Точное положение и размер" }).click();
  for (const [label, value] of [["Слева", "80"], ["Сверху", "240"], ["Ширина", "200"], ["Высота", "30"]]) await page.getByLabel(label, { exact: true }).fill(value);
  const region = () => page.getByRole("button", { name: "Поле 1: Имя", exact: true });
  await region().focus(); await region().press("ArrowRight");
  await expect(page.getByLabel("Слева", { exact: true })).toHaveValue("81");
  async function geometry() {
    const [a, b] = await Promise.all([image().boundingBox(), region().boundingBox()]);
    requireProof(a && b && Math.abs((b.x - a.x) * 612 / a.width - 81) < 0.2
      && Math.abs((b.y - a.y) * 792 / a.height - 240) < 0.2
      && Math.abs(b.width * 612 / a.width - 200) < 0.2, "PDF_OVERLAY_GEOMETRY_CHANGED");
  }
  await page.getByLabel("Масштаб", { exact: true }).selectOption("150"); await geometry();
  await page.getByLabel("Масштаб", { exact: true }).selectOption("100");
  stage("PDF_PAGE_NAVIGATION");
  await page.getByLabel("Страница", { exact: true }).selectOption("2");
  await expect(page.getByRole("img", { name: "Страница 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Добавить поле без мыши", exact: true }).click();
  await page.getByLabel("Данные из анкеты", { exact: true }).selectOption("date_of_birth");
  await page.getByLabel("Формат даты", { exact: true }).selectOption("DD.MM.YYYY");
  await page.getByLabel("Поле", { exact: true }).selectOption("pdf-1");
  await expect(image()).toBeVisible(); await expect(page.getByLabel("Слева", { exact: true })).toHaveValue("81"); await geometry();
  await page.screenshot({ path: resolve(config.evidenceDir, "pdf-mapping-desktop.png"), fullPage: true });
  stage("PDF_MAPPING_SAVE"); await page.getByRole("button", { name: "Сохранить настройку", exact: true }).click();
  await expect(page.getByText("Настройка сохранена. Следующий шаг — сверка полей с бланком.", { exact: true })).toBeVisible();
  const workspace = () => getPlatformUniversityFormWorkspace(client, { p_template_id: templateId, p_version_id: versionId });
  const saved = await workspace(), mapping = saved.mappings[0], fields = mapping?.mappings;
  requireProof(fields?.length === 2 && fields[0].position?.x === 81 && fields[0].position?.y === 240
    && fields[0].position?.width === 200 && fields[0].sourceKey === "student_first_name" && fields[0].required
    && fields[1].position?.page === 2 && fields[1].sourceKey === "date_of_birth" && fields[1].format === "DD.MM.YYYY"
    && mapping.review === null && saved.publication === null, "PDF_MAPPING_SAVE_MISMATCH");
  stage("PDF_READ_ONLY_REVIEW"); await page.getByRole("link", { name: "Открыть обновлённый бланк", exact: true }).click();
  await expect(image()).toBeVisible(); await expect(page.getByLabel("Данные из анкеты", { exact: true })).toBeDisabled(); await geometry();
  await expect(page.getByRole("button", { name: "Проверить настройку", exact: true })).toBeDisabled();
  await page.getByLabel("Я сверил поля с исходным бланком", { exact: true }).check();
  await page.getByRole("button", { name: "Проверить настройку", exact: true }).click();
  await expect(page.getByText("Результат проверки сохранён.", { exact: true })).toBeVisible();
  const reviewed = await workspace(); requireProof(reviewed.mappings[0].review?.decision === "approved" && reviewed.publication === null, "PDF_REVIEW_AUTO_PUBLISHED");
  stage("PDF_PUBLICATION"); await page.getByRole("link", { name: "Открыть обновлённый бланк", exact: true }).click();
  await expect(image()).toBeVisible(); await expect(page.getByLabel("Данные из анкеты", { exact: true })).toBeDisabled(); await geometry();
  await expect(page.getByRole("button", { name: "Разрешить заполнение", exact: true })).toBeDisabled();
  await page.getByLabel("Использовать эту настройку для заполнения бланка", { exact: true }).check();
  await page.getByRole("button", { name: "Разрешить заполнение", exact: true }).click();
  await expect(page.getByText("Бланк доступен для заполнения.", { exact: true })).toBeVisible();
  const published = await workspace(); requireProof(published.publication?.mapping_id === mapping.id && published.publication.mapping_sha256 === mapping.sha256
    && published.publication.review_id === reviewed.mappings[0].review.id, "PDF_PUBLICATION_BINDING_FAILED");
  stage("PDF_MOBILE_COLD_RESUME"); await page.setViewportSize({ width: 393, height: 852 }); await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect(image()).toBeVisible(); await geometry();
  requireProof(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "PDF_MOBILE_OVERFLOW");
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  await page.screenshot({ path: resolve(config.evidenceDir, "pdf-mapping-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  return validateTemplatePdfMappingProof({ templateId, versionId, mappingId: mapping.id, sourceSha256: status.template_sha256,
    mappingSha256: mapping.sha256, pagePngSha256: metadata.pngSha256, pageCount: 2,
    ...Object.fromEntries(TEMPLATE_PDF_MAPPING_CHECKS.map(key => [key, true])),
    generatedFormAcceptance: false, fullD4Acceptance: false, businessAcceptance: false });
}
