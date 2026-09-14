import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectUniversityTemplate, previewUniversityTemplateSource } from "../src/lib/server/university-template-preflight.ts";
import { parseUniversityTemplateSourcePreview, UNIVERSITY_TEMPLATE_DOCX_MIME as DOCX } from "../src/lib/university-template-preview.ts";

const options = () => ({ signal: new AbortController().signal });
const rejected = code => ({ status: "rejected", code });
const bytes = Buffer.from("ordinary synthetic input");
const input = () => ({ bytes, mimeType: "application/pdf", expectedSha256: createHash("sha256").update(bytes).digest("hex") });
test("template seam rejects non-template MIME, empty/oversized input and invalid hash before dispatch", async () => {
  for (const change of [{ bytes: new Uint8Array() }, { bytes: new Uint8Array(20 * 1024 * 1024 + 1) },
    { bytes: "not-bytes" }, { mimeType: "image/png" }, { expectedSha256: "not-a-hash" }]) {
    assert.deepEqual(await inspectUniversityTemplate({ ...input(), ...change }, options()), rejected("template_not_eligible"));
  }
});
test("exact SHA mismatch is ineligible before a native parser is dispatched", async () => {
  assert.deepEqual(await inspectUniversityTemplate({ ...input(), expectedSha256: "0".repeat(64) }, options()), rejected("template_not_eligible"));
});
test("already aborted or missing cancellation boundary never returns a verified template", async () => {
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await inspectUniversityTemplate(input(), { signal: controller.signal }), rejected("source_unavailable"));
  assert.deepEqual(await inspectUniversityTemplate(input(), {}), rejected("source_unavailable"));
});

const previewInput = () => ({ ...input(), mimeType: DOCX, expectedManifest: {
  format: "docx", slots: [{ id: "p-1", editable: true }], pageSizes: [],
}, offset: 0 });
test("preview admits only exact DOCX source and a valid nonempty trusted manifest page", async () => {
  for (const change of [{ mimeType: "application/pdf" }, { offset: -1 }, { offset: 0.5 }, { offset: 3000 }, { offset: 1 },
    { expectedManifest: {} }, { expectedManifest: { format: "docx", slots: [], pageSizes: [] } },
    { expectedManifest: { format: "docx", slots: [{ id: "p-2", editable: true }], pageSizes: [] } },
    { expectedManifest: { format: "docx", slots: [{ id: "p-1", editable: true, text: "not receipt metadata" }], pageSizes: [] } },
    { expectedSha256: "0".repeat(64) }, { bytes: new Uint8Array() }]) {
    assert.deepEqual(await previewUniversityTemplateSource({ ...previewInput(), ...change }, options()), rejected("template_not_eligible"));
  }
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await previewUniversityTemplateSource(previewInput(), { signal: controller.signal }), rejected("source_unavailable"));
});

function previewResponse(total = 21, offset = 0) {
  const expected = { sha256: "a".repeat(64), byteLength: 100, manifestDigest: "b".repeat(64), offset,
    slots: Array.from({ length: total }, (_, index) => ({ id: `p-${index + 1}`, editable: index % 2 === 0 })) };
  const selected = expected.slots.slice(offset, offset + 10);
  const value = { status: "preview", policyVersion: "evo-university-template-preview-v1", sha256: expected.sha256,
    byteLength: expected.byteLength, mimeType: DOCX, manifestDigest: expected.manifestDigest, offset, totalSlots: total,
    nextOffset: offset + selected.length < total ? offset + selected.length : null,
    slots: selected.map(slot => ({ ...slot, text: "Name:", context: "Таблица 1 · Поле: Name", kind: "label",
      manualReason: slot.editable ? null : "Заполните вручную", truncated: false })) };
  return { expected, value };
}
test("preview DTO validates complete pages, exact source/manifest binding and immutable plain strings", () => {
  for (const offset of [0, 10, 20]) {
    const { expected, value } = previewResponse(21, offset);
    value.slots[0].text = '<img src="x" onerror="alert(1)"> 中文 Имя';
    const result = parseUniversityTemplateSourcePreview(value, expected);
    assert.deepEqual(result, value);
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.slots)); assert.ok(Object.isFrozen(result.slots[0]));
    value.slots[0].text = "changed after validation";
    assert.notEqual(result.slots[0].text, value.slots[0].text);
  }
});
test("preview DTO rejects source, manifest, page and output schema mismatches", () => {
  const { value, expected } = previewResponse();
  for (const change of [{ status: "verified" }, { policyVersion: "evo-university-template-v1" }, { sha256: "c".repeat(64) },
    { manifestDigest: "c".repeat(64) }, { byteLength: 101 }, { mimeType: "application/pdf" }, { offset: 1 },
    { totalSlots: 22 }, { nextOffset: null }, { slots: value.slots.slice(1) }, { sourceObject: "private/key" }]) {
    assert.equal(parseUniversityTemplateSourcePreview({ ...value, ...change }, expected), null);
  }
  for (const change of [{ id: "p-9" }, { editable: false }, { text: "x".repeat(1201) }, { text: null },
    { context: "x".repeat(601) }, { kind: "html" }, { kind: ["label"] }, { kind: [["blank"]] }, { kind: {} }, { kind: null },
    { manualReason: "x".repeat(241) }, { truncated: "false" }, { html: "<p>" }]) {
    assert.equal(parseUniversityTemplateSourcePreview({ ...value, slots: [{ ...value.slots[0], ...change }, ...value.slots.slice(1)] }, expected), null);
  }
  const manual = structuredClone(value); manual.slots[1].manualReason = null;
  assert.equal(parseUniversityTemplateSourcePreview(manual, expected), null);
});
test("worst-case ten-row JSON escaping remains below the unchanged 128KiB transport cap", () => {
  const { value, expected } = previewResponse(10);
  for (const [index, slot] of value.slots.entries()) {
    slot.editable = false; expected.slots[index].editable = false;
    slot.text = "\u0000".repeat(1200); slot.context = "\u0000".repeat(600); slot.truncated = true;
    slot.manualReason = "\u0000".repeat(240);
  }
  assert.ok(parseUniversityTemplateSourcePreview(value, expected));
  assert.ok(Buffer.byteLength(`${JSON.stringify(value)}\n`) < 128 * 1024);
});
