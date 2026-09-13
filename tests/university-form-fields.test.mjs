import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  computeUniversityFormMappingHash,
  getUniversityFormAssignments,
  resolveUniversityFormMappings,
} from "../src/lib/university-form-fields.ts";

const templateId = "00000000-0000-4000-8000-000000000001";
const mappingId = "00000000-0000-4000-8000-000000000002";
const reviewId = "00000000-0000-4000-8000-000000000003";
const templateHash = "a".repeat(64);
const today = "2026-09-13";

async function fixture({ required = false, sourceKey = "father_work_email", manual = false } = {}) {
  const template = { versionId: templateId, sha256: templateHash, slots: [
    { id: "p-1", text: "", context: "Email", kind: "blank", editable: true, manualReason: null },
  ] };
  const content = { versionId: mappingId, templateVersionId: templateId, templateSha256: templateHash,
    mappings: [{ slotId: "p-1", sourceKey, required, format: "text", manual }] };
  const mapping = { ...content, sha256: await computeUniversityFormMappingHash(content) };
  const review = { versionId: reviewId, templateVersionId: templateId, templateSha256: templateHash,
    mappingVersionId: mappingId, mappingSha256: mapping.sha256, state: "approved" };
  return { template, mapping, review };
}

test("confirmed NULL is retained as confirmed-empty, not fabricated or assigned", async () => {
  const input = await fixture();
  const profile = { fields: [{ key: "father_work_email", value: null, state: "confirmed" }] };
  const before = JSON.stringify({ input, profile });
  const result = await resolveUniversityFormMappings({ ...input, profile, today });
  assert.equal(result.fieldsReady, true);
  assert.equal(result.values[0].state, "confirmed_empty");
  assert.equal(result.values[0].value, "");
  assert.deepEqual(getUniversityFormAssignments(result, "final"), []);
  assert.equal(JSON.stringify({ input, profile }), before);
  assert.equal(input.mapping.sha256, createHash("sha256").update(JSON.stringify({
    versionId: mappingId, templateVersionId: templateId, templateSha256: templateHash,
    mappings: [{ slotId: "p-1", sourceKey: "father_work_email", required: false, format: "text", manual: false }],
  })).digest("hex"));
});

test("required confirmed-empty blocks final without blocking an honest draft", async () => {
  const result = await resolveUniversityFormMappings({ ...await fixture({ required: true }), today,
    profile: { fields: [{ key: "father_work_email", value: null, state: "confirmed" }] } });
  assert.equal(result.values[0].state, "confirmed_empty");
  assert.equal(result.fieldsReady, false);
  assert.throws(() => getUniversityFormAssignments(result, "final"), { code: "form_fields_not_ready" });
  assert.deepEqual(getUniversityFormAssignments(result, "draft"), []);
});

for (const [state, value, expected] of [
  ["conflict", null, "conflict"], ["conflict", "ordinary@example.test", "conflict"],
  ["extracted", null, "unconfirmed"], ["needs_review", "ordinary@example.test", "unconfirmed"],
  ["confirmed", "not an email", "invalid"],
]) test(`optional mapped ${expected} remains a final blocker (${state}/${value === null ? "empty" : "text"})`, async () => {
  const result = await resolveUniversityFormMappings({ ...await fixture(), today,
    profile: { fields: [{ key: "father_work_email", value, state }] } });
  assert.equal(result.values[0].state, expected);
  assert.equal(result.fieldsReady, false);
  assert.deepEqual(getUniversityFormAssignments(result, "draft"), []);
  assert.throws(() => getUniversityFormAssignments(result, "final"), { code: "form_fields_not_ready" });
});

test("derived names require every component confirmed and preserve Unicode", async () => {
  const input = await fixture({ sourceKey: "surname_first_name", required: true });
  const profile = { fields: [
    { key: "student_first_name", value: "Айлин", state: "confirmed" },
    { key: "student_last_name", value: "Тестовая", state: "confirmed" },
  ] };
  const result = await resolveUniversityFormMappings({ ...input, profile, today });
  assert.deepEqual(getUniversityFormAssignments(result, "final"), [{ slotId: "p-1", value: "Тестовая Айлин" }]);
  profile.fields[0].state = "needs_review";
  const changed = await resolveUniversityFormMappings({ ...input, profile, today });
  assert.equal(changed.fieldsReady, false);
  assert.equal(result.values[0].value, "Тестовая Айлин");
  assert.ok(Object.isFrozen(result.values[0]));
});

test("immutable approval binds exact mapping contents and both version identities", async () => {
  const input = await fixture();
  input.mapping.mappings[0].required = true;
  await assert.rejects(resolveUniversityFormMappings({ ...input, profile: { fields: [] }, today }), { code: "mapping_review_mismatch" });
  const changedTemplate = await fixture();
  changedTemplate.template.sha256 = "b".repeat(64);
  await assert.rejects(resolveUniversityFormMappings({ ...changedTemplate, profile: { fields: [] }, today }), { code: "mapping_review_mismatch" });
  const rejected = await fixture();
  rejected.review.state = "rejected";
  const result = await resolveUniversityFormMappings({ ...rejected, profile: { fields: [] }, today });
  assert.equal(result.fieldsReady, false);
  assert.throws(() => getUniversityFormAssignments(result, "draft"), { code: "mapping_not_approved" });
});

test("explicit manual mappings and inspection-locked slots cannot become text assignments", async () => {
  for (const input of [await fixture({ sourceKey: null, manual: true }), await fixture()]) {
    input.template.slots[0].editable = false;
    input.template.slots[0].manualReason = "Applicant signature";
    const result = await resolveUniversityFormMappings({ ...input, profile: { fields: [] }, today });
    assert.equal(result.values[0].state, "manual");
    assert.equal(result.fieldsReady, false);
    assert.deepEqual(getUniversityFormAssignments(result, "draft"), []);
  }
});

test("date formatting applies only to a canonical date field", async () => {
  const input = await fixture({ sourceKey: "date_of_birth" });
  input.mapping.mappings[0].format = "DD.MM.YYYY";
  input.mapping.sha256 = await computeUniversityFormMappingHash(input.mapping);
  input.review.mappingSha256 = input.mapping.sha256;
  const result = await resolveUniversityFormMappings({ ...input, today,
    profile: { fields: [{ key: "date_of_birth", value: "2006-02-03", state: "confirmed" }] } });
  assert.deepEqual(getUniversityFormAssignments(result, "final"), [{ slotId: "p-1", value: "03.02.2006" }]);
});

test("canonical mapping hash is order-independent but binds required/manual/source decisions", async () => {
  const { mapping } = await fixture();
  mapping.mappings.push({ slotId: "p-2", sourceKey: "student_first_name", required: true, manual: false, format: "text" });
  const hash = await computeUniversityFormMappingHash(mapping);
  mapping.mappings.reverse();
  assert.equal(await computeUniversityFormMappingHash(mapping), hash);
  mapping.mappings[0].sourceKey = "student_last_name";
  assert.notEqual(await computeUniversityFormMappingHash(mapping), hash);
});

test("ordinary over-limit values remain invalid and are never silently truncated", async () => {
  const input = await fixture({ sourceKey: "student_first_name" });
  const result = await resolveUniversityFormMappings({ ...input, today,
    profile: { fields: [{ key: "student_first_name", value: "😀".repeat(61), state: "confirmed" }] } });
  assert.equal(result.values[0].state, "invalid");
  assert.deepEqual(getUniversityFormAssignments(result, "draft"), []);
});

test("missing optional values differ from confirmed-empty; required absence blocks final", async () => {
  const optional = await resolveUniversityFormMappings({ ...await fixture(), profile: { fields: [] }, today });
  assert.equal(optional.values[0].state, "missing");
  assert.equal(optional.fieldsReady, true);
  const required = await resolveUniversityFormMappings({ ...await fixture({ required: true }), profile: { fields: [] }, today });
  assert.equal(required.fieldsReady, false);
});

test("resolution captures inputs before async hashing and cannot be edited after return", async () => {
  const input = await fixture();
  const profile = { fields: [{ key: "father_work_email", value: "synthetic@example.test", state: "confirmed" }] };
  const promise = resolveUniversityFormMappings({ ...input, profile, today });
  profile.fields[0].value = "changed@example.test";
  const result = await promise;
  assert.equal(result.values[0].value, "synthetic@example.test");
  assert.throws(() => { result.values[0].value = "other@example.test"; }, TypeError);
  assert.throws(() => getUniversityFormAssignments({ ...result }, "final"), { code: "invalid_mapping_resolution" });
});

async function pdfFixture() {
  const input = await fixture({ sourceKey: "student_first_name" });
  input.template = { ...input.template, format: "pdf", pageSizes: [{ width: 612, height: 792 }],
    slots: [{ ...input.template.slots[0], id: "pdf-1" }] };
  input.mapping.mappings[0] = { ...input.mapping.mappings[0], slotId: "pdf-1",
    position: { page: 1, x: 20, y: 30, width: 120, height: 24, characterCount: 12 } };
  input.mapping.sha256 = await computeUniversityFormMappingHash(input.mapping);
  input.review.mappingSha256 = input.mapping.sha256;
  return input;
}

test("PDF review hash binds every coordinate and character count", async () => {
  for (const key of ["page", "x", "y", "width", "height", "characterCount"]) {
    const input = await pdfFixture();
    input.mapping.mappings[0].position[key] += 1;
    assert.notEqual(await computeUniversityFormMappingHash(input.mapping), input.mapping.sha256);
    await assert.rejects(resolveUniversityFormMappings({ ...input, profile: { fields: [] }, today }), { code: "mapping_review_mismatch" });
  }
});

test("PDF mapping snapshots retain immutable positions and visible page geometry", async () => {
  const input = await pdfFixture();
  const pending = resolveUniversityFormMappings({ ...input, profile: { fields: [{ key: "student_first_name", value: "Synthetic", state: "confirmed" }] }, today });
  input.mapping.mappings[0].position.x = 42;
  input.template.pageSizes[0].width = 600;
  const resolved = await pending;
  assert.equal(resolved.templateFormat, "pdf");
  assert.equal(resolved.values[0].position.x, 20);
  assert.equal(resolved.pageSizes[0].width, 612);
  assert.throws(() => { resolved.values[0].position.x = 100; }, TypeError);
  assert.throws(() => { resolved.pageSizes[0].width = 600; }, TypeError);
});

test("DOCX and PDF mapping representations cannot be mixed or omit positions", async () => {
  const mixed = await pdfFixture();
  mixed.template.format = "docx";
  await assert.rejects(resolveUniversityFormMappings({ ...mixed, profile: { fields: [] }, today }), { code: "invalid_mapping_snapshot" });
  const absent = await pdfFixture();
  delete absent.mapping.mappings[0].position;
  absent.mapping.sha256 = await computeUniversityFormMappingHash(absent.mapping);
  absent.review.mappingSha256 = absent.mapping.sha256;
  await assert.rejects(resolveUniversityFormMappings({ ...absent, profile: { fields: [] }, today }), { code: "invalid_mapping_snapshot" });
});
