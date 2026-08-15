import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(readFileSync(new URL("../docs/schemas/p8d4-result.schema.json", import.meta.url), "utf8"));
const cases = JSON.parse(readFileSync(new URL("../scripts/knowledge_ingestion/platform_eval_cases.json", import.meta.url), "utf8"));
const success = schema.allOf[0].then.properties;
const validate = new Ajv2020({ strict: false }).compile(schema);
const hash = "a".repeat(64);
const image = `sha256:${hash}`;
const containers = ["evo-inbox-app-1", "evo-crm-app-1", "evo-crm-lead-agent-1", "evo-crm-waha-1", "evo-inbox-waha"].map((name) => ({ name, healthy: true, restart_count: 0, status: "verified" }));
const canonical = {
  schema_version: "p8d4-v1", result_code: "pilot_verified",
  candidate: { source_commit: "472cc58115b7e6a459d089fd082081fa8da15610", tree: "afadf3248ff696c0cf70388cfe06a9b5a8eebc22", ci_run: 31897719155, platform: "linux/amd64" },
  migrations: { before: "001-075", after: "001-075", status: "verified" },
  bundles: [{ audience: "client", bundle_sha256: hash, document_count: 10, chunk_count: 10, status: "verified" }, { audience: "internal", bundle_sha256: hash, document_count: 286, chunk_count: 286, status: "verified" }],
  images: [{ name: "main_crm", image_id: image, status: "verified" }, { name: "evo_inbox", image_id: image, status: "verified" }, { name: "lead_agent", image_id: image, status: "verified" }],
  containers_before: containers, containers_after: containers,
  rollback: { images: ["prior-crm.tar", "prior-inbox.tar", "prior-lead-agent.tar"].map((name) => ({ name, sha256: hash })), env_files: ["crm.env.production", "inbox.env.production", "lead-agent.env.production"].map((name) => ({ name, sha256: hash })), compose_files: ["crm.compose.yml", "inbox.compose.yml", "lead-agent.compose.yml"].map((name) => ({ name, sha256: hash })), status: "verified" },
  pilot: [{ case_id: "client_china_documents", audience: "client", http_status: 200, expected_source_match: true, cross_audience_sources: 0, audit_body_free: true, status: "verified" }, { case_id: "internal_malaysia_handoff", audience: "internal", http_status: 200, expected_source_match: true, cross_audience_sources: 0, audit_body_free: true, status: "verified" }],
};

test("P8D4 success evidence is exact and cannot use null identities", () => {
  assert.deepEqual(success.migrations.properties.before.enum, ["001-072", "001-073", "001-074", "001-075"]);
  assert.equal(success.migrations.properties.after.const, "001-075");
  assert.deepEqual(success.bundles.prefixItems.map((entry) => entry.properties.document_count.const), [10, 286]);
  assert.ok(success.bundles.prefixItems.every((entry) => entry.properties.bundle_sha256.type === "string"));
  assert.ok(success.bundles.prefixItems.every((entry) => entry.properties.chunk_count.minimum === 1));
  assert.ok(success.images.prefixItems.every((entry) => entry.properties.image_id.type === "string"));
  assert.deepEqual(success.images.prefixItems.map((entry) => entry.properties.name.const), ["main_crm", "evo_inbox", "lead_agent"]);
  assert.deepEqual(success.pilot.prefixItems.map((entry) => entry.properties.http_status.const), [200, 200]);
  assert.equal(success.rollback.properties.status.const, "verified");
});

test("Draft 2020-12 validation rejects false success and contradictory failure", () => {
  assert.equal(validate(canonical), true, JSON.stringify(validate.errors));
  for (const mutate of [
    (value) => { value.migrations.before = "001-999"; },
    (value) => { value.bundles[0].bundle_sha256 = null; },
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
