import assert from "node:assert/strict";
import test from "node:test";
import { submitRecognitionRequest, readRecognitionHistory } from "../src/lib/document-recognition-client.ts";
const CASE = "10000000-0000-4000-8000-000000000001";
const SOURCE = "10000000-0000-4000-8000-000000000002";
const JOB = "10000000-0000-4000-8000-000000000003";
const command = Object.freeze({ source_version_id: SOURCE, expected_profile_revision: 7, request_id: JOB, retry_of_job_id: null });
const receipt = { job_id: JOB, state: "queued", replayed: true };

test("unknown enqueue sends once; explicit same-command replay preserves every byte and ID", async () => {
  const sent = [];
  await assert.rejects(submitRecognitionRequest(CASE, command, async (_url, options) => {
    sent.push(options.body); throw new TypeError("Synthetic connection lost");
  }), { code: "unavailable", uncertain: true });
  assert.equal(sent.length, 1);
  const result = await submitRecognitionRequest(CASE, command, async (_url, options) => {
    sent.push(options.body); return Response.json(receipt, { status: 202 });
  });
  assert.equal(sent[0], sent[1]); assert.deepEqual(JSON.parse(sent[1]), command); assert.deepEqual(result, receipt);
});

test("known rejection is not accepted; a lost or malformed receipt remains uncertain", async () => {
  for (const [response, code, uncertain] of [
    [Response.json({ error: "profile_changed" }, { status: 409 }), "profile_changed", false],
    [Response.json({ error: "provider_not_configured" }, { status: 503 }), "provider_not_configured", false],
    [Response.json({ error: "unavailable" }, { status: 503 }), "unavailable", true],
    [Response.json({ ...receipt, provider_uri: "not public" }, { status: 202 }), "unavailable", true],
    [new Response("", { status: 202 }), "unavailable", true],
  ]) await assert.rejects(submitRecognitionRequest(CASE, command, async () => response), { code, uncertain });
});

test("history reopen and older navigation are no-store GET only, never new commands", async () => {
  const cursor = `2026-09-13T12:00:00.123456Z|${JOB}`;
  const page = await readRecognitionHistory(CASE, SOURCE, cursor, new AbortController().signal, async (url, options) => {
    assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.cache, "no-store");
    assert.equal(new URL(url, "https://evo.test").searchParams.get("cursor"), cursor);
    return Response.json({ jobs: [], next_cursor: null });
  });
  assert.deepEqual(page, { jobs: [], next_cursor: null });
});

test("a new explicit retry is separately bound to the current revision and prior job", async () => {
  const retry = { ...command, request_id: CASE, expected_profile_revision: 8, retry_of_job_id: JOB };
  await submitRecognitionRequest(CASE, retry, async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), retry); return Response.json({ ...receipt, replayed: false }, { status: 202 });
  });
  assert.equal(command.expected_profile_revision, 7);
});

test("case history is explicit and has no extraction side effect or source substitution", async () => {
  const result = await readRecognitionHistory(CASE, null, null, new AbortController().signal, async (url, options) => {
    const query = new URL(url, "https://evo.test").searchParams;
    assert.equal(query.get("scope"), "case"); assert.equal(query.has("source_version_id"), false);
    assert.equal(options.method, "GET"); return Response.json({ jobs: [], next_cursor: null });
  });
  assert.equal(result.jobs.length, 0);
});
