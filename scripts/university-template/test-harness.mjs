import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, mkdir, rm, access, stat, readdir } from "node:fs/promises";
import { PDFDocument, PDFName, PDFNumber, PDFString, degrees, rgb } from "pdf-lib";
import PizZip from "pizzip";
import { rasterFixture } from "./raster-fixtures.mjs";
import { inspectUniversityTemplate, previewUniversityTemplateSource, renderUniversityTemplatePage, renderUniversityForm } from "./adapter.mjs";
import { formRenderFixture } from "./form-fixtures.mjs";
import "./form-test-harness.mjs";

const ROOT = "/opt/evo-university-template-runtime";
const launcher = `${ROOT}/launcher`, diagnostic = `${ROOT}/launcher.test`;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const rejected = code => ({ status: "rejected", code });
const inspect = (bytes, mimeType = DOCX, signal = new AbortController().signal) => inspectUniversityTemplate({ bytes, mimeType, expectedSha256: sha(bytes) }, { signal });
const preview = (bytes, expectedManifest, offset = 0, signal = new AbortController().signal) =>
  previewUniversityTemplateSource({ bytes, mimeType: DOCX, expectedSha256: sha(bytes), expectedManifest, offset }, { signal });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const p = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
test("actual saved-form mode reinspects and fills complete DOCX and PDF with confirmed-only values", async () => {
  for (const format of ["docx", "pdf"]) for (const mode of ["final", "draft"]) {
    const source = format === "docx" ? docx() : await pdf(2);
    const inspection = await inspect(source, format === "docx" ? DOCX : "application/pdf");
    assert.equal(inspection.status, "verified");
    const fixture = await formRenderFixture(inspection, { mode });
    const result = await renderUniversityForm({ bytes: source, ...fixture }, { signal: new AbortController().signal });
    assert.equal(result.status, "rendered", JSON.stringify(result));
    assert.equal(result.metadata.outputSha256, sha(result.bytes));
    assert.equal(result.metadata.counts.confirmed, 1);
    assert.equal(result.metadata.mode, mode);
    assert.notEqual(sha(result.bytes), sha(source));
    if (format === "docx") {
      const xml = new PizZip(result.bytes).file("word/document.xml").asText();
      assert.ok(xml.includes("Айлин Synthetic Ө Ү Ң"));
      assert.ok(xml.includes("Signature:"));
    } else assert.equal((await inspect(result.bytes, "application/pdf")).status, "verified");
    await writeFile(`/proof-output/saved-${format}-${mode}.${format}`, result.bytes);
  }
});
await mkdir("/tmp/evo-university-template-fixtures", { recursive: true });
function docx({ body = p("Name:") + p("Signature:") + p("PRIVATE SYNTHETIC SENTINEL"), extra = {} } = {}) {
  const zip = new PizZip();
  const parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    ...extra,
  };
  for (const [name, value] of Object.entries(parts)) zip.file(name, value, { createFolders: false, date: new Date(2000, 0, 1) });
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
async function pdf(pages = 1, amend = () => {}) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index++) document.addPage([300, 400]);
  amend(document);
  return Buffer.from(await document.save());
}
function wire(bytes, mimeType = DOCX, change = {}) {
  return Buffer.concat([Buffer.from(`${JSON.stringify({ byteLength: bytes.length, expectedSha256: sha(bytes), mimeType, ...change })}\n`), bytes]);
}
async function run(binary, args = [], input = null, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject); child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.on("error", () => {}); child.stdin.end(input);
  });
}
async function runBinary(args, input, { slow = false, closeReader = false } = {}) {
  const child = spawn(diagnostic, args, { env: {}, stdio: ["pipe", "pipe", "pipe"] });
  const chunks = []; let stderr = "";
  if (slow) child.stdout.pause();
  if (closeReader) child.stdout.destroy();
  child.stdout.on("data", chunk => { chunks.push(chunk); if (slow) { child.stdout.pause(); setTimeout(() => child.stdout.resume(), 1); } });
  if (slow) setTimeout(() => child.stdout.resume(), 50);
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdin.on("error", () => {}); child.stdin.end(input);
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  assert.equal(stderr, "");
  return { code, bytes: Buffer.concat(chunks) };
}
function binaryMetadata(bytes) {
  assert.equal(bytes.subarray(0, 4).toString(), "EUP1");
  assert.equal(bytes.length, 12 + bytes.readUInt32BE(4) + bytes.readUInt32BE(8));
  return JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32BE(4)).toString());
}
async function pixels(png) {
  // Decode only our synthetic output for assertions, never a user PDF in Next.
  process.env.DISABLE_SYSTEM_FONTS_LOAD = "1";
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = `${ROOT}/vendor/canvas-native.node`;
  const { createCanvas, loadImage } = createRequire(import.meta.url)(`${ROOT}/node_modules/@napi-rs/canvas`);
  const image = await loadImage(png), canvas = createCanvas(image.width, image.height), context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, rgba: context.getImageData(0, 0, image.width, image.height).data };
}
async function childPid(supervisor, phase) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const pid = (await readFile(`/proc/${supervisor.pid}/task/${supervisor.pid}/children`, "utf8")).trim();
      if (/^\d+$/.test(pid) && (!phase || (await readFile(`/proc/${pid}/comm`, "utf8")).trim() === phase)) return pid;
    } catch {}
    await wait(10);
  }
  assert.fail("owned inspector did not enter expected phase");
}
async function gone(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await access(`/proc/${pid}`); } catch { return true; }
    await wait(10);
  }
  return false;
}

test("actual post-seal canvas compatibility renders a synthetic PDF into PNG", async () => {
  const result = await run(diagnostic, ["canvas-compatibility"]);
  assert.equal(result.code, 0); assert.equal(result.stderr, "");
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.status, "compatible", JSON.stringify(proof));
  assert.equal(proof.pdfjsVersion, "6.3.289");
  const png = Buffer.from(proof.png, "base64");
  assert.equal(sha(png), proof.pngSha256);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 300); assert.equal(png.readUInt32BE(20), 400);
  await writeFile("/tmp/evo-university-template-fixtures/compatibility.png", png);
  await writeFile("/proof-output/compatibility.png", png);
});

test("actual page adapter renders every cropped synthetic page bound to the inspected source", async () => {
  const bytes = await pdf(2, document => {
    const selected = document.getPage(0);
    selected.setCropBox(10, 20, 250, 300);
    selected.drawRectangle({ x: 10, y: 300, width: 20, height: 20, color: rgb(1, 0, 0) });
    selected.drawRectangle({ x: 240, y: 20, width: 20, height: 20, color: rgb(0, 0, 1) });
  });
  const source = await inspect(bytes, "application/pdf"); assert.equal(source.status, "verified");
  for (const page of [1, 2]) {
    const result = await renderUniversityTemplatePage({ bytes, mimeType: "application/pdf", expectedSha256: sha(bytes), expectedManifest: source.manifest, page }, { signal: new AbortController().signal });
    assert.equal(result.status, "rendered", JSON.stringify(result));
    assert.equal(result.metadata.page, page); assert.equal(result.metadata.pageCount, 2);
    assert.equal(result.metadata.pixelWidth, page === 1 ? 500 : 600);
    assert.equal(result.metadata.pixelHeight, page === 1 ? 600 : 800);
    assert.equal(sha(result.png), result.metadata.pngSha256);
    await writeFile(`/proof-output/cropped-page-${page}.png`, result.png);
  }
});

test("page renderer rejects stale full manifests, invalid modes, source geometry and malformed headers", async () => {
  const bytes = await pdf(2), source = await inspect(bytes, "application/pdf");
  assert.equal(source.status, "verified");
  const input = { bytes, mimeType: "application/pdf", expectedSha256: sha(bytes), expectedManifest: source.manifest, page: 1 };
  const tampered = structuredClone(source.manifest); tampered.pageSizes[1].width += 1;
  assert.deepEqual(await renderUniversityTemplatePage({ ...input, expectedManifest: tampered }, { signal: new AbortController().signal }), rejected("template_not_eligible"));
  for (const page of [0, 3, "1", [1], null]) assert.deepEqual(await renderUniversityTemplatePage({ ...input, page }, { signal: new AbortController().signal }), rejected("template_not_eligible"));
  const fields = { operation: "render-page-v1", expectedManifestDigest: sha(JSON.stringify(source.manifest)), page: 1 };
  const missing = await runBinary(["page-missing-native"], wire(bytes, "application/pdf", fields));
  assert.deepEqual(binaryMetadata(missing.bytes), rejected("source_unavailable"));
  for (const change of [{ operation: "source-preview" }, { page: [1] }, { expectedManifestDigest: [fields.expectedManifestDigest] },
    { expectedSha256: "0".repeat(64) }, { zoom: 2 }, { mimeType: DOCX }]) {
    const result = await runBinary(["--render-page-v1"], wire(bytes, "application/pdf", { ...fields, ...change }));
    assert.equal(result.code, 0); assert.deepEqual(binaryMetadata(result.bytes), rejected("template_not_eligible"));
  }
  const malformed = await runBinary(["--render-page-v1"], Buffer.from([0xff, 10, 0]));
  assert.deepEqual(binaryMetadata(malformed.bytes), rejected("template_not_eligible"));
  assert.deepEqual(JSON.parse((await run(launcher, [], wire(bytes, "application/pdf", fields))).stdout), rejected("template_not_eligible"));
  for (const amend of [d => d.getPages()[0].setRotation(degrees(90)), d => d.getPages()[0].node.set(PDFName.of("UserUnit"), PDFNumber.of(2))]) {
    const invalid = await pdf(1, amend);
    const result = await runBinary(["--render-page-v1"], wire(invalid, "application/pdf", fields));
    assert.deepEqual(binaryMetadata(result.bytes), rejected("template_not_eligible"));
  }
});

test("page rendering shares admission, honors in-flight abort and captures source/manifest before dispatch", async () => {
  const bytes = await pdf(), inspected = await inspect(bytes, "application/pdf");
  assert.equal(inspected.status, "verified");
  const input = { bytes, mimeType: "application/pdf", expectedSha256: sha(bytes), expectedManifest: inspected.manifest, page: 1 };
  const controller = new AbortController(), pending = renderUniversityTemplatePage(input, { signal: controller.signal });
  assert.deepEqual(await inspect(docx()), rejected("source_unavailable"));
  await wait(50); controller.abort();
  assert.deepEqual(await pending, rejected("source_unavailable"));
  assert.equal((await inspect(bytes, "application/pdf")).status, "verified");
  const mutable = structuredClone(inspected.manifest), capturedSha = sha(bytes);
  const captured = renderUniversityTemplatePage({ ...input, expectedManifest: mutable }, { signal: new AbortController().signal });
  bytes[0] = 0; mutable.pageSizes[0].width += 10;
  const result = await captured; assert.equal(result.status, "rendered");
  assert.equal(result.metadata.sha256, capturedSha); assert.equal(result.metadata.widthPt, 300);
});

test("actual binary supervisor delivers cap-sized output under backpressure and suppresses partial failed output", async () => {
  const maximum = 20 * 1024 * 1024 + 4108;
  const complete = await runBinary(["page-output"], null, { slow: true });
  assert.equal(complete.code, 0); assert.equal(complete.bytes.length, maximum);
  assert.ok(complete.bytes.every(byte => byte === 120));
  for (const mode of ["page-output-overflow", "page-partial-failure"]) {
    const result = await runBinary([mode]); assert.equal(result.code, 0);
    assert.deepEqual(binaryMetadata(result.bytes), rejected("source_unavailable")); assert.equal(result.bytes.readUInt32BE(8), 0);
  }
  assert.equal((await runBinary(["page-output"], null, { closeReader: true })).code, 74);
});

test("a stopped binary reader cannot extend the shared wall deadline", async () => {
  const started = Date.now(), child = spawn(diagnostic, ["page-output"], { env: {}, stdio: ["pipe", "pipe", "ignore"] });
  child.stdin.end(); child.stdout.pause();
  const code = await new Promise(resolve => child.on("exit", resolve));
  child.stdout.destroy();
  assert.equal(code, 74); assert.ok(Date.now() - started >= 14500 && Date.now() - started < 17000);
});

test("all portrait/landscape/fractional and negative-origin pages align four raster corner markers", async () => {
  const document = await PDFDocument.create();
  const boxes = [[10, 20, 250, 300], [-25, -15, 650.5, 380.125], [0, 0, 1500.5, 900.25]];
  const colors = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]];
  for (const [x, y, width, height] of boxes) {
    const page = document.addPage([width + 80, height + 80]);
    page.setMediaBox(x - 30, y - 30, width + 60, height + 60); page.setCropBox(x, y, width, height);
    for (const [index, [dx, dy]] of [[0, height - 20], [width - 20, height - 20], [0, 0], [width - 20, 0]].entries()) {
      page.drawRectangle({ x: x + dx, y: y + dy, width: 20, height: 20, color: rgb(...colors[index]) });
    }
  }
  const bytes = Buffer.from(await document.save()), inspected = await inspect(bytes, "application/pdf");
  assert.equal(inspected.status, "verified");
  for (const [index, box] of boxes.entries()) {
    const result = await renderUniversityTemplatePage({ bytes, mimeType: "application/pdf", expectedSha256: sha(bytes), expectedManifest: inspected.manifest, page: index + 1 }, { signal: new AbortController().signal });
    assert.equal(result.status, "rendered", JSON.stringify(result));
    const decoded = await pixels(result.png), width = box[2], height = box[3];
    for (const [corner, [x, y]] of [[10, 10], [width - 10, 10], [10, height - 10], [width - 10, height - 10]].entries()) {
      const offset = (Math.floor(y * decoded.height / height) * decoded.width + Math.floor(x * decoded.width / width)) * 4;
      assert.deepEqual([...decoded.rgba.subarray(offset, offset + 4)], [...colors[corner].map(value => value * 255), 255]);
    }
    await writeFile(`/proof-output/geometry-page-${index + 1}.png`, result.png);
  }
});

test("actual isolated branded PDF fill renders every generated Latin/Cyrillic/Kyrgyz page and blocks invalid mappings", async () => {
  const originals = [];
  for (const variant of ["original", "standard", "long"]) for (const draft of variant === "original" ? [false] : [false, true]) {
    for (const page of [1, 2]) {
      const result = await runBinary(["fill-proof"], JSON.stringify({ variant, draft, page }));
      assert.equal(result.code, 0);
      const metadata = binaryMetadata(result.bytes); assert.equal(metadata.status, "rendered", `${variant}/${draft}/${page}: ${JSON.stringify(metadata)}`);
      const png = result.bytes.subarray(12 + result.bytes.readUInt32BE(4)); assert.equal(sha(png), metadata.pngSha256);
      const decoded = await pixels(png);
      if (variant === "original") originals.push(decoded);
      else if (!draft) {
        const original = originals[page - 1]; assert.equal(decoded.width, original.width); assert.equal(decoded.height, original.height);
        const x = page === 1 ? 160 : 140, yName = page === 1 ? 118 : 88, yMotivation = page === 1 ? 170 : 140;
        let changed = 0;
        for (let py = 0; py < decoded.height; py++) for (let px = 0; px < decoded.width; px++) {
          const offset = (py * decoded.width + px) * 4;
          const differs = [0, 1, 2, 3].some(channel => decoded.rgba[offset + channel] !== original.rgba[offset + channel]);
          if (!differs) continue;
          changed++;
          const xPt = px * metadata.widthPt / decoded.width, yPt = py * metadata.heightPt / decoded.height;
          assert.ok(xPt >= x - 1 && xPt <= x + 351 && ((yPt >= yName - 1 && yPt <= yName + 33)
            || (yPt >= yMotivation - 1 && yPt <= yMotivation + 241)), "source artwork changed outside reviewed text rectangles");
        }
        assert.ok(changed > 100, "fill must visibly change the reviewed rectangles");
      }
      await writeFile(`/proof-output/fill-${variant}-${draft ? "draft" : "final"}-page-${page}.png`, png);
    }
  }
  for (const [variant, code] of [["unsupported", "form_pdf_character_unsupported"], ["shaping", "form_pdf_shaping_unsupported"], ["overflow", "form_pdf_text_overflow"],
    ["overlap", "form_pdf_positions_overlap"], ["out-of-bounds", "form_pdf_position_invalid"]]) {
    const result = await runBinary(["fill-proof"], JSON.stringify({ variant, draft: false, page: 1 }));
    assert.deepEqual(binaryMetadata(result.bytes), { status: "test-rejected", code }); assert.equal(result.bytes.readUInt32BE(8), 0);
  }
});

test("actual sealed raster handles public embedded CJK, Type3, external CMap, JPEG, JPX and transparency", async t => {
  for (const kind of ["embedded-cjk", "type3", "external-cmap", "jpeg-jpx-mask", "malformed-jpx", "malformed-cjk", "unsupported-full-cjk"]) {
    await t.test(kind, async () => {
    const bytes = await rasterFixture(kind), inspected = await inspect(bytes, "application/pdf");
    assert.equal(inspected.status, "verified");
    const result = await renderUniversityTemplatePage({ bytes, mimeType: "application/pdf", expectedSha256: sha(bytes), expectedManifest: inspected.manifest, page: 1 }, { signal: new AbortController().signal });
    if (kind.startsWith("malformed-") || kind === "unsupported-full-cjk") { assert.equal(result.status, "rejected"); return; }
    assert.equal(result.status, "rendered", `${kind}: ${JSON.stringify(result)}`);
    const decoded = await pixels(result.png);
    if (kind === "jpeg-jpx-mask") {
      for (const [x, expected] of [[52, [254, 0, 0]], [142, [255, 0, 0]], [232, [0, 128, 127]]]) {
        const offset = ((250 - 132) * 2 * decoded.width + x * 2) * 4;
        for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(decoded.rgba[offset + channel] - expected[channel]) <= 2);
      }
    } else {
      let ink = 0;
      for (let y = 130; y < decoded.height - 20; y++) for (let x = 10; x < decoded.width - 10; x++) {
        const index = (y * decoded.width + x) * 4;
        if (decoded.rgba[index] < 220) ink++;
      }
      assert.ok(ink > 100, `${kind} must contain visible glyphs below the fixture label`);
    }
    await writeFile(`/proof-output/codec-${kind}.png`, result.png);
    });
  }
});

test("actual template image owns immutable entrypoints and enforces network/files/FD/environment limits", async () => {
  assert.equal(process.platform, "linux"); assert.equal(process.version, "v22.23.1"); assert.equal(process.getuid(), 1001);
  for (const name of ["launcher", "bootstrap.mjs", "seal.node", "inspect.mjs"]) {
    const info = await stat(`${ROOT}/${name}`); assert.equal(info.uid, 0); assert.equal(info.mode & 0o022, 0);
  }
  await writeFile("/tmp/evo-document-outside", "synthetic-outside-sentinel", { mode: 0o644 });
  const result = await run(diagnostic, ["policy"], null, { EVO_DOCUMENT_TEST_SECRET: "synthetic-environment-sentinel" });
  assert.equal(result.code, 0); assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { policy: "enforced", memory: 2147483648, cpu: 10, fd: 64 });
  assert.equal((await run(launcher, ["policy"])).code, 64);
});

test("actual sealed template parser returns only exact DOCX hash and minimal manual/editable slots", async () => {
  const bytes = docx(), hash = sha(bytes), result = await inspect(bytes);
  assert.deepEqual(result, { status: "verified", sha256: hash, byteLength: bytes.length, mimeType: DOCX,
    policyVersion: "evo-university-template-v1", manifest: { format: "docx", slots: [
      { id: "p-1", editable: true }, { id: "p-2", editable: false }, { id: "p-3", editable: false },
    ], pageSizes: [] } });
  assert.equal(sha(bytes), hash);
  assert.equal(JSON.stringify(result).includes("SENTINEL"), false);
  assert.ok(Object.isFrozen(result.manifest.slots[0]));
});

test("actual passive PDF inspection preserves exact visible pages without manufacturing editable slots", async () => {
  const bytes = await pdf(2, document => document.getPage(0).setCropBox(10, 20, 250, 300));
  assert.deepEqual(await inspect(bytes, "application/pdf"), { status: "verified", sha256: sha(bytes), byteLength: bytes.length,
    mimeType: "application/pdf", policyVersion: "evo-university-template-v1",
    manifest: { format: "pdf", slots: [], pageSizes: [{ width: 250, height: 300 }, { width: 300, height: 400 }] } });
});

test("3000 actual DOCX slots fit the dedicated 128KiB protocol; 3001 cannot pass", async () => {
  const bytes = docx({ body: p("Name:").repeat(3000) }), result = await inspect(bytes);
  assert.equal(result.status, "verified"); assert.equal(result.manifest.slots.length, 3000);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) > 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 128 * 1024);
  const last = await preview(bytes, result.manifest, 2990);
  assert.equal(last.status, "preview"); assert.equal(last.totalSlots, 3000);
  assert.equal(last.slots[9].id, "p-3000"); assert.equal(last.nextOffset, null);
  assert.deepEqual(await inspect(docx({ body: p("Name:").repeat(3001) })), rejected("template_not_eligible"));
});

test("actual source preview returns exact text/context/manual rows with stable complete pagination", async () => {
  const cell = text => `<w:tc>${p(text)}</w:tc>`;
  const bytes = docx({ body: `<w:tbl><w:tr>${cell("Family name")}${cell("___")}</w:tr></w:tbl>`
    + p("Signature:") + Array.from({ length: 18 }, (_, index) => p(`Field ${index + 1}:`)).join("") });
  const source = await inspect(bytes); assert.equal(source.status, "verified");
  const first = await preview(bytes, source.manifest), second = await preview(bytes, source.manifest, 10), last = await preview(bytes, source.manifest, 20);
  for (const result of [first, second, last]) {
    assert.equal(result.status, "preview"); assert.equal(result.sha256, source.sha256); assert.equal(result.byteLength, bytes.length);
    assert.equal(result.manifestDigest, sha(Buffer.from(JSON.stringify(source.manifest))));
    assert.equal(result.totalSlots, 21); assert.ok(Buffer.byteLength(JSON.stringify(result)) < 128 * 1024);
  }
  assert.equal(first.nextOffset, 10); assert.equal(second.nextOffset, 20); assert.equal(last.nextOffset, null);
  assert.deepEqual([...first.slots, ...second.slots, ...last.slots].map(slot => slot.id), source.manifest.slots.map(slot => slot.id));
  assert.equal(first.slots[1].text, "___"); assert.equal(first.slots[1].editable, true); assert.equal(first.slots[1].kind, "blank");
  assert.match(first.slots[1].context, /Таблица 1, строка 1, ячейка 2/); assert.match(first.slots[1].context, /Family name/);
  assert.equal(first.slots[2].editable, false); assert.match(first.slots[2].manualReason, /вручную/);
  assert.equal(first.slots[0].truncated, false);
  assert.ok(Object.isFrozen(first.slots[0]));
  const tampered = structuredClone(source.manifest); tampered.slots[20].editable = !tampered.slots[20].editable;
  assert.deepEqual(await preview(bytes, tampered), rejected("source_unavailable")); // Difference outside requested page still rejects.
  const pending = preview(bytes, source.manifest), oldHash = sha(bytes); bytes[0] = 0;
  assert.equal((await pending).sha256, oldHash);
});

test("actual preview marks preexisting paragraph, label and nearby clipping and retains Unicode as plain text", async () => {
  const cell = text => `<w:tc>${p(text)}</w:tc>`;
  const bytes = docx({ body: p("X".repeat(1301)) + p("Name:") + p("&lt;img src=&quot;x&quot;&gt; 中文 Имя")
    + `<w:tbl><w:tr>${cell("L".repeat(230))}${cell("___")}</w:tr>`
    + `<w:tr>${cell("A".repeat(120))}${cell("B".repeat(120))}${cell("C".repeat(120))}</w:tr></w:tbl>` });
  const source = await inspect(bytes), result = await preview(bytes, source.manifest);
  assert.equal(result.status, "preview"); assert.equal(result.slots[0].text.length, 1200); assert.equal(result.slots[0].truncated, true);
  assert.equal(result.slots[1].truncated, true); // Previous paragraph was clipped to180.
  assert.equal(result.slots[2].text, '<img src="x"> 中文 Имя');
  assert.equal(result.slots[3].truncated, true); // Own label clipped to220, before preview projection.
  assert.equal(result.slots[4].truncated, true); // Empty cell inherits that clipped label.
  assert.equal(result.slots[5].truncated, true); // Row context clipped to280 despite each label being short.
  assert.equal(JSON.stringify(source).includes("truncated"), false);
  assert.equal(JSON.stringify(source).includes("中文"), false);
});

test("actual child rejects invalid preview operation, offset and PDF; source/manifest mutation cannot substitute binding", async () => {
  const bytes = docx(), source = await inspect(bytes);
  for (const change of [{ operation: "render", offset: 0 }, { operation: "source-preview", offset: -1 },
    { operation: "source-preview", offset: 0.5 }, { operation: "source-preview", offset: 3000 },
    { operation: "source-preview", offset: 3 }, { operation: "source-preview", offset: 0, limit: 1 }]) {
    assert.deepEqual(JSON.parse((await run(launcher, [], wire(bytes, DOCX, change))).stdout), rejected("template_not_eligible"));
  }
  assert.deepEqual(JSON.parse((await run(launcher, [], wire(await pdf(), "application/pdf", { operation: "source-preview", offset: 0 }))).stdout), rejected("template_not_eligible"));
  const mutable = structuredClone(source.manifest), pending = preview(bytes, mutable);
  mutable.slots[0].editable = false;
  assert.equal((await pending).status, "preview");
  const controller = new AbortController(), active = preview(bytes, source.manifest, 0, controller.signal);
  assert.deepEqual(await inspect(bytes), rejected("source_unavailable"));
  assert.deepEqual(await preview(bytes, source.manifest), rejected("source_unavailable"));
  controller.abort(); assert.deepEqual(await active, rejected("source_unavailable"));
  assert.equal((await preview(bytes, source.manifest)).status, "preview");
});

test("actual DOCX parser rejects malformed XML, active archive content and excessive entry expansion", async () => {
  for (const bytes of [Buffer.from("PK-not-a-template"), docx({ extra: { "word/vbaProject.bin": Buffer.from("synthetic macro sentinel") } }),
    docx({ extra: { "word/document.xml": '<!DOCTYPE x [<!ENTITY x "unsafe">]><x/>' } }),
    docx({ extra: { "word/embeddings/oleObject1.bin": Buffer.from("synthetic OLE") } }),
    docx({ extra: { "word/oversize.xml": Buffer.alloc(5 * 1024 * 1024 + 1, 32) } })]) {
    assert.deepEqual(await inspect(bytes), rejected("template_not_eligible"));
  }
});

test("actual PDF parser rejects active, signed, interactive and malformed documents", async () => {
  const active = await pdf(1, document => document.catalog.set(PDFName.of("JavaScript"), PDFString.of("synthetic")));
  const signed = await pdf(1, document => document.catalog.set(PDFName.of("ByteRange"), document.context.obj([0, 1, 2, 3])));
  const interactive = await pdf(1, document => document.getForm().createTextField("synthetic").addToPage(document.getPage(0)));
  for (const bytes of [active, signed, interactive, Buffer.from("%PDF-1.7\nunreadable")]) {
    assert.deepEqual(await inspect(bytes, "application/pdf"), rejected("template_not_eligible"));
  }
});

test("genuine password-encrypted PDF and actual 100/101-page limits are enforced", async () => {
  assert.equal((await inspect(await pdf(100), "application/pdf")).status, "verified");
  assert.deepEqual(await inspect(await pdf(101), "application/pdf"), rejected("template_not_eligible"));
  const directory = await mkdtemp("/tmp/evo-template-encryption-");
  try {
    await writeFile(`${directory}/input.pdf`, await pdf());
    execFileSync("/usr/bin/qpdf", ["--encrypt", "synthetic-owner", "synthetic-user", "256", "--", `${directory}/input.pdf`, `${directory}/encrypted.pdf`], { env: {}, stdio: "ignore" });
    assert.deepEqual(await inspect(await readFile(`${directory}/encrypted.pdf`), "application/pdf"), rejected("template_not_eligible"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("byte bounds, SHA, MIME and closed protocol checked inside production child as well as adapter", async () => {
  const bytes = docx();
  for (const change of [{ expectedSha256: "0".repeat(64) }, { byteLength: bytes.length + 1 }, { mimeType: "image/png" }, { unexpected: true }]) {
    assert.deepEqual(JSON.parse((await run(launcher, [], wire(bytes, DOCX, change))).stdout), rejected("template_not_eligible"));
  }
  assert.deepEqual(await inspect(bytes, "application/pdf"), rejected("template_not_eligible"));
  const maximum = Buffer.alloc(20 * 1024 * 1024, 32); (await pdf()).copy(maximum);
  assert.equal((await inspect(maximum, "application/pdf")).status, "verified");
  assert.deepEqual(await inspect(Buffer.alloc(20 * 1024 * 1024 + 1)), rejected("template_not_eligible"));
  assert.deepEqual(JSON.parse((await run(launcher, [], wire(Buffer.alloc(20 * 1024 * 1024 + 1)))).stdout), rejected("template_not_eligible"));
  const original = sha(bytes), pending = inspect(bytes); bytes[0] = 0;
  assert.equal((await pending).sha256, original);
});

test("actual production bootstrap installs required TSYNC seal in every Node thread before input", async () => {
  const supervisor = spawn(launcher, [], { env: {}, stdio: ["pipe", "ignore", "ignore"] });
  const closed = new Promise(resolve => supervisor.once("close", resolve)); supervisor.stdin.on("error", () => {});
  const filters = status => Number(status.match(/^Seccomp_filters:\s*(\d+)/m)?.[1]);
  try {
    const baseline = filters(await readFile(`/proc/${supervisor.pid}/status`, "utf8"));
    const pid = await childPid(supervisor); let sealed = false;
    for (let count = 0; count < 200 && !sealed; count++) {
      try {
        const maps = await readFile(`/proc/${pid}/maps`, "utf8"), threads = await readdir(`/proc/${pid}/task`);
        const statuses = await Promise.all(threads.map(tid => readFile(`/proc/${pid}/task/${tid}/status`, "utf8")));
        sealed = maps.includes(`${ROOT}/seal.node`) && threads.length > 1 && statuses.every(value => filters(value) === baseline + 2);
      } catch {}
      if (!sealed) await wait(10);
    }
    assert.equal(sealed, true);
  } finally { supervisor.kill("SIGKILL"); await closed; }
});

test("missing required addon and real kernel seal denial fail before input", async () => {
  assert.deepEqual(await readFile(`${ROOT}/bootstrap.mjs`), await readFile(`${ROOT}/missing-addon/bootstrap.mjs`));
  for (const mode of ["missing-addon", "seal-unavailable"]) {
    const supervisor = spawn(diagnostic, [mode], { env: {}, stdio: ["pipe", "pipe", "ignore"] });
    supervisor.stdin.on("error", () => {}); let output = "";
    supervisor.stdout.on("data", chunk => { output += chunk; });
    const closed = new Promise(resolve => supervisor.once("close", resolve));
    const timer = setTimeout(() => supervisor.kill("SIGKILL"), 3000);
    try { assert.equal(await closed, 0); assert.deepEqual(JSON.parse(output), rejected("source_unavailable")); }
    finally { clearTimeout(timer); supervisor.kill("SIGKILL"); await closed; }
  }
});

test("fcntl signalling and same-thread-group re-exec cannot escape the actual native policy", async () => {
  assert.deepEqual(JSON.parse((await run(diagnostic, ["async-signals"])).stdout), {
    probe: { ownerDenied: true, signalDenied: true, asyncDenied: true }, receivedSignals: 0,
  });
  const supervisor = spawn(diagnostic, ["thread-reexec"], { env: {}, stdio: ["pipe", "ignore", "ignore"] });
  const closed = new Promise(resolve => supervisor.once("close", resolve));
  try {
    const pid = await childPid(supervisor, "evo-exec-denied");
    supervisor.kill("SIGKILL"); await closed; assert.equal(await gone(pid), true);
  } finally { supervisor.kill("SIGKILL"); await closed; }
});

test("actual OS address-space and dedicated stdout ceiling remain hard limits", async () => {
  assert.deepEqual(JSON.parse((await run(diagnostic, ["memory"])).stdout), { memory: "bounded" });
  assert.deepEqual(JSON.parse((await run(diagnostic, ["output"])).stdout), rejected("source_unavailable"));
});

test("actual CPU and independent wall-clock deadlines terminate owned diagnostic processes", async () => {
  let started = performance.now();
  const cpu = JSON.parse((await run(diagnostic, ["cpu"])).stdout);
  assert.equal(cpu.signal, 9); assert.equal(cpu.deadline, false); assert.ok(cpu.cpuMilliseconds >= 9000);
  assert.ok(performance.now() - started >= 8000); assert.ok(performance.now() - started < 17_000);
  started = performance.now();
  const wall = JSON.parse((await run(diagnostic, ["wall"])).stdout);
  assert.equal(wall.signal, 9); assert.equal(wall.deadline, true); assert.ok(wall.cpuMilliseconds < 1000);
  assert.ok(performance.now() - started >= 14_000); assert.ok(performance.now() - started < 18_000);
});

test("parent death leaves no orphan, and adapter cancellation releases its concurrency gate", async () => {
  const supervisor = spawn(diagnostic, ["wall"], { env: {}, stdio: ["pipe", "ignore", "ignore"] });
  const closed = new Promise(resolve => supervisor.once("close", resolve));
  try {
    const pid = await childPid(supervisor); supervisor.kill("SIGKILL"); await closed;
    assert.equal(await gone(pid), true);
  } finally { supervisor.kill("SIGKILL"); await closed; }
  const signal = new AbortController(), pending = inspect(docx(), DOCX, signal.signal);
  assert.deepEqual(await inspect(docx()), rejected("source_unavailable"));
  assert.deepEqual(await preview(docx(), { format: "docx", slots: [{ id: "p-1", editable: true }], pageSizes: [] }), rejected("source_unavailable"));
  signal.abort(); assert.deepEqual(await pending, rejected("source_unavailable"));
  assert.equal((await inspect(docx())).status, "verified");
});
