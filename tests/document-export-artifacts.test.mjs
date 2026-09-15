import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDocumentExportHandlers, createDocumentExportDownloadHandler, createDocumentExportReconcileHandler,
} from "../src/lib/server/document-export-artifact-route-handlers.ts";
import { normalizeDocumentExportReceipt, normalizeDocumentExportWorkspace } from "../src/lib/document-export-artifacts.ts";
import { DOCUMENT_EXPORT_MIME, DOCUMENT_EXPORT_RENDERER_VERSION, DOCUMENT_EXPORT_TEMPLATE_SHA256 } from "../src/lib/document-export-artifact-contract.ts";
import { renderStudentProfileTemplate } from "../src/lib/server/student-profile-template.ts";
import { PROFILE_FIELDS } from "../src/lib/student-profile-fields.ts";
import PizZip from "pizzip";

const id = n => `60164000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(1), CASE = id(2), PROFILE = id(3), USER = id(4), MEMBER = id(5), REQUEST = id(6), ARTIFACT = id(7), PREP = id(8), CLAIM = id(9), GRANT = id(10);
const HASH = "a".repeat(64), ORIGIN = "http://localhost:3000";
const actor = { authUserId: USER, membershipId: MEMBER, organizationId: ORG, systemRole: "staff",
  permissionKeys: ["profile.read.full", "document.download"], presentationRole: null };
const template = readFileSync(new URL("../assets/templates/student-profile.docx", import.meta.url));
const required = { student_first_name: "SyntheticFirst", student_last_name: "SyntheticLast", date_of_birth: "2005-01-02",
  nationality: "Fictional country", passport_number: "TEST12345", permanent_address: "Synthetic street1",
  mobile_phone: "+996700123456", student_email: "synthetic@example.invalid", field_major: "Engineering" };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function receipt(overrides = {}) {
  return { id: ARTIFACT, student_case_id: CASE, student_profile_id: PROFILE, profile_revision: 7,
    workspace_revision: HASH, input_snapshot_sha256: HASH, field_reviews_sha256: HASH,
    kind: "student_profile", mode: "draft", state: "pending", template_sha256: DOCUMENT_EXPORT_TEMPLATE_SHA256,
    renderer_version: DOCUMENT_EXPORT_RENDERER_VERSION, created_at: "2026-09-13T00:00:00Z", ready_at: null,
    output_sha256: null, output_bytes: null, mime_type: DOCUMENT_EXPORT_MIME, receipt_id: null,
    failure_code: null, historical: false, can_download: false, ...overrides };
}
function frozen() {
  return { student_case_id: CASE, profile: { id: PROFILE, revision: 7 }, can_initialize: false, can_review: false, can_export: true,
    fields: PROFILE_FIELDS.map(({ key }) => ({ field_key: key, value: required[key] ?? null,
      review_state: required[key] ? "confirmed" : "needs_review", reviewed_at: required[key] ? "2026-09-13T00:00:00Z" : null,
      source_document_version_id: null, source_page: null, proposals: [] })) };
}
function request(overrides = {}, suffix = "", method = "POST") {
  return new Request(`${ORIGIN}/api/v3/student-cases/${CASE}/document-exports${suffix}`, {
    method, headers: { origin: ORIGIN, host: "localhost:3000", "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify({ mode: "draft", expected_workspace_revision: HASH, request_id: REQUEST, ...overrides }) }),
  });
}
const context = { params: Promise.resolve({ studentCaseId: CASE, artifactId: ARTIFACT }) };

// Explicit SQL/Storage transport doubles around the real opaque ZIP builder.
// Actual Auth/Storage/browser evidence belongs to the isolated browser harness.
function packageFixture(t, options = {}) {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, previousKey = process.env.EVO_PLATFORM_SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic-package.supabase.co";
  process.env.EVO_PLATFORM_SUPABASE_SECRET_KEY = "sb_secret_synthetic_package_fixture_only";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.EVO_PLATFORM_SUPABASE_SECRET_KEY; else process.env.EVO_PLATFORM_SUPABASE_SECRET_KEY = previousKey;
  });
  const calls = [], inputBytes = Buffer.from("Synthetic opaque source bytes"); let stored = null;
  const expires = new Date(Date.now() + 590000).toISOString(), packetId = id(21), versionId = id(22), applicationId = id(23);
  let a = receipt({ kind: "package", student_profile_id: null, profile_revision: null, field_reviews_sha256: null, template_sha256: null,
    mime_type: "application/zip", renderer_version: "evo-partner-packet-zip-v1", package: { id: packetId, application_id: applicationId, item_count: 1 } });
  const target = { bucket_id: "platform-document-exports", object_name: `${ORG}/${CASE}/${ARTIFACT}.zip`, mime_type: "application/zip", expires_at: expires };
  const source = { kind: "original", id: versionId, slot_id: id(24), filename: "Original.pdf", version_no: "1",
    sha256: hash(inputBytes), size_bytes: inputBytes.length, mime_type: "application/pdf", bucket_id: "platform-documents",
    object_name: "aa/" + "b".repeat(62), review_id: id(25) };
  function client(scope) { return { schema(schema) { assert.equal(schema, "platform"); return { rpc(name, args) {
    calls.push([scope, name, args]);
    const error = options.errors?.[name];
    if (error) return { abortSignal: async () => ({ data: null, error: { code: error } }) };
    let data;
    if (name === "prepare_document_package_export") data = { schema_version: 1, preparation_id: PREP, artifact: a };
    else if (name === "begin_document_export") data = { artifact: a, created: !options.replay, claim_token: options.replay ? null : CLAIM };
    else if (name === "read_document_package_export_sources") data = { artifact_id: ARTIFACT, packet_id: packetId, workspace_revision: HASH,
      expires_at: expires, sources: [{ ...source, ...(options.source ?? {}) }] };
    else if (name === "seal_document_export_output") {
      assert.equal(args.p_renderer_proof, null); a = { ...a, output_bytes: args.p_output_bytes, output_sha256: args.p_output_sha256 };
      data = { artifact: a, storage: target };
    } else if (name === "complete_document_export") {
      if (options.lostCompletion) return { abortSignal: async () => { throw new Error("Synthetic lost completion reply"); } };
      const ready = args.p_outcome === "ready";
      a = { ...a, state: args.p_outcome, failure_code: args.p_failure_code, ready_at: ready ? "2026-09-15T00:00:00Z" : null,
        receipt_id: ready ? GRANT : null, can_download: ready }; data = a;
    } else assert.fail(`Unexpected RPC ${name}`);
    return { abortSignal: async () => ({ data: structuredClone(data), error: null }) };
  } }; }, storage: {
    getBucket: async () => ({ data: { public: false, file_size_limit: options.capacity ?? 52428800, allowed_mime_types: ["application/zip"] }, error: null }),
    from(bucket) { assert.equal(bucket, "platform-document-exports"); return { upload: async (object, bytes, policy) => {
      calls.push(["storage", "upload"]); assert.equal(object, target.object_name); assert.equal(policy.upsert, false);
      if (options.uploadError) return { data: null, error: new Error("Synthetic uncertain storage") };
      stored = Buffer.from(bytes); return { error: null };
    } }; },
  } }; }
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(["storage", "read"]);
    if (url.endsWith(source.object_name)) return new Response(options.corruptSource ? Buffer.alloc(inputBytes.length) : inputBytes,
      { headers: { "content-type": "application/pdf", "content-length": String(inputBytes.length) } });
    assert.ok(url.endsWith(target.object_name)); assert.ok(stored);
    return new Response(options.corruptReadback ? Buffer.alloc(stored.length) : stored,
      { headers: { "content-type": "application/zip", "content-length": String(stored.length) } });
  });
  const deps = { loadActor: async () => ({ status: "authenticated", actor }),
    createSessionClient: async () => client("session"), createServiceClient: () => client("service") };
  return { deps, calls, packetId, inputBytes, versionId, stored: () => stored };
}
test("package route saves one immutable ZIP, verifies source and readback, no profile rendering", async t => {
  const f = packageFixture(t), response = await createDocumentExportHandlers(f.deps).POST(request({ kind: "package", packet_id: f.packetId }), context);
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.artifact.kind, "package");
  assert.equal(body.artifact.student_profile_id, null); assert.equal(body.artifact.state, "ready");
  const zip = new PizZip(f.stored()); assert.deepEqual(zip.file(`original/${f.versionId}.pdf`).asNodeBuffer(), f.inputBytes);
  assert.ok(!JSON.stringify(body).includes("object_name")); assert.ok(!JSON.stringify(body).includes("claim_token"));
  assert.equal(f.calls.filter(([, name]) => name === "upload").length, 1);
  assert.equal(f.calls.filter(([, name]) => name === "complete_document_export").length, 1);
});
test("package replay never reads sources or writes bytes", async t => {
  const f = packageFixture(t, { replay: true });
  const response = await createDocumentExportHandlers(f.deps).POST(request({ kind: "package", packet_id: f.packetId }), context);
  assert.equal(response.status, 202); assert.equal(f.calls.some(([scope]) => scope === "storage"), false);
});
test("insufficient configured capacity is an explicit prewrite failure", async t => {
  const f = packageFixture(t, { capacity: 20971520 });
  const response = await createDocumentExportHandlers(f.deps).POST(request({ kind: "package", packet_id: f.packetId }), context);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "package_storage_not_ready" }); assert.equal(f.calls.length, 0);
});
test("SQL preparation rejection is definite, later lease uncertainty is not relabeled prewrite", async t => {
  const f = packageFixture(t, { errors: { prepare_document_package_export: "55000" } });
  const response = await createDocumentExportHandlers(f.deps).POST(request({ kind: "package", packet_id: f.packetId }), context);
  assert.equal(response.status, 422); assert.deepEqual(await response.json(), { error: "package_not_ready" });
  assert.equal(f.calls.length, 1);
});
test("SQL begin uncertainty stays artifact_pending after preparation exists", async t => {
  const f = packageFixture(t, { errors: { begin_document_export: "55000" } });
  const response = await createDocumentExportHandlers(f.deps).POST(request({ kind: "package", packet_id: f.packetId }), context);
  assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: "artifact_pending" });
  assert.equal(f.calls.length, 2);
});
for (const [name, options, expected] of [["corrupt source", { corruptSource: true }, "failed"],
  ["unbound source location", { source: { object_name: "../elsewhere" } }, "failed"],
  ["corrupt stored ZIP", { corruptReadback: true }, "failed"], ["uncertain upload", { uploadError: true }, "unknown"]]) {
  test(`package ${name} never becomes ready`, async t => {
    const f = packageFixture(t, options), response = await createDocumentExportHandlers(f.deps).POST(request({ kind: "package", packet_id: f.packetId }), context);
    const body = await response.json(); assert.equal(body.artifact.state, expected); assert.equal(body.artifact.can_download, false);
  });
}
test("lost package completion has no competing second completion", async t => {
  const f = packageFixture(t, { lostCompletion: true });
  const response = await createDocumentExportHandlers(f.deps).POST(request({ kind: "package", packet_id: f.packetId }), context);
  assert.equal(response.status, 503); assert.equal(f.calls.filter(([, name]) => name === "complete_document_export").length, 1);
});

// Real input normalizer/readiness/OOXML renderer. Auth, SQL and Storage are
// explicit test doubles; this suite is not database/provider/browser proof.
function fixture(options = {}) {
  const calls = []; let current = receipt(options.receipt); let stored = options.stored ?? null; let actorReads = 0;
  const profile = frozen();
  const target = { bucket_id: "platform-document-exports", object_name: `${ORG}/${CASE}/${ARTIFACT}.docx`,
    mime_type: DOCUMENT_EXPORT_MIME, expires_at: new Date(Date.now() + 600000).toISOString() };
  const workspace = () => ({ schema_version: 1, student_case_id: CASE, profile: { id: PROFILE, revision: 7 },
    workspace_revision: HASH, can_export: true, artifacts: [{ ...current }] });
  function client(scope) {
    return { schema(schema) { assert.equal(schema, "platform"); return { async rpc(name, args) {
      calls.push([scope, name, args]);
      if (options.errors?.[name]) return { data: null, error: { code: options.errors[name] } };
      const result = value => ({ data: structuredClone(value), error: null });
      if (scope === "session") {
        if (name === "staff_document_export_workspace") return result(workspace());
        if (name === "staff_document_export_workspace_v2") return result({ ...workspace(), schema_version: 2 });
        if (name === "prepare_document_export") return result({ schema_version: 1, preparation_id: PREP,
          artifact: current, frozen_profile: options.replay ? null : profile });
        assert.equal(name, "grant_document_export_download");
        return result({ grant_id: GRANT, artifact_id: ARTIFACT, expires_at: target.expires_at, consumed: false });
      }
      assert.ok(!JSON.stringify(args).includes("SyntheticFirst"), "service calls never receive profile values");
      if (name === "begin_document_export") {
        assert.equal(args.p_actor_auth_user_id, USER); assert.equal(args.p_actor_membership_id, MEMBER);
        return result({ artifact: current, created: !options.replay, claim_token: options.replay ? null : CLAIM });
      }
      if (name === "seal_document_export_output") {
        assert.equal(args.p_claim_token, CLAIM); current = { ...current, output_sha256: args.p_output_sha256, output_bytes: args.p_output_bytes };
        return result({ artifact: current, storage: options.badTarget ? { ...target, object_name: "wrong/private-key" } : target });
      }
      if (name === "complete_document_export" || name === "reconcile_document_export") {
        const outcome = options.stale ? "failed" : name === "reconcile_document_export"
          ? args.p_failure_code === null ? "ready" : args.p_failure_code === "storage_unavailable" ? "unknown" : "failed" : args.p_outcome;
        if (current.state !== "ready") current = { ...current, state: outcome, failure_code: options.stale ? "source_changed" : args.p_failure_code,
          ready_at: outcome === "ready" ? "2026-09-13T00:01:00Z" : null, receipt_id: outcome === "ready" ? id(11) : null, can_download: outcome === "ready" };
        if (options.lostReady && args.p_outcome === "ready") throw new Error("Synthetic lost completion reply");
        return result(current);
      }
      if (name === "inspect_document_export_reconciliation") return result({ artifact: current, storage: options.unsealed ? null : target });
      if (name === "consume_document_export_download") return result({ grant_id: GRANT, artifact: current, storage: target });
      assert.equal(name, "complete_document_export_download");
      const verified = !options.downloadRevoked && args.p_observed_sha256 === current.output_sha256 && args.p_observed_bytes === current.output_bytes;
      return result({ grant_id: GRANT, artifact_id: ARTIFACT, verified, failure_code: verified ? null : "access_changed" });
    } }; }, storage: { from(bucket) {
      assert.equal(bucket, "platform-document-exports");
      return {
        async upload(key, bytes, config) {
          calls.push(["storage", "upload", key]); assert.equal(key, target.object_name);
          assert.deepEqual(config, { contentType: DOCUMENT_EXPORT_MIME, upsert: false });
          assert.ok(current.output_sha256, "identity is durable before upload");
          if (options.uploadUnknown) { stored = Buffer.from(bytes); throw new Error("Synthetic ambiguous upload"); }
          stored = Buffer.from(bytes); return { error: null };
        },
        async download(key) {
          calls.push(["storage", "download", key]); assert.equal(key, target.object_name);
          if (!stored) return { data: null, error: { message: "Never forwarded" } };
          return { error: null, data: new Blob([options.corrupt ? Buffer.from("bad") : stored]) };
        },
      };
    } } };
  }
  const deps = {
    async loadActor() { actorReads++; return options.actorResult ?? (options.revokeActor && actorReads > 1
      ? { status: "authenticated", actor: { ...actor, permissionKeys: [] } } : { status: "authenticated", actor }); },
    async createSessionClient() { return client("session"); }, createServiceClient() { return client("service"); },
    async readTemplate() { return template; }, render(t, values, mode) { calls.push(["renderer"]); return renderStudentProfileTemplate(t, values, mode); },
    requestId() { return REQUEST; },
  };
  return { handlers: createDocumentExportHandlers(deps), download: createDocumentExportDownloadHandler(deps),
    reconcile: createDocumentExportReconcileHandler(deps), calls, profile, get current() { return current; }, get stored() { return stored; } };
}

test("freeze under staff session, render once, seal before upload, verify stored bytes then ready receipt", async () => {
  const f = fixture(); const res = await f.handlers.POST(request(), context);
  assert.equal(res.status, 200); const data = await res.json(); assert.equal(data.artifact.state, "ready");
  assert.equal(data.artifact.output_sha256, hash(f.stored));
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(f.calls.map(call => call[1] ?? call[0]), ["prepare_document_export", "begin_document_export", "renderer",
    "seal_document_export_output", "upload", "download", "complete_document_export"]);
  assert.doesNotMatch(JSON.stringify(data), /Synthetic|claim_token|frozen_profile|object_name/);
});
test("ready exact replay returns artifact without values, renderer or Storage", async () => {
  const f = fixture({ replay: true, receipt: { state: "ready", ready_at: "2026-09-13T00:01:00Z", receipt_id: id(11),
    output_sha256: HASH, output_bytes: 20, can_download: true } });
  assert.equal((await f.handlers.POST(request(), context)).status, 200);
  assert.deepEqual(f.calls.map(call => call[1]), ["prepare_document_export", "begin_document_export"]);
});
test("pending replay returns202 and never regenerates", async () => {
  const f = fixture({ replay: true }); assert.equal((await f.handlers.POST(request(), context)).status, 202);
  assert.equal(f.calls.length, 2);
});
test("changed request conflicts before elevated work", async () => {
  const f = fixture({ errors: { prepare_document_export: "23505" } });
  const res = await f.handlers.POST(request(), context); assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "request_conflict" }); assert.equal(f.calls.length, 1);
});
test("final readiness failure commits fixed failure, no render/upload or private values", async () => {
  const f = fixture({ receipt: { mode: "final" } }); f.profile.fields[0].review_state = "needs_review";
  const res = await f.handlers.POST(request({ mode: "final" }), context);
  assert.equal(res.status, 422); assert.equal((await res.json()).artifact.failure_code, "profile_not_ready");
  assert.ok(!f.calls.some(call => call[0] === "renderer" || call[0] === "storage"));
});
test("malformed storage metadata fails before upload", async () => {
  const f = fixture({ badTarget: true }); assert.equal((await f.handlers.POST(request(), context)).status, 503);
  assert.ok(!f.calls.some(call => call[0] === "storage"));
});
test("ambiguous upload remains unknown and returns no bytes", async () => {
  const f = fixture({ uploadUnknown: true }); const res = await f.handlers.POST(request(), context);
  assert.equal(res.status, 202); assert.equal((await res.json()).artifact.state, "unknown");
  assert.ok(f.stored); assert.equal(f.calls.filter(call => call[1] === "upload").length, 1);
});
test("lost ready reply is unconfirmed and never sends a changed second completion", async () => {
  const f = fixture({ lostReady: true }); const res = await f.handlers.POST(request(), context);
  assert.equal(res.status, 503); assert.deepEqual(await res.json(), { error: "export_unavailable" });
  assert.equal(f.current.state, "ready", "database may have committed; history/replay can recover it");
  assert.equal(f.calls.filter(call => call[1] === "complete_document_export").length, 1);
  assert.equal(f.calls.filter(call => call[0] === "renderer").length, 1);
});
test("corrupted readback fails and cannot publish ready", async () => {
  const f = fixture({ corrupt: true }); const res = await f.handlers.POST(request(), context);
  assert.equal(res.status, 409); assert.equal((await res.json()).artifact.failure_code, "integrity_failed");
});
test("SQL source fence returns committed stale failure after Storage upload", async () => {
  const f = fixture({ stale: true }); const res = await f.handlers.POST(request(), context);
  assert.equal(res.status, 409); assert.equal((await res.json()).artifact.failure_code, "source_changed");
  assert.ok(f.stored);
});
test("actor revocation after rendering records denied failure before seal or upload", async () => {
  const f = fixture({ revokeActor: true }); const res = await f.handlers.POST(request(), context);
  assert.equal(res.status, 403); assert.equal((await res.json()).artifact.failure_code, "access_changed");
  assert.ok(!f.calls.some(call => call[0] === "storage" || call[1] === "seal_document_export_output"));
});
test("historical download uses current session grant and stored bytes only", async () => {
  const stored = Buffer.from("Synthetic stored document bytes");
  const f = fixture({ stored, receipt: { state: "ready", historical: true, ready_at: "2026-09-13T00:01:00Z", receipt_id: id(11),
    output_sha256: hash(stored), output_bytes: stored.length, can_download: true } });
  const res = await f.download(request({}, `/${ARTIFACT}/download`, "GET"), context);
  assert.equal(res.status, 200); assert.deepEqual(Buffer.from(await res.arrayBuffer()), stored);
  assert.deepEqual(f.calls.map(call => call[1]), ["grant_document_export_download", "consume_document_export_download", "download", "complete_document_export_download"]);
});
test("download revocation at final fence never returns stored bytes", async () => {
  const stored = Buffer.from("Secret synthetic bytes");
  const f = fixture({ stored, downloadRevoked: true, receipt: { state: "ready", ready_at: "2026-09-13T00:01:00Z", receipt_id: id(11),
    output_sha256: hash(stored), output_bytes: stored.length, can_download: true } });
  const res = await f.download(request({}, `/${ARTIFACT}/download`, "GET"), context);
  assert.equal(res.status, 403); assert.doesNotMatch(await res.text(), /Secret/);
});
test("reconcile reads known sealed object and never uploads or renders", async () => {
  const stored = Buffer.from("Synthetic sealed bytes"); const f = fixture({ stored,
    receipt: { state: "unknown", failure_code: "storage_unavailable", output_sha256: hash(stored), output_bytes: stored.length } });
  const req = new Request(`${ORIGIN}/reconcile`, { method: "POST", headers: { origin: ORIGIN, host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ request_id: REQUEST }) });
  const res = await f.reconcile(req, context); assert.equal(res.status, 200); assert.equal((await res.json()).artifact.state, "ready");
  assert.ok(!f.calls.some(call => call[0] === "renderer" || call[1] === "upload"));
});
test("expired unsealed artifact closes without creating or looking up another object", async () => {
  const f = fixture({ unsealed: true });
  const req = new Request(`${ORIGIN}/reconcile`, { method: "POST", headers: { origin: ORIGIN, host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ request_id: REQUEST }) });
  const res = await f.reconcile(req, context); assert.equal(res.status, 409); assert.equal((await res.json()).artifact.failure_code, "source_unavailable");
  assert.ok(!f.calls.some(call => call[0] === "storage" || call[0] === "renderer"));
});
test("history read is session-only with no implicit preparation", async () => {
  const f = fixture(); const res = await f.handlers.GET(request({}, "", "GET"), context);
  assert.equal(res.status, 200); assert.equal((await res.json()).artifacts.length, 1);
  assert.deepEqual(f.calls.map(call => call[1]), ["staff_document_export_workspace"]);
  const v2 = await f.handlers.GET(request({}, "?schema_version=2", "GET"), context);
  assert.equal(v2.status, 200); assert.equal((await v2.json()).schema_version, 2);
  assert.deepEqual(f.calls.map(call => call[1]), ["staff_document_export_workspace", "staff_document_export_workspace_v2"]);
});
test("anonymous, staff preview and permission denial touch neither SQL nor Storage", async () => {
  for (const result of [{ status: "anonymous", actor: null }, { status: "authenticated", actor: { ...actor, permissionKeys: [] } },
    { status: "authenticated", actor: { ...actor, systemRole: "admin", presentationRole: "sales" } }]) {
    const f = fixture({ actorResult: result }); const res = await f.handlers.POST(request(), context);
    assert.ok([401, 403].includes(res.status)); assert.equal(f.calls.length, 0);
  }
});
test("extra browser values, foreign origin and oversized body are rejected", async () => {
  const f = fixture();
  assert.equal((await f.handlers.POST(request({ value: "untrusted" }), context)).status, 400);
  const foreign = new Request(request(), { headers: { origin: "https://outside.invalid", host: "localhost:3000", "content-type": "application/json" } });
  assert.equal((await f.handlers.POST(foreign, context)).status, 403);
  assert.equal((await f.handlers.POST(request({ value: "x".repeat(2000) }), context)).status, 400);
  for (const query of ["?schema_version=3", "?schema_version=1&schema_version=2", `?application_id=${CASE}`,
    `?published_for_application_id=${CASE}&mapping_id=${PROFILE}`, `?published_for_application_id=${CASE}&after_id=bad`,
    `?published_for_application_id=${CASE}&published_for_application_id=${PROFILE}`]) {
    assert.equal((await f.handlers.GET(request({}, query, "GET"), context)).status, 400);
  }
  assert.equal(f.calls.length, 0);
});
test("DTOs reject extra private fields, unsafe readiness and another case", () => {
  assert.throws(() => normalizeDocumentExportReceipt(receipt({ object_name: "private" }), CASE));
  assert.throws(() => normalizeDocumentExportReceipt(receipt({ state: "ready", can_download: true }), CASE));
  assert.throws(() => normalizeDocumentExportReceipt(receipt(), id(99)));
  assert.throws(() => normalizeDocumentExportWorkspace({ schema_version: 1, student_case_id: CASE, profile: null,
    workspace_revision: null, can_export: true, artifacts: [] }, CASE));
});

test("actual route files retain dynamic node handlers and explicitly deny alternate methods", async () => {
  const routes = [
    ["../src/app/api/v3/student-cases/[studentCaseId]/document-exports/route.ts", ["GET", "POST"]],
    ["../src/app/api/v3/student-cases/[studentCaseId]/document-exports/[artifactId]/download/route.ts", ["GET"]],
    ["../src/app/api/v3/student-cases/[studentCaseId]/document-exports/[artifactId]/reconcile/route.ts", ["POST"]],
  ];
  for (const [path, allowed] of routes) {
    const route = await import(path); assert.equal(route.runtime, "nodejs"); assert.equal(route.dynamic, "force-dynamic");
    for (const method of ["GET", "POST", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      assert.equal(typeof route[method], "function");
      if (!allowed.includes(method)) assert.equal((await route[method]()).status, 405);
    }
  }
});
