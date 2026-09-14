import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_EXPORT_BUCKET, UNIVERSITY_FORM_EXPORT_BUCKET, DOCUMENT_EXPORT_STORAGE_ORIGIN, DOCUMENT_EXPORT_STORAGE_PROJECT,
  configureDocumentExportStorage, parseDocumentExportStorageArgs, runDocumentExportStorageCli,
} from "../scripts/configure-document-export-storage.mjs";

const syntheticKey = `sb_secret_${"synthetic_unit_only_".repeat(2)}`;
const environment = { NEXT_PUBLIC_SUPABASE_URL: DOCUMENT_EXPORT_STORAGE_ORIGIN, EVO_PLATFORM_SUPABASE_SECRET_KEY: syntheticKey };
const bucket = () => ({ ...DOCUMENT_EXPORT_BUCKET, allowed_mime_types: [...DOCUMENT_EXPORT_BUCKET.allowed_mime_types],
  owner: "excluded-owner", created_at: "excluded-timestamp", arbitrary: syntheticKey });
const json = (body, status = 200) => Response.json(body, { status });
const missing = () => json({ code: "NoSuchBucket", message: "Bucket not found" }, 404);
// Exact non-sensitive response observed from managed Storage on 2026-09-15.
const legacyMissing = { statusCode: "404", error: "Bucket not found", message: "Bucket not found", code: "NoSuchBucket" };

function fakeHttp(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init });
    const next = responses[calls.length - 1];
    assert.ok(next, "Unexpected extra HTTP request; unit tests never use live fetch");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(url, init) : next;
  };
  return { calls, fetchImpl };
}

test("default is check-only and the CLI exposes no project, credential or overwrite arguments", async () => {
  assert.deepEqual(parseDocumentExportStorageArgs([]), { apply: false, help: false });
  assert.deepEqual(parseDocumentExportStorageArgs(["--apply"]), { apply: true, help: false });
  assert.deepEqual(parseDocumentExportStorageArgs(["--university-forms"]), { apply: false, help: false, universityForms: true });
  assert.deepEqual(parseDocumentExportStorageArgs(["--university-forms", "--apply"]), { apply: true, help: false, universityForms: true });
  for (const args of [["--apply", "--apply"], ["--project", "other"], ["--force"], ["--key", syntheticKey]]) {
    assert.throws(() => parseDocumentExportStorageArgs(args), { code: "arguments_invalid" });
  }
  let output = "";
  const fake = fakeHttp([]);
  assert.equal(await runDocumentExportStorageCli(["--help"], { environment: {}, fetchImpl: fake.fetchImpl, write: text => { output += text; } }), 0);
  assert.match(output, /Default: check only/u); assert.equal(fake.calls.length, 0);
});

test("university forms require an explicit upgrade; check-only never writes", async () => {
  const fake = fakeHttp([json(bucket())]);
  const result = await configureDocumentExportStorage({ universityForms: true, environment, fetchImpl: fake.fetchImpl });
  assert.equal(result.exitCode, 1); assert.equal(result.report.status, "university_forms_upgrade_required");
  assert.equal(result.report.mutationAttempted, false); assert.equal(fake.calls.length, 1);
});

test("university form upgrade is one exact private bucket update with independent readback", async () => {
  const upgraded = { ...bucket(), ...UNIVERSITY_FORM_EXPORT_BUCKET };
  const fake = fakeHttp([json(bucket()), json({ message: "Successfully updated" }), json(upgraded)]);
  const result = await configureDocumentExportStorage({ apply: true, universityForms: true, environment, fetchImpl: fake.fetchImpl });
  assert.equal(result.exitCode, 0); assert.equal(result.report.status, "updated_and_verified");
  assert.equal(result.report.readbackVerified, true); assert.equal(result.report.globalLimitVerified, false);
  assert.deepEqual(fake.calls.map(call => call.method), ["GET", "PUT", "GET"]);
  assert.equal(fake.calls[1].url, `${DOCUMENT_EXPORT_STORAGE_ORIGIN}/storage/v1/bucket/platform-document-exports`);
  assert.deepEqual(JSON.parse(fake.calls[1].body), UNIVERSITY_FORM_EXPORT_BUCKET);
  const ready = fakeHttp([json(upgraded)]);
  assert.equal((await configureDocumentExportStorage({ apply: true, universityForms: true, environment, fetchImpl: ready.fetchImpl })).exitCode, 0);
  assert.equal(ready.calls.length, 1);
});

test("university form mode never upgrades drift or retries an ambiguous update", async () => {
  for (const before of [{ ...bucket(), public: true }, { ...bucket(), file_size_limit: null },
    { ...bucket(), allowed_mime_types: ["application/pdf"] }]) {
    const fake = fakeHttp([json(before)]);
    const result = await configureDocumentExportStorage({ apply: true, universityForms: true, environment, fetchImpl: fake.fetchImpl });
    assert.equal(result.report.status, "bucket_settings_conflict"); assert.equal(fake.calls.length, 1);
  }
  const lost = fakeHttp([json(bucket()), new Error(syntheticKey)]);
  const result = await configureDocumentExportStorage({ apply: true, universityForms: true, environment, fetchImpl: lost.fetchImpl });
  assert.equal(result.report.status, "update_outcome_unknown"); assert.equal(result.report.readbackVerified, false);
  assert.equal(lost.calls.length, 2); assert.equal(JSON.stringify(result).includes(syntheticKey), false);
});

test("wrong or absent project fails before sending any credential or request", async () => {
  for (const url of [undefined, "http://iosckaqtovbbnssqcpde.supabase.co", "https://other.supabase.co",
    `${DOCUMENT_EXPORT_STORAGE_ORIGIN}/storage/v1`, `${DOCUMENT_EXPORT_STORAGE_ORIGIN}?key=${syntheticKey}`]) {
    const fake = fakeHttp([]);
    const result = await configureDocumentExportStorage({ apply: true, environment: { ...environment, NEXT_PUBLIC_SUPABASE_URL: url }, fetchImpl: fake.fetchImpl });
    assert.equal(result.exitCode, 1); assert.equal(result.report.status, "project_mismatch");
    assert.equal(result.report.mutationAttempted, false); assert.equal(fake.calls.length, 0);
    assert.equal(JSON.stringify(result).includes(syntheticKey), false);
  }
});

test("publishable or wrong-project credentials stop locally; legacy service JWT uses both headers", async () => {
  const jwt = (role, ref) => [Buffer.from('{"alg":"HS256"}').toString("base64url"),
    Buffer.from(JSON.stringify({ role, ref })).toString("base64url"), "syntheticSignature"].join(".");
  for (const key of [undefined, "sb_publishable_synthetic", jwt("anon", DOCUMENT_EXPORT_STORAGE_PROJECT), jwt("service_role", "other")]) {
    const fake = fakeHttp([]);
    const result = await configureDocumentExportStorage({ environment: { ...environment, EVO_PLATFORM_SUPABASE_SECRET_KEY: key }, fetchImpl: fake.fetchImpl });
    assert.equal(result.report.status, "credential_invalid"); assert.equal(fake.calls.length, 0);
  }
  const key = jwt("service_role", DOCUMENT_EXPORT_STORAGE_PROJECT);
  const fake = fakeHttp([json(bucket())]);
  assert.equal((await configureDocumentExportStorage({ environment: { ...environment, EVO_PLATFORM_SUPABASE_SECRET_KEY: key }, fetchImpl: fake.fetchImpl })).exitCode, 0);
  assert.equal(fake.calls[0].headers.Authorization, `Bearer ${key}`);
  assert.equal(fake.calls[0].headers.apikey, key);
});

test("absent bucket is reported without mutation in the default mode", async () => {
  const fake = fakeHttp([missing()]);
  const result = await configureDocumentExportStorage({ environment, fetchImpl: fake.fetchImpl });
  assert.equal(result.exitCode, 1); assert.equal(result.report.status, "bucket_missing");
  assert.equal(result.report.before, null); assert.equal(result.report.mutationAttempted, false);
  assert.equal(fake.calls.length, 1); assert.equal(fake.calls[0].method, "GET");
});

test("observed legacy missing-bucket response supports check and one explicit create", async () => {
  for (const apply of [false, true]) {
    const fake = fakeHttp([json(legacyMissing, 400), json({ name: UNIVERSITY_FORM_EXPORT_BUCKET.name }), json(UNIVERSITY_FORM_EXPORT_BUCKET)]);
    const result = await configureDocumentExportStorage({ apply, universityForms: true, environment, fetchImpl: fake.fetchImpl });
    assert.equal(result.report.status, apply ? "created_and_verified" : "bucket_missing");
    assert.equal(result.report.mutationAttempted, apply);
    assert.equal(result.report.readbackVerified, apply);
    assert.deepEqual(fake.calls.map(call => call.method), apply ? ["GET", "POST", "GET"] : ["GET"]);
    if (apply) assert.deepEqual(JSON.parse(fake.calls[1].body), UNIVERSITY_FORM_EXPORT_BUCKET);
  }
});

test("conflicting or incomplete legacy absence never authorizes an export bucket create", async () => {
  for (const override of [{ statusCode: "403" }, { code: "AccessDenied" }, { error: "Unauthorized" },
    { message: "not found" }, { code: undefined }, { detail: "unexpected" }]) {
    const fake = fakeHttp([json({ ...legacyMissing, ...override }, 400)]);
    const result = await configureDocumentExportStorage({ apply: true, universityForms: true, environment, fetchImpl: fake.fetchImpl });
    assert.equal(result.report.status, "bucket_read_failed");
    assert.equal(result.report.mutationAttempted, false); assert.equal(fake.calls.length, 1);
  }
});

test("matching existing settings are an idempotent read even with apply", async () => {
  for (const apply of [false, true]) {
    const fake = fakeHttp([json(bucket())]);
    const result = await configureDocumentExportStorage({ apply, environment, fetchImpl: fake.fetchImpl });
    assert.equal(result.exitCode, 0); assert.equal(result.report.status, "ready");
    assert.equal(result.report.readbackVerified, true); assert.equal(result.report.mutationAttempted, false);
    assert.equal(result.report.globalLimitVerified, false); assert.equal(result.report.artifactAcceptance, false);
    assert.equal(fake.calls.length, 1); assert.equal(fake.calls[0].headers.Authorization, undefined);
    assert.doesNotMatch(JSON.stringify(result.report), /excluded-owner|excluded-timestamp|synthetic_unit_only/u);
  }
});

test("existing public, size, MIME or bucket-type conflicts never produce an update", async () => {
  for (const override of [{ public: true }, { file_size_limit: 20 * 1024 * 1024 }, { file_size_limit: null },
    { allowed_mime_types: null }, { allowed_mime_types: [syntheticKey] },
    { allowed_mime_types: [...DOCUMENT_EXPORT_BUCKET.allowed_mime_types, ...DOCUMENT_EXPORT_BUCKET.allowed_mime_types] }, { type: "ANALYTICS" }]) {
    const fake = fakeHttp([json({ ...bucket(), ...override })]);
    const result = await configureDocumentExportStorage({ apply: true, environment, fetchImpl: fake.fetchImpl });
    assert.equal(result.exitCode, 1); assert.equal(result.report.status, "bucket_settings_conflict");
    assert.equal(result.report.mutationAttempted, false); assert.equal(fake.calls.length, 1);
    assert.equal(JSON.stringify(result).includes(syntheticKey), false);
  }
});

test("apply sends exactly one bounded create and verifies the actual GET response", async () => {
  const fake = fakeHttp([missing(), json({ name: DOCUMENT_EXPORT_BUCKET.name }), json(bucket())]);
  const result = await configureDocumentExportStorage({ apply: true, environment, fetchImpl: fake.fetchImpl });
  assert.equal(result.exitCode, 0); assert.equal(result.report.status, "created_and_verified");
  assert.equal(result.report.readbackVerified, true); assert.equal(result.report.after.file_size_limit, 5242880);
  assert.deepEqual(fake.calls.map(call => [call.method, call.url]), [
    ["GET", `${DOCUMENT_EXPORT_STORAGE_ORIGIN}/storage/v1/bucket/platform-document-exports`],
    ["POST", `${DOCUMENT_EXPORT_STORAGE_ORIGIN}/storage/v1/bucket`],
    ["GET", `${DOCUMENT_EXPORT_STORAGE_ORIGIN}/storage/v1/bucket/platform-document-exports`],
  ]);
  assert.deepEqual(JSON.parse(fake.calls[1].body), DOCUMENT_EXPORT_BUCKET);
  assert.equal(fake.calls[1].headers.apikey, syntheticKey); assert.equal(fake.calls[1].headers.Authorization, undefined);
  for (const call of fake.calls) {
    assert.equal(call.redirect, "error"); assert.equal(call.cache, "no-store"); assert.ok(call.signal instanceof AbortSignal);
    assert.equal(call.url.includes(syntheticKey), false);
  }
});

test("create acknowledgement cannot hide a missing or conflicting readback", async () => {
  for (const after of [missing(), json({ ...bucket(), public: true }), json({ ...bucket(), file_size_limit: 1 }), new Error(syntheticKey)]) {
    const fake = fakeHttp([missing(), json({ name: DOCUMENT_EXPORT_BUCKET.name }), after]);
    const result = await configureDocumentExportStorage({ apply: true, environment, fetchImpl: fake.fetchImpl });
    assert.equal(result.exitCode, 1); assert.equal(result.report.status, "readback_failed");
    assert.equal(result.report.readbackVerified, false); assert.equal(fake.calls.length, 3);
    assert.equal(JSON.stringify(result).includes(syntheticKey), false);
  }
});

test("unknown create outcome has no automatic write retry or unproven success", async () => {
  for (const outcome of [new Error(syntheticKey), json({ message: syntheticKey }, 500), json({ name: "unexpected" }),
    new Response("{", { headers: { "content-type": "application/json" } })]) {
    const fake = fakeHttp([missing(), outcome]);
    const result = await configureDocumentExportStorage({ apply: true, environment, fetchImpl: fake.fetchImpl });
    assert.equal(result.exitCode, 1); assert.equal(result.report.status, "create_outcome_unknown");
    assert.equal(result.report.after, null); assert.equal(result.report.readbackVerified, false);
    assert.equal(fake.calls.length, 2); assert.equal(JSON.stringify(result).includes(syntheticKey), false);
  }
});

test("credential rejection or create conflict is terminal without another request", async () => {
  for (const status of [401, 403, 409]) {
    const fake = fakeHttp([missing(), json({ message: syntheticKey }, status)]);
    const result = await configureDocumentExportStorage({ apply: true, environment, fetchImpl: fake.fetchImpl });
    assert.equal(result.exitCode, 1); assert.equal(fake.calls.length, 2);
    assert.equal(result.report.status, status === 409 ? "create_conflict" : "credentials_rejected");
    assert.equal(JSON.stringify(result).includes(syntheticKey), false);
  }
});

test("unknown absence, redirect or malformed response never authorizes creation", async () => {
  for (const response of [json({ code: "TenantNotFound" }, 404), json({ error: "not_found" }, 404),
    new Response(null, { status: 302, headers: { location: `https://unrelated.test/?key=${syntheticKey}` } }),
    json({ ...bucket(), id: "other" }), new Response("not-json", { headers: { "content-type": "application/json" } }),
    json({ ...bucket(), allowed_mime_types: [null] }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "65537" } }),
    json({ message: "x".repeat(65537) })]) {
    const fake = fakeHttp([response]);
    const result = await configureDocumentExportStorage({ apply: true, environment, fetchImpl: fake.fetchImpl });
    assert.equal(result.exitCode, 1); assert.equal(result.report.mutationAttempted, false); assert.equal(fake.calls.length, 1);
    assert.equal(JSON.stringify(result).includes(syntheticKey), false);
  }
});

test("CLI outputs only safe settings and fixed error codes for synthetic HTTP", async () => {
  const fake = fakeHttp([json({ ...bucket(), allowed_mime_types: [syntheticKey] })]); let output = "";
  const exitCode = await runDocumentExportStorageCli([], { environment, fetchImpl: fake.fetchImpl, write: text => { output += text; } });
  assert.equal(exitCode, 1); const parsed = JSON.parse(output);
  assert.equal(parsed.status, "bucket_settings_conflict"); assert.deepEqual(parsed.before.allowed_mime_types, ["OTHER_MIME"]);
  assert.doesNotMatch(output, /excluded-owner|excluded-timestamp|synthetic_unit_only/u);
});
