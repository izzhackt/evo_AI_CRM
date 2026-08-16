import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(readFileSync(new URL("../docs/schemas/p8d4-result.schema.json", import.meta.url), "utf8"));
const cases = JSON.parse(readFileSync(new URL("../scripts/knowledge_ingestion/platform_eval_cases.json", import.meta.url), "utf8"));
const contract = readFileSync(new URL("../docs/platform/p8d4-current-main-staff-pilot.md", import.meta.url), "utf8");
const importer = readFileSync(new URL("../agent-lead2-inbox/scripts/import-knowledge-bundle.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("../scripts/knowledge_ingestion/build_platform_bundle.py", import.meta.url), "utf8");
const success = schema.allOf[0].then.properties;
const validate = new Ajv2020({ strict: false }).compile(schema);
const hash = "a".repeat(64);
const image = `sha256:${hash}`;
const clientBundleHash = "c20acf2a3ecdf321d9120ca97e1389b5883ef9cfd5d97dc5b1d2235c56a05c23";
const internalBundleHash = "a3a1092c10ec3a8768c6f8ac63f32f81b0fa9e9c313d820d034ad084565b6184";
const knowledgeFreeze = {
  status: "verified",
  frozen_at: "2026-08-16T04:16:05+06:00",
  account_resolution_status: "exactly_one_active",
  client_document_count: 11,
  internal_document_count: 291,
  client_bundle_sha256: clientBundleHash,
  internal_bundle_sha256: internalBundleHash,
  client_bundle_manifest_sha256: "6c6c88ef430d91b4ee8c8d694bd69fc73d01cb1067088a2586e7b0c388ca3f8c",
  internal_bundle_manifest_sha256: "6964354ab201daf1cce174aa48aa4aee3db757d091d96c050d88725df04caf33",
  client_allowlist_count: 8,
  client_allowlist_sha256: "3c35e8dbe8a6ad751ea6497d2a5a9b4abb035bd974cfa14e602aabecbb99557e",
  client_publication_manifest_count: 8,
  client_publication_manifest_sha256: "5f1ad3b95b4c8c8b25dfbddcb698c6676b8c176d5220b9ab07462074178cf374",
  pii_boundary_status: "verified",
  retrieval_passed: 10,
  retrieval_failed: 0,
  review_bound_source_count: 912,
};
const containers = ["evo-inbox-app-1", "evo-crm-app-1", "evo-crm-lead-agent-1", "evo-crm-waha-1", "evo-inbox-waha"].map((name) => ({ name, healthy: true, restart_count: 0, status: "verified" }));
const canonical = {
  schema_version: "p8d4-v1", result_code: "pilot_verified",
  candidate: { source_commit: "d5657acc6c1df1abc790a96778ca71df36687b24", tree: "9dfe44fd1c477a9a4af823ba2a37bdb398878919", ci_run: 31902903078, platform: "linux/amd64" },
  migrations: { before: "001-076", after: "001-076", status: "verified" },
  knowledge_freeze: knowledgeFreeze,
  bundles: [{ audience: "client", bundle_sha256: clientBundleHash, document_count: 11, chunk_count: 11, status: "verified" }, { audience: "internal", bundle_sha256: internalBundleHash, document_count: 291, chunk_count: 291, status: "verified" }],
  images: [{ name: "main_crm", image_id: image, status: "verified" }, { name: "evo_inbox", image_id: image, status: "verified" }, { name: "lead_agent", image_id: image, status: "verified" }],
  containers_before: containers, containers_after: containers,
  rollback: { images: ["prior-crm.tar", "prior-inbox.tar", "prior-lead-agent.tar"].map((name) => ({ name, sha256: hash })), env_files: ["crm.env.production", "inbox.env.production", "lead-agent.env.production"].map((name) => ({ name, sha256: hash })), compose_files: ["crm.compose.yml", "inbox.compose.yml", "lead-agent.compose.yml"].map((name) => ({ name, sha256: hash })), status: "verified" },
  pilot: [{ case_id: "client_china_documents", audience: "client", http_status: 200, expected_source_match: true, cross_audience_sources: 0, audit_body_free: true, status: "verified" }, { case_id: "internal_malaysia_handoff", audience: "internal", http_status: 200, expected_source_match: true, cross_audience_sources: 0, audit_body_free: true, status: "verified" }],
};

test("P8D4 success evidence is exact and cannot use null identities", () => {
  assert.deepEqual(success.migrations.properties.before.enum, ["001-072", "001-073", "001-074", "001-075", "001-076"]);
  assert.equal(success.migrations.properties.after.const, "001-076");
  assert.deepEqual(Object.fromEntries(Object.entries(success.knowledge_freeze.properties).map(([key, definition]) => [key, definition.const])), knowledgeFreeze);
  assert.deepEqual(success.bundles.prefixItems.map((entry) => entry.properties.document_count.const), [11, 291]);
  assert.deepEqual(success.bundles.prefixItems.map((entry) => entry.properties.bundle_sha256.const), [clientBundleHash, internalBundleHash]);
  assert.ok(success.bundles.prefixItems.every((entry) => entry.properties.chunk_count.minimum === 1));
  assert.ok(success.images.prefixItems.every((entry) => entry.properties.image_id.type === "string"));
  assert.deepEqual(success.images.prefixItems.map((entry) => entry.properties.name.const), ["main_crm", "evo_inbox", "lead_agent"]);
  assert.deepEqual(success.pilot.prefixItems.map((entry) => entry.properties.http_status.const), [200, 200]);
  assert.equal(success.rollback.properties.status.const, "verified");
});

test("Draft 2020-12 validation rejects false success and contradictory failure", () => {
  assert.equal(validate(canonical), true, JSON.stringify(validate.errors));
  for (const mutate of [
    (value) => { value.candidate.source_commit = "7c2e03cdbfbb54b85c4eef5454c31bb846c3c38a"; },
    (value) => { value.candidate.tree = "d9b170396364a8dcf0efcd28779fc416c8c2f65e"; },
    (value) => { value.candidate.ci_run = 31900296274; },
    (value) => { value.migrations.after = "001-075"; },
    (value) => { value.migrations.before = "001-999"; },
    (value) => { value.knowledge_freeze.frozen_at = null; },
    (value) => { value.knowledge_freeze.account_resolution_status = "not_run"; },
    (value) => { value.knowledge_freeze.client_document_count = 10; },
    (value) => { value.knowledge_freeze.internal_document_count = 286; },
    (value) => { value.knowledge_freeze.client_bundle_sha256 = hash; },
    (value) => { value.knowledge_freeze.internal_bundle_sha256 = hash; },
    (value) => { value.knowledge_freeze.client_bundle_manifest_sha256 = hash; },
    (value) => { value.knowledge_freeze.internal_bundle_manifest_sha256 = hash; },
    (value) => { value.knowledge_freeze.client_allowlist_count = 7; },
    (value) => { value.knowledge_freeze.client_allowlist_sha256 = hash; },
    (value) => { value.knowledge_freeze.client_publication_manifest_count = 7; },
    (value) => { value.knowledge_freeze.client_publication_manifest_sha256 = hash; },
    (value) => { value.knowledge_freeze.pii_boundary_status = "not_run"; },
    (value) => { value.knowledge_freeze.retrieval_passed = 9; },
    (value) => { value.knowledge_freeze.retrieval_failed = 1; },
    (value) => { value.knowledge_freeze.review_bound_source_count = 911; },
    (value) => { value.bundles[0].bundle_sha256 = null; },
    (value) => { value.bundles[0].bundle_sha256 = hash; },
    (value) => { value.bundles[0].document_count = 10; },
    (value) => { value.bundles[1].document_count = 286; },
    (value) => { value.bundles[0].document_count = null; },
    (value) => { value.images[0].image_id = null; },
  ]) {
    const invalid = structuredClone(canonical); mutate(invalid);
    assert.equal(validate(invalid), false);
  }
  const blocked = structuredClone(canonical);
  blocked.result_code = "preflight_blocked";
  assert.equal(validate(blocked), false);
  const rollbackFailed = structuredClone(canonical);
  rollbackFailed.result_code = "rollback_failed";
  assert.equal(validate(rollbackFailed), false);
});

test("P8D4 pilot cases are a closed body-safe two-case set", () => {
  assert.deepEqual(Object.keys(cases).sort(), ["cases", "version"]);
  assert.equal(cases.version, 1);
  assert.deepEqual(cases.cases.map((entry) => [entry.case_id, entry.audience]), [
    ["client_china_documents", "client"],
    ["internal_malaysia_handoff", "internal"],
  ]);
  assert.ok(cases.cases.every((entry) => Object.keys(entry).sort().join(",") === "audience,case_id,expected_source_path,question"));
  assert.doesNotMatch(JSON.stringify(cases), /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d\s().-]{7,}\d)/i);
});

test("Phase D binds the exact private WAHA env only for Compose rendering", () => {
  assert.match(contract, /EVO_INBOX_WAHA_ENV_FILE=\/opt\/evo-inbox\/agent-lead2-crmwhatsapp\/\.env\.waha docker compose[\s\S]*run -d --no-deps --name evo-p8d4-knowledge-import/);
  assert.match(contract, /\.env\.waha` to be an existing root-owned,[\s\S]*mode-`0600`, regular non-symlink file/);
  assert.match(contract, /does not[\s\S]*authorize a WAHA create, recreate, reload, restart or provider call/);
});

test("P8D4G freezes the production execution identity and rejects staging bundles", () => {
  const amendment = contract.slice(contract.indexOf("## P8D4G production execution amendment"));
  assert.ok(amendment.length > 0);
  assert.match(amendment, /a43fc7b182dd0fa3fbd3e02104dff1b1c26bbad2[\s\S]*239cb8d5cf2f51805205a4aceb6df6084b2d415e[\s\S]*31918619142/);
  assert.match(amendment, /aaa9f618131f604f79c694e4b332a0b13afd7a30[\s\S]*31916279374/);
  assert.match(amendment, /2026-08-16\.p8d4g\.1/);
  assert.match(amendment, /exact contiguous migration[\s\S]*`001-076`[\s\S]*mandatory no-op/);
  assert.match(amendment, /exactly one row with provider `gemini`[\s\S]*autonomous[\s\S]*`false`/);
  assert.match(amendment, /Keep its UUID in process memory; never print it[\s\S]*transient process argv/);
  assert.match(amendment, /`c20acf[0-9a-f]+`[\s\S]*`08a955[0-9a-f]+`/);
  assert.match(amendment, /historical staging evidence[\s\S]*forbidden[\s\S]*production import[\s\S]*identities/);
  assert.match(amendment, /dedicated closed P8D4G result schema[\s\S]*cross-artifact equality/);
  assert.doesNotMatch(amendment, /00000000-0000-4000-8000-000000000000/);
});

test("P8D4G UUID transport matches the immutable importer CLI and stays UUID-free in output", () => {
  const amendment = contract.slice(contract.indexOf("## P8D4G production execution amendment"));
  assert.match(importer, /arg\('--account-id'\)/);
  assert.match(importer, /safeImportResult\(result\)/);
  assert.match(amendment, /pipe[\s\S]*UUID only on SSH stdin/);
  assert.match(amendment, /reads one line into[\s\S]*EVO_KNOWLEDGE_ACCOUNT_ID/);
  assert.match(amendment, /--account-id \"\$EVO_KNOWLEDGE_ACCOUNT_ID\"/);
  assert.match(amendment, /No literal UUID may occur in the[\s\S]*command text/);
});

test("P8D4H permits UUID only in temporary canonical knowledge artifacts", () => {
  const correction = contract.slice(contract.indexOf("## P8D4H knowledge UUID artifact correction"));
  assert.ok(correction.length > 0);
  assert.match(builder, /"account_id": account_id[\s\S]*bundle_bytes/);
  assert.match(builder, /manifest = \{[\s\S]*"account_id": account_id/);
  assert.match(correction, /only inside the two deterministic local[\s\S]*bundle\/manifest/);
  assert.match(correction, /Do not create a standalone UUID file/);
  assert.match(correction, /UUID-bearing builder report[\s\S]*do not[\s\S]*retain/);
  assert.match(correction, /finally-style cleanup path[\s\S]*every terminal success or failure/);
  assert.match(correction, /four on the complete two-audience\/two-build path/);
  assert.match(correction, /remove every created local[\s\S]*remote incoming[\s\S]*in-container/);
  assert.match(correction, /including after build validation[\s\S]*import[\s\S]*verification failure/);
  assert.match(correction, /Cleanup failure is blocking/);
  assert.match(importer, /safeImportResult\(result\)/);
});
