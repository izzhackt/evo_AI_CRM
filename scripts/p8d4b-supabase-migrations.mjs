#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export const P8D4B = Object.freeze({
  projectRef: "iosckaqtovbbnssqcpde",
  candidateCommit: "d5657acc6c1df1abc790a96778ca71df36687b24",
  cliVersion: "2.110.0",
  expectedBefore: "072",
  expectedAfter: "076",
  applyConfirmation: "APPLY-073-076-TO-IOSCKAQTOVBBNSSQCPDE",
  migrationFiles: Object.freeze([
    Object.freeze({
      version: "073",
      name: "073_ai_knowledge_audience_isolation.sql",
      sha256: "c1f71b00b7402e28581e1d1223910450b1f973c1c18c56b9e3cdb9e33e17abb3",
    }),
    Object.freeze({
      version: "074",
      name: "074_ai_knowledge_managed_bundle_sync.sql",
      sha256: "f161b995a7bd71c432a032814d7ae01fdba644b0ba19c180000135b7d759091b",
    }),
    Object.freeze({
      version: "075",
      name: "075_ai_assistant_immutable_audits.sql",
      sha256: "303bc08a1a685e5e8ad0d3acb9492fd2f65e8895c55ca87af218a7e3b897b6cd",
    }),
    Object.freeze({
      version: "076",
      name: "076_platform_consultative_sales_memory.sql",
      sha256: "497ea2bf3b0ea3d8b6b0a28aef82889170a19dcdbbf0cd9abeb2fe5b37c735fa",
    }),
  ]),
});

const MANAGEMENT_ORIGIN = "https://api.supabase.com";
const MAX_RESPONSE_BYTES = 1_048_576;
const HTTP_TIMEOUT_MS = 15_000;
const CLI_TIMEOUT_MS = 300_000;
const PASSWORD_ENV_NAMES = Object.freeze([
  "DB_PASSWORD",
  "DIRECT_URL",
  "EVO_PLATFORM_DB_PASSWORD",
  "EVO_PLATFORM_DB_URL",
  "PGPASSWORD",
  "POSTGRES_PASSWORD",
  "SUPABASE_DB_PASSWORD",
]);
const RESULT_CODES = new Set([
  "already_complete",
  "applied_verified",
  "cleanup_failed",
  "operation_failed",
  "preflight_verified",
]);
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const VERSION_PATTERN = /^\d{3}$/;

function fail(message, code = "blocked") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} has unexpected keys`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function ensureInside(root, target, label) {
  const relative = target.slice(root.length);
  if (target !== root && (!target.startsWith(`${root}${sep}`) || relative.includes(`..${sep}`))) {
    fail(`${label} escapes its approved root`);
  }
}

function requireDirectory(path, label) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) fail(`${label} must be a non-symlink directory`);
  return realpathSync(path);
}

function requireRegularFile(path, label) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
  return path;
}

function requireResolvedRegularFile(path, label) {
  const resolved = realpathSync(path);
  const info = statSync(resolved);
  if (!info.isFile()) fail(`${label} must resolve to a regular file`);
  return resolved;
}

export function expectedVersions(last = P8D4B.expectedAfter) {
  const numeric = Number(last);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 999) fail("invalid expected migration boundary");
  return Array.from({ length: numeric }, (_, index) => String(index + 1).padStart(3, "0"));
}

export function normalizeMigrationLedger(
  payload,
  acceptedLastVersions = [P8D4B.expectedBefore, P8D4B.expectedAfter],
) {
  if (
    !Array.isArray(acceptedLastVersions)
    || acceptedLastVersions.length === 0
    || new Set(acceptedLastVersions).size !== acceptedLastVersions.length
    || acceptedLastVersions.some((version) => typeof version !== "string" || !VERSION_PATTERN.test(version))
  ) fail("accepted migration boundaries are invalid");
  if (!Array.isArray(payload)) fail("migration ledger must be an array");
  const versions = payload.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail(`migration ledger row ${index + 1} must be an object`);
    const keys = Object.keys(row);
    if (!keys.includes("version") || keys.some((key) => !["name", "version"].includes(key))) {
      fail(`migration ledger row ${index + 1} has unexpected keys`);
    }
    if (typeof row.version !== "string" || !VERSION_PATTERN.test(row.version)) fail(`migration ledger row ${index + 1} has invalid version`);
    if (row.name !== undefined && typeof row.name !== "string") fail(`migration ledger row ${index + 1} has invalid name`);
    return row.version;
  });
  if (new Set(versions).size !== versions.length) fail("migration ledger contains duplicate versions");
  const sorted = [...versions].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(versions)) fail("migration ledger is not ordered");
  const acceptable = acceptedLastVersions.map(expectedVersions);
  if (!acceptable.some((candidate) => JSON.stringify(candidate) === JSON.stringify(versions))) {
    fail(`migration ledger is not exact contiguous ${acceptedLastVersions.map((version) => `001-${version}`).join(" or ")}`);
  }
  return versions;
}

export function summarizeLedger(versions) {
  return Object.freeze({
    count: versions.length,
    first_version: versions[0],
    last_version: versions.at(-1),
    versions_sha256: sha256(Buffer.from(`${versions.join("\n")}\n`, "utf8")),
  });
}

export function missingMigrationFiles(versions) {
  if (versions.at(-1) === P8D4B.expectedAfter) return [];
  if (versions.at(-1) !== P8D4B.expectedBefore) fail("remote ledger does not end at an approved boundary");
  return P8D4B.migrationFiles.map((migration) => migration.name);
}

export function parseDryRunOutput(stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  if (!combined.includes("DRY RUN: migrations will *not* be pushed to the database.")) fail("Supabase dry-run marker is missing");
  if (!combined.includes("Would push these migrations:")) fail("Supabase dry-run migration list is missing");
  if (/Would create custom roles|Would seed these files/i.test(combined)) fail("Supabase dry-run attempted an unapproved roles or seed operation");
  const names = [...combined.matchAll(/\b(\d{3}_[a-z0-9_]+\.sql)\b/g)].map((match) => match[1]);
  return [...new Set(names)];
}

export function inspectCandidate({ sourceRoot, cliPath, runCommand }) {
  if (!isAbsolute(sourceRoot) || !isAbsolute(cliPath)) fail("candidate and CLI paths must be absolute");
  const canonicalRoot = requireDirectory(sourceRoot, "candidate source root");
  const canonicalCli = requireResolvedRegularFile(cliPath, "Supabase CLI");
  const head = runCommand("git-head", "git", ["-C", canonicalRoot, "rev-parse", "HEAD"], { cwd: canonicalRoot }).stdout.trim();
  if (head !== P8D4B.candidateCommit) fail("candidate source commit mismatch");
  const status = runCommand("git-status", "git", ["-C", canonicalRoot, "status", "--porcelain", "--untracked-files=all"], { cwd: canonicalRoot }).stdout.trim();
  if (status !== "") fail("candidate source worktree is dirty");
  const version = runCommand("supabase-version", canonicalCli, ["--version"], { cwd: canonicalRoot }).stdout.trim();
  if (version !== P8D4B.cliVersion) fail("Supabase CLI version mismatch");
  const migrationsRoot = realpathSync(requireDirectory(join(canonicalRoot, "supabase", "migrations"), "candidate migrations directory"));
  ensureInside(canonicalRoot, migrationsRoot, "candidate migrations directory");
  const migrationNames = readdirSync(migrationsRoot)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const versions = migrationNames.map((name) => name.match(/^(\d{3})_[a-z0-9_]+\.sql$/)?.[1]);
  if (versions.some((version) => !version) || JSON.stringify(versions) !== JSON.stringify(expectedVersions())) {
    fail("candidate migration files are not exact contiguous 001-076");
  }
  const files = P8D4B.migrationFiles.map((expected) => {
    const path = requireRegularFile(join(migrationsRoot, expected.name), `migration ${expected.version}`);
    const actualHash = sha256(readFileSync(path));
    if (actualHash !== expected.sha256) fail(`migration ${expected.version} SHA-256 mismatch`);
    return { ...expected };
  });
  return { sourceRoot: canonicalRoot, cliPath: canonicalCli, files };
}

export function defaultRunCommand(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 2_000_000,
    timeout: options.timeout ?? CLI_TIMEOUT_MS,
  });
  if (result.error) fail(`${label} failed to start`);
  if (result.signal || result.status !== 0) fail(`${label} failed with exit status ${result.status ?? "signal"}`);
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function boundedJson(response, label) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) fail(`${label} response exceeds the byte limit`);
  if (bytes.length === 0) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label} returned malformed JSON`);
  }
}

export function createManagementClient({ accessToken, fetchImpl = fetch }) {
  if (typeof accessToken !== "string" || !/^sbp_[A-Za-z0-9_-]{20,}$/.test(accessToken)) fail("SUPABASE_ACCESS_TOKEN is missing or malformed");
  return async function request(path, { method = "GET", body, expectedStatus }) {
    if (!path.startsWith(`/v1/projects/${P8D4B.projectRef}/`) && path !== `/v1/projects/${P8D4B.projectRef}`) {
      fail("Management API path is outside the approved project");
    }
    const response = await fetchImpl(`${MANAGEMENT_ORIGIN}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const payload = await boundedJson(response, `${method} ${path}`);
    if (response.status !== expectedStatus) fail(`${method} ${path} returned HTTP ${response.status}`);
    return payload;
  };
}

async function readRemoteLedger(request) {
  const rows = await request(`/v1/projects/${P8D4B.projectRef}/database/migrations`, { expectedStatus: 200 });
  const versions = normalizeMigrationLedger(rows);
  const summaryRows = await request(`/v1/projects/${P8D4B.projectRef}/database/query/read-only`, {
    method: "POST",
    body: {
      query: "select count(*)::int as migration_count, min(version)::text as first_version, max(version)::text as last_version from supabase_migrations.schema_migrations",
    },
    expectedStatus: 201,
  });
  if (!Array.isArray(summaryRows) || summaryRows.length !== 1) fail("read-only migration summary has an invalid row count");
  exactKeys(summaryRows[0], ["first_version", "last_version", "migration_count"], "read-only migration summary");
  const summary = summarizeLedger(versions);
  if (
    Number(summaryRows[0].migration_count) !== summary.count ||
    summaryRows[0].first_version !== summary.first_version ||
    summaryRows[0].last_version !== summary.last_version
  ) {
    fail("Management API ledger and read-only SQL summary disagree");
  }
  return { versions, summary };
}

function safeChildEnv(accessToken, environment) {
  for (const key of PASSWORD_ENV_NAMES) {
    if (typeof environment[key] === "string" && environment[key] !== "") fail(`${key} must be absent for the PAT-only migration path`);
  }
  const child = { ...environment, SUPABASE_ACCESS_TOKEN: accessToken };
  for (const key of PASSWORD_ENV_NAMES) delete child[key];
  return child;
}

function makeEvidence({ mode, resultCode, observedAt, files, before, after, missing, dryRunStatus, applyStatus, temporaryRoleCreationAttempted, cleanupStatus, localTempCleanupStatus }) {
  const evidence = {
    schema_version: "p8d4b-v1",
    result_code: resultCode,
    mode,
    project_ref: P8D4B.projectRef,
    candidate_commit: P8D4B.candidateCommit,
    cli_version: P8D4B.cliVersion,
    observed_at: observedAt,
    migration_files: files,
    ledger_before: before,
    ledger_after: after,
    missing_migrations: missing,
    dry_run_status: dryRunStatus,
    apply_status: applyStatus,
    local_temp_cleanup_status: localTempCleanupStatus,
    temporary_login_role: {
      creation_attempted: temporaryRoleCreationAttempted,
      cleanup_status: cleanupStatus,
    },
  };
  validateEvidenceInvariants(evidence);
  return evidence;
}

export function validateEvidenceInvariants(evidence) {
  exactKeys(evidence, [
    "apply_status", "candidate_commit", "cli_version", "dry_run_status", "ledger_after",
    "ledger_before", "migration_files", "missing_migrations", "mode", "observed_at",
    "local_temp_cleanup_status", "project_ref", "result_code", "schema_version", "temporary_login_role",
  ], "migration evidence");
  if (!RESULT_CODES.has(evidence.result_code)) fail("migration evidence has invalid result code");
  if (!UTC_PATTERN.test(evidence.observed_at) || Number.isNaN(Date.parse(evidence.observed_at))) fail("migration evidence timestamp is invalid");
  if (JSON.stringify(evidence.migration_files) !== JSON.stringify(P8D4B.migrationFiles)) fail("migration evidence files mismatch");
  const missing = evidence.missing_migrations;
  if (!Array.isArray(missing) || ![0, 4].includes(missing.length)) fail("migration evidence has invalid missing migrations");
  if (missing.length === 4 && JSON.stringify(missing) !== JSON.stringify(P8D4B.migrationFiles.map((item) => item.name))) fail("migration evidence missing sequence mismatch");
  if (evidence.result_code === "preflight_verified") {
    if (evidence.mode !== "preflight" || evidence.ledger_before.last_version !== "072" || evidence.ledger_after !== null || missing.length !== 4) fail("invalid preflight evidence");
    if (evidence.dry_run_status !== "not_run" || evidence.apply_status !== "not_run" || evidence.local_temp_cleanup_status !== "not_required" || evidence.temporary_login_role.creation_attempted || evidence.temporary_login_role.cleanup_status !== "not_required") fail("preflight evidence records an external mutation");
  } else if (evidence.result_code === "already_complete") {
    if (evidence.ledger_before.last_version !== "076" || evidence.ledger_after.last_version !== "076" || missing.length !== 0) fail("invalid already-complete evidence");
    if (evidence.dry_run_status !== "not_run" || evidence.apply_status !== "not_run" || evidence.local_temp_cleanup_status !== "not_required" || evidence.temporary_login_role.creation_attempted || evidence.temporary_login_role.cleanup_status !== "not_required") fail("already-complete evidence records an external mutation");
  } else if (evidence.result_code === "applied_verified") {
    if (evidence.mode !== "apply" || evidence.ledger_before.last_version !== "072" || evidence.ledger_after.last_version !== "076" || missing.length !== 4) fail("invalid applied evidence ledger");
    if (evidence.dry_run_status !== "verified" || evidence.apply_status !== "verified" || evidence.local_temp_cleanup_status !== "verified" || !evidence.temporary_login_role.creation_attempted || evidence.temporary_login_role.cleanup_status !== "verified") fail("invalid applied evidence phases");
  } else if (evidence.result_code === "operation_failed") {
    if (evidence.mode !== "apply" || evidence.ledger_before.last_version !== "072" || missing.length !== 4) fail("invalid operation-failed evidence ledger");
    if (!["failed", "verified"].includes(evidence.local_temp_cleanup_status) || !evidence.temporary_login_role.creation_attempted || evidence.temporary_login_role.cleanup_status !== "verified") fail("invalid operation-failed cleanup evidence");
    if (evidence.apply_status === "verified" && evidence.ledger_after?.last_version === "076" && evidence.local_temp_cleanup_status !== "failed") {
      fail("operation-failed evidence cannot describe completed migration application without a local cleanup failure");
    }
  } else if (evidence.result_code === "cleanup_failed") {
    if (evidence.mode !== "apply" || !evidence.temporary_login_role.creation_attempted || evidence.temporary_login_role.cleanup_status !== "failed") fail("invalid cleanup-failed evidence");
  }
  return evidence;
}

function validateAgainstSchema(evidence) {
  const schemaPath = new URL("../docs/schemas/p8d4b-migration-result.schema.json", import.meta.url);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (!validate(evidence)) fail(`migration evidence schema validation failed: ${ajv.errorsText(validate.errors)}`);
}

function writeEvidence(outputPath, evidence) {
  if (!isAbsolute(outputPath)) fail("evidence output path must be absolute");
  if (existsSync(outputPath)) fail("evidence output path already exists");
  const parent = requireDirectory(dirname(outputPath), "evidence parent");
  const parentMode = statSync(parent).mode & 0o777;
  if (parentMode !== 0o700) fail("evidence parent must have mode 0700");
  const target = join(parent, basename(outputPath));
  ensureInside(parent, target, "evidence output");
  validateAgainstSchema(evidence);
  const temporary = `${target}.tmp-${process.pid}`;
  if (existsSync(temporary)) fail("temporary evidence path collision");
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, target);
}

export async function runP8D4BMigrations({
  mode,
  sourceRoot,
  cliPath,
  outputPath,
  confirmation,
  accessToken,
  environment = process.env,
  fetchImpl = fetch,
  runCommand = defaultRunCommand,
  cleanupTempRoot = (path) => rmSync(path, { recursive: true, force: false }),
  now = () => new Date(),
}) {
  if (!["apply", "preflight"].includes(mode)) fail("mode must be preflight or apply");
  if (mode === "apply" && confirmation !== P8D4B.applyConfirmation) fail("apply confirmation mismatch");
  const candidate = inspectCandidate({ sourceRoot, cliPath, runCommand });
  const request = createManagementClient({ accessToken, fetchImpl });
  const before = await readRemoteLedger(request);
  const missing = missingMigrationFiles(before.versions);
  const observedAt = now().toISOString();

  if (missing.length === 0) {
    const evidence = makeEvidence({
      mode,
      resultCode: "already_complete",
      observedAt,
      files: candidate.files,
      before: before.summary,
      after: before.summary,
      missing,
      dryRunStatus: "not_run",
      applyStatus: "not_run",
      temporaryRoleCreationAttempted: false,
      cleanupStatus: "not_required",
      localTempCleanupStatus: "not_required",
    });
    writeEvidence(outputPath, evidence);
    return evidence;
  }

  if (mode === "preflight") {
    const evidence = makeEvidence({
      mode,
      resultCode: "preflight_verified",
      observedAt,
      files: candidate.files,
      before: before.summary,
      after: null,
      missing,
      dryRunStatus: "not_run",
      applyStatus: "not_run",
      temporaryRoleCreationAttempted: false,
      cleanupStatus: "not_required",
      localTempCleanupStatus: "not_required",
    });
    writeEvidence(outputPath, evidence);
    return evidence;
  }

  const tempRoot = join(candidate.sourceRoot, "supabase", ".temp");
  if (existsSync(tempRoot)) fail("candidate Supabase .temp directory must be absent before apply");
  const childEnv = safeChildEnv(accessToken, environment);
  let temporaryRoleCreationAttempted = false;
  let dryRunStatus = "not_run";
  let applyStatus = "not_run";
  let after = null;
  let operationError = null;
  let cleanupStatus = "not_required";
  let localTempCleanupStatus = "not_required";
  try {
    temporaryRoleCreationAttempted = true;
    runCommand("supabase-link", candidate.cliPath, [
      "link", "--project-ref", P8D4B.projectRef, "--workdir", candidate.sourceRoot, "--yes",
    ], { cwd: candidate.sourceRoot, env: childEnv });
    const linkedRefPath = requireRegularFile(join(tempRoot, "project-ref"), "linked project reference");
    if (readFileSync(linkedRefPath, "utf8").trim() !== P8D4B.projectRef) fail("linked project reference mismatch");
    const dryRun = runCommand("supabase-dry-run", candidate.cliPath, [
      "db", "push", "--linked", "--dry-run", "--workdir", candidate.sourceRoot, "--yes",
    ], { cwd: candidate.sourceRoot, env: childEnv });
    const proposed = parseDryRunOutput(dryRun.stdout, dryRun.stderr);
    if (JSON.stringify(proposed) !== JSON.stringify(missing)) fail("Supabase dry-run does not match the approved missing suffix");
    dryRunStatus = "verified";
    runCommand("supabase-apply", candidate.cliPath, [
      "db", "push", "--linked", "--workdir", candidate.sourceRoot, "--yes",
    ], { cwd: candidate.sourceRoot, env: childEnv });
    applyStatus = "verified";
    after = await readRemoteLedger(request);
    if (after.versions.at(-1) !== P8D4B.expectedAfter) fail("post-apply migration ledger did not reach 076");
  } catch (error) {
    operationError = error;
  } finally {
    if (temporaryRoleCreationAttempted) {
      try {
        await request(`/v1/projects/${P8D4B.projectRef}/cli/login-role`, { method: "DELETE", expectedStatus: 200 });
        cleanupStatus = "verified";
      } catch (error) {
        cleanupStatus = "failed";
        if (!operationError) operationError = error;
      }
    }
    try {
      if (existsSync(tempRoot)) cleanupTempRoot(tempRoot);
      localTempCleanupStatus = "verified";
    } catch (error) {
      localTempCleanupStatus = "failed";
      if (!operationError) operationError = error;
    }
  }

  if (cleanupStatus === "failed") {
    const evidence = makeEvidence({
      mode,
      resultCode: "cleanup_failed",
      observedAt,
      files: candidate.files,
      before: before.summary,
      after: after?.summary ?? null,
      missing,
      dryRunStatus,
      applyStatus,
      temporaryRoleCreationAttempted,
      cleanupStatus,
      localTempCleanupStatus,
    });
    writeEvidence(outputPath, evidence);
    throw Object.assign(new Error("temporary CLI login-role cleanup failed; P8D4 is blocked"), { evidence });
  }
  if (operationError) {
    const evidence = makeEvidence({
      mode,
      resultCode: "operation_failed",
      observedAt,
      files: candidate.files,
      before: before.summary,
      after: after?.summary ?? null,
      missing,
      dryRunStatus,
      applyStatus,
      temporaryRoleCreationAttempted,
      cleanupStatus,
      localTempCleanupStatus,
    });
    writeEvidence(outputPath, evidence);
    throw Object.assign(operationError, { evidence });
  }

  const evidence = makeEvidence({
    mode,
    resultCode: "applied_verified",
    observedAt,
    files: candidate.files,
    before: before.summary,
    after: after.summary,
    missing,
    dryRunStatus,
    applyStatus,
    temporaryRoleCreationAttempted,
    cleanupStatus,
    localTempCleanupStatus,
  });
  writeEvidence(outputPath, evidence);
  return evidence;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("arguments must be --key value pairs");
    if (Object.hasOwn(values, key)) fail(`duplicate argument ${key}`);
    values[key] = value;
  }
  const allowed = new Set(["--cli", "--confirm", "--mode", "--output", "--source-root"]);
  if (Object.keys(values).some((key) => !allowed.has(key))) fail("unknown argument");
  for (const required of ["--cli", "--mode", "--output", "--source-root"]) {
    if (!values[required]) fail(`missing ${required}`);
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const evidence = await runP8D4BMigrations({
    mode: args["--mode"],
    sourceRoot: args["--source-root"],
    cliPath: args["--cli"],
    outputPath: args["--output"],
    confirmation: args["--confirm"],
    accessToken: process.env.SUPABASE_ACCESS_TOKEN,
  });
  process.stdout.write(`${JSON.stringify({ result_code: evidence.result_code })}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.code ?? "blocked"}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
