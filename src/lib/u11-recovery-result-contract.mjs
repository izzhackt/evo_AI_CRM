const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "observed_at",
  "result_code",
  "preflight",
  "execution_status",
  "environment",
  "subjects",
  "smoke",
  "blockers",
]);
const ENVIRONMENT_KEYS = Object.freeze([
  "source_alias",
  "source_identity_sha256",
  "destination_alias",
  "destination_identity_sha256",
  "production_identity_sha256",
  "identities_distinct",
  "production_collision",
]);
const SMOKE_KEYS = Object.freeze([
  "restored_app",
  "admin_login",
  "same_organization_access",
  "cross_organization_denial",
  "private_storage_access",
  "blocked_integration_guard",
]);
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
const RESULT_CODES = new Set([
  "preflight_blocked",
  "recovery_ready",
  "recovery_failed",
  "recovery_incomplete",
]);
const RECOVERY_STATUSES = new Set(["missing", "failed", "ready"]);
const BACKUP_STATUSES = new Set(["not_run", "listed", "verified", "failed"]);
const RESTORE_STATUSES = new Set(["not_run", "verified", "failed"]);
const SMOKE_STATUSES = new Set(["not_run", "passed", "failed"]);
const ENVIRONMENT_ALIAS = /^[a-z][a-z0-9-]{2,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PRODUCTION_ALIAS = /(?:^|-)(?:prod|production)(?:-|$)/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FORBIDDEN_KEY =
  /(?:secret|token|password|cookie|authorization|api_?key|provider_?payload|raw_?(?:sql|response|body))/i;

function invalid(message = "recovery result contract is invalid") {
  const error = new Error(message);
  error.code = "u11_recovery_evidence_invalid";
  throw error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function containsForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => FORBIDDEN_KEY.test(key) || containsForbiddenKey(nested),
  );
}

function isCanonicalTimestamp(value) {
  return typeof value === "string" &&
    CANONICAL_TIMESTAMP.test(value) &&
    Number.isFinite(Date.parse(value));
}

function environmentRecord(value) {
  if (!hasExactKeys(value, ENVIRONMENT_KEYS) ||
      !ENVIRONMENT_ALIAS.test(value.source_alias) ||
      !ENVIRONMENT_ALIAS.test(value.destination_alias) ||
      !SHA256.test(value.source_identity_sha256) ||
      !SHA256.test(value.destination_identity_sha256) ||
      !SHA256.test(value.production_identity_sha256) ||
      typeof value.identities_distinct !== "boolean" ||
      typeof value.production_collision !== "boolean") invalid();

  const expectedDistinct =
    value.source_alias !== value.destination_alias &&
    value.source_identity_sha256 !== value.destination_identity_sha256;
  const expectedProductionCollision =
    value.source_identity_sha256 === value.production_identity_sha256 ||
    value.destination_identity_sha256 === value.production_identity_sha256;
  if (value.identities_distinct !== expectedDistinct ||
      value.production_collision !== expectedProductionCollision) {
    invalid("recovery result environment is contradictory");
  }
  return value;
}

function subjectRecord(value) {
  if (!hasExactKeys(value, ["backup", "restore", "status"]) ||
      !hasExactKeys(value.backup, ["status", "artifact_sha256"]) ||
      !hasExactKeys(value.restore, ["status", "verified_at"]) ||
      !BACKUP_STATUSES.has(value.backup.status) ||
      !RESTORE_STATUSES.has(value.restore.status) ||
      !RECOVERY_STATUSES.has(value.status)) invalid();
  if (value.backup.status === "verified") {
    if (!SHA256.test(value.backup.artifact_sha256)) invalid();
  } else if (value.backup.artifact_sha256 !== null) invalid();
  if (value.restore.status === "verified") {
    if (!isCanonicalTimestamp(value.restore.verified_at)) invalid();
  } else if (value.restore.verified_at !== null) invalid();
  return value;
}

function smokeRecord(value) {
  if (!hasExactKeys(value, SMOKE_KEYS) ||
      SMOKE_KEYS.some((key) => !SMOKE_STATUSES.has(value[key]))) invalid();
  return value;
}

function preflightBlockers(environment) {
  const blockers = new Set();
  const sourceIsProduction =
    PRODUCTION_ALIAS.test(environment.source_alias) ||
    environment.source_identity_sha256 === environment.production_identity_sha256;
  const destinationIsProduction =
    PRODUCTION_ALIAS.test(environment.destination_alias) ||
    environment.destination_identity_sha256 === environment.production_identity_sha256;
  if (sourceIsProduction) blockers.add("production_source_rejected");
  if (destinationIsProduction) blockers.add("production_destination_rejected");
  if (environment.source_alias === environment.destination_alias ||
      environment.source_identity_sha256 === environment.destination_identity_sha256) {
    blockers.add("source_destination_identity_collision");
  }
  return [...blockers].sort();
}

function recoveryStatus(subject, smoke, relevantSmokeKeys) {
  if (subject.backup.status === "failed" ||
      subject.restore.status === "failed" ||
      relevantSmokeKeys.some((key) => smoke[key] === "failed")) return "failed";
  if (subject.backup.status !== "verified" ||
      subject.restore.status !== "verified" ||
      relevantSmokeKeys.some((key) => smoke[key] !== "passed")) return "missing";
  return "ready";
}

function subjectBlockers(name, subject) {
  const blockers = [];
  if (subject.backup.status === "not_run") blockers.push(`${name}_backup_missing`);
  else if (subject.backup.status === "listed") blockers.push(`${name}_backup_not_verified`);
  else if (subject.backup.status === "failed") blockers.push(`${name}_backup_failed`);
  if (subject.restore.status === "not_run") blockers.push(`${name}_restore_missing`);
  else if (subject.restore.status === "failed") blockers.push(`${name}_restore_failed`);
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

function exactBlockers(value, expected) {
  return Array.isArray(value) &&
    value.length === expected.length &&
    value.every((blocker, index) => blocker === expected[index]);
}

function isNotRunSubject(subject) {
  return subject.backup.status === "not_run" &&
    subject.restore.status === "not_run" &&
    subject.status === "missing";
}

export function assertU11RecoveryResultContract(value) {
  if (!hasExactKeys(value, TOP_LEVEL_KEYS) || containsForbiddenKey(value) ||
      value.schema_version !== "u11-recovery-result/v1" ||
      !isCanonicalTimestamp(value.observed_at) ||
      !RESULT_CODES.has(value.result_code) ||
      !hasExactKeys(value.preflight, ["status"]) ||
      !["verified", "blocked"].includes(value.preflight.status) ||
      !["not_run", "observed"].includes(value.execution_status) ||
      !hasExactKeys(value.subjects, ["database", "storage"])) invalid();

  const environment = environmentRecord(value.environment);
  const database = subjectRecord(value.subjects.database);
  const storage = subjectRecord(value.subjects.storage);
  const smoke = smokeRecord(value.smoke);
  const databaseStatus = recoveryStatus(database, smoke, DATABASE_SMOKE_KEYS);
  const storageStatus = recoveryStatus(storage, smoke, STORAGE_SMOKE_KEYS);
  if (database.status !== databaseStatus || storage.status !== storageStatus) {
    invalid("recovery result subject status is contradictory");
  }

  if (value.execution_status === "not_run" &&
      (!isNotRunSubject(database) || !isNotRunSubject(storage) ||
        SMOKE_KEYS.some((key) => smoke[key] !== "not_run"))) invalid();

  const targetBlockers = preflightBlockers(environment);
  if (targetBlockers.length > 0) {
    if (value.result_code !== "preflight_blocked" ||
        value.preflight.status !== "blocked" ||
        value.execution_status !== "not_run" ||
        !exactBlockers(value.blockers, targetBlockers)) {
      invalid("recovery preflight result is contradictory");
    }
  } else if (value.preflight.status !== "verified") {
    invalid("recovery preflight result is contradictory");
  } else if (value.execution_status === "not_run") {
    if (value.result_code !== "recovery_incomplete" ||
        !exactBlockers(value.blockers, ["managed_drill_not_run"])) {
      invalid("recovery not-run result is contradictory");
    }
  } else {
    const expectedBlockers = [
      ...subjectBlockers("database", database),
      ...subjectBlockers("storage", storage),
      ...smokeBlockers(smoke),
    ].sort();
    if (!exactBlockers(value.blockers, expectedBlockers)) {
      invalid("recovery blockers are contradictory");
    }
    const failed = databaseStatus === "failed" ||
      storageStatus === "failed" ||
      SMOKE_KEYS.some((key) => smoke[key] === "failed");
    const ready = databaseStatus === "ready" &&
      storageStatus === "ready" &&
      SMOKE_KEYS.every((key) => smoke[key] === "passed");
    const expectedCode = ready
      ? "recovery_ready"
      : failed
        ? "recovery_failed"
        : "recovery_incomplete";
    if (value.result_code !== expectedCode) {
      invalid("recovery result code is contradictory");
    }
  }

  return value;
}

export function parseU11RecoveryResultContract(value) {
  try {
    const result = assertU11RecoveryResultContract(value);
    return Object.freeze({
      resultCode: result.result_code,
      observedAt: result.observed_at,
      observedMs: Date.parse(result.observed_at),
      databaseStatus: result.subjects.database.status,
      storageStatus: result.subjects.storage.status,
    });
  } catch {
    return null;
  }
}
