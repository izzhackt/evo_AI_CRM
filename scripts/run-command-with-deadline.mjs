import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SIGNAL_EXIT_CODES = new Map([
  ["SIGINT", 130],
  ["SIGTERM", 143],
]);

const terminate = (child, signal) => {
  if (child.pid === undefined) return;

  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when the process group is already gone.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // The child may have exited between the readiness check and this signal.
  }
};

export function runCommandWithDeadline({
  command,
  args = [],
  timeoutMs,
  terminationGraceMs = 1_000,
  spawnImpl = spawn,
}) {
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== "string") ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(terminationGraceMs) ||
    terminationGraceMs < 1 ||
    typeof spawnImpl !== "function"
  ) {
    return Promise.resolve(125);
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        detached: process.platform !== "win32",
        stdio: "inherit",
      });
    } catch {
      resolve(125);
      return;
    }

    let settled = false;
    let timedOut = false;
    let deadlineTimer;
    let forceTimer;

    const cleanup = () => {
      clearTimeout(deadlineTimer);
      clearTimeout(forceTimer);
      process.off("SIGINT", forwardInterrupt);
      process.off("SIGTERM", forwardTermination);
    };

    const settle = (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(exitCode);
    };

    const forwardInterrupt = () => terminate(child, "SIGINT");
    const forwardTermination = () => terminate(child, "SIGTERM");

    process.once("SIGINT", forwardInterrupt);
    process.once("SIGTERM", forwardTermination);

    child.once("error", () => {
      if (!timedOut) settle(125);
    });
    child.once("exit", (code, signal) => {
      if (timedOut) {
        // The direct child can exit on SIGTERM while a grandchild in the same
        // detached process group keeps running. Keep the force timer armed so
        // the entire group receives SIGKILL before the wrapper returns 124.
        return;
      }
      if (Number.isInteger(code)) {
        settle(code);
        return;
      }
      settle(SIGNAL_EXIT_CODES.get(signal) ?? 1);
    });

    deadlineTimer = setTimeout(() => {
      timedOut = true;
      terminate(child, "SIGTERM");
      forceTimer = setTimeout(() => {
        terminate(child, "SIGKILL");
        child.unref();
        settle(124);
      }, terminationGraceMs);
    }, timeoutMs);
  });
}

const isDirectExecution = (() => {
  if (process.argv[1] === undefined) return false;

  try {
    return (
      realpathSync.native(fileURLToPath(import.meta.url)) ===
      realpathSync.native(process.argv[1])
    );
  } catch {
    // Do not execute commands when either path cannot be resolved to a real
    // file. Treating an unresolved path as direct execution could run this CLI
    // while it is being imported by another program.
    return false;
  }
})();

if (isDirectExecution) {
  const [timeoutRaw, command, ...args] = process.argv.slice(2);
  const timeoutMs = Number(timeoutRaw);
  const exitCode = await runCommandWithDeadline({ command, args, timeoutMs });
  process.exitCode = exitCode;
}
