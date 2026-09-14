// TEST IMAGE ONLY. No serialized resolution can enter the production renderer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fillUniversityPdf, inspectUniversityPdf } from "../../src/lib/server/university-form-pdf.ts";
import { computeUniversityFormMappingHash, resolveUniversityFormMappings } from "../../src/lib/university-form-fields.ts";
import { renderCapturedUniversityPdf } from "./render-page.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const method of ["log", "warn", "error", "info", "debug"]) console[method] = () => {};
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
async function source() {
  const document = await PDFDocument.create();
  document.setCreationDate(new Date("2000-01-01T00:00:00Z")); document.setModificationDate(new Date("2000-01-01T00:00:00Z"));
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 2; index++) {
    const page = document.addPage([612, 792]);
    if (index) page.setCropBox(20, 30, 572, 732);
    page.drawText("SYNTHETIC UNIVERSITY - NOT AN APPLICATION", { x: 40, y: 720, size: 11, font });
    page.drawText("Name:", { x: 40, y: 662, size: 11, font });
    page.drawRectangle({ x: 160, y: 642, width: 350, height: 32, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
    page.drawText("Motivation:", { x: 40, y: 612, size: 11, font });
    page.drawRectangle({ x: 160, y: 382, width: 350, height: 240, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
    page.drawText("Applicant signature: ____________________", { x: 40, y: 300, size: 11, font });
    page.drawText("Consent / photo: complete manually", { x: 40, y: 270, size: 11, font });
  }
  return Buffer.from(await document.save({ useObjectStreams: false }));
}
async function reviewed(bytes, variant) {
  const inspection = await inspectUniversityPdf(bytes);
  const templateId = "20000000-0000-4000-8000-000000000001", mappingId = "20000000-0000-4000-8000-000000000002";
  const positions = [{ page: 1, x: 160, y: 118, width: 350, height: 32 }, { page: 1, x: 160, y: 170, width: 350, height: 240 },
    { page: 2, x: 140, y: 88, width: 350, height: 32 }, { page: 2, x: 140, y: 140, width: 350, height: 240 }];
  if (variant === "overflow") { positions[0].width = 12; positions[0].height = 12; }
  if (variant === "overlap") positions[1] = { ...positions[0] };
  if (variant === "out-of-bounds") positions[0].x = 610;
  const template = { versionId: templateId, format: "pdf", sha256: sha(bytes), pageSizes: inspection.pageSizes,
    slots: [] };
  const mapping = { versionId: mappingId, templateVersionId: templateId, templateSha256: sha(bytes),
    mappings: positions.map((position, i) => ({ slotId: `pdf-${i + 1}`, sourceKey: i % 2 ? "why_this_field" : "student_first_name", required: true, format: "text", manual: false, position })) };
  mapping.sha256 = await computeUniversityFormMappingHash(mapping);
  const review = { versionId: "20000000-0000-4000-8000-000000000003", templateVersionId: templateId, templateSha256: sha(bytes), mappingVersionId: mappingId, mappingSha256: mapping.sha256, state: "approved" };
  const value = "Engineering studies. Кыргызча: Ө Ү Ң ө ү ң. Русский текст. ";
  const profile = { fields: [{ key: "student_first_name", value: variant === "unsupported" ? "中文 Synthetic" : variant === "shaping" ? "q\u0301 Synthetic" : "Айлин Synthetic", state: "confirmed" },
    { key: "why_this_field", value: variant === "long" ? value.repeat(8).trim() : value.trim(), state: "confirmed" }] };
  return resolveUniversityFormMappings(freeze({ template, mapping, review, profile, today: "2026-09-14" }));
}
let metadata, png = Buffer.alloc(0), phase = "request";
try {
  const request = JSON.parse(readFileSync(0, "utf8"));
  assert.ok(request && Object.keys(request).sort().join(",") === "draft,page,variant");
  assert.ok([1, 2].includes(request.page) && typeof request.draft === "boolean");
  assert.ok(["original", "standard", "long", "unsupported", "shaping", "overflow", "overlap", "out-of-bounds"].includes(request.variant));
  phase = "source";
  const original = await source();
  phase = "fill";
  const bytes = request.variant === "original" ? original : await fillUniversityPdf(original, await reviewed(original, request.variant), { draft: request.draft });
  phase = "inspect";
  const inspected = await inspectUniversityPdf(bytes);
  phase = "raster";
  const result = await renderCapturedUniversityPdf(bytes, { expectedSha256: sha(bytes),
    expectedManifestDigest: sha(JSON.stringify({ format: "pdf", slots: [], pageSizes: inspected.pageSizes })), page: request.page });
  metadata = result.metadata; png = result.png;
} catch (error) {
  // Test-only fixed error assertion, never a source excerpt or production protocol expansion.
  const allowed = ["form_pdf_character_unsupported", "form_pdf_shaping_unsupported", "form_pdf_text_overflow", "form_pdf_positions_overlap", "form_pdf_position_invalid", "invalid_form_values", "invalid_mapping_snapshot", "form_pdf_mapping_mismatch", "form_pdf_font_unavailable"];
  metadata = allowed.includes(error?.code) ? { status: "test-rejected", code: error.code }
    : { status: "test-rejected", code: "unexpected_test_failure", phase, diagnostic: String(error).slice(0, 200) };
}
const json = Buffer.from(JSON.stringify(metadata)), header = Buffer.alloc(12);
header.write("EUP1"); header.writeUInt32BE(json.length, 4); header.writeUInt32BE(png.length, 8);
await new Promise((resolve, reject) => process.stdout.write(Buffer.concat([header, json, png]), error => error ? reject(error) : resolve()));
