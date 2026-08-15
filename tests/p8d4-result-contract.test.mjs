import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const schema = JSON.parse(readFileSync(new URL("../docs/schemas/p8d4-result.schema.json", import.meta.url), "utf8"));
const cases = JSON.parse(readFileSync(new URL("../scripts/knowledge_ingestion/platform_eval_cases.json", import.meta.url), "utf8"));
const success = schema.allOf[0].then.properties;

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
