import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseUniversityTemplatePageMetadata, universityTemplatePagePixels } from "../src/lib/university-template-page.ts";
import { parseUniversityTemplatePageFrame } from "../src/lib/server/university-template-preflight.ts";

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
