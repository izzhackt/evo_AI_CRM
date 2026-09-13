import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createClient } from "@supabase/supabase-js";
import { getPlatformDocumentRecognitionHistory, getPlatformDocumentRecognitionCaseHistory, enqueuePlatformDocumentRecognition, isDocumentRecognitionCursor } from "../src/lib/platform-document-recognition.ts";

const CASE = "10000000-0000-4000-8000-000000000001";
const SOURCE = "10000000-0000-4000-8000-000000000002";
const actor = { systemRole: "staff", organizationId: CASE, permissionKeys: ["case.read.full", "profile.read.full", "document.read.full"] };
const job = n => ({ job_id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`, source_version_id: SOURCE,
  state: "generation_unknown", cleanup_state: "unknown", proposal_count: 0, failure_code: "generation_unknown", updated_at: "2026-09-13T12:00:00.123456Z" });
const page = { jobs: Array.from({ length: 10 }, (_, i) => job(i + 10)), next_cursor: `2026-09-13T12:00:00.123456Z|${job(19).job_id}` };
const boundary = rpc => ({ createSessionClient: async () => ({ schema(name) { assert.equal(name, "platform"); return { rpc }; } }) });

for (const scope of ["source", "case"]) {
  test(`actual SDK sends ${scope} history SQL nulls in a JSON body`, async () => {
    const requests = [];
    // A real loopback HTTP request proves serialization only; this controlled
    // empty-page response does not stand in for Auth/PostgREST/RLS acceptance.
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push({ method: request.method, url: request.url,
        body: Buffer.concat(chunks).toString("utf8"), schema: request.headers["content-profile"] });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jobs: [], next_cursor: null }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = createClient(`http://127.0.0.1:${server.address().port}`, "local-transport-test-key",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    try {
      const deps = { createSessionClient: async () => client };
      const result = scope === "source"
        ? await getPlatformDocumentRecognitionHistory(actor, CASE, SOURCE, null, deps)
        : await getPlatformDocumentRecognitionCaseHistory(actor, CASE, null, deps);
      assert.deepEqual(result, { jobs: [], next_cursor: null });
      assert.equal(requests.length, 1);
      assert.equal(new URL(requests[0].url, "http://127.0.0.1").searchParams.get("p_cursor"), null);
      assert.equal(requests[0].method, "POST");
      assert.equal(requests[0].url, "/rest/v1/rpc/staff_document_recognition_jobs");
      assert.equal(requests[0].schema, "platform");
      assert.deepEqual(JSON.parse(requests[0].body), {
        p_student_case_id: CASE, p_source_version_id: scope === "source" ? SOURCE : null, p_cursor: null,
      });
    } finally {
      client.auth.stopAutoRefresh();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test("history uses exact current-session source and preserves the opaque SQL cursor", async () => {
  const result = await getPlatformDocumentRecognitionHistory(actor, CASE, SOURCE, null, boundary(async (name, args, options) => {
    assert.equal(name, "staff_document_recognition_jobs");
    assert.deepEqual(args, { p_student_case_id: CASE, p_source_version_id: SOURCE, p_cursor: null });
    assert.equal(options, undefined);
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
