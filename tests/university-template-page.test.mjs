import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseUniversityTemplatePageMetadata, universityTemplatePagePixels } from "../src/lib/university-template-page.ts";
import { parseUniversityTemplatePageFrame } from "../src/lib/server/university-template-preflight.ts";
import { readUniversityPdfPage, universityPdfPoint, universityPdfDrag, universityPdfRegionError } from "../src/lib/university-pdf-region-client.ts";

const expected = { sha256: "a".repeat(64), byteLength: 123, manifestDigest: "b".repeat(64), page: 2,
  pageSizes: [{ width: 300, height: 400 }, { width: 3000, height: 1500 }] };
const metadata = () => ({ status: "rendered", policyVersion: "evo-university-template-page-v1",
  rendererId: "pdfjs-6.3.289-canvas-1.0.9", mimeType: "application/pdf", sha256: expected.sha256,
  byteLength: expected.byteLength, manifestDigest: expected.manifestDigest, page: 2, pageCount: 2,
  widthPt: 3000, heightPt: 1500, pixelWidth: 2048, pixelHeight: 1024, pngByteLength: 1000, pngSha256: "c".repeat(64) });

test("page metadata binds the exact source, complete manifest, selected page and fixed raster dimensions", () => {
  assert.deepEqual(universityTemplatePagePixels(300, 400), { pixelWidth: 600, pixelHeight: 800 });
  assert.deepEqual(universityTemplatePagePixels(3000, 1500), { pixelWidth: 2048, pixelHeight: 1024 });
  assert.deepEqual(universityTemplatePagePixels(3000, 3000), { pixelWidth: 2048, pixelHeight: 2048 });
  const value = metadata(), result = parseUniversityTemplatePageMetadata(value, expected);
  assert.deepEqual(result, value); assert.ok(Object.isFrozen(result));
  value.pixelWidth = 1; assert.equal(result.pixelWidth, 2048);
});

test("page metadata rejects coercible literals, mismatched source/page and unbounded or forged raster metadata", () => {
  for (const change of [{ status: ["rendered"] }, { rendererId: null }, { sha256: "d".repeat(64) },
    { manifestDigest: "d".repeat(64) }, { byteLength: 124 }, { mimeType: "image/png" }, { page: 1 },
    { pageCount: 3 }, { widthPt: 2999 }, { heightPt: Infinity }, { pixelWidth: 2049 }, { pixelHeight: [1024] },
    { pngByteLength: 0 }, { pngByteLength: 20 * 1024 * 1024 + 1 }, { pngByteLength: "1000" },
    { pngSha256: ["c".repeat(64)] }, { pngSha256: "C".repeat(64) }, { slots: [] }, { path: "/private" }]) {
    assert.equal(parseUniversityTemplatePageMetadata({ ...metadata(), ...change }, expected), null);
  }
  for (const size of [NaN, Infinity, 71, 3001, "300", [300]]) assert.equal(universityTemplatePagePixels(size, 400), null);
  for (const field of Object.keys(metadata())) for (const invalid of [[], [[metadata()[field]]], {}, null]) {
    assert.equal(parseUniversityTemplatePageMetadata({ ...metadata(), [field]: invalid }, expected), null);
  }
  for (const change of [{ sha256: [expected.sha256] }, { manifestDigest: [expected.manifestDigest] }, { page: [2] },
    { pageSizes: [{ width: "300", height: 400 }] }, { pageSizes: [] }]) assert.equal(parseUniversityTemplatePageMetadata(metadata(), { ...expected, ...change }), null);
});

test("binary rejection and malformed UTF-8, zero metadata and cap-plus-one fail closed", () => {
  const frame = value => {
    const json = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    const prefix = Buffer.alloc(12); prefix.write("EUP1"); prefix.writeUInt32BE(json.length, 4);
    return Buffer.concat([prefix, json]);
  };
  assert.deepEqual(parseUniversityTemplatePageFrame(frame({ status: "rejected", code: "source_unavailable" }), expected), { status: "rejected", code: "source_unavailable" });
  for (const code of [["source_unavailable"], [["template_not_eligible"]], {}, null, "other"]) {
    assert.equal(parseUniversityTemplatePageFrame(frame({ status: "rejected", code }), expected), null);
  }
  assert.equal(parseUniversityTemplatePageFrame(frame(Buffer.from([0xff])), expected), null);
  assert.equal(parseUniversityTemplatePageFrame(frame(Buffer.alloc(0)), expected), null);
  assert.equal(parseUniversityTemplatePageFrame(Buffer.alloc(20 * 1024 * 1024 + 4109), expected), null);
});

test("page frame validates byte boundaries and PNG header/hash before delivery; this fixture tests framing, not rendering", () => {
  const png = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png); png.writeUInt32BE(13, 8); png.write("IHDR", 12);
  png.writeUInt32BE(2048, 16); png.writeUInt32BE(1024, 20); png[24] = 8; png[25] = 6;
  const value = { ...metadata(), pngByteLength: png.length, pngSha256: createHash("sha256").update(png).digest("hex") };
  const json = Buffer.from(JSON.stringify(value)), prefix = Buffer.alloc(12);
  prefix.write("EUP1"); prefix.writeUInt32BE(json.length, 4); prefix.writeUInt32BE(png.length, 8);
  const frame = Buffer.concat([prefix, json, png]);
  assert.equal(parseUniversityTemplatePageFrame(frame, expected).status, "rendered");
  for (const corrupt of [frame.subarray(1), frame.subarray(0, frame.length - 1), Buffer.concat([frame, Buffer.from("x")])]) {
    assert.equal(parseUniversityTemplatePageFrame(corrupt, expected), null);
  }
  const changed = Buffer.from(frame); changed[changed.length - 1] = 1;
  assert.equal(parseUniversityTemplatePageFrame(changed, expected), null);
  const invalidLength = Buffer.from(frame); invalidLength.writeUInt32BE(4097, 4);
  assert.equal(parseUniversityTemplatePageFrame(invalidLength, expected), null);
});

test("PDF region geometry uses the actual image box per axis across scrolling and zoom", () => {
  const size = { width: 595.28, height: 841.89 };
  assert.deepEqual(universityPdfPoint(160, 260, { left: 10, top: 20, width: 300, height: 480 }, size), { x: 297.64, y: 420.95 });
  assert.deepEqual(universityPdfPoint(310, 380, { left: 10, top: -100, width: 600, height: 960 }, size), { x: 297.64, y: 420.95 });
  assert.deepEqual(universityPdfPoint(-5, 2000, { left: 10, top: 20, width: 300, height: 480 }, size), { x: 0, y: 841.89 });
  assert.equal(universityPdfPoint(0, 0, { left: 0, top: 0, width: 0, height: 480 }, size), null);
  assert.deepEqual(universityPdfDrag({ x: 120, y: 80 }, { x: 30, y: 20 }, 2), { page: 2, x: 30, y: 20, width: 90, height: 60 });
  assert.equal(universityPdfDrag({ x: 0, y: 0 }, { x: 11, y: 20 }, 1), null);
});

test("PDF editor rejects overlap including manual fields, bounds and invalid cells without changing stored mappings", () => {
  const pages = [{ width: 300, height: 400 }];
  const field = position => ({ slotId: "pdf-1", manual: true, sourceKey: null, format: "text", required: false, position: { page: 1, x: 10, y: 10, width: 100, height: 20, ...position } });
  assert.equal(universityPdfRegionError([field({})], pages), null);
  assert.equal(universityPdfRegionError([field({}), field({ x: 100 })], pages), "overlap");
  assert.equal(universityPdfRegionError([field({}), field({ x: 110 })], pages), null);
  for (const position of [{ page: 2 }, { page: 1.5 }, { x: -1 }, { width: 11 }, { height: NaN }, { x: 250 }]) assert.equal(universityPdfRegionError([field(position)], pages), "bounds");
  for (const count of [0, 121, 21, 1.5, NaN]) assert.equal(universityPdfRegionError([field({ characterCount: count })], pages), "cells");
  assert.equal(universityPdfRegionError([field({ characterCount: 20 })], pages), null);
});

test("browser PDF reader binds metadata/bytes and rejects corruption, excess data and aborted streams", async () => {
  // Synthetic PNG header tests transport only; browser decoding/native proof is separate.
  const png = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a", "hex").copy(png); png.writeUInt32BE(13, 8); png.write("IHDR", 12);
  png.writeUInt32BE(2048, 16); png.writeUInt32BE(1024, 20);
  const meta = { ...metadata(), pngByteLength: png.length, pngSha256: createHash("sha256").update(png).digest("hex") };
  const response = (bytes = png, change = {}) => new Response(bytes, { headers: { "content-type": "image/png", "content-length": String(png.length), "x-evo-template-page": JSON.stringify({ ...meta, ...change }) } });
  const good = await readUniversityPdfPage(response(), expected, new AbortController().signal);
  assert.deepEqual(Buffer.from(good.bytes), png);
  for (const bad of [response(png, { page: 1 }), response(png, { manifestDigest: "d".repeat(64) }), response(Buffer.concat([png, Buffer.from("x")])), response(png.subarray(1)), response(Buffer.alloc(33))]) {
    await assert.rejects(readUniversityPdfPage(bad, expected, new AbortController().signal), /page_unavailable/);
  }
  const abort = new AbortController(); let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = readUniversityPdfPage(new Response(stream, { headers: response().headers }), expected, abort.signal);
  abort.abort(); await assert.rejects(pending, /page_unavailable/); assert.equal(cancelled, true);
});
