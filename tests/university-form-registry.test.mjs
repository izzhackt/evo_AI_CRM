import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { computeUniversityFormMappingHash } from "../src/lib/university-form-fields.ts";
import {
  normalizeUniversityFormRegistryMappings, normalizeUniversityFormWorkspace,
  normalizeUniversityFormCommandReceipt, normalizePublishedUniversityForms,
} from "../src/lib/university-form-registry.ts";

const id = n => `65165000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = "a".repeat(64);
const time = "2026-09-14T10:00:00.000000+00:00";
const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const map = { slotId: "p-1", sourceKey: "student_first_name", required: true, format: "text", manual: false };
const source = { id: id(601), number: 1, revision: 2, sha256: sha, byte_size: 128, mime_type: docx, created_at: time, inspection: "pending" };
function workspace() {
  return { schema_version: 1, template: { id: id(501), organization_id: id(1), catalog_institution_id: id(401),
    catalog_source_revision: "synthetic-v1", title: "Application", revision: 3, archived: false },
  can_manage: true, publication: null, selected_version: { ...source }, versions: [{ ...source }], mappings: [], next_version_before: null, next_mapping_before: null };
}
async function mapped() {
  const w = workspace();
  const content = { versionId: id(701), templateVersionId: source.id, templateSha256: sha, mappings: [map] };
  w.mappings = [{ id: id(701), template_version_id: source.id, template_sha256: sha, sha256: await computeUniversityFormMappingHash(content),
    revision: 3, mappings: [map], created_at: time, review: null }];
  return w;
}
const error = { code: "university_form_invalid_response" };
test("missing profile/inspection does not turn declared template metadata into ready", async () => {
  const result = await normalizeUniversityFormWorkspace(workspace());
  assert.equal(result.selected_version.inspection, "pending");
  assert.equal(result.publication, null);
  assert.equal(Object.isFrozen(result.template), true);
});
test("workspace title limit matches SQL200 code points, not UTF16 units", async () => {
  const w = workspace();
  w.template.title = "a".repeat(199) + "🎓";
  assert.equal((await normalizeUniversityFormWorkspace(w)).template.title, w.template.title);
  w.template.title = "a".repeat(200) + "🎓";
  await assert.rejects(normalizeUniversityFormWorkspace(w), error);
});
test("published title limit accepts200 Unicode code points and rejects201", () => {
  const value = { schema_version: 1, catalog_institution_id: id(401), next_after_id: null,
    items: [{ id: id(501), title: "a".repeat(199) + "🎓", revision: 5, publication: {
      template_version_id: source.id, template_sha256: sha, mapping_id: id(701), mapping_sha256: sha,
      review_id: id(801), reviewer_membership_id: id(301), reviewed_at: time,
    } }] };
  assert.equal(normalizePublishedUniversityForms(value).items[0].title, value.items[0].title);
  value.items[0].title = "a".repeat(200) + "🎓";
  assert.throws(() => normalizePublishedUniversityForms(value), error);
});
test("resolver-compatible canonical mapping hash and immutable capture", async () => {
  const input = await mapped();
  const promise = normalizeUniversityFormWorkspace(input);
  input.mappings[0].mappings[0] = { ...map, sourceKey: "passport_number" };
  const result = await promise;
  assert.equal(result.mappings[0].mappings[0].sourceKey, "student_first_name");
  assert.equal(Object.isFrozen(result.mappings[0].mappings[0]), true);
});
for (const mutation of [
  w => { w.object_name = "private/secret.docx"; },
  w => { w.selected_version.source_reference = "private source"; },
  w => { w.selected_version.inspection = "clean"; },
  w => { w.selected_version.sha256 = sha.toUpperCase(); },
  w => { w.selected_version.byte_size = 20971521; },
  w => { w.template.catalog_source_revision = "bad"; },
  w => { w.template.revision = Number.MAX_SAFE_INTEGER + 1; },
  w => { w.template.archived = true; },
  w => { w.versions.push({ ...source }); },
  w => { w.next_version_before = 2; },
]) test(`workspace fails closed for ${mutation.toString()}`, async () => {
  const w = workspace(); mutation(w); await assert.rejects(normalizeUniversityFormWorkspace(w), error);
});
test("mapping hash and exact source identity cannot be swapped", async () => {
  for (const mutate of [m => { m.sha256 = "b".repeat(64); }, m => { m.template_version_id = id(999); },
    m => { m.mappings[0] = { ...map, required: false }; }, m => { m.template_sha256 = "b".repeat(64); }]) {
    const w = await mapped(); mutate(w.mappings[0]); await assert.rejects(normalizeUniversityFormWorkspace(w), error);
  }
});
test("exact approved publication requires matching trusted version and reviewer", async () => {
  const w = await mapped(); w.template.revision = 5; w.selected_version.inspection = "verified"; w.versions[0].inspection = "verified";
  w.mappings[0].review = { id: id(801), decision: "approved", reviewer_membership_id: id(301), reviewed_at: time, revision: 4 };
  w.publication = { template_version_id: source.id, template_sha256: sha, mapping_id: id(701), mapping_sha256: w.mappings[0].sha256,
    review_id: id(801), reviewer_membership_id: id(301), reviewed_at: time };
  assert.equal((await normalizeUniversityFormWorkspace(w)).publication.mapping_id, id(701));
  for (const mutate of [x => { x.selected_version.inspection = "pending"; }, x => { x.publication.review_id = id(802); },
    x => { x.mappings[0].review.decision = "rejected"; }, x => { x.publication.reviewer_membership_id = id(302); }]) {
    const bad = structuredClone(w); mutate(bad); await assert.rejects(normalizeUniversityFormWorkspace(bad), error);
  }
});
test("registry mappings use the real D2 source registry, manual flags and date formats", () => {
  assert.equal(normalizeUniversityFormRegistryMappings([{ ...map, sourceKey: "father_full_name" }], docx)[0].sourceKey, "father_full_name");
  assert.equal(normalizeUniversityFormRegistryMappings([{ ...map, sourceKey: null, manual: true }], docx)[0].manual, true);
  for (const bad of [[], [map, map], [{ ...map, sourceKey: "guessed_age" }], [{ ...map, sourceKey: null }],
    [{ ...map, manual: true }], [{ ...map, format: "DD" }], [{ ...map, actor: id(301) }], [{ ...map, position: {} }]]) {
    assert.throws(() => normalizeUniversityFormRegistryMappings(bad, docx), error);
  }
});
test("PDF geometry is bounded and hashes match existing canonical coordinate format", async () => {
  const mapping = { ...map, slotId: "pdf-1", position: { page: 1, x: 0.001, y: 23.125, width: 50, height: 12, characterCount: 10 } };
  const items = normalizeUniversityFormRegistryMappings([mapping], "application/pdf");
  const input = { versionId: id(701), templateVersionId: id(601), templateSha256: sha };
  assert.equal(await computeUniversityFormMappingHash({ ...input, mappings: items }), await computeUniversityFormMappingHash({ ...input, mappings: [mapping] }));
  assert.equal(await computeUniversityFormMappingHash({ ...input, mappings: items }), "7fbafa6e9f82ac87f19f5054e9be0d6c2e0eb63283ba8781295f4327b6700a8b");
  assert.equal(await computeUniversityFormMappingHash({ ...input, mappings: [map] }), "e7cb953650c43e8bcf49b645221cff71d670f935c52f17ed62eb9c76e62dd618");
  for (const position of [{ ...mapping.position, page: 1.5 }, { ...mapping.position, x: 0.0001 },
    { ...mapping.position, x: 1e-11 }, { ...mapping.position, width: 49 }, { ...mapping.position, y: Infinity },
    { ...mapping.position, arbitrary: 1 }]) {
    assert.throws(() => normalizeUniversityFormRegistryMappings([{ ...mapping, position }], "application/pdf"), error);
  }
});
test("20-row keyset pages preserve exact continuation without invented total counts", async () => {
  const w = workspace(); w.template.revision = 100;
  w.versions = Array.from({ length: 20 }, (_, n) => ({ ...source, id: id(1000 + n), number: 99 - n, revision: 100 - n }));
  w.next_version_before = 81;
  assert.equal((await normalizeUniversityFormWorkspace(w)).next_version_before, 81);
  w.next_version_before = 80; await assert.rejects(normalizeUniversityFormWorkspace(w), error);
});
test("command metadata is strict and never accepts claimed scan/ready/storage", () => {
  const receipt = { schema_version: 1, template_id: id(501), target_id: id(601), revision: 2, outcome: "reserve_version", replayed: false };
  assert.deepEqual(normalizeUniversityFormCommandReceipt(receipt), receipt);
  for (const bad of [{ ...receipt, scan: "clean" }, { ...receipt, outcome: "ready" }, { ...receipt, replayed: "true" }]) {
    assert.throws(() => normalizeUniversityFormCommandReceipt(bad), error);
  }
});
test("published list rejects non-published, duplicate and extra-key records", async () => {
  const value = { schema_version: 1, catalog_institution_id: id(401), items: [], next_after_id: null };
  assert.deepEqual(normalizePublishedUniversityForms(value), value);
  assert.throws(() => normalizePublishedUniversityForms({ ...value, items: [{ id: id(501), title: "Unreviewed", revision: 1, publication: null }] }), error);
});
test("installed migration deliberately has no inspection writer or provider ready shortcut", () => {
  const sql = readFileSync(new URL("../supabase/migrations/165_platform_university_form_registry.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /GRANT\s+(?:INSERT|UPDATE|ALL)\s+ON.*inspection_receipts/iu);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+platform_private\.university_form_inspection_receipts/iu);
  assert.match(sql, /require_organization_operator\(p_organization_id,'catalog\.import\.manage'\)/u);
  assert.match(sql, /inspector_revision='evo-university-template-v1'/u);
  assert.doesNotMatch(sql, /document-source-v1|INSERT INTO storage\./u);
});
