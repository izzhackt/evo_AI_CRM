import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = readFileSync(join(root, "scripts/p8b3-portable-image-identity.mjs"), "utf8");
const schema = JSON.parse(readFileSync(join(root, "docs/schemas/p8b3-portable-image-identity.schema.json"), "utf8"));
const p8d3Contract = readFileSync(join(root, "docs/platform/p8d3-portable-amd64-staging.md"), "utf8");
const p8d3Schema = JSON.parse(readFileSync(join(root, "docs/schemas/p8d3-staging-result.schema.json"), "utf8"));

test("P8B3 binds the OCI index and platform manifest as distinct identities", () => {
  assert.match(source, /application\/vnd\.oci\.image\.index\.v1\+json/);
  assert.match(source, /application\/vnd\.oci\.image\.manifest\.v1\+json/);
  assert.match(source, /docker[\s\S]*image[\s\S]*save[\s\S]*--platform=linux\/amd64/);
  assert.match(source, /verifyDescriptor\(archive, descriptor/);
  assert.match(source, /verifyDescriptor\(archive, manifest\.config/);
  assert.match(source, /manifest\.layers\.entries\(\)/);
  assert.match(source, /unsafe tar entry/);
  assert.match(source, /tar", \["-tvf"/);
  assert.match(source, /\^\[d-\]/);
  assert.match(source, /io\.containerd\.image\.name/);
  assert.match(source, /org\.opencontainers\.image\.ref\.name/);
  assert.match(source, /org\.opencontainers\.image\.revision/);
  assert.match(source, /unexpected tar entries/);
});

test("P8B3 schema is closed and pins the three real portable manifest digests", () => {
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.images.minItems, 3);
  assert.equal(schema.properties.images.maxItems, 3);
  assert.equal(schema.properties.images.items, false);
  const text = JSON.stringify(schema);
  for (const digest of [
    "sha256:b965ac5c41d4e8bddc6d6bb7baaa7bcec101af4083b8ca861f9e9904cec9eafd",
    "sha256:e15c5e07b4232e39622616cb76ed84e1e5b6a7c9145728a42a7701a3238e6b92",
    "sha256:572d01c6f2a0824e56607f41d4376e927ccdf41c5218c6dd65930f95cd6593cd",
  ]) assert.match(text, new RegExp(digest));
  assert.equal(schema.$defs.manifest_descriptor.properties.media_type.const, "application/vnd.oci.image.manifest.v1+json");
  assert.equal(schema.$defs.config_descriptor.properties.media_type.const, "application/vnd.oci.image.config.v1+json");
  assert.deepEqual(schema.$defs.layer_descriptor.properties.media_type.enum, [
    "application/vnd.oci.image.layer.v1.tar",
    "application/vnd.oci.image.layer.v1.tar+gzip",
    "application/vnd.oci.image.layer.v1.tar+zstd",
  ]);
});

test("P8D3 resume is path-closed and excludes duplicate incoming archives", () => {
  for (const name of ["evo-crm", "evo-inbox", "evo-lead-agent"]) {
    assert.match(p8d3Contract, new RegExp(`/2026-08-15\\.p8d2\\.1/${name}-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64\\.tar`));
    assert.match(p8d3Contract, new RegExp(`/2026-08-15\\.p8d3\\.1/${name}-0505143657858e710acdd5029f1cc77c5524083e-linux-amd64\\.tar`));
  }
  assert.match(p8d3Contract, /duplicate P8D2 `incoming\/` archives are\s+never valid reuse sources/);
  assert.match(p8d3Contract, /explicit `install -o root -g root -m 0600 -- SOURCE DESTINATION`/);
});

test("P8D3 result schema pins exact ordered staging evidence", () => {
  assert.equal(p8d3Schema.additionalProperties, false);
  assert.equal(p8d3Schema.$defs.image_records.items, false);
  assert.deepEqual(p8d3Schema.$defs.image_records.prefixItems.map((item) => item.$ref), ["#/$defs/main_crm_image", "#/$defs/evo_inbox_image", "#/$defs/lead_agent_image"]);
  assert.deepEqual(p8d3Schema.$defs.container_records.prefixItems.map((item) => item.allOf[1].properties.name.const), ["evo-crm-app-1", "evo-crm-lead-agent-1", "evo-inbox-app-1", "evo-crm-waha-1", "evo-inbox-waha"]);
  assert.deepEqual(p8d3Schema.$defs.rollback_image_records.prefixItems.map((item) => item.allOf[1].properties.file.const), ["rollback-evo-crm-current.tar", "rollback-evo-lead-agent-current.tar", "rollback-evo-inbox-current.tar"]);
  assert.deepEqual(p8d3Schema.$defs.rollback_environment_records.prefixItems.map((item) => item.allOf[1].properties.file.const), ["env-crm-production.rollback", "env-lead-agent.rollback", "env-inbox-production.rollback"]);
  assert.equal(p8d3Schema.allOf[0].then.properties.running_state.properties.unchanged.const, true);
  assert.deepEqual(p8d3Schema.allOf[0].then.properties.images, { minItems: 3, maxItems: 3 });
  assert.deepEqual(p8d3Schema.allOf[0].then.properties.running_state.properties.pre, { minItems: 5, maxItems: 5 });
  assert.deepEqual(p8d3Schema.allOf[0].then.properties.running_state.properties.post, { minItems: 5, maxItems: 5 });
  assert.deepEqual(p8d3Schema.allOf[0].then.properties.rollback.properties.image_archives, { minItems: 3, maxItems: 3 });
  assert.deepEqual(p8d3Schema.allOf[0].then.properties.rollback.properties.environment_files, { minItems: 3, maxItems: 3 });
});

test("P8D3 keeps staging separate from provider reconciliation and activation", () => {
  assert.match(p8d3Contract, /does not rerun P8C2/);
  assert.match(p8d3Contract, /retained P8C2 result remains truthfully `blocked`/);
  assert.match(p8d3Contract, /Application activation remains a separate P8D4 contract/);
});
