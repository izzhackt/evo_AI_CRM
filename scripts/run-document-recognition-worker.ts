import { existsSync, realpathSync, writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DOCUMENT_RECOGNITION_STATES, DOCUMENT_RECOGNITION_CLEANUP_STATES,
  DOCUMENT_RECOGNITION_FAILURE_CODES,
} from "../src/lib/document-recognition.ts";
import { inspectDocumentSource } from "../src/lib/server/document-source-preflight.ts";
import {
  createDocumentRecognitionWorkerDependencies,
  runDocumentRecognitionProcessingOnce, runDocumentRecognitionCleanupOnce,
  type DocumentRecognitionTickResult, type DocumentRecognitionCleanupTickResult,
} from "../src/lib/server/document-recognition-worker.ts";
import { DocumentRecognitionProviderError } from "../src/lib/server/gemini-document-recognition.ts";
import { PlatformSupabaseBackendConfigurationError } from "../src/lib/server/platform-supabase-backend-config.ts";

type Mode = "processing" | "cleanup";
type Command = Readonly<{ mode: Mode; workerId: string; timeoutMs: number }>;
type Summary = Readonly<{
  schema: "evo-document-recognition-worker/v1"; mode: Mode | null;
  outcome: "idle" | "settled" | "deferred" | "unavailable" | "timed_out" | "interrupted";
  state: string | null; failure_code: string | null;
}>;
type Runtime = Readonly<{
  createDependencies: () => ReturnType<typeof createDocumentRecognitionWorkerDependencies>;
  processing: typeof runDocumentRecognitionProcessingOnce;
  cleanup: typeof runDocumentRecognitionCleanupOnce;
  write: (summary: Summary) => void;
}>;
const LIMITS = { processing: 240_000, cleanup: 90_000 } as const;
const ABORT_GRACE_MS = 5_000;
const USAGE = "Usage: node document-recognition-worker.mjs --once --mode processing|cleanup --worker-id <id> [--timeout-ms <ms>]\n";
const DEFAULT_RUNTIME: Runtime = {
  createDependencies: () => createDocumentRecognitionWorkerDependencies(inspectDocumentSource),
  processing: runDocumentRecognitionProcessingOnce,
  cleanup: runDocumentRecognitionCleanupOnce,
  write: summary => { writeSync(1, `${JSON.stringify(summary)}\n`); },
};

export function parseDocumentRecognitionWorkerCommand(args: readonly string[]): Command {
  const values = new Map<string, string>();
  let once = false;
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--once" && !once) { once = true; continue; }
    if (!["--mode", "--worker-id", "--timeout-ms"].includes(name) || values.has(name)) throw new Error("invalid_arguments");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("invalid_arguments");
    values.set(name, value);
  }
  const mode = values.get("--mode");
  const workerId = values.get("--worker-id") ?? "";
  if (!once || (mode !== "processing" && mode !== "cleanup") || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(workerId)) {
    throw new Error("invalid_arguments");
  }
  const timeout = values.get("--timeout-ms");
  if (timeout !== undefined && !/^[1-9][0-9]*$/.test(timeout)) throw new Error("invalid_arguments");
  const timeoutMs = timeout === undefined ? LIMITS[mode] : Number(timeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > LIMITS[mode]) throw new Error("invalid_arguments");
  return { mode, workerId, timeoutMs };
}

function summary(mode: Mode | null, outcome: Summary["outcome"], state: string | null, failure_code: string | null): Summary {
  return { schema: "evo-document-recognition-worker/v1", mode, outcome, state, failure_code };
}

function tickSummary(mode: Mode, tick: DocumentRecognitionTickResult | DocumentRecognitionCleanupTickResult): Summary {
  const state = "cleanup_state" in tick ? tick.cleanup_state : tick.state;
  const states: readonly string[] = mode === "cleanup" ? DOCUMENT_RECOGNITION_CLEANUP_STATES : DOCUMENT_RECOGNITION_STATES;
  const failures: readonly string[] = [...DOCUMENT_RECOGNITION_FAILURE_CODES, "claim_unavailable", "workflow_unavailable"];
  if (!["idle", "settled", "deferred", "unavailable"].includes(tick.outcome)
    || (state !== null && !states.includes(state))
    || (tick.failure_code !== null && !failures.includes(tick.failure_code))) {
    return summary(mode, "unavailable", null, "workflow_unavailable");
  }
  return summary(mode, tick.outcome, state, tick.failure_code);
}

function exitCode(value: Summary): number {
  if (value.failure_code === "provider_not_configured" || value.failure_code === "backend_not_configured") return 78;
  if (value.outcome === "unavailable") return 69;
  if (value.outcome === "deferred") return 75;
  if (value.outcome === "settled" && value.state !== "review_ready" && value.state !== "confirmed_absent") return 1;
  return 0;
}

/** One awaited tick. Runtime injection is a unit-test seam, never a CLI option. */
export async function runDocumentRecognitionWorkerCli(args: readonly string[], overrides: Partial<Runtime> = {}): Promise<number> {
  const runtime = { ...DEFAULT_RUNTIME, ...overrides };
  if (args.length === 1 && args[0] === "--help") { writeSync(1, USAGE); return 0; }
  let command: Command;
  try { command = parseDocumentRecognitionWorkerCommand(args); }
  catch { runtime.write(summary(null, "unavailable", null, "invalid_arguments")); return 64; }

  const controller = new AbortController();
  let stopReason: "deadline" | "SIGINT" | "SIGTERM" | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let emitted = false;
  const emit = (value: Summary) => { if (!emitted) { emitted = true; runtime.write(value); } };
  const stopped = () => summary(command.mode, stopReason === "deadline" ? "timed_out" : "interrupted", null,
    stopReason === "deadline" ? "deadline_exceeded" : "interrupted");
  const stoppedCode = () => stopReason === "deadline" ? 124 : stopReason === "SIGINT" ? 130 : 143;
  const stop = (reason: NonNullable<typeof stopReason>) => {
    if (stopReason !== null) return;
    stopReason = reason;
    controller.abort();
    // A provider may ignore cancellation. Never leave that promise alive forever.
    watchdog = setTimeout(() => { emit(stopped()); process.exit(stoppedCode()); }, ABORT_GRACE_MS);
  };
  const sigint = () => stop("SIGINT");
  const sigterm = () => stop("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  const deadline = setTimeout(() => stop("deadline"), command.timeoutMs);
  try {
    const deps = runtime.createDependencies();
    const tick = command.mode === "processing"
      ? await runtime.processing(command.workerId, deps, controller.signal)
      : await runtime.cleanup(command.workerId, deps, controller.signal);
    if (stopReason !== null) { emit(stopped()); return stoppedCode(); }
    const value = tickSummary(command.mode, tick);
    emit(value);
    return exitCode(value);
  } catch (error) {
    if (stopReason !== null) { emit(stopped()); return stoppedCode(); }
    const code = error instanceof DocumentRecognitionProviderError && error.code === "provider_not_configured"
      ? "provider_not_configured" : error instanceof PlatformSupabaseBackendConfigurationError
        ? "backend_not_configured" : "workflow_unavailable";
    const value = summary(command.mode, "unavailable", null, code);
    emit(value);
    return exitCode(value);
  } finally {
    clearTimeout(deadline);
    if (watchdog) clearTimeout(watchdog);
    controller.abort();
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDocumentRecognitionWorkerCli(process.argv.slice(2));
}
