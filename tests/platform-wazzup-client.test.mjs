// The Wazzup API client (src/lib/server/platform-wazzup-client.ts): requests against a fake fetch - no network, no real key.
// Everything is synthetic. Run with:
// node --conditions=react-server --experimental-strip-types --test tests/platform-wazzup-client.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createWazzupClient,
  isWazzupApiKeyShape,
  resolveWazzupApiKey,
  WAZZUP_API_BASE_URL,
  WAZZUP_CLIENT_PATHS,
  WazzupApiError,
} from "../src/lib/server/platform-wazzup-client.ts";

const SYNTH_KEY = "synthetic-wazzup-key-0123456789abcdef";
const CHANNEL = "77500000-0000-4000-8000-0000000000c1";
const URI_WITH_TOKEN = `https://crm.evoadmissions.com/api/v2/whatsapp/wazzup/inbound?token=${"ab".repeat(32)}`;

function recorder(responder) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ url: String(input), init });
    return responder(String(input), init, calls.length);
  };
  return { calls, fetchImpl };
}

const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("the key shape: 16-4096 printable characters without whitespace", () => {
  assert.equal(isWazzupApiKeyShape(SYNTH_KEY), true);
  for (const bad of ["", "short", `${SYNTH_KEY} `, ` ${SYNTH_KEY}`, `${SYNTH_KEY}\n`, `${SYNTH_KEY.slice(0, 8)} ${SYNTH_KEY.slice(8)}`, "k".repeat(4097), `${SYNTH_KEY}\u0007`, "ключ-ключ-ключ-ключ"]) {
    assert.equal(isWazzupApiKeyShape(bad), false, JSON.stringify(bad));
  }
  assert.throws(() => createWazzupClient({ apiKey: "short" }), RangeError);
  try {
    createWazzupClient({ apiKey: ["bad", "key", "with", "spaces", "inside"].join(" ") });
  } catch (error) {
    assert.ok(!String(error.message).includes("bad key"), "the message never carries the value");
  }
});

test("GET /v3/channels: bearer key, JSON accept, the exact base URL, no redirect following", async () => {
  const { calls, fetchImpl } = recorder(() => jsonResponse([{ channelId: CHANNEL, transport: "whatsapp", plainId: "99600000001", state: "active" }]));
  const client = createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl });
  const channels = await client.listChannels();
  assert.deepEqual(channels, [{ channelId: CHANNEL, transport: "whatsapp", plainId: "99600000001", state: "active" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${WAZZUP_API_BASE_URL}/v3/channels`);
  assert.equal(WAZZUP_API_BASE_URL, "https://api.wazzup24.com");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${SYNTH_KEY}`);
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal(calls[0].init.redirect, "error", "the key must not follow a redirect to another host");
  assert.equal(calls[0].init.body, undefined);
});

test("channel entries: states keep their spelling, odd entries are dropped, a number plainId becomes text, a non-array is invalid", async () => {
  const body = [
    { channelId: CHANNEL.toUpperCase(), transport: "whatsapp", plainId: 99600000002, state: "qridle" },
    { channelId: "77500000-0000-4000-8000-0000000000c2", transport: "tgapi", plainId: "synthetic_user", state: "openelsewhere" },
    { channelId: "77500000-0000-4000-8000-0000000000c3", transport: "wapi", state: "state with spaces" },
    { channelId: "not-a-uuid", transport: "whatsapp", state: "active" },
    { transport: "whatsapp", state: "active" },
    { channelId: "77500000-0000-4000-8000-0000000000c4", transport: "Bad Transport!", state: "active" },
    "text",
    null,
  ];
  const client = createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl: recorder(() => jsonResponse(body)).fetchImpl });
  const channels = await client.listChannels();
  assert.deepEqual(
    channels.map((channel) => [channel.channelId, channel.transport, channel.plainId, channel.state]),
    [
      [CHANNEL, "whatsapp", "99600000002", "qridle"],
      ["77500000-0000-4000-8000-0000000000c2", "tgapi", "synthetic_user", "openelsewhere"],
      ["77500000-0000-4000-8000-0000000000c3", "wapi", null, "unknown"],
    ],
  );
  for (const bad of [{ error: "x" }, "oops", null]) {
    const broken = createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl: recorder(() => jsonResponse(bad)).fetchImpl });
    await assert.rejects(() => broken.listChannels(), (error) => error instanceof WazzupApiError && error.kind === "invalid_response");
  }
});

test("GET /v3/webhooks: the address and the four subscriptions, booleans or the strings the documentation example shows", async () => {
  const { calls, fetchImpl } = recorder(() => jsonResponse({
    webhooksUri: URI_WITH_TOKEN,
    subscriptions: { messagesAndStatuses: "true", channelsUpdates: true, contactsAndDealsCreation: "false" },
  }));
  const state = await createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl }).getWebhooks();
  assert.equal(calls[0].url, `${WAZZUP_API_BASE_URL}/v3/webhooks`);
  assert.deepEqual(state, {
    webhooksUri: URI_WITH_TOKEN,
    subscriptions: { messagesAndStatuses: true, contactsAndDealsCreation: false, channelsUpdates: true, templateStatus: false },
  });
  const empty = await createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl: recorder(() => jsonResponse({ subscriptions: {} })).fetchImpl }).getWebhooks();
  assert.deepEqual(empty, { webhooksUri: null, subscriptions: { messagesAndStatuses: false, contactsAndDealsCreation: false, channelsUpdates: false, templateStatus: false } });
  await assert.rejects(
    () => createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl: recorder(() => jsonResponse([])).fetchImpl }).getWebhooks(),
    (error) => error.kind === "invalid_response",
  );
});

test("PATCH /v3/webhooks sends exactly the address and the four subscription flags; an address over 200 characters is refused locally", async () => {
  const { calls, fetchImpl } = recorder(() => jsonResponse({ ok: true }));
  const client = createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl });
  await client.patchWebhooks({
    webhooksUri: URI_WITH_TOKEN,
    subscriptions: { messagesAndStatuses: true, contactsAndDealsCreation: false, channelsUpdates: true, templateStatus: false, extra: true },
  });
  assert.equal(calls[0].url, `${WAZZUP_API_BASE_URL}/v3/webhooks`);
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    webhooksUri: URI_WITH_TOKEN,
    subscriptions: { messagesAndStatuses: true, contactsAndDealsCreation: false, channelsUpdates: true, templateStatus: false },
  });
  await assert.rejects(
    () => client.patchWebhooks({ webhooksUri: `https://x.test/${"a".repeat(200)}`, subscriptions: { messagesAndStatuses: true, contactsAndDealsCreation: false, channelsUpdates: true, templateStatus: false } }),
    RangeError,
  );
  assert.equal(calls.length, 1);
  // An empty body (204 or no JSON) is a success too.
  const quiet = createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl: recorder(() => new Response(null, { status: 204 })).fetchImpl });
  await quiet.patchWebhooks({ webhooksUri: URI_WITH_TOKEN, subscriptions: { messagesAndStatuses: false, contactsAndDealsCreation: false, channelsUpdates: false, templateStatus: false } });
});

test("HTTP failures become fixed kinds with the status; 400 carries only a safe Wazzup code and the status the test POST got", async () => {
  const run = async (status, body, headers) => {
    const { fetchImpl } = recorder(() => new Response(body, { status, headers }));
    return createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl }).listChannels().then(() => null, (error) => error);
  };
  assert.deepEqual(pick(await run(401, "")), { kind: "unauthorized", status: 401, code: null, testStatus: null });
  assert.deepEqual(pick(await run(403, "")), { kind: "forbidden", status: 403, code: null, testStatus: null });
  assert.deepEqual(pick(await run(429, "")), { kind: "rate_limited", status: 429, code: null, testStatus: null });
  assert.deepEqual(pick(await run(500, "boom")), { kind: "server", status: 500, code: null, testStatus: null });
  assert.deepEqual(pick(await run(503, "")), { kind: "server", status: 503, code: null, testStatus: null });
  assert.deepEqual(pick(await run(404, "")), { kind: "http_error", status: 404, code: null, testStatus: null });
  assert.deepEqual(pick(await run(302, "")), { kind: "http_error", status: 302, code: null, testStatus: null });
  assert.deepEqual(
    pick(await run(400, JSON.stringify({ error: "testPostNotPassed", description: "Webhooks request not valid.", data: 401 }))),
    { kind: "bad_request", status: 400, code: "testPostNotPassed", testStatus: 401 },
  );
  assert.deepEqual(
    pick(await run(400, JSON.stringify({ error: "uriNotValid", data: { status: 500 } }))),
    { kind: "bad_request", status: 400, code: "uriNotValid", testStatus: 500 },
  );
  // A code of unsafe form is not passed on; the body text never is.
  const odd = await run(400, JSON.stringify({ error: "has spaces and 'quotes'", description: URI_WITH_TOKEN, data: "x" }));
  assert.deepEqual(pick(odd), { kind: "bad_request", status: 400, code: null, testStatus: null });
  assert.equal((await run(400, "not json")).kind, "bad_request");
  assert.equal((await run(200, "not json")).kind, "invalid_response");
  assert.equal((await run(200, "x".repeat(300 * 1024))).kind, "invalid_response", "an oversized answer is refused, not buffered");
});

function pick(error) {
  assert.ok(error instanceof WazzupApiError, String(error));
  return { kind: error.kind, status: error.status, code: error.code, testStatus: error.testStatus };
}

test("a network failure and a slow answer are `network` and `timeout`, never the underlying message", async () => {
  const failing = createWazzupClient({
    apiKey: SYNTH_KEY,
    fetchImpl: async () => {
      throw new TypeError(`connect ECONNREFUSED ${SYNTH_KEY} ${URI_WITH_TOKEN}`);
    },
  });
  const error = await failing.listChannels().then(() => null, (caught) => caught);
  assert.equal(error.kind, "network");
  assert.ok(!error.message.includes(SYNTH_KEY) && !error.message.includes("ECONNREFUSED"));
  assert.equal("cause" in error && error.cause !== undefined, false);

  const slow = createWazzupClient({
    apiKey: SYNTH_KEY,
    timeoutMs: 25,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  });
  assert.equal((await slow.listChannels().then(() => null, (caught) => caught)).kind, "timeout");
});

test("no error, JSON form or string the client can produce contains the key", async () => {
  const bodies = [
    ["listChannels", () => jsonResponse({ error: "x", key: SYNTH_KEY }, 401)],
    ["getWebhooks", () => new Response(SYNTH_KEY, { status: 500 })],
    ["listChannels", () => new Response(`{"error":"${SYNTH_KEY}"}`, { status: 400 })],
  ];
  for (const [method, responder] of bodies) {
    const client = createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl: recorder(responder).fetchImpl });
    const error = await client[method]().then(() => null, (caught) => caught);
    assert.ok(error instanceof WazzupApiError);
    assert.ok(!JSON.stringify({ message: error.message, name: error.name, kind: error.kind, code: error.code, stack: String(error.stack).split("\n")[0] }).includes(SYNTH_KEY));
    assert.ok(!Object.values(error).some((value) => String(value).includes(SYNTH_KEY)));
  }
});

test("the client can reach only the three allowed calls: channels, webhooks (GET and PATCH) - there is no way to send a message", async () => {
  const { calls, fetchImpl } = recorder((url) => (url.endsWith("/v3/channels") ? jsonResponse([]) : jsonResponse({ webhooksUri: null, subscriptions: {} })));
  const client = createWazzupClient({ apiKey: SYNTH_KEY, fetchImpl });
  assert.deepEqual(Object.keys(client).sort(), ["getWebhooks", "listChannels", "patchWebhooks"]);
  await client.listChannels();
  await client.getWebhooks();
  await client.patchWebhooks({ webhooksUri: URI_WITH_TOKEN, subscriptions: { messagesAndStatuses: true, contactsAndDealsCreation: false, channelsUpdates: true, templateStatus: false } });
  assert.deepEqual(
    calls.map((call) => `${call.init.method} ${new URL(call.url).pathname}`),
    ["GET /v3/channels", "GET /v3/webhooks", "PATCH /v3/webhooks"],
  );
  assert.deepEqual([...WAZZUP_CLIENT_PATHS], ["/v3/channels", "/v3/webhooks"]);
  // The source mentions no message endpoint at all, and no POST.
  const source = readFileSync(new URL("../src/lib/server/platform-wazzup-client.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
  assert.ok(!/v3\/message|\/message["'`]/u.test(code), "no message path in the code");
  assert.ok(!/"POST"|'POST'|method:\s*["']POST/u.test(code), "no POST in the code");
});

test("resolveWazzupApiKey: the Vault answer becomes a ready key and a fingerprint, or a reason word", async () => {
  const sha = "ab".repeat(32);
  const rpcClient = (answer) => ({
    schema: (name) => {
      assert.equal(name, "platform");
      return { rpc: async (fn, args) => {
        assert.equal(fn, "wazzup_api_key_resolve_v1");
        assert.deepEqual(args, { p_organization_id: "org-1" });
        return answer;
      } };
    },
  });
  assert.deepEqual(
    await resolveWazzupApiKey(rpcClient({ data: { ready: true, reasonCode: "ready", apiKey: SYNTH_KEY, apiKeySha256: sha, bindingVersion: 1 }, error: null }), "org-1"),
    { ready: true, apiKey: SYNTH_KEY, fingerprint: "abababab" },
  );
  assert.deepEqual(await resolveWazzupApiKey(rpcClient({ data: { ready: false, reasonCode: "missing_binding" }, error: null }), "org-1"), { ready: false, reason: "missing_binding" });
  assert.deepEqual(await resolveWazzupApiKey(rpcClient({ data: { ready: false, reasonCode: "Not A Word!" }, error: null }), "org-1"), { ready: false, reason: "unavailable" });
  assert.deepEqual(await resolveWazzupApiKey(rpcClient({ data: null, error: { message: "x" } }), "org-1"), { ready: false, reason: "database_unavailable" });
  assert.deepEqual(await resolveWazzupApiKey({ schema: () => { throw new Error("down"); } }, "org-1"), { ready: false, reason: "database_unavailable" });
  for (const bad of [{ ready: true, apiKey: "short", apiKeySha256: sha }, { ready: true, apiKey: SYNTH_KEY, apiKeySha256: "nope" }, { ready: true }]) {
    assert.deepEqual(await resolveWazzupApiKey(rpcClient({ data: bad, error: null }), "org-1"), { ready: false, reason: "secret_invalid" });
  }
});
