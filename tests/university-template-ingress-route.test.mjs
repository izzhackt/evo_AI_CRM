import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createUniversityTemplateIngressHandlers } from "../src/lib/server/university-template-ingress-route-handlers.ts";
import { isConnectedPlatformApi } from "../src/lib/platform-route-contract.ts";

const template = "73000000-0000-4000-8000-000000000001", version = "73000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ templateId: template, versionId: version }) };
const url = `https://crm.example.test/api/v3/university-forms/${template}/versions/${version}/source`;
const actor = { authUserId: "73000000-0000-4000-8000-000000000003", membershipId: "73000000-0000-4000-8000-000000000004",
  organizationId: "73000000-0000-4000-8000-000000000005", systemRole: "staff", presentationRole: null, permissionKeys: ["catalog.import.manage"] };
const uploadRequest = (headers = {}) => new Request(url, { method: "POST", body: "synthetic", headers: { origin: "https://crm.example.test",
  "content-type": "application/pdf", "idempotency-key": "73000000-0000-4000-8000-000000000006", "if-match": '"2"', ...headers } });
const ingress = "73000000-0000-4000-8000-000000000007", claim = "73000000-0000-4000-8000-000000000008";
const receipt = (state, extra = {}) => ({ schema_version: 1, ingress_id: ingress, template_id: template, template_version_id: version,
  request_id: "73000000-0000-4000-8000-000000000006", revision: 2, state, sha256: "a".repeat(64), byte_size: 9,
  inspection_receipt_id: null, failure_code: null, replayed: false, can_reconcile: false, can_cancel: true, ...extra });
const identityStub = () => ({ imageId: `sha256:${"a".repeat(64)}`, imageSha256: "a".repeat(64), revision: "b".repeat(40), digestKind: "Dockerengine-image-id" });
const source = { organization_id: actor.organizationId, catalog_institution_id: claim, catalog_source_revision: "synthetic-catalog-revision-v1",
  template_id: template, template_version_id: version, expected_revision: 2, sha256: "a".repeat(64), byte_size: 9, mime_type: "application/pdf",
  bucket_id: "platform-document-templates", object_name: `${actor.organizationId}/${template}/${version}.pdf` };
const transport = run => ({ schema() { return { rpc(name, args) { return { abortSignal() { return Promise.resolve().then(() => run(name, args)); } }; } }; } });
test("anonymous source upload never reads bytes, creates a service client or invokes an inspector", async () => {
  const deny = () => { assert.fail("private operation before authorization"); };
  const handlers = createUniversityTemplateIngressHandlers({ loadActor: async () => ({ status: "anonymous", actor: null }),
    createSessionClient: deny, createServiceClient: deny, readIdentity: deny, scan: deny, inspect: deny });
  const response = await handlers.upload(new Request(url, { method: "POST" }), context);
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "authentication_required" });
});

test("bytes inconsistent with the reservation cannot reach ClamAV, native inspection or Storage", async () => {
  const calls = [];
  // Successful transport envelopes model admission only; no inspector/storage success is mocked.
  const handlers = createUniversityTemplateIngressHandlers({ loadActor: async () => ({ status: "authenticated", actor }), readIdentity: identityStub,
    backendConfig: () => ({ supabaseUrl: "http://127.0.0.1:54321", supabaseSecretKey: "synthetic-transport-only" }),
    createSessionClient: async () => transport(() => ({ data: { receipt: receipt("prepared") }, error: null })),
    createServiceClient: () => transport((name, args) => {
      calls.push(name);
      if (name === "begin_university_template_ingress") return { data: { receipt: receipt("processing"), claim_token: claim, source,
        expires_at: new Date(Date.now() + 120000).toISOString() }, error: null };
      assert.equal(name, "complete_university_template_ingress"); assert.equal(args.p_outcome, "failed"); assert.equal(args.p_failure_code, "source_mismatch");
      return { data: receipt("failed", { failure_code: "source_mismatch", can_cancel: false }), error: null };
    }), scan() { assert.fail("scanner cannot inspect wrong source"); }, inspect() { assert.fail("native cannot inspect wrong source"); },
    fetch() { assert.fail("cannot upload wrong source"); } });
  const response = await handlers.upload(uploadRequest(), context);
  assert.equal(response.status, 409); assert.equal((await response.json()).failure_code, "source_mismatch");
  assert.deepEqual(calls, ["begin_university_template_ingress", "complete_university_template_ingress"]);
});

test("authorized upload fails closed before any reservation when controller identity is unavailable", async () => {
  const handlers = createUniversityTemplateIngressHandlers({ loadActor: async () => ({ status: "authenticated", actor }),
    readIdentity() { throw new Error("private configuration detail"); }, createSessionClient() { assert.fail("no reserve"); } });
  const response = await handlers.upload(uploadRequest(), context);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "template_runtime_unavailable" });
});

test("database denial cannot be replaced by a service credential or template bytes", async () => {
  let calls = 0;
  const handlers = createUniversityTemplateIngressHandlers({ loadActor: async () => ({ status: "authenticated", actor }),
    // Identity is an external boundary stub solely to reach a denied SQL request.
    readIdentity: () => ({ imageId: `sha256:${"a".repeat(64)}`, imageSha256: "a".repeat(64), revision: "b".repeat(40), digestKind: "Dockerengine-image-id" }),
    createSessionClient: async () => ({ schema(name) { assert.equal(name, "platform"); return { rpc(name) {
      calls++; assert.equal(name, "prepare_university_template_ingress"); return { abortSignal() { return Promise.resolve({ data: null, error: { code: "42501", message: "private detail" } }); } };
    } }; } }), createServiceClient() { assert.fail("service before session admission"); },
    backendConfig: () => ({ supabaseUrl: "http://127.0.0.1:54321", supabaseSecretKey: "synthetic-transport-only" }) });
  const response = await handlers.upload(uploadRequest(), context);
  assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: "forbidden" }); assert.equal(calls, 1);
});

test("cancel remains a live-session command without scanner, native identity or service-key authority", async () => {
  const handlers = createUniversityTemplateIngressHandlers({ loadActor: async () => ({ status: "authenticated", actor }),
    readIdentity() { assert.fail("cancel must not require inspector"); }, createServiceClient() { assert.fail("cancel must be session-only"); },
    createSessionClient: async () => transport((name, args) => {
      assert.equal(name, "cancel_university_template_ingress"); assert.equal(args.p_expected_revision, 2);
      return { data: receipt("cancelled", { failure_code: "cancelled", can_cancel: false }), error: null };
    }) });
  const response = await handlers.cancel(new Request(`${url}/cancel`, { method: "POST", headers: { origin: "https://crm.example.test", "content-type": "application/json" },
    body: JSON.stringify({ request_id: claim, expected_revision: 2, reason: "Synthetic cancel" }) }), context);
  assert.equal(response.status, 200); assert.equal((await response.json()).state, "cancelled");
});

test("source reads and reconciliation reject anonymous callers without any private operation", async () => {
  const handlers = createUniversityTemplateIngressHandlers({ loadActor: async () => ({ status: "anonymous", actor: null }),
    createSessionClient() { assert.fail("anonymous source access"); }, createServiceClient() { assert.fail("anonymous source access"); } });
  for (const method of ["read", "reconcile"]) {
    const response = await handlers[method](new Request(url, { method: method === "read" ? "GET" : "POST" }), context);
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "authentication_required" });
  }
});

test("only four exact template source API paths enter the connected route boundary", () => {
  const base = new URL(url).pathname;
  for (const suffix of ["", "/status", "/cancel", "/reconcile"]) assert.equal(isConnectedPlatformApi(base + suffix), true, suffix);
  for (const suffix of ["/", "/status/", "/unknown", "/download", "/reconcile/other"]) assert.equal(isConnectedPlatformApi(base + suffix), false, suffix);
  assert.equal(isConnectedPlatformApi(base.replace(template, "invalid")), false);
  assert.equal(isConnectedPlatformApi("/api/v3/university-forms"), false);
});

for (const [name, actorResult] of [["no permission", { status: "authenticated", actor: { ...actor, permissionKeys: [] } }],
  ["staff preview", { status: "authenticated", actor: { ...actor, systemRole: "admin", presentationRole: "admissions" } }],
  ["invalid authority", { status: "invalid", actor: null, reason: "staff_authority_invalid" }]]) {
  test(`${name} cannot enter any template source operation`, async () => {
    const handlers = createUniversityTemplateIngressHandlers({ loadActor: async () => actorResult,
      createSessionClient() { assert.fail("session after rejected actor"); }, readIdentity() { assert.fail("identity after rejected actor"); } });
    for (const operation of ["upload", "status", "read", "cancel", "reconcile"]) {
      const response = await handlers[operation](new Request(url), context); assert.ok([403, 503].includes(response.status));
    }
  });
}

for (const [name, changed, status] of [["foreign origin", { origin: "https://attacker.invalid" }, 403],
  ["malformed revision", { "if-match": "2" }, 400], ["wildcard revision", { "if-match": "*" }, 400],
  ["oversized declaration", { "content-length": "20971521" }, 413], ["wrong MIME", { "content-type": "image/png" }, 415],
  ["bad request ID", { "idempotency-key": "bad" }, 400]]) {
  test(`upload rejects ${name} before identity or reservation`, async () => {
    const handlers = createUniversityTemplateIngressHandlers({ loadActor: async () => ({ status: "authenticated", actor }),
      readIdentity() { assert.fail("invalid request reached native identity"); } });
    const response = await handlers.upload(uploadRequest(changed), context); assert.equal(response.status, status);
  });
}

test("request cancellation returns even if the actor resolver ignores abort", async () => {
  const stop = new AbortController();
  const handlers = createUniversityTemplateIngressHandlers({ loadActor: () => new Promise(() => {}) });
  const result = handlers.status(new Request(url, { signal: stop.signal }), context);
  stop.abort(); const response = await result; assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "expired" });
});

test("aborted upload retains byte admission until the actual uncancellable scanner settles", async () => {
  const sha256 = createHash("sha256").update("synthetic").digest("hex");
  const stop = new AbortController(); let entered, rejectScan, scans = 0, preparations = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const unfinished = new Promise((_, reject) => { rejectScan = reject; });
  const handlers = createUniversityTemplateIngressHandlers({ loadActor: async () => ({ status: "authenticated", actor }),
    readIdentity: identityStub, backendConfig: () => ({ supabaseUrl: "http://127.0.0.1:54321", supabaseSecretKey: "synthetic-transport-only" }),
    createSessionClient: async () => transport(() => {
      preparations++; return { data: { receipt: receipt("prepared", { sha256 }) }, error: null };
    }), createServiceClient: () => transport(name => {
      if (name === "begin_university_template_ingress") return { data: { receipt: receipt("processing", { sha256 }),
        claim_token: claim, source: { ...source, sha256 }, expires_at: new Date(Date.now() + 120000).toISOString() }, error: null };
      assert.equal(name, "complete_university_template_ingress");
      return { data: receipt("failed", { sha256, failure_code: "scanner_unavailable", can_cancel: false }), error: null };
    }), scan() { scans++; entered(); return scans === 1 ? unfinished : Promise.reject(new Error("negative scanner fixture")); },
    inspect() { assert.fail("negative scanner cannot reach inspection"); }, fetch() { assert.fail("negative scanner cannot reach Storage"); } });
  try {
    const first = handlers.upload(new Request(uploadRequest(), { signal: stop.signal }), context);
    await started; stop.abort(); assert.equal((await first).status, 503);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await handlers.upload(uploadRequest(), context)).status, 503);
    assert.equal(scans, 1); assert.equal(preparations, 1);
    rejectScan(new Error("negative scanner fixture"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await handlers.upload(uploadRequest(), context)).status, 409);
    assert.equal(scans, 2); assert.equal(preparations, 2);
  } finally { rejectScan(new Error("fixture cleanup")); await new Promise(resolve => setImmediate(resolve)); }
});

function sourceAccessFixture(permitted) {
  const bytes = Buffer.from("synthetic"), sha256 = createHash("sha256").update(bytes).digest("hex"), calls = [];
  const verified = receipt("verified", { revision: 3, sha256, inspection_receipt_id: claim, can_cancel: false });
  const metadata = { schema_version: 1, template_id: template, template_version_id: version, template_sha256: sha256,
    mime_type: "application/pdf", template_revision: 3, source_current: true, inspection: "verified",
    manifest: { format: "pdf", slots: [], pageSizes: [{ width: 595, height: 842 }] }, receipt_id: claim,
    inspected_at: "2026-09-14T00:00:00Z", ingress: verified };
  const handlers = createUniversityTemplateIngressHandlers({ loadActor: async () => ({ status: "authenticated", actor }),
    readIdentity() { assert.fail("verified source read must not need native processing authority"); },
    backendConfig: () => ({ supabaseUrl: "http://127.0.0.1:54321", supabaseSecretKey: "synthetic-transport-only" }),
    createSessionClient: async () => transport((name, args) => {
      calls.push(name);
      if (name === "staff_university_template_inspection") return { data: metadata, error: null };
      assert.equal(args.p_expected_revision, 3); return { data: { grant_id: claim }, error: null };
    }), createServiceClient: () => transport((name, args) => {
      calls.push(name);
      if (name === "consume_university_template_source_access") return { data: { grant_id: claim, receipt: verified,
        source: { ...source, expected_revision: 3, sha256 }, expires_at: new Date(Date.now() + 60000).toISOString() }, error: null };
      assert.equal(name, "complete_university_template_source_access"); assert.equal(args.p_observed_sha256, sha256);
      return { data: { permitted, receipt: verified }, error: null };
    }), fetch: async () => new Response(bytes, { headers: { "content-type": "application/pdf", "content-length": "9" } }) });
  return { handlers, bytes, calls };
}
test("guarded source transport withholds even exact bytes after final authority denial", async () => {
  const f = sourceAccessFixture(false), response = await f.handlers.read(new Request(url), context);
  assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: "source_changed" });
  assert.equal(f.calls.at(-1), "complete_university_template_source_access");
});
test("guarded source transport emits exact bytes only after single-use final permission", async () => {
  // External database/Storage envelopes only; no native or real service success claim.
  const f = sourceAccessFixture(true), response = await f.handlers.read(new Request(url), context);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-disposition"), 'inline; filename="university-template.pdf"');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes);
  assert.equal(f.calls.filter(name => name === "consume_university_template_source_access").length, 1);
});

test("actual source route modules reject unsupported methods rather than executing implicit HEAD reads", async () => {
  for (const [suffix, allow, methods] of [["", "GET, POST", ["HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]],
    ["/status", "GET", ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]],
    ["/cancel", "POST", ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]],
    ["/reconcile", "POST", ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]]]) {
    const route = await import(`../src/app/api/v3/university-forms/[templateId]/versions/[versionId]/source${suffix}/route.ts`);
    for (const method of methods) { const response = route[method](); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), allow); }
  }
});
