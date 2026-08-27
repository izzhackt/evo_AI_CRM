#!/usr/bin/env node

import {
  closeSync,
  constants as fsConstants,
  fchownSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { assertU11RecoveryResultContract } from "../src/lib/u11-recovery-result-contract.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const ALIAS = /^[a-z][a-z0-9-]{2,63}$/;
const PRODUCTION_ALIAS = /(?:^|-)(?:prod|production)(?:-|$)/;
const FORBIDDEN_KEY = /(?:secret|token|password|cookie|authorization|api_?key|provider_?payload|raw_?(?:sql|response|body))/i;
const FORBIDDEN_EVIDENCE_ROOTS = Object.freeze([
  "/",
  "/opt/evo-crm",
  "/opt/evo-inbox",
  "/var/lib/docker",
  "/var/lib/containerd",
  "/var/lib/containers",
  "/private/var/lib/docker",
  "/private/var/lib/containerd",
  "/private/var/lib/containers",
  "/run/docker",
  "/run/containerd",
]);
const MAX_CLI_INPUT_BYTES = 64 * 1024;
const MAX_OWNER_ID = 0xfffffffe;

const schema = JSON.parse(
  readFileSync(
    new URL("../docs/schemas/u11-recovery-result.schema.json", import.meta.url),
    "utf8",
  ),
);
const validateSchema = new Ajv2020({
  strict: false,
  formats: {
    "date-time": {
      type: "string",
      validate(value) {
        return (
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
          !Number.isNaN(Date.parse(value))
        );
      },
    },
  },
}).compile(schema);

const ENVIRONMENT_KEYS = Object.freeze([
  "source_alias",
  "source_identity_sha256",
  "destination_alias",
  "destination_identity_sha256",
  "production_identity_sha256",
]);
const EVALUATION_KEYS = Object.freeze([
  "observedAt",
  "environment",
  "executionStatus",
  "database",
  "storage",
  "smoke",
]);
const SMOKE_KEYS = Object.freeze([
  "restored_app",
  "admin_login",
  "same_organization_access",
  "cross_organization_denial",
  "private_storage_access",
  "blocked_integration_guard",
]);
const SUBJECT_KEYS = Object.freeze(["backup", "restore"]);
const BACKUP_KEYS = Object.freeze(["status", "artifact_sha256"]);
const RESTORE_KEYS = Object.freeze(["status", "verified_at"]);
const BACKUP_STATUSES = new Set(["not_run", "listed", "verified", "failed"]);
const RESTORE_STATUSES = new Set(["not_run", "verified", "failed"]);
const SMOKE_STATUSES = new Set(["not_run", "passed", "failed"]);
const DATABASE_SMOKE_KEYS = Object.freeze([
  "restored_app",
  "admin_login",
  "same_organization_access",
  "cross_organization_denial",
  "blocked_integration_guard",
]);
const STORAGE_SMOKE_KEYS = Object.freeze([
  "restored_app",
  "admin_login",
  "private_storage_access",
  "blocked_integration_guard",
]);

function fail(message) {
  const error = new Error(message);
  error.code = "u11_recovery_evidence_invalid";
  throw error;
}

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...expected].sort())
  ) {
    fail(`${label} must use the closed evidence shape`);
  }
}

function closedKeys(value, allowed, required, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must use the closed evidence shape`);
  }
  const keys = Object.keys(value);
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !keys.includes(key))
  ) {
    fail(`${label} must use the closed evidence shape`);
  }
}

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  );
}

function assertNotForbiddenEvidenceRoot(candidate) {
  if (
    candidate === "/" ||
    /\/Library\/Containers\/com\.docker\.docker(?:\/|$)/.test(candidate) ||
    FORBIDDEN_EVIDENCE_ROOTS.slice(1).some((forbidden) =>
      isWithin(forbidden, candidate),
    )
  ) {
    fail("allowed evidence root is forbidden");
  }
}

function resolveAllowedEvidenceRoot(allowedRoot) {
  if (
    typeof allowedRoot !== "string" ||
    allowedRoot.trim() === "" ||
    !isAbsolute(allowedRoot)
  ) {
    fail("an explicit absolute allowed evidence root is required");
  }
  const absolute = resolve(allowedRoot);
  assertNotForbiddenEvidenceRoot(absolute);
  let canonical;
  try {
    canonical = realpathSync(absolute);
  } catch {
    fail("allowed evidence root must already exist");
  }
  if (canonical !== absolute) fail("allowed evidence root cannot be symlinked");
  if (!statSync(canonical).isDirectory()) {
    fail("allowed evidence root must be a directory");
  }
  assertNotForbiddenEvidenceRoot(canonical);
  return canonical;
}

function resolveAllowedOutputPath(allowedRoot, outputPath) {
  if (
    typeof outputPath !== "string" ||
    outputPath.trim() === "" ||
    !isAbsolute(outputPath)
  ) {
    fail("an explicit absolute output path is required");
  }
  const absolute = resolve(outputPath);
  const parent = dirname(absolute);
  let canonicalParent;
  try {
    canonicalParent = realpathSync(parent);
  } catch {
    fail("output parent must already exist");
  }
  if (canonicalParent !== parent) fail("output parent cannot be symlinked");
  if (!statSync(canonicalParent).isDirectory()) {
    fail("output parent must be a directory");
  }
  if (!isWithin(allowedRoot, canonicalParent)) {
    fail("output parent is outside the allowed evidence root");
  }
  try {
    const existing = lstatSync(absolute);
    if (existing.isSymbolicLink()) fail("output file cannot be symlinked");
    fail("closed evidence output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return absolute;
}

function assertSafeEvidence(value, path = "result") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSafeEvidence(item, `${path}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) fail(`${path}.${key} is forbidden`);
      assertSafeEvidence(nested, `${path}.${key}`);
    }
  }
}

function timestamp(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) fail(`${label} must be a valid timestamp`);
  return date.toISOString();
}

function emptySubject() {
  return {
    backup: { status: "not_run", artifact_sha256: null },
    restore: { status: "not_run", verified_at: null },
    status: "missing",
  };
}

function emptySmoke() {
  return Object.fromEntries(SMOKE_KEYS.map((key) => [key, "not_run"]));
}

function normalizeSubject(subject, label) {
  const value = subject ?? {
    backup: { status: "not_run", artifact_sha256: null },
    restore: { status: "not_run", verified_at: null },
  };
  exactKeys(value, SUBJECT_KEYS, label);
  exactKeys(value.backup, BACKUP_KEYS, `${label}.backup`);
  exactKeys(value.restore, RESTORE_KEYS, `${label}.restore`);

  if (!BACKUP_STATUSES.has(value.backup.status)) {
    fail(`${label}.backup.status is invalid`);
  }
  if (!RESTORE_STATUSES.has(value.restore.status)) {
    fail(`${label}.restore.status is invalid`);
  }
  if (value.backup.status === "verified") {
    if (!SHA256.test(value.backup.artifact_sha256 ?? "")) {
      fail(`${label}.backup verified without an artifact SHA-256`);
    }
  } else if (value.backup.artifact_sha256 !== null) {
    fail(`${label}.backup cannot retain an unverified artifact SHA-256`);
  }
  if (value.restore.status === "verified") {
    timestamp(value.restore.verified_at, `${label}.restore.verified_at`);
  } else if (value.restore.verified_at !== null) {
    fail(`${label}.restore cannot retain an unverified timestamp`);
  }

  return {
    backup: { ...value.backup },
    restore: {
      status: value.restore.status,
      verified_at:
        value.restore.status === "verified"
          ? timestamp(value.restore.verified_at, `${label}.restore.verified_at`)
          : null,
    },
  };
}

function normalizeSmoke(smoke) {
  const value = smoke ?? emptySmoke();
  exactKeys(value, SMOKE_KEYS, "smoke");
  for (const key of SMOKE_KEYS) {
    if (!SMOKE_STATUSES.has(value[key])) fail(`smoke.${key} is invalid`);
  }
  return { ...value };
}

function recoveryStatus(subject, smoke, relevantSmokeKeys) {
  if (
    subject.backup.status === "failed" ||
    subject.restore.status === "failed" ||
    relevantSmokeKeys.some((key) => smoke[key] === "failed")
  ) {
    return "failed";
  }
  if (
    subject.backup.status !== "verified" ||
    subject.restore.status !== "verified" ||
    relevantSmokeKeys.some((key) => smoke[key] !== "passed")
  ) {
    return "missing";
  }
  return "ready";
}

function subjectBlockers(name, subject) {
  const blockers = [];
  if (subject.backup.status === "not_run") {
    blockers.push(`${name}_backup_missing`);
  } else if (subject.backup.status === "listed") {
    blockers.push(`${name}_backup_not_verified`);
  } else if (subject.backup.status === "failed") {
    blockers.push(`${name}_backup_failed`);
  }
  if (subject.restore.status === "not_run") {
    blockers.push(`${name}_restore_missing`);
  } else if (subject.restore.status === "failed") {
    blockers.push(`${name}_restore_failed`);
  }
  return blockers;
}

function smokeBlockers(smoke) {
  const missing = {
    restored_app: "restored_app_missing",
    admin_login: "admin_login_missing",
    same_organization_access: "same_organization_access_missing",
    cross_organization_denial: "cross_organization_denial_missing",
    private_storage_access: "private_storage_access_missing",
    blocked_integration_guard: "blocked_integration_check_missing",
  };
  const failed = {
    restored_app: "restored_app_failed",
    admin_login: "admin_login_failed",
    same_organization_access: "same_organization_access_failed",
    cross_organization_denial: "cross_organization_denial_failed",
    private_storage_access: "private_storage_access_failed",
    blocked_integration_guard: "blocked_integration_became_unblocked",
  };
  return SMOKE_KEYS.flatMap((key) =>
    smoke[key] === "not_run"
      ? [missing[key]]
      : smoke[key] === "failed"
        ? [failed[key]]
        : [],
  );
}

function validateEnvironment(environment) {
  exactKeys(environment, ENVIRONMENT_KEYS, "environment");
  for (const field of ["source_alias", "destination_alias"]) {
    if (!ALIAS.test(environment[field])) fail(`${field} is invalid`);
  }
  for (const field of [
    "source_identity_sha256",
    "destination_identity_sha256",
    "production_identity_sha256",
  ]) {
    if (!SHA256.test(environment[field])) fail(`${field} is invalid`);
  }
}

function preflightBlockers(environment) {
  const blockers = new Set();
  const sourceIsProduction =
    PRODUCTION_ALIAS.test(environment.source_alias) ||
    environment.source_identity_sha256 === environment.production_identity_sha256;
  const destinationIsProduction =
    PRODUCTION_ALIAS.test(environment.destination_alias) ||
    environment.destination_identity_sha256 ===
      environment.production_identity_sha256;

  if (sourceIsProduction) blockers.add("production_source_rejected");
  if (destinationIsProduction) {
    blockers.add("production_destination_rejected");
  }
  if (
    environment.source_alias === environment.destination_alias ||
    environment.source_identity_sha256 === environment.destination_identity_sha256
  ) {
    blockers.add("source_destination_identity_collision");
  }
  return [...blockers].sort();
}

function resultEnvironment(environment) {
  return {
    source_alias: environment.source_alias,
    source_identity_sha256: environment.source_identity_sha256,
    destination_alias: environment.destination_alias,
    destination_identity_sha256: environment.destination_identity_sha256,
    production_identity_sha256: environment.production_identity_sha256,
    identities_distinct:
      environment.source_alias !== environment.destination_alias &&
      environment.source_identity_sha256 !==
        environment.destination_identity_sha256,
    production_collision:
      environment.source_identity_sha256 ===
        environment.production_identity_sha256 ||
      environment.destination_identity_sha256 ===
        environment.production_identity_sha256,
  };
}

export function validateU11RecoveryResult(result) {
  assertSafeEvidence(result);
  if (!validateSchema(result)) {
    fail(`result schema validation failed: ${validateSchema.errors?.[0]?.instancePath || "/"}`);
  }
  assertU11RecoveryResultContract(result);
  return result;
}

function validateOwnerId(value, name) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_OWNER_ID
  ) {
    fail(`${name} is invalid`);
  }
  return value;
}

function removeCreatedOutputIfUnchanged(descriptor, outputPath) {
  try {
    const opened = fstatSync(descriptor);
    const current = lstatSync(outputPath);
    if (
      current.isFile() &&
      !current.isSymbolicLink() &&
      current.dev === opened.dev &&
      current.ino === opened.ino
    ) {
      unlinkSync(outputPath);
    }
  } catch {
    // A failed publication remains fail-closed. Never unlink a path that no
    // longer resolves to the exact inode opened by this process.
  }
}

export function writeU11RecoveryResult(options) {
  exactKeys(
    options,
    ["allowedRoot", "outputPath", "result", "ownerUid", "ownerGid"],
    "writer options",
  );
  const { allowedRoot, outputPath, result, ownerUid, ownerGid } = options;
  validateOwnerId(ownerUid, "ownerUid");
  validateOwnerId(ownerGid, "ownerGid");
  validateU11RecoveryResult(result);
  const canonicalRoot = resolveAllowedEvidenceRoot(allowedRoot);
  const absolute = resolveAllowedOutputPath(canonicalRoot, outputPath);
  let descriptor;
  let publicationError;
  try {
    descriptor = openSync(
      absolute,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fchownSync(descriptor, ownerUid, ownerGid);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: "utf8",
    });
    fsyncSync(descriptor);
  } catch (error) {
    publicationError = error;
  }

  if (publicationError && descriptor !== undefined) {
    removeCreatedOutputIfUnchanged(descriptor, absolute);
  }
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch (error) {
      if (!publicationError) {
        removeCreatedOutputIfUnchanged(descriptor, absolute);
        publicationError = error;
      }
    }
  }
  if (publicationError?.code === "EEXIST") {
    fail("closed evidence output already exists");
  }
  if (publicationError) {
    fail("closed evidence output publication failed");
  }
  return absolute;
}

export function evaluateU11RecoveryEvidence(input) {
  closedKeys(input, EVALUATION_KEYS, ["environment"], "evaluation input");
  const {
    observedAt = new Date(),
    environment,
    executionStatus = "not_run",
    database,
    storage,
    smoke,
  } = input;
  validateEnvironment(environment);
  if (!["not_run", "observed"].includes(executionStatus)) {
    fail("executionStatus is invalid");
  }

  const targetBlockers = preflightBlockers(environment);
  const blocked = targetBlockers.length > 0;
  const databaseEvidence = blocked || executionStatus === "not_run"
    ? emptySubject()
    : normalizeSubject(database, "database");
  const storageEvidence = blocked || executionStatus === "not_run"
    ? emptySubject()
    : normalizeSubject(storage, "storage");
  const smokeEvidence = blocked || executionStatus === "not_run"
    ? emptySmoke()
    : normalizeSmoke(smoke);

  if (!blocked && executionStatus === "observed") {
    databaseEvidence.status = recoveryStatus(
      databaseEvidence,
      smokeEvidence,
      DATABASE_SMOKE_KEYS,
    );
    storageEvidence.status = recoveryStatus(
      storageEvidence,
      smokeEvidence,
      STORAGE_SMOKE_KEYS,
    );
  }

  const evidenceBlockers = blocked
    ? targetBlockers
    : executionStatus === "not_run"
      ? ["managed_drill_not_run"]
      : [
          ...subjectBlockers("database", databaseEvidence),
          ...subjectBlockers("storage", storageEvidence),
          ...smokeBlockers(smokeEvidence),
        ].sort();
  const hasFailure =
    databaseEvidence.status === "failed" ||
    storageEvidence.status === "failed" ||
    SMOKE_KEYS.some((key) => smokeEvidence[key] === "failed");
  const ready =
    databaseEvidence.status === "ready" &&
    storageEvidence.status === "ready" &&
    SMOKE_KEYS.every((key) => smokeEvidence[key] === "passed");
  const result = {
    schema_version: "u11-recovery-result/v1",
    observed_at: timestamp(observedAt, "observedAt"),
    result_code: blocked
      ? "preflight_blocked"
      : ready
        ? "recovery_ready"
        : hasFailure
          ? "recovery_failed"
          : "recovery_incomplete",
    preflight: { status: blocked ? "blocked" : "verified" },
    execution_status: blocked ? "not_run" : executionStatus,
    environment: resultEnvironment(environment),
    subjects: {
      database: databaseEvidence,
      storage: storageEvidence,
    },
    smoke: smokeEvidence,
    blockers: evidenceBlockers,
  };

  return validateU11RecoveryResult(result);
}

function parseEvaluateArguments(argv) {
  if (!Array.isArray(argv) || argv[0] !== "evaluate" || argv.length !== 11) {
    fail("evaluate CLI arguments are invalid");
  }
  const allowedFlags = new Set([
    "--input",
    "--allowed-root",
    "--output",
    "--owner-uid",
    "--owner-gid",
  ]);
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !allowedFlags.has(flag) ||
      values.has(flag) ||
      typeof value !== "string" ||
      value === ""
    ) {
      fail("evaluate CLI arguments are invalid");
    }
    values.set(flag, value);
  }
  if (values.size !== allowedFlags.size) {
    fail("evaluate CLI arguments are incomplete");
  }
  const parseOwnerFlag = (flag, name) => {
    const value = values.get(flag);
    if (!/^(?:0|[1-9][0-9]{0,9})$/.test(value)) {
      fail(`${name} is invalid`);
    }
    return validateOwnerId(Number(value), name);
  };
  return {
    inputPath: values.get("--input"),
    allowedRoot: values.get("--allowed-root"),
    outputPath: values.get("--output"),
    ownerUid: parseOwnerFlag("--owner-uid", "ownerUid"),
    ownerGid: parseOwnerFlag("--owner-gid", "ownerGid"),
  };
}

function readClosedEvaluateInput(inputPath) {
  if (
    typeof inputPath !== "string" ||
    inputPath.trim() === "" ||
    !isAbsolute(inputPath)
  ) {
    fail("an explicit absolute input path is required");
  }
  const absolute = resolve(inputPath);
  let metadata;
  try {
    metadata = lstatSync(absolute);
  } catch {
    fail("evaluate input must already exist");
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail("evaluate input must be a regular non-symlink file");
  }
  if (metadata.size < 2 || metadata.size > MAX_CLI_INPUT_BYTES) {
    fail("evaluate input size is invalid");
  }
  if (realpathSync(absolute) !== absolute) {
    fail("evaluate input path cannot contain symlinks");
  }
  return JSON.parse(readFileSync(absolute, "utf8"));
}

export function runU11RecoveryEvaluateCli(argv) {
  const { inputPath, allowedRoot, outputPath, ownerUid, ownerGid } =
    parseEvaluateArguments(argv);
  const input = readClosedEvaluateInput(inputPath);
  const result = evaluateU11RecoveryEvidence(input);
  writeU11RecoveryResult({
    allowedRoot,
    outputPath,
    result,
    ownerUid,
    ownerGid,
  });
}

const isMain =
  typeof process.argv[1] === "string" &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    runU11RecoveryEvaluateCli(process.argv.slice(2));
  } catch {
    process.stderr.write("U11 recovery evaluate failed\n");
    process.exitCode = 1;
  }
}
