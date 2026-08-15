import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = readFileSync(join(root, "scripts/p8b3-portable-image-identity.mjs"), "utf8");
const schema = JSON.parse(readFileSync(join(root, "docs/schemas/p8b3-portable-image-identity.schema.json"), "utf8"));

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
