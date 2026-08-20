import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  P8D4B,
  expectedVersions,
  normalizeMigrationLedger,
  parseDryRunOutput,
  runP8D4BMigrations,
} from "../scripts/p8d4b-supabase-migrations.mjs";

const repoRoot = process.cwd();
const cliPath = join(repoRoot, "node_modules", ".bin", "supabase");
const testCandidateRoot = mkdtempSync(join(tmpdir(), "evo-p8d4b-candidate-"));
const testCandidateMigrations = join(testCandidateRoot, "supabase", "migrations");
mkdirSync(testCandidateMigrations, { recursive: true });
for (const migration of readdirSync(join(repoRoot, "supabase", "migrations"))
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name) && Number.parseInt(name.slice(0, 3), 10) <= Number.parseInt(P8D4B.expectedAfter, 10))
  .sort()) {
  cpSync(
    join(repoRoot, "supabase", "migrations", migration),
    join(testCandidateMigrations, migration),
  );
}
const schema = JSON.parse(readFileSync(new URL("../docs/schemas/p8d4b-migration-result.schema.json", import.meta.url), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test.after(() => rmSync(testCandidateRoot, { recursive: true, force: true }));

function ledger(last) {
  return expectedVersions(last).map((version) => ({ version, name: `migration_${version}` }));
}

test("historical migration normalization remains closed unless a later boundary is explicit", () => {
  assert.throws(() => normalizeMigrationLedger(ledger("077")), /001-072 or 001-076/);
  assert.deepEqual(normalizeMigrationLedger(ledger("077"), ["077"]), expectedVersions("077"));
  assert.throws(() => normalizeMigrationLedger(ledger("077"), []), /accepted migration boundaries/);
  assert.throws(() => normalizeMigrationLedger(ledger("077"), ["077", "077"]), /accepted migration boundaries/);
});

function createHarness({ cleanupFails = false, dryRunNames = P8D4B.migrationFiles.map((item) => item.name) } = {}) {
  let remoteLast = "072";
  const calls = [];
  const runCommand = (label, command, args, options = {}) => {
    calls.push({ kind: "command", label, command, args });
    if (label === "git-head") return { stdout: `${P8D4B.candidateCommit}\n`, stderr: "" };
    if (label === "git-status") return { stdout: "", stderr: "" };
    if (label === "supabase-version") return { stdout: `${P8D4B.cliVersion}\n`, stderr: "" };
    if (label === "supabase-link") {
      const tempRoot = join(options.cwd, "supabase", ".temp");
      mkdirSync(tempRoot, { recursive: true });
      writeFileSync(join(tempRoot, "project-ref"), `${P8D4B.projectRef}\n`, { mode: 0o600 });
      return { stdout: "Finished supabase link.\n", stderr: "Initialising login role...\n" };
    }
    if (label === "supabase-dry-run") {
      return {
        stdout: "Finished supabase db push.\n",
        stderr: `DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n${dryRunNames.map((name) => ` • ${name}`).join("\n")}\n`,
      };
    }
    if (label === "supabase-apply") {
      remoteLast = "076";
      return { stdout: "Finished supabase db push.\n", stderr: "" };
    }
    throw new Error(`unexpected command ${label}`);
  };
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ kind: "fetch", method: init.method ?? "GET", path: parsed.pathname });
    if (parsed.pathname.endsWith("/database/migrations") && (init.method ?? "GET") === "GET") {
      return Response.json(ledger(remoteLast), { status: 200 });
    }
    if (parsed.pathname.endsWith("/database/query/read-only") && init.method === "POST") {
      const versions = expectedVersions(remoteLast);
      return Response.json([{
        migration_count: versions.length,
        first_version: "001",
        last_version: remoteLast,
      }], { status: 201 });
    }
    if (parsed.pathname.endsWith("/cli/login-role") && init.method === "DELETE") {
      return Response.json(cleanupFails ? { message: "failed" } : { message: "ok" }, { status: cleanupFails ? 500 : 200 });
    }
    throw new Error(`unexpected fetch ${init.method ?? "GET"} ${parsed.pathname}`);
  };
  return { calls, fetchImpl, runCommand };
}

function evidenceOutput() {
  const root = mkdtempSync(join(tmpdir(), "evo-p8d4b-"));
  chmodSync(root, 0o700);
  return { root, output: join(root, "migration-result.json") };
}

const baseOptions = {
  sourceRoot: testCandidateRoot,
  cliPath,
  accessToken: `sbp_${"a".repeat(40)}`,
  environment: {},
  now: () => new Date("2026-08-16T00:00:00.000Z"),
};

test("normalizes only exact contiguous production ledger boundaries", () => {
  assert.deepEqual(normalizeMigrationLedger(ledger("072")), expectedVersions("072"));
  assert.deepEqual(normalizeMigrationLedger(ledger("076")), expectedVersions("076"));
  assert.throws(() => normalizeMigrationLedger([...ledger("072"), { version: "20260816010101", name: "bad" }]), /invalid version/);
  assert.throws(() => normalizeMigrationLedger([...ledger("071"), { version: "073", name: "gap" }]), /not exact contiguous/);
  assert.throws(() => normalizeMigrationLedger([...ledger("072"), { version: "072", name: "duplicate" }]), /duplicate/);
});

test("parses the exact dry-run list and rejects roles or seeds", () => {
  const names = P8D4B.migrationFiles.map((item) => item.name);
  const stderr = `DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n${names.map((name) => ` • ${name}`).join("\n")}`;
  assert.deepEqual(parseDryRunOutput("", stderr), names);
  assert.throws(() => parseDryRunOutput("", `${stderr}\nWould seed these files:`), /unapproved/);
  assert.throws(() => parseDryRunOutput("", "Would push these migrations:"), /marker/);
});

test("real read-only preflight writes closed mode-0600 evidence and creates no login role", async () => {
  const harness = createHarness();
  const target = evidenceOutput();
  try {
    const result = await runP8D4BMigrations({
      ...baseOptions,
      mode: "preflight",
      outputPath: target.output,
      fetchImpl: harness.fetchImpl,
      runCommand: harness.runCommand,
    });
    assert.equal(result.result_code, "preflight_verified");
    assert.equal(validateSchema(result), true, JSON.stringify(validateSchema.errors));
    assert.equal(statSync(target.output).mode & 0o777, 0o600);
    assert.equal(harness.calls.some((call) => call.label?.startsWith("supabase-" ) && call.label !== "supabase-version"), false);
    assert.equal(harness.calls.some((call) => call.method === "DELETE"), false);
  } finally {
    rmSync(target.root, { recursive: true, force: true });
  }
});

test("apply uses linked dry-run, exact suffix, post-ledger verification, and cleanup", async () => {
  const harness = createHarness();
  const target = evidenceOutput();
  try {
    const result = await runP8D4BMigrations({
      ...baseOptions,
      mode: "apply",
      confirmation: P8D4B.applyConfirmation,
      outputPath: target.output,
      fetchImpl: harness.fetchImpl,
      runCommand: harness.runCommand,
    });
    assert.equal(result.result_code, "applied_verified");
    assert.equal(result.ledger_before.last_version, "072");
    assert.equal(result.ledger_after.last_version, "076");
    assert.equal(result.temporary_login_role.cleanup_status, "verified");
    assert.equal(validateSchema(result), true, JSON.stringify(validateSchema.errors));
    assert.deepEqual(
      harness.calls.filter((call) => call.kind === "command").map((call) => call.label),
      ["git-head", "git-status", "supabase-version", "supabase-link", "supabase-dry-run", "supabase-apply"],
    );
    assert.equal(harness.calls.filter((call) => call.method === "DELETE").length, 1);
  } finally {
    rmSync(target.root, { recursive: true, force: true });
  }
});

test("dry-run drift fails before apply but still revokes the temporary roles", async () => {
  const harness = createHarness({ dryRunNames: [P8D4B.migrationFiles[0].name] });
  const target = evidenceOutput();
  try {
    await assert.rejects(
      runP8D4BMigrations({
        ...baseOptions,
        mode: "apply",
        confirmation: P8D4B.applyConfirmation,
        outputPath: target.output,
        fetchImpl: harness.fetchImpl,
        runCommand: harness.runCommand,
      }),
      /dry-run does not match/,
    );
    assert.equal(harness.calls.some((call) => call.label === "supabase-apply"), false);
    assert.equal(harness.calls.filter((call) => call.method === "DELETE").length, 1);
    const evidence = JSON.parse(readFileSync(target.output, "utf8"));
    assert.equal(evidence.result_code, "operation_failed");
    assert.equal(evidence.temporary_login_role.creation_attempted, true);
    assert.equal(evidence.temporary_login_role.cleanup_status, "verified");
    assert.equal(validateSchema(evidence), true, JSON.stringify(validateSchema.errors));
  } finally {
    rmSync(target.root, { recursive: true, force: true });
  }
});

test("password-like environment variables fail closed before linked CLI mutation", async () => {
  const harness = createHarness();
  const target = evidenceOutput();
  try {
    await assert.rejects(
      runP8D4BMigrations({
        ...baseOptions,
        mode: "apply",
        confirmation: P8D4B.applyConfirmation,
        environment: { SUPABASE_DB_PASSWORD: "must-not-be-used" },
        outputPath: target.output,
        fetchImpl: harness.fetchImpl,
        runCommand: harness.runCommand,
      }),
      /SUPABASE_DB_PASSWORD must be absent/,
    );
    assert.equal(harness.calls.some((call) => call.label === "supabase-link"), false);
  } finally {
    rmSync(target.root, { recursive: true, force: true });
  }
});

test("cleanup failure produces truthful blocking evidence", async () => {
  const harness = createHarness({ cleanupFails: true });
  const target = evidenceOutput();
  try {
    await assert.rejects(
      runP8D4BMigrations({
        ...baseOptions,
        mode: "apply",
        confirmation: P8D4B.applyConfirmation,
        outputPath: target.output,
        fetchImpl: harness.fetchImpl,
        runCommand: harness.runCommand,
      }),
      /cleanup failed/,
    );
    const evidence = JSON.parse(readFileSync(target.output, "utf8"));
    assert.equal(evidence.result_code, "cleanup_failed");
    assert.equal(evidence.temporary_login_role.creation_attempted, true);
    assert.equal(evidence.temporary_login_role.cleanup_status, "failed");
    assert.equal(validateSchema(evidence), true, JSON.stringify(validateSchema.errors));
  } finally {
    rmSync(target.root, { recursive: true, force: true });
  }
});

test("local Supabase temp cleanup failure produces blocking evidence", async () => {
  const harness = createHarness();
  const target = evidenceOutput();
  try {
    await assert.rejects(
      runP8D4BMigrations({
        ...baseOptions,
        mode: "apply",
        confirmation: P8D4B.applyConfirmation,
        outputPath: target.output,
        fetchImpl: harness.fetchImpl,
        runCommand: harness.runCommand,
        cleanupTempRoot: () => {
          throw new Error("simulated local temp cleanup failure");
        },
      }),
      /simulated local temp cleanup failure/,
    );
    const evidence = JSON.parse(readFileSync(target.output, "utf8"));
    assert.equal(evidence.result_code, "operation_failed");
    assert.equal(evidence.local_temp_cleanup_status, "failed");
    assert.equal(evidence.temporary_login_role.cleanup_status, "verified");
    assert.equal(validateSchema(evidence), true, JSON.stringify(validateSchema.errors));
  } finally {
    rmSync(join(testCandidateRoot, "supabase", ".temp"), { recursive: true, force: true });
    rmSync(target.root, { recursive: true, force: true });
  }
});

test("schema rejects false success and secret-shaped extra fields", () => {
  const harness = createHarness();
  assert.ok(harness);
  const invalid = {
    schema_version: "p8d4b-v1",
    result_code: "applied_verified",
    mode: "apply",
    project_ref: P8D4B.projectRef,
    candidate_commit: P8D4B.candidateCommit,
    cli_version: P8D4B.cliVersion,
    observed_at: "2026-08-16T00:00:00.000Z",
    migration_files: P8D4B.migrationFiles,
    ledger_before: { count: 72, first_version: "001", last_version: "072", versions_sha256: "a".repeat(64) },
    ledger_after: null,
    missing_migrations: P8D4B.migrationFiles.map((item) => item.name),
    dry_run_status: "verified",
    apply_status: "verified",
    local_temp_cleanup_status: "verified",
    temporary_login_role: { creation_attempted: true, cleanup_status: "verified" },
    access_token: "forbidden",
  };
  assert.equal(validateSchema(invalid), false);
});
