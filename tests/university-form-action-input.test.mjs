import assert from "node:assert/strict";
import test from "node:test";
import { parseUniversityFormCreate, parseUniversityFormVersion } from "../src/lib/server/university-form-action-input.ts";
import { createHash } from "node:crypto";
import { prepareUniversityTemplateFile, universityTemplateSourceUrl } from "../src/lib/university-template-upload-client.ts";

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

const reservation = { operation: "reserve_version", template_id: template, request_id: request, expected_revision: "2",
  reason: "Версия из письма партнёра", sha256: "a".repeat(64), byte_size: "128", mime_type: "application/pdf",
  source_reference: "Приёмная комиссия", source_date: "2026-09-14" };
function versionForm(overrides = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ ...reservation, ...overrides })) result.set(key, value);
  return result;
}
test("version reservation is exact metadata, never bytes, private path or scan proof", () => {
  assert.equal(parseUniversityFormVersion(versionForm()).p_byte_size, 128);
  for (const key of ["file", "object_name", "organization_id", "actor_id", "manifest", "inspection_receipt_id", "scan_passed"])
    assert.equal(parseUniversityFormVersion(versionForm({ [key]: "untrusted" })), null, key);
  const duplicate = versionForm(); duplicate.append("request_id", request);
  assert.equal(parseUniversityFormVersion(duplicate), null);
});
test("reservation validates exact hash, MIME, byte and revision boundaries", () => {
  for (const override of [{ sha256: "A".repeat(64) }, { sha256: "a".repeat(63) }, { mime_type: "text/html" },
    { byte_size: "0" }, { byte_size: "20971521" }, { byte_size: "1.0" }, { byte_size: "01" },
    { expected_revision: "0" }, { expected_revision: "01" }, { expected_revision: "9007199254740991" },
    { template_id: "../escape" }, { request_id: "bad" }, { reason: "" }, { source_reference: "\u0085" }])
    assert.equal(parseUniversityFormVersion(versionForm(override)), null, JSON.stringify(override));
  assert.equal(parseUniversityFormVersion(versionForm({ byte_size: "20971520" })).p_byte_size, 20971520);
});
test("source date is a real bounded calendar day, including leap-year behavior", () => {
  for (const source_date of ["2026-02-29", "2026-04-31", "2026-13-01", "1899-12-31", "2101-01-01", "2026-9-1"])
    assert.equal(parseUniversityFormVersion(versionForm({ source_date })), null, source_date);
  assert.equal(parseUniversityFormVersion(versionForm({ source_date: "2024-02-29" })).p_source_date, "2024-02-29");
});
test("actual File and WebCrypto bind a browser declaration to exact immutable bytes", async () => {
  const file = new File(["%PDF-synthetic source only"], "template.pdf", { type: "application/pdf" });
  const result = await prepareUniversityTemplateFile(file);
  assert.equal(result.file, file);
  assert.equal(result.byteSize, file.size);
  assert.equal(result.sha256, createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex"));
  assert.equal(result.mime, "application/pdf");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(await prepareUniversityTemplateFile(new File(["declared only"], "form.docx")).then(v => v.mime),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  await assert.rejects(prepareUniversityTemplateFile(new File([], "empty.pdf")), /file_invalid/u);
  await assert.rejects(prepareUniversityTemplateFile(new File(["html"], "x.pdf", { type: "text/html" })), /file_invalid/u);
  await assert.rejects(prepareUniversityTemplateFile(new File(["x"], "unknown")), /file_invalid/u);
});
test("source URL is the exact version endpoint, never a user-supplied path", () => {
  assert.equal(universityTemplateSourceUrl(template, request), `/api/v3/university-forms/${template}/versions/${request}/source`);
  for (const id of ["../escape", `${template}/extra`, "https://example.com", ""])
    assert.throws(() => universityTemplateSourceUrl(id, request));
});
