import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildProductionSmokeReceipt,
  readProductionSmokeConfiguration,
  runProductionBrowserSmoke,
  writeProductionSmokeReceipt,
} from "../scripts/evo-production-browser-smoke.mjs";

const REVISION = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const smokeSource = readFileSync(
  new URL("../scripts/evo-production-browser-smoke.mjs", import.meta.url),
  "utf8",
);

function environment(receiptPath = "/tmp/evo-v3-browser-receipt.json") {
  return {
    EVO_RELEASE_EXTERNAL_HEALTH_URL: "https://crm.evoadmissions.com/api/health",
    EVO_PRODUCTION_SMOKE_ADMIN_EMAIL: "release-smoke@evo.invalid",
    EVO_PRODUCTION_SMOKE_ADMIN_PASSWORD: "not-a-real-secret",
    EVO_PRODUCTION_SMOKE_RECEIPT: receiptPath,
    EVO_RELEASE_ID: "v3-r100-a2-aaaaaaaa",
    EVO_RELEASE_REPOSITORY: "izzhackt/evo_AI_CRM",
    EVO_RELEASE_REVISION: REVISION,
    EVO_RELEASE_VERSION: "r100.2-aaaaaaaa",
    EVO_RELEASE_WORKFLOW_RUN_ID: "100",
    EVO_RELEASE_WORKFLOW_RUN_ATTEMPT: "2",
    EVO_RELEASE_ARTIFACT_ID: "900",
    EVO_RELEASE_ARTIFACT_DIGEST: DIGEST,
  };
}

test("browser receipt is a deterministic closed identity without credentials", () => {
  const config = readProductionSmokeConfiguration(environment());
  const receipt = buildProductionSmokeReceipt(config);
  assert.deepEqual(receipt, {
    schema: "evo-v3-browser-receipt/v1",
    releaseId: "v3-r100-a2-aaaaaaaa",
    repository: "izzhackt/evo_AI_CRM",
    revision: REVISION,
    workflowRunId: "100",
    workflowRunAttempt: "2",
    artifactId: "900",
    artifactDigest: DIGEST,
    result: "passed",
  });
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /email|password|cookie|session|secret/iu);
});

test("configuration is exact and rejects unsafe or normalized authority values", () => {
  for (const [name, value] of [
    ["EVO_RELEASE_EXTERNAL_HEALTH_URL", "http://crm.evoadmissions.com/api/health"],
    ["EVO_RELEASE_EXTERNAL_HEALTH_URL", "https://crm.evoadmissions.com/api/health?ok=1"],
    ["EVO_RELEASE_REVISION", REVISION.toUpperCase()],
    ["EVO_RELEASE_WORKFLOW_RUN_ATTEMPT", "02"],
    ["EVO_RELEASE_ARTIFACT_DIGEST", "b".repeat(64)],
    ["EVO_PRODUCTION_SMOKE_ADMIN_EMAIL", " release-smoke@evo.invalid"],
    ["EVO_PRODUCTION_SMOKE_RECEIPT", "relative.json"],
  ]) {
    assert.throws(() =>
      readProductionSmokeConfiguration({ ...environment(), [name]: value }),
    );
  }
});

test("receipt writer creates one private file and refuses replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evo-browser-receipt-"));
  const path = join(directory, "receipt.json");
  const receipt = buildProductionSmokeReceipt(
    readProductionSmokeConfiguration(environment(path)),
  );
  try {
    await writeProductionSmokeReceipt(path, receipt);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(await readFile(path, "utf8"), `${JSON.stringify(receipt)}\n`);
    await assert.rejects(writeProductionSmokeReceipt(path, receipt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("smoke signs in, proves V3 admin operations and exact release metadata", async () => {
  const calls = [];
  let written;
  let currentUrl = "https://crm.evoadmissions.com/login";
  const role = {
    async getAttribute(name) {
      return name === "data-role" || name === "data-authority-role" ? "admin" : null;
    },
  };
  const visible = { async waitFor(options) { calls.push(["visible", options.state]); } };
  const page = {
    async goto(url) {
      calls.push(["goto", url]);
      return { ok: () => true };
    },
    locator(selector) {
      return {
        async fill(value) { calls.push(["fill", selector, value]); },
        async click() { calls.push(["click", selector]); },
      };
    },
    async waitForURL(url) { calls.push(["waitForURL", url]); currentUrl = url; },
    url() { return currentUrl; },
    getByTestId(id) {
      calls.push(["testid", id]);
      return id === "active-role" ? role : visible;
    },
    async evaluate() {
      calls.push(["api-version"]);
      return {
        status: 200,
        body: { status: "available", revision: REVISION, version: "r100.2-aaaaaaaa" },
      };
    },
  };
  const chromiumRuntime = {
    async launch(options) {
      calls.push(["launch", options.headless]);
      return {
        async newContext(options) {
          calls.push(["context", options.acceptDownloads, options.serviceWorkers]);
          return {
            async newPage() { return page; },
            async close() { calls.push(["context-close"]); },
          };
        },
        async close() { calls.push(["browser-close"]); },
      };
    },
  };

  await runProductionBrowserSmoke({
    environment: environment(),
    chromiumRuntime,
    async writeReceipt(path, receipt) { written = { path, receipt }; },
  });

  assert.equal(written.path, "/tmp/evo-v3-browser-receipt.json");
  assert.equal(written.receipt.result, "passed");
  assert.deepEqual(calls.slice(0, 3), [
    ["launch", true],
    ["context", false, "block"],
    ["goto", "https://crm.evoadmissions.com/login"],
  ]);
  assert.ok(calls.some(([kind, value]) => kind === "testid" && value === "v3-shell"));
  assert.ok(
    calls.some(([kind, value]) => kind === "testid" && value === "v3-operational-dashboard"),
  );
  assert.ok(calls.some(([kind]) => kind === "api-version"));
  assert.deepEqual(calls.filter(([kind]) => kind === "click"), [
    ["click", 'form[aria-labelledby="login-title"] button[type="submit"]'],
  ]);
  assert.deepEqual(calls.slice(-2), [["context-close"], ["browser-close"]]);
});

test("unsafe login redirects are rejected before credentials are filled", async () => {
  for (const finalUrl of [
    "https://attacker.invalid/login",
    "https://crm.evoadmissions.com/unexpected",
    "https://user:pass@crm.evoadmissions.com/login",
  ]) {
    const calls = [];
    const chromiumRuntime = {
      async launch() {
        return {
          async newContext() {
            return {
              async newPage() {
                return {
                  async goto() { return { ok: () => true }; },
                  url() { return finalUrl; },
                  locator() {
                    return { async fill() { calls.push("fill"); } };
                  },
                };
              },
              async close() { calls.push("context-close"); },
            };
          },
          async close() { calls.push("browser-close"); },
        };
      },
    };
    await assert.rejects(runProductionBrowserSmoke({
      environment: environment(),
      chromiumRuntime,
      async writeReceipt() { calls.push("receipt"); },
    }), /login_origin_invalid/u);
    assert.deepEqual(calls, ["context-close", "browser-close"]);
  }
});

test("smoke has no business interaction or sensitive browser evidence path", () => {
  assert.equal((smokeSource.match(/\.click\(\)/gu) ?? []).length, 1);
  assert.match(smokeSource, /form\[aria-labelledby="login-title"\] button\[type="submit"\]/u);
  assert.doesNotMatch(smokeSource, /\.screenshot\(|tracing\.|storageState|\.cookies\(/u);
  assert.doesNotMatch(smokeSource, /waha|whatsapp|gemini|amocrm/iu);
});

test("CLI errors are sanitized and never echo missing credential names", () => {
  const script = new URL("../scripts/evo-production-browser-smoke.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(script)], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    '{"ok":false,"code":"production_browser_smoke_failed"}\n',
  );
});
