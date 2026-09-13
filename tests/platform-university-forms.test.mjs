import assert from "node:assert/strict";
import test from "node:test";
import { getPlatformUniversityFormManagerTemplates, createPlatformUniversityFormTemplate, reservePlatformUniversityFormVersion,
  savePlatformUniversityFormMapping, reviewPlatformUniversityFormMapping, publishPlatformUniversityFormTemplate,
  archivePlatformUniversityFormTemplate, getPlatformUniversityTemplateInspection } from "../src/lib/platform-university-forms.ts";

const catalog = "72000000-0000-4000-8000-000000000001";
const template = "72000000-0000-4000-8000-000000000002";
const org = "72000000-0000-4000-8000-000000000003";
const request = "72000000-0000-4000-8000-000000000004";
// Session transport fixtures verify only the adapter contract, not database success.
const session = (reply, verify = () => {}) => ({ schema(name) { assert.equal(name, "platform");
  return { rpc(rpc, args) { verify(rpc, args); return Promise.resolve(reply); } }; } });

test("manager session reader fails closed if the catalogue response is for another institution", async () => {
  await assert.rejects(getPlatformUniversityFormManagerTemplates(session({ data: {
    schema_version: 1, catalog_institution_id: template, items: [], next_after_id: null }, error: null }),
  { p_catalog_institution_id: catalog }), { code: "unavailable" });
});

for (const [name, invoke, outcome, rpcName] of [
  ["reserve", reservePlatformUniversityFormVersion, "reserve_version", "reserve_university_form_version"],
  ["save", savePlatformUniversityFormMapping, "save_mapping", "save_university_form_mapping"],
  ["review", reviewPlatformUniversityFormMapping, "review_mapping", "review_university_form_mapping"],
  ["publish", publishPlatformUniversityFormTemplate, "publish", "publish_university_form_template"],
  ["archive", archivePlatformUniversityFormTemplate, "archive", "archive_university_form_template"],
]) test(`${name} command adapter retains the existing typed RPC outcome and rejects foreign receipts`, async () => {
  const args = { p_organization_id: org, p_template_id: template, p_expected_revision: 2, p_request_id: request,
    p_reason: "Synthetic protocol fixture", ...(name === "save" || name === "publish" ? { p_mapping_id: catalog } : {}) };
  const raw = { schema_version: 1, template_id: template, target_id: name === "archive" ? template : catalog,
    revision: 3, outcome, replayed: true };
  const actual = await invoke(session({ data: raw, error: null }, (rpc, received) => {
    assert.equal(rpc, rpcName); assert.deepEqual(received, args);
  }), args);
  assert.equal(actual.outcome, outcome);
  assert.equal(actual.replayed, true);
  for (const changed of [{ template_id: catalog }, { revision: 4 }, { outcome: "create" }, { object_name: "hidden" }]) {
    await assert.rejects(invoke(session({ data: { ...raw, ...changed }, error: null }), args), { code: "unavailable" });
  }
});

for (const [code, expected] of [["42501", "forbidden"], ["40001", "stale_revision"], ["23505", "request_conflict"],
  ["22023", "invalid_request"], ["unknown", "unavailable"]]) test(`session error ${code} becomes a fixed outcome without raw details`, async () => {
  await assert.rejects(getPlatformUniversityFormManagerTemplates(session({ data: null, error: { code, message: "private detail" } }),
    { p_catalog_institution_id: catalog }), error => error.code === expected && error.message === expected);
});

test("inspection session adapter rejects a manifest attached to pending metadata", async () => {
  await assert.rejects(getPlatformUniversityTemplateInspection(session({ data: { schema_version: 1, template_id: template,
    template_version_id: catalog, template_sha256: "a".repeat(64), mime_type: "application/pdf", template_revision: 2,
    source_current: true, inspection: "pending", manifest: { format: "pdf", slots: [], pageSizes: [{ width: 595, height: 842 }] },
    receipt_id: null, inspected_at: null, ingress: null }, error: null }),
  { p_template_id: template, p_template_version_id: catalog }), { code: "unavailable" });
});

test("create session wrapper preserves exact command identity and validates the receipt", async () => {
  const args = { p_organization_id: org, p_template_id: template, p_expected_revision: 0, p_request_id: request,
    p_reason: "Synthetic contract test", p_catalog_institution_id: catalog, p_title: "Synthetic template" };
  const result = await createPlatformUniversityFormTemplate(session({ data: {
    schema_version: 1, template_id: template, target_id: template, revision: 1, outcome: "create", replayed: false }, error: null },
  (rpc, actual) => { assert.equal(rpc, "create_university_form_template"); assert.deepEqual(actual, args); }), args);
  assert.equal(result.revision, 1);
  assert.equal(result.template_id, template);
});
