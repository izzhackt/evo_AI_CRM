import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  APPLICATION,
  CONTROLLED_FILES,
  EVIDENCE_FILES,
  createDockerExecutor,
  parseContainerInventory,
  parseImageInventory,
  prepareEvidencePaths,
  removeOwnedContainer,
  scanArtifactFile,
  scanArtifactPrivacy,
  validateCandidateResult,
  verifyFinalRoot,
} from "../scripts/p8u2-root-candidate.mjs";

const schema = JSON.parse(readFileSync(new URL("../docs/schemas/p8u2-root-candidate.schema.json", import.meta.url), "utf8"));
const runner = readFileSync(new URL("../scripts/p8u2-root-candidate.mjs", import.meta.url), "utf8");
const contract = readFileSync(new URL("../docs/platform/p8u2-private-root-candidate.md", import.meta.url), "utf8");
const validateSchema = new Ajv2020({ strict: false }).compile(schema);
const sha = "a".repeat(64);
const imageId = `sha256:${sha}`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function canonicalResult() {
  return {
    schema_version: 1,
    result_code: "candidate_verified",
    generated_at: "2026-08-18T00:00:00.000Z",
    application: {
      commit: APPLICATION.commit,
      tree: APPLICATION.tree,
      parent: APPLICATION.parent,
      ci_run: APPLICATION.ciRun,
    },
    release_control: {
      commit: "b".repeat(40),
      tree: "c".repeat(40),
      ci_run: 32080000000,
      files: CONTROLLED_FILES.map((file) => ({ file, sha256: sha })),
    },
    target: {
      tag: APPLICATION.tag,
      image_id: imageId,
      platform: { os: "linux", architecture: "amd64", variant: "" },
      labels: { source: APPLICATION.source, revision: APPLICATION.commit, version: APPLICATION.version },
      configured_user: "nextjs",
      runtime_uid: 1001,
      runtime_gid: 1001,
    },
    build: { status: "verified", exit_code: 0, file: "build-crm.log", sha256: sha },
    sbom: { status: "verified", exit_code: 0, file: "sbom-crm.spdx.json", sha256: sha, format: "spdx-json", tool: "docker-sbom 0.6.1", image_id: imageId },
    smoke: {
      status: "verified",
      file: "smoke-crm.log",
      sha256: sha,
      container: APPLICATION.container,
      network: "none",
      mount_count: 0,
      caller_credential_count: 0,
      restart_policy: "no",
      restart_count: 0,
      health: { http_status: 200, body: { ok: true, status: "live", service: "evo-crm" } },
      assistant_disabled: { http_status: 503, body: { error: { code: "assistant_disabled" } } },
    },
    privacy: { status: "verified" },
    cleanup: { status: "verified", container_absent: true, temp_absent: true },
    collection: {
      status: "verified",
      index_file: "collection-index.json",
      index_sha256: sha,
      retained_files: [...EVIDENCE_FILES],
      artifacts: ["build-crm.log", "image-identity.json", "sbom-crm.spdx.json", "smoke-crm.log"].map((file) => ({ file, mode: 600, size: 1, sha256: sha })),
    },
  };
}

test("P8U2 schema and runtime accept only the exact verified candidate", () => {
  const value = canonicalResult();
  assert.equal(validateSchema(value), true, JSON.stringify(validateSchema.errors));
  assert.doesNotThrow(() => validateCandidateResult(value));

  for (const mutate of [
    (copy) => { copy.application.commit = "d".repeat(40); },
    (copy) => { copy.target.tag = "evo-crm:latest"; },
    (copy) => { copy.target.platform.architecture = "arm64"; },
    (copy) => { copy.target.configured_user = "root"; },
    (copy) => { copy.smoke.network = "bridge"; },
    (copy) => { copy.smoke.mount_count = 1; },
    (copy) => { copy.smoke.restart_count = 1; },
    (copy) => { copy.smoke.assistant_disabled.body = { ok: false, error: { code: "assistant_disabled" } }; },
    (copy) => { copy.collection.artifacts.pop(); },
    (copy) => { copy.collection.retained_files = copy.collection.retained_files.slice(1); },
    (copy) => { copy.release_control.files.reverse(); },
  ]) {
    const copy = structuredClone(value);
    mutate(copy);
    assert.equal(validateSchema(copy), false, `schema accepted mutation ${mutate}`);
    assert.throws(() => validateCandidateResult(copy));
  }

  const failure = {
    schema_version: 1,
    result_code: "build_failed",
    generated_at: "2026-08-18T00:00:00.000Z",
    failure_step: "build",
    application: value.application,
    release_control: value.release_control,
    cleanup: { status: "verified", container_absent: true, temp_absent: true },
  };
  assert.equal(validateSchema(failure), true, JSON.stringify(validateSchema.errors));
  failure.failure_step = "privacy";
  assert.equal(validateSchema(failure), false, "schema accepted a contradictory failure step/code");
  failure.failure_step = "cleanup";
  failure.result_code = "cleanup_failed";
  assert.equal(validateSchema(failure), false, "schema accepted cleanup_failed with verified cleanup");
});

test("P8U2 image inventory proves absence and rejects malformed or duplicate rows", () => {
  const rows = parseImageInventory('evo-crm|other|sha256:' + "1".repeat(64) + "\n");
  assert.equal(rows.has(APPLICATION.tag), false);
  assert.throws(() => parseImageInventory("bad-row\n"), /malformed/);
  assert.throws(() => parseImageInventory(`evo-crm|x|${imageId}\nevo-crm|x|${imageId}\n`), /duplicate/);
  const containers = parseContainerInventory(`${"1".repeat(64)}|safe-container\n`);
  assert.equal(containers.get("safe-container"), "1".repeat(64));
  assert.throws(() => parseContainerInventory("safe-container\n"), /malformed/);
});

test("P8U2 Docker seam rechecks OrbStack before every operation and stops on drift", () => {
  const calls = [];
  let verification = 0;
  const executor = createDockerExecutor((command, args) => {
    calls.push([command, ...args]);
    if (command === "orb") {
      verification += 1;
      return { status: 0, stdout: verification === 1 ? "Running\n" : "Stopped\n" };
    }
    if (args[0] === "context") return { status: 0, stdout: "orbstack\n" };
    return { status: 0, stdout: "ok\n" };
  });
  assert.equal(executor.text(["image", "ls"]), "ok");
  assert.throws(() => executor.text(["rm", "-f", "unsafe"]), /orb status/);
  assert.equal(calls.filter((call) => call[0] === "docker" && call[1] === "rm").length, 0, "Docker effect ran after context drift");
});

test("P8U2 evidence parent rejects symlink escape", () => {
  const source = mkdtempSync(join(tmpdir(), "p8u2-source-"));
  const outside = mkdtempSync(join(tmpdir(), "p8u2-outside-"));
  try {
    symlinkSync(outside, join(source, ".evo-release-evidence"));
    assert.throws(() => prepareEvidencePaths(source), /non-symlink|escapes/);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("P8U2 cleanup refuses a foreign container with the reserved name", () => {
  let removed = false;
  const foreign = "2".repeat(64);
  const executor = {
    text: () => `${foreign}|${APPLICATION.container}\n`,
    result: () => { removed = true; return { status: 0 }; },
  };
  assert.throws(() => removeOwnedContainer("3".repeat(64), executor), /foreign/);
  assert.equal(removed, false);
});

test("P8U2 privacy scan keeps narrow SPDX metadata and rejects other contacts or credentials", () => {
  assert.doesNotThrow(() => scanArtifactPrivacy({ packages: [{ originator: "Person: Maintainer <maintainer@example.org>", downloadLocation: "git@github.com:org/repo.git" }] }, { spdx: true }));
  for (const value of [
    { comment: "student@example.org" },
    { nested: { note: "+996555123456" } },
    { packages: [{ originator: "Person: Maintainer +996555123456" }] },
    { token: ["api", "key=fixture-value"].join("_") },
  ]) assert.throws(() => scanArtifactPrivacy(value, { spdx: true }), /sensitive/);
  assert.throws(() => scanArtifactPrivacy({ "student@example.org": "safe value" }, { spdx: true }), /sensitive/);

  const root = mkdtempSync(join(tmpdir(), "p8u2-privacy-"));
  try {
    const escaped = join(root, "escaped.json");
    writeFileSync(escaped, '{"student\\u0040example.org":"safe"}\n', { mode: 0o600 });
    assert.throws(() => scanArtifactFile(escaped, { spdx: true }), /sensitive/);
    const credential = join(root, "credential.log");
    writeFileSync(credential, `${["api", "key=fixture-value"].join("_")}\n`, { mode: 0o600 });
    assert.throws(() => scanArtifactFile(credential), /sensitive/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P8U2 final verification recomputes the retained evidence graph", () => {
  const source = mkdtempSync(join(tmpdir(), "p8u2-graph-"));
  try {
    const { parent, root } = prepareEvidencePaths(source);
    mkdirSync(root, { mode: 0o700 });
    chmodSync(root, 0o700);
    const identity = {
      schema_version: 1,
      application_commit: APPLICATION.commit,
      tag: APPLICATION.tag,
      image_id: imageId,
      platform: { os: "linux", architecture: "amd64", variant: "" },
      labels: { source: APPLICATION.source, revision: APPLICATION.commit, version: APPLICATION.version },
      configured_user: "nextjs",
    };
    const contents = {
      "build-crm.log": "candidate build verified\n",
      "image-identity.json": `${JSON.stringify(identity, null, 2)}\n`,
      "sbom-crm.spdx.json": `${JSON.stringify({ spdxVersion: "SPDX-2.3", packages: [] }, null, 2)}\n`,
      "smoke-crm.log": "result=liveness_and_disabled_route_verified\n",
    };
    for (const [file, body] of Object.entries(contents)) writeFileSync(join(root, file), body, { mode: 0o600 });
    const artifacts = ["build-crm.log", "image-identity.json", "sbom-crm.spdx.json", "smoke-crm.log"].map((file) => {
      const body = readFileSync(join(root, file));
      return { file, mode: 600, size: statSync(join(root, file)).size, sha256: hash(body) };
    });
    const index = { schema_version: 1, application_commit: APPLICATION.commit, files: artifacts };
    const indexText = `${JSON.stringify(index, null, 2)}\n`;
    writeFileSync(join(root, "collection-index.json"), indexText, { mode: 0o600 });
    const result = canonicalResult();
    result.build.sha256 = artifacts[0].sha256;
    result.sbom.sha256 = artifacts[2].sha256;
    result.smoke.sha256 = artifacts[3].sha256;
    result.collection.artifacts = artifacts;
    result.collection.index_sha256 = hash(indexText);
    writeFileSync(join(root, "candidate-result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    assert.doesNotThrow(() => verifyFinalRoot(source, parent, root, result));
    writeFileSync(join(root, "smoke-crm.log"), "result=drifted\n", { mode: 0o600 });
    assert.throws(() => verifyFinalRoot(source, parent, root, result), /artifact graph drift|hash drift/);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("P8U2 runner source freezes OrbStack, Buildx, SBOM, network-none and exact route probes", () => {
  for (const fragment of [
    "orb status",
    "docker context show",
    '"image", "ls", "--no-trunc"',
    '"buildx", "build"',
    "--platform",
    "linux/amd64",
    '"sbom", "--format", "spdx-json"',
    "--network",
    "none",
    "/api/health",
    "/api/platform-ai/staff-assistant",
    '"assistant_disabled"',
    "constants.COPYFILE_EXCL",
    "closeSync(fd)",
    "generateSbom(tempSbom, image.Id)",
    "runSmoke(tempSmoke, image.Id",
    "inspect.Image !== imageId",
  ]) assert.ok(runner.includes(fragment), `missing runner fragment: ${fragment}`);
  assert.doesNotMatch(runner, /exec(?:Text|Result)\("docker"/);
  assert.match(contract, /never transferred,\s+routed, deployed or exposed/);
});

test("P8U2 collection identities are non-circular and use mode 0600", () => {
  assert.deepEqual(EVIDENCE_FILES, ["build-crm.log", "candidate-result.json", "collection-index.json", "image-identity.json", "sbom-crm.spdx.json", "smoke-crm.log"]);
  const root = mkdtempSync(join(tmpdir(), "p8u2-test-"));
  try {
    const file = join(root, "safe.json");
    writeFileSync(file, "{}\n", { mode: 0o600 });
    assert.equal(readFileSync(file, "utf8"), "{}\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
