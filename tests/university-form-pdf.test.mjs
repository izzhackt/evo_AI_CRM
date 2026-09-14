import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { inspectUniversityPdf, fillUniversityPdf } from "../src/lib/server/university-form-pdf.ts";
import { computeUniversityFormMappingHash, resolveUniversityFormMappings } from "../src/lib/university-form-fields.ts";

const templateId = "20000000-0000-4000-8000-000000000001";
const mappingId = "20000000-0000-4000-8000-000000000002";
const reviewId = "20000000-0000-4000-8000-000000000003";
async function fixture({ interactive = false, rotation = 0 } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date("2000-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2000-01-01T00:00:00Z"));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 2; index++) {
    const page = pdf.addPage([612, 792]);
    if (index === 1) page.setCropBox(20, 30, 572, 732);
    page.drawText("SYNTHETIC UNIVERSITY FORM - NOT AN APPLICATION", { x: 40, y: 720, size: 11, font });
    page.drawText("Name:", { x: 40, y: 662, size: 11, font });
    page.drawRectangle({ x: 160, y: 642, width: 350, height: 32, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
    page.drawText("Study motivation:", { x: 40, y: 612, size: 11, font });
    page.drawRectangle({ x: 160, y: 382, width: 350, height: 240, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
    page.drawText("Applicant signature: ____________________", { x: 40, y: 300, size: 11, font });
    page.drawText("Consent and photo: complete manually", { x: 40, y: 270, size: 11, font });
  }
  if (interactive) pdf.getForm().createTextField("syntheticName").addToPage(pdf.getPages()[0]);
  if (rotation) pdf.getPages()[0].setRotation(degrees(rotation));
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

async function resolution(bytes, { value = "Айлин Synthetic", state = "confirmed", sourceKey = "student_first_name", required = true,
  reviewState = "approved", pageSizes, second = null, manual = false,
  position = { page: 1, x: 160, y: 118, width: 350, height: 32 }, extra = [] } = {}) {
  const inspection = await inspectUniversityPdf(bytes);
  const template = { versionId: templateId, format: "pdf", sha256: inspection.sha256, pageSizes: pageSizes ?? inspection.pageSizes, slots: [] };
  const mapping = { versionId: mappingId, templateVersionId: templateId, templateSha256: template.sha256,
    mappings: [{ slotId: "pdf-1", sourceKey: manual ? null : sourceKey, required, format: "text", manual, position }, ...extra.map(item => item.mapping)] };
  mapping.sha256 = await computeUniversityFormMappingHash(mapping);
  const review = { versionId: reviewId, templateVersionId: templateId, templateSha256: template.sha256, mappingVersionId: mappingId, mappingSha256: mapping.sha256, state: reviewState };
  const profile = { fields: [{ key: sourceKey, value, state }, ...(second ? [second] : [])] };
  return resolveUniversityFormMappings({ template, mapping, review, profile, today: "2026-09-13" });
}

test("PDF inspection reports exact bytes and visible crop geometry without changing the source", async () => {
  const bytes = await fixture();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const result = await inspectUniversityPdf(bytes);
  assert.equal(result.sha256, hash);
  assert.deepEqual(result.pageSizes, [{ width: 612, height: 792 }, { width: 572, height: 732 }]);
  assert.throws(() => { result.pageSizes[0].width = 600; }, TypeError);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
});

test("confirmed Cyrillic values fill an exact reviewed PDF while original streams remain unchanged", async () => {
  const bytes = await fixture();
  const beforeHash = createHash("sha256").update(bytes).digest("hex");
  const original = await PDFDocument.load(bytes, { updateMetadata: false });
  const originalStreams = original.context.enumerateIndirectObjects().filter(([, value]) => typeof value.getContents === "function")
    .map(([ref, value]) => [ref.toString(), Buffer.from(value.getContents())]);
  const result = await fillUniversityPdf(bytes, await resolution(bytes), { draft: false });
  const filled = await PDFDocument.load(result, { updateMetadata: false });
  assert.equal(filled.getPageCount(), 2);
  const outputStreams = new Map(filled.context.enumerateIndirectObjects().filter(([, value]) => typeof value.getContents === "function")
    .map(([ref, value]) => [ref.toString(), Buffer.from(value.getContents())]));
  for (const [ref, content] of originalStreams) assert.ok(content.equals(outputStreams.get(ref)), "original page/font streams must remain byte-identical");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), beforeHash);
  assert.ok(result.length > bytes.length);
});

for (const value of ["中文 Synthetic", "😀 Synthetic", "A\u200bB"]) test(`unsupported or invisible font characters fail explicitly (${JSON.stringify(value)})`, async () => {
  const bytes = await fixture();
  const before = Buffer.from(bytes);
  await assert.rejects(fillUniversityPdf(bytes, await resolution(bytes, { value }), { draft: false }), { code: "form_pdf_character_unsupported" });
  assert.ok(bytes.equals(before));
});

test("combining text requiring unsupported positioned glyphs is not silently misrendered", async () => {
  const bytes = await fixture();
  await assert.rejects(fillUniversityPdf(bytes, await resolution(bytes, { value: "q\u0301 Synthetic" }), { draft: false }), { code: "form_pdf_shaping_unsupported" });
});

test("repeated exact reviewed input produces byte-identical final and draft output", async () => {
  const bytes = await fixture(), reviewed = await resolution(bytes);
  for (const draft of [false, true]) {
    const first = await fillUniversityPdf(bytes, reviewed, { draft });
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.ok(first.equals(await fillUniversityPdf(bytes, reviewed, { draft })));
  }
});

test("a different source hash and inaccurate reviewed page geometry are rejected", async () => {
  const bytes = await fixture(), reviewed = await resolution(bytes);
  const changed = await PDFDocument.load(bytes, { updateMetadata: false });
  changed.setTitle("Changed synthetic template");
  await assert.rejects(fillUniversityPdf(Buffer.from(await changed.save()), reviewed, { draft: true }), { code: "form_pdf_mapping_mismatch" });
  const wrongGeometry = await resolution(bytes, { pageSizes: [{ width: 611, height: 792 }, { width: 572, height: 732 }] });
  await assert.rejects(fillUniversityPdf(bytes, wrongGeometry, { draft: true }), { code: "form_pdf_mapping_mismatch" });
});

test("rejected review and manufactured resolution are not renderer inputs", async () => {
  const bytes = await fixture();
  await assert.rejects(fillUniversityPdf(bytes, await resolution(bytes, { reviewState: "rejected" }), { draft: true }), { code: "mapping_not_approved" });
  await assert.rejects(fillUniversityPdf(bytes, { ...await resolution(bytes) }, { draft: true }), { code: "invalid_mapping_resolution" });
});

for (const [state, value, sourceKey] of [["confirmed", null, "student_first_name"], ["conflict", null, "student_first_name"],
  ["needs_review", "Айлин", "student_first_name"], ["confirmed", "not an email", "father_work_email"]]) {
  test(`${state}/${value === null ? "empty" : sourceKey} never becomes an assignment; honest draft still works`, async () => {
    const bytes = await fixture(), reviewed = await resolution(bytes, { state, value, sourceKey });
    assert.equal(reviewed.fieldsReady, false);
    await assert.rejects(fillUniversityPdf(bytes, reviewed, { draft: false }), { code: "form_fields_not_ready" });
    const drafted = await fillUniversityPdf(bytes, reviewed, { draft: true });
    assert.equal((await inspectUniversityPdf(drafted)).pageSizes.length, 2);
  });
}

test("manual form areas stay manual and optional confirmed-empty stays empty", async () => {
  const bytes = await fixture();
  const manual = await resolution(bytes, { manual: true });
  await assert.rejects(fillUniversityPdf(bytes, manual, { draft: false }), { code: "form_fields_not_ready" });
  assert.ok((await fillUniversityPdf(bytes, manual, { draft: true })).length > bytes.length);
  const empty = await resolution(bytes, { required: false, value: null });
  assert.equal(empty.values[0].state, "confirmed_empty");
  assert.equal(empty.fieldsReady, true);
  assert.ok((await fillUniversityPdf(bytes, empty, { draft: false })).length > 0);
});

for (const manual of [false, true]) test(`omitted ${manual ? "manual" : "empty"} rectangles participate in overlap validation`, async () => {
  const bytes = await fixture();
  const extra = [{ mapping: { slotId: "pdf-2", sourceKey: manual ? null : "student_last_name", required: false, format: "text", manual,
      position: { page: 1, x: 200, y: 120, width: 80, height: 20 } } }];
  await assert.rejects(async () => fillUniversityPdf(bytes, await resolution(bytes, { extra }), { draft: true }), { code: "form_pdf_positions_overlap" });
});

for (const [position, code] of [
  [{ page: 3, x: 10, y: 10, width: 100, height: 30 }, "form_pdf_page_not_found"],
  [{ page: 2, x: 550, y: 10, width: 100, height: 30 }, "form_pdf_position_invalid"],
  [{ page: 1, x: 10, y: 10, width: 11, height: 30 }, "form_pdf_position_invalid"],
  [{ page: 1, x: 10, y: 10, width: 100, height: 30, characterCount: 21 }, "form_pdf_cells_invalid"],
]) test(`reviewed ordinary position must fit the actual page (${code}/${position.page})`, async () => {
  const bytes = await fixture();
  await assert.rejects(async () => fillUniversityPdf(bytes, await resolution(bytes, { position }), { draft: true }), { code });
});

test("overlong normal text fails without truncation while character cells accept accented Cyrillic", async () => {
  const bytes = await fixture();
  await assert.rejects(fillUniversityPdf(bytes, await resolution(bytes, { value: "Long synthetic name", position: { page: 1, x: 160, y: 118, width: 12, height: 12 } }), { draft: false }), { code: "form_pdf_text_overflow" });
  const position = { page: 1, x: 160, y: 118, width: 350, height: 32, characterCount: 12 };
  const good = await resolution(bytes, { value: "Айлин Á", position });
  assert.ok((await fillUniversityPdf(bytes, good, { draft: false })).length > bytes.length);
  await assert.rejects(fillUniversityPdf(bytes, await resolution(bytes, { value: "Айлин Synthetic", position: { ...position, characterCount: 3 } }), { draft: false }), { code: "form_pdf_text_overflow" });
});

test("editable interactive and rotated originals require a separate supported-template decision", async () => {
  await assert.rejects(inspectUniversityPdf(await fixture({ interactive: true })), { code: "form_pdf_interactive_unsupported" });
  await assert.rejects(inspectUniversityPdf(await fixture({ rotation: 90 })), { code: "form_pdf_rotation_unsupported" });
});

test("two-page cropped synthetic forms retain ordinary and long Latin/Cyrillic layouts", async () => {
  const bytes = await fixture();
  const extra = [
    ["pdf-2", "why_this_field", { page: 1, x: 160, y: 170, width: 350, height: 240 }],
    ["pdf-3", "student_first_name", { page: 2, x: 140, y: 88, width: 350, height: 32 }],
    ["pdf-4", "why_this_field", { page: 2, x: 140, y: 140, width: 350, height: 240 }],
  ].map(([id, sourceKey, position]) => ({
    mapping: { slotId: id, sourceKey, required: true, format: "text", manual: false, position },
  }));
  const outputs = new Map([["original.pdf", bytes]]);
  for (const [name, value] of [
    ["standard", "Synthetic study motivation. Кыргызча жана русский текст остаются читаемыми."],
    ["long", ("Synthetic engineering studies. Кыргызча жана русский текст. ").repeat(8).trim()],
  ]) {
    const reviewed = await resolution(bytes, { extra, second: { key: "why_this_field", value, state: "confirmed" } });
    assert.equal(reviewed.fieldsReady, true);
    assert.equal(reviewed.values.find(item => item.slotId === "pdf-2").value, value);
    for (const draft of [false, true]) {
      const output = await fillUniversityPdf(bytes, reviewed, { draft });
      assert.equal((await inspectUniversityPdf(output)).pageSizes.length, 2);
      outputs.set(`${name}-${draft ? "draft" : "filled"}.pdf`, output);
    }
  }
  // Optional synthetic-only artifact retention for the required visual gate.
  const outputDirectory = process.env.EVO_D4_SYNTHETIC_PDF_OUTPUT_DIR;
  if (outputDirectory) {
    const target = realpathSync(outputDirectory);
    assert.match(target, /^\/(?:private\/)?tmp\/evo-d4-pdf-[A-Za-z0-9]+$/u);
    for (const [name, bytes] of outputs) writeFileSync(join(target, name), bytes, { flag: "wx" });
  }
});
