import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runTelephonyMaintenance } from "../src/lib/server/platform-telephony-maintenance.ts";
import { TelephonyPbxError } from "../src/lib/server/platform-telephony-pbx-client.ts";

// Everything here is synthetic: the organization, the keys, the numbers, the
// links. The database and the PBX are recording fakes; no network is used.
const ORGANIZATION_ID = "77400000-0000-4000-8000-000000000001";
const PBX_KEY = "pbx-test-key-0123456789abcdef";
const PBX_URL = "https://tenant-test.ats.beeline.kg/crmapi/v1";
const PBX_HOST = "tenant-test.ats.beeline.kg";
const LINK = "https://records.example.invalid/t-maintenance-link-1.mp3";
const PHONE = "996555000111";
const LOGIN = "u7xx-secret-login";
const UUID_A = "77400000-0000-4000-8000-0000000000a1";
const UUID_B = "77400000-0000-4000-8000-0000000000a2";

const NOW = Date.parse("2026-10-17T10:00:00.000Z");
const WINDOW_START = new Date(NOW - 2 * 3600_000);
const WINDOW_END = new Date(NOW);

function environment(overrides = {}) {
  return {
    EVO_PLATFORM_TELEPHONY_ENABLED: "1",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_telephony_test_key_0001",
    EVO_PLATFORM_TELEPHONY_PBX_TOKEN: PBX_KEY,
    EVO_PLATFORM_TELEPHONY_PBX_URL: PBX_URL,
    EVO_PLATFORM_TELEPHONY_PBX_HOST: PBX_HOST,
    ...overrides,
  };
}

function noWindow() {
  return { due: false, window_start: WINDOW_START.toISOString(), window_end: WINDOW_END.toISOString() };
}

function plan(overrides = {}) {
  return {
    status: "ok",
    now: WINDOW_END.toISOString(),
    projection_enabled: true,
    outbound_paused: false,
    backfill_enabled: false,
    directory_active: 3,
    retry_due: false,
    settle_due: false,
    users_due: false,
    probe_due: false,
    reconcile: noWindow(),
    daily: noWindow(),
    backfill: noWindow(),
    ...overrides,
  };
}

function dueWindow(start = WINDOW_START, end = WINDOW_END) {
  return { due: true, window_start: start.toISOString(), window_end: end.toISOString() };
}

function historyRow(index, extra = {}) {
  return {
    uid: String(1000 + index),
    type: "in",
    status: "success",
    client: PHONE,
    user: LOGIN,
    destination: "user",
    start: "2026-10-17T08:30:00Z",
    wait: 5,
    duration: 30,
    record: LINK,
    ...extra,
  };
}

// A recording database. `handlers` map a function name to a function of its
// arguments returning `{ data, error }`; the defaults answer «all quiet».
function fakeDatabase(handlers = {}) {
  const calls = [];
  const created = [];
  const defaults = {
    telephony_maintenance_plan_v1: () => ({ data: plan(), error: null }),
    telephony_claim_work_v1: () => ({ data: { status: "ok", items: [] }, error: null }),
    telephony_project_work_v1: () => ({ data: { status: "succeeded" }, error: null }),
    telephony_settle_calls_v1: () => ({ data: { status: "ok", settled: 0, waiting: 0, flagged: 0, failed: 0 }, error: null }),
    telephony_automation_tick_v1: () => ({ data: { status: "disabled" }, error: null }),
    telephony_runtime_mark_v1: (args) => ({ data: { status: "ok", event: args.p_event }, error: null }),
    telephony_sync_extensions_v1: () => ({ data: { status: "ok", inserted: 0, deactivated: 0, conflicts: 0, reactivated: 0 }, error: null }),
    telephony_reconcile_apply_v1: (args) => ({
      data: { status: "ok", mode: args.p_mode, created: args.p_rows.length, updated: 0, unchanged: 0, invalid: 0, dropped: 0, suspected_duplicates: 0, links_set: args.p_rows.length, failed: 0 },
      error: null,
    }),
  };
  return {
    calls,
    created,
    createServiceClient(config) {
      created.push(config);
      return {
        schema(name) {
          assert.equal(name, "platform");
          return {
            rpc(functionName, args) {
              calls.push({ functionName, args });
              const handler = handlers[functionName] ?? defaults[functionName];
              if (handler === undefined) throw new Error(`unexpected rpc ${functionName}`);
              return Promise.resolve(handler(args, calls.filter((call) => call.functionName === functionName).length));
            },
          };
        },
      };
    },
    named(functionName) {
      return calls.filter((call) => call.functionName === functionName);
    },
    marks() {
      return this.named("telephony_runtime_mark_v1").map((call) => call.args);
    },
  };
}

// A recording PBX client.
function fakePbx(behaviour = {}) {
  const calls = [];
  const client = {
    async listUsers() {
      calls.push("listUsers");
      return behaviour.listUsers ? behaviour.listUsers() : { users: [{ login: LOGIN, name: "Test Employee", ext: "701" }], complete: true };
    },
    async getUser() {
      calls.push("getUser");
      throw new Error("not used by maintenance");
    },
    async countGroups() {
      calls.push("countGroups");
      return behaviour.countGroups ? behaviour.countGroups() : 2;
    },
    async getHistory(request) {
      calls.push({ op: "getHistory", start: request.start, end: request.end, limit: request.limit });
      return behaviour.getHistory
        ? behaviour.getHistory(request, calls.filter((call) => typeof call === "object" && call.op === "getHistory").length)
        : { rows: [], full: false };
    },
    async getDomain() {
      calls.push("getDomain");
      return behaviour.getDomain
        ? behaviour.getDomain()
        : { timezoneName: "Asia/Bishkek", timezoneOffsetMinutes: 360, usersUsed: 5, usersTotal: 5, recordService: true };
    },
    async getRecordSettings() {
      calls.push("getRecordSettings");
      return behaviour.getRecordSettings ? behaviour.getRecordSettings() : { external: true, inner: false, exceptions: 1 };
    },
    async makeCall() {
      calls.push("makeCall");
      throw new Error("never in T4a");
    },
  };
  return { calls, client, historyCalls: () => calls.filter((call) => typeof call === "object" && call.op === "getHistory") };
}

async function run({ env = environment(), database = fakeDatabase(), pbx = fakePbx(), sleeps = [], now = () => NOW, runBudgetMs = 150_000 } = {}) {
  const pbxConfigs = [];
  const report = await runTelephonyMaintenance({
    environment: env,
    createServiceClient: (config) => database.createServiceClient(config),
    createPbxClient: (config) => {
      pbxConfigs.push(config);
      return pbx.client;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    rpcDeadlineMs: 2_000,
    leaseOwner: "evo-telephony-maintenance:test-run",
    runBudgetMs,
    now,
  });
  return { report, database, pbx, pbxConfigs, sleeps };
}

function assertCleanLog(report) {
  const text = JSON.stringify(report.log);
  for (const forbidden of [PBX_KEY, PBX_URL, PBX_HOST, PHONE, LOGIN, "records.example", LINK, "sb_secret", ORGANIZATION_ID]) {
    assert.ok(!text.includes(forbidden), `the log leaks ${forbidden}`);
  }
  for (const [name, value] of Object.entries(report.log)) {
    assert.match(name, /^[a-z_]+$/u);
    assert.ok(typeof value === "number" || typeof value === "boolean" || /^[a-z0-9_:]+$/u.test(value), `${name}: ${value}`);
  }
}

// ---------------------------------------------------------------------------

test("anything but exactly 1 in the env switch does nothing at all: no database, no PBX", async () => {
  for (const value of [undefined, "", "0", "true", "yes", " 1", "1 ", "01"]) {
    const database = fakeDatabase();
    const pbx = fakePbx();
    const { report, pbxConfigs } = await run({ env: environment({ EVO_PLATFORM_TELEPHONY_ENABLED: value }), database, pbx });
    assert.equal(report.exitCode, 0, String(value));
    assert.deepEqual(report.log, { event: "telephony_maintenance", status: "disabled", reason: "env_switch" });
    assert.equal(database.created.length, 0, "no service client is even created");
    assert.equal(database.calls.length, 0);
    assert.equal(pbxConfigs.length, 0);
    assert.equal(pbx.calls.length, 0);
  }
});

test("a missing backend configuration fails clearly (exit 1) before any call", async () => {
  for (const missing of ["EVO_PLATFORM_ORGANIZATION_ID", "NEXT_PUBLIC_SUPABASE_URL", "EVO_PLATFORM_SUPABASE_SECRET_KEY"]) {
    const database = fakeDatabase();
    const { report } = await run({ env: environment({ [missing]: undefined }), database });
    assert.equal(report.exitCode, 1, missing);
    assert.equal(report.log.reason, "backend_not_configured");
    assert.equal(database.calls.length, 0);
    assertCleanLog(report);
  }
});

test("the plan is asked first and a database error or a malformed plan ends the run with exit 1", async () => {
  const failing = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: null, error: { message: "boom" } }) });
  const first = await run({ database: failing });
  assert.equal(first.report.exitCode, 1);
  assert.equal(first.report.log.reason, "database_error");
  assert.deepEqual(first.database.calls.map((call) => call.functionName), ["telephony_maintenance_plan_v1"]);
  assert.deepEqual(first.database.calls[0].args, { p_organization_id: ORGANIZATION_ID });

  for (const bad of [
    { status: "disabled" },
    plan({ reconcile: { due: true, window_start: "garbage", window_end: WINDOW_END.toISOString() } }),
    plan({ reconcile: dueWindow(WINDOW_END, WINDOW_START) }),
    plan({ daily: dueWindow(new Date(NOW - 48 * 3600_000), WINDOW_END) }),
    plan({ backfill: null }),
  ]) {
    const { report } = await run({ database: fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: bad, error: null }) }) });
    assert.equal(report.exitCode, 1);
    assert.equal(report.log.reason, "database_error");
  }

  const throwing = fakeDatabase({
    telephony_maintenance_plan_v1: () => {
      throw new Error("network down");
    },
  });
  assert.equal((await run({ database: throwing })).report.exitCode, 1);

  const slow = fakeDatabase({ telephony_maintenance_plan_v1: () => new Promise(() => undefined) });
  const timedOut = await runTelephonyMaintenance({
    environment: environment(),
    createServiceClient: (config) => slow.createServiceClient(config),
    createPbxClient: () => fakePbx().client,
    sleep: async () => undefined,
    rpcDeadlineMs: 20,
    leaseOwner: "evo-telephony-maintenance:test-run",
    runBudgetMs: 150_000,
    now: () => NOW,
  });
  assert.equal(timedOut.exitCode, 1);
});

test("with nothing due only the plan is read and the run ends cleanly", async () => {
  const { report, database, pbxConfigs } = await run();
  assert.equal(report.exitCode, 0);
  assert.equal(report.log.status, "ok");
  assert.deepEqual(database.calls.map((call) => call.functionName), ["telephony_maintenance_plan_v1"]);
  assert.equal(pbxConfigs.length, 1);
  assertCleanLog(report);
});

test("the local jobs claim and project the backlog, settle the window and stamp one tick", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ retry_due: true, settle_due: true }), error: null }),
    telephony_claim_work_v1: (_args, n) => ({
      data: { status: "ok", items: n === 1 ? [{ work_id: UUID_A, attempt: 1 }, { work_id: UUID_B, attempt: 1 }, { work_id: "not-a-uuid", attempt: 1 }] : [] },
      error: null,
    }),
    telephony_project_work_v1: (args) => ({ data: { status: args.p_work_id === UUID_A ? "succeeded" : "retry_wait" }, error: null }),
    telephony_settle_calls_v1: () => ({ data: { status: "ok", settled: 3, waiting: 1, flagged: 1, failed: 0 }, error: null }),
  });
  const { report } = await run({ env: environment({ EVO_PLATFORM_TELEPHONY_PBX_TOKEN: "" }), database });
  assert.equal(report.exitCode, 0);
  const claim = database.named("telephony_claim_work_v1");
  assert.equal(claim.length, 1, "a short batch ends the loop");
  assert.deepEqual(claim[0].args, {
    p_organization_id: ORGANIZATION_ID,
    p_lease_owner: "evo-telephony-maintenance:test-run",
    p_limit: 20,
    p_lease_seconds: 120,
  });
  assert.deepEqual(database.named("telephony_project_work_v1").map((call) => call.args.p_work_id), [UUID_A, UUID_B]);
  for (const call of database.named("telephony_project_work_v1")) {
    assert.equal(call.args.p_lease_owner, "evo-telephony-maintenance:test-run");
    assert.equal(call.args.p_organization_id, ORGANIZATION_ID);
  }
  assert.deepEqual(database.named("telephony_settle_calls_v1")[0].args, { p_organization_id: ORGANIZATION_ID, p_limit: 200 });
  assert.deepEqual(database.marks(), [{ p_organization_id: ORGANIZATION_ID, p_event: "tick" }]);
  assert.equal(report.log.retry_claimed, 2);
  assert.equal(report.log.retry_succeeded, 1);
  assert.equal(report.log.retry_waiting, 1);
  assert.equal(report.log.settled, 3);
  assert.equal(report.log.settle_flagged, 1);
  assert.equal(report.log.pbx, "invalid_incomplete_group");
  assertCleanLog(report);
});

test("the retry loop is bounded to five rounds and stops when the database says disabled", async () => {
  const busy = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ retry_due: true }), error: null }),
    telephony_claim_work_v1: () => ({
      data: { status: "ok", items: Array.from({ length: 20 }, (_, index) => ({ work_id: `77400000-0000-4000-8000-${String(index).padStart(12, "0")}`, attempt: 1 })) },
      error: null,
    }),
  });
  const { report } = await run({ database: busy });
  assert.equal(busy.named("telephony_claim_work_v1").length, 5);
  assert.equal(busy.named("telephony_project_work_v1").length, 100);
  assert.equal(report.log.retry_claimed, 100);

  const off = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ retry_due: true }), error: null }),
    telephony_claim_work_v1: () => ({ data: { status: "disabled", items: [] }, error: null }),
  });
  await run({ database: off });
  assert.equal(off.named("telephony_project_work_v1").length, 0);
});

test("an incomplete or invalid PBX group means no PBX client at all; the local jobs still run", async () => {
  for (const [overrides, expected] of [
    [{ EVO_PLATFORM_TELEPHONY_PBX_TOKEN: "", EVO_PLATFORM_TELEPHONY_PBX_URL: "", EVO_PLATFORM_TELEPHONY_PBX_HOST: "" }, "not_configured"],
    [{ EVO_PLATFORM_TELEPHONY_PBX_HOST: "" }, "invalid_incomplete_group"],
    [{ EVO_PLATFORM_TELEPHONY_PBX_URL: "http://tenant-test.ats.beeline.kg/crmapi/v1" }, "invalid_invalid_url"],
    [{ EVO_PLATFORM_TELEPHONY_PBX_URL: "https://pbx.example.com/crmapi/v1" }, "invalid_host_not_allowed"],
  ]) {
    const database = fakeDatabase({
      telephony_maintenance_plan_v1: () => ({ data: plan({ settle_due: true, users_due: true, reconcile: dueWindow() }), error: null }),
    });
    const { report, pbxConfigs } = await run({ env: environment(overrides), database });
    assert.equal(report.exitCode, 0);
    assert.equal(report.log.pbx, expected);
    assert.equal(pbxConfigs.length, 0, expected);
    assert.equal(database.named("telephony_settle_calls_v1").length, 1);
    assert.equal(database.named("telephony_sync_extensions_v1").length, 0);
    assert.equal(database.named("telephony_reconcile_apply_v1").length, 0);
    assertCleanLog(report);
  }
});

test("the outbound pause stops every PBX request while the local jobs run", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () =>
      ({ data: plan({ outbound_paused: true, settle_due: true, users_due: true, probe_due: true, reconcile: dueWindow() }), error: null }),
  });
  const { report, pbxConfigs, pbx } = await run({ database });
  assert.equal(report.log.pbx, "paused");
  assert.equal(pbxConfigs.length, 0);
  assert.equal(pbx.calls.length, 0);
  assert.equal(database.named("telephony_settle_calls_v1").length, 1);
});

test("the user directory job sends login, name and extension only and marks the counters", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ users_due: true }), error: null }),
    telephony_sync_extensions_v1: () => ({ data: { status: "ok", inserted: 2, deactivated: 1, conflicts: 0, reactivated: 1, updated: 0 }, error: null }),
  });
  const pbx = fakePbx({
    listUsers: () => ({
      users: [
        { login: "u701", name: "Test Employee One", ext: "701", email: "x@example.invalid", mobile: "996555000901" },
        { login: "u702", name: null, ext: null },
      ],
      complete: true,
    }),
  });
  const { report, pbxConfigs } = await run({ database, pbx });
  assert.equal(pbxConfigs[0].apiKey, PBX_KEY);
  assert.deepEqual(database.named("telephony_sync_extensions_v1")[0].args, {
    p_organization_id: ORGANIZATION_ID,
    p_users: [
      { login: "u701", name: "Test Employee One", ext: "701" },
      { login: "u702", name: null, ext: null },
    ],
    p_complete: true,
  });
  assert.deepEqual(database.marks(), [
    { p_organization_id: ORGANIZATION_ID, p_event: "users_ok", p_summary: { users: 2, inserted: 2, deactivated: 1, conflicts: 0, reactivated: 1 } },
  ]);
  assert.equal(report.log.users, "ok");
  assert.ok(!JSON.stringify(database.calls).includes("example.invalid"));
  assertCleanLog(report);
});

test("an incomplete PBX list is synced as partial and never deactivates anyone", async () => {
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ users_due: true }), error: null }) });
  await run({ database, pbx: fakePbx({ listUsers: () => ({ users: [{ login: "u701", name: "N", ext: "701" }], complete: false }) }) });
  assert.equal(database.named("telephony_sync_extensions_v1")[0].args.p_complete, false);
});

test("an empty PBX user list is an error mark, never a sync", async () => {
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ users_due: true }), error: null }) });
  const { report } = await run({ database, pbx: fakePbx({ listUsers: () => ({ users: [], complete: true }) }) });
  assert.equal(database.named("telephony_sync_extensions_v1").length, 0);
  assert.deepEqual(database.marks(), [{ p_organization_id: ORGANIZATION_ID, p_event: "users_error", p_error_code: "pbx_bad_response" }]);
  assert.equal(report.log.users, "error_pbx_bad_response");
  assert.equal(report.exitCode, 0);
});

test("a database answer other than ok to the sync is an error mark with no counters", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ users_due: true }), error: null }),
    telephony_sync_extensions_v1: () => ({ data: { status: "empty", received: 1, invalid: 1 }, error: null }),
  });
  await run({ database });
  assert.deepEqual(database.marks().map((mark) => mark.p_event), ["users_error"]);
});

test("the probe job maps the answers to the closed facts and marks them", async () => {
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ probe_due: true }), error: null }) });
  const { report } = await run({ database });
  assert.deepEqual(database.marks(), [
    {
      p_organization_id: ORGANIZATION_ID,
      p_event: "probe_ok",
      p_facts: {
        groups_total: 2,
        timezone_name: "Asia/Bishkek",
        timezone_offset_minutes: 360,
        users_used: 5,
        users_total: 5,
        record_service: true,
        record_external: true,
        record_inner: false,
        record_exceptions: 1,
      },
    },
  ]);
  assert.equal(report.log.probe, "ok");

  // A zone name of the wrong shape and missing answers are left out, not sent.
  const thin = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ probe_due: true }), error: null }) });
  await run({
    database: thin,
    pbx: fakePbx({
      getDomain: () => ({ timezoneName: "https://x.example.invalid", timezoneOffsetMinutes: null, usersUsed: null, usersTotal: -1, recordService: null }),
      getRecordSettings: () => ({ external: null, inner: null, exceptions: null }),
      countGroups: () => 0,
    }),
  });
  assert.deepEqual(thin.marks()[0].p_facts, { groups_total: 0, users_total: -1 });
});

test("a failed probe marks the coded error and sends no facts", async () => {
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ probe_due: true }), error: null }) });
  const { report } = await run({
    database,
    pbx: fakePbx({
      getRecordSettings: () => {
        throw new TelephonyPbxError("pbx_server_error", 500, true);
      },
    }),
  });
  assert.deepEqual(database.marks(), [{ p_organization_id: ORGANIZATION_ID, p_event: "probe_error", p_error_code: "pbx_server_error" }]);
  assert.equal(report.log.probe, "error_pbx_server_error");
});

test("the reconcile job fetches the plan window, applies in batches of 100 and moves the cursor to the window end", async () => {
  const rows = Array.from({ length: 250 }, (_, index) => historyRow(index));
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }) });
  const pbx = fakePbx({ getHistory: () => ({ rows, full: false }) });
  const { report } = await run({ database, pbx });
  const history = pbx.historyCalls();
  assert.equal(history.length, 1);
  assert.equal(history[0].start.getTime(), WINDOW_START.getTime());
  assert.equal(history[0].end.getTime(), WINDOW_END.getTime());
  assert.equal(history[0].limit, 500);
  const applies = database.named("telephony_reconcile_apply_v1");
  assert.deepEqual(applies.map((call) => call.args.p_rows.length), [100, 100, 50]);
  assert.ok(applies.every((call) => call.args.p_mode === "reconcile" && call.args.p_organization_id === ORGANIZATION_ID));
  assert.deepEqual(database.marks(), [
    {
      p_organization_id: ORGANIZATION_ID,
      p_event: "reconcile_ok",
      p_cursor: WINDOW_END.toISOString(),
      p_summary: { rows: 250, created: 250, updated: 0, unchanged: 0, invalid: 0, dropped: 0, suspected_duplicates: 0, links_set: 250, failed: 0, requests: 1, windows: 1 },
    },
  ]);
  assert.equal(report.log.reconcile, "ok");
  assert.equal(report.log.reconcile_rows, 250);
  assertCleanLog(report);
  // The order inside a run: every apply happens before the cursor mark.
  const order = database.calls.map((call) => call.functionName);
  assert.ok(order.lastIndexOf("telephony_reconcile_apply_v1") < order.lastIndexOf("telephony_runtime_mark_v1"));
});

test("the same PBX id seen twice in a window is applied once; rows without an id are passed on", async () => {
  const rows = [historyRow(1), historyRow(1, { duration: 99 }), historyRow(2), { type: "in", start: "2026-10-17T08:30:00Z" }];
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }) });
  await run({ database, pbx: fakePbx({ getHistory: () => ({ rows, full: false }) }) });
  const sent = database.named("telephony_reconcile_apply_v1").flatMap((call) => call.args.p_rows);
  assert.equal(sent.length, 3);
  assert.equal(sent.filter((row) => row.uid === "1001").length, 1);
  assert.equal(sent.find((row) => row.uid === "1001").duration, 99, "the later copy wins");
});

test("an empty window still moves the cursor (nothing to apply)", async () => {
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }) });
  await run({ database });
  assert.equal(database.named("telephony_reconcile_apply_v1").length, 0);
  assert.deepEqual(database.marks().map((mark) => mark.p_event), ["reconcile_ok"]);
  assert.equal(database.marks()[0].p_cursor, WINDOW_END.toISOString());
});

test("daily uses the reconcile writer without a cursor; the import uses the backfill writer and moves back to the window start", async () => {
  const dailyDatabase = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ daily: dueWindow() }), error: null }) });
  const rows = [historyRow(1)];
  await run({ database: dailyDatabase, pbx: fakePbx({ getHistory: () => ({ rows, full: false }) }) });
  assert.equal(dailyDatabase.named("telephony_reconcile_apply_v1")[0].args.p_mode, "reconcile");
  assert.deepEqual(dailyDatabase.marks().map((mark) => [mark.p_event, "p_cursor" in mark]), [["daily_ok", false]]);

  const backfillDatabase = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ backfill: dueWindow() }), error: null }) });
  await run({ database: backfillDatabase, pbx: fakePbx({ getHistory: () => ({ rows, full: false }) }) });
  assert.equal(backfillDatabase.named("telephony_reconcile_apply_v1")[0].args.p_mode, "backfill");
  const mark = backfillDatabase.marks()[0];
  assert.equal(mark.p_event, "backfill_ok");
  assert.equal(mark.p_cursor, WINDOW_START.toISOString());
});

test("at most one history job runs per run: reconcile before daily before the import", async () => {
  const all = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow(), daily: dueWindow(), backfill: dueWindow() }), error: null }),
  });
  const pbx = fakePbx({ getHistory: () => ({ rows: [historyRow(1)], full: false }) });
  const { report } = await run({ database: all, pbx });
  assert.equal(pbx.historyCalls().length, 1);
  assert.deepEqual(all.marks().map((mark) => mark.p_event), ["reconcile_ok"]);
  assert.equal(report.log.reconcile, "ok");
  assert.ok(!("daily" in report.log) && !("backfill" in report.log));

  const second = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ daily: dueWindow(), backfill: dueWindow() }), error: null }),
  });
  await run({ database: second, pbx: fakePbx({ getHistory: () => ({ rows: [], full: false }) }) });
  assert.deepEqual(second.marks().map((mark) => mark.p_event), ["daily_ok"]);
});

test("a full page splits the window in halves, pauses between requests and merges the rows", async () => {
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }) });
  const sleeps = [];
  const pbx = fakePbx({
    getHistory: (request, n) => {
      if (n === 1) return { rows: [historyRow(1)], full: true };
      return { rows: [historyRow(n), historyRow(1)], full: false };
    },
  });
  const { report } = await run({ database, pbx, sleeps });
  const history = pbx.historyCalls();
  assert.equal(history.length, 3);
  const middle = WINDOW_START.getTime() + (WINDOW_END.getTime() - WINDOW_START.getTime()) / 2;
  assert.deepEqual([history[1].start.getTime(), history[1].end.getTime()], [WINDOW_START.getTime(), middle]);
  assert.deepEqual([history[2].start.getTime(), history[2].end.getTime()], [middle, WINDOW_END.getTime()]);
  assert.deepEqual(sleeps, [1000, 1000]);
  const sent = database.named("telephony_reconcile_apply_v1").flatMap((call) => call.args.p_rows);
  assert.deepEqual(sent.map((row) => row.uid).sort(), ["1001", "1002", "1003"]);
  assert.equal(database.marks()[0].p_summary.requests, 3);
  assert.equal(report.log.reconcile_requests, 3);
});

test("a window that stays full is an error, not a silent gap: no cursor, no rows applied", async () => {
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }) });
  const pbx = fakePbx({ getHistory: () => ({ rows: [historyRow(1)], full: true }) });
  const { report } = await run({ database, pbx });
  assert.ok(pbx.historyCalls().length <= 16, "the per-run request budget holds");
  assert.deepEqual(database.marks(), [{ p_organization_id: ORGANIZATION_ID, p_event: "reconcile_error", p_error_code: "pbx_window_too_dense" }]);
  assert.equal(database.named("telephony_reconcile_apply_v1").length, 0);
  assert.equal(report.exitCode, 0);
});

test("a PBX error on the history request marks the code, moves no cursor and applies nothing", async () => {
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }) });
  const pbx = fakePbx({
    getHistory: () => {
      throw new TelephonyPbxError("pbx_timeout", null, true);
    },
  });
  const { report } = await run({ database, pbx });
  assert.deepEqual(database.marks(), [{ p_organization_id: ORGANIZATION_ID, p_event: "reconcile_error", p_error_code: "pbx_timeout" }]);
  assert.equal(database.named("telephony_reconcile_apply_v1").length, 0);
  assert.equal(report.log.reconcile, "error_pbx_timeout");
  assert.equal(report.exitCode, 0, "a PBX failure is recorded state, not a failed run");
});

test("an authentication-class error skips the rest of the PBX jobs of the run", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ users_due: true, probe_due: true, reconcile: dueWindow() }), error: null }),
  });
  const pbx = fakePbx({
    listUsers: () => {
      throw new TelephonyPbxError("pbx_invalid_token", 401);
    },
  });
  const { report } = await run({ database, pbx });
  assert.deepEqual(pbx.calls, ["listUsers"]);
  assert.deepEqual(database.marks(), [{ p_organization_id: ORGANIZATION_ID, p_event: "users_error", p_error_code: "pbx_invalid_token" }]);
  assert.equal(report.log.users, "error_pbx_invalid_token");
  assert.equal(report.log.probe, "skipped_after_auth_error");
  assert.equal(report.log.reconcile, "skipped_after_auth_error");
  assert.equal(report.exitCode, 0);

  // A non-authentication error does not stop the next job.
  const other = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ users_due: true, probe_due: true }), error: null }),
  });
  const pbx2 = fakePbx({
    listUsers: () => {
      throw new TelephonyPbxError("pbx_server_error", 500, true);
    },
  });
  await run({ database: other, pbx: pbx2 });
  assert.deepEqual(other.marks().map((mark) => mark.p_event), ["users_error", "probe_ok"]);
});

test("when the database turns the writer off the job is skipped and nothing is marked", async () => {
  for (const status of ["disabled", "directory_empty"]) {
    const database = fakeDatabase({
      telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }),
      telephony_reconcile_apply_v1: () => ({ data: { status, reason: "projection" }, error: null }),
    });
    const pbx = fakePbx({ getHistory: () => ({ rows: [historyRow(1)], full: false }) });
    const { report } = await run({ database, pbx });
    assert.equal(report.log.reconcile, `skipped_${status}`);
    assert.equal(database.marks().length, 0, "no ok mark, so the cursor does not move");
    assert.equal(report.exitCode, 0);
  }
});

test("a database failure while applying ends the run with exit 1 and moves no cursor", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }),
    telephony_reconcile_apply_v1: () => ({ data: null, error: { message: "timeout" } }),
  });
  const { report } = await run({ database, pbx: fakePbx({ getHistory: () => ({ rows: [historyRow(1)], full: false }) }) });
  assert.equal(report.exitCode, 1);
  assert.equal(report.log.reason, "database_error");
  assert.equal(database.marks().length, 0);
});

test("a database failure on a later batch moves no cursor either", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }),
    telephony_reconcile_apply_v1: (args, n) =>
      n === 1
        ? { data: { status: "ok", created: 100, updated: 0, unchanged: 0, invalid: 0, dropped: 0, suspected_duplicates: 0, links_set: 0, failed: 0 }, error: null }
        : { data: null, error: { message: "boom" } },
  });
  const rows = Array.from({ length: 150 }, (_, index) => historyRow(index));
  const { report } = await run({ database, pbx: fakePbx({ getHistory: () => ({ rows, full: false }) }) });
  assert.equal(report.exitCode, 1);
  assert.equal(database.named("telephony_reconcile_apply_v1").length, 2);
  assert.equal(database.marks().length, 0);
});

test("failed rows reported by the database are counted but do not block the cursor", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }),
    telephony_reconcile_apply_v1: () => ({
      data: { status: "ok", created: 1, updated: 0, unchanged: 0, invalid: 0, dropped: 0, suspected_duplicates: 0, links_set: 0, failed: 1, error_codes: ["e23514_x"] },
      error: null,
    }),
  });
  const { report } = await run({ database, pbx: fakePbx({ getHistory: () => ({ rows: [historyRow(1), historyRow(2)], full: false }) }) });
  assert.deepEqual(database.marks().map((mark) => mark.p_event), ["reconcile_ok"]);
  assert.equal(database.marks()[0].p_summary.failed, 1);
  assert.equal(report.log.reconcile_failed, 1);
});

test("the order inside one run is local jobs, directory, probe, then the single history job", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () =>
      ({ data: plan({ retry_due: true, settle_due: true, users_due: true, probe_due: true, reconcile: dueWindow() }), error: null }),
  });
  const pbx = fakePbx({ getHistory: () => ({ rows: [historyRow(1)], full: false }) });
  await run({ database, pbx });
  assert.deepEqual(database.calls.map((call) => call.functionName), [
    "telephony_maintenance_plan_v1",
    "telephony_claim_work_v1",
    "telephony_settle_calls_v1",
    "telephony_automation_tick_v1",
    "telephony_runtime_mark_v1",
    "telephony_sync_extensions_v1",
    "telephony_runtime_mark_v1",
    "telephony_runtime_mark_v1",
    "telephony_reconcile_apply_v1",
    "telephony_runtime_mark_v1",
  ]);
  assert.deepEqual(database.marks().map((mark) => mark.p_event), ["tick", "users_ok", "probe_ok", "reconcile_ok"]);
  assert.deepEqual(
    pbx.calls.map((call) => (typeof call === "string" ? call : call.op)),
    ["listUsers", "getDomain", "getRecordSettings", "countGroups", "getHistory"],
  );
});

test("the log of a busy run holds counters and fixed words only", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () =>
      ({ data: plan({ retry_due: true, settle_due: true, users_due: true, probe_due: true, reconcile: dueWindow() }), error: null }),
    telephony_claim_work_v1: (_args, n) => ({ data: { status: "ok", items: n === 1 ? [{ work_id: UUID_A, attempt: 1 }] : [] }, error: null }),
  });
  const pbx = fakePbx({ getHistory: () => ({ rows: [historyRow(1), historyRow(2)], full: false }) });
  const { report } = await run({ database, pbx });
  assertCleanLog(report);
  // The link, the phone and the login travel to the database as data, and only there.
  const sentToDatabase = JSON.stringify(database.named("telephony_reconcile_apply_v1"));
  assert.ok(sentToDatabase.includes(LINK) && sentToDatabase.includes(PHONE));
  const marks = JSON.stringify(database.marks());
  for (const forbidden of [LINK, PHONE, LOGIN, PBX_KEY]) assert.ok(!marks.includes(forbidden), forbidden);
});

test("an unexpected failure inside a job is an internal error with exit 1, still with a clean log", async () => {
  const database = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ probe_due: true }), error: null }) });
  const pbx = fakePbx({
    getDomain: () => {
      throw new RangeError(`unexpected ${PHONE} ${LINK}`);
    },
  });
  const { report } = await run({ database, pbx });
  assert.equal(report.exitCode, 1);
  assert.equal(report.log.reason, "internal_error");
  assertCleanLog(report);
});

test("the run budgets itself: after the budget no PBX job or request starts", async () => {
  // Directory and probe are due; the clock jumps past the budget while the directory job runs.
  let clock = NOW;
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ users_due: true, probe_due: true, reconcile: dueWindow() }), error: null }),
  });
  const pbx = fakePbx({
    listUsers: () => {
      clock += 151_000;
      return { users: [{ login: "u701", name: "N", ext: "701" }], complete: true };
    },
  });
  const { report } = await run({ database, pbx, now: () => clock, runBudgetMs: 150_000 });
  assert.equal(report.log.users, "ok");
  assert.equal(report.log.probe, "skipped_run_budget");
  assert.equal(report.log.reconcile, "skipped_run_budget");
  assert.deepEqual(pbx.calls, ["listUsers"]);
  assert.deepEqual(database.marks().map((mark) => mark.p_event), ["users_ok"], "a skipped job is not an error and marks nothing");
  assert.equal(report.exitCode, 0);

  // Inside one history window the budget also stops the next request: an error mark, no cursor.
  let inner = NOW;
  const history = fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ reconcile: dueWindow() }), error: null }) });
  const slow = fakePbx({
    getHistory: (_request, n) => {
      inner += 100_000;
      return { rows: [historyRow(n)], full: true };
    },
  });
  const stopped = await run({ database: history, pbx: slow, now: () => inner, runBudgetMs: 150_000 });
  assert.equal(slow.historyCalls().length, 2);
  assert.deepEqual(history.marks(), [{ p_organization_id: ORGANIZATION_ID, p_event: "reconcile_error", p_error_code: "pbx_timeout" }]);
  assert.equal(stopped.report.exitCode, 0);
});

test("the script never calls makeCall or getUser", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () =>
      ({ data: plan({ users_due: true, probe_due: true, reconcile: dueWindow() }), error: null }),
  });
  const pbx = fakePbx();
  await run({ database, pbx });
  assert.ok(!pbx.calls.includes("makeCall") && !pbx.calls.includes("getUser"));
});

// ---------------------------------------------------------------------------
// Slice T8: the missed-call automation tick.
// ---------------------------------------------------------------------------

test("the automation tick runs right after the settle window with the batch limit, and the log keeps counters and fixed words", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ settle_due: true }), error: null }),
    telephony_automation_tick_v1: () => ({
      data: { status: "ok", created: 2, callback_tasks: 1, merged: 3, closed: 1, cancelled: 1, failed: 1, skipped: 4, marked: 1, stop_code: null, last_error_code: "e23514_t_check" },
      error: null,
    }),
  });
  const { report } = await run({ env: environment({ EVO_PLATFORM_TELEPHONY_PBX_TOKEN: "" }), database });
  assert.deepEqual(database.calls.map((call) => call.functionName), [
    "telephony_maintenance_plan_v1",
    "telephony_settle_calls_v1",
    "telephony_automation_tick_v1",
    "telephony_runtime_mark_v1",
  ]);
  assert.deepEqual(database.named("telephony_automation_tick_v1")[0].args, { p_organization_id: ORGANIZATION_ID, p_limit: 100 });
  assert.equal(report.exitCode, 0, "a counter of failed calls is data, the run itself is fine");
  assert.equal(report.log.automation, "ok");
  assert.equal(report.log.automation_created, 3);
  assert.equal(report.log.automation_merged, 3);
  assert.equal(report.log.automation_closed, 2);
  assert.equal(report.log.automation_failed, 1);
  assert.equal(report.log.automation_error, "e23514_t_check");
  assert.ok(!("automation_stop" in report.log));
  assertCleanLog(report);
});

test("no settle window due means no automation tick; the env switch off means no call at all", async () => {
  const quiet = await run({ database: fakeDatabase({ telephony_maintenance_plan_v1: () => ({ data: plan({ retry_due: true }), error: null }) }) });
  assert.equal(quiet.database.named("telephony_automation_tick_v1").length, 0);
  assert.ok(!("automation" in quiet.report.log));
  const off = await run({ env: environment({ EVO_PLATFORM_TELEPHONY_ENABLED: "0" }) });
  assert.equal(off.database.calls.length, 0);
});

test("a database that says disabled or stopped is reported as a fixed word, with the stop code", async () => {
  for (const [answer, expected] of [
    [{ status: "disabled" }, "disabled"],
    [{ status: "busy" }, "busy"],
    [{ status: "stopped", stop_code: "tasks_hour", created: 2, merged: 0, closed: 0, failed: 0 }, "stopped"],
  ]) {
    const database = fakeDatabase({
      telephony_maintenance_plan_v1: () => ({ data: plan({ settle_due: true }), error: null }),
      telephony_automation_tick_v1: () => ({ data: answer, error: null }),
    });
    const { report } = await run({ database });
    assert.equal(report.exitCode, 0);
    assert.equal(report.log.automation, expected);
    if (expected === "stopped") {
      assert.equal(report.log.automation_stop, "tasks_hour");
      assert.equal(report.log.automation_created, 2);
    } else {
      assert.ok(!("automation_stop" in report.log) && !("automation_created" in report.log));
    }
    assertCleanLog(report);
  }
});

test("a text the database should never send never reaches the log", async () => {
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ settle_due: true }), error: null }),
    telephony_automation_tick_v1: () => ({
      data: { status: `ok ${PHONE}`, created: 1, stop_code: `https://x.example.invalid/${PHONE}`, last_error_code: LINK },
      error: null,
    }),
  });
  const { report } = await run({ database });
  assert.equal(report.log.automation, "unknown");
  assert.ok(!("automation_stop" in report.log) && !("automation_error" in report.log) && !("automation_created" in report.log));
  assertCleanLog(report);
  const odd = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ settle_due: true }), error: null }),
    telephony_automation_tick_v1: () => ({ data: { status: "ok", stop_code: `Tasks Hour ${PHONE}`, last_error_code: `${LINK}`, created: -4, merged: 1.5 }, error: null }),
  });
  const second = await run({ database: odd });
  assert.equal(second.report.log.automation, "ok");
  assert.ok(!("automation_stop" in second.report.log) && !("automation_error" in second.report.log));
  assert.equal(second.report.log.automation_created, 0, "a negative count is not a count");
  assert.equal(second.report.log.automation_merged, 0, "a fraction is not a count");
  assertCleanLog(second.report);
});

test("a failing automation tick ends the run with exit 1 but never stops the PBX jobs", async () => {
  for (const failing of [
    () => ({ data: null, error: { message: `boom ${PHONE}` } }),
    () => ({ data: { status: "ok" }, error: { message: "x" } }),
    () => {
      throw new Error(`network ${PHONE}`);
    },
  ]) {
    const database = fakeDatabase({
      telephony_maintenance_plan_v1: () => ({ data: plan({ settle_due: true, users_due: true, reconcile: dueWindow() }), error: null }),
      telephony_automation_tick_v1: failing,
    });
    const pbx = fakePbx({ getHistory: () => ({ rows: [historyRow(1)], full: false }) });
    const { report } = await run({ database, pbx });
    assert.equal(report.exitCode, 1);
    assert.equal(report.log.automation, "failed");
    assert.equal(report.log.status, "ok", "the run itself did not fail");
    assert.equal(report.log.users, "ok", "the directory job still ran");
    assert.equal(report.log.reconcile, "ok", "the reconcile still ran");
    assert.deepEqual(database.marks().map((mark) => mark.p_event), ["tick", "users_ok", "reconcile_ok"]);
    assertCleanLog(report);
  }
  // The same failure with the PBX unconfigured and with the pause on also ends with exit 1.
  for (const overrides of [{ EVO_PLATFORM_TELEPHONY_PBX_TOKEN: "" }]) {
    const database = fakeDatabase({
      telephony_maintenance_plan_v1: () => ({ data: plan({ settle_due: true }), error: null }),
      telephony_automation_tick_v1: () => ({ data: null, error: { message: "boom" } }),
    });
    assert.equal((await run({ env: environment(overrides), database })).report.exitCode, 1);
  }
  const paused = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ settle_due: true, outbound_paused: true }), error: null }),
    telephony_automation_tick_v1: () => ({ data: null, error: { message: "boom" } }),
  });
  const pausedRun = await run({ database: paused });
  assert.equal(pausedRun.report.exitCode, 1);
  assert.equal(pausedRun.report.log.pbx, "paused");
});

test("the pause of outbound dialing does not stop the automation tick", async () => {
  // outbound_paused is a kill switch for dialing and PBX requests; the automation only writes tasks.
  const database = fakeDatabase({
    telephony_maintenance_plan_v1: () => ({ data: plan({ settle_due: true, outbound_paused: true }), error: null }),
    telephony_automation_tick_v1: () => ({ data: { status: "ok", created: 1, merged: 0, closed: 0, failed: 0 }, error: null }),
  });
  const { report } = await run({ database });
  assert.equal(report.log.pbx, "paused");
  assert.equal(report.log.automation, "ok");
  assert.equal(database.named("telephony_automation_tick_v1").length, 1);
});

test("the tick's call matches migration 298: one service-only function with the same parameter names, closed by both flags, opening nothing", () => {
  const migration = readFileSync(new URL("../supabase/migrations/298_platform_telephony_missed_tasks.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE FUNCTION platform\.telephony_automation_tick_v1\(p_organization_id UUID, p_limit INTEGER DEFAULT 100\)/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION platform\.telephony_automation_tick_v1\(UUID, INTEGER\) TO service_role;/u);
  assert.match(migration, /NOT s\.projection_enabled OR NOT s\.missed_task_enabled/u);
  // The slice opens nothing: it never writes a flag to TRUE, never creates a settings row, never schedules itself.
  assert.doesNotMatch(migration, /(missed_task_enabled|projection_enabled|unknown_lead_enabled|dial_enabled|ui_enabled)\s*=\s*TRUE/iu);
  assert.doesNotMatch(migration, /INSERT INTO platform_private\.telephony_settings/u);
  assert.doesNotMatch(migration, /\bcron\b|pg_cron|pg_notify|CREATE TRIGGER/iu);
  // The only flags it writes are the two automation flags, to FALSE, when a ceiling fires.
  assert.match(migration, /SET missed_task_enabled = FALSE, unknown_lead_enabled = FALSE/u);
  const source = readFileSync(new URL("../src/lib/server/platform-telephony-maintenance.ts", import.meta.url), "utf8");
  assert.match(source, /"telephony_automation_tick_v1",\s*\{\s*p_organization_id: organizationId,\s*p_limit: AUTOMATION_BATCH,/u);
});
