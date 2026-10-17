import assert from "node:assert/strict";
import test from "node:test";

import {
  createTelephonyPbxClient,
  TELEPHONY_PBX_HISTORY_LIMIT,
  TELEPHONY_PBX_OPERATIONS,
  TELEPHONY_PBX_STOPPING_ERRORS,
  TelephonyPbxError,
} from "../src/lib/server/platform-telephony-pbx-client.ts";

// Everything here is synthetic. The response shapes follow the public portal
// documentation of crmapi/v1 (users, groups, history/json, domain, record);
// the names, logins, numbers and links are made up.
const KEY = "pbx-test-key-0123456789abcdef";
const BASE = "https://tenant-test.ats.beeline.kg/crmapi/v1";
const CONFIG = Object.freeze({
  baseUrl: BASE,
  apiHost: "tenant-test.ats.beeline.kg",
  recordingHost: "tenant-test.ats.beeline.kg",
  apiKey: KEY,
});

const USERS_SAMPLE = {
  items: [
    {
      login: "u701",
      name: "Test Employee One",
      position: "Manager",
      ext: "701",
      telnum: "",
      email: "employee-one@example.invalid",
      role: "admin",
      mobile: "996555000901",
      mobile_redirect: { enabled: false },
      calls_forwarding: { sip: true, mobile: false },
      timeout_forwarding: { timeout: 15, type: "group", group: "sales" },
      status: "online",
      schedule: { type: "daysOfWeek", daysOfWeek: { monday: { start: 0, end: 60, holiday: false } } },
    },
    { login: "u702", name: "Test Employee Two", ext: "702", role: "user", status: "offline" },
    { name: "an entry without a login", ext: "999" },
    "not an object",
  ],
  info: { search: "", start: 0, limit: 100, total: 4 },
};

const HISTORY_SAMPLE = [
  {
    uid: "3934307521",
    type: "in",
    status: "missed",
    client: "996555000111",
    destination: "group",
    user: "",
    user_name: "",
    group_name: "Test Sales",
    diversion: "996312000000",
    start: "2026-10-10T08:59:22Z",
    wait: 13,
    duration: 0,
    record: "",
    note: "free text that EVO never reads",
    rating: 5,
  },
  {
    uid: "1755936870",
    type: "in",
    status: "success",
    client: "996555000111",
    user: "u701",
    user_name: "Test Employee One",
    group_name: "",
    diversion: "996312000000",
    start: "2026-10-10T08:58:42Z",
    wait: 5,
    duration: 23,
    record: "https://records.example.invalid/t-sample-1.mp3",
    missedStatus: 2,
  },
];

const DOMAIN_SAMPLE = {
  timezone: { name: "Asia/Bishkek", offset: 360 },
  limits: { users: { used: 5, total: 5 }, local_gw: { used: 0, total: 1 }, groups: { used: 2, total: 7 } },
  services: { record: true, local_gw: false, branch: false },
};

const RECORD_SAMPLE = {
  external: true,
  inner: false,
  users_exception: [{ login: "u701", name: "Test Employee One" }],
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function harness(handler, options = {}) {
  const state = { calls: [], sleeps: [], attempts: [] };
  const client = createTelephonyPbxClient(options.config ?? CONFIG, {
    fetch: async (url, init) => {
      state.calls.push({ url, init });
      return handler(url, init, state.calls.length);
    },
    sleep: async (ms) => {
      state.sleeps.push(ms);
    },
    onAttempt: (attempt) => state.attempts.push(attempt),
    ...(options.dependencies ?? {}),
  });
  return { client, state };
}

function parsed(call) {
  return new URL(call.url);
}

test("the closed operation list is exactly six reads and the makecall stub", () => {
  assert.deepEqual(
    TELEPHONY_PBX_OPERATIONS.map((operation) => `${operation.method} ${operation.path}`),
    [
      "GET /users",
      "GET /users/{login}",
      "GET /groups",
      "GET /history/json",
      "GET /domain",
      "GET /record",
      "POST /makecall",
    ],
  );
  assert.ok(Object.isFrozen(TELEPHONY_PBX_OPERATIONS));
});

test("makeCall is a stub: it refuses without touching the network", async () => {
  const { client, state } = harness(() => jsonResponse({}));
  await assert.rejects(client.makeCall(), (error) => error instanceof TelephonyPbxError && error.code === "pbx_makecall_disabled");
  assert.equal(state.calls.length, 0);
});

test("every request is an https GET to the configured base with the key only in X-API-KEY", async () => {
  const { client, state } = harness((url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/users")) return jsonResponse(USERS_SAMPLE);
    if (path.includes("/users/")) return jsonResponse({ login: "u701", status: "online", calls_forwarding: { sip: true, mobile: false } });
    if (path.endsWith("/groups")) return jsonResponse({ items: [], info: { total: 2 } });
    if (path.endsWith("/history/json")) return jsonResponse(HISTORY_SAMPLE);
    if (path.endsWith("/domain")) return jsonResponse(DOMAIN_SAMPLE);
    if (path.endsWith("/record")) return jsonResponse(RECORD_SAMPLE);
    return jsonResponse({}, 404);
  });
  await client.listUsers();
  await client.getUser("u701");
  await client.countGroups();
  await client.getHistory({ start: new Date("2026-10-10T08:00:00Z"), end: new Date("2026-10-10T10:00:00Z") });
  await client.getDomain();
  await client.getRecordSettings();
  assert.equal(state.calls.length, 6);
  const allowedPaths = new Set(["/crmapi/v1/users", "/crmapi/v1/users/u701", "/crmapi/v1/groups", "/crmapi/v1/history/json", "/crmapi/v1/domain", "/crmapi/v1/record"]);
  for (const call of state.calls) {
    const url = parsed(call);
    assert.equal(url.protocol, "https:");
    assert.equal(url.host, "tenant-test.ats.beeline.kg");
    assert.ok(allowedPaths.has(url.pathname), url.pathname);
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.headers["X-API-KEY"], KEY);
    assert.equal(call.init.redirect, "manual");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.body, undefined);
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.ok(!call.url.includes(KEY), "the key is never in a URL");
    assert.ok(!Object.entries(call.init.headers).some(([name, value]) => name !== "X-API-KEY" && String(value).includes(KEY)));
  }
});

test("listUsers keeps login, name and extension only and skips entries without a login", async () => {
  const { client, state } = harness(() => jsonResponse(USERS_SAMPLE));
  const result = await client.listUsers();
  assert.equal(result.complete, true);
  assert.deepEqual(result.users, [
    { login: "u701", name: "Test Employee One", ext: "701" },
    { login: "u702", name: "Test Employee Two", ext: "702" },
  ]);
  const text = JSON.stringify(result);
  assert.ok(!text.includes("example.invalid") && !text.includes("996555000901") && !text.includes("schedule"));
  const url = parsed(state.calls[0]);
  assert.equal(url.pathname, "/crmapi/v1/users");
  assert.equal(url.searchParams.get("start"), "0");
  assert.equal(url.searchParams.get("limit"), "100");
});

test("listUsers pages until the total and reports incomplete when a page never ends", async () => {
  const page = (from, size) => ({
    items: Array.from({ length: size }, (_, index) => ({ login: `p${from + index}`, name: `N ${from + index}`, ext: String(from + index) })),
    info: { total: 150, start: from, limit: 100 },
  });
  const paged = harness((url) => {
    const start = Number(new URL(url).searchParams.get("start"));
    return jsonResponse(start === 0 ? page(0, 100) : page(100, 50));
  });
  const result = await paged.client.listUsers();
  assert.equal(result.users.length, 150);
  assert.equal(result.complete, true);
  assert.deepEqual(paged.state.calls.map((call) => parsed(call).searchParams.get("start")), ["0", "100"]);

  // A PBX that ignores `start` and keeps answering a full page never ends: stop at ten pages.
  const stuck = harness(() => jsonResponse({ items: page(0, 100).items }));
  const incomplete = await stuck.client.listUsers();
  assert.equal(incomplete.complete, false);
  assert.equal(stuck.state.calls.length, 10);
});

test("getUser encodes the login, asks with=status and keeps the status and forwarding flags", async () => {
  const { client, state } = harness(() =>
    jsonResponse({ login: "u701", status: "online", email: "x@example.invalid", calls_forwarding: { sip: true, mobile: true, mobile_delay: 15 } }),
  );
  const result = await client.getUser("u701");
  assert.deepEqual(result, { login: "u701", status: "online", forwardingSip: true, forwardingMobile: true });
  assert.equal(parsed(state.calls[0]).searchParams.get("with"), "status");
  assert.equal(parsed(state.calls[0]).pathname, "/crmapi/v1/users/u701");

  const encoded = harness(() => jsonResponse({ login: "a@b.c", status: "offline" }));
  await encoded.client.getUser("a@b.c");
  assert.equal(parsed(encoded.state.calls[0]).pathname, "/crmapi/v1/users/a%40b.c");

  // A login that could change the path is refused before any request.
  const refused = harness(() => jsonResponse({}));
  for (const bad of ["../groups", "u701/../../x", "u 701", "", "u701?x=1", "u701#x", "u701\n"]) {
    await assert.rejects(refused.client.getUser(bad), (error) => error.code === "pbx_validation_error", JSON.stringify(bad));
  }
  assert.equal(refused.state.calls.length, 0);
});

test("countGroups reads info.total (or the list length)", async () => {
  assert.equal(await harness(() => jsonResponse({ items: [{ id: "sales" }], info: { total: 2 } })).client.countGroups(), 2);
  assert.equal(await harness(() => jsonResponse({ items: [{ id: "a" }, { id: "b" }, { id: "c" }] })).client.countGroups(), 3);
  await assert.rejects(harness(() => jsonResponse({ nothing: true })).client.countGroups(), (error) => error.code === "pbx_bad_response");
});

test("getHistory sends the documented parameters and never `period`", async () => {
  const { client, state } = harness(() => jsonResponse(HISTORY_SAMPLE));
  const result = await client.getHistory({
    start: new Date("2026-10-10T08:00:00.000Z"),
    end: new Date("2026-10-10T10:30:15.999Z"),
  });
  const url = parsed(state.calls[0]);
  assert.equal(url.pathname, "/crmapi/v1/history/json");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    start: "20261010T080000Z",
    end: "20261010T103015Z",
    type: "all",
    limit: String(TELEPHONY_PBX_HISTORY_LIMIT),
    first_answered: "true",
    processMissed: "true",
  });
  assert.equal(url.searchParams.has("period"), false);
  assert.equal(result.full, false);
  assert.equal(result.rows.length, 2);
});

test("getHistory keeps only the reconciliation fields and drops notes, ratings and names", async () => {
  const { client } = harness(() => jsonResponse(HISTORY_SAMPLE));
  const { rows } = await client.getHistory({ start: new Date("2026-10-10T08:00:00Z"), end: new Date("2026-10-10T10:00:00Z") });
  assert.deepEqual(rows[0], {
    uid: "3934307521",
    type: "in",
    status: "missed",
    client: "996555000111",
    diversion: "996312000000",
    destination: "group",
    user: "",
    group_name: "Test Sales",
    start: "2026-10-10T08:59:22Z",
    wait: 13,
    duration: 0,
    record: "",
  });
  assert.equal(rows[1].record, "https://records.example.invalid/t-sample-1.mp3");
  assert.equal(rows[1].missedStatus, 2);
  for (const row of rows) {
    assert.ok(!("note" in row) && !("rating" in row) && !("user_name" in row));
  }
});

test("getHistory accepts a bare array or the list wrapper and nothing else; numeric ids stay numbers", async () => {
  const wrapped = harness(() => jsonResponse({ items: [{ uid: 42, type: "out", start: "2026-10-10T08:59:22Z" }], info: { total: 1 } }));
  const result = await wrapped.client.getHistory({ start: new Date("2026-10-10T08:00:00Z"), end: new Date("2026-10-10T10:00:00Z") });
  assert.equal(result.rows[0].uid, 42);
  for (const shape of [{ rows: [] }, "text", 7, null]) {
    const bad = harness(() => jsonResponse(JSON.stringify(shape)));
    await assert.rejects(
      bad.client.getHistory({ start: new Date("2026-10-10T08:00:00Z"), end: new Date("2026-10-10T10:00:00Z") }),
      (error) => error.code === "pbx_bad_response",
      JSON.stringify(shape),
    );
  }
});

test("getHistory reports a full page and refuses an empty or reversed window before any request", async () => {
  const full = harness(() => jsonResponse(Array.from({ length: 3 }, (_, index) => ({ uid: String(index), type: "in", start: "2026-10-10T08:59:22Z" }))));
  const result = await full.client.getHistory({ start: new Date("2026-10-10T08:00:00Z"), end: new Date("2026-10-10T10:00:00Z"), limit: 3 });
  assert.equal(result.full, true);

  const refused = harness(() => jsonResponse([]));
  const at = new Date("2026-10-10T08:00:00Z");
  await assert.rejects(refused.client.getHistory({ start: at, end: at }), (error) => error.code === "pbx_validation_error");
  await assert.rejects(refused.client.getHistory({ start: new Date("2026-10-10T10:00:00Z"), end: at }), (error) => error.code === "pbx_validation_error");
  await assert.rejects(refused.client.getHistory({ start: at, end: new Date("2026-10-10T10:00:00Z"), limit: 0 }), (error) => error.code === "pbx_validation_error");
  assert.equal(refused.state.calls.length, 0);
});

test("getDomain and getRecordSettings keep numbers, flags and one zone name", async () => {
  const domain = await harness(() => jsonResponse(DOMAIN_SAMPLE)).client.getDomain();
  assert.deepEqual(domain, { timezoneName: "Asia/Bishkek", timezoneOffsetMinutes: 360, usersUsed: 5, usersTotal: 5, recordService: true });
  const record = await harness(() => jsonResponse(RECORD_SAMPLE)).client.getRecordSettings();
  assert.deepEqual(record, { external: true, inner: false, exceptions: 1 });
  // A thin answer yields nulls, not a crash.
  assert.deepEqual(await harness(() => jsonResponse({})).client.getDomain(), {
    timezoneName: null,
    timezoneOffsetMinutes: null,
    usersUsed: null,
    usersTotal: null,
    recordService: null,
  });
  assert.deepEqual(await harness(() => jsonResponse({})).client.getRecordSettings(), { external: null, inner: null, exceptions: null });
  await assert.rejects(harness(() => jsonResponse("[]")).client.getDomain(), (error) => error.code === "pbx_bad_response");
});

test("401 is read by its documented text: invalid key, CRM disabled, CRM switched off; none is retried", async () => {
  const cases = [
    [JSON.stringify({ error: "Invalid token" }), "pbx_invalid_token"],
    ["Invalid token", "pbx_invalid_token"],
    [JSON.stringify({ error: "CRM disabled" }), "pbx_crm_disabled"],
    [JSON.stringify({ error: "CRM switched off" }), "pbx_crm_switched_off"],
    ["something else", "pbx_unauthorized"],
    ["", "pbx_unauthorized"],
  ];
  for (const [body, code] of cases) {
    const { client, state } = harness(() => new Response(body, { status: 401 }));
    await assert.rejects(client.getDomain(), (error) => error instanceof TelephonyPbxError && error.code === code && error.status === 401 && error.retryable === false, code);
    assert.equal(state.calls.length, 1, "a definitive answer is not retried");
    assert.equal(state.sleeps.length, 0);
    assert.ok(TELEPHONY_PBX_STOPPING_ERRORS.has(code));
  }
});

test("other definitive statuses map to fixed codes without a retry", async () => {
  const expected = new Map([
    [400, "pbx_validation_error"],
    [403, "pbx_forbidden"],
    [404, "pbx_not_found"],
    [405, "pbx_method_not_allowed"],
    [418, "pbx_unexpected_status"],
  ]);
  for (const [status, code] of expected) {
    const { client, state } = harness(() => new Response("{}", { status }));
    await assert.rejects(client.getDomain(), (error) => error.code === code && error.status === status, String(status));
    assert.equal(state.calls.length, 1, String(status));
  }
  assert.ok(TELEPHONY_PBX_STOPPING_ERRORS.has("pbx_forbidden"));
  assert.ok(!TELEPHONY_PBX_STOPPING_ERRORS.has("pbx_server_error"));
});

test("5xx and 429 are retried twice with a pause, then reported", async () => {
  for (const [status, code] of [[500, "pbx_server_error"], [503, "pbx_server_error"], [429, "pbx_rate_limited"]]) {
    const { client, state } = harness(() => new Response("{}", { status }));
    await assert.rejects(client.getDomain(), (error) => error.code === code && error.retryable === true, String(status));
    assert.equal(state.calls.length, 3, String(status));
    assert.deepEqual(state.sleeps, [500, 1500]);
  }
});

test("a retry that succeeds returns the answer", async () => {
  const { client, state } = harness((_url, _init, n) => (n < 3 ? new Response("{}", { status: 502 }) : jsonResponse(DOMAIN_SAMPLE)));
  const domain = await client.getDomain();
  assert.equal(domain.usersTotal, 5);
  assert.equal(state.calls.length, 3);
  assert.deepEqual(state.attempts.map((attempt) => [attempt.attempt, attempt.status, attempt.errorCode]), [
    [1, 502, "pbx_server_error"],
    [2, 502, "pbx_server_error"],
    [3, 200, null],
  ]);
});

test("a network error and a timeout are retried, then reported", async () => {
  const network = harness(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(network.client.getDomain(), (error) => error.code === "pbx_network_error");
  assert.equal(network.state.calls.length, 3);

  const slow = harness(() => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  await assert.rejects(slow.client.getDomain(), (error) => error.code === "pbx_timeout");
  assert.equal(slow.state.calls.length, 3);
});

test("a redirect is refused and not followed", async () => {
  const { client, state } = harness(() => new Response(null, { status: 302, headers: { location: "https://other.example.invalid/" } }));
  await assert.rejects(client.getDomain(), (error) => error.code === "pbx_redirect_refused" && error.status === 302);
  assert.equal(state.calls.length, 1);
});

test("a non-JSON 2xx answer and an oversize answer are errors", async () => {
  await assert.rejects(harness(() => new Response("<html>login</html>", { status: 200 })).client.getDomain(), (error) => error.code === "pbx_bad_response");
  await assert.rejects(harness(() => new Response("", { status: 200 })).client.getDomain(), (error) => error.code === "pbx_bad_response");
  const big = harness(() => new Response("x".repeat(100), { status: 200, headers: { "content-length": String(9 * 1024 * 1024) } }));
  await assert.rejects(big.client.getDomain(), (error) => error.code === "pbx_response_too_large");
  // A streamed body past the bound without a declared length is cut off as well.
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  await assert.rejects(harness(() => new Response(stream, { status: 200 })).client.getDomain(), (error) => error.code === "pbx_response_too_large");
});

test("errors and attempt records carry codes and counters only, never the key, a URL or the PBX text", async () => {
  const secretBody = "pbx-text-with-996555000111-and-https://records.example.invalid/t-secret.mp3";
  const { client, state } = harness(() => new Response(secretBody, { status: 500 }));
  let caught;
  try {
    await client.getHistory({ start: new Date("2026-10-10T08:00:00Z"), end: new Date("2026-10-10T10:00:00Z") });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TelephonyPbxError);
  assert.equal(caught.message, caught.code);
  const dump = JSON.stringify({ message: caught.message, code: caught.code, status: caught.status, attempts: state.attempts, stack: String(caught.stack).split("\n")[0] });
  for (const forbidden of [KEY, "996555000111", "records.example", "tenant-test", "history/json", "start="]) {
    assert.ok(!dump.includes(forbidden), forbidden);
  }
  assert.deepEqual(Object.keys(state.attempts[0]).sort(), ["attempt", "durationMs", "errorCode", "operation", "status"]);
});

test("a hook that throws changes nothing", async () => {
  const client = createTelephonyPbxClient(CONFIG, {
    fetch: async () => jsonResponse(DOMAIN_SAMPLE),
    sleep: async () => undefined,
    onAttempt: () => {
      throw new Error("log sink down");
    },
  });
  assert.equal((await client.getDomain()).usersUsed, 5);
});

test("a base that is not https is refused at construction", () => {
  assert.throws(() => createTelephonyPbxClient({ ...CONFIG, baseUrl: "http://tenant-test.ats.beeline.kg/crmapi/v1" }), TelephonyPbxError);
});
