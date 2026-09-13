import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import { fillUniversityDocx, inspectUniversityDocx } from "../src/lib/server/university-form-docx.ts";
import { computeUniversityFormMappingHash, getUniversityFormAssignments, resolveUniversityFormMappings } from "../src/lib/university-form-fields.ts";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const escape = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const p = text => `<w:p><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;
const cell = (text, props = "") => `<w:tc><w:tcPr>${props}<w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
const table = `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single"/><w:left w:val="single"/><w:bottom w:val="single"/><w:right w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr>${cell("Address")}${cell("____")}</w:tr><w:tr>${cell("Education", '<w:vMerge w:val="restart"/>')}${cell("School:")}</w:tr><w:tr>${cell("", "<w:vMerge/>")}${cell("Year:")}</w:tr></w:tbl>`;
function fixture({ reverse = false, date = new Date(2020, 0, 1), headers = false, body } = {}) {
  const zip = new PizZip();
  const sections = headers ? '<w:headerReference w:type="default" r:id="headerDefault"/><w:headerReference w:type="first" r:id="headerFirst"/><w:headerReference w:type="even" r:id="headerEven"/><w:titlePg/>' : "";
  const parts = {
    "[Content_Types].xml": `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${headers ? ["Default", "First", "Even"].map(type => `<Override PartName="/word/header${type}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`).join("") : ""}</Types>`,
    "_rels/.rels": `<Relationships xmlns="${REL}"><Relationship Id="document" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body ?? p("SYNTHETIC UNIVERSITY FORM — NOT AN APPLICATION") + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Name:</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> ____</w:t></w:r></w:p>' + table + p("Signature:") + p("Consent:") + p("Photo:")}<w:sectPr>${sections}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="360" w:footer="360"/></w:sectPr></w:body></w:document>`,
    "word/styles.xml": `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    "word/_rels/document.xml.rels": `<Relationships xmlns="${REL}"><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/>${headers ? ["Default", "First", "Even"].map(type => `<Relationship Id="header${type}" Type="${R}/header" Target="header${type}.xml"/>`).join("") : ""}</Relationships>`,
  };
  if (headers) for (const type of ["Default", "First", "Even"]) parts[`word/header${type}.xml`] = `<w:hdr xmlns:w="${W}">${p(`SYNTHETIC ${type} HEADER`)}</w:hdr>`;
  for (const [name, content] of reverse ? Object.entries(parts).reverse() : Object.entries(parts)) zip.file(name, content, { date, comment: "ordinary archive metadata", createFolders: false });
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE", comment: "synthetic source" });
}
function documentOf(bytes) {
  return new DOMParser({ onError: () => { throw new Error("invalid synthetic XML"); } })
    .parseFromString(new PizZip(bytes).file("word/document.xml").asText(), "application/xml");
}
const textOf = element => Array.from(element.getElementsByTagNameNS(W, "t")).map(node => node.textContent).join("");

test("inspect and fill preserve styled labels, tables and untouched package bytes", () => {
  const original = fixture();
  const originalHash = createHash("sha256").update(original).digest("hex");
  const inspected = inspectUniversityDocx(original);
  assert.equal(inspected.slots.find(slot => slot.id === "p-2").editable, true);
  assert.equal(inspected.slots.find(slot => slot.id === "p-4").editable, true);
  const output = fillUniversityDocx(original, [{ slotId: "p-2", value: "Айлин Test" }, { slotId: "p-4", value: "Synthetic city, 123" }], { draft: false });
  const xml = documentOf(output);
  assert.equal(textOf(xml.getElementsByTagNameNS(W, "p")[1]), "Name: Айлин Test");
  assert.equal(textOf(xml.getElementsByTagNameNS(W, "p")[3]), "Synthetic city, 123");
  assert.equal(xml.getElementsByTagNameNS(W, "b").length, 1);
  assert.equal(xml.getElementsByTagNameNS(W, "i").length, 1);
  assert.equal(xml.getElementsByTagNameNS(W, "tbl").length, 1);
  for (const name of Object.keys(new PizZip(original).files).filter(name => name !== "word/document.xml"))
    assert.deepEqual(new PizZip(output).file(name).asNodeBuffer(), new PizZip(original).file(name).asNodeBuffer());
  assert.equal(createHash("sha256").update(original).digest("hex"), originalHash);
});

test("equivalent source ZIP metadata yields deterministic bytes and preserves part content", () => {
  const values = [{ slotId: "p-2", value: "Synthetic Applicant" }];
  for (const draft of [false, true]) {
    const first = fillUniversityDocx(fixture(), values, { draft });
    const second = fillUniversityDocx(fixture({ reverse: true, date: new Date(2025, 6, 8) }), values, { draft });
    assert.ok(first.equals(second), "equivalent package content must have identical output bytes");
    assert.ok(first.equals(fillUniversityDocx(fixture(), values, { draft })), "repeated fill must have identical output bytes");
  }
});

test("deterministic metadata does not depend on the renderer host timezone", () => {
  const rendererUrl = new URL("../src/lib/server/university-form-docx.ts", import.meta.url).href;
  const script = `import { readFileSync } from "node:fs"; import { createHash } from "node:crypto"; import { fillUniversityDocx } from ${JSON.stringify(rendererUrl)};
    const output = fillUniversityDocx(readFileSync(0), [{ slotId: "p-2", value: "Synthetic" }], { draft: true });
    process.stdout.write(createHash("sha256").update(output).digest("hex"));`;
  const hashes = ["America/Los_Angeles", "Asia/Tokyo"].map(TZ => {
    const result = spawnSync(process.execPath, ["--conditions=react-server", "--experimental-strip-types", "--input-type=module", "-e", script], {
      input: fixture(), env: { ...process.env, TZ }, timeout: 5000, encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^[0-9a-f]{64}$/u);
    return result.stdout;
  });
  assert.equal(hashes[0], hashes[1]);
});

test("draft notice preserves body flow and marks original default, first and even headers", () => {
  for (const headers of [false, true]) {
    const original = fixture({ headers });
    const output = fillUniversityDocx(original, [], { draft: true });
    assert.equal(textOf(documentOf(output)), textOf(documentOf(original)));
    const zip = new PizZip(output);
    const headerNames = Object.keys(zip.files).filter(name => /^word\/(?:header|evo-draft-header-)/u.test(name));
    for (const name of headerNames) assert.match(zip.file(name).asText(), /DRAFT \/ ЧЕРНОВИК/u);
    if (headers) for (const type of ["Default", "First", "Even"]) assert.match(zip.file(`word/header${type}.xml`).asText(), new RegExp(`SYNTHETIC ${type} HEADER`));
    assert.equal(documentOf(output).getElementsByTagNameNS(W, "headerReference").length, 3);
  }
});

test("signature and consent table placeholders remain manual, as do merged continuations", () => {
  const original = fixture({ body: `<w:tbl><w:tr>${cell("Applicant signature")}${cell("____")}</w:tr><w:tr>${cell("Consent")}${cell("____")}</w:tr></w:tbl>` });
  const inspection = inspectUniversityDocx(original);
  for (const slot of inspection.slots) assert.equal(slot.editable, false);
  assert.throws(() => fillUniversityDocx(original, [{ slotId: "p-2", value: "Synthetic" }], { draft: false }), { code: "form_slot_manual" });
  assert.equal(inspectUniversityDocx(fixture()).slots.find(slot => slot.id === "p-7").editable, false);
});

test("ordinary multiline Unicode values are neither truncated nor reduced to one line", () => {
  const value = "  " + "😀".repeat(600) + "\n中文 / Кыргызча\ttext  ";
  const output = fillUniversityDocx(fixture(), [{ slotId: "p-4", value }], { draft: false });
  const paragraph = documentOf(output).getElementsByTagNameNS(W, "p")[3];
  assert.equal(paragraph.getElementsByTagNameNS(W, "br").length, 1);
  assert.equal(paragraph.getElementsByTagNameNS(W, "tab").length, 1);
  assert.equal(textOf(paragraph), value.replace(/[\n\t]/gu, ""));
  assert.throws(() => fillUniversityDocx(fixture(), [{ slotId: "p-4", value: "x".repeat(1001) }], { draft: false }), { code: "invalid_form_value" });
});

test("supported internal parts and ordinary external hyperlinks remain unchanged", () => {
  const original = new PizZip(fixture());
  original.file("word/_rels/document.xml.rels", `<Relationships xmlns="${REL}"><Relationship Id="notes" Type="${R}/footnotes" Target="footnotes.xml"/><Relationship Id="website" Type="${R}/hyperlink" Target="https://example.test/university" TargetMode="External"/></Relationships>`);
  original.file("word/footnotes.xml", `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${p("Synthetic footnote")}</w:footnote></w:footnotes>`);
  const bytes = original.generate({ type: "nodebuffer" });
  const output = fillUniversityDocx(bytes, [], { draft: false });
  assert.deepEqual(new PizZip(output).file("word/footnotes.xml").asNodeBuffer(), original.file("word/footnotes.xml").asNodeBuffer());
  assert.deepEqual(new PizZip(output).file("word/_rels/document.xml.rels").asNodeBuffer(), original.file("word/_rels/document.xml.rels").asNodeBuffer());
});

test("a template with an unsupported ordinary embedded-font relationship stops explicitly", () => {
  const original = new PizZip(fixture());
  original.file("word/fonts/synthetic-font.bin", "ordinary synthetic placeholder; not a real font");
  original.file("word/_rels/document.xml.rels", `<Relationships xmlns="${REL}"><Relationship Id="font" Type="${R}/font" Target="fonts/synthetic-font.bin"/></Relationships>`);
  assert.throws(() => inspectUniversityDocx(original.generate({ type: "nodebuffer" })), { code: "unsupported_form_relationship" });
});

test("confirmed field resolution fills the inspected exact template without accepting pending optional data", async () => {
  const bytes = fixture();
  const template = { versionId: "10000000-0000-4000-8000-000000000001", sha256: createHash("sha256").update(bytes).digest("hex"), ...inspectUniversityDocx(bytes) };
  const mapping = { versionId: "10000000-0000-4000-8000-000000000002", templateVersionId: template.versionId, templateSha256: template.sha256,
    mappings: [{ slotId: "p-2", sourceKey: "full_name", required: true, manual: false, format: "text" },
      { slotId: "p-4", sourceKey: "permanent_address", required: false, manual: false, format: "text" }] };
  mapping.sha256 = await computeUniversityFormMappingHash(mapping);
  const review = { versionId: "10000000-0000-4000-8000-000000000003", templateVersionId: template.versionId, templateSha256: template.sha256,
    mappingVersionId: mapping.versionId, mappingSha256: mapping.sha256, state: "approved" };
  const profile = { fields: [{ key: "student_first_name", value: "Synthetic", state: "confirmed" }, { key: "student_last_name", value: "Applicant", state: "confirmed" },
    { key: "permanent_address", value: "UNCONFIRMED SYNTHETIC ADDRESS", state: "needs_review" }] };
  const result = await resolveUniversityFormMappings({ template, mapping, review, profile, today: "2026-09-13" });
  assert.equal(result.fieldsReady, false);
  assert.throws(() => getUniversityFormAssignments(result, "final"), { code: "form_fields_not_ready" });
  const draft = fillUniversityDocx(bytes, getUniversityFormAssignments(result, "draft"), { draft: true });
  assert.match(textOf(documentOf(draft)), /Synthetic Applicant/u);
  assert.doesNotMatch(textOf(documentOf(draft)), /UNCONFIRMED SYNTHETIC ADDRESS/u);
  profile.fields[2].state = "confirmed";
  profile.fields[2].value = "Synthetic confirmed city";
  const finalFields = await resolveUniversityFormMappings({ template, mapping, review, profile, today: "2026-09-13" });
  const filled = fillUniversityDocx(bytes, getUniversityFormAssignments(finalFields, "final"), { draft: false });
  assert.match(textOf(documentOf(filled)), /Synthetic confirmed city/u);
});

test("ordinary oversized paragraph collection stops at the documented inspection limit", () => {
  const bytes = fixture({ body: Array.from({ length: 3001 }, () => p("Synthetic label:")).join("") });
  assert.throws(() => inspectUniversityDocx(bytes), { code: "form_too_complex" });
});

test("ordinary internal media part names may contain encoded spaces", () => {
  const zip = new PizZip(fixture());
  // Valid one-pixel PNG, no external I/O or applicant media.
  zip.file("word/media/synthetic image.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVh8AAAAASUVORK5CYII=", "base64"));
  zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="${REL}"><Relationship Id="image" Type="${R}/image" Target="media/synthetic%20image.png"/></Relationships>`);
  assert.ok(inspectUniversityDocx(zip.generate({ type: "nodebuffer" })).slots.length > 0);
});

if (process.env.EVO_D4_SYNTHETIC_OUTPUT_DIR) test("write explicitly requested synthetic visual-review outputs", () => {
  const outputDir = process.env.EVO_D4_SYNTHETIC_OUTPUT_DIR;
  assert.ok(path.isAbsolute(outputDir));
  mkdirSync(outputDir, { recursive: true });
  const original = fixture({ headers: true });
  const standardValues = [{ slotId: "p-2", value: "Айлин Synthetic" }, { slotId: "p-4", value: "Synthetic city, Test Street 123" }, { slotId: "p-6", value: "Synthetic School" }, { slotId: "p-8", value: "2026" }];
  const longValues = [{ slotId: "p-2", value: "Айлин Synthetic" }, { slotId: "p-4", value: "Только синтетические данные для визуальной проверки. ".repeat(14) + "\n中文 / Кыргызча\tSynthetic" }];
  for (const [name, bytes] of [
    ["original.docx", original],
    ["standard-filled.docx", fillUniversityDocx(original, standardValues, { draft: false })],
    ["standard-draft.docx", fillUniversityDocx(original, standardValues, { draft: true })],
    ["long-filled.docx", fillUniversityDocx(original, longValues, { draft: false })],
    ["long-draft.docx", fillUniversityDocx(original, longValues, { draft: true })],
  ]) writeFileSync(path.join(outputDir, name), bytes, { flag: "wx" });
});
