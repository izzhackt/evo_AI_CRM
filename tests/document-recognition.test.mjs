import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DOCUMENT_RECOGNITION_CLEANUP_STATES,
  DOCUMENT_RECOGNITION_LIMITS,
  DOCUMENT_RECOGNITION_RESULT_SCHEMA,
  DOCUMENT_RECOGNITION_STATES,
  DocumentRecognitionValidationError,
  canonicalDocumentRecognitionFingerprint,
  documentRecognitionFingerprint,
  documentRecognitionResultSha256,
  normalizeDocumentRecognitionJob,
  normalizeDocumentRecognitionReceipt,
  normalizeDocumentRecognitionRequest,
  normalizeDocumentRecognitionResult,
  parseDocumentRecognitionResultJson,
} from "../src/lib/document-recognition.ts";
import { PROFILE_FIELDS, PROFILE_FIELD_KEYS } from "../src/lib/student-profile-fields.ts";

const ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const SOURCE = Object.freeze({ mime_type: "application/pdf", page_count: 3 });
const REQUEST = Object.freeze({
  source_version_id: ID, expected_profile_revision: 1, request_id: OTHER_ID, retry_of_job_id: null,
});
const CANDIDATE = Object.freeze({
  key: "student_first_name", value: "  Synthetic  ", source_page: 2,
  source_snippet: "Synthetic source excerpt", confidence: 0.75,
});
const RESULT = Object.freeze({ candidates: Object.freeze([CANDIDATE]), warnings: Object.freeze([]) });
const FINGERPRINT = Object.freeze({
  organization_id: ID, student_case_id: ID, student_profile_id: ID,
  source_document_slot_id: ID, source_version_id: ID,
  source_sha256: "a".repeat(64), source_bytes: 1000,
  source_mime: "application/pdf", source_pages: 3,
  actor_auth_user_id: ID, actor_membership_id: ID,
  purpose: "student_profile", extraction_mode: "student_profile_fields",
  registry_version: "profile-61-v1", schema_version: 1,
  prompt_policy_version: "extract-v1", config_version: "synthetic-v1",
  provider_project_id: "synthetic-project", model: "gemini-3.7-flash",
  expected_profile_revision: 1, retry_of_job_id: null,
});
const JOB = Object.freeze({
  job_id: ID, source_version_id: OTHER_ID, state: "review_ready",
  cleanup_state: "pending", proposal_count: 1, failure_code: null,
  updated_at: "2026-09-13T15:00:00.123456+00:00",
});

function rejects(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof DocumentRecognitionValidationError);
    assert.equal(error.code, code);
    assert.equal(error.message, "Invalid document recognition data");
    return true;
  });
}

test("request has exact fields, explicit retry identity and safe original revision", () => {
  assert.deepEqual(normalizeDocumentRecognitionRequest(REQUEST), REQUEST);
  assert.ok(Object.isFrozen(normalizeDocumentRecognitionRequest(REQUEST)));
  for (const input of [null, [], { ...REQUEST, extra: true }, { ...REQUEST, retry_of_job_id: undefined },
    { ...REQUEST, source_version_id: "not-a-uuid" }, { ...REQUEST, expected_profile_revision: 0 },
    { ...REQUEST, expected_profile_revision: 1.5 }, { ...REQUEST, expected_profile_revision: Number.MAX_SAFE_INTEGER + 1 }]) {
    rejects(() => normalizeDocumentRecognitionRequest(input), "invalid_request");
  }
  assert.equal(normalizeDocumentRecognitionRequest({ ...REQUEST, retry_of_job_id: OTHER_ID }).retry_of_job_id, OTHER_ID);
});

test("structured output schema derives all 61 keys and common bounds from the existing registry", () => {
  const schema = DOCUMENT_RECOGNITION_RESULT_SCHEMA;
  assert.deepEqual(schema.required, ["candidates", "warnings"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.candidates.maxItems, 61);
  const candidate = schema.properties.candidates.items;
  assert.deepEqual(candidate.properties.key.enum, PROFILE_FIELD_KEYS);
  assert.equal(new Set(candidate.properties.key.enum).size, 61);
  assert.equal(candidate.additionalProperties, false);
  assert.deepEqual(candidate.required, ["key", "value", "source_page", "source_snippet", "confidence"]);
  assert.equal(candidate.properties.value.maxLength, Math.max(...PROFILE_FIELDS.map(field => field.maxLength)));
  assert.deepEqual(candidate.properties.confidence.type, ["number", "null"]);
  assert.ok(Object.isFrozen(candidate.properties.key.enum));
  assert.ok(Object.isFrozen(schema.properties.warnings.items));
});

test("normalization preserves extracted facts, null provenance and conflicting candidate order", () => {
  const input = { candidates: [CANDIDATE, { ...CANDIDATE, value: "Different", source_page: null, source_snippet: null, confidence: null }, CANDIDATE], warnings: ["  Проверьте источник  "] };
  const before = structuredClone(input);
  const result = normalizeDocumentRecognitionResult(input, SOURCE);
  assert.deepEqual(result.candidates.map(item => item.value), ["Synthetic", "Different", "Synthetic"]);
  assert.equal(result.candidates[1].source_page, null);
  assert.equal(result.candidates[1].confidence, null);
  assert.deepEqual(result.warnings, ["Проверьте источник"]);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(result.candidates[0]));
  assert.ok(Object.isFrozen(result.candidates));
  assert.deepEqual(normalizeDocumentRecognitionResult({ candidates: [], warnings: [] }, SOURCE), { candidates: [], warnings: [] });
  const date = normalizeDocumentRecognitionResult({ candidates: [{ ...CANDIDATE, key: "date_of_birth", value: "13/09/2007" }], warnings: [] }, SOURCE);
  assert.equal(date.candidates[0].value, "13/09/2007", "date interpretation remains human review, not extraction");
});

test("each of the 61 field limits counts Unicode code points without truncation", () => {
  for (const field of PROFILE_FIELDS) {
    const candidate = { ...CANDIDATE, key: field.key, value: "🙂".repeat(field.maxLength) };
    const result = normalizeDocumentRecognitionResult({ candidates: [candidate], warnings: [] }, SOURCE);
    assert.equal([...result.candidates[0].value].length, field.maxLength);
    rejects(() => normalizeDocumentRecognitionResult({ candidates: [{ ...candidate, value: `${candidate.value}x` }], warnings: [] }, SOURCE), "invalid_result");
  }
});

test("result rejects unknown fields, absent nullable keys, empty values and out-of-source pages", () => {
  for (const replacement of [
    { key: "not_a_registry_key" }, { value: "" }, { value: "  " }, { value: null },
    { source_page: 0 }, { source_page: 4 }, { source_page: 1.5 }, { source_page: undefined },
    { confidence: -0.01 }, { confidence: 1.01 }, { confidence: NaN }, { confidence: undefined },
    { source_snippet: undefined }, { source_snippet: "" }, { source_snippet: "x".repeat(241) },
    { extra: true },
  ]) rejects(() => normalizeDocumentRecognitionResult({ candidates: [{ ...CANDIDATE, ...replacement }], warnings: [] }, SOURCE), "invalid_result");
  for (const input of [{ ...RESULT, unknown: true }, { candidates: [CANDIDATE] },
    { candidates: Array(62).fill(CANDIDATE), warnings: [] }, { ...RESULT, warnings: Array(17).fill("warning") },
    { ...RESULT, warnings: ["x".repeat(241)] }, { ...RESULT, warnings: [null] }, { ...RESULT, warnings: [""] },
    { ...RESULT, candidates: Array(1) }, { ...RESULT, warnings: Array(1) }]) {
    rejects(() => normalizeDocumentRecognitionResult(input, SOURCE), "invalid_result");
  }
  for (const confidence of [0, 1, null]) assert.equal(normalizeDocumentRecognitionResult({ candidates: [{ ...CANDIDATE, confidence }], warnings: [] }, SOURCE).candidates[0].confidence, confidence);
});

test("source bounds are explicit; an image has one page and unsupported types are not accepted", () => {
  for (const source of [{ ...SOURCE, page_count: 0 }, { ...SOURCE, page_count: 21 }, { mime_type: "image/jpeg", page_count: 2 }, { mime_type: "text/plain", page_count: 1 }, { ...SOURCE, extra: true }]) {
    rejects(() => normalizeDocumentRecognitionResult(RESULT, source), "invalid_result");
  }
  assert.equal(normalizeDocumentRecognitionResult({ candidates: [{ ...CANDIDATE, source_page: 1 }], warnings: [] }, { mime_type: "image/png", page_count: 1 }).candidates[0].source_page, 1);
});

test("JSON boundary rejects over-limit UTF-8, malformed JSON and extra keys", () => {
  assert.deepEqual(parseDocumentRecognitionResultJson(JSON.stringify(RESULT), SOURCE), normalizeDocumentRecognitionResult(RESULT, SOURCE));
  for (const json of ["{", "null", "[]", `${JSON.stringify(RESULT)} extra`, " ".repeat(DOCUMENT_RECOGNITION_LIMITS.maxResultBytes + 1), `"${"🙂".repeat(66000)}"`]) {
    rejects(() => parseDocumentRecognitionResultJson(json, SOURCE), "invalid_result");
  }
});

test("job and receipt expose only their exact safe public DTO fields", () => {
  assert.deepEqual(normalizeDocumentRecognitionJob(JOB), JOB);
  assert.deepEqual(normalizeDocumentRecognitionReceipt({ job_id: ID, state: "queued", replayed: true }), { job_id: ID, state: "queued", replayed: true });
  for (const input of [{ ...JOB, provider_uri: "synthetic-value" }, { ...JOB, state: "invented" },
    { ...JOB, cleanup_state: "success" }, { ...JOB, proposal_count: 62 }, { ...JOB, failure_code: "raw-provider-message" },
    { ...JOB, updated_at: "yesterday" }, { ...JOB, updated_at: "2026-02-31T00:00:00Z" }]) {
    rejects(() => normalizeDocumentRecognitionJob(input), "invalid_job");
  }
  rejects(() => normalizeDocumentRecognitionReceipt({ job_id: ID, state: "queued", replayed: 1 }), "invalid_job");
  assert.ok(DOCUMENT_RECOGNITION_STATES.includes("generation_unknown"));
  assert.ok(DOCUMENT_RECOGNITION_STATES.includes("publication_blocked"));
  assert.deepEqual(DOCUMENT_RECOGNITION_CLEANUP_STATES, ["not_uploaded", "pending", "deleting", "confirmed_absent", "unknown"]);
});

test("canonical fingerprint is order-independent, metadata-only and matches the v1 SHA-256 vector", async () => {
  const reversed = Object.fromEntries(Object.entries(FINGERPRINT).reverse());
  const canonical = canonicalDocumentRecognitionFingerprint(FINGERPRINT);
  assert.equal(canonicalDocumentRecognitionFingerprint(reversed), canonical);
  const parsed = JSON.parse(canonical);
  assert.deepEqual(Object.keys(parsed), Object.keys(parsed).sort());
  assert.equal(parsed.fingerprint_version, "evo-document-recognition-request-v1");
  assert.equal(parsed.expected_profile_revision, 1);
  assert.equal(parsed.retry_of_job_id, null);
  assert.equal(await documentRecognitionFingerprint(FINGERPRINT), createHash("sha256").update(canonical, "utf8").digest("hex"));
  assert.equal(await documentRecognitionFingerprint(FINGERPRINT), "a4d3c643ef7e3349cdc9d662517cb30ead6d56f5fa3ab3ae59644412b493552b");
  assert.equal(await documentRecognitionFingerprint(reversed), await documentRecognitionFingerprint(FINGERPRINT));
  assert.equal(canonicalDocumentRecognitionFingerprint({ ...FINGERPRINT, source_sha256: "A".repeat(64) }), canonical);
  const alphabeticId = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
  assert.deepEqual(normalizeDocumentRecognitionRequest({ ...REQUEST, source_version_id: alphabeticId.toUpperCase() }), { ...REQUEST, source_version_id: alphabeticId });
  rejects(() => canonicalDocumentRecognitionFingerprint({ ...FINGERPRINT, request_id: ID }), "invalid_fingerprint");
  rejects(() => canonicalDocumentRecognitionFingerprint({ ...FINGERPRINT, candidates: RESULT.candidates }), "invalid_fingerprint");
});

test("every semantic fingerprint component binds the request and invalid configuration has no fallback", async () => {
  const baseline = await documentRecognitionFingerprint(FINGERPRINT);
  for (const key of Object.keys(FINGERPRINT)) {
    let value = FINGERPRINT[key];
    if (key === "purpose" || key === "extraction_mode") continue;
    if (key === "source_mime") value = "image/png";
    else if (key === "source_pages") value = 2;
    else if (key === "source_sha256") value = "b".repeat(64);
    else if (key === "retry_of_job_id" || key.endsWith("_id") && value === ID) value = OTHER_ID;
    else if (typeof value === "number") value += 1;
    else value += "-other";
    const changed = { ...FINGERPRINT, [key]: value, ...(key === "source_mime" ? { source_pages: 1 } : {}) };
    assert.notEqual(await documentRecognitionFingerprint(changed), baseline, key);
  }
  for (const replacement of [{ model: "" }, { model: "gemini-latest" }, { model: "models/gemini-3.7-flash" },
    { source_bytes: 0 }, { source_bytes: 25 * 1024 * 1024 + 1 }, { source_sha256: "no-hash" },
    { purpose: "chat" }, { extraction_mode: "rewrite" }, { provider_project_id: "" }, { expected_profile_revision: 0 }]) {
    rejects(() => canonicalDocumentRecognitionFingerprint({ ...FINGERPRINT, ...replacement }), "invalid_fingerprint");
  }
});

test("result hash is separate from job identity and preserves proposal order", async () => {
  const hash = await documentRecognitionResultSha256(RESULT, SOURCE);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, createHash("sha256").update(JSON.stringify(normalizeDocumentRecognitionResult(RESULT, SOURCE)), "utf8").digest("hex"));
  const changed = { candidates: [{ ...CANDIDATE, value: "Another" }], warnings: [] };
  assert.notEqual(await documentRecognitionResultSha256(changed, SOURCE), hash);
  const one = { candidates: [CANDIDATE, changed.candidates[0]], warnings: [] };
  const two = { candidates: [...one.candidates].reverse(), warnings: [] };
  assert.notEqual(await documentRecognitionResultSha256(one, SOURCE), await documentRecognitionResultSha256(two, SOURCE));
});
