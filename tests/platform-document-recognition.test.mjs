import assert from "node:assert/strict";
import test from "node:test";
import { enqueuePlatformDocumentRecognition, getPlatformDocumentRecognitionJob } from "../src/lib/platform-document-recognition.ts";

// Synthetic RPC boundary only: these checks do not claim real Auth or SQL proof.
const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "10000000-0000-4000-8000-000000000002";
const SOURCE = "10000000-0000-4000-8000-000000000003";
const REQUEST = "10000000-0000-4000-8000-000000000004";
const JOB = "10000000-0000-4000-8000-000000000005";
const actor = Object.freeze({
  authUserId: "10000000-0000-4000-8000-000000000006",
  profileId: "10000000-0000-4000-8000-000000000007",
  membershipId: "10000000-0000-4000-8000-000000000008",
  organizationId: ORG, displayName: "Synthetic staff", email: "staff@example.test",
  systemRole: "staff", platformAccessVersion: 1, assignments: [],
  permissionKeys: ["case.read.full", "profile.read.full", "profile.manage", "document.read.full", "document.download", "document.extract"],
});
const request = Object.freeze({ source_version_id: SOURCE, expected_profile_revision: 7, request_id: REQUEST, retry_of_job_id: null });
const job = Object.freeze({ job_id: JOB, source_version_id: SOURCE, state: "preflight", cleanup_state: "not_uploaded",
  proposal_count: 0, failure_code: null, updated_at: "2026-09-13T12:00:00.000Z" });

function sessionBoundary(rpc) {
  return { createSessionClient: async () => ({ schema(name) {
    assert.equal(name, "platform");
    return { rpc };
  } }) };
}

test("enqueue sends only the current organization, case and original four-field command", async () => {
  const receipt = await enqueuePlatformDocumentRecognition(actor, CASE, request, sessionBoundary(async (name, parameters, options) => {
    assert.equal(name, "enqueue_document_recognition");
    assert.deepEqual(parameters, {
      p_organization_id: ORG, p_student_case_id: CASE, p_source_version_id: SOURCE,
      p_expected_profile_revision: 7, p_request_id: REQUEST, p_retry_of_job_id: null,
    });
    assert.equal(options, undefined);
    return { data: { job_id: JOB, state: "queued", replayed: false }, error: null };
  }));
  assert.deepEqual(receipt, { job_id: JOB, state: "queued", replayed: false });
  assert.ok(Object.isFrozen(receipt));
});

test("reading a job uses the read-only session RPC and preserves its compact result", async () => {
  const result = await getPlatformDocumentRecognitionJob(actor, CASE, JOB, sessionBoundary(async (name, parameters, options) => {
    assert.equal(name, "staff_document_recognition_job");
    assert.deepEqual(parameters, { p_student_case_id: CASE, p_job_id: JOB });
    assert.deepEqual(options, { get: true });
    return { data: job, error: null };
  }));
  assert.deepEqual(result, job);
  assert.ok(Object.isFrozen(result));
});

test("enqueue maps only the published SQLSTATE and fixed message pairs", async () => {
  for (const [code, message, expected] of [
    ["22023", "invalid_request", "invalid_request"],
    ["42501", "unavailable", "unavailable"],
    ["40001", "profile_changed", "profile_changed"],
    ["23505", "request_conflict", "request_conflict"],
    ["23505", "equivalent_job_active", "equivalent_job_active"],
    ["22023", "document_not_eligible", "document_not_eligible"],
    ["22023", "profile_not_started", "profile_not_started"],
    ["54000", "budget_exhausted", "budget_exhausted"],
    ["55000", "provider_not_configured", "provider_not_configured"],
    ["40001", "Serialization failure", "unavailable"],
    ["23505", "Database detail: request_conflict", "unavailable"],
    ["22023", "budget_exhausted", "unavailable"],
    ["XX000", "profile_changed", "unavailable"],
  ]) {
    await assert.rejects(enqueuePlatformDocumentRecognition(actor, CASE, request, sessionBoundary(async () => ({
      data: null, error: { code, message, details: "Synthetic database diagnostics", hint: "Not public" },
    }))), { name: "PlatformDocumentRecognitionError", code: expected, message: "Document recognition is unavailable" });
  }
});

test("invalid command fields or route IDs return invalid_request before creating a client", async () => {
  let clients = 0;
  const dependencies = { createSessionClient: async () => { clients++; throw new Error("No RPC expected"); } };
  for (const input of [
    { ...request, expected_profile_revision: 0 },
    { ...request, request_id: "not-a-uuid" },
    { ...request, retry_of_job_id: undefined },
    { ...request, model: "not-a-browser-setting" },
    { ...request, organization_id: ORG },
    { ...request, source_pages: 1 },
  ]) await assert.rejects(enqueuePlatformDocumentRecognition(actor, CASE, input, dependencies), { code: "invalid_request" });
  await assert.rejects(enqueuePlatformDocumentRecognition(actor, "not-a-case", request, dependencies), { code: "invalid_request" });
  await assert.rejects(getPlatformDocumentRecognitionJob(actor, CASE, "not-a-job", dependencies), { code: "invalid_request" });
  await assert.rejects(getPlatformDocumentRecognitionJob(actor, "not-a-case", JOB, dependencies), { code: "invalid_request" });
  assert.equal(clients, 0);
});

test("read-only staff can inspect jobs but preview or incomplete extraction permissions cannot enqueue", async () => {
  let clients = 0;
  const dependencies = { createSessionClient: async () => { clients++; throw new Error("No client expected"); } };
  const reader = { ...actor, permissionKeys: ["case.read.full", "profile.read.full", "document.read.full"] };
  for (const denied of [reader, { ...actor, systemRole: "admin", presentationRole: "sales" },
    { ...actor, systemRole: "student" }, { ...actor, organizationId: "invalid" }]) {
    await assert.rejects(enqueuePlatformDocumentRecognition(denied, CASE, request, dependencies), { code: "unavailable" });
  }
  await assert.rejects(getPlatformDocumentRecognitionJob({ ...actor, permissionKeys: [] }, CASE, JOB, dependencies), { code: "unavailable" });
  assert.equal(clients, 0);
  const result = await getPlatformDocumentRecognitionJob(reader, CASE, JOB, sessionBoundary(async () => ({ data: job, error: null })));
  assert.deepEqual(result, job);
  const admin = { ...actor, systemRole: "admin", presentationRole: null, permissionKeys: [] };
  assert.equal((await enqueuePlatformDocumentRecognition(admin, CASE, request,
    sessionBoundary(async () => ({ data: { job_id: JOB, state: "queued", replayed: false }, error: null })))).job_id, JOB);
});

test("enqueue captures the original actor organization and request before awaiting the session client", async () => {
  const currentActor = { ...actor };
  const command = { ...request, retry_of_job_id: "10000000-0000-4000-8000-000000000009" };
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const dependencies = { createSessionClient: async () => {
    await gate;
    return sessionBoundary(async (_name, parameters) => {
      assert.deepEqual(parameters, { p_organization_id: ORG, p_student_case_id: CASE, p_source_version_id: SOURCE,
        p_expected_profile_revision: 7, p_request_id: REQUEST, p_retry_of_job_id: "10000000-0000-4000-8000-000000000009" });
      return { data: { job_id: JOB, state: "queued", replayed: true }, error: null };
    }).createSessionClient();
  } };
  const pending = enqueuePlatformDocumentRecognition(currentActor, CASE, command, dependencies);
  currentActor.organizationId = "20000000-0000-4000-8000-000000000001";
  command.expected_profile_revision = 8;
  command.request_id = "20000000-0000-4000-8000-000000000004";
  command.retry_of_job_id = null;
  resume();
  assert.deepEqual(await pending, { job_id: JOB, state: "queued", replayed: true });
});

test("malformed receipts, extra job metadata or a mismatched job ID return only unavailable", async () => {
  const validReceipt = { job_id: JOB, state: "queued", replayed: false };
  for (const response of [
    { data: null, error: null },
    { data: [validReceipt], error: null },
    { data: { ...validReceipt, source_pages: 1 }, error: null },
    { data: { ...validReceipt, replayed: "false" }, error: null },
    { data: validReceipt, error: false },
    { data: validReceipt },
  ]) await assert.rejects(enqueuePlatformDocumentRecognition(actor, CASE, request, sessionBoundary(async () => response)),
    { name: "PlatformDocumentRecognitionError", code: "unavailable", message: "Document recognition is unavailable" });
  for (const data of [
    null, { ...job, source_pages: 1 }, { ...job, state: "completed" },
    { ...job, job_id: "20000000-0000-4000-8000-000000000005" },
    { ...job, failure_code: "arbitrary_database_details" },
  ]) await assert.rejects(getPlatformDocumentRecognitionJob(actor, CASE, JOB, sessionBoundary(async () => ({ data, error: null }))),
    { name: "PlatformDocumentRecognitionError", code: "unavailable", message: "Document recognition is unavailable" });
});

test("an unknown enqueue outcome is not retried automatically and explicit replay keeps the original request", async () => {
  const original = JSON.stringify(request);
  const submitted = [];
  const dependencies = sessionBoundary(async (name, parameters) => {
    assert.equal(name, "enqueue_document_recognition");
    submitted.push({ ...parameters });
    if (submitted.length === 1) throw new Error("Synthetic lost response, not a provider call");
    return { data: { job_id: JOB, state: "preflight", replayed: true }, error: null };
  });
  await assert.rejects(enqueuePlatformDocumentRecognition(actor, CASE, request, dependencies), { code: "unavailable" });
  assert.equal(submitted.length, 1);
  assert.equal(JSON.stringify(request), original);
  const replay = await enqueuePlatformDocumentRecognition(actor, CASE, request, dependencies);
  assert.deepEqual(submitted[1], submitted[0]);
  assert.equal(submitted[1].p_request_id, REQUEST);
  assert.deepEqual(replay, { job_id: JOB, state: "preflight", replayed: true });
  assert.equal(JSON.stringify(request), original);
});

test("job reads preserve unknown cleanup independently from saved proposals", async () => {
  const result = await getPlatformDocumentRecognitionJob(actor, CASE, JOB, sessionBoundary(async () => ({
    data: { ...job, state: "review_ready", cleanup_state: "unknown", proposal_count: 2 }, error: null,
  })));
  assert.equal(result.state, "review_ready");
  assert.equal(result.cleanup_state, "unknown");
  assert.equal(result.proposal_count, 2);
});

test("session and read failures are fixed unavailable errors without diagnostics or retries", async () => {
  let clients = 0;
  const dependencies = { createSessionClient: async () => {
    clients++;
    throw new Error("Synthetic private session diagnostic");
  } };
  for (const invoke of [
    () => enqueuePlatformDocumentRecognition(actor, CASE, request, dependencies),
    () => getPlatformDocumentRecognitionJob(actor, CASE, JOB, dependencies),
    () => getPlatformDocumentRecognitionJob(actor, CASE, JOB, sessionBoundary(async () => ({
      data: job, error: { code: "42501", message: "Synthetic private SQL diagnostic", details: "Not for callers" },
    }))),
  ]) await assert.rejects(invoke, error => {
    assert.equal(error.name, "PlatformDocumentRecognitionError");
    assert.equal(error.code, "unavailable");
    assert.equal(error.message, "Document recognition is unavailable");
    assert.equal(error.cause, undefined);
    assert.equal(error.details, undefined);
    return true;
  });
  assert.equal(clients, 2);
});
