// Test-image-only tracer: fixed synthetic source, invoked after the unchanged seal.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadUniversityPageRuntimeAssets } from "./render-page.mjs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const ROOT = "/opt/evo-university-template-runtime";
let phase = "addon", warned = false;
for (const method of ["log", "warn", "error", "info", "debug"]) console[method] = () => { warned = true; };
try {
  phase = "sealed-assets";
  const factory = new (loadUniversityPageRuntimeAssets())();
  const assets = JSON.parse(readFileSync(`${ROOT}/raster-assets.json`, "utf8")).assets;
  for (const [kind, folder] of [["cMapUrl", "cmaps"], ["standardFontDataUrl", "standard_fonts"], ["wasmUrl", "wasm"]]) {
    const extension = kind === "cMapUrl" ? /\.bcmap$/ : kind === "wasmUrl" ? /\.wasm$/ : /\.(pfb|ttf)$/;
    const path = Object.keys(assets).find(path => path.startsWith(`vendor/pdfjs/${folder}/`) && extension.test(path));
    assert.ok(path); const data = await factory.fetch({ kind, filename: path.split("/").at(-1) });
    assert.equal(createHash("sha256").update(data).digest("hex"), assets[path]);
  }
  for (const request of [{ kind: "wasmUrl", filename: "../../private" }, { kind: "cMapUrl", filename: "https://example.invalid/font" },
    { kind: "constructor", filename: "font" }, { kind: "standardFontDataUrl", filename: "missing.ttf" }]) await assert.rejects(factory.fetch(request));
  phase = "addon";
  const canvas = createRequire(import.meta.url)("@napi-rs/canvas");
  phase = "pdfjs";
  const pdfjs = await import(`${ROOT}/vendor/pdfjs/legacy/build/pdf.mjs`);
  const document = await PDFDocument.create(), page = document.addPage([300, 400]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: 380, width: 20, height: 20, color: rgb(1, 0, 0) });
  page.drawRectangle({ x: 280, y: 0, width: 20, height: 20, color: rgb(0, 0, 1) });
  page.drawText("Synthetic page render", { x: 35, y: 345, size: 16, font });
  phase = "load-pdf";
  const task = pdfjs.getDocument({ data: new Uint8Array(await document.save()),
    cMapUrl: `${ROOT}/vendor/pdfjs/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${ROOT}/vendor/pdfjs/standard_fonts/`, wasmUrl: `${ROOT}/vendor/pdfjs/wasm/`,
    stopAtErrors: true, useSystemFonts: false, disableFontFace: true, enableXfa: false, useWorkerFetch: false,
    useWasm: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, enableHWA: false, enableWebGPU: false });
  const loaded = await task.promise, selected = await loaded.getPage(1);
  phase = "render";
  const bitmap = canvas.createCanvas(300, 400);
  await selected.render({ canvas: bitmap, viewport: selected.getViewport({ scale: 1 }), background: "#ffffff" }).promise;
  phase = "encode";
  const png = bitmap.toBuffer("image/png");
  await task.destroy();
  if (warned) throw new Error("render_warning");
  process.stdout.write(JSON.stringify({ status: "compatible", pdfjsVersion: pdfjs.version,
    pngSha256: createHash("sha256").update(png).digest("hex"), png: png.toString("base64") }));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: "incompatible", phase, error: error instanceof Error ? error.message : "unknown", warned }));
}
