import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { formInput } from "./helpers/university-form-input.mjs";
import { encodeUniversityFormCapsule, normalizeUniversityFormRequest, parseUniversityFormRenderMetadata } from "../src/lib/university-form-render.ts";
import { parseUniversityFormRenderFrame } from "../src/lib/server/university-template-preflight.ts";
import { computePackageGeneratedInputHash } from "../src/lib/document-package.ts";

test("package projection matches SQL167 actual PostgreSQL golden, not JSONB logical-input serialization", async () => {
  const id = n => `64167000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  assert.equal(await computePackageGeneratedInputHash({ kind: "university_form", organizationId: id(1), studentCaseId: id(501),
    profileId: id(701), profileRevision: 2, fieldReviewsSha256: "a".repeat(64), templateSha256: "b".repeat(64),
    applicationId: id(601), catalogInstitutionId: id(702), templateVersionId: id(703), mappingVersionId: id(901),
    mappingSha256: "c".repeat(64), mappingReviewVersionId: id(704) }), "35cead709586de4efb4c954d78420cb39ddeff5a48fab971fb8bb489f5a3a35e");
});

test("form wire canonical capsule binds private input without confusing SQL hashes with transport hashes", () => {
  const request = { operation: "render-form-v1", formInput: formInput(), binding: {
    artifactId: "64167000-0000-4000-8000-000000000011", preparationId: "64167000-0000-4000-8000-000000000012",
    inputSnapshotSha256: "1".repeat(64), generatedInputSha256: "2".repeat(64), fieldReviewsSha256: "3".repeat(64),
  } };
  const encoded = encodeUniversityFormCapsule(request);
  assert.equal(new TextDecoder().decode(encoded).startsWith('{"binding":{"artifactId":'), true);
  assert.deepEqual(normalizeUniversityFormRequest(JSON.parse(new TextDecoder().decode(encoded))), normalizeUniversityFormRequest(request));
  for (const input of [{ ...request, path: "/private" }, { ...request, operation: ["render-form-v1"] },
    { ...request, binding: { ...request.binding, inputSnapshotSha256: ["1".repeat(64)] } }]) {
    assert.throws(() => encodeUniversityFormCapsule(input));
  }
});

test("EUF1 rejects PNG envelopes, corrupt length/UTF-8 and array rejection codes without launching a parser", () => {
  const frame = (metadata, magic = "EUF1") => {
    const bytes = Buffer.isBuffer(metadata) ? metadata : Buffer.from(JSON.stringify(metadata));
    const prefix = Buffer.alloc(12); prefix.write(magic); prefix.writeUInt32BE(bytes.length, 4);
    return Buffer.concat([prefix, bytes]);
  };
  assert.deepEqual(parseUniversityFormRenderFrame(frame({ status: "rejected", code: "form_not_ready" }), {}), { status: "rejected", code: "form_not_ready" });
  for (const invalid of [frame({ status: "rejected", code: ["form_not_ready"] }), frame({ status: "rejected", code: "form_not_ready" }, "EUP1"),
    frame(Buffer.from([0xff])), frame(Buffer.from('{"status":"rendered","status":"rejected","code":"form_not_ready"}')),
    (() => { const result = frame({ status: "rejected", code: "form_not_ready" }); result[0] |= 128; return result; })(),
    Buffer.alloc(12), Buffer.alloc(20975629)]) assert.equal(parseUniversityFormRenderFrame(invalid, {}), null);
});

test("render proof accepts only complete typed exact-bound metadata; no array enum or mutable nested counts", () => {
  const request = normalizeUniversityFormRequest({ operation: "render-form-v1", formInput: formInput(), binding: {
    artifactId: "64167000-0000-4000-8000-000000000011", preparationId: "64167000-0000-4000-8000-000000000012",
    inputSnapshotSha256: "1".repeat(64), generatedInputSha256: "2".repeat(64), fieldReviewsSha256: "3".repeat(64),
  } });
  const expected = { request, capsuleSha256: "4".repeat(64), manifestDigest: "5".repeat(64) };
  const metadata = { status: "rendered", policyVersion: "evo-university-form-render-v1", ...request.binding,
    capsuleSha256: expected.capsuleSha256, templateSha256: request.formInput.template.sha256, sourceByteLength: 100,
    manifestSha256: request.formInput.manifest_sha256, manifestDigest: expected.manifestDigest, mode: "final",
    mimeType: request.formInput.source_mime_type, rendererVersion: "evo-university-form-docx-v1", rendererId: "pizzip-3.2.0-xmldom-0.9.12",
    fontSha256: null, pageCount: null, outputByteLength: 100, outputSha256: "6".repeat(64),
    counts: { confirmed: 1, confirmed_empty: 0, missing: 0, unconfirmed: 0, conflict: 0, invalid: 0, manual: 0 }, warnings: ["layout_review_required"] };
  const result = parseUniversityFormRenderMetadata(metadata, expected);
  assert.deepEqual(result, metadata); assert.ok(Object.isFrozen(result.counts)); assert.ok(Object.isFrozen(result.warnings));
  for (const key of Object.keys(metadata)) for (const bad of [[], [[metadata[key]]], {}, null]) {
    if (["fontSha256", "pageCount"].includes(key) && bad === null) continue;
    assert.equal(parseUniversityFormRenderMetadata({ ...metadata, [key]: bad }, expected), null, key);
  }
  const body = Buffer.alloc(20 * 1024 * 1024); body.set([0x50, 0x4b, 3, 4]);
  const large = { ...metadata, outputByteLength: body.length, outputSha256: createHash("sha256").update(body).digest("hex") };
  const json = Buffer.from(JSON.stringify(large)), prefix = Buffer.alloc(12); prefix.write("EUF1"); prefix.writeUInt32BE(json.length, 4); prefix.writeUInt32BE(body.length, 8);
  const wire = Buffer.concat([prefix, json, body]);
  assert.equal(parseUniversityFormRenderFrame(wire, expected)?.status, "rendered");
  assert.equal(parseUniversityFormRenderFrame(Buffer.concat([wire, Buffer.from([0])]), expected), null);
  wire[wire.length - 1] = 1; assert.equal(parseUniversityFormRenderFrame(wire, expected), null);
});
