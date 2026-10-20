import assert from "node:assert/strict";
import test from "node:test";

import { staffCanAccessRoute } from "../src/lib/platform-access.ts";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformPrivateApi,
  isRetiredPlatformRoute,
} from "../src/lib/platform-route-contract.ts";
import {
  WahaConnectError,
  createWahaConnectClient,
} from "../src/lib/server/platform-waha-connect.ts";
import {
  createWhatsAppConnectHandler,
  whatsappConnectAuthorization,
} from "../src/lib/server/platform-waha-connect-route-handlers.ts";
import {
  WHATSAPP_CODE_READY_WAIT_MS,
  performWhatsAppConnect,
  recordWhatsAppConnectAudit,
  resetWhatsAppConnectLimitsForTests,
} from "../src/lib/server/platform-waha-connect-service.ts";
import { settingsIntegrations } from "../src/lib/v3/settings-health.ts";
import {
  WHATSAPP_CONNECT_ANCHOR,
  isQrDataUrl,
  normalizePairingCode,
  normalizePairingPhone,
  parseWhatsAppConnectError,
  parseWhatsAppConnectReply,
} from "../src/lib/v3/whatsapp-connect-contract.ts";
import {
  whatsappConnectError,
  whatsappConnectWords,
  whatsappConnectionState,
} from "../src/lib/v3/wording.ts";

/**
 * «Подключение WhatsApp» (решение владельца 20.10.2026): слова, номер и код,
 * клиент WAHA, сервис с лимитами и следом, маршрут и доступ. Настоящую сборку
 * WAHA (`gows-2026.9.2`) проверяет tests/platform-waha-connect-live.test.mjs на
 * отдельной локальной сессии; здесь — всё, что живёт в коде приложения.
 * Ни ключей, ни настоящих номеров нет.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP = "33333333-3333-4333-8333-333333333333";
const ADMIN = { systemRole: "admin", presentationRole: null, organizationId: ORG, profileId: PROFILE, membershipId: MEMBERSHIP, permissionKeys: [], platformAccessVersion: 1 };
const PREVIEW = { ...ADMIN, presentationRole: "sales" };
const STAFF = { ...ADMIN, systemRole: "staff", permissionKeys: ["telephony.manage", "messaging.read", "messaging.send"] };
const RUNTIME = Object.freeze({
  wahaSessionName: "crm_primary",
  wahaBaseUrl: "http://evo-crm-waha:3000",
  wahaApiKey: "unit-test-api-key-0123456789",
  bindingVersion: "3",
});
// Заведомо вымышленный номер из закрытого диапазона 555-01xx.
const PHONE = "14155550100";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-qr-body")]);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const png = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
const session = (status) => json({ name: "crm_primary", status, config: {} }, 201);

/** Поддельный WAHA: ответы по очереди, каждый вызов записывается. */
function fakeWaha(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, init });
    return handler(String(url), init.method, calls.length);
  };
  return { calls, fetch };
}

function fixture({ handler, now = { value: 1_000_000 }, audits = [], auditFails = false } = {}) {
  const waha = fakeWaha(handler);
  const fallbacks = [];
  return {
    waha,
    now,
    audits,
    fallbacks,
    dependencies: {
      resolveRuntime: async () => RUNTIME,
      clientDependencies: { fetch: waha.fetch, createTimeoutSignal: () => new AbortController().signal },
      recordAudit: (entry) => { if (auditFails) throw new Error("audit down"); audits.push(entry); },
      logAuditFallback: (entry, errorCode) => { fallbacks.push({ entry, errorCode }); },
      now: () => now.value,
      sleep: async (ms) => { now.value += ms; },
    },
  };
}

/** Поддельный клиент базы: записывает каждый `schema(...).rpc(...)`. */
function fakeAuditClient(reply) {
  const calls = [];
  return {
    calls,
    createClient: async () => ({
      schema: (name) => ({
        rpc: async (fn, args) => {
          calls.push({ schema: name, fn, args });
          return reply(fn, args);
        },
      }),
    }),
  };
}

test.beforeEach(() => resetWhatsAppConnectLimitsForTests());

// --- слова ---------------------------------------------------------------

test("the connection state has exactly three words; anything else gets none", () => {
  assert.deepEqual(whatsappConnectionState("WORKING"), { label: "Подключено", tone: "ok" });
  for (const status of ["STOPPED", "STARTING", "SCAN_QR_CODE"]) {
    assert.deepEqual(whatsappConnectionState(status), { label: "Ожидает подключения", tone: "warn" }, status);
  }
  assert.deepEqual(whatsappConnectionState("FAILED"), { label: "Ошибка — нужно подключить заново", tone: "danger" });
  for (const unknown of ["UNREACHABLE", "PASSKEY_REQUIRED", "PASSKEY_CONFIRMATION_REQUIRED", "working", "", "NEW_STATUS", null, undefined]) {
    assert.equal(whatsappConnectionState(unknown), null, String(unknown));
  }
});

test("error words come from the dictionary; an unknown code has no word", () => {
  for (const code of Object.keys(whatsappConnectWords.errors)) assert.equal(typeof whatsappConnectError(code), "string", code);
  assert.equal(whatsappConnectError("made_up_code"), null);
  assert.equal(whatsappConnectError("toString"), null);
  assert.equal(whatsappConnectError(null), null);
});

// --- договор -------------------------------------------------------------

test("the phone is normalized to international digits and never accepted loosely", () => {
  assert.equal(normalizePairingPhone("+1 (415) 555-0100"), PHONE);
  assert.equal(normalizePairingPhone("  14155550100 "), PHONE);
  assert.equal(normalizePairingPhone("+996 555 000 000"), "996555000000");
  for (const bad of ["", "abc", "+0123456789", "1234567", "1234567890123456", "+1 415 555 0100 ext 5", "14155550100\n; DROP", 14155550100, null, undefined, "+".repeat(40)]) {
    assert.equal(normalizePairingPhone(bad), null, String(bad));
  }
});

test("the pairing code and the QR picture are checked by shape", () => {
  assert.equal(normalizePairingCode("abcd-1234"), "ABCD-1234");
  assert.equal(normalizePairingCode(" ABCD 1234 "), "ABCD-1234");
  assert.equal(normalizePairingCode("ABCD1234"), "ABCD-1234");
  for (const bad of ["", "ABC-123", "ABCD-12345", "ABCD-12!4", null, 12345678]) assert.equal(normalizePairingCode(bad), null, String(bad));
  assert.equal(isQrDataUrl(PNG_DATA_URL), true);
  for (const bad of ["https://example.test/qr.png", "data:text/html;base64,AAAA", "data:image/png;base64,<script>", `data:image/png;base64,${"A".repeat(300_000)}`, null]) {
    assert.equal(isQrDataUrl(bad), false);
  }
});

test("the browser keeps only the known fields of a reply and the known error codes", () => {
  assert.deepEqual(parseWhatsAppConnectReply({ status: "SCAN_QR_CODE", qr: PNG_DATA_URL, code: null, extra: "x" }), { status: "SCAN_QR_CODE", qr: PNG_DATA_URL, code: null });
  assert.deepEqual(parseWhatsAppConnectReply({ status: "not a status", qr: "http://x", code: "zz" }), { status: null, qr: null, code: null });
  assert.equal(parseWhatsAppConnectReply("text"), null);
  assert.deepEqual(parseWhatsAppConnectError({ error: { code: "rate_limited", retryAfterSeconds: 12 } }), { code: "rate_limited", retryAfterSeconds: 12 });
  assert.deepEqual(parseWhatsAppConnectError({ error: { code: "invented", retryAfterSeconds: -1 } }), { code: null, retryAfterSeconds: null });
});

// --- клиент WAHA ---------------------------------------------------------

test("the client asks WAHA only for the session, start, restart, QR and pairing code", async () => {
  const seen = [];
  const { fetch, calls } = fakeWaha((url, method) => {
    seen.push(`${method} ${url}`);
    if (url.endsWith("/auth/qr?format=image")) return png();
    if (url.endsWith("/auth/request-code")) return json({ code: "abcd-1234" }, 201);
    return session(url.endsWith("/restart") ? "STARTING" : "SCAN_QR_CODE");
  });
  const client = createWahaConnectClient(RUNTIME, { fetch, createTimeoutSignal: () => new AbortController().signal });

  assert.equal(await client.getStatus(), "SCAN_QR_CODE");
  assert.equal(await client.start(), "SCAN_QR_CODE");
  assert.equal(await client.restart(), "STARTING");
  assert.equal(await client.fetchQr(), PNG_DATA_URL);
  assert.equal(await client.requestPairingCode("+1 415 555 0100"), "ABCD-1234");

  assert.deepEqual(seen, [
    "GET http://evo-crm-waha:3000/api/sessions/crm_primary",
    "POST http://evo-crm-waha:3000/api/sessions/crm_primary/start",
    "POST http://evo-crm-waha:3000/api/sessions/crm_primary/restart",
    "GET http://evo-crm-waha:3000/api/crm_primary/auth/qr?format=image",
    "POST http://evo-crm-waha:3000/api/crm_primary/auth/request-code",
  ]);
  for (const { init } of calls) {
    assert.equal(init.headers["X-Api-Key"], RUNTIME.wahaApiKey);
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
  }
  assert.deepEqual(JSON.parse(calls[4].init.body), { phoneNumber: PHONE });
  // Ни выхода из аккаунта, ни удаления, ни создания сессии.
  assert.equal(seen.some((line) => /logout|DELETE|\/api\/sessions( |$)/u.test(line)), false);
});

test("the client does not trust what it cannot verify", async () => {
  const run = (response) => createWahaConnectClient(RUNTIME, { fetch: async () => response, createTimeoutSignal: () => new AbortController().signal });
  await assert.rejects(() => run(json({ name: "other", status: "WORKING" })).getStatus(), (e) => e.code === "provider_malformed_response");
  await assert.rejects(() => run(json({ name: "crm_primary", status: "working lower" })).getStatus(), (e) => e.code === "provider_malformed_response");
  await assert.rejects(() => run(json({}, 404)).getStatus(), (e) => e.code === "session_missing");
  await assert.rejects(() => run(json({}, 401)).getStatus(), (e) => e.code === "configuration_invalid");
  await assert.rejects(() => run(new Response("<html>", { status: 200, headers: { "content-type": "image/png" } })).fetchQr(), (e) => e.code === "provider_malformed_response");
  assert.equal(await run(json({}, 404)).fetchQr(), null);
  await assert.rejects(() => run(json({ code: "123" }, 201)).requestPairingCode(PHONE), (e) => e.code === "provider_malformed_response");
  await assert.rejects(() => run(json({})).requestPairingCode("12"), (e) => e instanceof WahaConnectError && e.code === "invalid_phone");
  // WhatsApp не принял номер: WAHA отвечает 500 с «bad-request» сервера.
  const rejected = new Response(JSON.stringify({ statusCode: 500, exception: { message: "2 UNKNOWN: info query returned status 400: bad-request" } }), { status: 500, headers: { "content-type": "application/json" } });
  await assert.rejects(() => run(rejected).requestPairingCode(PHONE), (e) => e.code === "phone_rejected");
  const unreachable = createWahaConnectClient(RUNTIME, { fetch: async () => { throw new TypeError("fetch failed"); }, createTimeoutSignal: () => new AbortController().signal });
  await assert.rejects(() => unreachable.getStatus(), (e) => e.code === "provider_unreachable");
  const timeout = createWahaConnectClient(RUNTIME, { fetch: async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, createTimeoutSignal: () => new AbortController().signal });
  await assert.rejects(() => timeout.getStatus(), (e) => e.code === "provider_timeout");
  assert.throws(() => createWahaConnectClient({ ...RUNTIME, wahaBaseUrl: "http://example.test" }), /./u);
});

// --- сервис: доступ, лимиты, след ---------------------------------------

test("a non-admin and a role preview are refused before anything is read or asked", async () => {
  for (const [actor, code] of [[STAFF, "forbidden"], [PREVIEW, "preview"]]) {
    let resolved = false;
    const { dependencies, waha, audits } = fixture({ handler: () => session("WORKING") });
    const outcome = await performWhatsAppConnect(actor, { action: "connect" }, { ...dependencies, resolveRuntime: async () => { resolved = true; return RUNTIME; } });
    assert.deepEqual([outcome.status, outcome.http, outcome.code], ["refused", 403, code]);
    assert.equal(resolved, false);
    assert.equal(waha.calls.length, 0);
    assert.equal(audits.length, 0);
  }
  for (const request of [{ action: "status", withQr: true }, { action: "code", phone: PHONE }]) {
    const { dependencies, waha } = fixture({ handler: () => session("WORKING") });
    assert.equal((await performWhatsAppConnect(STAFF, request, dependencies)).http, 403);
    assert.equal(waha.calls.length, 0);
  }
});

test("«Подключить» on a FAILED session restarts it once and leaves one audit entry without secrets", async () => {
  const { dependencies, waha, audits } = fixture({ handler: (url, method) => (method === "GET" ? session("FAILED") : session("STARTING")) });
  const outcome = await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies);
  assert.deepEqual(outcome, { status: "ok", session: "STARTING", qr: null, code: null });
  assert.deepEqual(waha.calls.map((call) => `${call.method} ${call.url.replace("http://evo-crm-waha:3000", "")}`), [
    "GET /api/sessions/crm_primary",
    "POST /api/sessions/crm_primary/restart",
  ]);
  assert.equal(audits.length, 1);
  assert.deepEqual(Object.keys(audits[0]).sort(), ["actorMembershipId", "actorProfileId", "at", "kind", "organizationId"]);
  assert.equal(audits[0].kind, "qr");
  assert.equal(audits[0].actorProfileId, PROFILE);
  assert.equal(audits[0].actorMembershipId, MEMBERSHIP);
});

test("a STOPPED session is started, a session already waiting for a scan is left alone", async () => {
  const stopped = fixture({ handler: (url, method) => (method === "GET" ? session("STOPPED") : session("STARTING")) });
  await performWhatsAppConnect(ADMIN, { action: "connect" }, stopped.dependencies);
  assert.equal(stopped.waha.calls[1].url.endsWith("/api/sessions/crm_primary/start"), true);

  resetWhatsAppConnectLimitsForTests();
  const waiting = fixture({ handler: () => session("SCAN_QR_CODE") });
  const outcome = await performWhatsAppConnect(ADMIN, { action: "connect" }, waiting.dependencies);
  assert.equal(outcome.session, "SCAN_QR_CODE");
  assert.equal(waiting.waha.calls.length, 1);
  assert.equal(waiting.audits.length, 1);
});

test("a working session is neither restarted nor audited as a QR request", async () => {
  const { dependencies, waha, audits } = fixture({ handler: () => session("WORKING") });
  const outcome = await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies);
  assert.deepEqual(outcome, { status: "ok", session: "WORKING", qr: null, code: null });
  assert.equal(waha.calls.length, 1);
  assert.equal(audits.length, 0);
});

test("at most one restart per 30 seconds and one «Подключить» per 10 seconds", async () => {
  const now = { value: 5_000_000 };
  const { dependencies, waha } = fixture({ now, handler: (url, method) => (method === "GET" ? session("FAILED") : session("STARTING")) });
  assert.equal((await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies)).status, "ok");
  now.value += 4_000;
  const tooSoon = await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies);
  assert.deepEqual([tooSoon.http, tooSoon.code], [429, "rate_limited"]);
  assert.ok(tooSoon.retryAfterSeconds >= 1 && tooSoon.retryAfterSeconds <= 10);
  now.value += 7_000; // 11 с: «Подключить» можно, перезапуск — ещё нет
  const restartLimited = await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies);
  assert.deepEqual([restartLimited.http, restartLimited.code], [429, "rate_limited"]);
  assert.ok(restartLimited.retryAfterSeconds >= 1 && restartLimited.retryAfterSeconds <= 30);
  assert.equal(waha.calls.filter((call) => call.method === "POST").length, 1);
  now.value += 20_000; // 31 с от перезапуска
  assert.equal((await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies)).status, "ok");
  assert.equal(waha.calls.filter((call) => call.method === "POST").length, 2);
});

test("an unreachable WAHA does not let «Подключить» be pressed more often than every 10 seconds", async () => {
  const now = { value: 7_000_000 };
  const { dependencies, waha } = fixture({ now, handler: () => { throw new TypeError("fetch failed"); } });
  const first = await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies);
  assert.deepEqual([first.http, first.code], [503, "provider_unreachable"]);
  now.value += 3_000;
  const second = await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies);
  assert.deepEqual([second.http, second.code], [429, "rate_limited"]);
  assert.equal(waha.calls.length, 1);
});

test("a trace that cannot be written does not block the connection: the app-log line stands in for it", async () => {
  const { dependencies, waha, audits, fallbacks } = fixture({ auditFails: true, handler: (url, method) => (method === "GET" ? session("FAILED") : session("STARTING")) });
  const outcome = await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies);
  assert.deepEqual(outcome, { status: "ok", session: "STARTING", qr: null, code: null });
  assert.equal(waha.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(audits.length, 0);
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0].errorCode, "unknown");
  assert.equal(fallbacks[0].entry.kind, "qr");
  assert.deepEqual(Object.keys(fallbacks[0].entry).sort(), ["actorMembershipId", "actorProfileId", "at", "kind", "organizationId"]);
});

test("a successful trace leaves no fallback line, and a failed pairing-code trace does not stop the code", async () => {
  const ok = fixture({ handler: (url, method) => (method === "GET" ? session("FAILED") : session("STARTING")) });
  await performWhatsAppConnect(ADMIN, { action: "connect" }, ok.dependencies);
  assert.equal(ok.audits.length, 1);
  assert.equal(ok.fallbacks.length, 0);

  resetWhatsAppConnectLimitsForTests();
  const states = ["SCAN_QR_CODE"];
  const code = fixture({
    auditFails: true,
    handler: (url) => (url.endsWith("/auth/request-code") ? json({ code: "KJ4M-9QWX" }, 201) : session(states.shift() ?? "SCAN_QR_CODE")),
  });
  const outcome = await performWhatsAppConnect(ADMIN, { action: "code", phone: PHONE }, code.dependencies);
  assert.deepEqual(outcome, { status: "ok", session: "SCAN_QR_CODE", qr: null, code: "KJ4M-9QWX" });
  assert.equal(code.fallbacks.length, 1);
  assert.equal(code.fallbacks[0].entry.kind, "code");
  const logged = JSON.stringify(code.fallbacks);
  assert.equal(logged.includes(PHONE), false);
  assert.equal(logged.includes("KJ4M"), false);
});

test("a trace that hangs is given up after the timeout and the connection goes on", async () => {
  const { dependencies, waha, fallbacks } = fixture({ handler: (url, method) => (method === "GET" ? session("FAILED") : session("STARTING")) });
  const outcome = await performWhatsAppConnect(ADMIN, { action: "connect" }, {
    ...dependencies,
    recordAudit: () => new Promise(() => {}),
    auditTimeoutMs: 20,
  });
  assert.equal(outcome.status, "ok");
  assert.equal(waha.calls.filter((call) => call.method === "POST").length, 1);
  assert.deepEqual(fallbacks.map((item) => item.errorCode), ["timeout"]);
});

test("the durable trace is the database function called with the admin's own session and only the kind", async () => {
  const entry = { kind: "qr", organizationId: ORG, actorProfileId: PROFILE, actorMembershipId: MEMBERSHIP, at: "2026-10-20T10:00:00.000Z" };
  const qr = fakeAuditClient((fn, args) => ({ data: { kind: args.p_kind, recorded_at: "2026-10-20T10:00:00.1Z" }, error: null }));
  await recordWhatsAppConnectAudit(entry, qr.createClient);
  assert.deepEqual(qr.calls, [{ schema: "platform", fn: "record_whatsapp_connect_v1", args: { p_kind: "qr" } }]);

  const code = fakeAuditClient((fn, args) => ({ data: { kind: args.p_kind, recorded_at: "2026-10-20T10:00:00.1Z" }, error: null }));
  await recordWhatsAppConnectAudit({ ...entry, kind: "code" }, code.createClient);
  assert.deepEqual(code.calls, [{ schema: "platform", fn: "record_whatsapp_connect_v1", args: { p_kind: "pairing_code" } }]);

  // Ошибка базы — короткий код, без текста; ответ без расписки или с чужим видом записью не считается.
  const refused = fakeAuditClient(() => ({ data: null, error: { code: "42501", message: "whatsapp_connect_forbidden", details: "secret detail" } }));
  await assert.rejects(() => recordWhatsAppConnectAudit(entry, refused.createClient), (error) => error.code === "42501" && !String(error.message).includes("secret"));
  const missing = fakeAuditClient(() => ({ data: null, error: { code: "PGRST202" } }));
  await assert.rejects(() => recordWhatsAppConnectAudit(entry, missing.createClient), (error) => error.code === "PGRST202");
  for (const data of [null, {}, { kind: "pairing_code" }, "qr"]) {
    const bad = fakeAuditClient(() => ({ data, error: null }));
    await assert.rejects(() => recordWhatsAppConnectAudit(entry, bad.createClient), (error) => error.code === "receipt", JSON.stringify(data));
  }
  const noSession = async () => { throw new Error("no session"); };
  await assert.rejects(() => recordWhatsAppConnectAudit(entry, noSession));
});

test("the connect service calls the function once per request through the admin's session client and never with the phone", async () => {
  const database = fakeAuditClient((fn, args) => ({ data: { kind: args.p_kind, recorded_at: "2026-10-20T10:00:00.1Z" }, error: null }));
  const waha = fixture({ handler: (url, method) => (method === "GET" ? session("FAILED") : session("STARTING")) });
  const { recordAudit, logAuditFallback, ...rest } = waha.dependencies;
  void recordAudit; void logAuditFallback;
  const dependencies = { ...rest, createAuditClient: database.createClient, logAuditFallback: (entry, errorCode) => waha.fallbacks.push({ entry, errorCode }) };
  assert.equal((await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies)).status, "ok");
  assert.deepEqual(database.calls, [{ schema: "platform", fn: "record_whatsapp_connect_v1", args: { p_kind: "qr" } }]);
  assert.equal(waha.fallbacks.length, 0);

  resetWhatsAppConnectLimitsForTests();
  const states = ["SCAN_QR_CODE"];
  const codeWaha = fixture({
    handler: (url) => (url.endsWith("/auth/request-code") ? json({ code: "KJ4M-9QWX" }, 201) : session(states.shift() ?? "SCAN_QR_CODE")),
  });
  const codeDatabase = fakeAuditClient((fn, args) => ({ data: { kind: args.p_kind }, error: null }));
  const { recordAudit: unused, ...codeRest } = codeWaha.dependencies;
  void unused;
  await performWhatsAppConnect(ADMIN, { action: "code", phone: "+1 415 555 0100" }, { ...codeRest, createAuditClient: codeDatabase.createClient });
  assert.deepEqual(codeDatabase.calls, [{ schema: "platform", fn: "record_whatsapp_connect_v1", args: { p_kind: "pairing_code" } }]);
  assert.equal(JSON.stringify(codeDatabase.calls).includes(PHONE), false);

  // Нет миграции или база не отвечает: подключение идёт, остаётся строка журнала приложения.
  resetWhatsAppConnectLimitsForTests();
  const down = fakeAuditClient(() => ({ data: null, error: { code: "PGRST202" } }));
  const downWaha = fixture({ handler: (url, method) => (method === "GET" ? session("FAILED") : session("STARTING")) });
  const { recordAudit: skipped, ...downRest } = downWaha.dependencies;
  void skipped;
  const outcome = await performWhatsAppConnect(ADMIN, { action: "connect" }, { ...downRest, createAuditClient: down.createClient });
  assert.equal(outcome.status, "ok");
  assert.deepEqual(downWaha.fallbacks.map((item) => item.errorCode), ["PGRST202"]);
});

test("the QR is served only inside the window opened by «Подключить», and polling is rate limited", async () => {
  const now = { value: 9_000_000 };
  const { dependencies, waha } = fixture({
    now,
    handler: (url) => (url.includes("/auth/qr") ? png() : session("SCAN_QR_CODE")),
  });
  // Окно не открыто: состояние отвечено, картинки нет, WAHA за QR не спрашивали.
  const closed = await performWhatsAppConnect(ADMIN, { action: "status", withQr: true }, dependencies);
  assert.deepEqual(closed, { status: "ok", session: "SCAN_QR_CODE", qr: null, code: null });
  assert.equal(waha.calls.some((call) => call.url.includes("/auth/qr")), false);

  now.value += 2_000;
  await performWhatsAppConnect(ADMIN, { action: "connect" }, dependencies);
  now.value += 2_000;
  const open = await performWhatsAppConnect(ADMIN, { action: "status", withQr: true }, dependencies);
  assert.equal(open.qr, PNG_DATA_URL);
  now.value += 100;
  const fast = await performWhatsAppConnect(ADMIN, { action: "status", withQr: true }, dependencies);
  assert.deepEqual([fast.http, fast.code], [429, "rate_limited"]);
  now.value += 3_000;
  const noPicture = await performWhatsAppConnect(ADMIN, { action: "status", withQr: false }, dependencies);
  assert.equal(noPicture.qr, null);
  now.value += 11 * 60_000; // окно закрыто
  assert.equal((await performWhatsAppConnect(ADMIN, { action: "status", withQr: true }, dependencies)).qr, null);
});

test("the pairing code waits for the session to be ready and never stores the phone or the code", async () => {
  const states = ["STOPPED", "STARTING", "STARTING", "SCAN_QR_CODE"];
  const { dependencies, waha, audits } = fixture({
    handler: (url, method) => {
      if (url.endsWith("/auth/request-code")) return json({ code: "KJ4M-9QWX" }, 201);
      if (method === "POST") return session("STARTING");
      return session(states.shift() ?? "SCAN_QR_CODE");
    },
  });
  const outcome = await performWhatsAppConnect(ADMIN, { action: "code", phone: "+1 415 555 0100" }, dependencies);
  assert.deepEqual(outcome, { status: "ok", session: "SCAN_QR_CODE", qr: null, code: "KJ4M-9QWX" });
  assert.equal(waha.calls.at(-1).url.endsWith("/api/crm_primary/auth/request-code"), true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].kind, "code");
  const stored = JSON.stringify(audits);
  assert.equal(stored.includes(PHONE), false);
  assert.equal(stored.includes("KJ4M"), false);
  assert.equal(/phone|code"?:/iu.test(stored.replace('"kind":"code"', "")), false);
});

test("the pairing code is refused for a bad number, a working session, and a session that does not get ready", async () => {
  const bad = fixture({ handler: () => session("SCAN_QR_CODE") });
  assert.deepEqual((await performWhatsAppConnect(ADMIN, { action: "code", phone: "12" }, bad.dependencies)).code, "invalid_phone");
  assert.equal(bad.waha.calls.length, 0);

  const working = fixture({ handler: () => session("WORKING") });
  assert.deepEqual((await performWhatsAppConnect(ADMIN, { action: "code", phone: PHONE }, working.dependencies)).code, "already_connected");
  assert.equal(working.audits.length, 0);

  resetWhatsAppConnectLimitsForTests();
  const slow = fixture({ handler: (url, method) => (method === "GET" ? session("STARTING") : session("STARTING")) });
  const outcome = await performWhatsAppConnect(ADMIN, { action: "code", phone: PHONE }, slow.dependencies);
  assert.deepEqual([outcome.http, outcome.code], [409, "session_not_ready"]);
  assert.ok(slow.now.value - 1_000_000 >= WHATSAPP_CODE_READY_WAIT_MS);

  resetWhatsAppConnectLimitsForTests();
  const refused = fixture({
    handler: (url) => (url.endsWith("/auth/request-code")
      ? new Response(JSON.stringify({ exception: { message: "info query returned status 400: bad-request" } }), { status: 500, headers: { "content-type": "application/json" } })
      : session("SCAN_QR_CODE")),
  });
  const rejected = await performWhatsAppConnect(ADMIN, { action: "code", phone: PHONE }, refused.dependencies);
  assert.deepEqual([rejected.http, rejected.code], [422, "phone_rejected"]);
});

test("code requests are limited to one per 20 seconds and one in flight", async () => {
  const now = { value: 3_000_000 };
  const { dependencies } = fixture({
    now,
    handler: (url) => (url.endsWith("/auth/request-code") ? json({ code: "KJ4M-9QWX" }, 201) : session("SCAN_QR_CODE")),
  });
  assert.equal((await performWhatsAppConnect(ADMIN, { action: "code", phone: PHONE }, dependencies)).status, "ok");
  now.value += 5_000;
  const limited = await performWhatsAppConnect(ADMIN, { action: "code", phone: PHONE }, dependencies);
  assert.deepEqual([limited.http, limited.code], [429, "rate_limited"]);
  now.value += 20_000;
  assert.equal((await performWhatsAppConnect(ADMIN, { action: "code", phone: PHONE }, dependencies)).status, "ok");

  resetWhatsAppConnectLimitsForTests();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = fixture({ handler: async () => { await gate; return session("SCAN_QR_CODE"); } });
  const first = performWhatsAppConnect(ADMIN, { action: "connect" }, slow.dependencies);
  await new Promise((resolve) => setImmediate(resolve));
  // Второе нажатие «Подключить» упирается в лимит 10 с, «Получить код» — в место «один запрос к WAHA за раз».
  const repeat = await performWhatsAppConnect(ADMIN, { action: "connect" }, slow.dependencies);
  assert.deepEqual([repeat.http, repeat.code], [429, "rate_limited"]);
  const second = await performWhatsAppConnect(ADMIN, { action: "code", phone: PHONE }, slow.dependencies);
  assert.deepEqual([second.http, second.code], [409, "busy"]);
  release();
  assert.equal((await first).status, "ok");
});

test("provider failures become fixed codes without provider text", async () => {
  const down = fixture({ handler: () => { throw new TypeError("fetch failed at http://evo-crm-waha:3000 key=abc"); } });
  const outcome = await performWhatsAppConnect(ADMIN, { action: "status", withQr: false }, down.dependencies);
  assert.deepEqual([outcome.http, outcome.code], [503, "provider_unreachable"]);
  assert.equal(JSON.stringify(outcome).includes("evo-crm-waha"), false);
  resetWhatsAppConnectLimitsForTests();
  const missing = fixture({ handler: () => json({}, 404) });
  assert.equal((await performWhatsAppConnect(ADMIN, { action: "status", withQr: false }, missing.dependencies)).code, "session_missing");
  resetWhatsAppConnectLimitsForTests();
  const noBinding = fixture({ handler: () => session("WORKING") });
  const unavailable = await performWhatsAppConnect(ADMIN, { action: "status", withQr: false }, { ...noBinding.dependencies, resolveRuntime: async () => { throw new Error("vault"); } });
  assert.deepEqual([unavailable.http, unavailable.code], [503, "unavailable"]);
});

// --- маршрут --------------------------------------------------------------

function post(body, headers = {}, url = "https://crm.example.test/api/v3/settings/whatsapp-connect") {
  return new Request(url, {
    method: "POST",
    headers: { origin: "https://crm.example.test", host: "crm.example.test", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function handler(authorization, perform = async () => ({ status: "ok", session: "SCAN_QR_CODE", qr: PNG_DATA_URL, code: null })) {
  const calls = [];
  const post = createWhatsAppConnectHandler({
    authorize: async () => authorization,
    perform: async (actor, request) => { calls.push({ actor, request }); return perform(actor, request); },
  });
  return { post, calls };
}

test("the route refuses a non-admin on the server before the service runs", async () => {
  for (const [authorization, status, code] of [
    [{ status: "forbidden", actor: null }, 403, "forbidden"],
    [{ status: "preview", actor: null }, 403, "preview"],
    [{ status: "anonymous", actor: null }, 401, "authentication_required"],
    [{ status: "unavailable", actor: null }, 503, "unavailable"],
  ]) {
    const { post: handle, calls } = handler(authorization);
    const response = await handle(post({ action: "connect" }));
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 0);
  }
});

test("the service refuses a non-admin by itself, even for a holder who opens the settings page", async () => {
  // Держатель telephony.manage открывает «Настройки» ради одного раздела; подключение WhatsApp ему не принадлежит.
  assert.equal(staffCanAccessRoute(STAFF, "/v3/settings"), true);
  assert.equal((await performWhatsAppConnect(STAFF, { action: "connect" }, fixture({ handler: () => session("WORKING") }).dependencies)).code, "forbidden");
});

test("the real authorization rule lets only an admin outside role preview through", () => {
  const ok = (actor) => ({ status: "authenticated", actor });
  assert.deepEqual(whatsappConnectAuthorization({ status: "anonymous", actor: null }), { status: "anonymous", actor: null });
  assert.deepEqual(whatsappConnectAuthorization({ status: "invalid", actor: null, reason: "supabase_session_invalid" }), { status: "unavailable", actor: null });
  assert.equal(whatsappConnectAuthorization(ok(ADMIN)).status, "authorized");
  assert.equal(whatsappConnectAuthorization(ok(PREVIEW)).status, "preview");
  // Держатель telephony.manage и любой другой сотрудник без прав Admin.
  assert.equal(whatsappConnectAuthorization(ok(STAFF)).status, "forbidden");
  assert.equal(whatsappConnectAuthorization(ok({ ...STAFF, permissionKeys: [] })).status, "forbidden");
  assert.equal(whatsappConnectAuthorization(ok({ ...STAFF, permissionKeys: ["admin.preview", "telephony.manage"] })).status, "forbidden");
});

test("the route checks origin, body shape and query before the service", async () => {
  const { post: handle, calls } = handler({ status: "authorized", actor: ADMIN });
  assert.equal((await handle(post({ action: "connect" }, { origin: "https://evil.example.test" }))).status, 403);
  assert.equal((await handle(post({ action: "connect" }, { "content-type": "text/plain" }))).status, 400);
  assert.equal((await handle(post("{not json"))).status, 400);
  for (const body of [
    {}, { action: "logout" }, { action: "connect", phone: PHONE }, { action: "status", withQr: "yes" }, { action: "code" }, { action: "code", phone: 14155550100 },
    { action: "code", phone: PHONE, extra: 1 }, { action: "status", extra: 1 }, [],
  ]) {
    assert.equal((await handle(post(body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await handle(post({ action: "connect" }, {}, "https://crm.example.test/api/v3/settings/whatsapp-connect?x=1"))).status, 400);
  assert.equal((await handle(post({ action: "x".repeat(400) }))).status, 400);
  assert.equal(calls.length, 0);
});

test("the route returns the reply with no-store and passes the typed request to the service", async () => {
  const { post: handle, calls } = handler({ status: "authorized", actor: ADMIN });
  const status = await handle(post({ action: "status", withQr: true }));
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "no-store");
  assert.deepEqual(await status.json(), { status: "SCAN_QR_CODE", qr: PNG_DATA_URL, code: null });
  await handle(post({ action: "connect" }));
  await handle(post({ action: "code", phone: PHONE }));
  assert.deepEqual(calls.map((call) => call.request), [{ action: "status", withQr: true }, { action: "connect" }, { action: "code", phone: PHONE }]);

  const limited = createWhatsAppConnectHandler({
    authorize: async () => ({ status: "authorized", actor: ADMIN }),
    perform: async () => ({ status: "refused", http: 429, code: "rate_limited", retryAfterSeconds: 9 }),
  });
  const refused = await limited(post({ action: "connect" }));
  assert.equal(refused.status, 429);
  assert.deepEqual(await refused.json(), { error: { code: "rate_limited", retryAfterSeconds: 9 } });
  assert.equal(refused.headers.get("retry-after"), "9");
  assert.equal(status.headers.get("retry-after"), null);
  const broken = createWhatsAppConnectHandler({ authorize: async () => { throw new Error("boom"); }, perform: async () => ({}) });
  assert.equal((await broken(post({ action: "connect" }))).status, 503);
});

test("the route response never carries the phone number back", async () => {
  const { post: handle } = handler({ status: "authorized", actor: ADMIN }, async () => ({ status: "ok", session: "SCAN_QR_CODE", qr: null, code: "KJ4M-9QWX" }));
  const text = await (await handle(post({ action: "code", phone: PHONE }))).text();
  assert.equal(text.includes(PHONE), false);
  assert.deepEqual(JSON.parse(text), { status: "SCAN_QR_CODE", qr: null, code: "KJ4M-9QWX" });
});

test("the path is one exact connected staff API; everything near it stays closed", () => {
  const path = "/api/v3/settings/whatsapp-connect";
  assert.equal(isConnectedPlatformApi(path), true);
  assert.equal(isConnectedPlatformPrivateApi(path), false);
  assert.equal(isConnectedPlatformPage(path), false);
  assert.equal(isRetiredPlatformRoute(path), false);
  for (const near of ["/api/v3/settings", "/api/v3/settings/", `${path}/`, `${path}/x`, `${path}.json`, "/api/v3/settings/whatsapp", "/API/v3/settings/whatsapp-connect", "/api/v2/settings/whatsapp-connect", "/api/internal/settings/whatsapp-connect", "/api/v3/settings/whatsapp-connect%2f", "/api/v3/settings//whatsapp-connect"]) {
    assert.equal(isConnectedPlatformApi(near), false, near);
  }
});

// --- таблица «Интеграции» --------------------------------------------------

test("the WhatsApp row points to the connect block instead of a technician when the session needs linking", () => {
  const NOW = new Date("2026-10-20T10:00:00.000Z");
  const row = (waha) => settingsIntegrations({ waha: { observedAt: null, ...waha }, gemini: "not_configured", amo: { status: "blocked", reason: "feature_disabled" } }, NOW).find((entry) => entry.key === "whatsapp");
  const href = `/v3/settings?section=integrations#${WHATSAPP_CONNECT_ANCHOR}`;
  const failed = row({ display: "blocked", sessionStatus: "FAILED" });
  assert.deepEqual(failed.action, { handoff: null, link: { label: "Подключить WhatsApp", href } });
  assert.equal(failed.blocksWork, true);
  assert.deepEqual(row({ display: "blocked", sessionStatus: "SCAN_QR_CODE" }).action.link, { label: "Подключить WhatsApp", href });
  assert.deepEqual(row({ display: "unconfigured", sessionStatus: undefined }).action, { handoff: null, link: { label: "Подключить WhatsApp", href } });
  // Сервис не отвечает вовсе или ждёт вход по ключу доступа — подключением блока это не лечится.
  for (const sessionStatus of ["UNREACHABLE", "PASSKEY_REQUIRED", "PASSKEY_CONFIRMATION_REQUIRED"]) {
    const down = row({ display: "blocked", sessionStatus });
    assert.match(down.action.handoff, /техническ/u, sessionStatus);
    assert.equal(down.action.link.href, "/v3/inbox", sessionStatus);
  }
  assert.equal(row({ display: "ready", sessionStatus: "WORKING" }).action.link.href, "/v3/inbox");
});
