import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { beforeEach } from "node:test";

import { settingsBlockedWahaDetail } from "../src/lib/v3/wording.ts";
import { isFreshWorkingWahaSession } from "../src/lib/provider-display-status.ts";
import { platformWahaHealthDisplayStatus } from "../src/lib/server/platform-provider-readiness.ts";
import {
  PLATFORM_WAHA_LIVE_PROBE_TIMEOUT_MS,
  PLATFORM_WAHA_LIVE_PROBE_TTL_MS,
  PLATFORM_WAHA_UNREACHABLE_STATUS,
  probePlatformWahaSessionLive,
  resetPlatformWahaLiveProbeCacheForTests,
  withLivePlatformWahaHealth,
} from "../src/lib/server/platform-waha-live-health.ts";

const ORGANIZATION_ID = "77200000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION_ID = "77200000-0000-4000-8000-000000000002";
const SYNTHETIC_HEADER = "synthetic-header-value-123456";
const RUNTIME = Object.freeze({
  wahaSessionName: "crm_primary",
  wahaBaseUrl: "http://evo-crm-waha:3000",
  wahaApiKey: SYNTHETIC_HEADER,
  bindingVersion: "3",
});
const NOW = new Date("2026-10-03T10:00:00.000Z");

beforeEach(() => resetPlatformWahaLiveProbeCacheForTests());

function sessionResponse(status, extra = {}, init = {}) {
  return new Response(
    JSON.stringify({
      name: "crm_primary",
      status,
      me: { id: "79990000000@c.us", pushName: "Sales" },
      engine: { engine: "GOWS" },
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" }, ...init },
  );
}

function dependencies(fetchImpl, overrides = {}) {
  return {
    resolveRuntime: async () => RUNTIME,
    fetch: fetchImpl,
    createTimeoutSignal: (timeoutMs) => ({ timeoutMs }),
    now: () => NOW,
    ...overrides,
  };
}

test("live probe: WORKING makes one authenticated GET and reports a fresh connected session without leaking the key", async () => {
  const calls = [];
  const result = await probePlatformWahaSessionLive(
    ORGANIZATION_ID,
    dependencies(async (url, init) => {
      calls.push({ url, init });
      return sessionResponse("WORKING");
    }),
  );

  assert.deepEqual(result, {
    sessionName: "crm_primary",
    status: "WORKING",
    observedAt: NOW.toISOString(),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://evo-crm-waha:3000/api/sessions/crm_primary");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers["X-Api-Key"], SYNTHETIC_HEADER);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.signal, {
    timeoutMs: PLATFORM_WAHA_LIVE_PROBE_TIMEOUT_MS,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(SYNTHETIC_HEADER), false);
  assert.equal(serialized.includes("79990000000"), false, "no account data");

  // The same observation drives the settings table and the inbox banner.
  assert.equal(platformWahaHealthDisplayStatus(result, NOW.getTime()), "ready");
  assert.equal(isFreshWorkingWahaSession(result, NOW.getTime()), true);
});

test("live probe: every non-working WAHA status is reported as it is and is not shown as connected", async () => {
  for (const [status, detail] of [
    ["SCAN_QR_CODE", "Требуется подключение WhatsApp по QR-коду."],
    ["STARTING", "Подключение запускается."],
    ["STOPPED", "Подключение остановлено."],
    ["FAILED", "Ошибка подключения."],
  ]) {
    resetPlatformWahaLiveProbeCacheForTests();
    const result = await probePlatformWahaSessionLive(
      ORGANIZATION_ID,
      dependencies(async () => sessionResponse(status)),
    );
    assert.equal(result.status, status);
    assert.equal(result.observedAt, NOW.toISOString());
    assert.equal(platformWahaHealthDisplayStatus(result, NOW.getTime()), "blocked", status);
    assert.equal(isFreshWorkingWahaSession(result, NOW.getTime()), false, status);
    assert.equal(settingsBlockedWahaDetail(result.status), detail, status);
  }
  // A status WAHA adds later is passed on and shown as unconfirmed, not as working.
  const unknown = await probePlatformWahaSessionLive(
    OTHER_ORGANIZATION_ID,
    dependencies(async () => sessionResponse("PAUSED")),
  );
  assert.equal(unknown.status, "PAUSED");
  assert.equal(
    settingsBlockedWahaDetail(unknown.status),
    "Состояние подключения не подтверждено.",
  );
});

test("live probe: a timeout, a network failure and a WAHA server error are reported as unreachable", async () => {
  for (const fetchImpl of [
    async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    },
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => new Response("bad gateway", { status: 502 }),
  ]) {
    resetPlatformWahaLiveProbeCacheForTests();
    const result = await probePlatformWahaSessionLive(
      ORGANIZATION_ID,
      dependencies(fetchImpl),
    );
    assert.deepEqual(result, {
      sessionName: "crm_primary",
      status: PLATFORM_WAHA_UNREACHABLE_STATUS,
      observedAt: NOW.toISOString(),
    });
    assert.equal(platformWahaHealthDisplayStatus(result, NOW.getTime()), "blocked");
  }
  assert.equal(
    settingsBlockedWahaDetail(PLATFORM_WAHA_UNREACHABLE_STATUS),
    "Сервис WhatsApp не отвечает.",
  );
});

test("live probe: when it cannot say, it claims nothing and the recorded status stays", async () => {
  const recorded = Object.freeze({
    sessionName: "crm_primary",
    status: "WORKING",
    observedAt: "2026-10-03T09:58:00.000Z",
  });
  const cases = {
    "no runtime binding": dependencies(async () => {
      throw new Error("fetch must not run");
    }, {
      resolveRuntime: async () => {
        throw new Error("Platform provider workflow is unavailable.");
      },
    }),
    "rejected key": dependencies(async () => new Response("{}", { status: 401 })),
    "forbidden key": dependencies(async () => new Response("{}", { status: 403 })),
    "unknown session": dependencies(async () => new Response("{}", { status: 404 })),
    "another session": dependencies(async () =>
      sessionResponse("WORKING", { name: "default" })),
    "malformed json": dependencies(async () => new Response("not json", { status: 200 })),
    "invalid status": dependencies(async () => sessionResponse("working")),
    "oversized body": dependencies(async () =>
      new Response(JSON.stringify({ name: "crm_primary", status: "WORKING", pad: "x".repeat(70_000) }), { status: 200 })),
  };
  for (const [label, deps] of Object.entries(cases)) {
    resetPlatformWahaLiveProbeCacheForTests();
    assert.equal(await probePlatformWahaSessionLive(ORGANIZATION_ID, deps), null, label);
    assert.deepEqual(
      await withLivePlatformWahaHealth(ORGANIZATION_ID, recorded, deps),
      recorded,
      label,
    );
    resetPlatformWahaLiveProbeCacheForTests();
    assert.equal(
      await withLivePlatformWahaHealth(ORGANIZATION_ID, null, deps),
      null,
      `${label}: no record stays «not connected»`,
    );
  }
});

test("live probe: a fresh answer wins over a stale recorded WORKING and over a missing record", async () => {
  const stale = Object.freeze({
    sessionName: "crm_primary",
    status: "WORKING",
    observedAt: "2026-10-03T08:00:00.000Z",
  });
  assert.equal(platformWahaHealthDisplayStatus(stale, NOW.getTime()), "blocked", "stale record alone");

  const connected = await withLivePlatformWahaHealth(
    ORGANIZATION_ID,
    stale,
    dependencies(async () => sessionResponse("WORKING")),
  );
  assert.equal(platformWahaHealthDisplayStatus(connected, NOW.getTime()), "ready");

  resetPlatformWahaLiveProbeCacheForTests();
  const qr = await withLivePlatformWahaHealth(
    ORGANIZATION_ID,
    stale,
    dependencies(async () => sessionResponse("SCAN_QR_CODE")),
  );
  assert.equal(qr.status, "SCAN_QR_CODE");

  resetPlatformWahaLiveProbeCacheForTests();
  const noRecord = await withLivePlatformWahaHealth(
    ORGANIZATION_ID,
    null,
    dependencies(async () => sessionResponse("WORKING")),
  );
  assert.equal(platformWahaHealthDisplayStatus(noRecord, NOW.getTime()), "ready");
});

test("live probe: answers are shared per organization for a few seconds, then asked again", async () => {
  let calls = 0;
  let nowMs = NOW.getTime();
  const deps = dependencies(
    async () => {
      calls += 1;
      return sessionResponse("WORKING");
    },
    { now: () => new Date(nowMs) },
  );

  await Promise.all([
    probePlatformWahaSessionLive(ORGANIZATION_ID, deps),
    probePlatformWahaSessionLive(ORGANIZATION_ID, deps),
  ]);
  await probePlatformWahaSessionLive(ORGANIZATION_ID, deps);
  assert.equal(calls, 1, "concurrent and repeated reads share one call");

  await probePlatformWahaSessionLive(OTHER_ORGANIZATION_ID, deps);
  assert.equal(calls, 2, "another organization is asked separately");

  nowMs += PLATFORM_WAHA_LIVE_PROBE_TTL_MS + 1;
  const later = await probePlatformWahaSessionLive(ORGANIZATION_ID, deps);
  assert.equal(calls, 3);
  assert.equal(later.observedAt, new Date(nowMs).toISOString());
});

test("settings table and inbox banner both read the live status, behind the existing authorized read", () => {
  const inbox = readFileSync(new URL("../src/lib/v3/inbox-source.ts", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/lib/v3/settings-source.ts", import.meta.url), "utf8");
  for (const source of [inbox, settings]) {
    assert.match(source, /withLivePlatformWahaHealth\(/u);
    assert.match(source, /getPlatformWahaSessionHealth\(actor, "crm_primary"\)/u);
  }
  // Authorization first: the recorded read throws for an actor without access,
  // so the probe is only reached by an authorized staff member.
  assert.match(inbox, /withLivePlatformWahaHealth\(\s*actor\.organizationId,\s*await getPlatformWahaSessionHealth\(actor, "crm_primary"\),\s*\)/u);
  assert.match(settings, /withLivePlatformWahaHealth\(\s*actor\.organizationId,\s*recordedWaha,\s*\)/u);
});
