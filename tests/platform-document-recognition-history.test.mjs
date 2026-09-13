import assert from "node:assert/strict";
import test from "node:test";
import { getPlatformDocumentRecognitionHistory, getPlatformDocumentRecognitionCaseHistory, enqueuePlatformDocumentRecognition, isDocumentRecognitionCursor } from "../src/lib/platform-document-recognition.ts";

const CASE = "10000000-0000-4000-8000-000000000001";
const SOURCE = "10000000-0000-4000-8000-000000000002";
const actor = { systemRole: "staff", organizationId: CASE, permissionKeys: ["case.read.full", "profile.read.full", "document.read.full"] };
const job = n => ({ job_id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`, source_version_id: SOURCE,
  state: "generation_unknown", cleanup_state: "unknown", proposal_count: 0, failure_code: "generation_unknown", updated_at: "2026-09-13T12:00:00.123456Z" });
const page = { jobs: Array.from({ length: 10 }, (_, i) => job(i + 10)), next_cursor: `2026-09-13T12:00:00.123456Z|${job(19).job_id}` };
const boundary = rpc => ({ createSessionClient: async () => ({ schema(name) { assert.equal(name, "platform"); return { rpc }; } }) });

test("history uses exact current-session source and preserves the opaque SQL cursor", async () => {
  const result = await getPlatformDocumentRecognitionHistory(actor, CASE, SOURCE, null, boundary(async (name, args, options) => {
    assert.equal(name, "staff_document_recognition_jobs");
    assert.deepEqual(args, { p_student_case_id: CASE, p_source_version_id: SOURCE, p_cursor: null });
    assert.deepEqual(options, { get: true });
    return { data: page, error: null };
  }));
  assert.deepEqual(result, page);
  assert.ok(Object.isFrozen(result.jobs));
  assert.equal(result.jobs[0].cleanup_state, "unknown");
  const older = await getPlatformDocumentRecognitionHistory(actor, CASE, SOURCE, result.next_cursor, boundary(async (_name, args) => {
    assert.equal(args.p_cursor, page.next_cursor); return { data: { jobs: [job(20)], next_cursor: null }, error: null };
  }));
  assert.equal(older.jobs[0].job_id, job(20).job_id);
});

test("history accepts an honest empty page and rejects malformed or cross-source responses", async () => {
  assert.deepEqual(await getPlatformDocumentRecognitionHistory(actor, CASE, SOURCE, null,
    boundary(async () => ({ data: { jobs: [], next_cursor: null }, error: null }))), { jobs: [], next_cursor: null });
  for (const data of [{ jobs: [], next_cursor: page.next_cursor }, { ...page, private_path: "not public" },
    { ...page, jobs: [...page.jobs, job(50)] }, { ...page, jobs: [job(1), job(1)] },
    { jobs: [{ ...job(1), source_version_id: CASE }], next_cursor: null },
    { ...page, next_cursor: `2026-09-13T12:00:00.123456Z|${job(99).job_id}` }]) {
    await assert.rejects(getPlatformDocumentRecognitionHistory(actor, CASE, SOURCE, null,
      boundary(async () => ({ data, error: null }))), { code: "unavailable" });
  }
});

test("history validates cursor and read permission before the session RPC", async () => {
  let clients = 0;
  const deps = { createSessionClient: async () => { clients++; throw new Error("Not called"); } };
  for (const cursor of ["", "2026-02-30T12:00:00.123456Z|" + CASE, "2026-09-13T25:00:00.123456Z|" + CASE,
    "2026-09-13T12:00:00Z|" + CASE, page.next_cursor.toUpperCase()]) {
    // Numeric UUIDs do not change case, but uppercase T/Z is required already.
    if (cursor === page.next_cursor) continue;
    assert.equal(isDocumentRecognitionCursor(cursor), false);
    await assert.rejects(getPlatformDocumentRecognitionHistory(actor, CASE, SOURCE, cursor, deps), { code: "invalid_request" });
  }
  await assert.rejects(getPlatformDocumentRecognitionHistory({ ...actor, permissionKeys: [] }, CASE, SOURCE, null, deps), { code: "unavailable" });
  assert.equal(clients, 0);
});

test("explicit case history alone sends a null source and accepts multiple exact-case source versions", async () => {
  const result = await getPlatformDocumentRecognitionCaseHistory(actor, CASE, null, boundary(async (_name, args) => {
    assert.equal(args.p_source_version_id, null);
    return { data: { jobs: [job(1), { ...job(2), source_version_id: CASE }], next_cursor: null }, error: null };
  }));
  assert.equal(result.jobs.length, 2);
  await assert.rejects(getPlatformDocumentRecognitionHistory(actor, CASE, null), { code: "invalid_request" });
});

test("enqueue distinguishes definitive live denial from lost or malformed RPC outcome", async () => {
  const writer = { ...actor, permissionKeys: [...actor.permissionKeys, "profile.manage", "document.download", "document.extract"] };
  const command = { source_version_id: SOURCE, expected_profile_revision: 1, request_id: CASE, retry_of_job_id: null };
  for (const response of [{ data: null, error: { code: "FETCH_ERROR", message: "Unavailable response" } },
    { data: null, error: null }]) {
    await assert.rejects(enqueuePlatformDocumentRecognition(writer, CASE, command, boundary(async () => response)),
      { code: "unavailable", uncertain: true });
  }
  await assert.rejects(enqueuePlatformDocumentRecognition(writer, CASE, command, boundary(async () => {
    throw new TypeError("Synthetic interrupted RPC");
  })), { code: "unavailable", uncertain: true });
  await assert.rejects(enqueuePlatformDocumentRecognition(writer, CASE, command, boundary(async () => ({
    data: null, error: { code: "42501", message: "unavailable" },
  }))), { code: "unavailable", uncertain: false });
});
