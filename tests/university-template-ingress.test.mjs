import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUniversityFormManagerTemplates, normalizeUniversityTemplateInspectionMetadata,
  normalizeUniversityTemplateIngressReceipt, normalizeUniversityTemplateManifest } from "../src/lib/university-template-ingress.ts";

const catalog = "71000000-0000-4000-8000-000000000001";
const template = "71000000-0000-4000-8000-000000000002";
const version = "71000000-0000-4000-8000-000000000003";

test("manager cold resume retains a draft without a source version or publication", () => {
  const listing = normalizeUniversityFormManagerTemplates({
    schema_version: 1, catalog_institution_id: catalog,
    items: [{ id: template, title: "Synthetic form", revision: 1, archived: false,
      catalog_source_revision: "synthetic-r1", source_current: true, latest_version: null, publication: null }],
    next_after_id: null,
  }, catalog);
  assert.equal(listing.items[0].id, template);
  assert.equal(listing.items[0].publication, null);
  assert.equal(listing.items[0].latest_version, null);
  assert.ok(Object.isFrozen(listing.items[0]));
});

const pendingReceipt = () => ({ schema_version: 1, ingress_id: "71000000-0000-4000-8000-000000000005",
  template_id: template, template_version_id: version, request_id: "71000000-0000-4000-8000-000000000006",
  revision: 2, state: "unknown", sha256: "a".repeat(64), byte_size: 100, inspection_receipt_id: null,
  failure_code: "storage_unavailable", replayed: false, can_reconcile: true, can_cancel: true });

test("unknown receipt remains visibly unverified and preserves its original request identity", () => {
  const raw = pendingReceipt(), result = normalizeUniversityTemplateIngressReceipt(raw, template, version);
  assert.equal(result.state, "unknown");
  assert.equal(result.inspection_receipt_id, null);
  assert.equal(result.request_id, raw.request_id);
  assert.ok(Object.isFrozen(result));
});

for (const [name, changed] of [
  ["foreign template", { template_id: catalog }], ["foreign version", { template_version_id: catalog }],
  ["non-UUID request", { request_id: "invalid" }], ["unknown state", { state: "success" }],
  ["raw failure text", { failure_code: "Storage error with private details" }], ["zero bytes", { byte_size: 0 }],
  ["too many bytes", { byte_size: 20 * 1024 * 1024 + 1 }], ["missing hash", { sha256: null }],
  ["unsafe revision", { revision: Number.MAX_SAFE_INTEGER + 1 }], ["extra storage key", { object_name: "hidden" }],
  ["unproved verified state", { state: "verified", failure_code: null, can_reconcile: false, can_cancel: false }],
  ["claim leaked", { claim_token: catalog }], ["cancelled without its outcome", { state: "cancelled", can_cancel: false, can_reconcile: false }],
]) test(`ingress receipt rejects ${name}`, () => {
  assert.throws(() => normalizeUniversityTemplateIngressReceipt({ ...pendingReceipt(), ...changed }, template, version));
});

test("DOCX metadata keeps actual slot sequence and manual-only capability without text", () => {
  const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const raw = { format: "docx", slots: [{ id: "p-1", editable: false }, { id: "p-2", editable: true }], pageSizes: [] };
  const actual = normalizeUniversityTemplateManifest(raw, mime);
  assert.deepEqual(actual.slots, raw.slots);
  assert.ok(Object.isFrozen(actual.slots[0]));
  for (const bad of [
    { ...raw, slots: [] }, { ...raw, slots: [{ id: "p-2", editable: true }] },
    { ...raw, slots: [{ id: "p-1", editable: true, text: "private" }] },
    { ...raw, slots: [{ id: "p-1", editable: "yes" }] }, { ...raw, pageSizes: [{ width: 595, height: 842 }] },
  ]) assert.throws(() => normalizeUniversityTemplateManifest(bad, mime));
});

test("PDF metadata rejects invalid page bounds and nonminimal structures", () => {
  for (const pages of [[], [{ width: 71, height: 842 }], [{ width: 595, height: 3001 }],
    [{ width: Infinity, height: 842 }], [{ width: 595, height: 842, text: "private" }],
    Array.from({ length: 101 }, () => ({ width: 595, height: 842 }))]) {
    assert.throws(() => normalizeUniversityTemplateManifest({ format: "pdf", slots: [], pageSizes: pages }, "application/pdf"));
  }
});

test("manager pagination rejects duplicates, foreign catalogues and active archived entries", () => {
  const item = { id: template, title: "Synthetic", revision: 1, archived: false, catalog_source_revision: "r1",
    source_current: true, latest_version: null, publication: null };
  const raw = { schema_version: 1, catalog_institution_id: catalog, items: [item], next_after_id: null };
  for (const bad of [
    { ...raw, catalog_institution_id: template }, { ...raw, items: [item, item] }, { ...raw, next_after_id: template },
    { ...raw, items: [{ ...item, archived: true }] }, { ...raw, items: [{ ...item, source_key: "hidden" }] },
    { ...raw, items: [{ ...item, title: "\u0000" }] },
  ]) assert.throws(() => normalizeUniversityFormManagerTemplates(bad, catalog));
});

test("safe PDF metadata exposes actual pages without inventing editable slots", () => {
  // This is a DTO parser fixture, not a scan, Storage or trusted-writer receipt.
  const raw = { schema_version: 1, template_id: template, template_version_id: version,
    template_sha256: "a".repeat(64), mime_type: "application/pdf", template_revision: 3, source_current: true,
    inspection: "verified", manifest: { format: "pdf", slots: [], pageSizes: [{ width: 595, height: 842 }] },
    receipt_id: "71000000-0000-4000-8000-000000000004", inspected_at: "2026-09-14T00:00:00Z", ingress: null };
  const metadata = normalizeUniversityTemplateInspectionMetadata(raw, template, version);
  assert.deepEqual(metadata.manifest.pageSizes, [{ width: 595, height: 842 }]);
  assert.deepEqual(metadata.manifest.slots, []);
  assert.throws(() => normalizeUniversityTemplateInspectionMetadata({ ...raw,
    manifest: { ...raw.manifest, slots: [{ id: "pdf-1", editable: true }] } }, template, version));
  assert.throws(() => normalizeUniversityTemplateInspectionMetadata({ ...raw, object_name: "hidden" }, template, version));
});
