import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentRecognitionHandlers, documentRecognitionMethodNotAllowed } from "../src/lib/server/document-recognition-route-handler.ts";
import { PlatformDocumentRecognitionError } from "../src/lib/platform-document-recognition.ts";
import { isConnectedPlatformApi, isConnectedStudentPortalApi } from "../src/lib/platform-route-contract.ts";

const CASE = "10000000-0000-4000-8000-000000000001";
const SOURCE = "10000000-0000-4000-8000-000000000002";
const JOB = "10000000-0000-4000-8000-000000000003";
const path = `/api/v3/student-cases/${CASE}/document-recognition-jobs`;
const actor = { systemRole: "staff", presentationRole: null };
const context = { params: Promise.resolve({ studentCaseId: CASE }) };
const command = { source_version_id: SOURCE, expected_profile_revision: 7, request_id: JOB, retry_of_job_id: null };
const receipt = { job_id: JOB, state: "queued", replayed: false };
const job = { job_id: JOB, source_version_id: SOURCE, state: "preflight", cleanup_state: "not_uploaded", proposal_count: 0, failure_code: null, updated_at: "2026-09-13T12:00:00Z" };
const unused = async () => { throw new Error("Unexpected boundary call"); };
const handlers = (overrides = {}) => createDocumentRecognitionHandlers({ loadActor: async () => ({ status: "authenticated", actor }), enqueue: unused, readJob: unused, readHistory: unused, readCaseHistory: unused, ...overrides });
const request = (method, query = "", body = command) => new Request(`https://evo.example.test${path}${query}`, {
  method, headers: { host: "evo.example.test", origin: "https://evo.example.test", "content-type": "application/json" },
  ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
});

test("POST persists only the original four-field session command, with truthful 202 and no-store", async () => {
  let count = 0;
  const response = await handlers({ enqueue: async (current, caseId, input) => {
    count++; assert.equal(current, actor); assert.equal(caseId, CASE); assert.deepEqual(input, command); return receipt;
  } }).POST(request("POST"), context);
  assert.equal(count, 1); assert.equal(response.status, 202); assert.deepEqual(await response.json(), receipt);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("GET reads a job OR exact-source history and forwards an opaque cursor unchanged", async () => {
  const cursor = `2026-09-13T12:00:00.123456Z|${JOB}`;
  const api = handlers({ readJob: async (current, caseId, id) => {
    assert.equal(current, actor); assert.equal(caseId, CASE); assert.equal(id, JOB); return job;
  }, readHistory: async (current, caseId, sourceId, before) => {
    assert.equal(current, actor); assert.equal(caseId, CASE); assert.equal(sourceId, SOURCE); assert.equal(before, cursor);
    return { jobs: [job], next_cursor: null };
  } });
  assert.deepEqual(await (await api.GET(request("GET", `?job_id=${JOB}`), context)).json(), job);
  const history = await api.GET(request("GET", `?source_version_id=${SOURCE}&cursor=${encodeURIComponent(cursor)}`), context);
  assert.deepEqual(await history.json(), { jobs: [job], next_cursor: null });
});

test("ordinary malformed methods, query combinations and oversized bodies do not dispatch", async () => {
  const api = handlers();
  for (const query of ["", `?job_id=${JOB}&source_version_id=${SOURCE}`, `?job_id=${JOB}&cursor=wrong`,
    `?source_version_id=${SOURCE}&cursor=wrong`, `?source_version_id=${SOURCE}&source_version_id=${SOURCE}`, `?job_id=${JOB}&extra=1`,
    `?scope=case&source_version_id=${SOURCE}`, `?scope=case&job_id=${JOB}`, "?scope=all", "?scope=case&scope=case"]) {
    assert.equal((await api.GET(request("GET", query), context)).status, 400);
  }
  for (const body of [{ ...command, model: "not allowed" }, { ...command, expected_profile_revision: 0 },
    { ...command, request_id: "ordinary invalid ID" }, { ...command, extra: "x".repeat(1100) }]) {
    assert.equal((await api.POST(request("POST", "", body), context)).status, 400);
  }
  assert.equal((await api.POST(request("POST", "?job_id=" + JOB), context)).status, 400);
  assert.equal(documentRecognitionMethodNotAllowed().status, 405);
  assert.equal(documentRecognitionMethodNotAllowed().headers.get("allow"), "GET, POST");
});

test("case history is a separate explicit read that retains replaced-source jobs", async () => {
  const response = await handlers({ readCaseHistory: async (current, caseId, cursor) => {
    assert.equal(current, actor); assert.equal(caseId, CASE); assert.equal(cursor, null);
    return { jobs: [{ ...job, source_version_id: CASE, state: "generation_unknown", cleanup_state: "unknown" }], next_cursor: null };
  } }).GET(request("GET", "?scope=case"), context);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).jobs[0].cleanup_state, "unknown");
});

test("same-origin and current authenticated staff boundary preserve fixed errors", async () => {
  const missingOrigin = request("POST"); missingOrigin.headers.delete("origin");
  assert.equal((await handlers().POST(missingOrigin, context)).status, 403);
  for (const [authority, status] of [[{ status: "anonymous", actor: null }, 401], [{ status: "invalid", actor: null }, 403],
    [{ status: "authenticated", actor: { systemRole: "student" } }, 403],
    [{ status: "authenticated", actor: { systemRole: "admin", presentationRole: "admissions" } }, 403]]) {
    const response = await handlers({ loadActor: async () => authority }).POST(request("POST"), context);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: "unavailable" });
  }
});

test("published request failures map exactly; unknown outcomes reveal no diagnostics or retry", async () => {
  for (const [code, status] of [["invalid_request",400], ["unavailable",403], ["profile_changed",409], ["request_conflict",409],
    ["equivalent_job_active",409], ["document_not_eligible",422], ["profile_not_started",422], ["budget_exhausted",429], ["provider_not_configured",503]]) {
    const response = await handlers({ enqueue: async () => { throw new PlatformDocumentRecognitionError(code); } }).POST(request("POST"), context);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: code });
  }
  let calls = 0;
  const response = await handlers({ enqueue: async () => { calls++; throw new Error("Private backend diagnostic"); } }).POST(request("POST"), context);
  assert.equal(calls, 1); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "unavailable" });
});

test("only the exact staff route is connected, not Student or arbitrary nested paths", () => {
  assert.equal(isConnectedPlatformApi(path), true);
  for (const value of [path + "/", path + "/worker", "/api/v3/student-cases/not-an-id/document-recognition-jobs"]) assert.equal(isConnectedPlatformApi(value), false);
  assert.equal(isConnectedStudentPortalApi(path, "POST"), false);
});

test("lost enqueue receipt is 503 so the browser retains the same request, not a 403 denial", async () => {
  const response = await handlers({ enqueue: async () => { throw new PlatformDocumentRecognitionError("unavailable", true); } })
    .POST(request("POST"), context);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
});
