import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertSafeMetadata,
  collectBuildRecords,
  collectMigrationInventory,
  collectRuntimeSettingInventory,
  parseJsonRejectingDuplicates,
  P8B2_TARGET_PLATFORM,
  RESULT_STATUSES,
  resolveEvidencePath,
  stableJson,
  validateValidationRecords,
  validateGitIdentity,
  validateCandidateRepositories,
  validateImageInspection,
  validateImageEvidence,
  validateReleaseControlIdentity,
} from "../scripts/p8-candidate-manifest.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const baseCommit = "1".repeat(40);
const candidateCommit = "2".repeat(40);
const releaseControlCommit = "4".repeat(40);

test("migration and runtime-setting inventories are deterministic and value-free", () => {
  const migrations = collectMigrationInventory(repoRoot);
  assert.equal(migrations.length, 76);
  assert.equal(migrations[0].name.slice(0, 3), "001");
  assert.equal(migrations.at(-1).name.slice(0, 3), "076");
  assert.equal(stableJson(migrations), stableJson(collectMigrationInventory(repoRoot)));

  const settings = collectRuntimeSettingInventory(repoRoot);
  assert.ok(settings.length > 0);
  assert.equal(stableJson(settings), stableJson(collectRuntimeSettingInventory(repoRoot)));
  for (const setting of settings) {
    assert.deepEqual(Object.keys(setting).sort(), ["name", "owner", "present_in_candidate_example"]);
    assert.match(setting.name, /^[A-Z][A-Z0-9_]*$/);
    assert.equal(setting.present_in_candidate_example, true);
  }
});

test("validation evidence is bound to the exact base and candidate commits", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-p8-validation-"));
  const evidenceRoot = join(root, ".evo-release-evidence");
  mkdirSync(evidenceRoot, { mode: 0o700 });
  const evidencePath = join(evidenceRoot, "validation.log");
  const command = "node --test tests/p8-candidate-manifest.test.mjs";
  writeFileSync(
    evidencePath,
    `base_commit=${baseCommit}\ncandidate_commit=${candidateCommit}\ncommand=${command}\nexit_code=0\nvalidation passed\n`,
    { mode: 0o600 },
  );
  const record = {
    base_commit: baseCommit,
    candidate_commit: candidateCommit,
    command,
    evidence_path: evidencePath,
    exit_code: 0,
    name: "candidate manifest tests",
    test_count: 4,
  };

  const validated = validateValidationRecords([record], { baseCommit, candidateCommit, repoRoot: root });
  assert.equal(validated[0].base_commit, baseCommit);
  assert.equal(validated[0].candidate_commit, candidateCommit);
  assert.match(validated[0].evidence_sha256, /^[0-9a-f]{64}$/);

  assert.throws(
    () => validateValidationRecords([{ ...record, candidate_commit: "3".repeat(40) }], { baseCommit, candidateCommit, repoRoot: root }),
    /does not match the requested base\/candidate commits/,
  );

  const externalPath = join(root, "external.log");
  writeFileSync(externalPath, readFileSync(evidencePath), { mode: 0o600 });
  assert.throws(
    () => validateValidationRecords([{ ...record, evidence_path: externalPath }], { baseCommit, candidateCommit, repoRoot: root }),
    /must be inside .evo-release-evidence/,
  );
});

test("lead-agent candidate tag without its retained build marker is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-p8-build-record-"));
  const buildDirectory = join(root, ".evo-release-evidence", "candidate");
  mkdirSync(buildDirectory, { recursive: true, mode: 0o700 });
  const header = `base_commit=${baseCommit}\ncandidate_commit=${candidateCommit}\nrelease_control_commit=${releaseControlCommit}\nexit_code=0\n`;
  writeFileSync(
    join(buildDirectory, "build-crm.log"),
    `${header}Image evo-crm:${candidateCommit}-linux-amd64 Built\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(buildDirectory, "build-inbox.log"),
    `${header}Image evo-inbox:${candidateCommit}-linux-amd64 Built\n`,
    { mode: 0o600 },
  );
  writeFileSync(join(buildDirectory, "build-lead-agent.log"), header, { mode: 0o600 });

  assert.throws(
    () => collectBuildRecords({ baseCommit, buildEvidenceDir: buildDirectory, candidateCommit, releaseControlCommit }),
    new RegExp(`build-lead-agent\\.log does not prove evo-lead-agent:${candidateCommit}-linux-amd64 was built`),
  );
});

test("failed build evidence cannot be relabelled as successful", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-p8-failed-build-"));
  const buildDirectory = join(root, ".evo-release-evidence", "candidate");
  mkdirSync(buildDirectory, { recursive: true, mode: 0o700 });
  for (const [name, tag] of [
    ["build-crm.log", "evo-crm"],
    ["build-inbox.log", "evo-inbox"],
    ["build-lead-agent.log", "evo-lead-agent"],
  ]) {
    writeFileSync(
      join(buildDirectory, name),
      `base_commit=${baseCommit}\ncandidate_commit=${candidateCommit}\nrelease_control_commit=${releaseControlCommit}\nexit_code=1\nImage ${tag}:${candidateCommit}-linux-amd64 Built\n`,
      { mode: 0o600 },
    );
  }
  assert.throws(
    () => collectBuildRecords({ baseCommit, buildEvidenceDir: buildDirectory, candidateCommit, releaseControlCommit }),
    /does not record exactly one successful build exit/,
  );
});

test("amd64 build entrypoint fails closed on stale tags and real build exits", () => {
  const script = readFileSync(join(repoRoot, "scripts/p8b2-build-amd64.sh"), "utf8");
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /docker context show/);
  assert.match(script, /docker image inspect "\$tag"/);
  assert.match(script, /refusing stale-image reuse/);
  assert.match(script, /docker buildx build --platform linux\/amd64 --load/);
  assert.match(script, /local status=\$\?/);
  assert.match(script, /if \[\[ "\$status" -ne 0 \]\]/);
  assert.ok(script.indexOf("printf 'exit_code=%s") < script.indexOf("printf 'Image %s Built"));
});

test("secret-like and personal metadata is rejected", () => {
  assert.throws(() => assertSafeMetadata("api_key=unsafe-example-value"), /prohibited sensitive data/);
  assert.throws(() => assertSafeMetadata("person@example.com"), /prohibited sensitive data/);
  assert.doesNotThrow(() => assertSafeMetadata({ name: "SAFE_SETTING", present: true }));
});

test("duplicate JSON keys are rejected after escape decoding", () => {
  assert.deepEqual(parseJsonRejectingDuplicates('{"safe":1}', "fixture"), { safe: 1 });
  assert.throws(
    () => parseJsonRejectingDuplicates('{"candidate_commit":"a","candidate_commit":"b"}', "fixture"),
    /duplicate key "candidate_commit"/,
  );
  assert.throws(
    () => parseJsonRejectingDuplicates('{"safe":1,"s\\u0061fe":2}', "fixture"),
    /duplicate key "safe"/,
  );
});

test("Git identity requires the candidate's real exact parent", () => {
  const gitRoot = mkdtempSync(join(tmpdir(), "evo-p8-git-"));
  execFileSync("git", ["-C", gitRoot, "init", "--quiet"]);
  execFileSync("git", ["-C", gitRoot, "config", "user.name", "P8 Test"]);
  execFileSync("git", ["-C", gitRoot, "config", "user.email", "p8-test@example.invalid"]);
  writeFileSync(join(gitRoot, "candidate.txt"), "base\n");
  execFileSync("git", ["-C", gitRoot, "add", "candidate.txt"]);
  execFileSync("git", ["-C", gitRoot, "commit", "--quiet", "-m", "base"]);
  const base = execFileSync("git", ["-C", gitRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  writeFileSync(join(gitRoot, "candidate.txt"), "candidate\n");
  execFileSync("git", ["-C", gitRoot, "commit", "--quiet", "-am", "candidate"]);
  const candidate = execFileSync("git", ["-C", gitRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  assert.doesNotThrow(() => validateGitIdentity(gitRoot, { baseCommit: base, candidateCommit: candidate }));
  assert.throws(
    () => validateGitIdentity(gitRoot, { baseCommit: candidate, candidateCommit: candidate }),
    /exact parent/,
  );
});

test("release-control identity requires its own clean exact checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-p8-control-git-"));
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  execFileSync("git", ["-C", root, "config", "user.email", "release-control@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Release Control"]);
  writeFileSync(join(root, "tool.txt"), "tool\n");
  execFileSync("git", ["-C", root, "add", "tool.txt"]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "tool"]);
  const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  assert.doesNotThrow(() => validateReleaseControlIdentity(root, commit));
  assert.throws(() => validateReleaseControlIdentity(root, "3".repeat(40)), /does not match tool HEAD/);
  writeFileSync(join(root, "dirty.txt"), "dirty\n");
  assert.throws(() => validateReleaseControlIdentity(root, commit), /must be clean/);
});

test("candidate source and release-control identities are independently bound", () => {
  const source = mkdtempSync(join(tmpdir(), "evo-p8-source-git-"));
  const control = mkdtempSync(join(tmpdir(), "evo-p8-control-pair-git-"));
  for (const root of [source, control]) {
    execFileSync("git", ["-C", root, "init", "--quiet"]);
    execFileSync("git", ["-C", root, "config", "user.email", "release-control@example.invalid"]);
    execFileSync("git", ["-C", root, "config", "user.name", "Release Control"]);
  }
  writeFileSync(join(source, "source.txt"), "base\n");
  execFileSync("git", ["-C", source, "add", "source.txt"]);
  execFileSync("git", ["-C", source, "commit", "--quiet", "-m", "base"]);
  const base = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  writeFileSync(join(source, "source.txt"), "candidate\n");
  execFileSync("git", ["-C", source, "commit", "--quiet", "-am", "candidate"]);
  const candidate = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  writeFileSync(join(control, "tool.txt"), "tool\n");
  execFileSync("git", ["-C", control, "add", "tool.txt"]);
  execFileSync("git", ["-C", control, "commit", "--quiet", "-m", "tool"]);
  const releaseControl = execFileSync("git", ["-C", control, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  assert.doesNotThrow(() => validateCandidateRepositories({
    baseCommit: base,
    candidateCommit: candidate,
    releaseControlCommit: releaseControl,
    sourceRoot: source,
    toolRoot: control,
  }));
  assert.throws(
    () => validateCandidateRepositories({ baseCommit: base, candidateCommit: candidate, releaseControlCommit: candidate, sourceRoot: source, toolRoot: control }),
    /does not match tool HEAD/,
  );
});

test("evidence input and output paths reject symlink escapes", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-p8-symlink-"));
  const evidenceRoot = join(root, ".evo-release-evidence");
  const external = mkdtempSync(join(tmpdir(), "evo-p8-external-"));
  mkdirSync(evidenceRoot, { mode: 0o700 });
  writeFileSync(join(external, "external.log"), "outside\n", { mode: 0o600 });
  symlinkSync(join(external, "external.log"), join(evidenceRoot, "input.log"));
  symlinkSync(external, join(evidenceRoot, "output-parent"));

  assert.throws(
    () => resolveEvidencePath(root, join(evidenceRoot, "input.log"), "input"),
    /must not contain symlinks/,
  );
  assert.throws(
    () => resolveEvidencePath(root, join(evidenceRoot, "output-parent", "candidate"), "output"),
    /must not contain symlinks/,
  );
});

test("manifest schemas are closed and share the approved result vocabulary", () => {
  const manifestSchema = JSON.parse(readFileSync(join(repoRoot, "docs/schemas/p8-candidate-manifest.schema.json"), "utf8"));
  const imageSchema = JSON.parse(readFileSync(join(repoRoot, "docs/schemas/p8-image-identity.schema.json"), "utf8"));
  const indexSchema = JSON.parse(readFileSync(join(repoRoot, "docs/schemas/p8-evidence-index.schema.json"), "utf8"));
  assert.equal(manifestSchema.additionalProperties, false);
  assert.equal(imageSchema.additionalProperties, false);
  assert.equal(indexSchema.additionalProperties, false);
  assert.equal(manifestSchema.properties.schema_version.const, 2);
  assert.deepEqual(manifestSchema.properties.target_platform.properties, {
    architecture: { const: "amd64" },
    os: { const: "linux" },
    variant: { const: "" },
  });
  assert.deepEqual(indexSchema.$defs.result.properties.status.enum, RESULT_STATUSES);
  assert.ok(manifestSchema.required.includes("images"));
  assert.ok(manifestSchema.required.includes("runtime_settings"));
  assert.ok(indexSchema.properties.segments.required.includes("runtime_setting_inventory"));
});

test("image identity accepts only the exact linux amd64 target", () => {
  const tag = `evo-crm:${candidateCommit}-linux-amd64`;
  const inspected = {
    Architecture: "amd64",
    Config: {
      Labels: {
        "org.opencontainers.image.revision": candidateCommit,
        "org.opencontainers.image.source": "https://github.com/izzhackt/evo_AI_CRM",
        "org.opencontainers.image.version": "p8b2",
      },
    },
    Id: `sha256:${"a".repeat(64)}`,
    Os: "linux",
    Variant: "",
  };

  const identity = validateImageInspection(inspected, { candidateCommit, tag });
  assert.deepEqual(identity.platform, P8B2_TARGET_PLATFORM);
  assert.throws(
    () => validateImageInspection({ ...inspected, Architecture: "arm64" }, { candidateCommit, tag }),
    /platform must be exactly linux\/amd64 with no variant/,
  );
  assert.throws(
    () => validateImageInspection({ ...inspected, Os: "windows" }, { candidateCommit, tag }),
    /platform must be exactly linux\/amd64 with no variant/,
  );
  assert.throws(
    () => validateImageInspection({ ...inspected, Variant: "v2" }, { candidateCommit, tag }),
    /platform must be exactly linux\/amd64 with no variant/,
  );
});

test("image evidence is closed and rejects platform drift", () => {
  const specs = [
    ["main_crm", "evo-crm", "build-crm.log", "a"],
    ["evo_inbox", "evo-inbox", "build-inbox.log", "b"],
    ["lead_agent", "evo-lead-agent", "build-lead-agent.log", "c"],
  ];
  const buildRecords = specs.map(([name, prefix, log], index) => ({
    base_commit: baseCommit,
    candidate_commit: candidateCommit,
    image_name: name,
    image_tag: `${prefix}:${candidateCommit}-linux-amd64`,
    log_name: log,
    log_sha256: `${index + 1}`.repeat(64),
    release_control_commit: releaseControlCommit,
    result_marker: `Image ${prefix}:${candidateCommit}-linux-amd64 Built`,
  }));
  const images = specs.map(([name, , , digest], index) => ({
    build_record: buildRecords[index],
    digest: `sha256:${digest.repeat(64)}`,
    name,
    platform: P8B2_TARGET_PLATFORM,
    revision: candidateCommit,
    source: "https://github.com/izzhackt/evo_AI_CRM",
    tag: buildRecords[index].image_tag,
    version: "p8b2",
  }));
  const evidence = {
    base_commit: baseCommit,
    build_records: buildRecords,
    candidate_commit: candidateCommit,
    images,
    release_control_commit: releaseControlCommit,
  };

  assert.equal(validateImageEvidence(evidence), evidence);
  assert.throws(() => validateImageEvidence({ ...evidence, unexpected: true }), /must contain exactly/);
  assert.throws(
    () => validateImageEvidence({ ...evidence, images: [{ ...images[0], platform: { ...P8B2_TARGET_PLATFORM, architecture: "arm64" } }, ...images.slice(1)] }),
    /platform must be exactly linux\/amd64 with no variant/,
  );
  assert.throws(
    () => validateImageEvidence({ ...evidence, build_records: [buildRecords[0], buildRecords[0], buildRecords[2]] }),
    /not bound to its exact source image|distinct tags and logs/,
  );
  assert.throws(
    () => validateImageEvidence({ ...evidence, images: [images[0], { ...images[1], build_record: buildRecords[0] }, images[2]] }),
    /not bound one-to-one/,
  );
  assert.throws(
    () => validateImageEvidence({ ...evidence, images: [images[0], { ...images[1], digest: images[0].digest }, images[2]] }),
    /distinct immutable IDs/,
  );
});
