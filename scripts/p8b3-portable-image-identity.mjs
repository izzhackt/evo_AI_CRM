#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const CANDIDATE = "0505143657858e710acdd5029f1cc77c5524083e";
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const INDEX_MEDIA = "application/vnd.oci.image.index.v1+json";
const MANIFEST_MEDIA = "application/vnd.oci.image.manifest.v1+json";
const CONFIG_MEDIA = "application/vnd.oci.image.config.v1+json";
const LAYER_MEDIA = new Set(["application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip", "application/vnd.oci.image.layer.v1.tar+zstd"]);
const ATTESTATION_MEDIA = "application/vnd.in-toto+json";
export const specs = [
  { name: "main_crm", prefix: "evo-crm", archive: `evo-crm-${CANDIDATE}-linux-amd64.tar`, index: "sha256:a5421b190e4db827df7333666a9d95a2c01adcb01e2ebb848ee8cfe11ad803dd", manifest: "sha256:b965ac5c41d4e8bddc6d6bb7baaa7bcec101af4083b8ca861f9e9904cec9eafd" },
  { name: "evo_inbox", prefix: "evo-inbox", archive: `evo-inbox-${CANDIDATE}-linux-amd64.tar`, index: "sha256:bed40447beb0255a9fe64f75446fb7259cd02d219a89c4e01627b980fc0e154c", manifest: "sha256:e15c5e07b4232e39622616cb76ed84e1e5b6a7c9145728a42a7701a3238e6b92" },
  { name: "lead_agent", prefix: "evo-lead-agent", archive: `evo-lead-agent-${CANDIDATE}-linux-amd64.tar`, index: "sha256:6cac77644b4824ac31e53aea35d8d6598426cb5b75862d324a17e171d4a5f1a5", manifest: "sha256:572d01c6f2a0824e56607f41d4376e927ccdf41c5218c6dd65930f95cd6593cd" },
];

function fail(message) { throw new Error(message); }
function sha(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function json(bytes, label) { try { return JSON.parse(bytes.toString("utf8")); } catch { fail(`invalid JSON: ${label}`); } }
function run(command, args, options = {}) { return execFileSync(command, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024, ...options }); }
function tarEntry(archive, entry) { return run("tar", ["-xOf", archive, entry]); }
function verifyTarEntrySafety(archive, label) {
  const names = run("tar", ["-tf", archive], { encoding: "utf8" }).trim().split("\n");
  if (names.some((entry) => !entry || entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes(".."))) fail(`unsafe tar entry: ${label}`);
  const verbose = run("tar", ["-tvf", archive], { encoding: "utf8" }).trim().split("\n");
  if (verbose.length !== names.length || verbose.some((entry) => !/^[d-]/.test(entry))) fail(`unsafe tar entry type: ${label}`);
}
function verifyExactEntries(archive, expected, label) {
  const actual = run("tar", ["-tf", archive], { encoding: "utf8" }).trim().split("\n").map((entry) => entry.replace(/\/$/, "")).sort();
  const wanted = [...expected].map((entry) => entry.replace(/\/$/, "")).sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`unexpected tar entries: ${label}`);
}
function verifyDescriptor(archive, descriptor, label) {
  if (!descriptor || !SHA256.test(descriptor.digest) || !Number.isSafeInteger(descriptor.size) || descriptor.size < 0) fail(`invalid descriptor: ${label}`);
  const entry = `blobs/sha256/${descriptor.digest.slice(7)}`;
  const bytes = tarEntry(archive, entry);
  if (bytes.length !== descriptor.size || sha(bytes) !== descriptor.digest) fail(`descriptor mismatch: ${label}`);
  return bytes;
}
export function validatePortableMetadata({ index, tagDescriptor, nestedIndex, descriptor, manifest, config, attestations = [], spec, tag, candidate = CANDIDATE }) {
  const expectedRef = tag.slice(tag.indexOf(":") + 1);
  const tagged = tagDescriptor ?? descriptor;
  if (descriptor.mediaType !== MANIFEST_MEDIA || descriptor.platform?.os !== "linux" || descriptor.platform?.architecture !== "amd64" || (descriptor.platform?.variant ?? "") !== "" || descriptor.digest !== spec.manifest) fail(`platform manifest mismatch: ${spec.name}`);
  if (tagged.annotations?.["io.containerd.image.name"] !== `docker.io/library/${tag}` || tagged.annotations?.["org.opencontainers.image.ref.name"] !== expectedRef) fail(`archive tag mismatch: ${spec.name}`);
  if (manifest.config?.mediaType !== CONFIG_MEDIA) fail(`config media type mismatch: ${spec.name}`);
  if (!Array.isArray(manifest.layers) || manifest.layers.length === 0 || manifest.layers.some((layer) => !LAYER_MEDIA.has(layer.mediaType))) fail(`layer media type mismatch: ${spec.name}`);
  if (config.os !== "linux" || config.architecture !== "amd64") fail(`config platform mismatch: ${spec.name}`);
  if (config.config?.Labels?.["org.opencontainers.image.revision"] !== candidate || config.config?.Labels?.["org.opencontainers.image.source"] !== "https://github.com/izzhackt/evo_AI_CRM") fail(`archive source mismatch: ${spec.name}`);
  if (!Array.isArray(index.manifests) || index.manifests.length !== 1) fail(`manifest cardinality mismatch: ${spec.name}`);
  if (nestedIndex) {
    if (index.schemaVersion !== 2 || index.mediaType !== INDEX_MEDIA || tagged.mediaType !== INDEX_MEDIA || (spec.index && tagged.digest !== spec.index) || nestedIndex.mediaType !== INDEX_MEDIA || nestedIndex.schemaVersion !== 2 || nestedIndex.manifests?.length !== 2 || manifest.schemaVersion !== 2 || manifest.mediaType !== MANIFEST_MEDIA || attestations.length !== 1) fail(`nested index mismatch: ${spec.name}`);
    const attestation = attestations[0];
    if (attestation.descriptor.mediaType !== MANIFEST_MEDIA || attestation.descriptor.platform?.os !== "unknown" || attestation.descriptor.platform?.architecture !== "unknown" || attestation.descriptor.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest" || attestation.descriptor.annotations?.["vnd.docker.reference.digest"] !== descriptor.digest) fail(`attestation binding mismatch: ${spec.name}`);
    const attestationLayer = attestation.manifest.layers?.[0];
    if (attestation.manifest.schemaVersion !== 2 || attestation.manifest.mediaType !== MANIFEST_MEDIA || attestation.manifest.config?.mediaType !== CONFIG_MEDIA || attestation.config.os !== "unknown" || attestation.config.architecture !== "unknown" || attestation.manifest.layers?.length !== 1 || attestationLayer.mediaType !== ATTESTATION_MEDIA || attestationLayer.annotations?.["in-toto.io/predicate-type"] !== "https://slsa.dev/provenance/v1" || attestation.config.rootfs?.type !== "layers" || JSON.stringify(attestation.config.rootfs.diff_ids) !== JSON.stringify([attestationLayer.digest])) fail(`attestation payload mismatch: ${spec.name}`);
  } else if (tagged !== descriptor || attestations.length !== 0) fail(`unexpected nested metadata: ${spec.name}`);
}
export function readPortableMetadata(archive) {
  const index = json(tarEntry(archive, "index.json"), "index.json");
  const tagDescriptor = index.manifests?.[0];
  if (!tagDescriptor) fail("missing tagged descriptor");
  let nestedIndex = null;
  let descriptor = tagDescriptor;
  const attestations = [];
  if (tagDescriptor.mediaType === INDEX_MEDIA) {
    nestedIndex = json(tarEntry(archive, `blobs/sha256/${tagDescriptor.digest?.slice(7)}`), "nested-index");
    const platforms = nestedIndex.manifests?.filter((item) => item.mediaType === MANIFEST_MEDIA && item.platform?.os === "linux" && item.platform?.architecture === "amd64" && (item.platform?.variant ?? "") === "") ?? [];
    const attestationDescriptors = nestedIndex.manifests?.filter((item) => item.mediaType === MANIFEST_MEDIA && item.platform?.os === "unknown" && item.platform?.architecture === "unknown") ?? [];
    if (platforms.length !== 1 || attestationDescriptors.length !== 1 || nestedIndex.manifests?.length !== 2) fail("nested manifest cardinality mismatch");
    descriptor = platforms[0];
    for (const attestationDescriptor of attestationDescriptors) {
      const attestationManifest = json(tarEntry(archive, `blobs/sha256/${attestationDescriptor.digest?.slice(7)}`), "attestation-manifest");
      const attestationConfig = json(tarEntry(archive, `blobs/sha256/${attestationManifest.config?.digest?.slice(7)}`), "attestation-config");
      attestations.push({ descriptor: attestationDescriptor, manifest: attestationManifest, config: attestationConfig });
    }
  }
  const manifest = json(tarEntry(archive, `blobs/sha256/${descriptor.digest?.slice(7)}`), "manifest");
  const config = json(tarEntry(archive, `blobs/sha256/${manifest.config?.digest?.slice(7)}`), "config");
  return { index, tagDescriptor, nestedIndex, descriptor, manifest, config, attestations };
}
export function verifyPortableArchive(archive, spec, tag, candidate = CANDIDATE) {
  verifyTarEntrySafety(archive, spec.name);
  const { index, tagDescriptor, nestedIndex, descriptor, manifest, config, attestations } = readPortableMetadata(archive);
  validatePortableMetadata({ index, tagDescriptor, nestedIndex, descriptor, manifest, config, attestations, spec, tag, candidate });
  if (nestedIndex) verifyDescriptor(archive, tagDescriptor, `${spec.name}/index`);
  const manifestBytes = verifyDescriptor(archive, descriptor, `${spec.name}/manifest`);
  const configBytes = verifyDescriptor(archive, manifest.config, `${spec.name}/config`);
  for (const [indexValue, layer] of manifest.layers.entries()) verifyDescriptor(archive, layer, `${spec.name}/layer/${indexValue}`);
  for (const [attestationIndex, attestation] of attestations.entries()) {
    verifyDescriptor(archive, attestation.descriptor, `${spec.name}/attestation/${attestationIndex}`);
    verifyDescriptor(archive, attestation.manifest.config, `${spec.name}/attestation/${attestationIndex}/config`);
    for (const [layerIndex, layer] of attestation.manifest.layers.entries()) verifyDescriptor(archive, layer, `${spec.name}/attestation/${attestationIndex}/layer/${layerIndex}`);
  }
  const dockerManifest = json(tarEntry(archive, "manifest.json"), `${spec.name}/manifest.json`);
  if (!Array.isArray(dockerManifest) || dockerManifest.length !== 1 || dockerManifest[0].Config !== `blobs/sha256/${manifest.config.digest.slice(7)}` || JSON.stringify(dockerManifest[0].RepoTags) !== JSON.stringify([tag]) || JSON.stringify(dockerManifest[0].Layers) !== JSON.stringify(manifest.layers.map((layer) => `blobs/sha256/${layer.digest.slice(7)}`))) fail(`Docker manifest mismatch: ${spec.name}`);
  const expected = new Set(["blobs", "blobs/sha256", "index.json", "manifest.json", "oci-layout", ...(nestedIndex ? [`blobs/sha256/${tagDescriptor.digest.slice(7)}`] : []), `blobs/sha256/${descriptor.digest.slice(7)}`, `blobs/sha256/${manifest.config.digest.slice(7)}`, ...manifest.layers.map((layer) => `blobs/sha256/${layer.digest.slice(7)}`), ...attestations.flatMap((attestation) => [`blobs/sha256/${attestation.descriptor.digest.slice(7)}`, `blobs/sha256/${attestation.manifest.config.digest.slice(7)}`, ...attestation.manifest.layers.map((layer) => `blobs/sha256/${layer.digest.slice(7)}`)])]);
  verifyExactEntries(archive, expected, spec.name);
  return { index, descriptor, manifest: json(manifestBytes, `${spec.name}/manifest`), config: json(configBytes, `${spec.name}/config`) };
}
function write0600(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); chmodSync(path, 0o600); }

export function createPortableIdentity(output, { candidate = CANDIDATE, imageSpecs = specs } = {}) {
  if (run("orb", ["status"], { encoding: "utf8" }).trim() !== "Running") fail("OrbStack must be Running");
  if (run("docker", ["context", "show"], { encoding: "utf8" }).trim() !== "orbstack") fail("Docker context must be exactly orbstack");
  mkdirSync(output, { mode: 0o700 });
  chmodSync(output, 0o700);
  const images = [];
  for (const spec of imageSpecs) {
    const tag = `${spec.prefix}:${candidate}-linux-amd64`;
    const inspect = JSON.parse(run("docker", ["image", "inspect", tag], { encoding: "utf8" }))[0];
    if (inspect?.Descriptor?.mediaType !== "application/vnd.oci.image.index.v1+json" || inspect.Id !== spec.index || inspect.Descriptor.digest !== spec.index) fail(`OCI index mismatch: ${spec.name}`);
    if (inspect.Os !== "linux" || inspect.Architecture !== "amd64" || (inspect.Variant ?? "") !== "") fail(`platform mismatch: ${spec.name}`);
    if (inspect.Config?.Labels?.["org.opencontainers.image.revision"] !== candidate) fail(`revision mismatch: ${spec.name}`);
    if (inspect.Config?.Labels?.["org.opencontainers.image.source"] !== "https://github.com/izzhackt/evo_AI_CRM") fail(`source mismatch: ${spec.name}`);
    const archive = join(output, spec.archive);
    run("docker", ["image", "save", "--platform=linux/amd64", "--output", archive, tag]);
    chmodSync(archive, 0o600);
    const { descriptor, manifest } = verifyPortableArchive(archive, spec, tag, candidate);
    const archiveBytes = readFileSync(archive);
    images.push({ name: spec.name, tag, source_commit: candidate, platform: { os: "linux", architecture: "amd64", variant: "" }, oci_index_digest: spec.index, platform_manifest: { digest: descriptor.digest, media_type: descriptor.mediaType, size: descriptor.size }, config: { digest: manifest.config.digest, media_type: manifest.config.mediaType, size: manifest.config.size }, layers: manifest.layers.map((layer) => ({ digest: layer.digest, media_type: layer.mediaType, size: layer.size })), archive: { file: spec.archive, sha256: sha(archiveBytes).slice(7), size: archiveBytes.length, mode: 600 } });
  }
  const identity = { schema_version: 1, candidate_commit: candidate, target_platform: { os: "linux", architecture: "amd64", variant: "" }, images };
  const identityPath = join(output, "portable-image-identity.json");
  write0600(identityPath, identity);
  const files = [...images.map(({ archive }) => archive.file), basename(identityPath)].sort().map((file) => { const bytes = readFileSync(join(output, file)); return { file, mode: 600, sha256: sha(bytes).slice(7), size: bytes.length }; });
  write0600(join(output, "collection-index.json"), { schema_version: 1, candidate_commit: candidate, files });
  if ((statSync(output).mode & 0o777) !== 0o700) fail("unsafe output mode");
  return identity;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = process.argv.indexOf("--output");
  if (index < 0 || !process.argv[index + 1] || process.argv.length !== 4) fail("usage: p8b3-portable-image-identity.mjs --output <new-directory>");
  createPortableIdentity(process.argv[index + 1]);
  process.stdout.write(`${process.argv[index + 1]}\n`);
}
