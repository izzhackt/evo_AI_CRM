import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { syntheticMappingDocx } from "../scripts/lib/university-template-mapping-browser-proof.mjs";
import { TEMPLATE_MAPPING_CHECKS, validateTemplateMappingProof, TEMPLATE_PDF_MAPPING_CHECKS, validateTemplatePdfMappingProof } from "../scripts/lib/university-template-mapping-evidence.mjs";
import { inspectUniversityDocx } from "../src/lib/server/university-form-docx.ts";

test("the exact browser DOCX input spans two preview batches with stable fragments and a manual signature", () => {
  const bytes = syntheticMappingDocx(), inspection = inspectUniversityDocx(bytes);
  assert.deepEqual(syntheticMappingDocx(), bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex").length, 64);
  assert.equal(inspection.slots.length, 13);
  assert.equal(inspection.slots[0].id, "p-1");
  assert.equal(inspection.slots[0].editable, true);
  assert.equal(inspection.slots[11].id, "p-12");
  assert.equal(inspection.slots[11].editable, true);
  assert.equal(inspection.slots[12].id, "p-13");
  assert.equal(inspection.slots[12].editable, false);
});

// Synthetic receipt-shape probes, not executed browser/Storage/native proof.
const receipt = () => ({ templateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  versionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", mappingId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  sourceSha256: "a".repeat(64), sourceBytes: 889, mappingSha256: "b".repeat(64),
  ...Object.fromEntries(TEMPLATE_MAPPING_CHECKS.map(key => [key, true])),
  generatedFormAcceptance: false, fullD4Acceptance: false, businessAcceptance: false });
test("mapping receipt requires every explicit flow check and exact identity/hash fields", () => {
  assert.equal(validateTemplateMappingProof(receipt()).fullD4Acceptance, false);
  for (const key of TEMPLATE_MAPPING_CHECKS) {
    for (const value of [false, undefined, "true"]) {
      assert.throws(() => validateTemplateMappingProof({ ...receipt(), [key]: value }), /MAPPING_RECEIPT_INVALID/u);
    }
  }
  for (const changed of [{ templateId: "" }, { versionId: null }, { mappingId: "latest" },
    { sourceSha256: "" }, { mappingSha256: "bad" }, { sourceBytes: 0 }, { sourceBytes: 20971521 },
    { sourceBytes: 1.5 }, { fullD4Acceptance: true }, { generatedFormAcceptance: true }, { businessAcceptance: true }]) {
    assert.throws(() => validateTemplateMappingProof({ ...receipt(), ...changed }), /MAPPING_RECEIPT_INVALID/u);
  }
});

test("PDF evidence requires geometry, input methods, independent publication and actual source page binding", () => {
  const value = { ...receipt(), pagePngSha256: "c".repeat(64), pageCount: 2,
    ...Object.fromEntries(TEMPLATE_PDF_MAPPING_CHECKS.map(key => [key, true])) };
  assert.equal(validateTemplatePdfMappingProof(value), value);
  for (const key of TEMPLATE_PDF_MAPPING_CHECKS) for (const invalid of [false, undefined, "true"]) {
    assert.throws(() => validateTemplatePdfMappingProof({ ...value, [key]: invalid }), /PDF_MAPPING_RECEIPT_INVALID/u);
  }
  for (const change of [{ pagePngSha256: "" }, { pageCount: 1 }, { generatedFormAcceptance: true }]) {
    assert.throws(() => validateTemplatePdfMappingProof({ ...value, ...change }), /PDF_MAPPING_RECEIPT_INVALID/u);
  }
});
