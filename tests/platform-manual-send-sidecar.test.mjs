import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createManualSendWorker,
  loadManualSendWorkerConfig,
} from "../scripts/manual-whatsapp-send-worker.mjs";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const NOW_MS = 1_787_010_000_000;
const HMAC_MATERIAL = ["synthetic", "sidecar", "trigger", "value", "only"].join("-");

function environment(overrides = {}) {
  return {
    EVO_MANUAL_SEND_WORKER_ENDPOINT:
      "http://evo-crm-app:3000/api/internal/platform-messaging/manual-send/work",
    EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET: HMAC_MATERIAL,
    ...overrides,
  };
}

test("sidecar config is fixed to the private CRM route", () => {
  const config = loadManualSendWorkerConfig(environment());
  assert.equal(config.intervalMs, 5_000);
  assert.equal(config.requestTimeoutMs, 10_000);
  assert.equal(config.heartbeatMaxAgeMs, 30_000);
  assert.throws(() =>
    loadManualSendWorkerConfig(
      environment({ EVO_MANUAL_SEND_WORKER_ENDPOINT: "https://example.com/work" }),
    ),
  );
});

test("one tick is bodyless, signed, sequential and refreshes its heartbeat", async () => {
  const calls = [];
  const heartbeats = [];
  const worker = createManualSendWorker({
    config: loadManualSendWorkerConfig(environment()),
    randomUuid: () => REQUEST_ID,
    nowMs: () => NOW_MS,
    async fetchImpl(url, init) {
      calls.push([url, init]);
      return Response.json({ ok: true, processed: false }, { status: 200 });
    },
    async writeHeartbeat(value) {
      heartbeats.push(value);
    },
  });

  const result = await worker.tick();
  assert.deepEqual(result, { status: "completed", httpStatus: 200 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].body, undefined);
  const timestamp = String(NOW_MS);
  const signature = createHmac("sha256", HMAC_MATERIAL)
    .update(`${REQUEST_ID}.${timestamp}`, "utf8")
    .digest("hex");
  assert.equal(calls[0][1].headers["x-evo-manual-send-request-id"], REQUEST_ID);
  assert.equal(calls[0][1].headers["x-evo-manual-send-timestamp"], timestamp);
  assert.equal(calls[0][1].headers["x-evo-manual-send-hmac"], signature);
  assert.deepEqual(heartbeats, [NOW_MS]);
});

test("an ambiguous transport failure stops without a second trigger", async () => {
  let fetchCalls = 0;
  let heartbeatCalls = 0;
  const worker = createManualSendWorker({
    config: loadManualSendWorkerConfig(environment()),
    randomUuid: () => REQUEST_ID,
    nowMs: () => NOW_MS,
    async fetchImpl() {
      fetchCalls += 1;
      throw new TypeError("synthetic connection loss");
    },
    async writeHeartbeat() {
      heartbeatCalls += 1;
    },
  });

  await assert.rejects(worker.run(), /manual-send trigger became ambiguous/);
  assert.equal(fetchCalls, 1);
  assert.equal(heartbeatCalls, 0);
});

test("production Compose owns one private sidecar with no public surface", async () => {
  const [compose, dockerfile] = await Promise.all([
    readFile(new URL("../docker-compose.prod.yml", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  ]);

  assert.match(compose, /manual-send-worker:\n[\s\S]*container_name: evo-crm-manual-send-worker/);
  assert.match(compose, /manual-send-worker:[\s\S]*image: "evo-crm:\$\{EVO_RELEASE_REVISION/);
  assert.match(compose, /manual-send-worker:[\s\S]*env_file:\n\s+- "\$\{EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE:-\.env\.manual-send-worker\}"/);
  assert.match(compose, /manual-send-worker:[\s\S]*command: \["node", "scripts\/manual-whatsapp-send-worker\.mjs"\]/);
  assert.match(compose, /manual-send-worker:[\s\S]*networks:\n\s+private:/);
  assert.doesNotMatch(
    compose.match(/manual-send-worker:[\s\S]*?(?=\n  [a-z]|\nvolumes:)/)?.[0] ?? "",
    /ports:|\bweb:/,
  );
  assert.match(dockerfile, /manual-whatsapp-send-worker\.mjs/);
});
