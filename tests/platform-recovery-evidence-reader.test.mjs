import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadPlatformRecoveryEvidence } from "../src/lib/server/platform-recovery-evidence.ts";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const OBSERVED_AT = "2026-08-27T11:00:00.000Z";

function readyResult() {
  return {
    schema_version: "u11-recovery-result/v1",
    observed_at: OBSERVED_AT,
    result_code: "recovery_ready",
    preflight: { status: "verified" },
    execution_status: "observed",
    environment: {
      source_alias: "evo-staging",
      source_identity_sha256: "1".repeat(64),
      destination_alias: "evo-recovery",
      destination_identity_sha256: "2".repeat(64),
      production_identity_sha256: "3".repeat(64),
      identities_distinct: true,
      production_collision: false,
    },
    subjects: {
      database: {
        backup: { status: "verified", artifact_sha256: "4".repeat(64) },
        restore: { status: "verified", verified_at: OBSERVED_AT },
        status: "ready",
      },
      storage: {
        backup: { status: "verified", artifact_sha256: "5".repeat(64) },
        restore: { status: "verified", verified_at: OBSERVED_AT },
        status: "ready",
      },
    },
    smoke: {
      restored_app: "passed",
      admin_login: "passed",
      same_organization_access: "passed",
      cross_organization_denial: "passed",
      private_storage_access: "passed",
      blocked_integration_guard: "passed",
    },
    blockers: [],
  };
}

async function evidenceFile(result = readyResult()) {
  const root = await mkdtemp(join(tmpdir(), "evo-u11-reader-"));
  const path = join(root, "recovery.json");
  await writeFile(path, `${JSON.stringify(result)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return { root, path };
}

test("missing recovery configuration stays explicitly missing", async () => {
  const evidence = await loadPlatformRecoveryEvidence({}, { now: () => NOW });

  assert.deepEqual(evidence, {
    source: "missing",
    resultCode: null,
    observedAt: null,
    database: { status: "missing", age_seconds: null },
    storage: { status: "missing", age_seconds: null },
  });
});

test("configured private root with no drill result stays missing, not failed", async () => {
  const root = await mkdtemp(join(tmpdir(), "evo-u11-reader-empty-"));
  try {
    const evidence = await loadPlatformRecoveryEvidence({
      EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
      EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: join(root, "recovery.json"),
    }, { now: () => NOW });
    assert.equal(evidence.source, "missing");
    assert.equal(evidence.database.status, "missing");
    assert.equal(evidence.storage.status, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("closed ready evidence maps database and Storage independently", async () => {
  const { root, path } = await evidenceFile();
  try {
    const evidence = await loadPlatformRecoveryEvidence({
      EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
      EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: path,
    }, { now: () => NOW });

    assert.deepEqual(evidence, {
      source: "verified",
      resultCode: "recovery_ready",
      observedAt: OBSERVED_AT,
      database: { status: "ready", age_seconds: 3_600 },
      storage: { status: "ready", age_seconds: 3_600 },
    });
    assert.equal(JSON.stringify(evidence).includes("identity_sha256"), false);
    assert.equal(JSON.stringify(evidence).includes("artifact_sha256"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ready evidence with incomplete environment provenance fails closed", async () => {
  const result = readyResult();
  result.environment = {};
  const { root, path } = await evidenceFile(result);

  try {
    const evidence = await loadPlatformRecoveryEvidence({
      EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
      EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: path,
    }, { now: () => NOW });

    assert.equal(evidence.source, "failed");
    assert.equal(evidence.database.status, "failed");
    assert.equal(evidence.storage.status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ready evidence with contradictory environment provenance fails closed", async () => {
  const contradictoryResults = [
    {
      ...readyResult(),
      environment: { ...readyResult().environment, identities_distinct: false },
    },
    {
      ...readyResult(),
      environment: { ...readyResult().environment, production_collision: true },
    },
    {
      ...readyResult(),
      environment: {
        ...readyResult().environment,
        destination_identity_sha256: readyResult().environment.source_identity_sha256,
      },
    },
    {
      ...readyResult(),
      environment: {
        ...readyResult().environment,
        source_identity_sha256: readyResult().environment.production_identity_sha256,
      },
    },
  ];

  for (const result of contradictoryResults) {
    const { root, path } = await evidenceFile(result);
    try {
      const evidence = await loadPlatformRecoveryEvidence({
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: path,
      }, { now: () => NOW });

      assert.equal(evidence.source, "failed");
      assert.equal(evidence.database.status, "failed");
      assert.equal(evidence.storage.status, "failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("preflight evidence with omitted or contradictory blockers fails closed", async () => {
  const base = readyResult();
  const blocked = {
    ...base,
    result_code: "preflight_blocked",
    preflight: { status: "blocked" },
    execution_status: "not_run",
    environment: {
      ...base.environment,
      source_identity_sha256: base.environment.production_identity_sha256,
      production_collision: true,
    },
    subjects: {
      database: {
        backup: { status: "not_run", artifact_sha256: null },
        restore: { status: "not_run", verified_at: null },
        status: "missing",
      },
      storage: {
        backup: { status: "not_run", artifact_sha256: null },
        restore: { status: "not_run", verified_at: null },
        status: "missing",
      },
    },
    smoke: Object.fromEntries(Object.keys(base.smoke).map((key) => [key, "not_run"])),
    blockers: [],
  };

  for (const result of [blocked, { ...blocked, blockers: ["managed_drill_not_run"] }]) {
    const { root, path } = await evidenceFile(result);
    try {
      const evidence = await loadPlatformRecoveryEvidence({
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: path,
      }, { now: () => NOW });

      assert.equal(evidence.source, "failed");
      assert.equal(evidence.database.status, "failed");
      assert.equal(evidence.storage.status, "failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("ready evidence requires the full canonical backup and restore shape", async () => {
  const base = readyResult();
  const invalidResults = [
    {
      ...base,
      subjects: {
        ...base.subjects,
        database: { ...base.subjects.database, backup: {} },
      },
    },
    {
      ...base,
      subjects: {
        ...base.subjects,
        database: {
          ...base.subjects.database,
          backup: { status: "listed", artifact_sha256: null },
        },
      },
    },
    {
      ...base,
      subjects: {
        ...base.subjects,
        storage: {
          ...base.subjects.storage,
          restore: { status: "verified", verified_at: null },
        },
      },
    },
  ];

  for (const result of invalidResults) {
    const { root, path } = await evidenceFile(result);
    try {
      const evidence = await loadPlatformRecoveryEvidence({
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: path,
      }, { now: () => NOW });

      assert.equal(evidence.source, "failed");
      assert.equal(evidence.database.status, "failed");
      assert.equal(evidence.storage.status, "failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("observed recovery evidence requires exact blockers for its failures", async () => {
  const base = readyResult();
  const failed = {
    ...base,
    result_code: "recovery_failed",
    subjects: {
      ...base.subjects,
      database: {
        ...base.subjects.database,
        backup: { status: "failed", artifact_sha256: null },
        status: "failed",
      },
    },
    blockers: [],
  };

  for (const result of [
    failed,
    { ...failed, blockers: ["storage_backup_failed"] },
  ]) {
    const { root, path } = await evidenceFile(result);
    try {
      const evidence = await loadPlatformRecoveryEvidence({
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: path,
      }, { now: () => NOW });

      assert.equal(evidence.source, "failed");
      assert.equal(evidence.database.status, "failed");
      assert.equal(evidence.storage.status, "failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("not-run recovery evidence cannot contain partial execution artifacts", async () => {
  const base = readyResult();
  const partialSubject = {
    backup: { status: "verified", artifact_sha256: "4".repeat(64) },
    restore: { status: "not_run", verified_at: null },
    status: "missing",
  };
  const incomplete = {
    ...base,
    result_code: "recovery_incomplete",
    execution_status: "not_run",
    subjects: {
      database: partialSubject,
      storage: {
        backup: { status: "not_run", artifact_sha256: null },
        restore: { status: "not_run", verified_at: null },
        status: "missing",
      },
    },
    smoke: Object.fromEntries(Object.keys(base.smoke).map((key) => [key, "not_run"])),
    blockers: ["managed_drill_not_run"],
  };

  const { root, path } = await evidenceFile(incomplete);
  try {
    const evidence = await loadPlatformRecoveryEvidence({
      EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
      EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: path,
    }, { now: () => NOW });

    assert.equal(evidence.source, "failed");
    assert.equal(evidence.database.status, "failed");
    assert.equal(evidence.storage.status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("contradictory, malformed, future or oversized evidence fails closed", async () => {
  const invalidResults = [
    { ...readyResult(), result_code: "recovery_failed" },
    { ...readyResult(), observed_at: "2026-08-27T11:00:00Z" },
    { ...readyResult(), observed_at: "2099-01-01T00:00:00.000Z" },
    { ...readyResult(), secret_token: "must-not-be-read" },
  ];

  for (const result of invalidResults) {
    const { root, path } = await evidenceFile(result);
    try {
      const evidence = await loadPlatformRecoveryEvidence({
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: path,
      }, { now: () => NOW });
      assert.equal(evidence.source, "failed");
      assert.equal(evidence.database.status, "failed");
      assert.equal(evidence.storage.status, "failed");
      assert.equal(JSON.stringify(evidence).includes("must-not-be-read"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const { root, path } = await evidenceFile();
  try {
    await writeFile(path, "x".repeat(131_073), { mode: 0o600 });
    const evidence = await loadPlatformRecoveryEvidence({
      EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
      EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: path,
    }, { now: () => NOW });
    assert.equal(evidence.source, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("outside-root, prefix-confused and symlinked evidence paths fail closed", async () => {
  const { root, path } = await evidenceFile();
  const outsideRoot = `${root}-evil`;
  const symlinkRoot = join(root, "links");
  await mkdir(outsideRoot);
  await mkdir(symlinkRoot);
  const outsidePath = join(outsideRoot, "recovery.json");
  const symlinkPath = join(symlinkRoot, "recovery.json");
  await writeFile(outsidePath, `${JSON.stringify(readyResult())}\n`, { mode: 0o600 });
  await symlink(path, symlinkPath);

  try {
    for (const candidate of [outsidePath, symlinkPath]) {
      const evidence = await loadPlatformRecoveryEvidence({
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT: root,
        EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH: candidate,
      }, { now: () => NOW });
      assert.equal(evidence.source, "failed");
      assert.equal(evidence.database.status, "failed");
      assert.equal(evidence.storage.status, "failed");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
