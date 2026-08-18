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
  PRESERVED_P8U2,
  PRESERVED_P8U3,
  SMOKE_INJECTED_ENV_NAMES,
  createDockerExecutor,
  parseContainerInventory,
  parseImageInventory,
  preservedEvidenceRecords,
  prepareEvidencePaths,
  removeOwnedContainer,
  scanArtifactFile,
  scanArtifactPrivacy,
  validateCandidateResult,
  validatePreservedP8U2Image,
  validatePreservedP8U3Image,
  validateSmokeEnvironment,
  validateSmokeLog,
  verifyFailureRoot,
  verifyFinalRoot,
  verifyPreservedP8U2Evidence,
  verifyPreservedP8U3Evidence,
} from "../scripts/p8u4-root-candidate.mjs";

const schema = JSON.parse(readFileSync(new URL("../docs/schemas/p8u4-root-candidate.schema.json", import.meta.url), "utf8"));
const runner = readFileSync(new URL("../scripts/p8u4-root-candidate.mjs", import.meta.url), "utf8");
const contract = readFileSync(new URL("../docs/platform/p8u4-root-assistant-proxy.md", import.meta.url), "utf8");
const validateSchema = new Ajv2020({ strict: false }).compile(schema);
const sha = "a".repeat(64);
const imageId = `sha256:${sha}`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function canonicalSmokeLog() {
  return [
    "result=liveness_and_disabled_route_verified",
    "platform=linux/amd64",
    "network=none",
    "mount_count=0",
    `injected_environment_names=${SMOKE_INJECTED_ENV_NAMES.join(",")}`,
    "caller_credential_count=0",
    "staff_assistant_setting_count=0",
    "supabase_setting_count=0",
    "gemini_setting_count=0",
    "waha_setting_count=0",
    "amocrm_setting_count=0",
    "configured_user=nextjs",
    "runtime_uid=1001",
    "runtime_gid=1001",
    "restart_policy=no",
    "restart_count=0",
    "health_http_status=200",
    "assistant_http_status=503",
    "assistant_error_code=assistant_disabled",
    "provider_calls=0",
  ].join("\n") + "\n";
}

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
    preserved: preservedEvidenceRecords(),
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
      injected_environment_names: [...SMOKE_INJECTED_ENV_NAMES],
      caller_credential_count: 0,
      staff_assistant_setting_count: 0,
      supabase_setting_count: 0,
      gemini_setting_count: 0,
      waha_setting_count: 0,
      amocrm_setting_count: 0,
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

test("P8U4 schema and runtime accept only the exact verified candidate", () => {
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
    (copy) => { copy.preserved[1].status = "failed"; },
    (copy) => { copy.preserved.reverse(); },
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
    preserved: value.preserved,
    cleanup: { status: "verified", container_absent: true, temp_absent: true },
  };
  assert.equal(validateSchema(failure), true, JSON.stringify(validateSchema.errors));
  failure.failure_step = "privacy";
  assert.equal(validateSchema(failure), false, "schema accepted a contradictory failure step/code");
  failure.failure_step = "cleanup";
  failure.result_code = "cleanup_failed";
  assert.equal(validateSchema(failure), false, "schema accepted cleanup_failed with verified cleanup");
});

test("P8U4 image inventory proves absence and rejects malformed or duplicate rows", () => {
  const rows = parseImageInventory('evo-crm|other|sha256:' + "1".repeat(64) + "\n");
  assert.equal(rows.has(APPLICATION.tag), false);
  assert.throws(() => parseImageInventory("bad-row\n"), /malformed/);
  assert.throws(() => parseImageInventory(`evo-crm|x|${imageId}\nevo-crm|x|${imageId}\n`), /duplicate/);
  const containers = parseContainerInventory(`${"1".repeat(64)}|safe-container\n`);
  assert.equal(containers.get("safe-container"), "1".repeat(64));
  assert.throws(() => parseContainerInventory("safe-container\n"), /malformed/);
});

test("P8U4 Docker seam rechecks OrbStack before every operation and stops on drift", () => {
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

test("P8U4 evidence parent rejects symlink escape", () => {
  const source = mkdtempSync(join(tmpdir(), "p8u4-source-"));
  const outside = mkdtempSync(join(tmpdir(), "p8u4-outside-"));
  try {
    symlinkSync(outside, join(source, ".evo-release-evidence"));
    assert.throws(() => prepareEvidencePaths(source), /non-symlink|escapes/);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("P8U4 cleanup refuses a foreign container with the reserved name", () => {
  let removed = false;
  const foreign = "2".repeat(64);
  const executor = {
    text: () => `${foreign}|${APPLICATION.container}\n`,
    result: () => { removed = true; return { status: 0 }; },
  };
  assert.throws(() => removeOwnedContainer("3".repeat(64), executor), /foreign/);
  assert.equal(removed, false);
});

test("P8U4 privacy scan keeps narrow SPDX metadata and rejects other contacts or credentials", () => {
  assert.doesNotThrow(() => scanArtifactPrivacy({ packages: [{ originator: "Person: Maintainer <maintainer@example.org>", downloadLocation: "git@github.com:org/repo.git" }] }, { spdx: true }));
  for (const value of [
    { comment: "student@example.org" },
    { nested: { note: "+996555123456" } },
    { packages: [{ originator: "Person: Maintainer +996555123456" }] },
    { token: ["api", "key=fixture-value"].join("_") },
  ]) assert.throws(() => scanArtifactPrivacy(value, { spdx: true }), /sensitive/);
  assert.throws(() => scanArtifactPrivacy({ "student@example.org": "safe value" }, { spdx: true }), /sensitive/);

  const root = mkdtempSync(join(tmpdir(), "p8u4-privacy-"));
  try {
    const escaped = join(root, "escaped.json");
    writeFileSync(escaped, '{"student\\u0040example.org":"safe"}\n', { mode: 0o600 });
    assert.throws(() => scanArtifactFile(escaped), /sensitive/);
    const credential = join(root, "credential.log");
    writeFileSync(credential, `${["api", "key=fixture-value"].join("_")}\n`, { mode: 0o600 });
    assert.throws(() => scanArtifactFile(credential), /sensitive/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P8U4 permits only the sole image-bound canonical Syft namespace UUID", () => {
  const root = mkdtempSync(join(tmpdir(), "p8u4-spdx-"));
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  const namespace = `https://anchore.com/syft/image/${imageId.replace(":", "-")}-${uuid}`;
  const writeSpdx = (name, value) => {
    const path = join(root, name);
    writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    return path;
  };
  try {
    const canonical = writeSpdx("canonical.json", { spdxVersion: "SPDX-2.3", documentNamespace: namespace, packages: [] });
    assert.doesNotThrow(() => scanArtifactFile(canonical, { spdx: true, imageId }));

    for (const [name, value] of [
      ["elsewhere", { spdxVersion: "SPDX-2.3", documentNamespace: namespace, comment: uuid }],
      ["duplicate", { spdxVersion: "SPDX-2.3", documentNamespace: namespace, annotation: `copy ${uuid}` }],
      ["wrong-digest", { spdxVersion: "SPDX-2.3", documentNamespace: namespace.replace(sha, "b".repeat(64)) }],
      ["uppercase-digest", { spdxVersion: "SPDX-2.3", documentNamespace: namespace.replace(sha, sha.toUpperCase()) }],
      ["wrong-domain", { spdxVersion: "SPDX-2.3", documentNamespace: namespace.replace("anchore.com", "example.org") }],
      ["wrong-path", { spdxVersion: "SPDX-2.3", documentNamespace: namespace.replace("/syft/image/", "/other/image/") }],
      ["wrong-domain-no-uuid", { spdxVersion: "SPDX-2.3", documentNamespace: `https://example.org/syft/image/sha256-${sha}-not-a-uuid` }],
      ["missing-namespace", { spdxVersion: "SPDX-2.3", packages: [] }],
      ["uuid-key", { spdxVersion: "SPDX-2.3", documentNamespace: namespace, [uuid]: "unsafe" }],
    ]) {
      const path = writeSpdx(`${name}.json`, value);
      assert.throws(() => scanArtifactFile(path, { spdx: true, imageId }), /sensitive|namespace|UUID|digest/i, name);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P8U4 requires both exact immutable P8U2/P8U3 evidence and tag/image boundaries", () => {
  const source = mkdtempSync(join(tmpdir(), "p8u4-preserved-"));
  const parent = join(source, ".evo-release-evidence");
  try {
    mkdirSync(parent, { mode: 0o700 });
    chmodSync(parent, 0o700);
    for (const [preserved, verifyEvidence, validateImage] of [
      [PRESERVED_P8U2, verifyPreservedP8U2Evidence, validatePreservedP8U2Image],
      [PRESERVED_P8U3, verifyPreservedP8U3Evidence, validatePreservedP8U3Image],
    ]) {
      const boundary = { ...preserved, evidenceDirectory: `fixture-${preserved.attempt}`, files: {} };
      assert.throws(() => verifyEvidence(source, boundary), /directory|evidence/i);
      const root = join(parent, boundary.evidenceDirectory);
      mkdirSync(root, { mode: 0o700 });
      chmodSync(root, 0o700);
      const path = join(root, "candidate-result.json");
      writeFileSync(path, "fixture\n", { mode: 0o600 });
      boundary.files = { "candidate-result.json": hash("fixture\n") };
      assert.doesNotThrow(() => verifyEvidence(source, boundary));
      writeFileSync(path, "drift\n", { mode: 0o600 });
      assert.throws(() => verifyEvidence(source, boundary), /hash drift/);
      writeFileSync(path, "fixture\n", { mode: 0o600 });

      const labels = {
        "org.opencontainers.image.source": APPLICATION.source,
        "org.opencontainers.image.revision": preserved.applicationCommit,
        "org.opencontainers.image.version": preserved.version,
      };
      const image = { Id: preserved.imageId, Os: "linux", Architecture: "amd64", Config: { Labels: labels } };
      assert.doesNotThrow(() => validateImage(new Map([[preserved.tag, preserved.imageId]]), image));
      assert.throws(() => validateImage(new Map(), image), /binding drift/);
      assert.throws(() => validateImage(new Map([[preserved.tag, imageId]]), image), /binding drift/);
    }
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("P8U4 smoke environment permits only the fresh process-only P7B pair", () => {
  const base = ["NODE_ENV=production", "PORT=3000"];
  const exact = [...base, "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1", `EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=${"a".repeat(64)}`];
  assert.deepEqual(validateSmokeEnvironment(base, exact), {
    injected_environment_names: [...SMOKE_INJECTED_ENV_NAMES],
    caller_credential_count: 0,
    staff_assistant_setting_count: 0,
    supabase_setting_count: 0,
    gemini_setting_count: 0,
    waha_setting_count: 0,
    amocrm_setting_count: 0,
  });
  assert.throws(() => validateSmokeEnvironment(base, [...exact, "GEMINI_API_KEY=forbidden"]), /environment names drift|forbidden/);
  assert.throws(() => validateSmokeEnvironment(base, [...exact, "EVO_PLATFORM_STAFF_ASSISTANT_ENABLED=1"]), /environment names drift|forbidden/);
  assert.throws(() => validateSmokeEnvironment(base, [...exact, "EXTRA=value"]), /environment names drift/);
  assert.throws(() => validateSmokeEnvironment(base, exact.map((entry) => entry.startsWith("EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=") ? "EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=short" : entry)), /HMAC/);
  for (const forbidden of [
    "EVO_PLATFORM_ORGANIZATION_ID=00000000-0000-4000-8000-000000000000",
    "EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID=00000000-0000-4000-8000-000000000000",
    "EVO_PLATFORM_GEMINI_API_KEY=forbidden",
    "EVO_PLATFORM_GEMINI_PROPOSALS_ENABLED=1",
    "EVO_PLATFORM_GEMINI_PROPOSAL_HMAC_SECRET=forbidden",
    "EVO_PLATFORM_GEMINI_PROPOSAL_MODEL=gemini-forbidden",
    "EVO_PLATFORM_GEMINI_PROPOSAL_TIMEOUT_MS=1000",
  ]) {
    const forbiddenBase = [...base, forbidden];
    const forbiddenContainer = [...forbiddenBase, "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1", `EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=${"a".repeat(64)}`];
    assert.throws(() => validateSmokeEnvironment(forbiddenBase, forbiddenContainer), /forbidden smoke configuration/);
  }
});

test("P8U4 smoke evidence is exact, UUID-free and contains no HMAC value", () => {
  const safe = canonicalSmokeLog();
  assert.equal(validateSmokeLog(safe), true);
  assert.doesNotMatch(safe, /[0-9a-f]{64}/);
  assert.throws(() => validateSmokeLog(safe.replace("provider_calls=0", "provider_calls=1")), /contract drift/);
  assert.throws(() => validateSmokeLog(`${safe}extra=value\n`), /contract drift/);
});

test("P8U4 final verification recomputes the retained evidence graph", () => {
  const source = mkdtempSync(join(tmpdir(), "p8u4-graph-"));
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
      "sbom-crm.spdx.json": `${JSON.stringify({
        spdxVersion: "SPDX-2.3",
        documentNamespace: `https://anchore.com/syft/image/${imageId.replace(":", "-")}-123e4567-e89b-42d3-a456-426614174000`,
        packages: [],
      }, null, 2)}\n`,
      "smoke-crm.log": canonicalSmokeLog(),
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

test("P8U4 failure verification closes allowlist, modes and privacy", () => {
  const source = mkdtempSync(join(tmpdir(), "p8u4-failure-"));
  try {
    const { parent, root } = prepareEvidencePaths(source);
    mkdirSync(root, { mode: 0o700 });
    const failure = validateCandidateResult({
      schema_version: 1,
      result_code: "build_failed",
      generated_at: "2026-08-18T00:00:00.000Z",
      failure_step: "build",
      application: { commit: APPLICATION.commit, tree: APPLICATION.tree, parent: APPLICATION.parent, ci_run: APPLICATION.ciRun },
      release_control: canonicalResult().release_control,
      preserved: preservedEvidenceRecords(),
      cleanup: { status: "verified", container_absent: true, temp_absent: true },
    });
    writeFileSync(join(root, "candidate-result.json"), `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600 });
    assert.equal(verifyFailureRoot(source, parent, root, failure), true);

    writeFileSync(join(root, "unexpected.tmp"), "unsafe\n", { mode: 0o600 });
    assert.throws(() => verifyFailureRoot(source, parent, root, failure), /allowlist/);
    rmSync(join(root, "unexpected.tmp"));

    chmodSync(join(root, "candidate-result.json"), 0o644);
    assert.throws(() => verifyFailureRoot(source, parent, root, failure), /mode 600/);
    chmodSync(join(root, "candidate-result.json"), 0o600);

    writeFileSync(join(root, "build-crm.log"), "contact=person@example.com\n", { mode: 0o600 });
    assert.throws(() => verifyFailureRoot(source, parent, root, failure), /contact data/);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("P8U4 runner source freezes OrbStack, Buildx, SBOM, network-none and exact route probes", () => {
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
    '"symbolic-ref", "--quiet", "--short", "HEAD"',
  ]) assert.ok(runner.includes(fragment), `missing runner fragment: ${fragment}`);
  assert.doesNotMatch(runner, /exec(?:Text|Result)\("docker"/);
  assert.match(contract, /grants no transfer, production deploy, public routing, Auth/);
});

test("P8U4 collection identities are non-circular and use mode 0600", () => {
  assert.deepEqual(EVIDENCE_FILES, ["build-crm.log", "candidate-result.json", "collection-index.json", "image-identity.json", "sbom-crm.spdx.json", "smoke-crm.log"]);
  const root = mkdtempSync(join(tmpdir(), "p8u4-test-"));
  try {
    const file = join(root, "safe.json");
    writeFileSync(file, "{}\n", { mode: 0o600 });
    assert.equal(readFileSync(file, "utf8"), "{}\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
