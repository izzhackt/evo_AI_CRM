import assert from "node:assert/strict";
import test from "node:test";
import { parseUniversityFormCreate } from "../src/lib/server/university-form-action-input.ts";

const catalog = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const template = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const intent = {
  operation: "create", catalog_id: catalog, template_id: template, request_id: request,
  expected_revision: "0", title: "Заявление на поступление", reason: "Добавление бланка университета",
};
function form(overrides = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ ...intent, ...overrides })) result.append(key, value);
  return result;
}

test("create intent contains only the catalogue/template/request and editable metadata", () => {
  assert.deepEqual(parseUniversityFormCreate(form({ title: `  ${intent.title}  ` })), {
    p_catalog_institution_id: catalog, p_template_id: template, p_request_id: request,
    p_expected_revision: 0, p_title: intent.title, p_reason: intent.reason,
  });
});

test("actor, scan proof, private object path and unknown operations are not browser authority", () => {
  for (const override of [
    { organization_id: catalog }, { actor_id: request }, { scanned: "true" },
    { object_path: "private/file.docx" }, { operation: "publish" }, { expected_revision: "1" },
  ]) assert.equal(parseUniversityFormCreate(form(override)), null);
});

test("duplicate or missing fields and file payload fail closed", () => {
  for (const key of Object.keys(intent)) {
    const duplicate = form(); duplicate.append(key, intent[key]);
    assert.equal(parseUniversityFormCreate(duplicate), null, key);
    const missing = form(); missing.delete(key);
    assert.equal(parseUniversityFormCreate(missing), null, key);
  }
  const file = form(); file.set("title", new Blob(["not metadata"]));
  assert.equal(parseUniversityFormCreate(file), null);
});

test("invalid identifiers and noncanonical initial revisions fail closed", () => {
  for (const key of ["catalog_id", "template_id", "request_id"]) {
    for (const value of ["", "../another", "not-an-id", `${catalog}?`])
      assert.equal(parseUniversityFormCreate(form({ [key]: value })), null);
  }
  for (const value of ["00", "0.0", " 0", "-1", "1e0"])
    assert.equal(parseUniversityFormCreate(form({ expected_revision: value })), null);
});

test("Russian and supplementary Unicode names obey PostgreSQL code-point limits", () => {
  assert.equal(parseUniversityFormCreate(form({ title: "𐐀".repeat(200) })).p_title.length, 400);
  assert.equal(parseUniversityFormCreate(form({ title: "𐐀".repeat(201) })), null);
  for (const value of [" ", "Name\u0000", "Name\nname", "Name\u0085"])
    assert.equal(parseUniversityFormCreate(form({ title: value })), null);
  assert.equal(parseUniversityFormCreate(form({ reason: "x".repeat(501) })), null);
});

test("React action envelope parses without treating framework metadata as application data", () => {
  const wrapped = new FormData(); wrapped.set("0", "[]"); wrapped.set("_1_$ACTION_KEY", "framework-key");
  for (const [key, value] of Object.entries(intent)) wrapped.set(`_1_${key}`, value);
  assert.deepEqual(parseUniversityFormCreate(wrapped), parseUniversityFormCreate(form()));
  wrapped.append("_1_organization_id", catalog);
  assert.equal(parseUniversityFormCreate(wrapped), null);
});
