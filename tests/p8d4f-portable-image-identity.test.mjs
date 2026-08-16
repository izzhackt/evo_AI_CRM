import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { validatePortableMetadata } from "../scripts/p8b3-portable-image-identity.mjs";
import { P8D4F_CANDIDATE, p8d4fSpecs } from "../scripts/p8d4f-portable-image-identity.mjs";

const schema = JSON.parse(readFileSync(join(process.cwd(), "docs/schemas/p8d4f-portable-image-identity.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const sha = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const hex = "b".repeat(64);

function identity() {
  return {
    schema_version: 1,
    candidate_commit: P8D4F_CANDIDATE,
    target_platform: { os: "linux", architecture: "amd64", variant: "" },
    images: p8d4fSpecs.map((spec) => ({
      name: spec.name,
      tag: `${spec.prefix}:${P8D4F_CANDIDATE}-linux-amd64`,
      source_commit: P8D4F_CANDIDATE,
      platform: { os: "linux", architecture: "amd64", variant: "" },
      oci_index_digest: spec.index,
      platform_manifest: { digest: spec.manifest, media_type: "application/vnd.oci.image.manifest.v1+json", size: 1 },
      config: { digest: sha, media_type: "application/vnd.oci.image.config.v1+json", size: 1 },
      layers: [{ digest: sha, media_type: "application/vnd.oci.image.layer.v1.tar+gzip", size: 1 }],
      archive: { file: spec.archive, sha256: hex, size: 1, mode: 600 },
    })),
  };
}

test("P8D4F portable schema pins the ordered aaa9 image identities", () => {
  const value = identity();
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  const wrongCandidate = structuredClone(value);
  wrongCandidate.candidate_commit = "0".repeat(40);
  assert.equal(validate(wrongCandidate), false);
  const reordered = structuredClone(value);
  reordered.images.reverse();
  assert.equal(validate(reordered), false);
  const wrongManifest = structuredClone(value);
  wrongManifest.images[0].platform_manifest.digest = sha;
  assert.equal(validate(wrongManifest), false);
});

test("shared portable verifier uses the explicit candidate instead of the historical default", () => {
  const spec = p8d4fSpecs[0];
  const tag = `${spec.prefix}:${P8D4F_CANDIDATE}-linux-amd64`;
  const descriptor = {
    digest: spec.manifest,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    platform: { os: "linux", architecture: "amd64" },
    annotations: {
      "io.containerd.image.name": `docker.io/library/${tag}`,
      "org.opencontainers.image.ref.name": `${P8D4F_CANDIDATE}-linux-amd64`,
    },
  };
  const metadata = {
    index: { manifests: [descriptor] },
    descriptor,
    manifest: {
      config: { digest: sha, mediaType: "application/vnd.oci.image.config.v1+json" },
      layers: [{ digest: sha, mediaType: "application/vnd.oci.image.layer.v1.tar+gzip" }],
    },
    config: {
      os: "linux",
      architecture: "amd64",
      config: { Labels: {
        "org.opencontainers.image.revision": P8D4F_CANDIDATE,
        "org.opencontainers.image.source": "https://github.com/izzhackt/evo_AI_CRM",
      } },
    },
    spec,
    tag,
    candidate: P8D4F_CANDIDATE,
  };
  assert.doesNotThrow(() => validatePortableMetadata(metadata));
  assert.throws(() => validatePortableMetadata({ ...metadata, candidate: "0".repeat(40) }), /archive tag mismatch|archive source mismatch/);
});
