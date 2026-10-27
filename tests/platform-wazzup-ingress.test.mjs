// The Wazzup webhook route (src/lib/server/platform-wazzup-ingress.ts, plan docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.1):
// every request runs against a recording fake of the platform RPC client - no Wazzup, no Supabase, no network.
// Everything here is synthetic: the organization, the tokens, the numbers, the channel. Run with:
// node --conditions=react-server --experimental-strip-types --test tests/platform-wazzup-ingress.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createPlatformWazzupInboundHandler,
  WazzupFailureLimiter,
} from "../src/lib/server/platform-wazzup-ingress.ts";
import {
  isPlatformWazzupIngressEnabled,
  readPlatformWazzupIntakeOwner,
  readPlatformWazzupWebhookTokens,
} from "../src/lib/server/platform-wazzup-ingress-config.ts";

const ORGANIZATION_ID = "77400000-0000-4000-8000-000000000001";
const OWNER_ID = "77400000-0000-4000-8000-0000000000a1";
const CHANNEL_ID = "77400000-0000-4000-8000-0000000000c1";
const HOOK_TOKEN = "0123456789abcdef".repeat(4);
const NEXT_TOKEN = "fedcba9876543210".repeat(4);
const HOST = "crm.evoadmissions.com";
const PATH = "/api/v2/whatsapp/wazzup/inbound";
const MAX_BODY = 1024 * 1024;
const CUSTOMER_DIGITS = "99600000001";
const SECRET_KEY = "sb_secret_wazzup_test_key_0001";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = (n) => `77400000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function environment(overrides = {}) {
  return {
    EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: "1",
    EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: HOOK_TOKEN,
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: OWNER_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET_KEY,
    ...overrides,
  };
}

function message(n, extra = {}) {
  return {
    messageId: `msg-${n}`,
    channelId: CHANNEL_ID,
    chatType: "whatsapp",
    chatId: CUSTOMER_DIGITS,
    dateTime: `2026-10-27T10:00:${String(n % 60).padStart(2, "0")}.000`,
    type: "text",
    isEcho: false,
    text: `synthetic text ${n}`,
    ...extra,
  };
}

/** The persist answer for a portion where every element is new: the events get ids 1000+index. */
function storedAnswer(portion, { firstEvent = 1000 } = {}) {
  return {
    transportActive: true,
    channelId: CHANNEL_ID,
    results: portion.map((_, index) => ({ outcome: "stored", eventId: uuid(firstEvent + index), eventType: "message", index })),
    counts: { stored: portion.length, deduplicated: 0, unparsed: 0, filtered: 0, failed: 0 },
  };
}

/**
 * A handler wired to a recording fake of the platform RPC client. `rpc` maps a function name to
 * `(args, callNumber) => { data, error } | Promise`. Missing handlers fail the test loudly.
 */
function harness({ env = environment(), rpc = {}, limiter, now, log, databaseDeadlineMs, requestBudgetMs, projectionBudgetMs, ai } = {}) {
  const state = { calls: [], clients: 0, logs: [], schemas: [], ai: 0 };
  const handler = createPlatformWazzupInboundHandler({
    environment: env,
    limiter: limiter ?? new WazzupFailureLimiter(),
    log: log ?? ((entry) => state.logs.push(entry)),
    ...(now === undefined ? {} : { now }),
    ...(databaseDeadlineMs === undefined ? {} : { databaseDeadlineMs }),
    ...(requestBudgetMs === undefined ? {} : { requestBudgetMs }),
    ...(projectionBudgetMs === undefined ? {} : { projectionBudgetMs }),
    scheduleAiAgents: ai ?? (() => { state.ai += 1; }),
    createServiceClient: () => {
      state.clients += 1;
      return {
        schema(name) {
          state.schemas.push(name);
          return {
            rpc: (functionName, args) => {
              state.calls.push({ functionName, args });
              const handle = rpc[functionName];
              assert.ok(handle, `unexpected RPC ${functionName}`);
              return handle(args, state.calls.filter((call) => call.functionName === functionName).length);
            },
          };
        },
      };
    },
  });
  return { handler, state };
}

const persistCalls = (state) => state.calls.filter((call) => call.functionName === "wazzup_webhook_persist_v1");
const projectCalls = (state) => state.calls.filter((call) => call.functionName === "wazzup_project_event_v1");

function url({ token = HOOK_TOKEN, host = HOST, query = null } = {}) {
  const base = `https://${host}${PATH}`;
  if (query !== null) return `${base}?${query}`;
  return token === null ? base : `${base}?token=${token}`;
}

function post(body, { token = HOOK_TOKEN, host = HOST, headers = {}, method = "POST", query = null } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(url({ token, host, query }), {
    method,
    headers: { "content-type": "application/json; charset-utf-8", host, "x-evo-wazzup-ip": "203.0.113.7", ...headers },
    body: method === "GET" || method === "HEAD" ? undefined : text,
  });
}

async function json(response) {
  return JSON.parse(await response.text());
}

// A request whose body is a stream the test controls; `state` shows how much was really pulled.
function streamedRequest(nextChunk, headers = {}, { token = HOOK_TOKEN } = {}) {
  const state = { pulls: 0, bytes: 0, cancelled: false };
  const stream = new ReadableStream(
    {
      pull(controller) {
        state.pulls += 1;
        const chunk = nextChunk();
        if (chunk === null) {
          controller.close();
          return;
        }
        state.bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(url({ token }), {
    method: "POST",
    headers: { host: HOST, "x-evo-wazzup-ip": "203.0.113.7", ...headers },
    body: stream,
    duplex: "half",
  });
  return { request, state };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- config

test("config: the emergency stop is exactly 1; the token is exactly 64 hex characters; NEXT never blocks a good current token", () => {
  for (const [value, expected] of [["1", true], ["0", false], ["", false], [undefined, false], ["true", false], ["01", false], [" 1", false], ["1 ", false]]) {
    assert.equal(isPlatformWazzupIngressEnabled({ EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: value }), expected, String(value));
  }
  assert.deepEqual(readPlatformWazzupWebhookTokens({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: HOOK_TOKEN }), { current: HOOK_TOKEN, next: null });
  assert.deepEqual(
    readPlatformWazzupWebhookTokens({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: HOOK_TOKEN, EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT: NEXT_TOKEN }),
    { current: HOOK_TOKEN, next: NEXT_TOKEN },
  );
  for (const bad of [undefined, "", "a".repeat(63), "a".repeat(65), HOOK_TOKEN.toUpperCase(), ` ${HOOK_TOKEN}`, `${HOOK_TOKEN}\n`, `${HOOK_TOKEN.slice(0, 63)}g`]) {
    assert.equal(readPlatformWazzupWebhookTokens({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: bad }), null, JSON.stringify(bad));
  }
  for (const next of ["short", HOOK_TOKEN, "", undefined]) {
    assert.deepEqual(
      readPlatformWazzupWebhookTokens({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: HOOK_TOKEN, EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT: next }),
      { current: HOOK_TOKEN, next: null },
    );
  }
  assert.equal(readPlatformWazzupWebhookTokens({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT: NEXT_TOKEN }), null, "NEXT alone is not a token");
  assert.equal(readPlatformWazzupIntakeOwner({ EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: OWNER_ID }), OWNER_ID);
  for (const bad of [undefined, "", "not-a-uuid", "00000000-0000-0000-0000-000000000000", ` ${OWNER_ID}`]) {
    assert.equal(readPlatformWazzupIntakeOwner({ EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: bad }), null, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------- method, stop, configuration (before the token)

test("any method but POST is 405 with Allow: POST and reaches nothing", async () => {
  const { handler, state } = harness();
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await handler(post("", { method }));
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "POST", method);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(state.clients, 0);
  assert.equal(state.calls.length, 0);
});

test("the emergency stop (anything but exactly 1) is 503 before the token, the body or the database", async () => {
  for (const value of [undefined, "", "0", "true", "yes", " 1", "01"]) {
    const env = environment();
    if (value === undefined) delete env.EVO_PLATFORM_WAZZUP_INGRESS_ENABLED;
    else env.EVO_PLATFORM_WAZZUP_INGRESS_ENABLED = value;
    const { handler, state } = harness({ env });
    const { request, state: stream } = streamedRequest(() => {
      throw new Error("the body must not be read");
    });
    const response = await handler(request);
    assert.equal(response.status, 503, JSON.stringify(value));
    assert.deepEqual(await json(response), { error: "wazzup_webhook_unavailable" });
    assert.equal(stream.pulls, 0);
    assert.equal(state.clients, 0);
    assert.equal(state.logs[0].reason, "ingress_off");
  }
});

test("a missing or malformed token in the environment is 503 before the body is read (even with a request token that would match)", async () => {
  for (const bad of [undefined, "", "x".repeat(63), HOOK_TOKEN.toUpperCase(), `${HOOK_TOKEN} `]) {
    const { handler, state } = harness({ env: environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: bad }) });
    const { request, state: stream } = streamedRequest(() => {
      throw new Error("the body must not be read");
    });
    const response = await handler(request);
    assert.equal(response.status, 503, JSON.stringify(bad));
    assert.deepEqual(await json(response), { error: "wazzup_webhook_unavailable" });
    assert.equal(stream.pulls, 0);
    assert.equal(state.clients, 0);
  }
});

// ---------------------------------------------------------------- Host

test("a Host other than crm.evoadmissions.com is 404 with no body, before the token is looked at", async () => {
  const { handler, state } = harness();
  for (const host of ["app.evoadmissions.com", "evo-crm.72.62.119.112.sslip.io", "crm.evoadmissions.com.evil.test", "evil-crm.evoadmissions.com", "localhost:3000", ""]) {
    const request = new Request(url({ host: "crm.evoadmissions.com" }), {
      method: "POST",
      headers: { ...(host === "" ? {} : { host }), "x-evo-wazzup-ip": "203.0.113.7" },
      body: JSON.stringify({ test: true }),
    });
    // Node fills Host from the URL when none is given; the test above supplies the wrong ones explicitly.
    const response = await handler(host === "" ? new Request(url(), { method: "POST", headers: { host: "" }, body: "{}" }) : request);
    assert.equal(response.status, 404, JSON.stringify(host));
    assert.equal(await response.text(), "", "no body");
  }
  assert.equal(state.clients, 0);
  // A wrong Host is not a failed token: the limiter is not charged, so the right host still works after twenty-five of them.
  for (let i = 0; i < 25; i += 1) {
    await handler(post({ test: true }, { host: "app.evoadmissions.com" }));
  }
  assert.equal((await handler(post({ test: true }))).status, 200);
});

test("the right Host is accepted in any letter case and with a trailing dot", async () => {
  const { handler } = harness();
  for (const host of ["crm.evoadmissions.com", "CRM.EvoAdmissions.com", "crm.evoadmissions.com."]) {
    const response = await handler(post({ test: true }, { host }));
    assert.equal(response.status, 200, host);
  }
});

// ---------------------------------------------------------------- the token

test("a wrong, missing, truncated or differently cased token is 401 with no body; the body is never read and the database never touched", async () => {
  const { handler, state } = harness();
  const wrong = [
    null,
    "",
    "a".repeat(64),
    HOOK_TOKEN.slice(0, 63),
    `${HOOK_TOKEN}0`,
    HOOK_TOKEN.toUpperCase(),
    ` ${HOOK_TOKEN}`,
    NEXT_TOKEN, // not configured as NEXT here
  ];
  for (const token of wrong) {
    const { request, state: stream } = streamedRequest(
      () => {
        throw new Error("the body must not be read");
      },
      {},
      { token },
    );
    const response = await handler(request);
    assert.equal(response.status, 401, JSON.stringify(token));
    assert.equal(await response.text(), "");
    assert.equal(stream.pulls, 0, "the body of an unauthenticated request is not read");
  }
  assert.equal(state.clients, 0);
  assert.equal(state.calls.length, 0);
});

test("the token is taken from the query only: a header, a body field or a second parameter does not stand in for it", async () => {
  const { handler, state } = harness();
  assert.equal((await handler(post({ test: true }, { token: null, headers: { authorization: `Bearer ${HOOK_TOKEN}`, "x-token": HOOK_TOKEN } }))).status, 401);
  assert.equal((await handler(post({ test: true, token: HOOK_TOKEN }, { token: null }))).status, 401);
  assert.equal((await handler(post({ test: true }, { query: `Token=${HOOK_TOKEN}` }))).status, 401);
  // The first `token` parameter decides.
  assert.equal((await handler(post({ test: true }, { query: `token=${"a".repeat(64)}&token=${HOOK_TOKEN}` }))).status, 401);
  assert.equal((await handler(post({ test: true }, { query: `x=1&token=${HOOK_TOKEN}&y=2` }))).status, 200);
  assert.equal(state.clients, 0);
});

test("an Authorization header is ignored: it neither authenticates nor is kept or logged", async () => {
  const { handler, state } = harness({
    rpc: { wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }), wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound: false }, error: null }) },
  });
  const marker = "synthetic-authorization-marker-0001";
  const wrongToken = await handler(post({ test: true }, { token: "b".repeat(64), headers: { authorization: `Bearer ${HOOK_TOKEN}` } }));
  assert.equal(wrongToken.status, 401, "a good Authorization header does not rescue a wrong token");
  const ok = await handler(post({ messages: [message(1)] }, { headers: { authorization: `Bearer ${marker}` } }));
  assert.equal(ok.status, 200);
  const seen = JSON.stringify({ calls: state.calls, logs: state.logs });
  assert.ok(!seen.includes(marker));
  assert.ok(!seen.includes("authorization"));
});

test("rotation: the next token is accepted next to the current one and reaches the database as slot `next`", async () => {
  const env = environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT: NEXT_TOKEN });
  const { handler, state } = harness({
    env,
    rpc: { wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }), wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound: false }, error: null }) },
  });
  assert.equal((await handler(post({ messages: [message(1)] }, { token: HOOK_TOKEN }))).status, 200);
  assert.equal((await handler(post({ messages: [message(2)] }, { token: NEXT_TOKEN }))).status, 200);
  assert.equal((await handler(post({ messages: [message(3)] }, { token: "c".repeat(64) }))).status, 401);
  assert.deepEqual(persistCalls(state).map((call) => call.args.p_token_slot), ["current", "next"]);
  // The handshake works with the next token too.
  assert.equal((await handler(post({ test: true }, { token: NEXT_TOKEN }))).status, 200);
});

test("the token and its digest never reach the database, a response or the application log", async () => {
  const env = environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT: NEXT_TOKEN });
  const { handler, state } = harness({
    env,
    rpc: { wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }), wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound: false }, error: null }) },
  });
  const bodies = [];
  for (const token of [HOOK_TOKEN, NEXT_TOKEN, "d".repeat(64), null]) {
    const response = await handler(post({ messages: [message(1)] }, { token }));
    bodies.push(await response.text());
  }
  const seen = JSON.stringify({ calls: state.calls, logs: state.logs, bodies });
  for (const secret of [HOOK_TOKEN, NEXT_TOKEN, sha256(HOOK_TOKEN), sha256(NEXT_TOKEN), "d".repeat(64)]) {
    assert.ok(!seen.includes(secret), "a token or digest leaked");
  }
  // Counters and words only: no address, no number, no text.
  for (const entry of state.logs) {
    assert.deepEqual(Object.keys(entry).filter((key) => /url|path|query|token|phone|text|chat/iu.test(key)), []);
    for (const value of Object.values(entry)) assert.ok(["string", "number", "boolean"].includes(typeof value));
  }
  // The elements themselves travel to the database (that is the point); the log and the answers carry none of them.
  const outside = JSON.stringify({ logs: state.logs, bodies });
  assert.ok(!outside.includes(CUSTOMER_DIGITS) && !outside.includes("synthetic text"), "no number or text in the log or answers");
});

// ---------------------------------------------------------------- the failed-token limiter

test("more than 20 failed tokens a minute from one address is 429 for a minute; a valid token is never stopped; another address is not affected", async () => {
  let clock = 1_000_000;
  const limiter = new WazzupFailureLimiter({ now: () => clock });
  const { handler } = harness({ limiter });
  const wrong = (ip) => post({ test: true }, { token: "e".repeat(64), headers: { "x-evo-wazzup-ip": ip } });
  for (let i = 1; i <= 20; i += 1) assert.equal((await handler(wrong("203.0.113.9"))).status, 401, `failure ${i}`);
  const limited = await handler(wrong("203.0.113.9"));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.deepEqual(await json(limited), { error: "rate_limited" });
  // The same address with the right token is let through; another address is not limited.
  assert.equal((await handler(post({ test: true }, { headers: { "x-evo-wazzup-ip": "203.0.113.9" } }))).status, 200);
  assert.equal((await handler(wrong("203.0.113.10"))).status, 401);
  clock += 61_000;
  assert.equal((await handler(wrong("203.0.113.9"))).status, 401, "the block lasts a minute");
});

test("the address comes only from X-Evo-Wazzup-Ip: X-Forwarded-For is ignored and a bad or missing value shares the `unknown` counter", async () => {
  const limiter = new WazzupFailureLimiter({ now: () => 5_000_000 });
  const { handler } = harness({ limiter });
  for (let i = 0; i < 20; i += 1) {
    // Spoofed X-Forwarded-For values do not spread the counter over different addresses.
    const spoofed = post({ test: true }, { token: "f".repeat(64), headers: { "x-evo-wazzup-ip": "not-an-ip", "x-forwarded-for": `198.51.100.${i}` } });
    assert.equal((await handler(spoofed)).status, 401);
  }
  const missing = new Request(url({ token: "f".repeat(64) }), { method: "POST", headers: { host: HOST, "x-forwarded-for": "198.51.100.99" }, body: "{}" });
  assert.equal((await handler(missing)).status, 429, "no usable edge header: the shared `unknown` counter is already over the limit");
});

// ---------------------------------------------------------------- size

test("a Content-Length above 1 MiB is 413 before a byte is read (the token is checked first)", async () => {
  const { handler, state } = harness();
  for (const declared of [String(MAX_BODY + 1), ` ${MAX_BODY + 1} `, "99999999999999999999"]) {
    const { request, state: stream } = streamedRequest(
      () => {
        throw new Error("the body must not be read");
      },
      { "content-length": declared },
    );
    const response = await handler(request);
    assert.equal(response.status, 413, declared);
    assert.deepEqual(await json(response), { error: "payload_too_large" });
    assert.equal(stream.pulls, 0);
  }
  // An unauthenticated oversized request is a 401, not a 413: the size answer is for authenticated senders only.
  const { request } = streamedRequest(() => null, { "content-length": String(MAX_BODY + 1) }, { token: "9".repeat(64) });
  assert.equal((await handler(request)).status, 401);
  assert.equal(state.clients, 0);
});

test("a body with no or a false Content-Length is bounded while it is read and the upload cancelled", async () => {
  const chunk = new Uint8Array(64 * 1024).fill(0x61);
  for (const headers of [{}, { "content-length": "10" }, { "content-length": "not-a-number" }]) {
    const { handler, state } = harness();
    const { request, state: stream } = streamedRequest(() => chunk, headers);
    const response = await handler(request);
    await settle();
    assert.equal(response.status, 413, JSON.stringify(headers));
    assert.equal(stream.cancelled, true);
    assert.ok(stream.pulls <= 18, `pulled ${stream.pulls} chunks of an endless body`);
    assert.equal(state.clients, 0);
  }
});

test("a body of exactly 1 MiB is read and one byte more is refused", async () => {
  const pad = (target) => {
    const frame = '{"statuses":["",1]}';
    const room = target - Buffer.byteLength(frame);
    return `{"statuses":["${"s".repeat(room)}",1]}`;
  };
  const exact = pad(MAX_BODY);
  assert.equal(Buffer.byteLength(exact), MAX_BODY);
  const { handler, state } = harness({ rpc: { wazzup_webhook_persist_v1: () => ({ data: { transportActive: true, results: [], counts: {} }, error: null }) } });
  const ok = await handler(post(exact));
  assert.equal(ok.status, 200);
  assert.equal(state.calls.length, 1);
  const over = await handler(post(pad(MAX_BODY + 1)));
  assert.equal(over.status, 413);
});

// ---------------------------------------------------------------- handshake and parsing

test("the handshake {\"test\": true} is answered 200 {ok:true} with no database, no backend configuration and no transport check", async () => {
  // No Supabase configuration at all and no handler for any RPC: the handshake must not need either.
  const env = { EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: "1", EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: HOOK_TOKEN };
  const { handler, state } = harness({ env });
  const response = await handler(post({ test: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(state.clients, 0);
  assert.equal(state.calls.length, 0);
  assert.equal(state.logs[0].reason, "test_ok");
});

test("only the exact handshake counts: test:false, an extra key or a nested value is an ordinary payload", async () => {
  const { handler, state } = harness({
    rpc: { wazzup_webhook_persist_v1: () => ({ data: { transportActive: true, results: [], counts: {} }, error: null }) },
  });
  for (const body of [{ test: false }, { test: true, messages: [] }, { test: 1 }, { test: "true" }]) {
    const before = state.calls.length;
    const response = await handler(post(body));
    assert.equal(response.status, 200);
    assert.equal(state.calls.length, before + 1, `${JSON.stringify(body)} went to the database`);
  }
});

test("a body that is not one JSON object is 400 and nothing is stored", async () => {
  const { handler, state } = harness();
  const bad = ["", "not json", "[]", "null", "42", '"text"', "{", Buffer.from([0x7b, 0xff, 0xfe, 0x7d])];
  for (const body of bad) {
    const response = await handler(
      new Request(url(), { method: "POST", headers: { host: HOST, "x-evo-wazzup-ip": "203.0.113.7" }, body }),
    );
    assert.equal(response.status, 400, JSON.stringify(String(body)));
    assert.deepEqual(await json(response), { error: "invalid_json" });
  }
  assert.equal(state.clients, 0);
});

// ---------------------------------------------------------------- storing

test("messages are stored with the batch SHA-256, the token slot and the exact elements; a successful request answers counters only", async () => {
  const { handler, state } = harness({
    rpc: {
      wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }),
      wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound: false }, error: null }),
    },
  });
  const body = { messages: [message(1), message(2, { isEcho: true, authorId: "synthetic-user" })], channelsUpdates: [{ channelId: CHANNEL_ID, state: "active", timestamp: 1 }] };
  const raw = JSON.stringify(body);
  const response = await handler(post(raw));
  assert.equal(response.status, 200);
  const answer = await json(response);
  assert.deepEqual(answer, { ok: true, stored: 3, deduplicated: 0, unparsed: 0, filtered: 0, failed: 0, projected: 3, deferred: 0 });
  assert.equal(persistCalls(state).length, 1);
  const { args } = persistCalls(state)[0];
  assert.equal(args.p_organization_id, ORGANIZATION_ID);
  assert.equal(args.p_batch_sha256, sha256(raw));
  assert.equal(args.p_token_slot, "current");
  assert.deepEqual(args.p_elements, [
    { kind: "message", element: body.messages[0] },
    { kind: "message", element: body.messages[1] },
    { kind: "channel", element: body.channelsUpdates[0] },
  ]);
  assert.deepEqual(args.p_counters, {});
  assert.deepEqual([...new Set(state.schemas)], ["platform"]);
});

test("a batch is cut into portions of at most 100 elements; the counters go with the first portion only; one SHA for all", async () => {
  const messages = Array.from({ length: 250 }, (_, index) => message(index + 1));
  const raw = JSON.stringify({ messages, statuses: [{ messageId: "a" }, { messageId: "b" }, { messageId: "c" }], createDeal: { x: 1 } });
  const { handler, state } = harness({
    rpc: {
      wazzup_webhook_persist_v1: (args, n) => ({ data: storedAnswer(args.p_elements, { firstEvent: n * 1000 }), error: null }),
      wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound: false }, error: null }),
    },
  });
  const response = await handler(post(raw));
  assert.equal(response.status, 200);
  const calls = persistCalls(state);
  assert.deepEqual(calls.map((call) => call.args.p_elements.length), [100, 100, 50]);
  assert.deepEqual(calls.map((call) => call.args.p_counters), [{ status: 3, ignored_subscription: 1 }, {}, {}]);
  assert.equal(new Set(calls.map((call) => call.args.p_batch_sha256)).size, 1);
  assert.equal(calls[0].args.p_batch_sha256, sha256(raw));
  // The elements arrive in order, none lost, none doubled.
  const sent = calls.flatMap((call) => call.args.p_elements.map((item) => item.element.messageId));
  assert.deepEqual(sent, messages.map((item) => item.messageId));
  assert.equal((await json(response)).stored, 250);
});

test("a payload of statuses only is a counter, not a message: one call with no elements", async () => {
  const { handler, state } = harness({
    rpc: { wazzup_webhook_persist_v1: () => ({ data: { transportActive: true, channelId: CHANNEL_ID, results: [], counts: { stored: 0, deduplicated: 0, unparsed: 0, filtered: 0, failed: 0 } }, error: null }) },
  });
  const response = await handler(post({ statuses: [{ messageId: "m1", status: "read" }, { messageId: "m2", status: "sent" }] }));
  assert.equal(response.status, 200);
  assert.equal(persistCalls(state).length, 1);
  assert.deepEqual(persistCalls(state)[0].args.p_elements, []);
  assert.deepEqual(persistCalls(state)[0].args.p_counters, { status: 2 });
  assert.equal(projectCalls(state).length, 0);
});

test("subscriptions that were not switched on (contacts and deals, templates, anything unknown) are counted and ignored, never stored", async () => {
  const { handler, state } = harness({
    rpc: { wazzup_webhook_persist_v1: () => ({ data: { transportActive: true, results: [], counts: {} }, error: null }) },
  });
  for (const body of [{ createContact: { name: "x" } }, { createDeal: { contacts: [1] } }, { templateStatus: { status: "APPROVED" } }, { somethingNew: [1, 2] }]) {
    const before = persistCalls(state).length;
    const response = await handler(post(body));
    assert.equal(response.status, 200);
    const call = persistCalls(state)[before];
    assert.deepEqual(call.args.p_elements, []);
    assert.deepEqual(call.args.p_counters, { ignored_subscription: 1 });
  }
});

test("a malformed `messages` (not an array) or an element that is not an object is handed to the database as it is, so it is kept as unparsed evidence", async () => {
  const { handler, state } = harness({
    rpc: { wazzup_webhook_persist_v1: (args) => ({ data: { ...storedAnswer(args.p_elements), results: args.p_elements.map((_, index) => ({ outcome: "unparsed", eventId: uuid(2000 + index), eventType: "unparsed", index })) }, error: null }), wazzup_project_event_v1: () => ({ data: { outcome: "needs_review", newInbound: false }, error: null }) },
  });
  await handler(post({ messages: "oops" }));
  await handler(post({ messages: [1, null, "x", message(1)] }));
  const calls = persistCalls(state);
  assert.deepEqual(calls[0].args.p_elements, [{ kind: "message", element: "oops" }]);
  assert.deepEqual(calls[1].args.p_elements.map((item) => item.element), [1, null, "x", message(1)]);
});

test("the answer is counters only: no text, number or id of a message", async () => {
  const { handler } = harness({
    rpc: { wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }), wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound: false }, error: null }) },
  });
  const text = await (await handler(post({ messages: [message(1, { text: "synthetic private text" })] }))).text();
  assert.ok(!text.includes("synthetic") && !text.includes(CUSTOMER_DIGITS) && !text.includes("msg-1"));
  assert.ok(Object.values(JSON.parse(text)).every((value) => typeof value === "number" || value === true));
});

// ---------------------------------------------------------------- transport and database failures

test("the transport is not Wazzup: 503 transport_inactive, nothing projected, later portions not sent", async () => {
  const messages = Array.from({ length: 150 }, (_, index) => message(index + 1));
  const { handler, state } = harness({
    rpc: { wazzup_webhook_persist_v1: () => ({ data: { transportActive: false, results: [] }, error: null }) },
  });
  const response = await handler(post({ messages }));
  assert.equal(response.status, 503);
  assert.deepEqual(await json(response), { error: "transport_inactive" });
  assert.equal(persistCalls(state).length, 1, "the second portion is not sent");
  assert.equal(projectCalls(state).length, 0);
  assert.equal(state.logs.at(-1).reason, "transport_inactive");
});

test("a database error, a timeout, a missing backend and an unexpected answer are 503 - never a silent 200", async () => {
  const cases = {
    rpcError: { rpc: { wazzup_webhook_persist_v1: () => ({ data: null, error: { code: "XX000", message: "boom" } }) } },
    thrown: { rpc: { wazzup_webhook_persist_v1: () => { throw new Error("socket closed"); } } },
    hung: { rpc: { wazzup_webhook_persist_v1: () => new Promise(() => undefined) }, databaseDeadlineMs: 20 },
    badShape: { rpc: { wazzup_webhook_persist_v1: () => ({ data: { transportActive: true, results: "nope" }, error: null }) } },
    shortResults: { rpc: { wazzup_webhook_persist_v1: () => ({ data: { transportActive: true, results: [] }, error: null }) } },
    badOutcome: { rpc: { wazzup_webhook_persist_v1: () => ({ data: { transportActive: true, results: [{ outcome: "weird", index: 0 }] }, error: null }) } },
    badEventId: { rpc: { wazzup_webhook_persist_v1: () => ({ data: { transportActive: true, results: [{ outcome: "stored", eventId: "not-a-uuid", index: 0 }] }, error: null }) } },
  };
  for (const [name, options] of Object.entries(cases)) {
    const { handler } = harness(options);
    const response = await handler(post({ messages: [message(1)] }));
    assert.equal(response.status, 503, name);
    assert.deepEqual(await json(response), { error: "wazzup_webhook_unavailable" }, name);
  }
  const noBackend = harness({ env: environment({ EVO_PLATFORM_SUPABASE_SECRET_KEY: undefined }) });
  assert.equal((await noBackend.handler(post({ messages: [message(1)] }))).status, 503);
  assert.equal(noBackend.state.clients, 0);
});

test("the whole write is bounded: once the request budget is spent the next portion is not started (503)", async () => {
  let clock = 0;
  const messages = Array.from({ length: 250 }, (_, index) => message(index + 1));
  const { handler, state } = harness({
    now: () => clock,
    requestBudgetMs: 1_000,
    rpc: {
      wazzup_webhook_persist_v1: (args) => {
        clock += 600;
        return { data: storedAnswer(args.p_elements), error: null };
      },
      wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound: false }, error: null }),
    },
  });
  const response = await handler(post({ messages }));
  assert.equal(response.status, 503);
  assert.equal(persistCalls(state).length, 2, "the third portion is refused by the budget");
  assert.equal(state.logs.at(-1).reason, "budget_exceeded");
});

test("one element that failed to write does not fail the request: it is counted, the rest is stored and projected", async () => {
  const { handler, state } = harness({
    rpc: {
      wazzup_webhook_persist_v1: () => ({
        data: {
          transportActive: true,
          results: [
            { outcome: "stored", eventId: uuid(1), eventType: "message", index: 0 },
            { outcome: "element_failed", code: "23514", sha256: "a".repeat(64), index: 1 },
            { outcome: "deduplicated", eventId: uuid(3), eventType: "message", index: 2 },
            { outcome: "filtered", code: "filtered_inbound_channel", index: 3 },
            { outcome: "unparsed", eventId: uuid(5), eventType: "unparsed", index: 4 },
          ],
        },
        error: null,
      }),
      wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound: false }, error: null }),
    },
  });
  const response = await handler(post({ messages: [1, 2, 3, 4, 5].map(message) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true, stored: 1, deduplicated: 1, unparsed: 1, filtered: 1, failed: 1, projected: 2, deferred: 0 });
  assert.deepEqual(projectCalls(state).map((call) => call.args.p_event_id), [uuid(1), uuid(5)], "only the new events are projected");
});

// ---------------------------------------------------------------- inline projection

test("new events are projected at once, oldest message first, by the sales owner of the intake; a replay (deduplicated) projects nothing", async () => {
  const messages = [
    message(3, { dateTime: "2026-10-27T10:00:30.000" }),
    message(1, { dateTime: "2026-10-27T10:00:10.000" }),
    message(2, { dateTime: "2026-10-27T10:00:20.000" }),
  ];
  const { handler, state } = harness({
    rpc: {
      wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }),
      wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound: false }, error: null }),
    },
  });
  await handler(post({ messages }));
  assert.deepEqual(projectCalls(state).map((call) => call.args.p_event_id), [uuid(1001), uuid(1002), uuid(1000)]);
  for (const call of projectCalls(state)) {
    assert.equal(call.args.p_organization_id, ORGANIZATION_ID);
    assert.equal(call.args.p_intake_sales_membership_id, OWNER_ID);
    assert.match(call.args.p_request_id, /^[0-9a-f-]{36}$/u);
  }
  assert.equal(new Set(projectCalls(state).map((call) => call.args.p_request_id)).size, 3);

  const replay = harness({
    rpc: {
      wazzup_webhook_persist_v1: (args) => ({
        data: { transportActive: true, results: args.p_elements.map((_, index) => ({ outcome: "deduplicated", eventId: uuid(index), eventType: "message", index })) },
        error: null,
      }),
    },
  });
  const answer = await json(await replay.handler(post({ messages })));
  assert.equal(answer.deduplicated, 3);
  assert.equal(projectCalls(replay.state).length, 0);
});

test("a projection that fails or does not fit the 5 second budget leaves the event for the timer and the answer stays 200", async () => {
  let clock = 0;
  const { handler, state } = harness({
    now: () => clock,
    projectionBudgetMs: 5_000,
    rpc: {
      wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }),
      wazzup_project_event_v1: (_args, n) => {
        clock += 3_000;
        if (n === 1) return { data: null, error: { code: "XX000", message: "boom" } };
        return { data: { outcome: "projected", newInbound: false }, error: null };
      },
    },
  });
  const response = await handler(post({ messages: [message(1), message(2), message(3), message(4)] }));
  assert.equal(response.status, 200);
  const answer = await json(response);
  assert.equal(projectCalls(state).length, 2, "the budget of 5 s stops the third projection");
  assert.equal(answer.projected, 1);
  assert.equal(answer.deferred, 2);
  assert.equal(answer.stored, 4);
});

test("a projection call that hangs is cut by the budget; the request still answers 200", async () => {
  const { handler } = harness({
    projectionBudgetMs: 30,
    rpc: {
      wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }),
      wazzup_project_event_v1: () => new Promise(() => undefined),
    },
  });
  const response = await handler(post({ messages: [message(1), message(2)] }));
  assert.equal(response.status, 200);
  const answer = await json(response);
  assert.equal(answer.projected, 0);
  assert.equal(answer.deferred, 2);
});

test("without the intake owner nothing is projected inline (the events wait stored); the answer is still 200", async () => {
  const { handler, state } = harness({
    env: environment({ EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: undefined }),
    rpc: { wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }) },
  });
  const response = await handler(post({ messages: [message(1), message(2)] }));
  assert.equal(response.status, 200);
  assert.equal(projectCalls(state).length, 0);
  assert.equal((await json(response)).deferred, 2);
  assert.equal(state.logs.at(-1).projection, "no_owner");
});

test("a transport switched away mid-request stops the projection", async () => {
  const { handler, state } = harness({
    rpc: {
      wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }),
      wazzup_project_event_v1: () => ({ data: { outcome: "transport_inactive" }, error: null }),
    },
  });
  const response = await handler(post({ messages: [message(1), message(2), message(3)] }));
  assert.equal(response.status, 200);
  assert.equal(projectCalls(state).length, 1);
  assert.equal((await json(response)).deferred, 3);
});

// ---------------------------------------------------------------- the agents

test("a new inbound message schedules the AI agents once per request, and only when the database switch is on", async () => {
  const run = async ({ aiTriggerEnabled, newInbound, messages = [message(1), message(2)] }) => {
    const { handler, state } = harness({
      rpc: {
        wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }),
        wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound, aiTriggerEnabled }, error: null }),
      },
    });
    const response = await handler(post({ messages }));
    assert.equal(response.status, 200);
    return state.ai;
  };
  assert.equal(await run({ aiTriggerEnabled: true, newInbound: true }), 1, "two new inbound messages, one scheduling");
  assert.equal(await run({ aiTriggerEnabled: false, newInbound: true }), 0, "the switch in the database is off");
  assert.equal(await run({ aiTriggerEnabled: true, newInbound: false }), 0, "a staff echo or a duplicate is not a new inbound message");
  assert.equal(await run({ aiTriggerEnabled: undefined, newInbound: true }), 0, "an answer without the flag does not start the agents");
});

test("a failure of the agents hook never changes the answer", async () => {
  const { handler } = harness({
    ai: () => {
      throw new Error("hook down");
    },
    rpc: {
      wazzup_webhook_persist_v1: (args) => ({ data: storedAnswer(args.p_elements), error: null }),
      wazzup_project_event_v1: () => ({ data: { outcome: "projected", newInbound: true, aiTriggerEnabled: true }, error: null }),
    },
  });
  assert.equal((await handler(post({ messages: [message(1)] }))).status, 200);
});

// ---------------------------------------------------------------- safety net

test("an unexpected failure is still a JSON 503, with a counter in the log and nothing else", async () => {
  const { handler, state } = harness({
    log: () => {
      throw new Error("log sink down");
    },
  });
  const response = await handler(post({ test: true }));
  assert.equal(response.status, 200, "a failing log sink does not change the answer");
  const exploding = createPlatformWazzupInboundHandler({
    environment: environment(),
    limiter: new WazzupFailureLimiter(),
    log: (entry) => state.logs.push(entry),
    createServiceClient: () => {
      throw new Error("client factory down");
    },
  });
  const failed = await exploding(post({ messages: [message(1)] }));
  assert.equal(failed.status, 503);
  const brokenRequest = { method: "POST", get headers() { throw new Error("broken request"); } };
  const net = await exploding(brokenRequest);
  assert.equal(net.status, 503);
  assert.deepEqual(await json(net), { error: "wazzup_webhook_unavailable" });
});
