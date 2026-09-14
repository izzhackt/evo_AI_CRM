import { createHash } from "node:crypto";
import { readFileSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { inspectUniversityPdfGeometry, UniversityPdfError } from "../../src/lib/server/university-form-pdf.ts";
import { UNIVERSITY_TEMPLATE_PAGE_MAX_METADATA, UNIVERSITY_TEMPLATE_PAGE_MAX_PNG,
  UNIVERSITY_TEMPLATE_PAGE_POLICY, UNIVERSITY_TEMPLATE_PAGE_RENDERER, universityTemplatePagePixels } from "../../src/lib/university-template-page.ts";

const ROOT = "/opt/evo-university-template-runtime";
const MAX_BYTES = 20 * 1024 * 1024;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const record = value => !!value && typeof value === "object" && !Array.isArray(value);
function reject(code = "template_not_eligible") { throw new Error(code); }

function request() {
  const chunks = []; let size = 0;
  for (;;) {
    const chunk = Buffer.alloc(64 * 1024), count = readSync(0, chunk, 0, chunk.length, null);
    if (!count) break;
    size += count;
    if (size > MAX_BYTES + 512) reject();
    chunks.push(chunk.subarray(0, count));
  }
  const wire = Buffer.concat(chunks, size), separator = wire.indexOf(10);
  if (separator < 1 || separator > 511) reject();
  const header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(wire.subarray(0, separator)));
  if (!record(header) || Object.keys(header).sort().join(",") !== "byteLength,expectedManifestDigest,expectedSha256,mimeType,operation,page"
    || header.operation !== "render-page-v1" || header.mimeType !== "application/pdf"
    || !hash(header.expectedSha256) || !hash(header.expectedManifestDigest)
    || !Number.isInteger(header.byteLength) || header.byteLength < 12 || header.byteLength > MAX_BYTES
    || !Number.isInteger(header.page) || header.page < 1 || header.page > 100) reject();
  const bytes = wire.subarray(separator + 1);
  if (bytes.length !== header.byteLength || digest(bytes) !== header.expectedSha256) reject();
  return { bytes, header };
}

export function loadUniversityPageRuntimeAssets() {
  try {
    const manifest = JSON.parse(readFileSync(`${ROOT}/raster-assets.json`, "utf8"));
    if (!record(manifest) || manifest.architecture !== process.arch || manifest.pdfjs !== "6.3.289"
      || manifest.canvas !== "1.0.9" || !record(manifest.assets)) reject("source_unavailable");
    // The manifest is built into the root-owned image, never supplied by a PDF.
    for (const [path, sha256] of Object.entries(manifest.assets)) {
      if (!/^(vendor|node_modules)\/[A-Za-z0-9_@./-]+$/.test(path) || path.split("/").includes("..")
        || !hash(sha256) || digest(readFileSync(`${ROOT}/${path}`)) !== sha256) reject("source_unavailable");
    }
    return class FixedBinaryDataFactory {
      async fetch({ kind, filename }) {
        const directory = { cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" }[kind];
        if (!directory || typeof filename !== "string" || !/^[A-Za-z0-9_.-]+$/.test(filename)
          || filename === "." || filename === "..") reject("source_unavailable");
        const relative = `vendor/pdfjs/${directory}/${filename}`;
        if (!Object.hasOwn(manifest.assets, relative)) reject("source_unavailable");
        const bytes = readFileSync(`${ROOT}/${relative}`);
        if (digest(bytes) !== manifest.assets[relative]) reject("source_unavailable");
        return new Uint8Array(bytes);
      }
    };
  } catch { reject("source_unavailable"); }
}

/** Only called within the sealed runtime, including synthetic native fill proofs. */
export async function renderCapturedUniversityPdf(bytes, { expectedSha256, expectedManifestDigest, page }) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > MAX_BYTES
    || !hash(expectedSha256) || digest(bytes) !== expectedSha256 || !hash(expectedManifestDigest)
    || !Number.isInteger(page) || page < 1 || page > 100) reject();
  const { inspection, boxes } = await inspectUniversityPdfGeometry(Buffer.from(bytes));
  const manifest = { format: "pdf", slots: [], pageSizes: inspection.pageSizes };
  if (digest(JSON.stringify(manifest)) !== expectedManifestDigest || page > boxes.length) reject();
  const box = boxes[page - 1], pixels = universityTemplatePagePixels(box.width, box.height);
  if (!pixels) reject();
  let warned = false;
  // Before rasterizer imports: warnings cannot silently turn missing content into success.
  for (const method of ["log", "warn", "error", "info", "debug"]) console[method] = () => { warned = true; };
  const BinaryDataFactory = loadUniversityPageRuntimeAssets();
  const require = createRequire(import.meta.url);
  let canvas, pdfjs;
  try {
    canvas = require(`${ROOT}/node_modules/@napi-rs/canvas`);
    pdfjs = await import(`${ROOT}/vendor/pdfjs/legacy/build/pdf.mjs`);
    if (pdfjs.version !== "6.3.289" || warned) reject("source_unavailable");
  } catch { reject("source_unavailable"); }
  let loading;
  try {
    loading = pdfjs.getDocument({ data: new Uint8Array(bytes), stopAtErrors: true,
      useSystemFonts: false, disableFontFace: true, enableXfa: false, useWorkerFetch: false,
      useWasm: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
      enableHWA: false, enableWebGPU: false, maxImageSize: -1, BinaryDataFactory,
      cMapUrl: `${ROOT}/vendor/pdfjs/cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${ROOT}/vendor/pdfjs/standard_fonts/`, wasmUrl: `${ROOT}/vendor/pdfjs/wasm/` });
    const document = await loading.promise;
    if (document.numPages !== boxes.length) reject();
    const selected = await document.getPage(page);
    const expectedView = [box.x, box.y, box.x + box.width, box.y + box.height];
    const same = (actual, expected) => typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-6;
    if (selected.rotate !== 0 || selected.userUnit !== 1 || !Array.isArray(selected.view) || selected.view.length !== 4
      || selected.view.some((value, index) => !same(value, expectedView[index]))) reject();
    const viewport = selected.getViewport({ scale: 1, rotation: 0, dontFlip: false });
    if (!same(viewport.width, box.width) || !same(viewport.height, box.height)) reject();
    const bitmap = canvas.createCanvas(pixels.pixelWidth, pixels.pixelHeight);
    await selected.render({ canvas: bitmap, viewport, background: "rgb(255,255,255)", intent: "display",
      annotationMode: pdfjs.AnnotationMode.ENABLE,
      transform: [pixels.pixelWidth / box.width, 0, 0, pixels.pixelHeight / box.height, 0, 0] }).promise;
    const png = bitmap.toBuffer("image/png");
    if (warned) reject();
    if (png.length < 33 || png.length > UNIVERSITY_TEMPLATE_PAGE_MAX_PNG) reject("source_unavailable");
    const metadata = { status: "rendered", policyVersion: UNIVERSITY_TEMPLATE_PAGE_POLICY,
      rendererId: UNIVERSITY_TEMPLATE_PAGE_RENDERER, mimeType: "application/pdf", sha256: expectedSha256,
      byteLength: bytes.length, manifestDigest: expectedManifestDigest, page, pageCount: boxes.length,
      widthPt: box.width, heightPt: box.height, ...pixels, pngByteLength: png.length, pngSha256: digest(png) };
    return { metadata, png };
  } finally {
    if (loading) await loading.destroy();
    if (warned) reject();
  }
}

function frame(metadata, png = Buffer.alloc(0)) {
  const json = Buffer.from(JSON.stringify(metadata));
  if (!json.length || json.length > UNIVERSITY_TEMPLATE_PAGE_MAX_METADATA || png.length > UNIVERSITY_TEMPLATE_PAGE_MAX_PNG) reject("source_unavailable");
  const prefix = Buffer.alloc(12);
  prefix.write("EUP1"); prefix.writeUInt32BE(json.length, 4); prefix.writeUInt32BE(png.length, 8);
  return Buffer.concat([prefix, json, png]);
}

export async function runRenderPageRequest() {
  let output;
  try {
    const { bytes, header } = request();
    const { metadata, png } = await renderCapturedUniversityPdf(bytes, header);
    output = frame(metadata, png);
  } catch (error) {
    const code = error instanceof UniversityPdfError || error?.message === "template_not_eligible"
      || error instanceof SyntaxError || error instanceof TypeError ? "template_not_eligible" : "source_unavailable";
    output = frame({ status: "rejected", code });
  }
  await new Promise((resolve, rejectWrite) => process.stdout.write(output, error => error ? rejectWrite(error) : resolve()));
}
