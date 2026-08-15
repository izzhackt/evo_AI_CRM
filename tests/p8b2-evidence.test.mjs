import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const scriptPath = new URL("../scripts/p8b2-collect-evidence.sh", import.meta.url);
const sbomSchemaPath = new URL("../docs/schemas/p8-sbom-identity.schema.json", import.meta.url);
const smokeSchemaPath = new URL("../docs/schemas/p8-smoke-identity.schema.json", import.meta.url);

test("P8B2 evidence collector is fail-closed and provider-isolated", () => {
  const source = readFileSync(scriptPath, "utf8");

  for (const required of [
    "set -euo pipefail",
    '"$(orb status)" != "Running"',
    '"$(docker context show)" != "orbstack"',
    "--network none",
    "--platform linux/amd64",
    "EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH=1",
    "EVO_AGENT_OUTBOUND_ENABLED=false",
    "EVO_AGENT_FROZEN=true",
    "gitleaks detect --no-git",
    "docker sbom --format spdx-json",
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /--network\s+(?:bridge|host)|-p\s|--publish|--mount|-v\s/);
});

test("P8B2 SBOM and smoke evidence schemas are closed and exact", () => {
  const sbom = JSON.parse(readFileSync(sbomSchemaPath, "utf8"));
  const smoke = JSON.parse(readFileSync(smokeSchemaPath, "utf8"));

  assert.equal(sbom.additionalProperties, false);
  assert.equal(smoke.additionalProperties, false);
  assert.deepEqual(sbom.properties.records.prefixItems.map((item) => sbom.$defs[item.$ref.split("/").at(-1)].allOf[1].properties.name.const), [
    "main_crm",
    "evo_inbox",
    "lead_agent",
  ]);
  assert.deepEqual(smoke.properties.records.prefixItems.map((item) => smoke.$defs[item.$ref.split("/").at(-1)].allOf[1].properties.name.const), [
    "main_crm",
    "evo_inbox",
    "lead_agent",
  ]);
  assert.equal(smoke.properties.records.minItems, 3);
  assert.equal(smoke.properties.records.maxItems, 3);
});
