// Split out of tests/fast-release-control.test.mjs (PLAN_CHANGES 22.11.2026): the slow release simulations are
// separate files, so the sharded CI runs them in parallel. Assertions are unchanged.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  sha256,
  writeExecutable,
  FAKE_APP_LOG_STDOUT,
  FAKE_APP_LOG_STDERR,
  FAKE_APP_LOG_ERROR,
  aiAgentReleaseFixture,
  PREVIOUS_APP_LOG_RECORD_KEYS,
  privateMode,
  assertSingleDeployResult,
  leftoverLogTemporaries,
} from "./helpers/fast-release-fixtures.mjs";

test("release controller requires Docker Compose 2.30 or later and reads the version safely", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const failHelper = controller.slice(controller.indexOf("fail() {"), controller.indexOf("require_command() {"));
  const constants = controller.match(
    /^readonly COMPOSE_MIN_MAJOR=.*\nreadonly COMPOSE_MIN_MINOR=.*\nreadonly COMPOSE_VERSION_RE=.*$/mu,
  )?.[0];
  const gate = controller.slice(controller.indexOf("verify_compose_version() {"), controller.indexOf("preflight() {"));
  assert.ok(failHelper.startsWith("fail() {") && constants && gate.startsWith("verify_compose_version() {"),
    "the actual version gate must exist");
  const root = mkdtempSync(join(tmpdir(), "evo-compose-version-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeExecutable(join(bin, "docker"), `#!/usr/bin/env bash
[[ $* == "compose version --short" ]] || exit 64
printf '%s' "$FAKE_OUTPUT"
exit "$FAKE_STATUS"
`);
  try {
    for (const [output, status, expected] of [
      ["5.1.2\n", 0, "ok"], // hermes, read on 2026-10-06
      ["2.30.0\n", 0, "ok"],
      ["v2.30.0\n", 0, "ok"],
      ["2.30.3-desktop.1\n", 0, "ok"],
      ["2.100.0\n", 0, "ok"],
      ["3.0.0\n", 0, "ok"],
      ["10.0.0\n", 0, "ok"],
      ["2.29.9\n", 0, "compose_version_unsupported"],
      ["2.3.0\n", 0, "compose_version_unsupported"],
      ["1.99.0\n", 0, "compose_version_unsupported"],
      ["0.30.0\n", 0, "compose_version_unsupported"],
      ["", 0, "compose_version_unreadable"],
      ["5.1.2\n", 1, "compose_version_unreadable"],
      ["2.30\n", 0, "compose_version_unreadable"],
      ["2.030.0\n", 0, "compose_version_unreadable"],
      [" 5.1.2\n", 0, "compose_version_unreadable"],
      ["5.1.2 \n", 0, "compose_version_unreadable"],
      ["Docker Compose version v5.1.2\n", 0, "compose_version_unreadable"],
      ["2.31.0\n2.29.0\n", 0, "compose_version_unreadable"],
      ["99999.0.0\n", 0, "compose_version_unreadable"],
      ["5.1.2;id\n", 0, "compose_version_unreadable"],
    ]) {
      const result = spawnSync("bash", ["-c", `set -Eeuo pipefail\n${failHelper}\n${constants}\n${gate}\nverify_compose_version`], {
        env: { PATH: `${bin}:/usr/bin:/bin`, FAKE_OUTPUT: output, FAKE_STATUS: String(status) },
        encoding: "utf8",
      });
      const label = JSON.stringify([output, status]);
      if (expected === "ok") {
        assert.equal(result.status, 0, `${label}: ${result.stderr}`);
        assert.equal(result.stderr, "", label);
      } else {
        assert.equal(result.status, 2, label);
        assert.equal(result.stderr, `{"ok":false,"code":"${expected}"}\n`, label);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("every release refuses an old Docker Compose before any change; rollback is never gated", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const body = (name, next) => controller.slice(controller.indexOf(`${name}() {`), controller.indexOf(`${next}() {`));
  for (const [name, next] of [["preflight", "sync_file_and_parent"], ["deploy", "manual_rollback"]]) {
    assert.match(body(name, next), /^\s+load_candidate_configuration\n\s+verify_compose_version\n\s+acquire_release_lock$/mu, name);
  }
  for (const [name, next] of [["manual_rollback", "rollback_pending_candidate"], ["rollback_from_state", "load_bound_release_state"],
    ["seal_rollback_seed", "prepare_candidate_generation"], ["accept_candidate", "disarm_release_mutation_trap"]]) {
    assert.doesNotMatch(body(name, next), /verify_compose_version/u, name);
  }
  assert.doesNotMatch(controller.slice(controller.indexOf("rollback_pending_candidate() {")), /verify_compose_version/u);

  for (const enabled of [false, true]) {
    const fixture = aiAgentReleaseFixture({ enabled });
    try {
      assert.equal(fixture.run("seal-rollback-seed").status, 0);
      for (const command of ["preflight", "deploy"]) {
        const callsBefore = fixture.dockerCalls().length;
        const evidenceBefore = readdirSync(fixture.evidenceRoot).sort();
        const refused = fixture.run(command, { FAKE_COMPOSE_VERSION: "2.29.9" });
        assert.equal(refused.status, 2, `${command}/${enabled}: ${refused.stderr}`);
        assert.equal(refused.stderr, '{"ok":false,"code":"compose_version_unsupported"}\n');
        assert.equal(refused.stdout, "");
        assert.deepEqual(fixture.dockerCalls().slice(callsBefore), [["compose", "version", "--short"]]);
        assert.deepEqual(readdirSync(fixture.evidenceRoot).sort(), evidenceBefore);
        const unreadable = fixture.run(command, { FAKE_COMPOSE_VERSION_FAIL: "1" });
        assert.equal(unreadable.stderr, '{"ok":false,"code":"compose_version_unreadable"}\n');
      }
      assert.equal(fixture.runtime().app, "baseline");
      const preflight = fixture.run("preflight", { FAKE_COMPOSE_VERSION: "2.30.0" });
      assert.equal(preflight.status, 0, preflight.stderr);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
test("release controller keeps the outgoing app log as best-effort private evidence", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const deploy = controller.slice(controller.indexOf("deploy() {"), controller.indexOf("manual_rollback() {"));
  const saver = controller.slice(
    controller.indexOf("previous_app_logs_warning() {"),
    controller.indexOf("create_rollback_wrapper() {"),
  );
  assert.match(controller, /^readonly PREVIOUS_APP_LOG_TAIL_LINES=20000$/mu);
  // After every check and the scanner, right before the app is replaced, and never fatal.
  assert.match(
    deploy,
    /\n  provision_scanner_runtime\n(?:  #[^\n]*\n)*  save_previous_app_logs "\$release_evidence_dir" "\$current_app_container_id" \|\| true\n  if EVO_RELEASE_REVISION=/u,
  );
  assert.ok(deploy.indexOf("save_previous_app_logs") > deploy.indexOf("arm_release_mutation_trap"));
  assert.ok(deploy.indexOf("save_previous_app_logs") < deploy.indexOf("compose up --detach"));
  assert.match(saver, /docker logs --timestamps --tail "\$PREVIOUS_APP_LOG_TAIL_LINES" "\$container" >"\$temporary" 2>&1/u);
  assert.match(saver, /chmod 600 "\$temporary"/u);
  // Nothing that can exit, roll back, read the environment or print a log line.
  assert.doesNotMatch(saver, /\bfail\b|\brequire_[a-z_]+|docker inspect|Config\.Env|\bexit\b/u);
  assert.doesNotMatch(saver, /\bcat\b|\btee\b|--follow|\brm\b/u);
  // The rollback paths never touch the saved log.
  const rollback = controller.slice(controller.indexOf("rollback_from_state() {"), controller.indexOf("load_bound_release_state() {"));
  assert.doesNotMatch(rollback, /previous-app-log|save_previous_app_logs/u);
});
test("deploy saves the outgoing app log root-only before replacing it and prints none of it", () => {
  const fixture = aiAgentReleaseFixture({ enabled: false });
  try {
    assert.equal(fixture.run("seal-rollback-seed").status, 0);
    const deployed = fixture.run("deploy");
    assert.equal(deployed.status, 0, deployed.stderr);
    assertSingleDeployResult(deployed, fixture.releaseDir, fixture.releaseId);
    assert.equal(deployed.stderr, "");
    assert.equal(fixture.runtime().app, "target");

    const expected = FAKE_APP_LOG_STDOUT + FAKE_APP_LOG_STDERR;
    const logPath = join(fixture.releaseDir, "previous-app.log");
    const recordPath = join(fixture.releaseDir, "previous-app-log.json");
    // Exactly the container's two streams: no inspect output, environment or controller text.
    assert.equal(readFileSync(logPath, "utf8"), expected);
    assert.equal(privateMode(logPath), 0o600);
    assert.equal(privateMode(fixture.releaseDir), 0o700);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    assert.deepEqual(Object.keys(record).sort(), PREVIOUS_APP_LOG_RECORD_KEYS);
    assert.deepEqual(record, {
      schema: "evo-previous-app-log/v1", status: "saved", code: "saved", log: "previous-app.log",
      containerId: "a0a0a0a0a0a0", tailLines: 20000, bytes: Buffer.byteLength(expected), sha256: sha256(expected),
    });
    assert.equal(privateMode(recordPath), 0o600);
    assert.deepEqual(leftoverLogTemporaries(fixture.releaseDir), []);
    for (const line of [FAKE_APP_LOG_STDOUT, FAKE_APP_LOG_STDERR]) {
      assert.ok(!deployed.stdout.includes(line.trim()) && !deployed.stderr.includes(line.trim()));
    }

    const calls = fixture.dockerCalls();
    const logCalls = calls.filter((call) => call[0] === "logs");
    assert.deepEqual(logCalls, [["logs", "--timestamps", "--tail", "20000", "a0a0a0a0a0a0"]]);
    const logRead = calls.findIndex((call) => call[0] === "logs");
    const scannerUp = calls.findIndex((call) => call[0] === "compose" && call.includes("up") && call.at(-1) === "clamav");
    const appUp = calls.findIndex((call) => call[0] === "compose" && call.includes("up") && call.at(-1) === "app");
    assert.ok(scannerUp >= 0 && scannerUp < logRead && logRead < appUp, JSON.stringify(calls));

    // The saved log is evidence only: status and rollback stay exactly as before.
    assert.equal(JSON.parse(fixture.run("candidate-status").stdout).status, "pending");
    const rolledBack = fixture.run("rollback", fixture.rollbackEnvironment);
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    assert.equal(fixture.runtime().app, "baseline");
    assert.equal(readFileSync(logPath, "utf8"), expected);
    assert.equal(fixture.dockerCalls().filter((call) => call[0] === "logs").length, 1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("a failed log copy only warns: the release still deploys, verifies and rolls back", () => {
  for (const [mode, expected] of [
    ["error", { status: "incomplete", code: "previous_app_logs_incomplete", content: FAKE_APP_LOG_ERROR }],
    ["silent", { status: "failed", code: "previous_app_logs_unavailable", content: null }],
  ]) {
    const fixture = aiAgentReleaseFixture({ enabled: false });
    try {
      assert.equal(fixture.run("seal-rollback-seed").status, 0);
      const deployed = fixture.run("deploy", { FAKE_APP_LOGS: mode });
      assert.equal(deployed.status, 0, `${mode}: ${deployed.stderr}`);
      assertSingleDeployResult(deployed, fixture.releaseDir, fixture.releaseId);
      assert.equal(deployed.stderr, `{"ok":true,"warning":"${expected.code}"}\n`, mode);
      assert.equal(fixture.runtime().app, "target", mode);
      const result = JSON.parse(readFileSync(join(fixture.releaseDir, "result.json"), "utf8"));
      assert.equal(result.status, "pending", mode);
      assert.equal(result.code, "verified", mode);

      const logPath = join(fixture.releaseDir, "previous-app.log");
      const record = JSON.parse(readFileSync(join(fixture.releaseDir, "previous-app-log.json"), "utf8"));
      if (expected.content === null) {
        assert.equal(existsSync(logPath), false, mode);
        assert.deepEqual(record, {
          schema: "evo-previous-app-log/v1", status: expected.status, code: expected.code, log: "",
          containerId: "a0a0a0a0a0a0", tailLines: 20000, bytes: 0, sha256: "",
        });
      } else {
        // What Docker wrote before failing is kept, root-only, and named incomplete.
        assert.equal(readFileSync(logPath, "utf8"), expected.content, mode);
        assert.equal(privateMode(logPath), 0o600, mode);
        assert.deepEqual(record, {
          schema: "evo-previous-app-log/v1", status: expected.status, code: expected.code, log: "previous-app.log",
          containerId: "a0a0a0a0a0a0", tailLines: 20000, bytes: Buffer.byteLength(expected.content),
          sha256: sha256(expected.content),
        });
      }
      assert.deepEqual(leftoverLogTemporaries(fixture.releaseDir), [], mode);
      const rolledBack = fixture.run("rollback", fixture.rollbackEnvironment);
      assert.equal(rolledBack.status, 0, `${mode}: ${rolledBack.stderr}`);
      assert.equal(fixture.runtime().app, "baseline", mode);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
test("the log copy returns success under errexit for an absent app, a foreign id and an unwritable directory", () => {
  const controller = readFileSync("scripts/release/evo-fast-release.sh", "utf8");
  const constants = controller.match(/^readonly HASH64_RE=.*$/mu)?.[0] + "\n"
    + controller.match(/^readonly PREVIOUS_APP_LOG_TAIL_LINES=.*$/mu)?.[0];
  const helpers = controller.slice(controller.indexOf("sync_file_and_parent() {"), controller.indexOf("replace_json_atomically() {"))
    + controller.slice(controller.indexOf("previous_app_logs_warning() {"), controller.indexOf("create_rollback_wrapper() {"));
  assert.match(helpers, /^sync_file_and_parent\(\) \{[\s\S]*create_once_json\(\) \{[\s\S]*save_previous_app_logs\(\) \{/u);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "evo-previous-app-log-")));
  const bin = join(root, "bin");
  mkdirSync(bin, { mode: 0o700 });
  const dockerLog = join(root, "docker.log");
  writeExecutable(join(bin, "docker"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(dockerLog)}\nprintf 'line\\n'\n`);
  // No `|| true` here: the function itself must return 0 with errexit on.
  const run = (directory, container) => spawnSync("bash", ["-c",
    `set -Eeuo pipefail\numask 077\n${constants}\n${helpers}\nsave_previous_app_logs "$1" "$2"\nprintf 'continued\\n'`,
    "bash", directory, container,
  ], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` } });
  const record = (directory) => JSON.parse(readFileSync(join(directory, "previous-app-log.json"), "utf8"));
  try {
    const absent = join(root, "absent");
    mkdirSync(absent, { mode: 0o700 });
    const first = run(absent, "");
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, "continued\n");
    assert.equal(first.stderr, "");
    assert.equal(record(absent).status, "absent");
    assert.equal(record(absent).code, "previous_app_absent");
    assert.equal(existsSync(join(absent, "previous-app.log")), false);

    const foreign = join(root, "foreign");
    mkdirSync(foreign, { mode: 0o700 });
    const injected = run(foreign, "--follow");
    assert.equal(injected.status, 0, injected.stderr);
    assert.equal(injected.stdout, "continued\n");
    assert.equal(injected.stderr, '{"ok":true,"warning":"previous_app_logs_container_invalid"}\n');
    assert.equal(record(foreign).code, "previous_app_logs_container_invalid");
    assert.equal(existsSync(dockerLog), false, "an invalid id never reaches Docker");

    if (typeof process.getuid === "function" && process.getuid() !== 0) {
      const locked = join(root, "locked");
      mkdirSync(locked, { mode: 0o500 });
      const unwritable = run(locked, "a0a0a0a0a0a0");
      assert.equal(unwritable.status, 0, unwritable.stderr);
      assert.equal(unwritable.stdout, "continued\n");
      assert.equal(
        unwritable.stderr,
        '{"ok":true,"warning":"previous_app_logs_record_failed"}\n{"ok":true,"warning":"previous_app_logs_create_failed"}\n',
      );
      assert.deepEqual(readdirSync(locked), []);
      chmodSync(locked, 0o700);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
