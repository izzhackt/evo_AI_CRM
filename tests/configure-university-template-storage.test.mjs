import assert from "node:assert/strict";
import test from "node:test";
import { configureUniversityTemplateStorage, UNIVERSITY_TEMPLATE_BUCKET, runUniversityTemplateStorageCli } from "../scripts/configure-university-template-storage.mjs";

test("template bucket configuration defaults to credential-free no-mutation plan", async () => {
  const result = await configureUniversityTemplateStorage({ fetchImpl() { assert.fail("plan must not read a service"); }, environment: {} });
  assert.equal(result.exitCode, 0); assert.equal(result.report.mode, "plan"); assert.equal(result.report.mutationAttempted, false);
  assert.equal(result.report.bucket.public, false); assert.equal(result.report.bucket.file_size_limit, 20 * 1024 * 1024);
  assert.equal(result.report.bucket.allowed_mime_types.length, 2); assert.equal(result.report.ingressAcceptance, false);
});

const key = "sb_secret_synthetic_transport_only_123";
const environment = { NEXT_PUBLIC_SUPABASE_URL: "https://iosckaqtovbbnssqcpde.supabase.co", EVO_PLATFORM_SUPABASE_SECRET_KEY: key };
const response = (value, status = 200) => Response.json(value, { status });
// Script transport fixtures are not evidence that a managed bucket exists.
test("check is strictly read-only and sanitizes bucket setting conflicts", async () => {
  for (const bucket of [{ ...UNIVERSITY_TEMPLATE_BUCKET, public: true }, { ...UNIVERSITY_TEMPLATE_BUCKET, file_size_limit: 1 },
    { ...UNIVERSITY_TEMPLATE_BUCKET, allowed_mime_types: ["text/private-diagnostic"] }]) {
    let calls = 0;
    const result = await configureUniversityTemplateStorage({ mode: "check", environment, fetchImpl: async (_url, init) => {
      calls++; assert.equal(init.method, "GET"); assert.equal(init.headers.Authorization, undefined); return response(bucket);
    } });
    assert.equal(result.report.status, "bucket_settings_conflict"); assert.equal(calls, 1); assert.equal(result.report.mutationAttempted, false);
    assert.equal(JSON.stringify(result).includes("text/private-diagnostic"), false); assert.equal(JSON.stringify(result).includes(key), false);
  }
});
test("apply never updates an existing matching or conflicting bucket", async () => {
  for (const [bucket, expected] of [[UNIVERSITY_TEMPLATE_BUCKET, "ready"], [{ ...UNIVERSITY_TEMPLATE_BUCKET, public: true }, "bucket_settings_conflict"]]) {
    const result = await configureUniversityTemplateStorage({ mode: "apply", environment, fetchImpl: async (_url, init) => {
      assert.equal(init.method, "GET"); return response(bucket);
    } });
    assert.equal(result.report.status, expected); assert.equal(result.report.mutationAttempted, false);
  }
});
test("only explicit apply creates one absent bucket and requires fresh exact readback", async () => {
  const calls = [], replies = [response({ code: "NoSuchBucket" }, 404), response({ name: UNIVERSITY_TEMPLATE_BUCKET.name }), response(UNIVERSITY_TEMPLATE_BUCKET)];
  const result = await configureUniversityTemplateStorage({ mode: "apply", environment, fetchImpl: async (url, init) => {
    calls.push(init.method); assert.equal(init.redirect, "error"); assert.ok(url.startsWith(environment.NEXT_PUBLIC_SUPABASE_URL + "/storage/v1/bucket"));
    if (init.method === "POST") assert.deepEqual(JSON.parse(init.body), UNIVERSITY_TEMPLATE_BUCKET);
    return replies.shift();
  } });
  assert.deepEqual(calls, ["GET", "POST", "GET"]); assert.equal(result.report.status, "created_and_verified");
  assert.equal(result.report.ingressAcceptance, false); assert.equal(result.report.globalLimitVerified, false);
});
test("default check absence and ambiguous apply do not retry or overwrite", async () => {
  const check = await configureUniversityTemplateStorage({ mode: "check", environment, fetchImpl: async () => response({ code: "NoSuchBucket" }, 404) });
  assert.equal(check.report.status, "bucket_missing"); assert.equal(check.report.mutationAttempted, false);
  let calls = 0;
  const apply = await configureUniversityTemplateStorage({ mode: "apply", environment, fetchImpl: async () => {
    if (++calls === 1) return response({ code: "NoSuchBucket" }, 404); throw new Error(key);
  } });
  assert.equal(calls, 2); assert.equal(apply.report.status, "create_outcome_unknown"); assert.equal(JSON.stringify(apply).includes(key), false);
});
test("wrong project, absent configuration and malformed CLI options stop before network", async () => {
  for (const env of [{}, { ...environment, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }]) {
    const result = await configureUniversityTemplateStorage({ mode: "check", environment: env, fetchImpl() { assert.fail("invalid target"); } });
    assert.equal(result.exitCode, 1); assert.equal(result.report.mutationAttempted, false);
  }
  let written = "";
  assert.equal(await runUniversityTemplateStorageCli(["--apply", key], { write: value => { written += value; } }), 1);
  assert.equal(written.includes(key), false);
});
