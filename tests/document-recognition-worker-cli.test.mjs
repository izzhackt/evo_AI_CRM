import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseDocumentRecognitionWorkerCommand as parse,
  runDocumentRecognitionWorkerCli as run,
} from "../scripts/run-document-recognition-worker.ts";
import { buildDocumentRecognitionWorker } from "../scripts/build-document-recognition-worker.mjs";

// CLI/lifecycle unit boundaries and real no-config bundle processes only.
// No provider, database, Storage or native inspector acceptance is claimed.
const args = mode => ["--once", "--mode", mode, "--worker-id", "unit-worker"];
const idle = { outcome: "idle", job_id: null, state: null, failure_code: null };
function boundary() {
  const calls = [];
  const outputs = [];
  const deps = {
    rpc: async name => { calls.push(name); return null; },
    get loadSource() { throw new Error("source must not be accessed"); },
    get inspectSource() { throw new Error("inspector must not be accessed"); },
    providerFor: () => { throw new Error("provider must not be constructed for idle"); },
    now: Date.now,
  };
  return { calls, outputs, runtime: { createDependencies: () => deps, write: value => outputs.push(value) } };
}

test("CLI requires an explicit single mode, one tick and bounded valid identity/deadline", () => {
  assert.equal(parse(args("processing")).timeoutMs, 240_000);
  assert.equal(parse(args("cleanup")).timeoutMs, 90_000);
  assert.equal(parse([...args("cleanup"), "--timeout-ms", "10"]).timeoutMs, 10);
  for (const invalid of [[], ["--once"], args("other"), args("processing").slice(1),
    [...args("processing"), "--once"], [...args("processing"), "--mode", "cleanup"],
    [...args("processing"), "--model", "arbitrary"], [...args("cleanup"), "--timeout-ms", "90001"],
    [...args("processing"), "--timeout-ms", "240001"], [...args("processing"), "--timeout-ms", "0"],
    [...args("processing"), "--timeout-ms", "1.5"], [...args("cleanup"), "--timeout-ms", "-1"],
    [...args("cleanup"), "--timeout-ms"], ["--once", "--mode", "cleanup", "--worker-id", "bad id"]]) {
    assert.throws(() => parse(invalid), /invalid_arguments/);
  }
});

test("actual idle processing/cleanup orchestration makes exactly one matching claim", async () => {
  for (const mode of ["processing", "cleanup"]) {
    const b = boundary();
    assert.equal(await run(args(mode), b.runtime), 0);
    assert.deepEqual(b.calls, [mode === "processing" ? "claim_document_recognition" : "claim_document_recognition_cleanup"]);
    assert.deepEqual(b.outputs, [{ schema: "evo-document-recognition-worker/v1", mode,
      outcome: "idle", state: null, failure_code: null }]);
  }
});

test("settled failure, unknown deferral and unavailable outcomes remain distinguishable and never repeat", async () => {
  for (const [tick, expected] of [
    [{ ...idle, outcome: "settled", state: "review_ready" }, 0],
    [{ ...idle, outcome: "settled", state: "failed" }, 1],
    [{ ...idle, outcome: "settled", state: "publication_blocked" }, 1],
    [{ ...idle, outcome: "deferred", state: "generation_unknown" }, 75],
    [{ ...idle, outcome: "unavailable", failure_code: "workflow_unavailable" }, 69],
    [{ ...idle, outcome: "unavailable", failure_code: "provider_not_configured" }, 78],
  ]) {
    const b = boundary(); let count = 0;
    const code = await run(args("processing"), { ...b.runtime, processing: async () => {
      count++; return { ...tick, job_id: "private-id", extra: "credential-value" };
    } });
    assert.equal(code, expected); assert.equal(count, 1);
    assert.equal(b.outputs.length, 1);
    assert.doesNotMatch(JSON.stringify(b.outputs), /private-id|credential-value|extra/);
  }
  const b = boundary();
  assert.equal(await run(args("cleanup"), { ...b.runtime,
    cleanup: async () => ({ outcome: "settled", attempt_id: "private-id", cleanup_state: "confirmed_absent", failure_code: null }),
  }), 0);
  assert.equal(b.outputs[0].state, "confirmed_absent");
});

test("raw exceptions and unexpected result text are never logged", async () => {
  for (const processing of [async () => { throw new Error("credential-and-private-source"); },
    async () => ({ ...idle, state: "credential-and-private-source" })]) {
    const b = boundary();
    assert.equal(await run(args("processing"), { ...b.runtime, processing }), 69);
    assert.equal(b.outputs[0].failure_code, "workflow_unavailable");
    assert.doesNotMatch(JSON.stringify(b.outputs), /credential-and-private-source/);
  }
  const b = boundary();
  assert.equal(await run([...args("cleanup"), "--private-unknown"], {
    ...b.runtime, createDependencies() { assert.fail("invalid command constructed dependencies"); },
  }), 64);
  assert.deepEqual(b.calls, []);
});

test("deadline abort is propagated and a late settled result cannot become success", async () => {
  const b = boundary(); let count = 0; let observed;
  const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const result = await run([...args("processing"), "--timeout-ms", "10"], { ...b.runtime,
    processing: async (_id, _deps, signal) => {
      count++; observed = signal;
      await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      return { ...idle, outcome: "settled", state: "review_ready" };
    },
  });
  assert.equal(result, 124); assert.equal(count, 1); assert.equal(observed.aborted, true);
  assert.equal(b.outputs[0].outcome, "timed_out");
  assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], before);
});

async function childLifecycle({ signal, ignoreAbort = false }) {
  const script = `
    import { runDocumentRecognitionWorkerCli as run } from ${JSON.stringify(new URL("../scripts/run-document-recognition-worker.ts", import.meta.url).href)};
    process.exitCode = await run(${JSON.stringify([...args("processing"), "--timeout-ms", signal ? "5000" : "20"])}, {
      createDependencies: () => ({}),
      processing: async (_id, _deps, abort) => {
        process.stdout.write('started\\n');
        await new Promise(resolve => { if (!${ignoreAbort}) abort.addEventListener('abort', resolve, { once: true }); });
        return {outcome:'settled',job_id:null,state:'review_ready',failure_code:null};
      }
    });`;
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=react-server", "--experimental-strip-types", "--input-type=module", "-e", script], {
      env: { NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = ""; let sent = false;
    const killTimer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI exceeded its hard lifetime")); }, 10_000);
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (signal && !sent && stdout.includes("started\n")) { sent = true; child.kill(signal); }
    });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { clearTimeout(killTimer); reject(error); });
    child.on("close", (code, terminated) => {
      clearTimeout(killTimer);
      resolve({ code, terminated, stderr, report: JSON.parse(stdout.trim().split("\n").at(-1)) });
    });
  });
}

test("actual SIGINT and SIGTERM abort the tick with their own nonzero exit", async () => {
  for (const [signal, expected] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const result = await childLifecycle({ signal });
    assert.equal(result.code, expected); assert.equal(result.terminated, null);
    assert.equal(result.report.outcome, "interrupted");
  }
});

test("actual watchdog terminates an abort-ignoring operation after the deadline grace", async () => {
  const result = await childLifecycle({ ignoreAbort: true });
  assert.equal(result.code, 124); assert.equal(result.terminated, null);
  assert.equal(result.report.outcome, "timed_out");
});

test("actual standalone bundle runs without source/node_modules and fails closed before configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evo-recognition-cli-"));
  try {
    const bundle = join(directory, "worker.mjs");
    await buildDocumentRecognitionWorker(bundle);
    const invoke = (argv, env = {}) => spawnSync(process.execPath, [bundle, ...argv], {
      cwd: directory, env: { NODE_ENV: "production", ...env }, encoding: "utf8", timeout: 10_000,
    });
    const help = invoke(["--help"]);
    assert.equal(help.status, 0); assert.match(help.stdout, /^Usage:/);
    const invalid = invoke(args("invalid-private-mode"));
    assert.equal(invalid.status, 64);
    assert.equal(JSON.parse(invalid.stdout).failure_code, "invalid_arguments");
    assert.doesNotMatch(invalid.stdout + invalid.stderr, /invalid-private-mode/);
    for (const mode of ["processing", "cleanup"]) {
      const absent = invoke(args(mode));
      assert.equal(absent.status, 78, absent.stderr);
      assert.equal(JSON.parse(absent.stdout).failure_code, "provider_not_configured");
      const backend = invoke(args(mode), { EVO_PLATFORM_GEMINI_API_KEY: "synthetic-unused-key" });
      assert.equal(backend.status, 78, backend.stderr);
      assert.equal(JSON.parse(backend.stdout).failure_code, "backend_not_configured");
      assert.doesNotMatch(backend.stdout + backend.stderr, /synthetic-unused-key/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
