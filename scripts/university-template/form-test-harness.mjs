// Only the synthetic proof image imports this module. No private/client inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import PizZip from "pizzip";
import { inspectUniversityTemplate, renderUniversityForm, renderUniversityTemplatePage, previewUniversityTemplateSource } from "./adapter.mjs";
import { encodeUniversityFormCapsule } from "../../src/lib/university-form-render.ts";
import { formRenderFixture, rebindFormFixture } from "./form-fixtures.mjs";
import { rasterFixture } from "./raster-fixtures.mjs";

const ROOT = "/opt/evo-university-template-runtime", DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX = 20 * 1024 * 1024, sha = bytes => createHash("sha256").update(bytes).digest("hex");
const signal = () => new AbortController().signal;
const inspect = (bytes, mimeType = DOCX) => inspectUniversityTemplate({ bytes, mimeType, expectedSha256: sha(bytes) }, { signal: signal() });
const render = (bytes, fixture, abort = signal()) => renderUniversityForm({ bytes, ...fixture }, { signal: abort });
const p = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const rejected = code => ({ status: "rejected", code });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function measuredRender(bytes, fixture) {
  const started = performance.now(), samples = { count: 0, childCpuTicks: 0, childRssHighWaterKiB: 0 };
  const sample = async () => {
    try {
      const supervisors = (await readFile(`/proc/${process.pid}/task/${process.pid}/children`, "utf8")).trim().split(/\s+/);
      for (const supervisor of supervisors) {
        if (!/^\d+$/.test(supervisor)) continue;
        const children = (await readFile(`/proc/${supervisor}/task/${supervisor}/children`, "utf8")).trim().split(/\s+/);
        for (const child of children) {
          if (!/^\d+$/.test(child)) continue;
          const status = await readFile(`/proc/${child}/status`, "utf8"), stat = await readFile(`/proc/${child}/stat`, "utf8");
          const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
          samples.count++; samples.childCpuTicks = Math.max(samples.childCpuTicks, Number(fields[11]) + Number(fields[12]));
          samples.childRssHighWaterKiB = Math.max(samples.childRssHighWaterKiB, Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0));
        }
      }
    } catch { /* Process may exit between read-only samples; never a proof of zero. */ }
  };
  let pending = Promise.resolve(); const timer = setInterval(() => { pending = pending.then(sample); }, 20);
  try { const result = await render(bytes, fixture); return { result, renderWallMs: performance.now() - started, sampledResource: samples }; }
  finally { clearInterval(timer); await pending; }
}

function sourceDocx({ image, paragraphs = 1, sections = false } = {}) {
  const zip = new PizZip();
  const headers = sections ? ["default", "first", "even"] : [];
  const section = `<w:sectPr>${headers.map(type => `<w:headerReference w:type="${type}" r:id="${type}"/>`).join("")}<w:footerReference w:type="default" r:id="footer"/><w:titlePg/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="360" w:footer="360"/></w:sectPr>`;
  const drawing = image ? '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Synthetic noise"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="Synthetic noise"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' : "";
  const table = sections ? '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' + p("Merged explanatory cell") + '</w:tc></w:tr><w:tr><w:tc>' + p("Signature:") + '</w:tc><w:tc>' + p("____") + '</w:tc></w:tr></w:tbl>' : "";
  zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>${headers.map(type => `<Override PartName="/word/header-${type}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<Relationships xmlns="${REL}"><Relationship Id="document" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="${REL}"><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="settings" Type="${R}/settings" Target="settings.xml"/><Relationship Id="footer" Type="${R}/footer" Target="footer.xml"/>${headers.map(type => `<Relationship Id="${type}" Type="${R}/header" Target="header-${type}.xml"/>`).join("")}${image ? `<Relationship Id="image" Type="${R}/image" Target="media/noise.png"/>` : ""}</Relationships>`);
  zip.file("word/document.xml", `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${Array.from({ length: paragraphs }, () => p("Name:")).join("")}${drawing}${table}${sections ? `<w:p><w:pPr>${section}</w:pPr><w:r><w:t>Second section follows</w:t></w:r></w:p>${p("Consent / photo: complete manually")}` : ""}${section}</w:body></w:document>`);
  zip.file("word/styles.xml", `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:style></w:styles>`);
  zip.file("word/settings.xml", `<w:settings xmlns:w="${W}"><w:evenAndOddHeaders/></w:settings>`);
  zip.file("word/footer.xml", `<w:ftr xmlns:w="${W}">${p("Synthetic original footer")}</w:ftr>`);
  for (const type of headers) zip.file(`word/header-${type}.xml`, `<w:hdr xmlns:w="${W}">${p(`Synthetic ${type} header`)}</w:hdr>`);
  if (image) zip.file("word/media/noise.png", image);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

async function sourcePdf({ image, pages = 1, geometry = false } = {}) {
  const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica);
  const embedded = image ? await document.embedPng(image) : null;
  for (let index = 0; index < pages; index++) {
    const page = document.addPage(geometry && index === 1 ? [792, 612] : [612, 792]);
    if (geometry && index === 2) page.setCropBox(20.25, 30.125, 571.5, 731.75);
    page.drawText("SYNTHETIC FORM - NOT AN APPLICATION", { x: 40, y: page.getHeight() - 55, size: 11, font });
    page.drawText("Signature / consent / photo: complete manually", { x: 40, y: 150, size: 10, font });
    page.drawRectangle({ x: 40, y: 100, width: 350, height: 30, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
    if (embedded) page.drawImage(embedded, { x: 50, y: 170, width: 64, height: 64 });
  }
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

function requestWire(source, fixture, capsule = Buffer.from(encodeUniversityFormCapsule({ operation: "render-form-v1", ...fixture }))) {
  const header = Buffer.alloc(12); header.write("EUFQ"); header.writeUInt32BE(capsule.length, 4); header.writeUInt32BE(source.length, 8);
  return Buffer.concat([header, capsule, source]);
}
function unpack(bytes) {
  assert.equal(bytes.subarray(0, 4).toString(), "EUF1");
  assert.equal(bytes.length, 12 + bytes.readUInt32BE(4) + bytes.readUInt32BE(8));
  return JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32BE(4)).toString());
}
async function raw(input, { diagnostic, fragment = false, slow = false, abortAfter, stallInput = false } = {}) {
  const child = spawn(`${ROOT}/launcher${diagnostic ? ".test" : ""}`, [diagnostic ?? "--render-form-v1"], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
  const chunks = []; let stderr = "", sent = 0;
  child.stdin.on("error", () => {}); child.stdout.on("error", () => {});
  child.stderr.on("data", bytes => { stderr += bytes; });
  child.stdout.on("data", bytes => { chunks.push(bytes); if (slow) { child.stdout.pause(); setTimeout(() => child.stdout.resume(), 2); } });
  const write = () => { if (sent >= input.length) { if (!stallInput) child.stdin.end(); return; }
    const end = fragment ? Math.min(input.length, sent + 31) : input.length;
    const ok = child.stdin.write(input.subarray(sent, end)); sent = end;
    if (ok) setImmediate(write); else child.stdin.once("drain", write); };
  write();
  const timer = abortAfter ? setTimeout(() => child.kill("SIGKILL"), abortAfter) : null;
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  if (timer) clearTimeout(timer);
  assert.equal(stderr, ""); return { code, bytes: Buffer.concat(chunks) };
}

test("saved form child independently rejects manifest/source/mapping/profile binding drift and malformed EUFQ", async () => {
  const source = sourceDocx(), inspection = await inspect(source), fixture = await formRenderFixture(inspection);
  const good = requestWire(source, fixture), capsule = Buffer.from(encodeUniversityFormCapsule({ operation: "render-form-v1", ...fixture }));
  await writeFile("/proof-output/saved-small.eufq", good);
  const variants = [Buffer.from("EUP1"), Buffer.concat([good, Buffer.from("x")]), good.subarray(0, -1),
    (() => { const result = Buffer.from(good); result[0] |= 128; return result; })(),
    requestWire(source, fixture, Buffer.from([0xff])), requestWire(source, fixture, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), capsule])),
    requestWire(source, fixture, Buffer.from('{"operation":"x",' + capsule.toString().slice(1))),
    requestWire(source, fixture, Buffer.alloc(2 * 1024 * 1024, 32)), requestWire(source, fixture, Buffer.alloc(2 * 1024 * 1024 + 1, 32))];
  for (const wire of variants) assert.deepEqual(unpack((await raw(wire)).bytes), rejected("invalid_input"));
  for (const mutate of [f => { f.formInput.template.manifest.slots[0].editable = false; },
    f => { f.binding.generatedInputSha256 = "0".repeat(64); }, f => { f.formInput.frozen_profile.profile.revision++; },
    f => { f.formInput.mapping.mappings[0].sourceKey = "student_last_name"; }]) {
    const changed = structuredClone(fixture); mutate(changed);
    assert.deepEqual(unpack((await raw(requestWire(source, changed))).bytes), rejected("binding_mismatch"));
  }
  const corrupted = Buffer.from(source); corrupted[30] ^= 1;
  assert.deepEqual(unpack((await raw(requestWire(corrupted, fixture))).bytes), rejected("binding_mismatch"));
  assert.equal(unpack((await raw(good, { fragment: true })).bytes).status, "rendered");
  assert.equal((await render(source, fixture)).status, "rendered");
});

test("saved form confirmed-only readiness/manual and PDF glyph/overflow/geometry failures are fixed typed rejections", async () => {
  for (const [mime, source] of [[DOCX, sourceDocx()], ["application/pdf", await sourcePdf()]]) {
    const inspection = await inspect(source, mime), pending = await formRenderFixture(inspection, { unconfirmed: true });
    assert.deepEqual(await render(source, pending), rejected("form_not_ready"));
    pending.formInput.mode = "draft";
    const draft = await render(source, pending); assert.equal(draft.status, "rendered");
    assert.equal(draft.metadata.counts.unconfirmed, 1); assert.ok(draft.metadata.warnings.includes("unresolved_fields_omitted"));
    const manual = await formRenderFixture(inspection); manual.formInput.mapping.mappings[0].manual = true;
    manual.formInput.mapping.mappings[0].sourceKey = null;
    manual.formInput.mapping.mappings[0].required = false; await rebindFormFixture(manual);
    assert.deepEqual(await render(source, manual), rejected("form_not_ready"));
    manual.formInput.mode = "draft";
    const manualDraft = await render(source, manual); assert.equal(manualDraft.status, "rendered"); assert.equal(manualDraft.metadata.counts.manual, 1);
  }
  const source = await sourcePdf(), inspection = await inspect(source, "application/pdf");
  for (const [value, code] of [["中文", "character_unsupported"], ["q\u0301 Synthetic", "shaping_unsupported"]]) {
    assert.deepEqual(await render(source, await formRenderFixture(inspection, { value })), rejected(code));
  }
  for (const [mutate, code] of [[f => { f.formInput.mapping.mappings[0].position.width = 12; f.formInput.mapping.mappings[0].position.height = 12; }, "text_overflow"],
    [f => { f.formInput.mapping.mappings[0].position.x = 610; }, "binding_mismatch"],
    [f => { const next = structuredClone(f.formInput.mapping.mappings[0]); next.slotId = "pdf-2"; next.manual = true; next.sourceKey = null; f.formInput.mapping.mappings.push(next); }, "binding_mismatch"]]) {
    const fixture = await formRenderFixture(inspection); mutate(fixture); await rebindFormFixture(fixture);
    assert.deepEqual(await render(source, fixture), rejected(code));
  }
});

test("saved form EUF1 supervisor exact20MiB frame, overflow and partial failure remain distinct from PNG mode", async () => {
  const exact = await raw(Buffer.alloc(0), { diagnostic: "form-output", slow: true });
  assert.equal(exact.code, 0); assert.equal(exact.bytes.length, MAX + 4108);
  for (const diagnostic of ["form-output-overflow", "form-partial-failure"]) {
    const result = await raw(Buffer.alloc(0), { diagnostic }); assert.deepEqual(unpack(result.bytes), rejected("source_unavailable"));
  }
});

test("saved form stalled input reaches the existing15s deadline and killing its supervisor kills the sealed child", async () => {
  const source = sourceDocx(), inspection = await inspect(source), fixture = await formRenderFixture(inspection), header = requestWire(source, fixture).subarray(0, 12);
  const started = performance.now(), stalled = await raw(header, { stallInput: true });
  // The same15s deadline includes delivery; once expired it must close/fail,
  // not reset the deadline just to emit a new rejection frame.
  assert.equal(stalled.code, 74); assert.equal(stalled.bytes.length, 0);
  assert.ok(performance.now() - started >= 14000 && performance.now() - started < 17000);
  const supervisor = spawn(`${ROOT}/launcher`, ["--render-form-v1"], { env: {}, stdio: ["pipe", "pipe", "ignore"] });
  supervisor.stdin.on("error", () => {}); supervisor.stdout.resume(); supervisor.stdin.write(header);
  let ownedChild;
  for (let attempt = 0; attempt < 200; attempt++) {
    const children = (await readFile(`/proc/${supervisor.pid}/task/${supervisor.pid}/children`, "utf8")).trim();
    if (/^\d+$/.test(children) && (await readFile(`/proc/${children}/comm`, "utf8")).trim() === "node") { ownedChild = children; break; }
    await wait(10);
  }
  assert.ok(ownedChild); const close = new Promise(resolve => supervisor.on("close", resolve)); supervisor.kill("SIGKILL"); await close;
  let remains = true;
  for (let attempt = 0; attempt < 100; attempt++) { try { await readFile(`/proc/${ownedChild}/status`, "utf8"); } catch { remains = false; break; } await wait(10); }
  assert.equal(remains, false); assert.equal((await render(source, fixture)).status, "rendered");
});

test("saved form captures caller input and shares admission across inspect, preview, page and form; abort releases only settled child", async () => {
  const source = sourceDocx(), inspection = await inspect(source), fixture = await formRenderFixture(inspection);
  const started = render(source, fixture);
  fixture.formInput.frozen_profile.fields[0].value = "CALLER MUTATION"; source[30] ^= 1;
  assert.deepEqual(await inspect(source), rejected("source_unavailable"));
  assert.deepEqual(await previewUniversityTemplateSource({ bytes: source, mimeType: DOCX, expectedSha256: sha(source), expectedManifest: inspection.manifest, offset: 0 }, { signal: signal() }), rejected("source_unavailable"));
  assert.deepEqual(await render(source, fixture), rejected("source_unavailable"));
  const captured = await started; assert.equal(captured.status, "rendered");
  assert.ok(!new PizZip(captured.bytes).file("word/document.xml").asText().includes("CALLER MUTATION"));
  const pdf = await sourcePdf(), pdfInspection = await inspect(pdf, "application/pdf"), pdfFixture = await formRenderFixture(pdfInspection);
  const control = new AbortController(), pending = render(pdf, pdfFixture, control.signal);
  assert.deepEqual(await renderUniversityTemplatePage({ bytes: pdf, mimeType: "application/pdf", expectedSha256: sha(pdf), expectedManifest: pdfInspection.manifest, page: 1 }, { signal: signal() }), rejected("source_unavailable"));
  control.abort(); assert.deepEqual(await pending, rejected("source_unavailable"));
  assert.equal((await render(pdf, pdfFixture)).status, "rendered");
  const before = new AbortController(); before.abort(); assert.deepEqual(await render(pdf, pdfFixture, before.signal), rejected("source_unavailable"));
});

// RGB PNG with genuine incompressible pixels, not unreferenced archive padding.
function noisePng(size, leadingBlackBytes = 0) {
  const raw = Buffer.allocUnsafe((size * 3 + 1) * size);
  // Deterministic pseudo-random test pixels; not a security/randomness primitive.
  let state = 0x12345678;
  for (let index = 0; index < raw.length; index++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; raw[index] = state & 255; }
  raw.fill(0, 1, leadingBlackBytes + 1);
  for (let row = 0; row < size; row++) raw[row * (size * 3 + 1)] = 0;
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const type = Buffer.from(name), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); type.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("saved form actual DOCX and PDF each preserve an incompressible image in a reopened19.5–20MiB output", async () => {
  const image = noisePng(2630), report = [];
  for (const [format, source] of [["docx", sourceDocx({ image })], ["pdf", await sourcePdf({ image })]]) {
    assert.ok(source.length <= MAX); const inspection = await inspect(source, format === "docx" ? DOCX : "application/pdf");
    assert.equal(inspection.status, "verified");
    const fixture = await formRenderFixture(inspection), observed = await measuredRender(source, fixture), { result } = observed;
    assert.equal(result.status, "rendered", JSON.stringify({ format, ...observed, sourceBytes: source.length }));
    assert.ok(result.bytes.length >= 19.5 * 1024 * 1024 && result.bytes.length <= MAX, `${format}:${result.bytes.length}`);
    if (format === "docx") assert.equal(sha(new PizZip(result.bytes).file("word/media/noise.png").asUint8Array()), sha(image));
    else assert.equal((await inspect(result.bytes, "application/pdf")).status, "verified");
    report.push({ format, sourceBytes: source.length, sourceSha256: sha(source), outputBytes: result.bytes.length, outputSha256: sha(result.bytes), renderWallMs: observed.renderWallMs, sampledResource: observed.sampledResource });
    await writeFile(`/proof-output/saved-large-${format}-source.${format}`, source);
    await writeFile(`/proof-output/saved-large-${format}-filled.${format}`, result.bytes);
  }
  await writeFile("/proof-output/saved-large-report.json", JSON.stringify(report));
});

test("saved form supports the existing3000DOCX mapping and500PDF region/100page structural bounds", async () => {
  const docx = sourceDocx({ paragraphs: 3000 }), docxInspection = await inspect(docx); assert.equal(docxInspection.status, "verified");
  assert.equal(docxInspection.manifest.slots.length, 3000);
  const mappings = docxInspection.manifest.slots.map(slot => ({ slotId: slot.id, sourceKey: "student_first_name", required: true, format: "text", manual: false }));
  const docxResult = await render(docx, await formRenderFixture(docxInspection, { mappings }));
  assert.equal(docxResult.status, "rendered"); assert.equal(docxResult.metadata.counts.confirmed, 3000);
  const pdf = await sourcePdf({ pages: 100 }), pdfInspection = await inspect(pdf, "application/pdf"); assert.equal(pdfInspection.status, "verified");
  const regions = Array.from({ length: 500 }, (_, index) => ({ slotId: `pdf-${index + 1}`, sourceKey: "student_first_name", required: true, format: "text", manual: false,
    position: { page: Math.floor(index / 5) + 1, x: 40, y: 100 + index % 5 * 45, width: 400, height: 32 } }));
  const pdfResult = await render(pdf, await formRenderFixture(pdfInspection, { mappings: regions }));
  assert.equal(pdfResult.status, "rendered"); assert.equal(pdfResult.metadata.counts.confirmed, 500); assert.equal(pdfResult.metadata.pageCount, 100);
});

test("saved form rejects actual output growth beyond20MiB for both eligible source formats", async () => {
  const docx = sourceDocx({ image: noisePng(2643, 5000), paragraphs: 2999 }), pdf = await sourcePdf({ image: noisePng(2643) });
  for (const [format, source] of [["docx", docx], ["pdf", pdf]]) {
    await writeFile(`/proof-output/saved-overflow-${format}-source.${format}`, source);
    assert.ok(source.length <= MAX, `overflow control source must itself be eligible: ${format}:${source.length}`);
    const inspection = await inspect(source, format === "docx" ? DOCX : "application/pdf"); assert.equal(inspection.status, "verified");
    const value = format === "docx" ? "Synthetically filled university motivation Ө Ү Ң. ".repeat(10)
      : [...Array.from({ length: 58 }, (_, i) => String.fromCodePoint(65 + i)), ...Array.from({ length: 64 }, (_, i) => String.fromCodePoint(0x410 + i))].join(" ");
    const mappings = format === "docx" ? inspection.manifest.slots.filter(slot => slot.editable).map(slot => ({ slotId: slot.id, sourceKey: "why_this_field", required: true, format: "text", manual: false }))
      : [{ slotId: "pdf-1", sourceKey: "why_this_field", required: true, format: "text", manual: false, position: { page: 1, x: 40, y: 100, width: 450, height: 240 } }];
    const fixture = await formRenderFixture(inspection, { mappings, value, sourceKey: "why_this_field" });
    const result = await render(source, fixture); assert.deepEqual(result, rejected("output_too_large"), format);
  }
});

test("saved DOCX sections/tables/styles/manual content and deterministic long final/draft output are preserved", async () => {
  const source = sourceDocx({ sections: true }), inspection = await inspect(source);
  assert.equal(inspection.status, "verified"); await writeFile("/proof-output/saved-sections-source.docx", source);
  for (const mode of ["final", "draft"]) for (const variant of ["standard", "long"]) {
    const value = variant === "standard" ? "Айлин Synthetic Ө Ү Ң" : "Кыргызча Ө Ү Ң / Latin, synthetic motivation. ".repeat(10);
    const fixture = await formRenderFixture(inspection, { mode, value, sourceKey: variant === "long" ? "why_this_field" : "student_first_name" });
    const result = await render(source, fixture); assert.equal(result.status, "rendered");
    assert.equal(sha((await render(source, fixture)).bytes), sha(result.bytes));
    const zip = new PizZip(result.bytes), xml = zip.file("word/document.xml").asText();
    assert.ok(xml.includes(value.trim())); assert.ok(xml.includes("Signature:")); assert.ok(xml.includes("____")); assert.ok(xml.includes("Consent / photo:"));
    assert.equal(zip.file("word/styles.xml").asText(), new PizZip(source).file("word/styles.xml").asText());
    if (mode === "draft") for (const type of ["default", "first", "even"]) assert.ok(zip.file(`word/header-${type}.xml`).asText().includes("DRAFT / ЧЕРНОВИК"));
    await writeFile(`/proof-output/saved-sections-${variant}-${mode}.docx`, result.bytes);
  }
});

test("saved PDF final/draft standard/long output rasterizes every portrait/landscape/cropped fractional page", async () => {
  const source = await sourcePdf({ pages: 3, geometry: true }), inspection = await inspect(source, "application/pdf");
  assert.equal(inspection.status, "verified");
  async function savePages(bytes, name) {
    await writeFile(`/proof-output/${name}.pdf`, bytes);
    const inspected = await inspect(bytes, "application/pdf"); assert.equal(inspected.status, "verified");
    for (let page = 1; page <= 3; page++) {
      const result = await renderUniversityTemplatePage({ bytes, mimeType: "application/pdf", expectedSha256: sha(bytes), expectedManifest: inspected.manifest, page }, { signal: signal() });
      assert.equal(result.status, "rendered"); await writeFile(`/proof-output/${name}-page${page}.png`, result.png);
    }
  }
  await savePages(source, "saved-geometry-source");
  for (const mode of ["final", "draft"]) for (const variant of ["standard", "long"]) {
    const mappings = Array.from({ length: 3 }, (_, index) => ({ slotId: `pdf-${index + 1}`, sourceKey: "why_this_field", required: true, format: "text", manual: false,
      position: { page: index + 1, x: 45, y: 110, width: 450, height: 240 } }));
    const value = variant === "standard" ? "Кыргызча Ө Ү Ң / Айлин Synthetic" : "Кыргызча Ө Ү Ң / Latin, synthetic motivation. ".repeat(10);
    const fixture = await formRenderFixture(inspection, { mappings, mode, value, sourceKey: "why_this_field" });
    const result = await render(source, fixture); assert.equal(result.status, "rendered"); await savePages(result.bytes, `saved-geometry-${variant}-${mode}`);
  }
});

test("saved PDF producer preserves source CJK/Type3/external-CMap/JPEG/JPX/mask content through actual fill and page render", async () => {
  // The trusted synthetic JPEG encoder also needs the fixed native path. This
  // setup is independent of legacy pixels() test ordering and not a child env.
  process.env.DISABLE_SYSTEM_FONTS_LOAD = "1";
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = `${ROOT}/vendor/canvas-native.node`;
  for (const kind of ["embedded-cjk", "type3", "external-cmap", "jpeg-jpx-mask"]) {
    const source = await rasterFixture(kind), inspection = await inspect(source, "application/pdf"); assert.equal(inspection.status, "verified");
    const fixture = await formRenderFixture(inspection); fixture.formInput.mapping.mappings[0].position = { page: 1, x: 20, y: 175, width: 250, height: 22 }; await rebindFormFixture(fixture);
    const result = await render(source, fixture); assert.equal(result.status, "rendered");
    const next = await inspect(result.bytes, "application/pdf"); assert.equal(next.status, "verified");
    const page = await renderUniversityTemplatePage({ bytes: result.bytes, mimeType: "application/pdf", expectedSha256: sha(result.bytes), expectedManifest: next.manifest, page: 1 }, { signal: signal() });
    assert.equal(page.status, "rendered"); await writeFile(`/proof-output/saved-compatibility-${kind}.pdf`, result.bytes); await writeFile(`/proof-output/saved-compatibility-${kind}.png`, page.png);
  }
});
