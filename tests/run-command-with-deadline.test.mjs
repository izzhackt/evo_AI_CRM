import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCommandWithDeadline } from "../scripts/run-command-with-deadline.mjs";

const deadlineRunnerPath = fileURLToPath(
  new URL("../scripts/run-command-with-deadline.mjs", import.meta.url),
);

test("executes through the physical CLI path and preserves child status", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "evo-deadline-cli-"));
  const markerPath = join(temporaryDirectory, "child-ran");

  try {
    const success = spawnSync(
      process.execPath,
      [
        deadlineRunnerPath,
        "1000",
        process.execPath,
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "ok")`,
      ],
      { encoding: "utf8" },
    );
    const failure = spawnSync(
      process.execPath,
      [
        deadlineRunnerPath,
        "1000",
        process.execPath,
        "-e",
        "process.exit(9)",
      ],
      { encoding: "utf8" },
    );

    assert.equal(success.status, 0, success.stderr);
    assert.equal(readFileSync(markerPath, "utf8"), "ok");
    assert.equal(failure.status, 9, failure.stderr);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("executes a child when the CLI is reached through a symlink", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "evo-deadline-link-"));
  const linkedRunnerPath = join(temporaryDirectory, "deadline-runner.mjs");
  const markerPath = join(temporaryDirectory, "child-ran");

  try {
    symlinkSync(deadlineRunnerPath, linkedRunnerPath);
    const result = spawnSync(
      process.execPath,
      [
        linkedRunnerPath,
        "1000",
        process.execPath,
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "ok")`,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(markerPath, "utf8"), "ok");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("propagates a failed child exit code through a CLI symlink", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "evo-deadline-link-"));
  const linkedRunnerPath = join(temporaryDirectory, "deadline-runner.mjs");

  try {
    symlinkSync(deadlineRunnerPath, linkedRunnerPath);
    const result = spawnSync(
      process.execPath,
      [
        linkedRunnerPath,
        "1000",
        process.execPath,
        "-e",
        "process.exit(7)",
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 7, result.stderr);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("preserves successful and failed child exit codes", async () => {
  assert.equal(
    await runCommandWithDeadline({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      timeoutMs: 1_000,
    }),
    0,
  );
  assert.equal(
    await runCommandWithDeadline({
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
      timeoutMs: 1_000,
    }),
    7,
  );
});

test("terminates a stuck process group at the configured deadline", async () => {
  const startedAt = performance.now();
  const exitCode = await runCommandWithDeadline({
    command: process.execPath,
    args: [
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 10_000)",
    ],
    timeoutMs: 100,
    terminationGraceMs: 40,
  });

  assert.equal(exitCode, 124);
  assert.ok(performance.now() - startedAt < 1_000);
});

test("waits for forced process-group termination after the leader exits", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "evo-deadline-group-"));
  const grandchildPidPath = join(temporaryDirectory, "grandchild.pid");
  const heartbeatPath = join(temporaryDirectory, "grandchild.heartbeat");
  let grandchildPid;

  try {
    const grandchildProgram = `
      const { appendFileSync } = require("node:fs");
      process.on("SIGTERM", () => {});
      appendFileSync(${JSON.stringify(heartbeatPath)}, "x");
      setInterval(
        () => appendFileSync(${JSON.stringify(heartbeatPath)}, "x"),
        20,
      );
    `;
    const leaderProgram = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const grandchild = spawn(process.execPath, [
        "-e",
        ${JSON.stringify(grandchildProgram)},
      ], { stdio: "ignore" });
      writeFileSync(${JSON.stringify(grandchildPidPath)}, String(grandchild.pid));
      process.on("SIGTERM", () => process.exit(0));
      setInterval(() => {}, 10000);
    `;

    const exitCode = await runCommandWithDeadline({
      command: process.execPath,
      args: ["-e", leaderProgram],
      // Allow a cold Node 22 process tree to reach the grandchild handshake on
      // loaded local Docker hosts before exercising group termination.
      timeoutMs: 1_000,
      terminationGraceMs: 100,
    });

    assert.equal(exitCode, 124);
    assert.equal(existsSync(grandchildPidPath), true);
    grandchildPid = Number(readFileSync(grandchildPidPath, "utf8"));
    assert.equal(Number.isSafeInteger(grandchildPid), true);
    assert.equal(existsSync(heartbeatPath), true);
    const heartbeatAtReturn = readFileSync(heartbeatPath, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(readFileSync(heartbeatPath, "utf8"), heartbeatAtReturn);
  } finally {
    if (Number.isSafeInteger(grandchildPid)) {
      try {
        process.kill(grandchildPid, "SIGKILL");
      } catch {
        // The expected path already removed the process group.
      }
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejects invalid command configuration without launching a child", async () => {
  let launched = false;
  const exitCode = await runCommandWithDeadline({
    command: "",
    timeoutMs: 0,
    spawnImpl: () => {
      launched = true;
    },
  });

  assert.equal(exitCode, 125);
  assert.equal(launched, false);
});
