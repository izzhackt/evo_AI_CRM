// The Wazzup part of the WhatsApp timer job (src/lib/server/platform-wazzup-maintenance.ts): sweep, health, reconciliation.
// Every pass runs against a recording fake database and a fake Wazzup client - no Wazzup, no Supabase, no network, no message
// to anyone. Everything is synthetic. Run with:
// node --conditions=react-server --experimental-strip-types --test tests/platform-wazzup-maintenance.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { runWazzupMaintenance } from "../src/lib/server/platform-wazzup-maintenance.ts";
import { WazzupApiError } from "../src/lib/server/platform-wazzup-client.ts";

const ORGANIZATION_ID = "77600000-0000-4000-8000-000000000001";
const OWNER_ID = "77600000-0000-4000-8000-0000000000a1";
const SALES_HEAD = OWNER_ID;
const CHANNEL_ID = "77600000-0000-4000-8000-0000000000c1";
const ALERT_ID = "77600000-0000-4000-8000-0000000000b1";
const SYNTH_KEY = "synthetic-wazzup-key-0123456789abcdef";
const PLAIN_ID = "99600000001";
const SECRET_KEY = "sb_secret_wazzup_maintenance_key_0001";
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (local) => Date.parse(`${local}+06:00`);
const iso = (ms) => new Date(ms).toISOString();

function environment(overrides = {}) {
  return {
    EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: "1",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: OWNER_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET_KEY,
    ...overrides,
  };
}

const ok = (data) => ({ data, error: null });
const fail = (message = "boom") => ({ data: null, error: { message, code: "XX000" } });

/** A recording database: `handlers` map a function name to `(args, n) => { data, error }` (or a promise). */
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
          return Promise.resolve(handler(args, calls.filter((call) => call.fn === fn).length));
        },
      };
    },
  };
  return { calls, client, names: () => calls.map((call) => call.fn), of: (fn) => calls.filter((call) => call.fn === fn) };
}

const transportActive = { transportActive: true, channelId: CHANNEL_ID, results: [], counts: {} };
const sweepIdle = { transportActive: true, processed: 0, busy: 0, outcomes: {}, newInbound: 0, oldestPendingSeconds: null, failedExhausted: 0, aiTriggerEnabled: false };

/** What `whatsapp_health_read_v1` returns. */
function healthState({ now, monitor = null, disconnected = null, silent = null, gap = null, lastInboundAt = null }) {
  return {
    now: iso(now),
    monitor: monitor === null ? null : {
      lastStatus: monitor.lastStatus,
      lastSeenAt: iso(monitor.lastSeenAt),
      sinceAt: iso(monitor.sinceAt),
      workingSinceAt: iso(monitor.workingSinceAt ?? monitor.sinceAt),
    },
    disconnected: disconnected === null ? null : { id: ALERT_ID, openedAt: iso(disconnected) },
    silent: silent === null ? null : { id: ALERT_ID, openedAt: iso(silent) },
    gap: gap === null ? null : { id: ALERT_ID, openedAt: iso(gap) },
    lastInboundAt: lastInboundAt === null ? null : iso(lastInboundAt),
  };
}

/** A database where everything is quiet and the transport is Wazzup; `extra` overrides single functions. */
function quiet(extra = {}) {
  const NOW = at("2026-10-27T14:00:00");
  return database({
    wazzup_webhook_persist_v1: () => ok(transportActive),
    wazzup_projection_sweep_v1: () => ok(sweepIdle),
    wazzup_api_key_resolve_v1: () => ok({ ready: true, reasonCode: "ready", apiKey: SYNTH_KEY, apiKeySha256: "ab".repeat(32), bindingVersion: 1 }),
    wazzup_channel_observe_v1: () => ok({ updated: true }),
    whatsapp_health_read_v1: () => ok(healthState({ now: NOW, lastInboundAt: NOW - 5 * MIN })),
    whatsapp_health_observe_v1: () => ok({ ok: true }),
    whatsapp_health_open_v1: () => ok({ opened: true, alertId: ALERT_ID, tasks: 3 }),
    whatsapp_health_resolve_v1: () => ok({ resolved: true, tasksClosed: 2, alertId: ALERT_ID }),
    wazzup_daily_counts_v1: () => ok({ day: "2026-10-26", inboundStored: 300, counters: {}, inboundTotal: 300 }),
    ...extra,
  });
}

function wazzupFake({ channels, error } = {}) {
  const state = { keys: [], listCalls: 0 };
  return {
    state,
    createWazzupClient(apiKey) {
      state.keys.push(apiKey);
      return {
        async listChannels() {
          state.listCalls += 1;
          if (error !== undefined) throw error;
          return channels ?? [{ channelId: CHANNEL_ID, transport: "whatsapp", plainId: PLAIN_ID, state: "active" }];
        },
        async getWebhooks() { throw new Error("the timer never reads webhooks"); },
        async patchWebhooks() { throw new Error("the timer never changes webhooks"); },
      };
    },
  };
}

function run(db, { env = environment(), wazzup = wazzupFake(), now = at("2026-10-27T14:00:00"), amo = null, dispatch, overrides = {} } = {}) {
  const dispatched = [];
  return runWazzupMaintenance({
    environment: env,
    createServiceClient: () => db.client,
    createWazzupClient: wazzup.createWazzupClient,
    readAmocrmInboundCount: async (day) => (typeof amo === "function" ? amo(day) : amo),
    dispatchAiAgents: dispatch ?? (async () => { dispatched.push(1); }),
    now: () => now,
    rpcDeadlineMs: 2_000,
    ...overrides,
  }).then((report) => ({ report, wazzup, dispatched }));
}

// ---------------------------------------------------------------- off and misconfigured

test("with the emergency stop closed the Wazzup part does nothing at all: no backend, no database, no Wazzup", async () => {
  for (const value of [undefined, "", "0", "true", " 1"]) {
    const env = environment();
    if (value === undefined) delete env.EVO_PLATFORM_WAZZUP_INGRESS_ENABLED;
    else env.EVO_PLATFORM_WAZZUP_INGRESS_ENABLED = value;
    let touched = false;
    const report = await runWazzupMaintenance({
      environment: env,
      createServiceClient: () => { touched = true; throw new Error("must not be created"); },
      createWazzupClient: () => { touched = true; throw new Error("must not be created"); },
      now: () => { touched = true; return 0; },
    });
    assert.deepEqual(report.log, { status: "disabled", reason: "ingress_off" }, JSON.stringify(value));
    assert.equal(report.exitCode, 0);
    assert.equal(touched, false);
  }
});

test("emergency stop closed with a staged token: while the database path is not Wazzup the part stays silent after one write-free probe", async () => {
  const staged = environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: "0123456789abcdef".repeat(4), EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: "0" });
  const db = quiet({ wazzup_webhook_persist_v1: () => ok({ transportActive: false, results: [] }) });
  const { report, wazzup } = await run(db, { env: staged });
  assert.deepEqual(report.log, { status: "disabled", reason: "ingress_off" });
  assert.equal(report.exitCode, 0);
  assert.deepEqual(db.names(), ["wazzup_webhook_persist_v1"]);
  assert.deepEqual(wazzup.state.keys, []);
  // A probe that cannot be answered is a loud failure, not silence.
  const broken = quiet({ wazzup_webhook_persist_v1: () => fail() });
  const second = await run(broken, { env: staged });
  assert.deepEqual(second.report.log, { status: "failed", reason: "database" });
  assert.equal(second.report.exitCode, 1);
});

test("emergency stop closed while the database path is still Wazzup: degraded, no sweep and no reconciliation, but the health step keeps watching (so `silent` can still fire)", async () => {
  const NOW = at("2026-10-27T00:30:00");
  const staged = environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: "0123456789abcdef".repeat(4), EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: "0" });
  const db = quiet({
    whatsapp_health_read_v1: () => ok(healthState({ now: NOW, monitor: { lastStatus: "WORKING", lastSeenAt: NOW - 5 * MIN, sinceAt: NOW - 8 * HOUR }, lastInboundAt: NOW })),
  });
  const { report, wazzup } = await run(db, { env: staged, now: NOW, amo: 300 });
  assert.equal(report.log.status, "degraded");
  assert.equal(report.log.reason, "ingress_off_transport_wazzup");
  assert.equal(report.log.sweep_status, "skipped");
  assert.equal(report.log.sweep_reason, "ingress_off");
  assert.equal(report.log.reconcile_status, "skipped");
  assert.equal(report.log.health_status, "ok");
  assert.equal(report.exitCode, 0);
  assert.equal(db.of("wazzup_projection_sweep_v1").length, 0, "nothing is projected while intake is stopped");
  assert.equal(db.of("wazzup_daily_counts_v1").length, 0);
  assert.equal(db.of("wazzup_webhook_persist_v1").length, 1, "one shared probe");
  assert.equal(db.of("whatsapp_health_observe_v1").length, 1);
  assert.deepEqual(wazzup.state.keys, [SYNTH_KEY]);
});

test("switched on without a backend: a clear failure, no stack, no secret", async () => {
  const report = await runWazzupMaintenance({ environment: environment({ EVO_PLATFORM_SUPABASE_SECRET_KEY: undefined }) });
  assert.deepEqual(report.log, { status: "failed", reason: "backend_not_configured" });
  assert.equal(report.exitCode, 1);
});

// ---------------------------------------------------------------- transport inactive

test("when the transport is not Wazzup every step says transport_inactive, Wazzup is never called and no series is written", async () => {
  const db = quiet({
    wazzup_webhook_persist_v1: () => ok({ transportActive: false, results: [] }),
    wazzup_projection_sweep_v1: () => ok({ transportActive: false }),
  });
  const { report, wazzup } = await run(db, { now: at("2026-10-27T00:30:00") });
  assert.equal(report.exitCode, 0);
  assert.equal(report.log.status, "ok");
  assert.equal(report.log.sweep_status, "transport_inactive");
  assert.equal(report.log.health_status, "transport_inactive");
  assert.equal(report.log.reconcile_status, "transport_inactive");
  assert.deepEqual(wazzup.state.keys, []);
  assert.deepEqual(db.names().filter((name) => name.startsWith("whatsapp_health")), []);
  assert.deepEqual(db.names().filter((name) => name === "wazzup_api_key_resolve_v1" || name === "wazzup_daily_counts_v1" || name === "wazzup_channel_observe_v1"), []);
});

test("the transport probe is a write-free call: an empty portion with no counters, once per pass", async () => {
  const db = quiet();
  await run(db, { now: at("2026-10-27T00:30:00") });
  const probes = db.of("wazzup_webhook_persist_v1");
  assert.equal(probes.length, 1, "shared by the health and reconciliation steps");
  assert.deepEqual(probes[0].args.p_elements, []);
  assert.deepEqual(probes[0].args.p_counters, {});
  assert.equal(probes[0].args.p_organization_id, ORGANIZATION_ID);
});

// ---------------------------------------------------------------- a) sweep

test("sweep: asks for small batches as the intake owner, stops when the round is not full, and reports counters and the oldest age", async () => {
  const db = quiet({
    wazzup_projection_sweep_v1: () => ok({ ...sweepIdle, processed: 7, outcomes: { projected: 7 }, newInbound: 2, oldestPendingSeconds: 40, failedExhausted: 0 }),
  });
  const { report } = await run(db);
  assert.equal(db.of("wazzup_projection_sweep_v1").length, 1);
  assert.deepEqual(db.of("wazzup_projection_sweep_v1")[0].args, { p_organization_id: ORGANIZATION_ID, p_intake_sales_membership_id: OWNER_ID, p_limit: 50 });
  assert.equal(report.log.sweep_status, "ok");
  assert.equal(report.log.sweep_rounds, 1);
  assert.equal(report.log.sweep_processed, 7);
  assert.equal(report.log.sweep_new_inbound, 2);
  assert.equal(report.log.oldest_pending_seconds, 40);
  assert.equal(report.log.backlog, undefined);
  assert.equal(report.log.status, "ok");
});

test("sweep: keeps going while rounds are full and make progress, but at most four rounds a pass", async () => {
  const db = quiet({ wazzup_projection_sweep_v1: () => ok({ ...sweepIdle, processed: 50, outcomes: { projected: 50 }, newInbound: 1, oldestPendingSeconds: 5 }) });
  const { report } = await run(db);
  assert.equal(db.of("wazzup_projection_sweep_v1").length, 4);
  assert.equal(report.log.sweep_rounds, 4);
  assert.equal(report.log.sweep_processed, 200);
  assert.equal(report.log.sweep_new_inbound, 4);
});

test("sweep: a round that only failed does not repeat in the same pass (the eight attempts must not burn in seconds); busy rows are counted and left", async () => {
  const failing = quiet({ wazzup_projection_sweep_v1: () => ok({ ...sweepIdle, processed: 50, outcomes: { failed: 50 }, oldestPendingSeconds: 900, failedExhausted: 0 }) });
  const { report } = await run(failing);
  assert.equal(failing.of("wazzup_projection_sweep_v1").length, 1);
  assert.equal(report.log.sweep_processed, 50);
  const busy = quiet({ wazzup_projection_sweep_v1: () => ok({ ...sweepIdle, processed: 0, busy: 50, oldestPendingSeconds: 3 }) });
  const second = await run(busy);
  assert.equal(busy.of("wazzup_projection_sweep_v1").length, 1);
  assert.equal(second.report.log.sweep_busy, 50);
});

test("sweep: the pass has a time budget between rounds", async () => {
  let clock = at("2026-10-27T14:00:00");
  const db = quiet({
    wazzup_projection_sweep_v1: () => {
      clock += 25_000;
      return ok({ ...sweepIdle, processed: 50, outcomes: { projected: 50 } });
    },
  });
  const { report } = await run(db, { overrides: { now: () => clock, sweepBudgetMs: 40_000 } });
  assert.equal(db.of("wazzup_projection_sweep_v1").length, 2);
  assert.equal(report.log.sweep_rounds, 2);
});

test("sweep: a backlog older than 30 minutes is `degraded` in the report; exhausted events are counted", async () => {
  const old = quiet({ wazzup_projection_sweep_v1: () => ok({ ...sweepIdle, processed: 1, outcomes: { projected: 1 }, oldestPendingSeconds: 1801, failedExhausted: 3 }) });
  const { report } = await run(old);
  assert.equal(report.log.oldest_pending_seconds, 1801);
  assert.equal(report.log.backlog, "degraded");
  assert.equal(report.log.sweep_failed_exhausted, 3);
  assert.equal(report.log.status, "degraded");
  assert.equal(report.exitCode, 0);
  const edge = quiet({ wazzup_projection_sweep_v1: () => ok({ ...sweepIdle, processed: 1, outcomes: { projected: 1 }, oldestPendingSeconds: 1800 }) });
  assert.equal((await run(edge)).report.log.backlog, undefined, "exactly 30 minutes is still fine");
});

test("sweep: the AI agents are started once per pass, only when there are new inbound messages and the switch in the database is on", async () => {
  const withFlag = async (aiTriggerEnabled, newInbound) => {
    const db = quiet({ wazzup_projection_sweep_v1: () => ok({ ...sweepIdle, processed: 3, outcomes: { projected: 3 }, newInbound, aiTriggerEnabled }) });
    const { report, dispatched } = await run(db);
    return { dispatched: dispatched.length, flagged: report.log.sweep_ai_dispatched };
  };
  assert.deepEqual(await withFlag(true, 2), { dispatched: 1, flagged: true });
  assert.deepEqual(await withFlag(false, 2), { dispatched: 0, flagged: undefined });
  assert.deepEqual(await withFlag(true, 0), { dispatched: 0, flagged: undefined });
  // A failing hook does not fail the pass.
  const db = quiet({ wazzup_projection_sweep_v1: () => ok({ ...sweepIdle, processed: 1, outcomes: { projected: 1 }, newInbound: 1, aiTriggerEnabled: true }) });
  const { report } = await run(db, { dispatch: async () => { throw new Error("hook down"); } });
  assert.equal(report.exitCode, 0);
});

test("sweep: no intake owner is a loud failure, a database error is a failure - and neither stops the other two steps", async () => {
  const noOwner = quiet();
  const first = await run(noOwner, { env: environment({ EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: undefined }) });
  assert.equal(first.report.exitCode, 1);
  assert.equal(first.report.log.sweep_status, "failed");
  assert.equal(first.report.log.sweep_reason, "owner_missing");
  assert.equal(first.report.log.health_status, "ok", "the health step still ran");
  assert.equal(noOwner.of("wazzup_projection_sweep_v1").length, 0);

  const down = quiet({ wazzup_projection_sweep_v1: () => fail() });
  const second = await run(down);
  assert.equal(second.report.exitCode, 1);
  assert.equal(second.report.log.sweep_status, "failed");
  assert.equal(second.report.log.sweep_reason, "database");
  assert.equal(second.report.log.health_status, "ok");

  const odd = quiet({ wazzup_projection_sweep_v1: () => ok({ weird: true }) });
  assert.equal((await run(odd)).report.log.sweep_status, "failed");
  const slow = quiet({ wazzup_projection_sweep_v1: () => new Promise(() => undefined) });
  const timedOut = await run(slow, { overrides: { rpcDeadlineMs: 20 } });
  assert.equal(timedOut.report.log.sweep_status, "failed");
  assert.equal(timedOut.report.log.health_status, "ok");
});

// ---------------------------------------------------------------- b) health

test("health: a working channel is observed once - the series is written, the channel state kept, nothing opened", async () => {
  const NOW = at("2026-10-27T14:00:00");
  const db = quiet({
    whatsapp_health_read_v1: () => ok(healthState({ now: NOW, monitor: { lastStatus: "WORKING", lastSeenAt: NOW - 5 * MIN, sinceAt: NOW - HOUR }, lastInboundAt: NOW })),
  });
  const { report, wazzup } = await run(db);
  assert.equal(report.log.health_status, "ok");
  assert.equal(report.log.health_word, "WORKING");
  assert.equal(report.log.health_verdict, "working");
  assert.deepEqual(wazzup.state.keys, [SYNTH_KEY], "the key from the Vault is the one the client is made with");
  assert.equal(wazzup.state.listCalls, 1);
  assert.deepEqual(db.of("wazzup_channel_observe_v1")[0].args, { p_organization_id: ORGANIZATION_ID, p_channel_id: CHANNEL_ID, p_state: "active" });
  assert.deepEqual(db.of("whatsapp_health_read_v1")[0].args, { p_organization_id: ORGANIZATION_ID, p_session: "wazzup" });
  const observed = db.of("whatsapp_health_observe_v1");
  assert.equal(observed.length, 1, "the series is written exactly once a pass");
  assert.deepEqual(observed[0].args, { p_organization_id: ORGANIZATION_ID, p_session: "wazzup", p_status: "WORKING", p_restart: false, p_working_restart: false });
  assert.equal(db.of("whatsapp_health_open_v1").length, 0);
  assert.equal(db.of("whatsapp_health_resolve_v1").length, 0);
});

test("health: every Wazzup state reaches the series as its word, and the raw state is stored for Settings", async () => {
  const states = { phoneUnavailable: "PHONE_UNAVAILABLE", qr: "SCAN_QR_CODE", qridle: "SCAN_QR_CODE", openElsewhere: "OPEN_ELSEWHERE", notEnoughMoney: "NOT_PAID", unauthorized: "UNAUTHORIZED", disabled: "DISABLED", init: "STARTING", blocked: "BLOCKED" };
  for (const [state, word] of Object.entries(states)) {
    const db = quiet();
    const wazzup = wazzupFake({ channels: [{ channelId: CHANNEL_ID, transport: "whatsapp", plainId: PLAIN_ID, state }] });
    const { report } = await run(db, { wazzup });
    assert.equal(report.log.health_word, word, state);
    assert.equal(db.of("whatsapp_health_observe_v1")[0].args.p_status, word, state);
    assert.equal(db.of("wazzup_channel_observe_v1")[0].args.p_state, state);
  }
});

test("health: not working for ten minutes opens one `disconnected` alert for the Wazzup session, with the intake sales head as an extra recipient", async () => {
  const NOW = at("2026-10-27T14:00:00");
  const db = quiet({
    whatsapp_health_read_v1: () => ok(healthState({ now: NOW, monitor: { lastStatus: "PHONE_UNAVAILABLE", lastSeenAt: NOW - 5 * MIN, sinceAt: NOW - 11 * MIN } })),
  });
  const wazzup = wazzupFake({ channels: [{ channelId: CHANNEL_ID, transport: "whatsapp", plainId: PLAIN_ID, state: "phoneUnavailable" }] });
  const { report } = await run(db, { wazzup });
  assert.equal(report.log.health_verdict, "down");
  assert.deepEqual(db.of("whatsapp_health_open_v1").map((call) => call.args), [
    { p_organization_id: ORGANIZATION_ID, p_session: "wazzup", p_kind: "disconnected", p_status: "PHONE_UNAVAILABLE", p_extra_recipient: SALES_HEAD },
  ]);
  assert.equal(report.log.health_opened, 1);
  assert.equal(report.exitCode, 0);
});

test("health: the channel working again closes the alert; silence while working for three working hours opens `silent`", async () => {
  const NOW = at("2026-10-27T14:00:00");
  const back = quiet({
    whatsapp_health_read_v1: () => ok(healthState({ now: NOW, monitor: { lastStatus: "PHONE_UNAVAILABLE", lastSeenAt: NOW - 5 * MIN, sinceAt: NOW - 30 * MIN }, disconnected: NOW - 20 * MIN, lastInboundAt: NOW - HOUR })),
  });
  const first = await run(back);
  assert.deepEqual(back.of("whatsapp_health_resolve_v1").map((call) => call.args), [
    { p_organization_id: ORGANIZATION_ID, p_session: "wazzup", p_kind: "disconnected", p_reason: "working_again" },
  ]);
  assert.equal(first.report.log.health_resolved, 1);

  const silent = quiet({
    whatsapp_health_read_v1: () => ok(healthState({ now: NOW, monitor: { lastStatus: "WORKING", lastSeenAt: NOW - 5 * MIN, sinceAt: NOW - 8 * HOUR }, lastInboundAt: NOW - 4 * HOUR })),
  });
  const second = await run(silent);
  assert.equal(second.report.log.health_verdict, "silent");
  assert.deepEqual(silent.of("whatsapp_health_open_v1").map((call) => [call.args.p_session, call.args.p_kind, call.args.p_status]), [["wazzup", "silent", "WORKING"]]);
});

test("health: a channel missing from the Wazzup list, a refused key and an unreachable API are words in the series, not silence", async () => {
  const missing = quiet();
  const first = await run(missing, { wazzup: wazzupFake({ channels: [{ channelId: "77600000-0000-4000-8000-0000000000c9", transport: "whatsapp", plainId: PLAIN_ID, state: "active" }] }) });
  assert.equal(first.report.log.health_word, "CHANNEL_MISSING");
  assert.equal(missing.of("wazzup_channel_observe_v1").length, 0, "no state to store for a channel that is not there");

  for (const [error, word] of [
    [new WazzupApiError("unauthorized", { status: 401 }), "KEY_REJECTED"],
    [new WazzupApiError("forbidden", { status: 403 }), "KEY_REJECTED"],
    [new WazzupApiError("server", { status: 502 }), "UNREACHABLE"],
    [new WazzupApiError("network"), "UNREACHABLE"],
    [new WazzupApiError("timeout"), "UNREACHABLE"],
  ]) {
    const db = quiet();
    const { report } = await run(db, { wazzup: wazzupFake({ error }) });
    assert.equal(report.log.health_word, word, error.kind);
    assert.equal(db.of("whatsapp_health_observe_v1")[0].args.p_status, word);
    assert.equal(report.log.health_api, error.kind);
  }
});

test("health: when Wazzup cannot say (rate limit, unreadable answer, no key in the Vault) the series and the alerts are left alone", async () => {
  for (const error of [new WazzupApiError("rate_limited", { status: 429 }), new WazzupApiError("invalid_response"), new WazzupApiError("bad_request", { status: 400 }), new Error("weird")]) {
    const db = quiet();
    const { report } = await run(db, { wazzup: wazzupFake({ error }) });
    assert.equal(report.log.health_status, "unknown");
    assert.deepEqual(db.names().filter((name) => name.startsWith("whatsapp_health")), []);
    assert.equal(report.exitCode, 0);
  }
  const noKey = quiet({ wazzup_api_key_resolve_v1: () => ok({ ready: false, reasonCode: "missing_binding" }) });
  const { report, wazzup } = await run(noKey);
  assert.equal(report.log.health_status, "unknown");
  assert.equal(report.log.health_key, "missing_binding");
  assert.deepEqual(wazzup.state.keys, [], "no client without a key");
  assert.deepEqual(noKey.names().filter((name) => name.startsWith("whatsapp_health")), []);
});

test("health: a failing write is a failed pass (exit 1) but the other writes of the pass still happen", async () => {
  const NOW = at("2026-10-27T14:00:00");
  const db = quiet({
    whatsapp_health_read_v1: () => ok(healthState({ now: NOW, monitor: { lastStatus: "PHONE_UNAVAILABLE", lastSeenAt: NOW - 5 * MIN, sinceAt: NOW - 11 * MIN } })),
    whatsapp_health_observe_v1: () => fail(),
  });
  const wazzup = wazzupFake({ channels: [{ channelId: CHANNEL_ID, transport: "whatsapp", plainId: PLAIN_ID, state: "phoneUnavailable" }] });
  const { report } = await run(db, { wazzup });
  assert.equal(report.exitCode, 1);
  assert.equal(report.log.health_status, "failed");
  assert.equal(db.of("whatsapp_health_open_v1").length, 1, "the alert is still opened");

  const noRecipient = quiet({
    whatsapp_health_read_v1: () => ok(healthState({ now: NOW, monitor: { lastStatus: "PHONE_UNAVAILABLE", lastSeenAt: NOW - 5 * MIN, sinceAt: NOW - 11 * MIN } })),
    whatsapp_health_open_v1: () => fail("whatsapp_health_no_recipient"),
  });
  const second = await run(noRecipient, { wazzup });
  assert.equal(second.report.log.health_reason, "no_recipient");
});

test("health: a failing channel-state write does not fail the pass; a failing probe fails only the steps that need it", async () => {
  const db = quiet({ wazzup_channel_observe_v1: () => fail() });
  const { report } = await run(db);
  assert.equal(report.exitCode, 0);
  assert.equal(report.log.health_status, "ok");
  assert.equal(report.log.health_observe, "failed");

  const probeDown = quiet({ wazzup_webhook_persist_v1: () => fail() });
  const second = await run(probeDown, { now: at("2026-10-27T00:30:00") });
  assert.equal(second.report.log.sweep_status, "ok", "the sweep does not depend on the probe");
  assert.equal(second.report.log.health_status, "failed");
  assert.equal(second.report.log.reconcile_status, "failed");
  assert.equal(second.report.exitCode, 1);
});

test("health: the pass is skipped, not started, once the total budget is spent", async () => {
  let clock = at("2026-10-27T14:00:00");
  const db = quiet({
    wazzup_projection_sweep_v1: () => {
      clock += 80_000;
      return ok(sweepIdle);
    },
  });
  const { report } = await run(db, { overrides: { now: () => clock, totalBudgetMs: 70_000 } });
  assert.equal(report.log.health_status, "skipped");
  assert.equal(report.log.health_reason, "budget");
  assert.deepEqual(db.names().filter((name) => name.startsWith("whatsapp_health")), []);
});

// ---------------------------------------------------------------- c) reconciliation

test("reconciliation: not due outside 00:10-06:00 Bishkek, no database call", async () => {
  for (const local of ["2026-10-27T00:09:00", "2026-10-27T06:00:00", "2026-10-27T14:00:00"]) {
    const db = quiet();
    const { report } = await run(db, { now: at(local), amo: 300 });
    assert.equal(report.log.reconcile_status, "not_due", local);
    assert.equal(db.of("wazzup_daily_counts_v1").length, 0);
  }
});

test("reconciliation: without a readable amoCRM only the EVO count is written down", async () => {
  const db = quiet();
  const { report } = await run(db, { now: at("2026-10-27T00:15:00"), amo: null });
  assert.deepEqual(db.of("wazzup_daily_counts_v1")[0].args, { p_organization_id: ORGANIZATION_ID, p_day: "2026-10-26" });
  assert.equal(report.log.reconcile_status, "evo_only");
  assert.equal(report.log.reconcile_day, "2026-10-26");
  assert.equal(report.log.reconcile_evo, 300);
  assert.equal(report.log.reconcile_amo, undefined);
  assert.equal(db.of("whatsapp_health_open_v1").length, 0);
  // amoCRM that throws or answers nonsense is the same as not configured.
  for (const amo of [() => { throw new Error("amo down"); }, -1, 1.5]) {
    const again = quiet();
    const second = await run(again, { now: at("2026-10-27T00:15:00"), amo });
    assert.equal(second.report.log.reconcile_status, "evo_only");
  }
});

test("reconciliation: EVO behind amoCRM beyond max(3, 2 %) opens one `gap` alert; a gap that is already open is not opened again", async () => {
  const gapCounts = { wazzup_daily_counts_v1: () => ok({ day: "2026-10-26", inboundStored: 280, counters: {}, inboundTotal: 280 }) };
  const NOW = at("2026-10-27T00:15:00");
  const db = quiet(gapCounts);
  const { report } = await run(db, { now: NOW, amo: (day) => { assert.equal(day, "2026-10-26"); return 300; } });
  assert.equal(report.log.reconcile_verdict, "gap");
  assert.equal(report.log.reconcile_amo, 300);
  assert.deepEqual(db.of("whatsapp_health_open_v1").filter((call) => call.args.p_kind === "gap").map((call) => call.args), [
    { p_organization_id: ORGANIZATION_ID, p_session: "wazzup", p_kind: "gap", p_status: "COUNTS_GAP", p_extra_recipient: SALES_HEAD },
  ]);

  const already = quiet({ ...gapCounts, whatsapp_health_read_v1: () => ok(healthState({ now: NOW, gap: NOW - 10 * MIN })) });
  await run(already, { now: NOW, amo: 300 });
  assert.equal(already.of("whatsapp_health_open_v1").filter((call) => call.args.p_kind === "gap").length, 0);
});

test("reconciliation: counts that agree close an open gap with counts_match; EVO ahead of amoCRM is not a loss and also closes it", async () => {
  const NOW = at("2026-10-27T00:15:00");
  for (const evo of [300, 296, 330]) {
    const db = quiet({
      wazzup_daily_counts_v1: () => ok({ day: "2026-10-26", inboundStored: evo, counters: {}, inboundTotal: evo }),
      whatsapp_health_read_v1: () => ok(healthState({ now: NOW, gap: NOW - 3 * HOUR })),
    });
    const { report } = await run(db, { now: NOW, amo: 300 });
    assert.equal(report.log.reconcile_status, "ok");
    assert.deepEqual(db.of("whatsapp_health_resolve_v1").filter((call) => call.args.p_kind === "gap").map((call) => call.args), [
      { p_organization_id: ORGANIZATION_ID, p_session: "wazzup", p_kind: "gap", p_reason: "counts_match" },
    ], String(evo));
  }
  // With no open gap there is nothing to close.
  const none = quiet();
  await run(none, { now: NOW, amo: 300 });
  assert.equal(none.of("whatsapp_health_resolve_v1").filter((call) => call.args.p_kind === "gap").length, 0);
});

test("reconciliation: an unreadable count answer fails that step only", async () => {
  const db = quiet({ wazzup_daily_counts_v1: () => ok({ inboundTotal: "many" }) });
  const { report } = await run(db, { now: at("2026-10-27T00:15:00"), amo: 300 });
  assert.equal(report.log.reconcile_status, "failed");
  assert.equal(report.log.health_status, "ok");
  assert.equal(report.exitCode, 1);
});

// ---------------------------------------------------------------- what the report may contain

test("the report holds words and counters only: no key, number, channel id, token or text", async () => {
  const NOW = at("2026-10-27T00:15:00");
  const db = quiet({
    wazzup_projection_sweep_v1: () => ok({ ...sweepIdle, processed: 2, outcomes: { projected: 2 }, newInbound: 1, aiTriggerEnabled: true, oldestPendingSeconds: 9 }),
    wazzup_daily_counts_v1: () => ok({ day: "2026-10-26", inboundStored: 280, counters: {}, inboundTotal: 280 }),
  });
  const { report } = await run(db, { now: NOW, amo: 300 });
  const text = JSON.stringify(report.log);
  for (const secret of [SYNTH_KEY, PLAIN_ID, PLAIN_ID.slice(-4), CHANNEL_ID, ORGANIZATION_ID, OWNER_ID, SECRET_KEY]) {
    assert.ok(!text.includes(secret), `the report leaked ${secret.slice(0, 6)}…`);
  }
  for (const value of Object.values(report.log)) assert.ok(["string", "number", "boolean"].includes(typeof value));
  // The Wazzup client was never given anything but GET /v3/channels: the fake throws on the other two.
  assert.equal(db.of("wazzup_api_key_resolve_v1").length, 1);
});
