import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import dns from "node:dns";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { templateAcceptanceAppSpec, verifyTemplateAcceptanceContainer,
  templateAcceptanceSecretInput, createTemplateAcceptanceProxy, TEMPLATE_PROOF_CHECKS,
  createTemplateAcceptanceTls, validTemplateAcceptanceTls, createTemplateAcceptanceHttpsServer,
  validateTemplatePendingReceipt, TEMPLATE_APPLICATION_BOOTSTRAP } from "../scripts/lib/university-template-ingress-acceptance.mjs";
import { classifyChangedEntries } from "../scripts/classify-pr-changes.mjs";
import { TEMPLATE_MAPPING_CHECKS, TEMPLATE_PDF_MAPPING_CHECKS } from "../scripts/lib/university-template-mapping-evidence.mjs";
import { assertUnknownTemplateOutcome, assertExactTemplateReplay } from "../scripts/lib/university-template-ingress-browser-proof.mjs";
import { normalizeUniversityTemplateIngressReceipt, normalizeUniversityTemplateInspectionMetadata } from "../src/lib/university-template-ingress.ts";
import { getSupabasePublicConfig } from "../src/lib/supabase/config.ts";

test("the real production Supabase validator accepts the acceptance bootstrap origin", () => {
  const keys = ["NODE_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SUPABASE_URL = TEMPLATE_APPLICATION_BOOTSTRAP.match(/NEXT_PUBLIC_SUPABASE_URL:'([^']+)'/u)?.[1];
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = `sb_publishable_${crypto.randomUUID()}`;
    assert.equal(getSupabasePublicConfig().url, "https://127.0.0.1:8000");
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

const templateId = "73000000-0000-4000-8000-000000000001", versionId = "73000000-0000-4000-8000-000000000002";
const receiptId = "73000000-0000-4000-8000-000000000009";
function normalizedTemplateStatus(verified, receipt = receiptId) {
  // Metadata fixtures test the DTO/assertion boundary only, never service success.
  const ingress = { schema_version: 1, ingress_id: "73000000-0000-4000-8000-000000000007",
    template_id: templateId, template_version_id: versionId, request_id: "73000000-0000-4000-8000-000000000006",
    revision: 2, state: verified ? "verified" : "unknown", sha256: "a".repeat(64), byte_size: 123,
    inspection_receipt_id: verified ? receipt : null, failure_code: null, replayed: verified,
    can_reconcile: !verified, can_cancel: !verified };
  return normalizeUniversityTemplateInspectionMetadata({ schema_version: 1, template_id: templateId,
    template_version_id: versionId, template_sha256: "a".repeat(64), mime_type: "application/pdf", template_revision: 2,
    source_current: true, inspection: verified ? "verified" : "pending", receipt_id: verified ? receipt : null,
    inspected_at: verified ? "2026-09-14T00:00:00.000Z" : null,
    manifest: verified ? { format: "pdf", slots: [], pageSizes: [{ width: 612, height: 792 }] } : null,
    ingress }, templateId, versionId);
}
test("lost-reply assertion consumes the actual inspection metadata receipt_id", () => {
  const unknown = normalizedTemplateStatus(false);
  assert.doesNotThrow(() => assertUnknownTemplateOutcome(unknown, true));
  assert.throws(() => assertUnknownTemplateOutcome(unknown, false), /UNKNOWN_OUTCOME_NOT_PROVEN/u);
  assert.throws(() => assertUnknownTemplateOutcome(normalizedTemplateStatus(true), true), /UNKNOWN_OUTCOME_NOT_PROVEN/u);
});
test("replay assertion matches the actual command receipt against inspection metadata receipt_id", () => {
  const status = normalizedTemplateStatus(true);
  const replayed = normalizeUniversityTemplateIngressReceipt(status.ingress, templateId, versionId);
  assert.doesNotThrow(() => assertExactTemplateReplay(replayed, status));
  assert.throws(() => assertExactTemplateReplay(replayed, normalizedTemplateStatus(true,
    "73000000-0000-4000-8000-000000000010")), /EXACT_UPLOAD_REPLAY_CHANGED/u);
  assert.throws(() => assertExactTemplateReplay(normalizeUniversityTemplateIngressReceipt({ ...replayed, replayed: false },
    templateId, versionId), status), /EXACT_UPLOAD_REPLAY_CHANGED/u);
});

const input = { imageId: `sha256:${"a".repeat(64)}`, revision: "b".repeat(40),
  projectId: "evo-local-0123456789abcdef", scannerName: "evo-foundation-clamav-123-456-01234567",
  appName: "evo-template-ingress-0123456789abcdef0123456789abcdef", appPort: 31001 };
test("acceptance transport permits only one run-owned bridge and loopback published application", () => {
  const spec = templateAcceptanceAppSpec(input);
  assert.equal(spec.network, `supabase_network_${input.projectId}`);
  assert.ok(spec.args.includes(`127.0.0.1:${input.appPort}:3000`));
  assert.ok(spec.args.includes(`EVO_RUNTIME_IMAGE_ID=${input.imageId}`));
  assert.ok(spec.args.includes(`EVO_RELEASE_REVISION=${input.revision}`));
  assert.ok(spec.args.includes("--read-only"));
  assert.equal(spec.args.at(-2), "-e");
  assert.ok(!spec.args.some(value => /SECRET_KEY=|PASSWORD=|PUBLISHABLE_KEY=/u.test(value)));
});
test("acceptance rejects arbitrary names, images, revisions and ports before Docker", () => {
  for (const changed of [{ imageId: "production:latest" }, { revision: "main" }, { appPort: 80 },
    { appPort: "31001" }, { projectId: "production" }, { scannerName: "evo-crm-waha-1" },
    { appName: "evo-crm-app-1" }, { destination: "https://foreign.example" }]) {
    assert.throws(() => templateAcceptanceAppSpec({ ...input, ...changed }), /LOCAL_TEMPLATE_/u);
  }
});
const container = () => ({ Id: "c".repeat(64), Name: `/${input.appName}`, Image: input.imageId,
  State: { Running: true }, Config: { Env: [`EVO_RUNTIME_IMAGE_ID=${input.imageId}`, `EVO_RELEASE_REVISION=${input.revision}`] },
  HostConfig: { ReadonlyRootfs: true, NetworkMode: `supabase_network_${input.projectId}` },
  NetworkSettings: { Ports: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: String(input.appPort) }] } } });
test("actual container readback must match exact image, unique identity and loopback binding", () => {
  const spec = templateAcceptanceAppSpec(input);
  assert.doesNotThrow(() => verifyTemplateAcceptanceContainer(container(), spec));
  for (const edit of [v => { v.Image = `sha256:${"d".repeat(64)}`; },
    v => { v.Config.Env.push(`EVO_RUNTIME_IMAGE_ID=${input.imageId}`); },
    v => { v.Config.Env[1] = `EVO_RELEASE_REVISION=${"c".repeat(40)}`; },
    v => { v.NetworkSettings.Ports["3000/tcp"][0].HostIp = "0.0.0.0"; },
    v => { v.HostConfig.ReadonlyRootfs = false; }, v => { v.State.Running = false; }]) {
    const value = container(); edit(value); assert.throws(() => verifyTemplateAcceptanceContainer(value, spec), /LOCAL_TEMPLATE_/u);
  }
});
test("bootstrap secrets are bounded exact stdin fields, never an arbitrary environment map", () => {
  const value = { publishableKey: "synthetic-publishable", serviceKey: "synthetic-secret",
    organizationId: "73000000-0000-4000-8000-000000000005" };
  const material = createTemplateAcceptanceTls();
  const parsed = JSON.parse(templateAcceptanceSecretInput(value, material));
  assert.ok(Object.keys(parsed).sort().join(",") === "organizationId,publishableKey,serviceKey,tls");
  assert.ok(parsed.tls.cert === material.cert && parsed.tls.key === material.key);
  delete parsed.tls;
  assert.deepEqual(parsed, value);
  for (const changed of [{ serviceKey: "" }, { serviceKey: "x".repeat(4097) }, { organizationId: "bad" },
    { EVO_RUNTIME_IMAGE_ID: input.imageId }, { NODE_OPTIONS: "--require=untrusted" }]) {
    assert.throws(() => templateAcceptanceSecretInput({ ...value, ...changed }, material), /LOCAL_TEMPLATE_/u);
  }
  assert.throws(() => templateAcceptanceSecretInput(value), /TLS_MATERIAL_INVALID/u);
});

test("ephemeral TLS material is exact, single-certificate, short-lived and matches its private key", () => {
  const material = createTemplateAcceptanceTls();
  assert.equal(validTemplateAcceptanceTls(material, crypto), true);
  for (const changed of [{ cert: material.cert + material.cert }, { key: "not-a-key" },
    { cert: "x".repeat(4097) }, { extra: true }, { key: createTemplateAcceptanceTls().key }]) {
    assert.equal(validTemplateAcceptanceTls({ ...material, ...changed }, crypto), false);
  }
});

test("real fetch requires explicit ephemeral trust and still checks the server IP identity", async () => {
  // Real TLS transport with synthetic response bytes; not Auth/Storage acceptance.
  const material = createTemplateAcceptanceTls(), defaults = tls.getCACertificates("default");
  const order = dns.getDefaultResultOrder();
  const server = createTemplateAcceptanceHttpsServer(material, (_request, response) => {
    response.setHeader("connection", "close"); response.end("owned-template-tls");
  }, { https, crypto });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await assert.rejects(fetch(`https://127.0.0.1:${port}`, { signal: AbortSignal.timeout(3000) }),
      error => error.cause?.code === "DEPTH_ZERO_SELF_SIGNED_CERT");
    tls.setDefaultCACertificates([...defaults, material.cert]);
    const response = await fetch(`https://127.0.0.1:${port}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200); assert.equal(await response.text(), "owned-template-tls");
    dns.setDefaultResultOrder("ipv4first");
    await assert.rejects(fetch(`https://localhost:${port}`, { signal: AbortSignal.timeout(3000) }),
      error => error.cause?.code === "ERR_TLS_CERT_ALTNAME_INVALID");
  } finally {
    tls.setDefaultCACertificates(defaults); dns.setDefaultResultOrder(order);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
test("the exact serialized application bootstrap parses without executing or starting a service", () => {
  const result = spawnSync(process.execPath, ["--check"], { input: TEMPLATE_APPLICATION_BOOTSTRAP, encoding: "utf8", timeout: 3000 });
  assert.equal(result.status, 0, result.stderr);
});
test("harness source stays classified as tests and tooling, not an unknown or managed operation", () => {
  const result = classifyChangedEntries(["scripts/lib/university-template-ingress-acceptance.mjs",
    "scripts/lib/university-template-ingress-browser-proof.mjs", "tests/university-template-ingress-acceptance.test.mjs",
    "scripts/test-postgres-v2-foundation.sh"].map(path => ({ status: "A", paths: [path] })));
  assert.equal(result.unknown, false);
});

test("bounded foundation mode refuses missing images before acquiring a lock or starting a stack", () => {
  const env = { ...process.env, EVO_NODE_BIN: process.execPath, EVO_D3_COMBINED_IMAGE: "", EVO_D3_ACCEPTANCE_IMAGE: "",
    EVO_PLATFORM_GEMINI_API_KEY: "", GEMINI_API_KEY: "" };
  const result = spawnSync("bash", ["scripts/test-postgres-v2-foundation.sh", "--university-template-ingress-only"], {
    cwd: new URL("..", import.meta.url), env, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /no foundation stack was started/u);
  const script = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
  assert.ok(script.indexOf("--image-gate") < script.indexOf('if ! mkdir "$supabase_lock_dir"'));
  const branch = script.slice(script.lastIndexOf('if [[ "$university_template_ingress_only" == "1" ]]'));
  assert.match(branch, /start_clamav_scanner\n  university_template_ingress_browser_assert\n  exit 0/u);
  assert.doesNotMatch(branch.split("exit 0")[0], /start_app|start_isolated_waha_service/u);
});

test("pending evidence cannot upgrade absent recovery, cleanup or source evidence", () => {
  const mapping = { templateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    versionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", mappingId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sourceSha256: "a".repeat(64), sourceBytes: 889, mappingSha256: "b".repeat(64),
    ...Object.fromEntries(TEMPLATE_MAPPING_CHECKS.map(key => [key, true])),
    generatedFormAcceptance: false, fullD4Acceptance: false, businessAcceptance: false };
  const pdfMapping = { ...mapping, pagePngSha256: "c".repeat(64), pageCount: 2,
    ...Object.fromEntries(TEMPLATE_PDF_MAPPING_CHECKS.map(key => [key, true])) };
  const value = { schema: "evo-university-template-ingress-acceptance/v2", localProjectId: input.projectId,
    synthetic: true, businessAcceptance: false, providerAcceptance: false, fullD4Acceptance: false, cleanupVerified: false,
    browserErrorCount: 0, browserWarningCount: 0, sourceSha256: "a".repeat(64), sourceBytes: 123,
    ...Object.fromEntries(TEMPLATE_PROOF_CHECKS.map(key => [key, true])), mapping, pdfMapping };
  assert.equal(validateTemplatePendingReceipt(value, input.projectId), value);
  for (const key of TEMPLATE_PROOF_CHECKS) assert.throws(() => validateTemplatePendingReceipt({ ...value, [key]: false }, input.projectId));
  for (const change of [{ fullD4Acceptance: true }, { cleanupVerified: true }, { browserErrorCount: 1 }, { sourceSha256: "" }]) {
    assert.throws(() => validateTemplatePendingReceipt({ ...value, ...change }, input.projectId));
  }
  assert.throws(() => validateTemplatePendingReceipt({ ...value, mapping: undefined }, input.projectId));
  for (const key of TEMPLATE_MAPPING_CHECKS) {
    assert.throws(() => validateTemplatePendingReceipt({ ...value, mapping: { ...mapping, [key]: false } }, input.projectId));
  }
  assert.throws(() => validateTemplatePendingReceipt({ ...value, schema: "evo-university-template-ingress-acceptance/v1" }, input.projectId));
  assert.throws(() => validateTemplatePendingReceipt({ ...value, pdfMapping: undefined }, input.projectId));
  for (const key of TEMPLATE_PDF_MAPPING_CHECKS) assert.throws(() => validateTemplatePendingReceipt({ ...value, pdfMapping: { ...pdfMapping, [key]: false } }, input.projectId));
});

for (const corrupt of [false, true]) test(`HTTP-only transport fixture: lost-reply marker requires exact readback (${corrupt ? "mismatch" : "match"})`, async () => {
  // This tests proxy control flow against a synthetic HTTP fixture, not Storage,
  // SQL, ClamAV, native inspection or a successful product ingress.
  const bytes = Buffer.from("synthetic transport bytes"); let reads = 0, posts = 0, markers = 0;
  const upstream = http.createServer((request, response) => {
    if (request.method === "POST") { posts++; request.resume(); request.on("end", () => { response.writeHead(201); response.end("{}"); }); }
    else { reads++; response.writeHead(200, { "content-type": "application/pdf" }); response.end(corrupt ? Buffer.from("different") : bytes); }
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const proxy = createTemplateAcceptanceProxy(input.projectId, () => { markers++; }, {
    crypto, http: { createServer: http.createServer, request(options, callback) {
      assert.equal(options.host, `supabase_kong_${input.projectId}`); assert.equal(options.port, 8000);
      return http.request({ ...options, host: "127.0.0.1", port: upstream.address().port }, callback);
    } },
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const id = "73000000-0000-4000-8000-000000000005";
  const url = `http://127.0.0.1:${proxy.address().port}/storage/v1/object/platform-document-templates/${id}/${id}/${id}.pdf`;
  const options = { method: "POST", headers: { "content-type": "application/pdf", "x-upsert": "false", apikey: crypto.randomUUID() }, body: bytes };
  try {
    await assert.rejects(fetch(url, { ...options, signal: AbortSignal.timeout(3000) }));
    assert.equal(reads, 1); assert.equal(markers, corrupt ? 0 : 1);
    const second = await fetch(url, { ...options, signal: AbortSignal.timeout(3000) });
    assert.equal(second.status, 201); await second.body.cancel(); assert.equal(reads, 1); assert.equal(posts, 2);
    assert.equal(markers, corrupt ? 0 : 1);
  } finally { proxy.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => upstream.close(resolve))]); }
});
