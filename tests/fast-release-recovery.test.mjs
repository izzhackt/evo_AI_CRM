// Split out of tests/fast-release-control.test.mjs (PLAN_CHANGES 22.11.2026): the slow release simulations are
// separate files, so the sharded CI runs them in parallel. Assertions are unchanged.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { createInterruptedReleaseFixture } from "./helpers/fast-release-fixtures.mjs";

test("manual recovery is state-bound and idempotent after no-EXIT interruptions", () => {
  const scenarios = [
    { killPoint: "after-scanner", previousScannerPresent: false, interruptedApp: "baseline" },
    { killPoint: "after-scanner", previousScannerPresent: true, interruptedApp: "baseline" },
    { killPoint: "mid-rollback", previousScannerPresent: false, interruptedApp: null },
    { killPoint: "mid-rollback", previousScannerPresent: true, interruptedApp: "target" },
  ];

  for (const scenario of scenarios) {
    const fixture = createInterruptedReleaseFixture(scenario);
    try {
      const sealed = spawnSync(
        "bash",
        ["scripts/release/evo-fast-release.sh", "seal-rollback-seed"],
        { encoding: "utf8", env: fixture.environment, timeout: 60_000 },
      );
      assert.equal(sealed.status, 0, `rollback seed failed: ${sealed.stderr}`);
      const interrupted = spawnSync(
        "bash",
        ["scripts/release/evo-fast-release.sh", "deploy"],
        { encoding: "utf8", env: fixture.environment, timeout: 60_000 },
      );
      assert.equal(
        interrupted.signal,
        "SIGKILL",
        `the ${scenario.killPoint}/${scenario.previousScannerPresent} fixture must bypass EXIT; status=${interrupted.status}; stderr=${interrupted.stderr}; stdout=${interrupted.stdout}`,
      );
      const interruptedRuntime = JSON.parse(readFileSync(fixture.statePath, "utf8"));
      assert.equal(interruptedRuntime.app, scenario.interruptedApp);
      assert.equal(interruptedRuntime.scanner, true);

      const releaseState = JSON.parse(readFileSync(fixture.releaseStatePath, "utf8"));
      assert.deepEqual(
        {
          previousImage: releaseState.previous.imageId,
          previousRevision: releaseState.previous.revision,
          previousScannerPresent: releaseState.previous.scannerPresent,
          previousVersion: releaseState.previous.version,
          schema: releaseState.schema,
          targetImage: releaseState.imageId,
          targetRevision: releaseState.revision,
          targetVersion: releaseState.version,
        },
        {
          previousImage: fixture.previousImage,
          previousRevision: fixture.previousRevision,
          previousScannerPresent: scenario.previousScannerPresent,
          previousVersion: fixture.previousVersion,
          schema: "evo-fast-release-state/v3",
          targetImage: fixture.targetImage,
          targetRevision: fixture.targetRevision,
          targetVersion: fixture.targetVersion,
        },
      );

      const recoveryEnvironment = {
        ...fixture.environment,
        EVO_RELEASE_ROLLBACK_EXPECTED_RELEASE_ID: releaseState.releaseId,
        EVO_RELEASE_ROLLBACK_STATE: fixture.releaseStatePath,
      };
      const recovery = spawnSync(
        "bash",
        ["scripts/release/evo-fast-release.sh", "rollback"],
        { encoding: "utf8", env: recoveryEnvironment, timeout: 60_000 },
      );
      assert.equal(recovery.status, 0, recovery.stderr);
      const recoveryResult = JSON.parse(recovery.stdout.trim());
      assert.deepEqual(
        { ok: recoveryResult.ok, command: recoveryResult.command, status: recoveryResult.status },
        { ok: true, command: "rollback", status: "rolled_back" },
      );
      const restoredRuntime = JSON.parse(readFileSync(fixture.statePath, "utf8"));
      assert.equal(restoredRuntime.app, "baseline");
      assert.equal(restoredRuntime.scanner, scenario.previousScannerPresent);

      if (scenario.killPoint === "after-scanner") {
        const repeated = spawnSync(
          "bash",
          ["scripts/release/evo-fast-release.sh", "rollback"],
          { encoding: "utf8", env: recoveryEnvironment, timeout: 60_000 },
        );
        assert.equal(repeated.status, 0, repeated.stderr);
        assert.equal(JSON.parse(repeated.stdout.trim()).status, "rolled_back");
      }

      if (scenario.killPoint === "after-scanner" && !scenario.previousScannerPresent) {
        writeFileSync(fixture.statePath, JSON.stringify({
          ...restoredRuntime,
          app: "unrelated",
        }));
        const unrelatedApp = spawnSync(
          "bash",
          ["scripts/release/evo-fast-release.sh", "rollback"],
          { encoding: "utf8", env: recoveryEnvironment, timeout: 60_000 },
        );
        assert.equal(unrelatedApp.status, 2);
        assert.match(unrelatedApp.stderr, /rollback_failed/u);

        writeFileSync(fixture.statePath, JSON.stringify({
          ...restoredRuntime,
          scanner: true,
          scannerImage: `unrelated/scanner@sha256:${"f".repeat(64)}`,
        }));
        const unrelatedScanner = spawnSync(
          "bash",
          ["scripts/release/evo-fast-release.sh", "rollback"],
          { encoding: "utf8", env: recoveryEnvironment, timeout: 60_000 },
        );
        assert.equal(unrelatedScanner.status, 2);
        assert.match(unrelatedScanner.stderr, /rollback_(?:failed|scanner_mismatch)/u);

        const draftV2State = { ...releaseState, schema: "evo-fast-release-state/v2" };
        writeFileSync(fixture.releaseStatePath, JSON.stringify(draftV2State), { mode: 0o600 });
        const rejectedDraft = spawnSync(
          "bash",
          ["scripts/release/evo-fast-release.sh", "rollback"],
          { encoding: "utf8", env: recoveryEnvironment, timeout: 60_000 },
        );
        assert.equal(rejectedDraft.status, 2);
        assert.match(rejectedDraft.stderr, /rollback_state_contract_invalid/u);
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
