import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readPortableMetadata,
  validatePortableMetadata,
  verifyPortableArchive,
} from "../scripts/p8b3-portable-image-identity.mjs";
import { P8V2 } from "../scripts/p8v2-production-preparation.mjs";

const INDEX_MEDIA = "application/vnd.oci.image.index.v1+json";
const MANIFEST_MEDIA = "application/vnd.oci.image.manifest.v1+json";
const CONFIG_MEDIA = "application/vnd.oci.image.config.v1+json";
const LAYER_MEDIA = "application/vnd.oci.image.layer.v1.tar";
const ATTESTATION_MEDIA = "application/vnd.in-toto+json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function putBlob(root, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  const valueDigest = digest(bytes);
  await writeFile(join(root, "blobs", "sha256", valueDigest.slice(7)), bytes);
  return { digest: valueDigest, size: bytes.length };
}

async function createNestedArchive() {
  const root = await mkdtemp(join(tmpdir(), "evo-p8v2a-oci-"));
  await mkdir(join(root, "blobs", "sha256"), { recursive: true });
  const tag = P8V2.images[0].tag;

  const layer = await putBlob(root, Buffer.from("application-layer\n"));
  const config = await putBlob(root, {
    architecture: "amd64",
    os: "linux",
    config: { Labels: {
      "org.opencontainers.image.revision": P8V2.applicationCommit,
      "org.opencontainers.image.source": P8V2.source,
    } },
  });
  const manifest = await putBlob(root, {
    schemaVersion: 2,
    mediaType: MANIFEST_MEDIA,
    config: { mediaType: CONFIG_MEDIA, ...config },
    layers: [{ mediaType: LAYER_MEDIA, ...layer }],
  });
  const platformDescriptor = {
    mediaType: MANIFEST_MEDIA,
    ...manifest,
    platform: { architecture: "amd64", os: "linux" },
  };

  const attestationLayer = await putBlob(root, Buffer.from('{"predicateType":"https://slsa.dev/provenance/v1"}'));
  const attestationConfig = await putBlob(root, {
    architecture: "unknown",
    os: "unknown",
    config: {},
    rootfs: { type: "layers", diff_ids: [attestationLayer.digest] },
  });
  const attestationManifest = await putBlob(root, {
    schemaVersion: 2,
    mediaType: MANIFEST_MEDIA,
    config: { mediaType: CONFIG_MEDIA, ...attestationConfig },
    layers: [{
      mediaType: ATTESTATION_MEDIA,
      ...attestationLayer,
      annotations: { "in-toto.io/predicate-type": "https://slsa.dev/provenance/v1" },
    }],
  });
  const attestationDescriptor = {
    mediaType: MANIFEST_MEDIA,
    ...attestationManifest,
    annotations: {
      "vnd.docker.reference.digest": platformDescriptor.digest,
      "vnd.docker.reference.type": "attestation-manifest",
    },
    platform: { architecture: "unknown", os: "unknown" },
  };

  const nestedIndex = await putBlob(root, {
    schemaVersion: 2,
    mediaType: INDEX_MEDIA,
    manifests: [platformDescriptor, attestationDescriptor],
  });
  const tagDescriptor = {
    mediaType: INDEX_MEDIA,
    ...nestedIndex,
    annotations: {
      "io.containerd.image.name": `docker.io/library/${tag}`,
      "org.opencontainers.image.ref.name": tag.slice(tag.indexOf(":") + 1),
    },
  };
  await writeFile(join(root, "index.json"), JSON.stringify({ schemaVersion: 2, mediaType: INDEX_MEDIA, manifests: [tagDescriptor] }));
  await writeFile(join(root, "manifest.json"), JSON.stringify([{
    Config: `blobs/sha256/${config.digest.slice(7)}`,
    RepoTags: [tag],
    Layers: [`blobs/sha256/${layer.digest.slice(7)}`],
  }]));
  await writeFile(join(root, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }));
  const archive = join(root, P8V2.images[0].archive);
  const tar = spawnSync("tar", ["-cf", archive, "-C", root, "blobs", "index.json", "manifest.json", "oci-layout"], { encoding: "utf8" });
  assert.equal(tar.status, 0, tar.stderr);
  return { archive, tag, tagDescriptor, platformDescriptor };
}

test("P8V2A accepts the closed Buildx nested index and preserves separate identities", async () => {
  const fixture = await createNestedArchive();
  const metadata = readPortableMetadata(fixture.archive);
  assert.equal(metadata.tagDescriptor.digest, fixture.tagDescriptor.digest);
  assert.equal(metadata.descriptor.digest, fixture.platformDescriptor.digest);
  assert.notEqual(metadata.tagDescriptor.digest, metadata.descriptor.digest);
  assert.equal(metadata.attestations.length, 1);
  verifyPortableArchive(fixture.archive, {
    name: "main_crm",
    archive: P8V2.images[0].archive,
    index: fixture.tagDescriptor.digest,
    manifest: fixture.platformDescriptor.digest,
  }, fixture.tag, P8V2.applicationCommit);
});

test("P8V2A rejects nested index, tag and attestation binding drift", async () => {
  const fixture = await createNestedArchive();
  const metadata = readPortableMetadata(fixture.archive);
  const spec = {
    name: "main_crm",
    archive: P8V2.images[0].archive,
    index: fixture.tagDescriptor.digest,
    manifest: fixture.platformDescriptor.digest,
  };
  assert.throws(() => verifyPortableArchive(fixture.archive, { ...spec, index: `sha256:${"0".repeat(64)}` }, fixture.tag, P8V2.applicationCommit), /nested index/);
  assert.throws(() => verifyPortableArchive(fixture.archive, spec, `${fixture.tag}-drift`, P8V2.applicationCommit), /archive tag/);
  const badAttestations = structuredClone(metadata.attestations);
  badAttestations[0].descriptor.annotations["vnd.docker.reference.digest"] = `sha256:${"1".repeat(64)}`;
  assert.throws(() => validatePortableMetadata({ ...metadata, attestations: badAttestations, spec, tag: fixture.tag, candidate: P8V2.applicationCommit }), /attestation binding/);
});
