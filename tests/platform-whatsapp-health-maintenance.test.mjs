// The WhatsApp connection alert job (src/lib/server/platform-whatsapp-health-maintenance.ts): every pass runs against
// a recording fake database and a fake probe - no WAHA, no Supabase, no network, no message to anyone. Run with:
// node --conditions=react-server --experimental-strip-types --test tests/platform-whatsapp-health-maintenance.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  runWhatsAppHealthMaintenance,
} from "../src/lib/server/platform-whatsapp-health-maintenance.ts";
import {
  PLATFORM_WAHA_UNREACHABLE_STATUS,
  probePlatformWahaSessionLiveUncached,
  resetPlatformWahaLiveProbeCacheForTests,
} from "../src/lib/server/platform-waha-live-health.ts";

const ORGANIZATION_ID = "32100000-0000-4000-8000-0000000000a1";
const SALES_HEAD = "32100000-0000-4000-8000-0000000000a2";
const SECRET_KEY = "sb_secret_whatsapp_health_test_key_0001";
const ALERT_ID = "32100000-0000-4000-8000-0000000000b1";
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (local) => Date.parse(`${local}+06:00`);
const iso = (ms) => new Date(ms).toISOString();

function environment(overrides = {}) {
  return {
    EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET_KEY,
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: SALES_HEAD,
    ...overrides,
  };
}

/**
 * A recording database. `handlers` map a function name to a function of its args that returns `{ data, error }`
 * (or a promise). Every call is kept in `calls`.
 */
function database(handlers) {
  const calls = [];
  const client = {
    schema(name) {
      assert.equal(name, "platform", "only the platform schema is used");
      return {
        rpc(fn, args) {
          calls.push({ fn, args });
          const handler = handlers[fn];
          assert.ok(handler, `unexpected RPC ${fn}`);
          return Promise.resolve(handler(args));
        },
      };
    },
  };
  return { calls, client, names: () => calls.map((call) => call.fn) };
}

const ok = (data) => ({ data, error: null });
const fail = (message = "boom") => ({ data: null, error: { message, code: "XX000" } });

/** What `whatsapp_health_read_v1` returns. */
function state({ now, monitor = null, disconnected = null, silent = null, lastInboundAt = null }) {
  return {
    now: iso(now),
    monitor: monitor === null ? null : { lastStatus: monitor.lastStatus, lastSeenAt: iso(monitor.lastSeenAt), sinceAt: iso(monitor.sinceAt) },
    disconnected: disconnected === null ? null : { id: ALERT_ID, openedAt: iso(disconnected) },
    silent: silent === null ? null : { id: ALERT_ID, openedAt: iso(silent) },
    lastInboundAt: lastInboundAt === null ? null : iso(lastInboundAt),
  };
}

function run(db, { status = "WORKING", env = environment(), probe, rpcDeadlineMs = 2_000 } = {}) {
  const probed = [];
  return runWhatsAppHealthMaintenance({
    environment: env,
    createServiceClient: () => db.client,
    probe:
      probe ??
      (async (organizationId) => {
        probed.push(organizationId);
        return status;
      }),
    rpcDeadlineMs,
  }).then((report) => ({ report, probed }));
}

const baseHandlers = (readData, extra = {}) => ({
  whatsapp_health_read_v1: () => ok(readData),
  whatsapp_health_observe_v1: () => ok({ sinceAt: iso(0), lastSeenAt: iso(0) }),
  whatsapp_health_open_v1: () => ok({ opened: true, alertId: ALERT_ID, tasks: 3 }),
  whatsapp_health_resolve_v1: () => ok({ resolved: true, tasksClosed: 2, alertId: ALERT_ID }),
  ...extra,
});

test("with the receive path switched off the job does nothing at all: no probe, no database", async () => {
  for (const value of [undefined, "", "0", "true", "yes", " 1"]) {
    const env = environment();
    if (value === undefined) delete env.EVO_PLATFORM_WAHA_INGRESS_ENABLED;
    else env.EVO_PLATFORM_WAHA_INGRESS_ENABLED = value;
    let touched = false;
    const report = await runWhatsAppHealthMaintenance({
      environment: env,
      createServiceClient: () => {
        touched = true;
        throw new Error("must not be created");
      },
      probe: async () => {
        touched = true;
        return "FAILED";
      },
    });
    assert.deepEqual(report.log, { event: "whatsapp_health_maintenance", status: "disabled", reason: "ingress_off" });
    assert.equal(report.exitCode, 0, JSON.stringify(value));
    assert.equal(touched, false);
  }
});

test("switched on without a usable backend: a clear failure with exit code 1 and no secret", async () => {
  const db = database({});
  for (const env of [
    environment({ EVO_PLATFORM_SUPABASE_SECRET_KEY: undefined }),
    environment({ EVO_PLATFORM_ORGANIZATION_ID: "not-a-uuid" }),
    environment({ NEXT_PUBLIC_SUPABASE_URL: "http://example.com" }),
  ]) {
    const { report, probed } = await run(db, { env });
    assert.equal(report.exitCode, 1);
    assert.deepEqual(report.log, { event: "whatsapp_health_maintenance", status: "failed", reason: "backend_not_configured" });
    assert.deepEqual(probed, [], "no probe without a backend");
  }
  assert.deepEqual(db.calls, []);
  const refused = await runWhatsAppHealthMaintenance({
    environment: environment(),
    createServiceClient: () => {
      throw new Error("no client");
    },
    probe: async () => "WORKING",
  });
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.log.reason, "backend_not_configured");
});

test("a probe that cannot answer (no binding, key refused, unknown session) writes nothing and raises nothing", async () => {
  const now = at("2026-10-26T14:00:00");
  const db = database(baseHandlers(state({ now, monitor: { lastStatus: "FAILED", lastSeenAt: now - 5 * MIN, sinceAt: now - HOUR } })));
  const { report } = await run(db, { probe: async () => null });
  assert.equal(report.exitCode, 0);
  assert.deepEqual(db.names(), ["whatsapp_health_read_v1"]);
  assert.equal(report.log.status, "ok");
  assert.equal(report.log.probe, "unknown");
  assert.equal(report.log.verdict, "unknown");
  assert.equal(report.log.opened, 0);
  assert.equal("session_status" in report.log, false);
  // A probe that throws is the same: unknown, not an alarm.
  const db2 = database(baseHandlers(state({ now })));
  const thrown = await run(db2, {
    probe: async () => {
      throw new Error("socket");
    },
  });
  assert.equal(thrown.report.exitCode, 0);
  assert.equal(thrown.report.log.probe, "unknown");
  assert.deepEqual(db2.names(), ["whatsapp_health_read_v1"]);
  // A malformed status word is unknown too.
  const db3 = database(baseHandlers(state({ now })));
  const malformed = await run(db3, { probe: async () => "failed; DROP TABLE" });
  assert.equal(malformed.report.log.probe, "unknown");
});

test("the first not-working pass only starts the run: nothing is raised before ten minutes", async () => {
  const now = at("2026-10-26T14:00:00");
  const db = database(baseHandlers(state({ now })));
  const { report } = await run(db, { status: "FAILED" });
  assert.equal(report.exitCode, 0);
  assert.deepEqual(db.names(), ["whatsapp_health_read_v1", "whatsapp_health_observe_v1"]);
  assert.deepEqual(db.calls[1].args, {
    p_organization_id: ORGANIZATION_ID,
    p_session: "crm_primary",
    p_status: "FAILED",
    p_restart: true,
  });
  assert.equal(report.log.verdict, "down_pending");
  assert.equal(report.log.session_status, "FAILED");
  assert.equal(report.log.opened, 0);
});

test("not working for ten minutes opens one alert with the sales head as an extra recipient", async () => {
  const now = at("2026-10-26T14:00:00");
  const db = database(
    baseHandlers(state({ now, monitor: { lastStatus: "FAILED", lastSeenAt: now - 5 * MIN, sinceAt: now - 10 * MIN } })),
  );
  const { report, probed } = await run(db, { status: "FAILED" });
  assert.deepEqual(probed, [ORGANIZATION_ID]);
  assert.equal(report.exitCode, 0);
  assert.deepEqual(db.names(), ["whatsapp_health_read_v1", "whatsapp_health_observe_v1", "whatsapp_health_open_v1"]);
  assert.equal(db.calls[1].args.p_restart, false);
  assert.deepEqual(db.calls[2].args, {
    p_organization_id: ORGANIZATION_ID,
    p_session: "crm_primary",
    p_kind: "disconnected",
    p_status: "FAILED",
    p_extra_recipient: SALES_HEAD,
  });
  assert.equal(report.log.verdict, "down");
  assert.equal(report.log.down_minutes, 10);
  assert.equal(report.log.opened, 1);
  assert.equal(report.log.opened_kinds, "disconnected");
  assert.equal(report.log.tasks_created, 3);
  assert.equal(report.log.resolved, 0);
});

test("the sales head is optional: a missing or malformed intake owner id is not sent", async () => {
  const now = at("2026-10-26T14:00:00");
  for (const value of [undefined, "", "not-a-uuid", "00000000-0000-0000-0000-000000000000", ` ${SALES_HEAD}`]) {
    const db = database(
      baseHandlers(state({ now, monitor: { lastStatus: "FAILED", lastSeenAt: now - 5 * MIN, sinceAt: now - 15 * MIN } })),
    );
    const env = environment({ EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: value });
    const { report } = await run(db, { status: "SCAN_QR_CODE", env });
    assert.equal(report.exitCode, 0);
    assert.equal(db.calls[2].args.p_extra_recipient, null, JSON.stringify(value));
    assert.equal(db.calls[2].args.p_status, "SCAN_QR_CODE");
  }
});

test("an alert that is already open for the outage is not opened again, and the run goes on", async () => {
  const now = at("2026-10-26T14:00:00");
  const db = database(
    baseHandlers(state({ now, monitor: { lastStatus: "FAILED", lastSeenAt: now - 5 * MIN, sinceAt: now - 3 * HOUR }, disconnected: now - 2 * HOUR })),
  );
  const { report } = await run(db, { status: "FAILED" });
  assert.deepEqual(db.names(), ["whatsapp_health_read_v1", "whatsapp_health_observe_v1"]);
  assert.equal(report.exitCode, 0);
  assert.equal(report.log.opened, 0);
  assert.equal(report.log.verdict, "down");
  // And if the database says it is already open (a racing pass), nothing is counted as opened.
  const db2 = database(
    baseHandlers(
      state({ now, monitor: { lastStatus: "FAILED", lastSeenAt: now - 5 * MIN, sinceAt: now - 30 * MIN } }),
      { whatsapp_health_open_v1: () => ok({ opened: false, reason: "already_open" }) },
    ),
  );
  const raced = await run(db2, { status: "FAILED" });
  assert.equal(raced.report.exitCode, 0);
  assert.equal(raced.report.log.opened, 0);
  assert.equal(raced.report.log.tasks_created, 0);
});

test("an unreachable WAHA is a not-working session: the real probe maps it to UNREACHABLE and the job raises the alert", async () => {
  resetPlatformWahaLiveProbeCacheForTests();
  let fetches = 0;
  const unreachableProbe = async (organizationId) => {
    const health = await probePlatformWahaSessionLiveUncached(organizationId, {
      resolveRuntime: async () => ({
        wahaSessionName: "crm_primary",
        wahaBaseUrl: "http://evo-crm-waha:3000",
        wahaApiKey: "k".repeat(24),
        bindingVersion: 1n,
      }),
      fetch: async () => {
        fetches += 1;
        throw new TypeError("fetch failed");
      },
      createTimeoutSignal: () => new AbortController().signal,
    });
    return health === null ? null : health.status;
  };
  assert.equal(await unreachableProbe(ORGANIZATION_ID), PLATFORM_WAHA_UNREACHABLE_STATUS);
  const now = at("2026-10-26T14:00:00");
  const db = database(
    baseHandlers(state({ now, monitor: { lastStatus: "UNREACHABLE", lastSeenAt: now - 5 * MIN, sinceAt: now - 25 * MIN } })),
  );
  const { report } = await run(db, { probe: unreachableProbe });
  assert.ok(fetches >= 2);
  assert.equal(report.exitCode, 0);
  assert.equal(report.log.session_status, "UNREACHABLE");
  assert.equal(db.calls.find((call) => call.fn === "whatsapp_health_open_v1").args.p_status, "UNREACHABLE");
  // A 5xx from WAHA is the same; a refused key or an unknown session is "cannot say".
  resetPlatformWahaLiveProbeCacheForTests();
  const status = async (code, body = {}) =>
    probePlatformWahaSessionLiveUncached(ORGANIZATION_ID, {
      resolveRuntime: async () => ({ wahaSessionName: "crm_primary", wahaBaseUrl: "http://evo-crm-waha:3000", wahaApiKey: "k".repeat(24), bindingVersion: 1n }),
      fetch: async () => new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } }),
      createTimeoutSignal: () => new AbortController().signal,
    });
  assert.equal((await status(503))?.status, "UNREACHABLE");
  assert.equal(await status(401), null);
  assert.equal(await status(404), null);
  assert.equal((await status(200, { name: "crm_primary", status: "FAILED" }))?.status, "FAILED");
  assert.equal(await status(200, { name: "other", status: "WORKING" }), null);
  // No binding at all (WhatsApp intentionally off): the probe cannot say.
  const noBinding = await probePlatformWahaSessionLiveUncached(ORGANIZATION_ID, {
    resolveRuntime: async () => {
      throw new Error("missing binding");
    },
  });
  assert.equal(noBinding, null);
});

test("a recovery closes the disconnected alert and starts the working run", async () => {
  const now = at("2026-10-26T14:00:00");
  const db = database(
    baseHandlers(state({ now, monitor: { lastStatus: "FAILED", lastSeenAt: now - 5 * MIN, sinceAt: now - 2 * HOUR }, disconnected: now - HOUR, lastInboundAt: now - 3 * HOUR })),
  );
  const { report } = await run(db, { status: "WORKING" });
  assert.deepEqual(db.names(), ["whatsapp_health_read_v1", "whatsapp_health_observe_v1", "whatsapp_health_resolve_v1"]);
  assert.equal(db.calls[1].args.p_restart, true);
  assert.deepEqual(db.calls[2].args, {
    p_organization_id: ORGANIZATION_ID,
    p_session: "crm_primary",
    p_kind: "disconnected",
    p_reason: "working_again",
  });
  assert.equal(report.exitCode, 0);
  assert.equal(report.log.resolved, 1);
  assert.equal(report.log.resolved_kinds, "disconnected");
  assert.equal(report.log.tasks_closed, 2);
});

test("silence in working time opens the silent alert; a message closes it", async () => {
  const now = at("2026-10-26T14:00:00");
  const longRun = { lastStatus: "WORKING", lastSeenAt: now - 5 * MIN, sinceAt: now - 2 * 24 * HOUR };
  const db = database(baseHandlers(state({ now, monitor: longRun, lastInboundAt: at("2026-10-26T10:30:00") })));
  const { report } = await run(db, { status: "WORKING" });
  assert.deepEqual(db.names(), ["whatsapp_health_read_v1", "whatsapp_health_observe_v1", "whatsapp_health_open_v1"]);
  assert.equal(db.calls[2].args.p_kind, "silent");
  assert.equal(db.calls[2].args.p_status, "WORKING");
  assert.equal(report.log.opened_kinds, "silent");
  assert.equal(report.log.verdict, "silent");
  assert.equal(report.log.silent_working_minutes, 210);

  const closing = database(
    baseHandlers(state({ now, monitor: longRun, silent: at("2026-10-26T13:00:00"), lastInboundAt: now - MIN })),
  );
  const closed = await run(closing, { status: "WORKING" });
  assert.deepEqual(closing.names(), ["whatsapp_health_read_v1", "whatsapp_health_observe_v1", "whatsapp_health_resolve_v1"]);
  assert.equal(closing.calls[2].args.p_kind, "silent");
  assert.equal(closing.calls[2].args.p_reason, "messages_arrived");
  assert.equal(closed.report.log.resolved_kinds, "silent");

  // Outside working time (Sunday): the same silence is not raised.
  const sunday = at("2026-11-01T14:00:00");
  const quiet = database(
    baseHandlers(state({ now: sunday, monitor: { lastStatus: "WORKING", lastSeenAt: sunday - 5 * MIN, sinceAt: sunday - 3 * 24 * HOUR }, lastInboundAt: at("2026-10-31T10:30:00") })),
  );
  const sundayRun = await run(quiet, { status: "WORKING" });
  assert.deepEqual(quiet.names(), ["whatsapp_health_read_v1", "whatsapp_health_observe_v1"]);
  assert.equal(sundayRun.report.log.opened, 0);
});

test("no one can receive the task: the pass fails with a fixed word, but the run is still recorded", async () => {
  const now = at("2026-10-26T14:00:00");
  const db = database(
    baseHandlers(
      state({ now, monitor: { lastStatus: "FAILED", lastSeenAt: now - 5 * MIN, sinceAt: now - 20 * MIN } }),
      { whatsapp_health_open_v1: () => fail("whatsapp_health_no_recipient") },
    ),
  );
  const { report } = await run(db, { status: "FAILED" });
  assert.equal(report.exitCode, 1);
  assert.equal(report.log.status, "failed");
  assert.equal(report.log.reason, "no_recipient");
  assert.equal(report.log.failed, 1);
  assert.equal(report.log.opened, 0);
  assert.deepEqual(db.names(), ["whatsapp_health_read_v1", "whatsapp_health_observe_v1", "whatsapp_health_open_v1"]);
});

test("database trouble ends the pass with exit code 1 and a fixed word, never a message", async () => {
  const now = at("2026-10-26T14:00:00");
  // The read fails.
  const readFails = database(baseHandlers(null, { whatsapp_health_read_v1: () => fail("password=hunter2 secret detail") }));
  const first = await run(readFails, { status: "FAILED" });
  assert.equal(first.report.exitCode, 1);
  assert.deepEqual(first.report.log, { event: "whatsapp_health_maintenance", status: "failed", reason: "database" });
  assert.deepEqual(readFails.names(), ["whatsapp_health_read_v1"]);
  // The read answers nonsense.
  for (const data of [null, "x", [], { now: "not a date" }, { ...state({ now }), monitor: { lastStatus: "failed", lastSeenAt: iso(now), sinceAt: iso(now) } }, { ...state({ now }), disconnected: { id: "no", openedAt: iso(now) } }, { ...state({ now }), lastInboundAt: "soon" }]) {
    const db = database(baseHandlers(data));
    const { report } = await run(db, { status: "FAILED" });
    assert.equal(report.exitCode, 1, JSON.stringify(data));
    assert.equal(report.log.reason, "database");
    assert.deepEqual(db.names(), ["whatsapp_health_read_v1"]);
  }
  // A step that never answers is cut at the deadline.
  const hung = database(baseHandlers(null, { whatsapp_health_read_v1: () => new Promise(() => {}) }));
  const started = Date.now();
  const stuck = await run(hung, { status: "FAILED", rpcDeadlineMs: 50 });
  assert.equal(stuck.report.exitCode, 1);
  assert.ok(Date.now() - started < 1_500);
  // A failing write does not stop the other writes, and is counted.
  const writeFails = database(
    baseHandlers(
      state({ now, monitor: { lastStatus: "FAILED", lastSeenAt: now - 5 * MIN, sinceAt: now - 3 * HOUR }, disconnected: now - 2 * HOUR }),
      { whatsapp_health_resolve_v1: () => fail("serialization") },
    ),
  );
  const partial = await run(writeFails, { status: "WORKING" });
  assert.equal(partial.report.exitCode, 1);
  assert.equal(partial.report.log.failed, 1);
  assert.equal(partial.report.log.reason, "database");
  assert.equal(partial.report.log.resolved, 0);
  assert.deepEqual(writeFails.names(), ["whatsapp_health_read_v1", "whatsapp_health_observe_v1", "whatsapp_health_resolve_v1"]);
});

test("the log carries counters and fixed words only: no key, no organization, no member, no message", async () => {
  const now = at("2026-10-26T14:00:00");
  const db = database(
    baseHandlers(state({ now, monitor: { lastStatus: "FAILED", lastSeenAt: now - 5 * MIN, sinceAt: now - 20 * MIN } })),
  );
  const { report } = await run(db, { status: "FAILED" });
  const text = JSON.stringify(report.log);
  for (const forbidden of [SECRET_KEY, ORGANIZATION_ID, SALES_HEAD, ALERT_ID, "127.0.0.1", "http"]) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
  for (const [key, value] of Object.entries(report.log)) {
    assert.match(key, /^[a-z][a-z_]*$/u);
    assert.ok(typeof value === "number" || typeof value === "boolean" || /^[A-Za-z_,]+$/u.test(value), `${key}=${value}`);
  }
});

test("nothing in the job's sources logs a value: the only console use is the entry's single JSON line", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  for (const path of [
    "src/lib/platform-whatsapp-health.ts",
    "src/lib/server/platform-whatsapp-health-maintenance.ts",
  ]) {
    assert.ok(!/console\./u.test(read(path)), path);
  }
  const entry = read("scripts/whatsapp-health-maintenance.mjs");
  assert.equal((entry.match(/console\./gu) ?? []).length, 3);
  assert.match(entry, /console\.log\(JSON\.stringify\(report\.log\)\)/u);
  assert.match(entry, /console\.error\("whatsapp_health_maintenance_failed"\)/u);
  // The job only reads the WAHA session status: no start, stop, restart, logout, QR or send path in its sources.
  const source = read("src/lib/server/platform-whatsapp-health-maintenance.ts") + read("src/lib/platform-whatsapp-health.ts");
  for (const forbidden of ["/start", "/stop", "/restart", "/logout", "/auth/qr", "sendText", "/api/sendText", "method: \"POST\""]) {
    assert.ok(!source.includes(forbidden), forbidden);
  }
});
