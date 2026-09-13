import assert from "node:assert/strict";
import test from "node:test";
import { parseUniversityFormManagement } from "../src/lib/server/university-form-management-input.ts";

const template = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", request = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const mapping = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", version = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const common = { template_id: template, request_id: request, expected_revision: "3", reason: "Настройка бланка" };
const row = { slotId: "p-1", sourceKey: "student_first_name", required: true, manual: false, format: "text" };
const save = { ...common, operation: "save_mapping", mapping_id: mapping, template_version_id: version,
  template_sha256: "a".repeat(64), mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", mappings: JSON.stringify([row]) };
const review = { ...common, operation: "review_mapping", mapping_id: mapping, mapping_sha256: "b".repeat(64), decision: "approved", confirmed: "yes" };
const publish = { ...common, operation: "publish", mapping_id: mapping, mapping_sha256: "b".repeat(64), review_id: version, confirmed: "yes" };
const archive = { ...common, operation: "archive", confirmed: "yes" };
function form(values) { const result = new FormData(); for (const [key, value] of Object.entries(values)) result.set(key, value); return result; }

test("mapping intent binds exact version/hash and uses existing mapping normalization", () => {
  const result = parseUniversityFormManagement(form(save));
  assert.equal(result.operation, "save_mapping");
  assert.equal(result.args.p_template_version_id, version);
  assert.equal(result.args.p_template_sha256, "a".repeat(64));
  assert.deepEqual(result.args.p_mappings, [row]);
  assert.equal(Object.hasOwn(result.args, "p_organization_id"), false);
});
test("all commands reject missing, duplicate, actor, source-manifest and scan-proof fields", () => {
  for (const command of [save, review, publish, archive]) {
    assert.ok(parseUniversityFormManagement(form(command)));
    for (const key of Object.keys(command)) {
      const missing = form(command); missing.delete(key); assert.equal(parseUniversityFormManagement(missing), null, key);
      const duplicate = form(command); duplicate.append(key, command[key]); assert.equal(parseUniversityFormManagement(duplicate), null, key);
    }
    for (const key of ["organization_id", "actor_id", "source_manifest", "scan_receipt", "object_path"])
      assert.equal(parseUniversityFormManagement(form({ ...command, [key]: "untrusted" })), null);
  }
});
test("review, publication and archive require explicit confirmation with exact identities", () => {
  for (const command of [review, publish, archive]) for (const confirmed of ["", "false", "on"])
    assert.equal(parseUniversityFormManagement(form({ ...command, confirmed })), null);
  assert.equal(parseUniversityFormManagement(form({ ...review, decision: "draft" })), null);
  assert.equal(parseUniversityFormManagement(form({ ...publish, review_id: "another" })), null);
});
test("malformed or contradictory mappings fail before session RPC", () => {
  for (const mappings of ["[", "{}", "[]", JSON.stringify([row, row]), JSON.stringify([{ ...row, manual: true }]),
    JSON.stringify([{ ...row, sourceKey: "assessment_result" }]), JSON.stringify([{ ...row, format: "DD" }])])
    assert.equal(parseUniversityFormManagement(form({ ...save, mappings })), null);
  assert.equal(parseUniversityFormManagement(form({ ...save, mime_type: "application/pdf" })), null);
  assert.equal(parseUniversityFormManagement(form({ ...save, template_sha256: "A".repeat(64) })), null);
});
test("canonical revisions and bounded reasons are required", () => {
  for (const expected_revision of ["0", "03", "3.0", "1e3", "9007199254740991"])
    assert.equal(parseUniversityFormManagement(form({ ...archive, expected_revision })), null);
  for (const reason of ["", "\n", "x".repeat(501), "x\u0000"])
    assert.equal(parseUniversityFormManagement(form({ ...archive, reason })), null);
});
test("React action-state envelope does not change intent or accept extra authority", () => {
  const wrapped = new FormData(); wrapped.set("0", "[]"); wrapped.set("_1_$ACTION_KEY", "framework-key");
  for (const [key, value] of Object.entries(save)) wrapped.set(`_1_${key}`, value);
  assert.deepEqual(parseUniversityFormManagement(wrapped), parseUniversityFormManagement(form(save)));
  wrapped.set("_1_organization_id", template);
  assert.equal(parseUniversityFormManagement(wrapped), null);
});
