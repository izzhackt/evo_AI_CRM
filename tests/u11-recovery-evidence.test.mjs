import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateU11RecoveryEvidence,
  validateU11RecoveryResult,
  writeU11RecoveryResult,
} from "../scripts/u11-recovery-evidence.mjs";

const SHA = Object.freeze({
  source: "1".repeat(64),
  destination: "2".repeat(64),
  production: "3".repeat(64),
  database: "4".repeat(64),
  storage: "5".repeat(64),
});

const OWNER_UID = process.getuid();
const OWNER_GID = process.getgid();

function ownedWriterOptions(options) {
  return {
    ...options,
    ownerUid: OWNER_UID,
    ownerGid: OWNER_GID,
  };
}

function environment(overrides = {}) {
  return {
    source_alias: "evo-staging-source",
    source_identity_sha256: SHA.source,
    destination_alias: "evo-recovery-target",
    destination_identity_sha256: SHA.destination,
    production_identity_sha256: SHA.production,
    ...overrides,
  };
}

function recoveredSubject(artifactSha256) {
  return {
    backup: { status: "verified", artifact_sha256: artifactSha256 },
    restore: {
      status: "verified",
      verified_at: "2026-08-27T09:45:00.000Z",
    },
  };
}

function passedSmoke(overrides = {}) {
  return {
    restored_app: "passed",
    admin_login: "passed",
    same_organization_access: "passed",
    cross_organization_denial: "passed",
    private_storage_access: "passed",
    blocked_integration_guard: "passed",
    ...overrides,
  };
}

test("a production recovery target is rejected before managed execution", () => {
  const result = evaluateU11RecoveryEvidence({
    observedAt: new Date("2026-08-27T10:00:00.000Z"),
    environment: environment({
      destination_alias: "evo-production",
      destination_identity_sha256: SHA.production,
    }),
    executionStatus: "observed",
  });

  assert.equal(result.result_code, "preflight_blocked");
  assert.equal(result.preflight.status, "blocked");
  assert.equal(result.execution_status, "not_run");
  assert.deepEqual(result.blockers, ["production_destination_rejected"]);
  assert.equal(result.subjects.database.restore.status, "not_run");
  assert.equal(result.subjects.storage.restore.status, "not_run");
});

test("source and destination must be distinct non-production identities", () => {
  const result = evaluateU11RecoveryEvidence({
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment({
      destination_identity_sha256: SHA.source,
    }),
    executionStatus: "observed",
  });

  assert.equal(result.result_code, "preflight_blocked");
  assert.equal(result.environment.identities_distinct, false);
  assert.equal(result.environment.production_collision, false);
  assert.equal(result.execution_status, "not_run");
  assert.deepEqual(result.blockers, [
    "source_destination_identity_collision",
  ]);
});

test("database and Storage recovery statuses remain independent for distinct non-production identities", () => {
  const result = evaluateU11RecoveryEvidence({
    observedAt: new Date("2026-08-27T10:00:00.000Z"),
    environment: environment(),
    executionStatus: "observed",
    database: {
      backup: { status: "verified", artifact_sha256: SHA.database },
      restore: { status: "failed", verified_at: null },
    },
    storage: recoveredSubject(SHA.storage),
    smoke: passedSmoke(),
  });

  assert.equal(result.environment.identities_distinct, true);
  assert.equal(result.environment.production_collision, false);
  assert.equal(result.subjects.database.status, "failed");
  assert.equal(result.subjects.storage.status, "ready");
  assert.equal(result.result_code, "recovery_failed");
  assert.deepEqual(result.blockers, ["database_restore_failed"]);
});

test("a listed backup is not treated as restored proof", () => {
  const result = evaluateU11RecoveryEvidence({
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment(),
    executionStatus: "observed",
    database: {
      backup: { status: "listed", artifact_sha256: null },
      restore: { status: "not_run", verified_at: null },
    },
    storage: recoveredSubject(SHA.storage),
    smoke: passedSmoke(),
  });

  assert.equal(result.result_code, "recovery_incomplete");
  assert.equal(result.subjects.database.status, "missing");
  assert.equal(result.subjects.database.backup.status, "listed");
  assert.equal(result.subjects.database.backup.artifact_sha256, null);
  assert.deepEqual(result.blockers, [
    "database_backup_not_verified",
    "database_restore_missing",
  ]);
});

test("missing and failed smoke checks keep recovery non-ready", () => {
  const common = {
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment(),
    executionStatus: "observed",
    database: recoveredSubject(SHA.database),
    storage: recoveredSubject(SHA.storage),
  };

  const missing = evaluateU11RecoveryEvidence({
    ...common,
    smoke: passedSmoke({ admin_login: "not_run" }),
  });
  assert.equal(missing.result_code, "recovery_incomplete");
  assert.equal(missing.subjects.database.status, "missing");
  assert.equal(missing.subjects.storage.status, "missing");
  assert.deepEqual(missing.blockers, ["admin_login_missing"]);

  const failed = evaluateU11RecoveryEvidence({
    ...common,
    smoke: passedSmoke({ private_storage_access: "failed" }),
  });
  assert.equal(failed.result_code, "recovery_failed");
  assert.equal(failed.subjects.database.status, "ready");
  assert.equal(failed.subjects.storage.status, "failed");
  assert.deepEqual(failed.blockers, ["private_storage_access_failed"]);
});

test("recovery becomes ready only while the blocked integration remains blocked", () => {
  const common = {
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment(),
    executionStatus: "observed",
    database: recoveredSubject(SHA.database),
    storage: recoveredSubject(SHA.storage),
  };
  const guarded = evaluateU11RecoveryEvidence({
    ...common,
    smoke: passedSmoke(),
  });
  assert.equal(guarded.result_code, "recovery_ready");
  assert.equal(guarded.subjects.database.status, "ready");
  assert.equal(guarded.subjects.storage.status, "ready");
  assert.deepEqual(guarded.blockers, []);

  const unblocked = evaluateU11RecoveryEvidence({
    ...common,
    smoke: passedSmoke({ blocked_integration_guard: "failed" }),
  });
  assert.equal(unblocked.result_code, "recovery_failed");
  assert.equal(unblocked.subjects.database.status, "failed");
  assert.equal(unblocked.subjects.storage.status, "failed");
  assert.deepEqual(unblocked.blockers, [
    "blocked_integration_became_unblocked",
  ]);
});

test("an unapproved managed drill stays explicitly not-run", () => {
  const result = evaluateU11RecoveryEvidence({
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment(),
    executionStatus: "not_run",
  });

  assert.equal(result.result_code, "recovery_incomplete");
  assert.equal(result.execution_status, "not_run");
  assert.equal(result.subjects.database.status, "missing");
  assert.equal(result.subjects.storage.status, "missing");
  assert.deepEqual(result.blockers, ["managed_drill_not_run"]);
});

test("recovery evidence is closed and rejects secret-shaped or contradictory success fields", () => {
  assert.throws(
    () =>
      evaluateU11RecoveryEvidence({
        observedAt: "2026-08-27T10:00:00.000Z",
        environment: environment(),
        executionStatus: "not_run",
        api_token: "must-not-be-published",
      }),
    /evaluation input must use the closed evidence shape/,
  );

  const ready = evaluateU11RecoveryEvidence({
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment(),
    executionStatus: "observed",
    database: recoveredSubject(SHA.database),
    storage: recoveredSubject(SHA.storage),
    smoke: passedSmoke(),
  });
  assert.doesNotThrow(() => validateU11RecoveryResult(ready));
  assert.equal(JSON.stringify(ready).includes("must-not-be-published"), false);

  const secretBearing = structuredClone(ready);
  secretBearing.api_token = "must-not-be-published";
  assert.throws(
    () => validateU11RecoveryResult(secretBearing),
    /api_token is forbidden/,
  );

  const falseSuccess = structuredClone(ready);
  falseSuccess.smoke.blocked_integration_guard = "failed";
  assert.throws(
    () => validateU11RecoveryResult(falseSuccess),
    /schema validation failed/,
  );

  const listedButReady = structuredClone(ready);
  listedButReady.subjects.database.backup = {
    status: "listed",
    artifact_sha256: null,
  };
  assert.throws(
    () => validateU11RecoveryResult(listedButReady),
    /contradictory/,
  );
});

test("the controller publishes one closed file for the explicitly validated app owner without overwrite", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-u11-recovery-")));
  const outputPath = join(root, "recovery-result.json");
  const result = evaluateU11RecoveryEvidence({
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment(),
    executionStatus: "not_run",
  });

  try {
    assert.throws(
      () => writeU11RecoveryResult({ allowedRoot: root, outputPath, result }),
      /writer options must use the closed evidence shape/,
    );
    assert.equal(existsSync(outputPath), false);
    assert.throws(
      () =>
        writeU11RecoveryResult({
          allowedRoot: root,
          outputPath,
          result,
          ownerUid: -1,
          ownerGid: OWNER_GID,
        }),
      /ownerUid is invalid/,
    );
    assert.equal(existsSync(outputPath), false);

    writeU11RecoveryResult(
      ownedWriterOptions({ allowedRoot: root, outputPath, result }),
    );
    assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), result);
    const metadata = statSync(outputPath);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.uid, OWNER_UID);
    assert.equal(metadata.gid, OWNER_GID);
    assert.throws(
      () =>
        writeU11RecoveryResult(
          ownedWriterOptions({ allowedRoot: root, outputPath, result }),
        ),
      /already exists/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "the controller removes its newly created output when ownership cannot be applied",
  { skip: OWNER_UID === 0 },
  () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-u11-owner-fail-")));
    const outputPath = join(root, "recovery-result.json");
    const result = evaluateU11RecoveryEvidence({
      observedAt: "2026-08-27T10:00:00.000Z",
      environment: environment(),
      executionStatus: "not_run",
    });

    try {
      assert.throws(
        () =>
          writeU11RecoveryResult({
            allowedRoot: root,
            outputPath,
            result,
            ownerUid: OWNER_UID + 1,
            ownerGid: OWNER_GID,
          }),
        /closed evidence output publication failed/,
      );
      assert.equal(existsSync(outputPath), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("the writer rejects outputs outside the explicit evidence root without prefix confusion", () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "evo-u11-root-")));
  const allowedRoot = join(parent, "safe-root");
  const confusingRoot = join(parent, "safe-root-evil");
  mkdirSync(allowedRoot);
  mkdirSync(confusingRoot);
  const result = evaluateU11RecoveryEvidence({
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment(),
    executionStatus: "not_run",
  });

  try {
    assert.throws(
      () =>
        writeU11RecoveryResult(
          ownedWriterOptions({
            allowedRoot,
            outputPath: join(confusingRoot, "result.json"),
            result,
          }),
        ),
      /outside the allowed evidence root/,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("broad production and Docker roots can never be evidence roots", () => {
  const result = evaluateU11RecoveryEvidence({
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment(),
    executionStatus: "not_run",
  });
  const forbiddenRoots = [
    "/",
    "/opt/evo-crm",
    "/opt/evo-crm/evidence",
    "/opt/evo-inbox",
    "/var/lib/docker",
    "/var/lib/containerd",
    "/var/lib/containers",
    "/private/var/lib/docker",
    "/private/var/lib/containerd",
  ];

  for (const allowedRoot of forbiddenRoots) {
    assert.throws(
      () =>
        writeU11RecoveryResult(
          ownedWriterOptions({
            allowedRoot,
            outputPath: join(allowedRoot, "u11-result.json"),
            result,
          }),
        ),
      /allowed evidence root is forbidden/,
    );
  }
});

test("the writer rejects symlinked roots, parents, and output files", () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "evo-u11-link-")));
  const allowedRoot = join(parent, "safe-root");
  const outsideRoot = join(parent, "outside-root");
  const linkedRoot = join(parent, "linked-root");
  const linkedParent = join(allowedRoot, "linked-parent");
  mkdirSync(allowedRoot);
  mkdirSync(outsideRoot);
  symlinkSync(allowedRoot, linkedRoot, "dir");
  symlinkSync(outsideRoot, linkedParent, "dir");
  const result = evaluateU11RecoveryEvidence({
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment(),
    executionStatus: "not_run",
  });

  try {
    assert.throws(
      () =>
        writeU11RecoveryResult(
          ownedWriterOptions({
            allowedRoot: linkedRoot,
            outputPath: join(linkedRoot, "result.json"),
            result,
          }),
        ),
      /allowed evidence root cannot be symlinked/,
    );
    assert.throws(
      () =>
        writeU11RecoveryResult(
          ownedWriterOptions({
            allowedRoot,
            outputPath: join(linkedParent, "result.json"),
            result,
          }),
        ),
      /output parent cannot be symlinked/,
    );

    const linkedOutput = join(allowedRoot, "linked-result.json");
    symlinkSync(join(outsideRoot, "escaped-result.json"), linkedOutput);
    assert.throws(
      () =>
        writeU11RecoveryResult(
          ownedWriterOptions({
            allowedRoot,
            outputPath: linkedOutput,
            result,
          }),
        ),
      /output file cannot be symlinked/,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("the evaluate CLI consumes only closed JSON and never prints input values", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-u11-cli-")));
  const inputPath = join(root, "input.json");
  const outputPath = join(root, "result.json");
  const rejectedInputPath = join(root, "rejected-input.json");
  const rejectedOutputPath = join(root, "rejected-result.json");
  const missingOwnerOutputPath = join(root, "missing-owner-result.json");
  const invalidOwnerOutputPath = join(root, "invalid-owner-result.json");
  const scriptPath = join(
    process.cwd(),
    "scripts/u11-recovery-evidence.mjs",
  );
  const input = {
    observedAt: "2026-08-27T10:00:00.000Z",
    environment: environment(),
    executionStatus: "not_run",
  };
  writeFileSync(inputPath, `${JSON.stringify(input)}\n`, { mode: 0o600 });
  writeFileSync(
    rejectedInputPath,
    `${JSON.stringify({ ...input, api_token: "never-print-this-value" })}\n`,
    { mode: 0o600 },
  );

  try {
    const accepted = spawnSync(
      process.execPath,
      [
        scriptPath,
        "evaluate",
        "--input",
        inputPath,
        "--allowed-root",
        root,
        "--output",
        outputPath,
        "--owner-uid",
        String(OWNER_UID),
        "--owner-gid",
        String(OWNER_GID),
      ],
      { encoding: "utf8" },
    );
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stdout, "");
    assert.equal(accepted.stderr, "");
    assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).result_code, "recovery_incomplete");
    const acceptedMetadata = statSync(outputPath);
    assert.equal(acceptedMetadata.mode & 0o777, 0o600);
    assert.equal(acceptedMetadata.uid, OWNER_UID);
    assert.equal(acceptedMetadata.gid, OWNER_GID);

    const rejected = spawnSync(
      process.execPath,
      [
        scriptPath,
        "evaluate",
        "--input",
        rejectedInputPath,
        "--allowed-root",
        root,
        "--output",
        rejectedOutputPath,
        "--owner-uid",
        String(OWNER_UID),
        "--owner-gid",
        String(OWNER_GID),
      ],
      { encoding: "utf8" },
    );
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, "");
    assert.equal(rejected.stderr, "U11 recovery evaluate failed\n");
    assert.equal(rejected.stderr.includes("never-print-this-value"), false);
    assert.equal(existsSync(rejectedOutputPath), false);

    const missingOwner = spawnSync(
      process.execPath,
      [
        scriptPath,
        "evaluate",
        "--input",
        inputPath,
        "--allowed-root",
        root,
        "--output",
        missingOwnerOutputPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(missingOwner.status, 1);
    assert.equal(missingOwner.stdout, "");
    assert.equal(missingOwner.stderr, "U11 recovery evaluate failed\n");
    assert.equal(existsSync(missingOwnerOutputPath), false);

    const invalidOwner = spawnSync(
      process.execPath,
      [
        scriptPath,
        "evaluate",
        "--input",
        inputPath,
        "--allowed-root",
        root,
        "--output",
        invalidOwnerOutputPath,
        "--owner-uid",
        "1001",
        "--owner-gid",
        "-1",
      ],
      { encoding: "utf8" },
    );
    assert.equal(invalidOwner.status, 1);
    assert.equal(invalidOwner.stdout, "");
    assert.equal(invalidOwner.stderr, "U11 recovery evaluate failed\n");
    assert.equal(existsSync(invalidOwnerOutputPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
