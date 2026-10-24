// «Телефония Beeline KG», срез T7 (docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.4, §6.5, §8, §12;
// миграция 299): кнопка «Позвонить» — `POST /crmapi/v1/makecall` через ВАТС. Проверки без сети и
// без базы: обработчик маршрута `POST /api/v3/telephony/dial` с поддельной базой и поддельной ВАТС
// (порядок отказов, один вызов `makecall` и никогда не два, повтор `requestId` без второго звонка,
// живой статус сотрудника перед набором, итоги sent / unconfirmed / failed, номер и логин не уходят
// ни в ответ, ни в журнал приложения), квитанции базы, строгий шаблон пути, слова и контракт кнопки,
// настоящие компоненты статическим рендером (tests/e2e/numbers-static-render.cjs --json-telephony).
// Клиент ВАТС (`makeCall`): tests/platform-telephony-pbx-client.test.mjs.
// Данные синтетические: ни настоящего номера, ни настоящего логина, ни настоящего хоста.
// Что решает база (флаги, право, лид, номер, префиксы, запрещённые диапазоны, сопоставление,
// лимиты, идемпотентность, журнал): supabase/tests/platform_telephony_dial.sql.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isConnectedPlatformApi, isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";
import { createTelephonyPbxClient, TelephonyPbxError } from "../src/lib/server/platform-telephony-pbx-client.ts";
import {
  classifyMakeCallError,
  createTelephonyDialHandler,
  dialAuthorization,
  dialBeginReceipt,
  dialBeginRefusal,
  dialFailureReason,
  dialFinishReceipt,
  dialTargetReceipt,
  telephonyDialMethodNotAllowed,
} from "../src/lib/server/telephony-dial-route-handlers.ts";
import {
  DIAL_ABOUT,
  DIAL_COPY,
  DIAL_FAILURE_REASONS,
  DIAL_OFF,
  DIAL_REFUSAL_CODES,
  dialAccessibleName,
  dialErrorCopy,
  dialFailureCopy,
  dialOptionsState,
  dialRefusalCopy,
  dialRouteAnswer,
  dialSuccessCopy,
  isCallbackTaskTitle,
  todayDialLeadId,
} from "../src/lib/v3/telephony-dial.ts";
import { callerDisplayName, leadDisplayName } from "../src/lib/v3/wording.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
const ID = (n) => `29900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEAD = ID(5001);
const REQUEST = ID(9001);
const DIAL = ID(7001);
const PHONE_E164 = "+996700000001";
const PHONE_DIGITS = "996700000001";
const LOGIN = "u9902";
const CALL_ID = "t299-call-0001";
const HOST = "tenant.ats.beeline.kg";
const ACTOR = Object.freeze({
  organizationId: ID(1), membershipId: ID(302), systemRole: "staff", presentationRole: null, permissionKeys: ["telephony.call.dial"],
});
const PBX_READY = Object.freeze({
  status: "ready",
  config: Object.freeze({ baseUrl: `https://${HOST}/crmapi/v1`, apiHost: HOST, recordingHost: HOST, apiKey: "k".repeat(24) }),
});

function postRequest(body = { leadId: LEAD, requestId: REQUEST }, { origin = "https://crm.example.test", search = "", headers = {}, raw } = {}) {
  const init = {
    method: "POST",
    headers: { "content-type": "application/json", host: "crm.example.test", ...(origin === null ? {} : { origin }), ...headers },
    body: raw ?? JSON.stringify(body),
  };
  return new Request(`https://crm.example.test/api/v3/telephony/dial${search}`, init);
}

/** Поддельная база и ВАТС; `calls` записывает порядок и аргументы. `pbx` — поведение ВАТС. */
function harness({ begin, target, finish, pbx = {}, overrides = {} } = {}) {
  const calls = { order: [], begin: [], target: [], finish: [], clients: [], getUser: [], makeCall: [], log: [] };
  const dependencies = {
    authorize: async () => ({ status: "authorized", actor: ACTOR }),
    pbxConfig: () => PBX_READY,
    pbxClient: (config, purpose) => {
      calls.clients.push({ config, purpose });
      return {
        getUser: async (login) => {
          calls.order.push("getUser");
          calls.getUser.push({ purpose, login });
          if (pbx.getUser) return pbx.getUser(login);
          return { login, status: "online", forwardingSip: true, forwardingMobile: false };
        },
        makeCall: async (request) => {
          calls.order.push("makeCall");
          calls.makeCall.push({ purpose, request });
          if (pbx.makeCall) return pbx.makeCall(request);
          return { callId: CALL_ID };
        },
      };
    },
    begin: async (actor, input) => {
      calls.order.push("begin");
      calls.begin.push({ actor, input });
      return begin ? begin(actor, input) : { status: "accepted", dialRequestId: DIAL };
    },
    target: async (actor, dialRequestId) => {
      calls.order.push("target");
      calls.target.push({ actor, dialRequestId });
      return target ? target(actor, dialRequestId) : { status: "ready", pbxUser: LOGIN, phone: PHONE_E164 };
    },
    finish: async (actor, dialRequestId, result) => {
      calls.order.push("finish");
      calls.finish.push({ actor, dialRequestId, result });
      return finish ? finish(actor, dialRequestId, result) : { status: "recorded" };
    },
    log: (entry) => calls.log.push(entry),
    now: (() => { let tick = 0; return () => (tick += 7); })(),
    ...overrides,
  };
  return { calls, handler: createTelephonyDialHandler(dependencies) };
}

const pbxError = (code, status = null) => new TelephonyPbxError(code, status);

/** Ни номера, ни логина, ни идентификатора звонка или набора, ни ключа в тексте. */
function assertNoSecrets(value, label) {
  const dump = typeof value === "string" ? value : JSON.stringify(value);
  assert.doesNotMatch(dump, new RegExp(`${PHONE_DIGITS}|${LOGIN}|${CALL_ID}|${DIAL}|${LEAD}|${REQUEST}|${"k".repeat(24)}|${HOST.replace(/\./gu, "\\.")}|7000000`, "u"), label);
}

// ------------------------------------------------------------ the happy path

test("route: one call to the PBX — begin, target, live status, makecall, finish — and the browser only learns «sent»", async () => {
  const { handler, calls } = harness();
  const response = await handler(postRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "sent", replayed: false });
  assert.deepEqual(calls.order, ["begin", "target", "getUser", "makeCall", "finish"]);
  assert.deepEqual(calls.begin[0].input, { leadId: LEAD, requestId: REQUEST });
  assert.deepEqual(calls.target[0], { actor: ACTOR, dialRequestId: DIAL });
  // The live check asks for the employee's own login; the call goes to that login with the number WITHOUT «+».
  assert.deepEqual(calls.getUser, [{ purpose: "status", login: LOGIN }]);
  assert.deepEqual(calls.makeCall, [{ purpose: "call", request: { phone: PHONE_DIGITS, user: LOGIN } }]);
  assert.deepEqual(calls.clients.map((client) => client.purpose), ["status", "call"]);
  assert.deepEqual(calls.finish[0].result, { outcome: "sent", callId: CALL_ID, httpStatus: 200 });
  assert.equal(calls.finish[0].dialRequestId, DIAL);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assertNoSecrets(await (await handler(postRequest())).text(), "response");
  assert.equal(calls.log.length, 2);
  assert.deepEqual(Object.keys(calls.log[0]).sort(), ["event", "ms", "reason", "status"]);
  assert.equal(calls.log[0].event, "telephony_dial");
  assert.equal(calls.log[0].reason, "sent");
  assertNoSecrets(calls.log, "application log");
});

test("route: the body carries a lead id and a request id — never a number — and the number is the database's", async () => {
  const { handler, calls } = harness();
  // Anything beyond the two keys is refused before the database: the browser cannot name a number.
  for (const body of [
    { leadId: LEAD, requestId: REQUEST, phone: PHONE_E164 }, { leadId: LEAD, requestId: REQUEST, user: "x" },
    { leadId: LEAD, requestId: REQUEST, clid: "1" }, { leadId: LEAD }, { requestId: REQUEST }, {},
    { leadId: "not-a-uuid", requestId: REQUEST }, { leadId: LEAD, requestId: 5 }, { leadId: LEAD, requestId: null },
    { leadId: "00000000-0000-0000-0000-000000000000", requestId: REQUEST }, { leadId: LEAD, requestId: "00000000-0000-0000-0000-000000000000" },
    { leadId: PHONE_E164, requestId: REQUEST },
  ]) {
    const response = await handler(postRequest(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).error.code, "invalid_request");
  }
  for (const raw of ["[]", "null", "5", "\"x\"", "{", ""]) {
    assert.equal((await handler(postRequest(undefined, { raw }))).status, 400, JSON.stringify(raw));
  }
  assert.equal((await handler(postRequest(undefined, { headers: { "content-type": "text/plain" } }))).status, 400);
  assert.equal((await handler(postRequest(undefined, { search: "?phone=1" }))).status, 400);
  assert.equal((await handler(postRequest(undefined, { raw: JSON.stringify({ leadId: LEAD, requestId: REQUEST, pad: "x".repeat(2000) }) }))).status, 400);
  assert.equal(calls.order.length, 0, "nothing reaches the database or the PBX on a malformed body");
  // Upper-case ids are the same ids.
  const upper = await handler(postRequest({ leadId: LEAD.toUpperCase(), requestId: REQUEST.toUpperCase() }));
  assert.equal(upper.status, 200);
  assert.deepEqual(calls.begin[0].input, { leadId: LEAD, requestId: REQUEST });
});

// ------------------------------------------------------------ the guards

test("route: a request from another origin is refused before anything else — no session read, no database", async () => {
  let authorized = 0;
  const { handler, calls } = harness({ overrides: { authorize: async () => { authorized += 1; return { status: "authorized", actor: ACTOR }; } } });
  for (const request of [
    postRequest(undefined, { origin: null }),
    postRequest(undefined, { origin: "https://evil.example.test" }),
    postRequest(undefined, { origin: "http://crm.example.test" }),
    postRequest(undefined, { origin: "null" }),
    postRequest(undefined, { origin: "https://crm.example.test.evil.test" }),
  ]) {
    const response = await handler(request);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "forbidden");
  }
  assert.equal(authorized, 0);
  assert.equal(calls.order.length, 0);
});

test("route: no session, a broken session, a role preview and no right never reach the database or the PBX", async () => {
  for (const [status, expected, code] of [["anonymous", 401, "authentication_required"], ["unavailable", 503, "unavailable"],
    ["preview", 403, "preview"], ["forbidden", 403, "forbidden"]]) {
    const { handler, calls } = harness({ overrides: { authorize: async () => ({ status, actor: null }) } });
    const response = await handler(postRequest());
    assert.equal(response.status, expected, status);
    assert.equal((await response.json()).error.code, code);
    assert.equal(calls.order.length, 0, status);
  }
  const thrown = harness({ overrides: { authorize: async () => { throw new Error("session store down"); } } });
  assert.equal((await thrown.handler(postRequest())).status, 503);
  assert.equal(thrown.calls.log.at(-1).reason, "internal_error");
});

test("access: the session decides only who has no right to dial — no login, a broken session, a role preview, no dial right", () => {
  const actor = (fields) => ({ systemRole: "staff", presentationRole: null, permissionKeys: [], organizationId: ID(1), membershipId: ID(302), ...fields });
  const decide = (fields) => dialAuthorization({ status: "authenticated", actor: actor(fields) }).status;
  assert.equal(dialAuthorization({ status: "anonymous", actor: null }).status, "anonymous");
  assert.equal(dialAuthorization({ status: "invalid", actor: null, reason: "supabase_session_invalid" }).status, "unavailable");
  assert.equal(decide({ permissionKeys: ["telephony.call.dial"] }), "authorized");
  assert.equal(decide({ systemRole: "admin" }), "authorized", "the Admin holds every telephony right");
  assert.equal(decide({}), "forbidden");
  assert.equal(decide({ permissionKeys: ["telephony.manage", "telephony.recording.listen.all", "telephony.report.read.all", "lead.read"] }), "forbidden",
    "the settings, listening and report rights do not let anyone dial");
  assert.equal(decide({ systemRole: "admin", presentationRole: "sales" }), "preview", "a role preview dials nothing: a dial spends money and writes to the journal");
  assert.equal(decide({ systemRole: "staff", presentationRole: "sales", permissionKeys: ["telephony.call.dial"] }), "authorized");
  assert.equal(dialAuthorization({ status: "authenticated", actor: actor({ systemRole: "admin", presentationRole: "sales" }) }).actor, null);
});

test("route: an unconfigured PBX stops before the database — no dial row, no journal entry, nothing spent", async () => {
  for (const pbx of [{ status: "not_configured" }, { status: "invalid", reason: "incomplete_group" }, { status: "invalid", reason: "host_not_allowed" }]) {
    const { handler, calls } = harness({ overrides: { pbxConfig: () => pbx } });
    const response = await handler(postRequest());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "not_configured");
    assert.equal(calls.order.length, 0);
  }
});

// ------------------------------------------------------------ what the database says at the start

test("route: the database's start errors become the documented statuses", async () => {
  for (const [kind, status, code] of [["forbidden", 403, "forbidden"], ["off", 409, "telephony_off"], ["not_found", 404, "not_found"],
    ["conflict", 409, "request_conflict"], ["invalid", 400, "invalid_request"], ["unavailable", 503, "unavailable"]]) {
    const { handler, calls } = harness({ begin: async () => ({ status: "error", kind }) });
    const response = await handler(postRequest());
    assert.equal(response.status, status, kind);
    assert.equal((await response.json()).error.code, code);
    assert.deepEqual(calls.order, ["begin"], "after a refused start nothing else is asked");
  }
  // Too many refusals in a minute (PT429): the database wrote nothing; the employee is told to wait, like for the gap.
  const throttled = harness({ begin: async () => ({ status: "error", kind: "throttled" }) });
  const waiting = await throttled.handler(postRequest());
  assert.equal(waiting.status, 429);
  assert.deepEqual((await waiting.json()).error, { code: "dial_refused", reason: "rate_gap" });
  assert.deepEqual(throttled.calls.order, ["begin"]);
  assert.equal(dialErrorCopy({ code: "dial_refused", reason: "rate_gap" }), dialRefusalCopy("rate_gap"));
  // The raw SQLSTATEs of the database map to the same kinds; anything else is «unavailable».
  assert.deepEqual(dialBeginRefusal({ code: "42501" }), { status: "error", kind: "forbidden" });
  assert.deepEqual(dialBeginRefusal({ code: "55000" }), { status: "error", kind: "off" });
  assert.deepEqual(dialBeginRefusal({ code: "P0002" }), { status: "error", kind: "not_found" });
  assert.deepEqual(dialBeginRefusal({ code: "PT409" }), { status: "error", kind: "conflict" });
  assert.deepEqual(dialBeginRefusal({ code: "22023" }), { status: "error", kind: "invalid" });
  assert.deepEqual(dialBeginRefusal({ code: "PT429" }), { status: "error", kind: "throttled" });
  for (const code of ["57014", "XX000", undefined, "23505"]) assert.deepEqual(dialBeginRefusal({ code }), { status: "error", kind: "unavailable" });
});

test("route: every refusal the database records is told with its code — limits 429, the number 422, the rest 409 — and nothing is called", async () => {
  const expected = {
    rate_gap: 429, limit_user_day: 429, limit_org_hour: 429, limit_org_day: 429,
    lead_no_phone: 422, number_invalid: 422, prefix_not_allowed: 422, number_blocked: 422,
    not_mapped: 409, pbx_offline: 409, pbx_user_not_found: 409,
  };
  assert.deepEqual(Object.keys(expected).sort(), [...DIAL_REFUSAL_CODES].sort(), "the table covers every refusal code of the contract");
  for (const [code, status] of Object.entries(expected)) {
    const { handler, calls } = harness({ begin: async () => ({ status: "refused", dialRequestId: DIAL, code }) });
    const response = await handler(postRequest());
    assert.equal(response.status, status, code);
    assert.deepEqual((await response.json()).error, { code: "dial_refused", reason: code });
    assert.deepEqual(calls.order, ["begin"], code);
  }
  // A code from a newer database still answers with a word, not a crash.
  const future = harness({ begin: async () => ({ status: "refused", dialRequestId: DIAL, code: "future_rule" }) });
  const answer = await future.handler(postRequest());
  assert.equal(answer.status, 409);
  assert.equal(dialErrorCopy((await answer.json()).error), DIAL_COPY.fallback);
});

test("route: a repeated request id is a replay — the earlier result, no target, no PBX status, no second call", async () => {
  const cases = [
    [{ requestStatus: "sent", code: null }, 200, { status: "sent", replayed: true }],
    [{ requestStatus: "unconfirmed", code: "pbx_timeout" }, 200, { status: "unconfirmed", replayed: true }],
    [{ requestStatus: "requested", code: null }, 200, { status: "in_progress", replayed: true }],
    [{ requestStatus: "refused", code: "number_blocked" }, 422, { error: { code: "dial_refused", reason: "number_blocked" } }],
    [{ requestStatus: "refused", code: "pbx_offline" }, 409, { error: { code: "dial_refused", reason: "pbx_offline" } }],
    [{ requestStatus: "failed", code: "pbx_invalid_token" }, 502, { error: { code: "pbx_failed", reason: "pbx_auth" } }],
    [{ requestStatus: "failed", code: "target_unavailable" }, 502, { error: { code: "pbx_failed", reason: "pbx_unavailable" } }],
  ];
  for (const [replay, status, body] of cases) {
    const { handler, calls } = harness({ begin: async () => ({ status: "replayed", dialRequestId: DIAL, ...replay }) });
    const response = await handler(postRequest());
    assert.equal(response.status, status, replay.requestStatus + replay.code);
    assert.deepEqual(await response.json(), body);
    assert.deepEqual(calls.order, ["begin"], "a replay never asks the PBX and never fetches the number");
  }
});

test("route: two identical posts against a stateful database dial once", async () => {
  const rows = new Map();
  const { handler, calls } = harness({
    begin: async (_actor, input) => {
      const known = rows.get(input.requestId);
      if (known) return { status: "replayed", dialRequestId: DIAL, requestStatus: known.status, code: null };
      rows.set(input.requestId, { status: "requested" });
      return { status: "accepted", dialRequestId: DIAL };
    },
    finish: async (_actor, _id, result) => { rows.get(REQUEST).status = result.outcome; return { status: "recorded" }; },
  });
  const first = await handler(postRequest());
  const second = await handler(postRequest());
  assert.deepEqual(await first.json(), { status: "sent", replayed: false });
  assert.deepEqual(await second.json(), { status: "sent", replayed: true });
  assert.equal(calls.makeCall.length, 1, "exactly one makecall for two clicks");
  assert.equal(calls.getUser.length, 1);
  assert.equal(calls.finish.length, 1);
  // A different request id is a different dial.
  await handler(postRequest({ leadId: LEAD, requestId: ID(9002) }));
  assert.equal(calls.makeCall.length, 2);
});

// ------------------------------------------------------------ the live status check

test("route: an employee who is offline gets «open the app» and the client is NOT called", async () => {
  const { handler, calls } = harness({ pbx: { getUser: async (login) => ({ login, status: "offline", forwardingSip: true, forwardingMobile: false }) } });
  const response = await handler(postRequest());
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).error, { code: "dial_refused", reason: "pbx_offline" });
  assert.deepEqual(calls.order, ["begin", "target", "getUser", "finish"]);
  assert.equal(calls.makeCall.length, 0, "no makecall for an offline employee");
  assert.deepEqual(calls.finish[0].result, { outcome: "refused", refusalCode: "pbx_offline" });
  assertNoSecrets(calls.log, "log");
});

test("route: offline with forwarding to the mobile, online, and an unknown status all go on to the call", async () => {
  for (const live of [
    { status: "offline", forwardingSip: false, forwardingMobile: true },
    { status: "online", forwardingSip: true, forwardingMobile: false },
    { status: null, forwardingSip: null, forwardingMobile: null },
    { status: "offline", forwardingSip: null, forwardingMobile: true },
  ]) {
    const { handler, calls } = harness({ pbx: { getUser: async (login) => ({ login, ...live }) } });
    const response = await handler(postRequest());
    assert.equal(response.status, 200, JSON.stringify(live));
    assert.equal(calls.makeCall.length, 1, JSON.stringify(live));
  }
  const unknownForwarding = harness({ pbx: { getUser: async (login) => ({ login, status: "offline", forwardingSip: null, forwardingMobile: null }) } });
  const refused = await unknownForwarding.handler(postRequest());
  assert.equal(refused.status, 409, "offline with no forwarding flag is offline");
  assert.equal(unknownForwarding.calls.makeCall.length, 0);
});

test("route: a PBX user the PBX does not know is refused; a check that cannot be made is a failure — never a call", async () => {
  const unknown = harness({ pbx: { getUser: async () => { throw pbxError("pbx_not_found", 404); } } });
  const notFound = await unknown.handler(postRequest());
  assert.equal(notFound.status, 409);
  assert.deepEqual((await notFound.json()).error, { code: "dial_refused", reason: "pbx_user_not_found" });
  assert.deepEqual(unknown.calls.finish[0].result, { outcome: "refused", refusalCode: "pbx_user_not_found" });
  assert.equal(unknown.calls.makeCall.length, 0);

  for (const [code, status, reason] of [
    ["pbx_invalid_token", 401, "pbx_auth"], ["pbx_crm_switched_off", 401, "pbx_auth"], ["pbx_forbidden", 403, "pbx_auth"],
    ["pbx_validation_error", 400, "pbx_rejected"], ["pbx_timeout", null, "pbx_unavailable"], ["pbx_network_error", null, "pbx_unavailable"],
    ["pbx_server_error", 503, "pbx_unavailable"], ["pbx_rate_limited", 429, "pbx_unavailable"], ["pbx_bad_response", 200, "pbx_unavailable"],
  ]) {
    const { handler, calls } = harness({ pbx: { getUser: async () => { throw pbxError(code, status); } } });
    const response = await handler(postRequest());
    assert.equal(response.status, 502, code);
    assert.deepEqual((await response.json()).error, { code: "pbx_failed", reason }, code);
    assert.equal(calls.makeCall.length, 0, `${code}: the client is not called when the employee's device could not be checked`);
    assert.deepEqual(calls.finish[0].result, { outcome: "failed", errorCode: code, httpStatus: status }, code);
  }
  // An exception that is not a PBX error is a network failure, not a crash.
  const odd = harness({ pbx: { getUser: async () => { throw new TypeError("boom"); } } });
  assert.equal((await odd.handler(postRequest())).status, 502);
  assert.equal(odd.calls.finish[0].result.errorCode, "pbx_network_error");
});

test("route: the live check is a separate short client, and the call is a separate client with no retry", async () => {
  const source = read("src/lib/server/telephony-dial-route-handlers.ts");
  assert.match(source, /createTelephonyPbxClient\(config, \{ timeoutMs: STATUS_CHECK_TIMEOUT_MS, retryDelaysMs: \[\], onAttempt \}\)/u,
    "the status check has its own timeout and no retry");
  assert.match(source, /const STATUS_CHECK_TIMEOUT_MS = 5_000;/u);
  assert.equal((source.match(/\.makeCall\(/gu) ?? []).length, 1, "makecall is requested from exactly one place");
  assert.equal((source.match(/getUser\(/gu) ?? []).length, 1);
});

// ------------------------------------------------------------ the call itself

test("route: a call the PBX did not number, a timeout, a lost connection, a 2xx that broke off or was unreadable, and a 5xx are «unconfirmed» — one attempt, never two", async () => {
  const cases = [
    [async () => ({ callId: null }), "pbx_no_callid", 200],
    [async () => { throw pbxError("pbx_timeout"); }, "pbx_timeout", null],
    [async () => { throw pbxError("pbx_network_error"); }, "pbx_network_error", null],
    [async () => { throw pbxError("pbx_bad_response", 200); }, "pbx_bad_response", 200],
    [async () => { throw pbxError("pbx_response_too_large", 200); }, "pbx_response_too_large", 200],
    // The PBX answered 2xx and the body then timed out or the connection dropped: the call probably exists.
    [async () => { throw pbxError("pbx_timeout", 200); }, "pbx_timeout", 200],
    [async () => { throw pbxError("pbx_network_error", 200); }, "pbx_network_error", 200],
    // A gateway or the PBX may answer 5xx after the dial has started: the call may exist.
    [async () => { throw pbxError("pbx_server_error", 500); }, "pbx_server_error", 500],
    [async () => { throw pbxError("pbx_server_error", 502); }, "pbx_server_error", 502],
    [async () => { throw pbxError("pbx_server_error", 503); }, "pbx_server_error", 503],
    [async () => { throw pbxError("pbx_server_error", 504); }, "pbx_server_error", 504],
    [async () => { throw new Error("unexpected"); }, "pbx_network_error", null],
  ];
  for (const [makeCall, errorCode, httpStatus] of cases) {
    const { handler, calls } = harness({ pbx: { makeCall } });
    const response = await handler(postRequest());
    assert.equal(response.status, 200, errorCode);
    assert.deepEqual(await response.json(), { status: "unconfirmed", replayed: false }, errorCode);
    assert.equal(calls.makeCall.length, 1, `${errorCode}: no retry`);
    assert.deepEqual(calls.finish[0].result, { outcome: "unconfirmed", errorCode, httpStatus }, errorCode);
  }
});

test("route: a 4xx answer of the PBX is «failed» — the call was not created — with the right word for the employee", async () => {
  for (const [code, status, reason] of [
    ["pbx_invalid_token", 401, "pbx_auth"], ["pbx_crm_disabled", 401, "pbx_auth"], ["pbx_crm_switched_off", 401, "pbx_auth"],
    ["pbx_unauthorized", 401, "pbx_auth"], ["pbx_forbidden", 403, "pbx_auth"],
    ["pbx_validation_error", 400, "pbx_rejected"], ["pbx_method_not_allowed", 405, "pbx_rejected"], ["pbx_not_found", 404, "pbx_rejected"],
    ["pbx_redirect_refused", 302, "pbx_rejected"],
    ["pbx_rate_limited", 429, "pbx_unavailable"], ["pbx_unexpected_status", 418, "pbx_unavailable"],
  ]) {
    const { handler, calls } = harness({ pbx: { makeCall: async () => { throw pbxError(code, status); } } });
    const response = await handler(postRequest());
    assert.equal(response.status, 502, code);
    assert.deepEqual((await response.json()).error, { code: "pbx_failed", reason }, code);
    assert.equal(calls.makeCall.length, 1, `${code}: not retried`);
    assert.deepEqual(calls.finish[0].result, { outcome: "failed", errorCode: code, httpStatus: status }, code);
  }
});

test("route: the real PBX client — a 2xx whose body dies mid-read — is «unconfirmed», never «failed»; a 4xx stays «failed»", async () => {
  const dyingBody = (error) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"callid"'));
      controller.error(error);
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
  const cases = [
    [() => dyingBody(new TypeError("terminated")), "pbx_network_error", 200],
    [() => dyingBody(Object.assign(new Error("slow"), { name: "TimeoutError" })), "pbx_timeout", 200],
    [() => new Response("<html>gateway</html>", { status: 200 }), "pbx_bad_response", 200],
    [() => new Response("", { status: 504 }), "pbx_server_error", 504],
  ];
  for (const [respond, errorCode, httpStatus] of cases) {
    const fetched = [];
    const { handler, calls } = harness({
      overrides: {
        pbxClient: (config, purpose) => {
          calls.clients.push({ config, purpose });
          if (purpose === "status") {
            return { getUser: async (login) => ({ login, status: "online", forwardingSip: true, forwardingMobile: false }) };
          }
          return createTelephonyPbxClient(config, { fetch: async (url, init) => { fetched.push({ url, init }); return respond(); }, sleep: async () => undefined });
        },
      },
    });
    const response = await handler(postRequest());
    assert.equal(response.status, 200, errorCode);
    assert.deepEqual(await response.json(), { status: "unconfirmed", replayed: false }, errorCode);
    assert.equal(fetched.length, 1, `${errorCode}: one POST, no retry`);
    assert.deepEqual(calls.finish[0].result, { outcome: "unconfirmed", errorCode, httpStatus }, errorCode);
  }
  const rejected = harness({
    overrides: {
      pbxClient: (config, purpose) => purpose === "status"
        ? { getUser: async (login) => ({ login, status: "online", forwardingSip: true, forwardingMobile: false }) }
        : createTelephonyPbxClient(config, { fetch: async () => new Response("Validation error", { status: 400 }), sleep: async () => undefined }),
    },
  });
  const refusal = await rejected.handler(postRequest());
  assert.equal(refusal.status, 502);
  assert.deepEqual(rejected.calls.finish[0].result, { outcome: "failed", errorCode: "pbx_validation_error", httpStatus: 400 });
});

test("route: if the number cannot be fetched — an unavailable answer or an exception — the dial is closed as failed", async () => {
  for (const target of [async () => ({ status: "unavailable" }), async () => { throw new Error("service key is not configured"); }]) {
    const { handler, calls } = harness({ target });
    const response = await handler(postRequest());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: "unavailable" } });
    assert.deepEqual(calls.order, ["begin", "target", "finish"], "the row never stays «requested»");
    assert.deepEqual(calls.finish[0].result, { outcome: "failed", errorCode: "target_unavailable", httpStatus: null });
    assert.equal(calls.clients.length, 0);
    assert.equal(calls.log.at(-1).reason, "target_unavailable");
  }
  const source = read("src/lib/server/telephony-dial-route-handlers.ts");
  const defaultTarget = source.slice(source.indexOf("async target(actor, dialRequestId) {"), source.indexOf("async finish(actor, dialRequestId, result) {"));
  assert.match(defaultTarget, /try \{\s+const client = await serviceClient\(\);/u, "the service client is built inside the try");
  assert.match(defaultTarget, /\} catch \{\s+return \{ status: "unavailable" \};/u);
});

test("route: if recording the result fails after the call, the employee still gets what the PBX really said", async () => {
  const { handler, calls } = harness({ finish: async () => ({ status: "failed" }) });
  const response = await handler(postRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "sent", replayed: false });
  assert.equal(calls.makeCall.length, 1);
  assert.equal(calls.log.at(-1).reason, "sent_unrecorded");
  const unconfirmed = harness({ pbx: { makeCall: async () => { throw pbxError("pbx_timeout"); } }, finish: async () => ({ status: "failed" }) });
  assert.deepEqual(await (await unconfirmed.handler(postRequest())).json(), { status: "unconfirmed", replayed: false });
});

test("route: the response and the application log never hold the number, the login, the call id, an id or the key", async () => {
  const scenarios = [
    harness(),
    harness({ begin: async () => ({ status: "refused", dialRequestId: DIAL, code: "number_blocked" }) }),
    harness({ pbx: { getUser: async (login) => ({ login, status: "offline", forwardingSip: false, forwardingMobile: false }) } }),
    harness({ pbx: { makeCall: async () => { throw pbxError("pbx_timeout"); } } }),
    harness({ pbx: { makeCall: async () => { throw pbxError("pbx_invalid_token", 401); } } }),
    harness({ begin: async () => ({ status: "replayed", dialRequestId: DIAL, requestStatus: "sent", code: null }) }),
  ];
  for (const { handler, calls } of scenarios) {
    const response = await handler(postRequest());
    const body = await response.text();
    assertNoSecrets(body, "body");
    assertNoSecrets(JSON.stringify([...response.headers.entries()]), "headers");
    assertNoSecrets(calls.log, "log");
    for (const entry of calls.log) {
      assert.deepEqual(Object.keys(entry).sort(), ["event", "ms", "reason", "status"]);
      assert.match(entry.reason, /^[a-z_]+$/u);
    }
  }
});

// ------------------------------------------------------------ pure pieces

test("classification: a 4xx answer is «failed»; a lost, broken-off or unreadable answer, any 2xx failure and a 5xx are «unconfirmed»", () => {
  const cases = [
    [pbxError("pbx_timeout"), "unconfirmed", "pbx_timeout", null],
    [pbxError("pbx_network_error"), "unconfirmed", "pbx_network_error", null],
    [pbxError("pbx_bad_response", 200), "unconfirmed", "pbx_bad_response", 200],
    [pbxError("pbx_bad_response", 204), "unconfirmed", "pbx_bad_response", 204],
    [pbxError("pbx_response_too_large", 200), "unconfirmed", "pbx_response_too_large", 200],
    // 2xx answered, then the body timed out or the connection dropped (review finding): whatever the code.
    [new TelephonyPbxError("pbx_timeout", 200), "unconfirmed", "pbx_timeout", 200],
    [new TelephonyPbxError("pbx_network_error", 200, true), "unconfirmed", "pbx_network_error", 200],
    [new TelephonyPbxError("pbx_timeout", 299), "unconfirmed", "pbx_timeout", 299],
    // 5xx may arrive after the dial started.
    [pbxError("pbx_server_error", 500), "unconfirmed", "pbx_server_error", 500],
    [pbxError("pbx_server_error", 502), "unconfirmed", "pbx_server_error", 502],
    [pbxError("pbx_server_error", 503), "unconfirmed", "pbx_server_error", 503],
    [pbxError("pbx_server_error", 504), "unconfirmed", "pbx_server_error", 504],
    // 4xx and the refusal of a redirect: the PBX did not take the request.
    [pbxError("pbx_rate_limited", 429), "failed", "pbx_rate_limited", 429],
    [pbxError("pbx_validation_error", 400), "failed", "pbx_validation_error", 400],
    [pbxError("pbx_invalid_token", 401), "failed", "pbx_invalid_token", 401],
    [pbxError("pbx_unexpected_status", 418), "failed", "pbx_unexpected_status", 418],
    [pbxError("pbx_redirect_refused", 301), "failed", "pbx_redirect_refused", 301],
    [new RangeError("x"), "unconfirmed", "pbx_network_error", null],
    [null, "unconfirmed", "pbx_network_error", null],
  ];
  for (const [error, outcome, errorCode, httpStatus] of cases) {
    assert.deepEqual(classifyMakeCallError(error), { outcome, errorCode, httpStatus }, String(errorCode));
  }
  assert.equal(dialFailureReason("pbx_invalid_token"), "pbx_auth");
  assert.equal(dialFailureReason("pbx_forbidden"), "pbx_auth");
  assert.equal(dialFailureReason("pbx_validation_error"), "pbx_rejected");
  assert.equal(dialFailureReason("pbx_timeout"), "pbx_unavailable");
  assert.equal(dialFailureReason("pbx_window_too_dense"), "pbx_unavailable");
});

test("receipts: the database's answers have exact shapes; anything else is a failure, not a call", () => {
  assert.deepEqual(dialBeginReceipt({ status: "accepted", dialRequestId: DIAL }), { status: "accepted", dialRequestId: DIAL });
  assert.deepEqual(dialBeginReceipt({ status: "refused", dialRequestId: DIAL, code: "rate_gap" }), { status: "refused", dialRequestId: DIAL, code: "rate_gap" });
  assert.deepEqual(dialBeginReceipt({ status: "replayed", dialRequestId: DIAL, requestStatus: "sent", code: null }),
    { status: "replayed", dialRequestId: DIAL, requestStatus: "sent", code: null });
  assert.deepEqual(dialBeginReceipt({ status: "replayed", dialRequestId: DIAL, requestStatus: "failed", code: "pbx_timeout" }),
    { status: "replayed", dialRequestId: DIAL, requestStatus: "failed", code: "pbx_timeout" });
  const unavailable = { status: "error", kind: "unavailable" };
  for (const bad of [
    null, undefined, [], "x", 5, {}, { status: "accepted" }, { status: "accepted", dialRequestId: "nope" },
    { status: "accepted", dialRequestId: DIAL, phone: PHONE_E164 }, { status: "accepted", dialRequestId: DIAL, code: null },
    { status: "refused", dialRequestId: DIAL }, { status: "refused", dialRequestId: DIAL, code: "Bad Code" },
    { status: "refused", dialRequestId: DIAL, code: "x", extra: 1 }, { status: "replayed", dialRequestId: DIAL, requestStatus: "sent" },
    { status: "replayed", dialRequestId: DIAL, requestStatus: "done", code: null }, { status: "replayed", dialRequestId: DIAL, requestStatus: "sent", code: 5 },
    { status: "replayed", dialRequestId: DIAL, requestStatus: "sent", code: null, pbxUser: LOGIN }, { status: "queued", dialRequestId: DIAL },
  ]) {
    assert.deepEqual(dialBeginReceipt(bad), unavailable, JSON.stringify(bad));
  }
  assert.deepEqual(dialTargetReceipt({ pbxUser: LOGIN, phone: PHONE_E164 }), { status: "ready", pbxUser: LOGIN, phone: PHONE_E164 });
  for (const bad of [null, [], {}, { pbxUser: LOGIN }, { phone: PHONE_E164 }, { pbxUser: LOGIN, phone: PHONE_DIGITS },
    { pbxUser: LOGIN, phone: "+0996700000001" }, { pbxUser: LOGIN, phone: "+99670000" }, { pbxUser: "../x", phone: PHONE_E164 },
    { pbxUser: "", phone: PHONE_E164 }, { pbxUser: LOGIN, phone: PHONE_E164, extra: 1 }, { pbxUser: 5, phone: PHONE_E164 }]) {
    assert.deepEqual(dialTargetReceipt(bad), { status: "unavailable" }, JSON.stringify(bad));
  }
  assert.deepEqual(dialFinishReceipt({ status: "sent", changed: true }), { status: "recorded" });
  assert.deepEqual(dialFinishReceipt({ status: "unconfirmed", changed: false }), { status: "recorded" });
  for (const bad of [null, [], {}, { status: "sent" }, { status: "done", changed: true }, { status: "sent", changed: "yes" }, { status: "sent", changed: true, x: 1 }]) {
    assert.deepEqual(dialFinishReceipt(bad), { status: "failed" }, JSON.stringify(bad));
  }
});

test("other methods answer 405 with Allow: POST and no body of data", async () => {
  const response = telephonyDialMethodNotAllowed();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.deepEqual(await response.json(), { error: { code: "method_not_allowed" } });
});

// ------------------------------------------------------------ route registration

test("route contract: exactly the strict POST path is connected; its near misses are not", () => {
  assert.equal(isConnectedPlatformApi("/api/v3/telephony/dial"), true);
  assert.equal(isConnectedPlatformPage("/api/v3/telephony/dial"), false);
  for (const wrong of [
    "/api/v3/telephony/dial/", "/api/v3/telephony/dial/x", "/api/v3/telephony/dial/" + ID(1), "/api/v3/telephony/Dial", "/API/v3/telephony/dial",
    "/api/v3/telephony/dial.json", "/api/v3/telephony/dials", "/api/v3/telephony/dial%2f", "/api/v3/telephony//dial", "/api/v2/telephony/dial",
    "/api/internal/telephony/dial", "/api/v3/telephony", "/api/v3/telephony/call", "/api/v3/telephony/makecall", "/api/v3/telephony/dial?x=1",
  ]) {
    assert.equal(isConnectedPlatformApi(wrong), false, wrong);
  }
});

test("wiring: the route file exports the handler as POST, the other verbs answer 405, and the old routes stay retired", () => {
  const route = read("src/app/api/v3/telephony/dial/route.ts");
  assert.match(route, /export const POST = createTelephonyDialHandler\(\);/u);
  assert.match(route, /export const runtime = "nodejs";/u);
  assert.match(route, /export const dynamic = "force-dynamic";/u);
  for (const verb of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.match(route, new RegExp(`export const ${verb} = telephonyDialMethodNotAllowed;`, "u"), verb);
  }
  const contract = read("src/lib/platform-route-contract.ts");
  assert.match(contract, /const TELEPHONY_DIAL_PATH = "\/api\/v3\/telephony\/dial";/u);
  assert.match(contract, /"\/api\/webhooks\/telephony",/u, "the retired webhook root is still retired");
  assert.equal(isConnectedPlatformApi("/api/webhooks/telephony"), false);
});

// ------------------------------------------------------------ words and the contract of the button

test("options: the database's answer has exactly two keys; a closed set or a foreign shape is no button", () => {
  assert.deepEqual(dialOptionsState({ enabled: true, mapped: true }), { status: "ready", mapped: true });
  assert.deepEqual(dialOptionsState({ enabled: true, mapped: false }), { status: "ready", mapped: false });
  assert.deepEqual(dialOptionsState({ enabled: false, mapped: false }), DIAL_OFF);
  assert.deepEqual(dialOptionsState({ mapped: true, enabled: false }), DIAL_OFF);
  for (const bad of [null, undefined, [], "x", {}, { enabled: true }, { mapped: true }, { enabled: "yes", mapped: true },
    { enabled: true, mapped: 1 }, { enabled: true, mapped: true, phone: PHONE_E164 }]) {
    assert.throws(() => dialOptionsState(bad), TypeError, JSON.stringify(bad));
  }
});

test("«Сегодня»: only a lead or a request row can be dialled, and only by a strict lead id", () => {
  const lead = "29900000-0000-4000-8000-00000000ab01";
  assert.equal(todayDialLeadId({ source: "leads", key: `lead:${lead}` }), lead);
  assert.equal(todayDialLeadId({ source: "requests", key: `lead:${lead}` }), lead);
  for (const row of [
    { source: "tasks", key: `staff:${lead}` }, { source: "tasks", key: `lead:${lead}` }, { source: "students", key: `student:${lead}` },
    { source: "handoffs", key: `student:${lead}` }, { source: "chats", key: `lead:${lead}` }, { source: "leads", key: `lead:${lead}x` },
    { source: "leads", key: `lead:${lead.toUpperCase()}` }, { source: "leads", key: `lead:not-a-uuid` }, { source: "leads", key: lead },
    { source: "leads", key: `lead: ${lead}` }, { source: "leads", key: `lead:00000000-0000-0000-0000-000000000000` }, { source: "leads", key: "lead:" },
  ]) {
    assert.equal(todayDialLeadId(row), null, JSON.stringify(row));
  }
});

test("words: every refusal, failure reason and route error has its own sentence — and the fallback is only for the unknown", () => {
  assert.match(DIAL_ABOUT, /^Сначала зазвонит ваш телефон или приложение ВАТС\./u, "the permanent hint says the phone or app rings first");
  assert.match(DIAL_ABOUT, /после этого мы наберём клиента/u);
  assert.match(DIAL_COPY.sent, /^Звоним\. Сначала зазвонит ваш телефон или приложение ВАТС/u);
  assert.match(DIAL_COPY.unconfirmed, /Повторно не нажимайте/u, "an unconfirmed call is never invited to be repeated blindly");
  for (const code of DIAL_REFUSAL_CODES) {
    assert.notEqual(dialRefusalCopy(code), DIAL_COPY.fallback, code);
    assert.equal(dialErrorCopy({ code: "dial_refused", reason: code }), dialRefusalCopy(code));
  }
  for (const reason of DIAL_FAILURE_REASONS) {
    assert.notEqual(dialFailureCopy(reason), DIAL_COPY.fallback, reason);
    assert.equal(dialErrorCopy({ code: "pbx_failed", reason }), dialFailureCopy(reason));
  }
  assert.match(dialRefusalCopy("pbx_offline"), /Откройте приложение ВАТС/u);
  assert.match(dialRefusalCopy("pbx_offline"), /Клиенту не звонили/u);
  assert.match(dialRefusalCopy("not_mapped"), /Настройки → Телефония/u);
  assert.equal(dialRefusalCopy("not_mapped"), DIAL_COPY.notMapped);
  const handlerCodes = [...read("src/lib/server/telephony-dial-route-handlers.ts").matchAll(/failure\(\d{3}, "([a-z_]+)"/gu)].map((match) => match[1]);
  assert.ok(handlerCodes.length >= 10);
  for (const code of new Set(handlerCodes)) {
    if (code === "dial_refused" || code === "pbx_failed") continue;
    assert.notEqual(dialErrorCopy({ code }), DIAL_COPY.fallback, `the route code ${code} has words`);
  }
  assert.equal(dialErrorCopy({ code: "authentication_required" }), "Войдите снова и повторите.");
  for (const unknown of [undefined, {}, { code: 5 }, { code: "nope" }, { code: "dial_refused" }, { code: "pbx_failed", reason: "x" }, { code: "__proto__" }, { code: "toString" }]) {
    assert.equal(dialErrorCopy(unknown), DIAL_COPY.fallback, JSON.stringify(unknown));
  }
  assert.equal(dialRefusalCopy("toString"), DIAL_COPY.fallback);
  assert.equal(dialSuccessCopy("sent"), DIAL_COPY.sent);
  assert.equal(dialSuccessCopy("unconfirmed"), DIAL_COPY.unconfirmed);
  assert.equal(dialSuccessCopy("in_progress"), DIAL_COPY.inProgress);
  assert.equal(dialSuccessCopy("failed"), null);
  assert.equal(dialSuccessCopy(undefined), null);
  assert.match(DIAL_COPY.sentBefore, /уже был набран раньше, второй не создан/u, "a replay of a dialled call does not say «Звоним»");
  assert.doesNotMatch(DIAL_COPY.sentBefore, /^Звоним/u);
  for (const sentence of [...DIAL_REFUSAL_CODES.map(dialRefusalCopy), ...DIAL_FAILURE_REASONS.map(dialFailureCopy), ...Object.values(DIAL_COPY)]) {
    assertNoSecrets(sentence, sentence);
    assert.doesNotMatch(sentence, /\bpbx_|\bundefined\b|\bnull\b|https?:/iu, sentence);
  }
});

test("button: only an answer of our own route settles the attempt; a gateway page or a foreign body keeps the request id and says «check the phone»", () => {
  // Our route answered: the attempt is over, the next press is a new call.
  assert.deepEqual(dialRouteAnswer(true, { status: "sent", replayed: false }), { answered: true, note: DIAL_COPY.sent });
  assert.deepEqual(dialRouteAnswer(true, { status: "unconfirmed", replayed: false }), { answered: true, note: DIAL_COPY.unconfirmed });
  assert.deepEqual(dialRouteAnswer(true, { status: "unconfirmed", replayed: true }), { answered: true, note: DIAL_COPY.unconfirmed });
  assert.deepEqual(dialRouteAnswer(true, { status: "in_progress", replayed: true }), { answered: true, note: DIAL_COPY.inProgress });
  // A replay of a dialled call: the words say that the call was dialled earlier — not «Звоним» for a call that was not placed now.
  assert.deepEqual(dialRouteAnswer(true, { status: "sent", replayed: true }), { answered: true, note: DIAL_COPY.sentBefore });
  assert.deepEqual(dialRouteAnswer(false, { error: { code: "dial_refused", reason: "rate_gap" } }), { answered: true, note: dialRefusalCopy("rate_gap") });
  assert.deepEqual(dialRouteAnswer(false, { error: { code: "pbx_failed", reason: "pbx_unavailable" } }), { answered: true, note: dialFailureCopy("pbx_unavailable") });
  assert.deepEqual(dialRouteAnswer(false, { error: { code: "unavailable" } }), { answered: true, note: dialErrorCopy({ code: "unavailable" }) });
  assert.deepEqual(dialRouteAnswer(false, { error: { code: "something_new" } }), { answered: true, note: DIAL_COPY.fallback },
    "a route code the page does not know yet is still our route: the fallback words, the attempt is over");
  // Not our route: a gateway 502/504 (HTML or empty), JSON of someone else, a 2xx without our status.
  for (const [ok, body] of [[false, null], [false, {}], [false, "<html>Bad gateway</html>"], [false, []], [false, { error: "Bad Gateway" }],
    [false, { error: { reason: "x" } }], [false, { error: { code: 502 } }], [false, { message: "Service Unavailable" }],
    [true, null], [true, {}], [true, { status: "done" }], [true, { status: 200 }], [true, []]]) {
    assert.deepEqual(dialRouteAnswer(ok, body), { answered: false, note: DIAL_COPY.network }, JSON.stringify([ok, body]));
  }
  assert.doesNotMatch(DIAL_COPY.network, /Клиенту не звонили/u, "the unknown outcome never claims that the client was not called");
  assert.match(DIAL_COPY.network, /Проверьте, пошёл ли звонок/u);
});

test("contract: the refusal codes of the migration are exactly the codes the words and the route know", () => {
  const migration = read("supabase/migrations/299_platform_telephony_dial.sql");
  const recorded = [...migration.matchAll(/v_code := '([a-z_]+)'/gu)].map((match) => match[1]);
  const finishOnly = [...migration.matchAll(/p_refusal_code NOT IN \(([^)]*)\)/gu)].flatMap((match) => [...match[1].matchAll(/'([a-z_]+)'/gu)].map((code) => code[1]));
  assert.deepEqual([...new Set([...recorded, ...finishOnly])].sort(), [...DIAL_REFUSAL_CODES].sort());
  assert.deepEqual(recorded.sort(), ["lead_no_phone", "limit_org_day", "limit_org_hour", "limit_user_day", "not_mapped", "number_blocked",
    "number_invalid", "prefix_not_allowed", "rate_gap"].sort());
});

// ------------------------------------------------------------ the migration and the suite are wired

test("wiring: the migration, its suite and the test script agree", () => {
  const migration = read("supabase/migrations/299_platform_telephony_dial.sql");
  for (const name of ["telephony_dial_options_v1", "telephony_dial_begin_v1", "telephony_dial_target_v1", "telephony_dial_finish_v1",
    "telephony_dial_number_blocked", "telephony_dial_record_refusal"]) {
    assert.match(migration, new RegExp(`CREATE FUNCTION platform(_private)?\\.${name}\\(`, "u"), name);
  }
  assert.doesNotMatch(migration, /CREATE TABLE|ALTER TABLE|DROP |TRUNCATE|DELETE FROM|UPDATE platform_private\.telephony_settings/u,
    "functions only: no table, no column, no data, no flag is changed");
  assert.doesNotMatch(migration, /ui_enabled\s*=\s*TRUE|dial_enabled\s*=\s*TRUE/u, "nothing switches a flag on");
  // The switch is read inside the database for begin and options, with «no row» meaning «off».
  assert.match(migration, /NOT FOUND OR NOT \(v_settings\.ui_enabled AND v_settings\.dial_enabled\) OR v_settings\.outbound_paused/u);
  assert.match(migration, /v_enabled := FOUND AND v_settings\.ui_enabled AND v_settings\.dial_enabled AND NOT v_settings\.outbound_paused/u);
  // Refusals are bounded per employee (PT429, nothing written), and a refusal of the PBX status check
  // starts the gap and erases the number and the login of its row.
  assert.match(migration, /AND d\.status = 'refused' AND d\.created_at > v_now - INTERVAL '1 minute'\) >= 20 THEN\s+RAISE EXCEPTION 'telephony_dial_throttled' USING ERRCODE = 'PT429';/u);
  assert.match(migration, /d\.status <> 'refused' OR d\.refusal_code IN \('pbx_offline', 'pbx_user_not_found'\)/u);
  assert.match(migration, /client_phone = CASE WHEN p_outcome = 'refused' THEN NULL ELSE client_phone END/u);
  assert.match(migration, /pbx_user = CASE WHEN p_outcome = 'refused' THEN NULL ELSE pbx_user END/u);
  // The client number leaves the database through target only.
  assert.match(migration, /jsonb_build_object\('pbxUser', v_row\.pbx_user, 'phone', v_row\.client_phone\)/u);
  assert.equal((migration.match(/jsonb_build_object\('pbxUser'/gu) ?? []).length, 1);
  // Begin and options are for the session, target and finish for the server.
  assert.match(migration, /GRANT EXECUTE ON FUNCTION\s+platform\.telephony_dial_options_v1\(UUID\),\s+platform\.telephony_dial_begin_v1\(UUID, UUID, UUID\)\s+TO authenticated;/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION\s+platform\.telephony_dial_target_v1\(UUID, UUID, UUID\),\s+platform\.telephony_dial_finish_v1\(UUID, UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT\)\s+TO service_role;/u);
  const script = read("scripts/test-postgres-authorization.sh");
  assert.match(script, /\*_platform_telephony_dial\.sql \]\]; then\s+docker exec "\$container_name" \\\s+psql -X -v ON_ERROR_STOP=1 -h 127\.0\.0\.1 -U postgres -d "\$test_database" \\\s+-f \/workspace\/supabase\/tests\/platform_telephony_dial\.sql <\/dev\/null/u);
  const suite = read("supabase/tests/platform_telephony_dial.sql");
  assert.match(suite, /T299_TELEPHONY_DIAL_SUITE_PASSED/u);
  assert.match(suite, /ROLLBACK;\s*$/u);
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["test:unit:core"].includes("tests/platform-telephony-dial.test.mjs"), "the Node tests run in the core suite");
});

test("wiring: the parameter names the code sends are exactly the ones the migration declares, in both directions", () => {
  const migration = read("supabase/migrations/299_platform_telephony_dial.sql");
  const sources = [
    read("src/lib/server/telephony-dial-route-handlers.ts"),
    read("src/lib/v3/telephony-dial-source.ts"),
  ].join("\n");
  for (const name of ["telephony_dial_options_v1", "telephony_dial_begin_v1", "telephony_dial_target_v1", "telephony_dial_finish_v1"]) {
    const declared = [...(new RegExp(`CREATE FUNCTION platform\\.${name}\\(([^)]*)\\)`, "u").exec(migration)?.[1] ?? "").matchAll(/\b(p_[a-z_]+)\s+[A-Z]/gu)]
      .map((match) => match[1]).sort();
    const call = new RegExp(`rpc\\(\\s*"${name}",\\s*\\{([^}]*)\\}`, "u").exec(sources)?.[1] ?? "";
    const sent = [...call.matchAll(/\b(p_[a-z_]+)\s*:/gu)].map((match) => match[1]).sort();
    assert.ok(declared.length >= 1, `${name} declares parameters`);
    assert.deepEqual(sent, declared, name);
  }
});

test("wiring: the client holds a lead id and a request id, posts to one route and keeps the number out", () => {
  const button = read("src/components/v3/telephony/DialButton.tsx");
  assert.match(button, /fetch\("\/api\/v3\/telephony\/dial"/u);
  assert.match(button, /body: JSON\.stringify\(\{ leadId, requestId: id \}\)/u);
  assert.doesNotMatch(button, /\bphone[:=]|\+996|tel:/u, "the button knows no number and makes no tel: link");
  assert.match(button, /popover="manual"[^>]*className="v3-toasts" data-edge="anchor"/u, "the message is a top-layer line anchored under its own button, clear of the header actions and the chat field");
  assert.match(button, /style=\{\{ anchorName \} as CSSProperties\}/u, "the button is the anchor of its message");
  assert.match(button, /CSS\.supports\("anchor-name: --dial-probe"\)/u, "no anchor positioning in an old browser: the button places the message itself");
  const css = read("src/app/(v3)/v3.css");
  assert.match(css, /\.v3-toasts\[data-edge="anchor"\] \{[^}]*position-area: block-end span-all;/u, "on a phone the message runs under the action row");
  assert.match(css, /@media \(min-width: 40rem\) \{\s*\.v3-world\[data-surface="staff"\] \.v3-toasts\[data-edge="anchor"\] \{[^}]*position-area: block-end span-inline-start;/u, "from 40rem it hangs from the right edge of the button");
  assert.match(button, /const answer = dialRouteAnswer\(response\.ok, body\);\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+if \(answer\.answered\) requestId\.current = null;/u,
    "only an answer of our own route ends the attempt; a gateway page keeps the id");
  assert.doesNotMatch(button.slice(button.indexOf("const response = await fetch")), /requestId\.current = null;\s+const body/u, "the id is not dropped before the answer is read");
  assert.match(button, /typeof element\.showPopover === "function" && !element\.matches\(":popover-open"\)/u, "no top layer in an old browser: no crash");
  const lostAnswer = button.slice(button.indexOf("} catch {", button.indexOf("fetch(\"/api/v3/telephony/dial\"")), button.indexOf("} finally {"));
  assert.match(lostAnswer, /setNote\(DIAL_COPY\.network\)/u);
  assert.doesNotMatch(lostAnswer, /requestId\.current = null/u, "a lost answer keeps the id, so a retry is a replay and not a second call");
  assert.match(button, /setNote\(answer\.note\);\s+if \(response\.ok && answer\.answered\) setCooling\(true\);/u,
    "after an accepted call the button rests, so a second press does not run into the pause between dials");
  assert.match(button, /const COOLDOWN_MS = 6_000;/u);
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /const leadDialRead = leadSales && view && view\.details\.routeTarget\.leadId \? readDialOptions\(actor\) : null;/u);
  assert.match(page, /dial: leadDial,/u);
  const inbox = read("src/components/v3/Inbox.tsx");
  assert.match(inbox, /dial\?\.status === "ready" && open\.canonicalContext\.leadId/u, "the chat dials only a conversation bound to a lead");
  assert.match(inbox, /<DialButton leadId=\{open\.canonicalContext\.leadId\} mapped=\{dial\.mapped\}/u);
  assert.doesNotMatch(inbox, /<DialButton[^>]*phone=/u);
  const inboxPage = read("src/app/(v3)/v3/inbox/page.tsx");
  assert.match(inboxPage, /selected\.canonicalContext\.leadId \? readDialOptions\(actor\) : Promise\.resolve\(DIAL_OFF\)/u);
  const source = read("src/lib/v3/telephony-dial-source.ts");
  assert.match(source, /isStaffPreview\(actor\) \|\| !staffHasPermission\(actor, "telephony\.call\.dial"\)\) return DIAL_OFF/u);
  assert.match(source, /return error \? DIAL_OFF : dialOptionsState\(data\);/u);
});

// ------------------------------------------------------------ the rendered components

const pages = new Map(JSON.parse(execFileSync(process.execPath,
  [fileURLToPath(new URL("./e2e/numbers-static-render.cjs", import.meta.url)), "--json-telephony"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).map((page) => [page.name, page.html]));
const dialButtons = (html) => html.match(/<button [^>]*data-testid="v3-dial-button"[\s\S]*?<\/button>/gu) ?? [];
const button = (html) => dialButtons(html)[0] ?? "";

test("rendered lead: the button sits in the header actions beside «Написать», 44 px, with the hint that the phone rings first", () => {
  const html = pages.get("lead-dial");
  const buttons = dialButtons(html);
  assert.equal(buttons.length, 1);
  const [button] = buttons;
  assert.match(button, /min-h-11 min-w-11/u, "a 44 px target");
  assert.match(button, /title="Сначала зазвонит ваш телефон или приложение ВАТС\. Возьмите трубку — после этого мы наберём клиента\."/u);
  assert.match(button, /aria-describedby="[^"]+"/u);
  assert.doesNotMatch(button, /aria-disabled="|disabled=""/u, "a mapped employee gets a plain button");
  assert.match(button, /aria-disabled:text-fg-3/u, "the unmapped state has a style of its own");
  assert.equal(text(button), "Позвонить", "the word for the screen reader, visible from sm");
  assert.match(button, /<span class="sr-only sm:not-sr-only">Позвонить<\/span>/u);
  assert.match(html, /<p class="hidden basis-full t-meta text-fg-2 max-sm:block pointer-coarse:block" data-testid="v3-dial-hint">«Позвонить» сначала звонит вам: возьмите трубку, и мы наберём клиента\.<\/p>/u,
    "a touch screen has no hover: the same fact stands as a quiet line under the actions");
  const actionsAt = html.indexOf('data-testid="v3-lead-actions"');
  assert.ok(actionsAt > 0 && html.indexOf('data-testid="v3-dial-button"') > actionsAt, "inside the header actions");
  if (html.includes('title="Написать"')) assert.ok(html.indexOf('data-testid="v3-dial-button"') > html.indexOf('title="Написать"'), "after «Написать»");
  assert.match(html, /<span id="[^"]+" class="sr-only">Сначала зазвонит ваш телефон или приложение ВАТС\. Возьмите трубку — после этого мы наберём клиента\.<\/span>/u,
    "the hint is also read by the screen reader, not only shown on hover");
  assertNoSecrets(html, "lead page");
  assert.doesNotMatch(button, /tel:|href=/u, "the button is not a link: no tel: scheme, no GET to the route");
  assert.doesNotMatch(html, /href="[^"]*telephony\/dial/u, "and nothing links to the route");
  assert.doesNotMatch(html, /data-testid="v3-dial-toast"/u, "no message until a press");
});

test("rendered lead: an unmapped employee gets an explained button (aria-disabled, still pressable); off and unread show nothing", () => {
  const [unmapped] = dialButtons(pages.get("lead-dial-unmapped"));
  assert.match(unmapped, /aria-disabled="true"/u);
  assert.doesNotMatch(unmapped, /\sdisabled=""/u, "it must stay pressable to be able to explain itself");
  assert.doesNotMatch(pages.get("lead-dial-unmapped"), /data-testid="v3-dial-hint"/u, "«сначала звонит вам» is not said to someone whose number cannot ring: the press explains");
  assert.equal(dialButtons(pages.get("lead-dial-off")).length, 0);
  assert.equal(dialButtons(pages.get("lead-none")).length, 0, "a page that never read the options shows no button");
  assert.equal(dialButtons(pages.get("lead-ready")).length, 0);
  for (const name of ["lead-dial-off", "lead-none"]) assert.doesNotMatch(pages.get(name), /v3-dial-|зазвонит ваш телефон/u, name);
  // The other header actions are untouched by the button.
  const withButton = text(pages.get("lead-dial").slice(pages.get("lead-dial").indexOf('data-testid="v3-lead-actions"')));
  assert.match(withButton, /Позвонить/u);
});

test("the dial button names the client for the screen reader at every width, so an icon-only button still says whom it calls", () => {
  const source = read("src/components/v3/telephony/DialButton.tsx");
  assert.match(source, /const accessibleName = dialAccessibleName\(variant, pending, subject\);/u);
  assert.match(source, /aria-label=\{accessibleName\}/u);
  // The name is built by one function: the word and whom, and while the call is being placed «Звоним: Имя», not «Звоним…: Имя».
  assert.equal(dialAccessibleName("action", false, "Номер +996 ••• 12 46 64"), "Позвонить: Номер +996 ••• 12 46 64");
  assert.equal(dialAccessibleName("action", true, "Айгерим"), "Звоним: Айгерим", "no ellipsis before the colon");
  assert.doesNotMatch(dialAccessibleName("action", true, "Айгерим"), /…/u);
  assert.equal(dialAccessibleName("row", false, "Айгерим"), "Позвонить: Айгерим");
  assert.equal(dialAccessibleName("row", true, "Айгерим"), "Позвонить: Айгерим", "an icon-only row button keeps its action word");
  assert.equal(dialAccessibleName("row", false, null), "Позвонить", "a row button without a name still says what it does");
  assert.equal(dialAccessibleName("action", false, null), undefined, "a button with a visible word and no subject needs no label");
  assert.equal(dialAccessibleName("action", true, null), undefined);
  // Where the button has no subject (the lead header) the visible word is the name: no label at all.
  assert.doesNotMatch(button(pages.get("lead-dial")), /aria-label=/u);
});

test("rendered «Сегодня»: a lead row and a request row get a 44 px phone button over the row link; tasks and students do not", () => {
  const html = pages.get("today-dial");
  const rows = html.match(/<li data-queue-row="[^"]*"[\s\S]*?<\/li>/gu) ?? [];
  assert.equal(rows.length, 4);
  const withButton = rows.filter((row) => row.includes('data-testid="v3-dial-button"'));
  assert.equal(withButton.length, 2);
  assert.deepEqual(withButton.map((row) => /data-today-source="([a-z]+)"/u.exec(row)[1]), ["leads", "requests"]);
  for (const row of withButton) {
    const [button] = dialButtons(row);
    assert.match(button, /relative z-10 grid min-h-11 min-w-11/u, "above the link that covers the row, 44 px");
    assert.match(button, /aria-label="Позвонить: Алина Тестовая"/u, "the name says whom");
    assert.match(row, /grid-cols-\[2\.75rem_minmax\(0,1fr\)_5\.5rem\]/u, "the narrow row makes room for the second target");
    assert.ok(row.indexOf('data-testid="v3-dial-button"') < row.indexOf('data-queue-open=""'), "the phone comes before «Открыть»");
    assert.match(row, /data-queue-open=""/u, "the row still has its open link");
  }
  for (const row of rows.filter((candidate) => !candidate.includes('data-testid="v3-dial-button"'))) {
    assert.match(row, /grid-cols-\[2\.75rem_minmax\(0,1fr\)_2\.75rem\]/u, "a row without the button keeps its old grid");
  }
  assertNoSecrets(html, "today");
  for (const name of ["today-dial-off", "today-dial-none"]) {
    assert.equal(dialButtons(pages.get(name)).length, 0, name);
    assert.doesNotMatch(pages.get(name), /grid-cols-\[2\.75rem_minmax\(0,1fr\)_5\.5rem\]/u, name);
  }
});

// ------------------------------------------------------------ one name for a lead made by an unknown number

test("a lead made by an unknown number is «Номер …» on the lead card, the lead's tasks, the pipeline board and the take button", () => {
  // The rule: only the name the database wrote («Звонок» + the mask) of a phone-call lead is renamed.
  assert.equal(callerDisplayName("Звонок +996 ••• 12 46 64"), "Номер +996 ••• 12 46 64");
  assert.equal(callerDisplayName("Звонок ••••4521"), "Номер ••••4521");
  assert.equal(callerDisplayName("Звонок родителей"), "Звонок родителей");
  assert.equal(callerDisplayName("Асель Демова"), "Асель Демова");
  assert.equal(leadDisplayName("phone_call", "Звонок +996 ••• 12 46 64"), "Номер +996 ••• 12 46 64");
  assert.equal(leadDisplayName("website", "Звонок +996 ••• 12 46 64"), "Звонок +996 ••• 12 46 64", "a lead of another source keeps its name");
  assert.equal(leadDisplayName(null, "Звонок ••••4521"), "Звонок ••••4521");
  // The lead card: the page title, and the heading of the plain profile header, from the lead's own source. The name that profile
  // data carries is not touched: the portal-access forms send it as the student's display name.
  const profilePage = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(profilePage, /\? leadDisplayName\(view\.profile\.source, view\.profile\.person\) : docsMode/u);
  assert.match(read("src/components/v3/profile/Profile.tsx"), /\{leadDisplayName\(profile\.source, profile\.person\)\}/u);
  assert.doesNotMatch(read("src/lib/v3/profile-source.ts"), /leadDisplayName|callerDisplayName/u, "the data keeps the database name");
  // The lead's tasks heading; the pipeline search link keeps the name as the database wrote it.
  const tasks = read("src/app/(v3)/v3/tasks/page.tsx");
  assert.match(tasks, /<h2 className="t-section">\{callerDisplayName\(sourceLead\.clientDisplayName \?\? "Имя клиента не указано"\)\}<\/h2>/u);
  assert.match(tasks, /\/v3\/pipeline\?q=\$\{encodeURIComponent\(sourceLead\.clientDisplayName\)\}/u);
  // The board: the card (text and title), the side panel (title and the close menu) and the «closed» line.
  const board = read("src/components/v3/Pipeline.tsx");
  assert.match(board, /function leadLabel\(lead: Pick<PipelineLead, "source" \| "name">\): string \{\s*return leadDisplayName\(lead\.source, lead\.name\);/u);
  assert.equal((board.match(/leadLabel\(lead\)/gu) ?? []).length, 4, "card title and text, panel title, close-menu subject");
  assert.match(board, /leadClosed\(leadLabel\(selected\), receipt\)/u);
  assert.doesNotMatch(board, /\{lead\.name\}|title=\{lead\.name\}|subjectName=\{lead\.name\}/u, "no raw name left on the board");
});

// ------------------------------------------------------------ the task of a missed call names the client

test("callback task: the Today row and the task panel name the client, and only for an employee whose dial is open", () => {
  const source = read("src/lib/v3/telephony-task-leads-source.ts");
  assert.match(source, /^import "server-only";/u);
  assert.match(source, /readStaffTaskContext\(actor, taskId\)/u, "the lead of a task comes from the read the «Задачи» page already uses");
  assert.match(source, /readStaffTaskLeadContext\(actor, leadId\)/u, "and its name from the lead read under the same session");
  // Читаются только строки, видимые сразу (окно группы «Сегодня»), — клиент назван у каждой из них, а не у первых двенадцати.
  assert.match(source, /todayVisibleCount\(band\.items\.length, false\)/u);
  // Only the call-back tasks telephony itself creates (migration 298) are read; every other work task costs «Сегодня» no database read.
  assert.match(source, /item\.task\?\.kind === "staff" && item\.task\.key === item\.key && isCallbackTaskTitle\(item\.task\.title\)/u);
  for (const title of ["Перезвонить клиенту", "Перезвонить клиенту: недозвон"]) {
    assert.ok(read("supabase/migrations/298_platform_telephony_missed_tasks.sql").includes(`'${title}'`), `migration 298 writes «${title}»`);
    assert.equal(isCallbackTaskTitle(title), true, title);
  }
  for (const title of ["Перезвонить родителям", "Перезвонить клиенту завтра", "Подготовить документы", "перезвонить клиенту", ""]) {
    assert.equal(isCallbackTaskTitle(title), false, `«${title}» is not a telephony call-back task`);
  }
  assert.match(source, /name: callerDisplayName\(lead\.clientDisplayName\)/u, "a lead made from an unknown number is named as in «Заявки» and «Сегодня»");
  assert.match(source, /catch \{\s*return null;/u, "a failed read leaves the row as it was");
  const main = read("src/app/(v3)/v3/main/page.tsx");
  assert.match(main, /const taskLeads = dial\.status === "ready" \? await readTodayTaskLeads\(actor, queue\) : null;/u, "no extra reads while dial is closed to this employee");
  assert.match(main, /taskLeads=\{taskLeads\}/u);
  const row = read("src/components/v3/tasks/TaskQueueRow.tsx");
  assert.match(row, /leadRef \? <>/u);
  assert.match(row, /<span className="min-w-0 truncate">Рабочая<\/span>/u, "a task without a lead still says «Рабочая»");
  const tasks = read("src/app/(v3)/v3/tasks/page.tsx");
  assert.match(tasks, /if \(selected && taskContext\?\.leadId\) \{\s*const dial = await readDialOptions\(actor\);\s*if \(dial\.status === "ready"\)/u);
  const panel = read("src/components/v3/tasks/TaskDetailPanel.tsx");
  assert.match(panel, /Клиент: <span className="break-words">\{data\.extra\.lead\.name\}<\/span>/u);
  assert.match(panel, /<DialButton leadId=\{data\.extra\.lead\.leadId\} mapped=\{data\.extra\.lead\.mapped\}/u);
  assert.match(panel, /data\.extra\?\.lead && !readOnly/u, "a role preview gets no button");
  assert.match(panel, /"Все задачи по лиду" : "Открыть связанного лида"/u, "the two links to a lead say different things");
  // A phone has no hover title: the panel says in a visible line, for a mapped employee only, that the PBX rings his phone first.
  assert.match(panel, /!isDone && data\.extra\.lead\.mapped \? \(\s*<p className="hidden basis-full t-meta text-fg-2 max-sm:block pointer-coarse:block" data-testid="v3-dial-hint">\{DIAL_TOUCH_HINT\}<\/p>/u);
});

test("«Заявки → Звонки»: the outcome and «Позвонить» are read for the phone rows only, after the queue, and never break it", () => {
  const page = read("src/app/(v3)/v3/requests/page.tsx");
  assert.match(page, /read\.status === "ready" && read\.queue\.phoneCalls \? await readRequestCallLines\(actor, read\.queue\.rows\) : \{\}/u);
  assert.match(page, /dial=\{dial\}/u);
  const source = read("src/lib/v3/telephony-request-calls-source.ts");
  assert.match(source, /row\.kind === "lead" && row\.source === "phone_call"/u, "only a lead made by a call");
  assert.match(source, /const REQUEST_CALLS_LIMIT = 20;/u);
  assert.match(source, /p_limit: 1,/u, "the newest call of the lead is enough");
  const view = read("src/components/v3/requests/RequestsQueueView.tsx");
  assert.match(view, /<DialButton leadId=\{dialLeadId\} mapped=\{props\.dial\.mapped\} subject=\{name\} iconOnly \/>/u);
  assert.match(view, /!props\.readOnly \? leadId : null/u, "a role preview has no button");
});
