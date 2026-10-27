// The Wazzup operator commands (src/lib/server/platform-wazzup-ops.ts): argument and secret handling against a fake Wazzup client,
// a fake database and a fake loopback - no network, no real key, no real token. Everything is synthetic. Run with:
// node --conditions=react-server --experimental-strip-types --test tests/platform-wazzup-ops.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  describeWebhookAddress,
  runWazzupOps,
  wazzupChannelLast4,
} from "../src/lib/server/platform-wazzup-ops.ts";
import { WazzupApiError } from "../src/lib/server/platform-wazzup-client.ts";

const ORGANIZATION_ID = "77700000-0000-4000-8000-000000000001";
const CHANNEL_ID = "77700000-0000-4000-8000-0000000000c1";
const OTHER_CHANNEL_ID = "77700000-0000-4000-8000-0000000000c2";
const SYNTH_KEY = "synthetic-wazzup-key-0123456789abcdef";
const HOOK_TOKEN = "0123456789abcdef".repeat(4);
const NEXT_TOKEN = "fedcba9876543210".repeat(4);
const PLAIN_ID = "99600001234";
const SECRET_KEY = "sb_secret_wazzup_ops_key_0001";
const WEBHOOK_URI = (token) => `https://crm.evoadmissions.com/api/v2/whatsapp/wazzup/inbound?token=${token}`;
const ON = { messagesAndStatuses: true, contactsAndDealsCreation: false, channelsUpdates: true, templateStatus: false };
const OFF = { messagesAndStatuses: false, contactsAndDealsCreation: false, channelsUpdates: false, templateStatus: false };

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function environment(overrides = {}) {
  return {
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: SECRET_KEY,
    EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: HOOK_TOKEN,
    ...overrides,
  };
}

/**
 * A harness around `runWazzupOps`. `webhooks` is the address state the fake Wazzup holds (and PATCH changes);
 * `rpc` maps a function name to a handler; everything printed and every call is recorded.
 */
function harness({ env = environment(), channels, webhooks, rpc = {}, key = SYNTH_KEY, secret, local, patchError, listError } = {}) {
  const state = {
    prints: [],
    rpcCalls: [],
    wazzupKeys: [],
    patches: [],
    local: [],
    secretReads: 0,
    webhooks: webhooks ?? { webhooksUri: null, subscriptions: { ...OFF } },
  };
  const defaultChannels = [{ channelId: CHANNEL_ID, transport: "whatsapp", plainId: PLAIN_ID, state: "active" }];
  const rpcHandlers = {
    wazzup_api_key_resolve_v1: () => ({ data: { ready: true, reasonCode: "ready", apiKey: key, apiKeySha256: sha256(key), bindingVersion: 1 }, error: null }),
    ...rpc,
  };
  const deps = {
    environment: env,
    createServiceClient: () => ({
      schema(name) {
        assert.equal(name, "platform");
        return {
          rpc: async (fn, args) => {
            state.rpcCalls.push({ fn, args });
            const handler = rpcHandlers[fn];
            assert.ok(handler, `unexpected RPC ${fn}`);
            return handler(args);
          },
        };
      },
    }),
    createWazzupClient: (apiKey) => {
      state.wazzupKeys.push(apiKey);
      return {
        async listChannels() {
          if (listError !== undefined) throw listError;
          return channels ?? defaultChannels;
        },
        async getWebhooks() {
          return state.webhooks;
        },
        async patchWebhooks(input) {
          state.patches.push(input);
          if (patchError !== undefined) throw patchError;
          state.webhooks = { webhooksUri: input.webhooksUri, subscriptions: { ...input.subscriptions } };
        },
      };
    },
    readSecret: async () => {
      state.secretReads += 1;
      return secret ?? key;
    },
    postLocal: async (request) => {
      state.local.push(request);
      return local ?? { status: 200, body: JSON.stringify({ ok: true, stored: 0, deduplicated: 2, projected: 0 }) };
    },
    print: (line) => state.prints.push(line),
  };
  return { deps, state, run: (argv) => runWazzupOps(argv, deps) };
}

const output = (state) => JSON.stringify(state.prints);

/** Nothing printed or logged may contain these, for any command. */
function assertNoSecrets(state, extra = []) {
  const text = output(state);
  for (const secret of [SYNTH_KEY, HOOK_TOKEN, NEXT_TOKEN, SECRET_KEY, PLAIN_ID, ...extra]) {
    assert.ok(!text.includes(secret), `output leaked ${secret.slice(0, 8)}…`);
  }
  assert.ok(!text.includes(sha256(SYNTH_KEY)), "the full key digest is not printed, only 8 characters");
}

// ---------------------------------------------------------------- helpers

test("the last four digits come only from a number-like identifier", () => {
  assert.equal(wazzupChannelLast4("+99 600 001 234"), "1234");
  assert.equal(wazzupChannelLast4(PLAIN_ID), "1234");
  for (const value of [null, "", "synthetic_user", "12", "123456"]) assert.equal(wazzupChannelLast4(value), null, String(value));
});

test("a webhook address is described without ever returning the token or a foreign path", () => {
  const tokens = { current: HOOK_TOKEN, next: NEXT_TOKEN };
  assert.deepEqual(describeWebhookAddress(null, tokens), { state: "empty" });
  assert.deepEqual(describeWebhookAddress(WEBHOOK_URI(HOOK_TOKEN), tokens), { state: "ours", host: "crm.evoadmissions.com", path: "/api/v2/whatsapp/wazzup/inbound", token: "current" });
  assert.equal(describeWebhookAddress(WEBHOOK_URI(NEXT_TOKEN), tokens).token, "next");
  assert.equal(describeWebhookAddress(WEBHOOK_URI("c".repeat(64)), tokens).token, "other");
  assert.equal(describeWebhookAddress("https://crm.evoadmissions.com/api/v2/whatsapp/wazzup/inbound", tokens).token, "absent");
  assert.equal(describeWebhookAddress(WEBHOOK_URI(HOOK_TOKEN), { current: null, next: null }).token, "other");
  // A foreign address: the host only - its path and query may carry its own secret.
  const foreign = describeWebhookAddress("https://hooks.example.test/in/SECRET-PATH-PART?key=SECRET-QUERY-PART", tokens);
  assert.deepEqual(foreign, { state: "other", host: "hooks.example.test" });
  assert.ok(!JSON.stringify(foreign).includes("SECRET"));
  // Our host with another path, our path on another host, another scheme: all foreign.
  for (const uri of ["https://crm.evoadmissions.com/api/v2/whatsapp/inbound?token=x", "https://app.evoadmissions.com/api/v2/whatsapp/wazzup/inbound", "http://crm.evoadmissions.com/api/v2/whatsapp/wazzup/inbound"]) {
    assert.equal(describeWebhookAddress(uri, tokens).state, "other", uri);
  }
  assert.deepEqual(describeWebhookAddress("not a url", tokens), { state: "invalid" });
  assert.ok(!JSON.stringify(describeWebhookAddress(WEBHOOK_URI(HOOK_TOKEN), tokens)).includes(HOOK_TOKEN));
});

// ---------------------------------------------------------------- usage

test("an unknown command is a usage error that echoes nothing back", async () => {
  const { run, state } = harness();
  for (const argv of [[], ["nope"], ["SET-KEY"], [SYNTH_KEY]]) {
    assert.equal(await run(argv), 2);
  }
  assert.deepEqual(state.prints.map((line) => line.error), ["unknown_command", "unknown_command", "unknown_command", "unknown_command"]);
  assertNoSecrets(state);
  assert.equal(state.rpcCalls.length, 0);
});

test("a secret typed as an argument is refused by name, never echoed, and never read, sent or stored", async () => {
  for (const argv of [
    ["set-key", SYNTH_KEY],
    ["set-key", "--key", SYNTH_KEY],
    ["channels", SYNTH_KEY],
    ["webhooks-get", HOOK_TOKEN],
    ["webhooks-patch", "--on", HOOK_TOKEN],
    ["webhooks-patch", "--on", "--token", HOOK_TOKEN],
    ["replay", HOOK_TOKEN],
    ["transport", "wazzup", "--ai-trigger", "off", SYNTH_KEY],
    ["bind-channel", CHANNEL_ID, "--confirm-last4", "1234", SYNTH_KEY],
  ]) {
    const { run, state } = harness();
    assert.equal(await run(argv), 2, argv.join(" ").replace(SYNTH_KEY, "<key>").replace(HOOK_TOKEN, "<token>"));
    assertNoSecrets(state);
    assert.equal(state.secretReads, 0);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.wazzupKeys.length, 0);
    assert.equal(state.patches.length, 0);
    assert.equal(state.local.length, 0);
  }
});

// ---------------------------------------------------------------- set-key

test("set-key: reads the key from stdin, asks Wazzup first with GET only, then stores it in the Vault; prints a fingerprint and last four digits only", async () => {
  const { run, state } = harness({
    rpc: { wazzup_api_key_provision_v1: () => ({ data: { ready: true, apiKeySha256: sha256(SYNTH_KEY), bindingVersion: 1, changed: true, replayed: false }, error: null }) },
    channels: [
      { channelId: CHANNEL_ID, transport: "whatsapp", plainId: PLAIN_ID, state: "active" },
      { channelId: OTHER_CHANNEL_ID, transport: "tgapi", plainId: "synthetic_user", state: "qridle" },
    ],
  });
  assert.equal(await run(["set-key"]), 0);
  assert.equal(state.secretReads, 1);
  assert.deepEqual(state.wazzupKeys, [SYNTH_KEY], "the key was proven against Wazzup before it was stored");
  const provision = state.rpcCalls.find((call) => call.fn === "wazzup_api_key_provision_v1");
  assert.ok(provision);
  assert.equal(provision.args.p_api_key, SYNTH_KEY, "the Vault gets the real value (the only place it goes)");
  assert.equal(provision.args.p_organization_id, ORGANIZATION_ID);
  assert.match(provision.args.p_request_id, /^[0-9a-f-]{36}$/u);
  assert.deepEqual(state.prints, [{
    ok: true,
    command: "set-key",
    stored: true,
    fingerprint: sha256(SYNTH_KEY).slice(0, 8),
    changed: true,
    channels: [{ transport: "whatsapp", last4: "1234", state: "active" }, { transport: "tgapi", last4: null, state: "qridle" }],
  }]);
  assertNoSecrets(state, [CHANNEL_ID, OTHER_CHANNEL_ID, "synthetic_user"]);
});

test("set-key: a malformed key never reaches Wazzup or the database; a key Wazzup refuses is not stored; an unreachable Wazzup stores nothing", async () => {
  for (const bad of ["", "short", `${SYNTH_KEY} `, `${SYNTH_KEY.slice(0, 10)} ${SYNTH_KEY.slice(10)}`, "k".repeat(4097), `${SYNTH_KEY}\u0000`]) {
    const { run, state } = harness({ secret: bad });
    assert.equal(await run(["set-key"]), 1);
    assert.equal(state.prints[0].error, "key_shape_invalid");
    assert.equal(state.wazzupKeys.length, 0);
    assert.equal(state.rpcCalls.length, 0);
    assert.ok(!output(state).includes(bad.slice(0, 12)) || bad.length < 12);
  }
  for (const [listError, code] of [
    [new WazzupApiError("unauthorized", { status: 401 }), "key_rejected"],
    [new WazzupApiError("forbidden", { status: 403 }), "key_rejected"],
    [new WazzupApiError("network"), "wazzup_unreachable"],
    [new WazzupApiError("server", { status: 502 }), "wazzup_unreachable"],
    [new WazzupApiError("rate_limited", { status: 429 }), "wazzup_unreachable"],
  ]) {
    const { run, state } = harness({ listError });
    assert.equal(await run(["set-key"]), 1);
    assert.equal(state.prints[0].error, code);
    assert.equal(state.rpcCalls.filter((call) => call.fn === "wazzup_api_key_provision_v1").length, 0, "a key Wazzup did not accept is never stored");
    assertNoSecrets(state);
  }
});

test("set-key: a Vault failure is reported by a fixed word; the key is not printed", async () => {
  const { run, state } = harness({
    rpc: { wazzup_api_key_provision_v1: () => ({ data: null, error: { code: "22023", message: `wazzup_api_key_invalid_request for ${SYNTH_KEY}` } }) },
  });
  assert.equal(await run(["set-key"]), 1);
  assert.deepEqual(state.prints, [{ ok: false, error: "key_not_stored", reason: "wazzup_api_key_invalid_request" }]);
  assertNoSecrets(state);
  const odd = harness({ rpc: { wazzup_api_key_provision_v1: () => ({ data: { ready: false }, error: null }) } });
  assert.equal(await odd.run(["set-key"]), 1);
  assert.equal(odd.state.prints[0].error, "key_not_stored");
  const noBackend = harness({ env: environment({ EVO_PLATFORM_SUPABASE_SECRET_KEY: undefined }) });
  assert.equal(await noBackend.run(["set-key"]), 1);
  assert.equal(noBackend.state.prints[0].error, "backend_not_configured");
});

// ---------------------------------------------------------------- channels

test("channels: the key comes from the Vault; the output has the channel id, the type, the last four digits and the state - never the number", async () => {
  const { run, state } = harness();
  assert.equal(await run(["channels"]), 0);
  assert.deepEqual(state.wazzupKeys, [SYNTH_KEY]);
  assert.deepEqual(state.prints, [{ ok: true, command: "channels", channels: [{ channelId: CHANNEL_ID, transport: "whatsapp", last4: "1234", state: "active" }] }]);
  assertNoSecrets(state);
  const none = harness({ rpc: { wazzup_api_key_resolve_v1: () => ({ data: { ready: false, reasonCode: "missing_binding" }, error: null }) } });
  assert.equal(await none.run(["channels"]), 1);
  assert.deepEqual(none.state.prints, [{ ok: false, error: "key_unavailable", reason: "missing_binding" }]);
  assert.equal(none.state.wazzupKeys.length, 0);
});

// ---------------------------------------------------------------- webhooks-get / webhooks-patch

test("webhooks-get: says whether the address is free, ours (with which token) or someone else's, and shows the subscriptions", async () => {
  const free = harness();
  assert.equal(await free.run(["webhooks-get"]), 0);
  assert.deepEqual(free.state.prints[0].address, { state: "empty" });
  const ours = harness({ webhooks: { webhooksUri: WEBHOOK_URI(NEXT_TOKEN), subscriptions: { ...ON } }, env: environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT: NEXT_TOKEN }) });
  assert.equal(await ours.run(["webhooks-get"]), 0);
  assert.deepEqual(ours.state.prints[0].address, { state: "ours", host: "crm.evoadmissions.com", path: "/api/v2/whatsapp/wazzup/inbound", token: "next" });
  assert.deepEqual(ours.state.prints[0].subscriptions, ON);
  assertNoSecrets(ours.state);
  const foreign = harness({ webhooks: { webhooksUri: "https://hooks.example.test/in/SECRET?k=SECRET2", subscriptions: { ...ON } } });
  assert.equal(await foreign.run(["webhooks-get"]), 0);
  assert.deepEqual(foreign.state.prints[0].address, { state: "other", host: "hooks.example.test" });
  assert.ok(!output(foreign.state).includes("SECRET"));
});

test("webhooks-patch --on: sends our address with the token from the process environment and exactly the right subscriptions, then re-reads and says so", async () => {
  const { run, state } = harness();
  assert.equal(await run(["webhooks-patch", "--on"]), 0);
  assert.deepEqual(state.patches, [{ webhooksUri: WEBHOOK_URI(HOOK_TOKEN), subscriptions: ON }]);
  assert.equal(state.patches[0].webhooksUri.length, 131);
  assert.deepEqual(state.prints, [{
    ok: true,
    command: "webhooks-patch",
    mode: "on",
    address: { state: "ours", host: "crm.evoadmissions.com", path: "/api/v2/whatsapp/wazzup/inbound", token: "current" },
    subscriptions: ON,
    verified: true,
  }]);
  assertNoSecrets(state);
  assert.ok(!output(state).includes("token="), "not even the query is printed");
});

test("webhooks-patch --on --token next uses the rotation token; a missing or malformed token stops before Wazzup is touched", async () => {
  const rotation = harness({ env: environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT: NEXT_TOKEN }), webhooks: { webhooksUri: WEBHOOK_URI(HOOK_TOKEN), subscriptions: { ...ON } } });
  assert.equal(await rotation.run(["webhooks-patch", "--on", "--token", "next"]), 0);
  assert.equal(rotation.state.patches[0].webhooksUri, WEBHOOK_URI(NEXT_TOKEN));
  assert.equal(rotation.state.prints[0].address.token, "next");
  assertNoSecrets(rotation.state);
  for (const [env, argv] of [
    [environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: undefined }), ["webhooks-patch", "--on"]],
    [environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: "short" }), ["webhooks-patch", "--on"]],
    [environment(), ["webhooks-patch", "--on", "--token", "next"]],
  ]) {
    const { run, state } = harness({ env });
    assert.equal(await run(argv), 1);
    assert.equal(state.prints[0].error, "token_unavailable");
    assert.equal(state.patches.length, 0);
    assert.equal(state.wazzupKeys.length, 0, "no key read for nothing");
  }
});

test("webhooks-patch: an address held by someone else is never overwritten - stop and ask the owner", async () => {
  for (const mode of ["--on", "--off"]) {
    const { run, state } = harness({ webhooks: { webhooksUri: "https://hooks.example.test/in/SECRET", subscriptions: { ...ON } } });
    assert.equal(await run(["webhooks-patch", mode]), 1);
    assert.equal(state.prints[0].error, "address_occupied");
    assert.deepEqual(state.prints[0].address, { state: "other", host: "hooks.example.test" });
    assert.equal(state.patches.length, 0);
    assert.ok(!output(state).includes("SECRET"));
  }
  const broken = harness({ webhooks: { webhooksUri: "not a url", subscriptions: { ...OFF } } });
  assert.equal(await broken.run(["webhooks-patch", "--on"]), 1);
  assert.equal(broken.state.patches.length, 0);
});

test("webhooks-patch --off: needs our own address, keeps it, and turns every subscription off", async () => {
  const { run, state } = harness({ webhooks: { webhooksUri: WEBHOOK_URI(HOOK_TOKEN), subscriptions: { ...ON } } });
  assert.equal(await run(["webhooks-patch", "--off"]), 0);
  assert.deepEqual(state.patches, [{ webhooksUri: WEBHOOK_URI(HOOK_TOKEN), subscriptions: OFF }]);
  assert.equal(state.prints[0].mode, "off");
  assert.equal(state.prints[0].verified, true);
  assertNoSecrets(state);
  const empty = harness();
  assert.equal(await empty.run(["webhooks-patch", "--off"]), 1);
  assert.equal(empty.state.prints[0].error, "address_not_ours");
  assert.equal(empty.state.patches.length, 0);
});

test("webhooks-patch: Wazzup's refusal (the test POST did not get 200) is reported by its code and status, without the address", async () => {
  const { run, state } = harness({ patchError: new WazzupApiError("bad_request", { status: 400, code: "testPostNotPassed", testStatus: 401 }) });
  assert.equal(await run(["webhooks-patch", "--on"]), 1);
  assert.deepEqual(state.prints, [{ ok: false, error: "wazzup_rejected", wazzup: "testPostNotPassed", testStatus: 401 }]);
  assertNoSecrets(state);
  const server = harness({ patchError: new WazzupApiError("server", { status: 500 }) });
  assert.equal(await server.run(["webhooks-patch", "--on"]), 1);
  assert.deepEqual(server.state.prints, [{ ok: false, error: "wazzup_rejected", wazzup: "server" }]);
});

test("webhooks-patch: exactly one of --on / --off; unknown flags and repeated flags are usage errors", async () => {
  for (const argv of [["webhooks-patch"], ["webhooks-patch", "--on", "--off"], ["webhooks-patch", "--on", "--on"], ["webhooks-patch", "--on", "--force"], ["webhooks-patch", "--on", "--token"], ["webhooks-patch", "--on", "--token", "later"], ["webhooks-patch", "--on", "extra"]]) {
    const { run, state } = harness();
    assert.equal(await run(argv), 2, argv.join(" "));
    assert.equal(state.patches.length, 0);
  }
});

// ---------------------------------------------------------------- bind-channel

test("bind-channel: without the owner's last four digits nothing is bound; the candidate is shown by id, type and last four only", async () => {
  const { run, state } = harness();
  assert.equal(await run(["bind-channel", CHANNEL_ID]), 2);
  assert.deepEqual(state.prints, [{
    ok: false,
    error: "confirmation_required",
    channel: { channelId: CHANNEL_ID, transport: "whatsapp", last4: "1234", state: "active" },
    hint: "repeat with --confirm-last4 <four digits the owner named>",
  }]);
  assert.equal(state.rpcCalls.filter((call) => call.fn === "wazzup_channel_bind_v1").length, 0);
  assertNoSecrets(state);
});

test("bind-channel: the confirmed last four digits bind the channel with the number's SHA-256 and never the number", async () => {
  const { run, state } = harness({
    rpc: { wazzup_channel_bind_v1: () => ({ data: { channelId: CHANNEL_ID, transport: "whatsapp", last4: "1234", replayed: false }, error: null }) },
  });
  assert.equal(await run(["bind-channel", CHANNEL_ID.toUpperCase(), "--confirm-last4", "1234"]), 0);
  const bind = state.rpcCalls.find((call) => call.fn === "wazzup_channel_bind_v1");
  assert.deepEqual({ ...bind.args, p_request_id: "x" }, {
    p_organization_id: ORGANIZATION_ID,
    p_channel_id: CHANNEL_ID,
    p_transport: "whatsapp",
    p_phone_last4: "1234",
    p_phone_sha256: sha256(PLAIN_ID),
    p_request_id: "x",
  });
  assert.match(bind.args.p_request_id, /^[0-9a-f-]{36}$/u);
  assert.ok(!JSON.stringify(bind.args).includes(PLAIN_ID), "the number itself does not go to the database");
  assert.deepEqual(state.prints, [{ ok: true, command: "bind-channel", channel: { channelId: CHANNEL_ID, transport: "whatsapp", last4: "1234", state: "active" }, replayed: false }]);
  assertNoSecrets(state);
});

test("bind-channel: a wrong confirmation, an unknown channel, another messenger and bad arguments bind nothing", async () => {
  const cases = [
    [["bind-channel", CHANNEL_ID, "--confirm-last4", "9999"], 1, "last4_mismatch", {}],
    [["bind-channel", OTHER_CHANNEL_ID, "--confirm-last4", "1234"], 1, "channel_not_found", {}],
    [["bind-channel", CHANNEL_ID, "--confirm-last4", "1234"], 1, "channel_transport_unsupported", { channels: [{ channelId: CHANNEL_ID, transport: "tgapi", plainId: PLAIN_ID, state: "active" }] }],
    [["bind-channel", CHANNEL_ID, "--confirm-last4", "1234"], 1, "channel_number_unreadable", { channels: [{ channelId: CHANNEL_ID, transport: "whatsapp", plainId: "synthetic_user", state: "active" }] }],
    [["bind-channel"], 2, "channel_id_required", {}],
    [["bind-channel", "not-a-uuid"], 2, "channel_id_invalid", {}],
    [["bind-channel", CHANNEL_ID, "--confirm-last4", "12"], 2, "flag_value_invalid", {}],
    [["bind-channel", CHANNEL_ID, OTHER_CHANNEL_ID], 2, "channel_id_required", {}],
  ];
  for (const [argv, code, error, options] of cases) {
    const { run, state } = harness(options);
    assert.equal(await run(argv), code, error);
    assert.equal(state.prints[0].error, error);
    assert.equal(state.rpcCalls.filter((call) => call.fn === "wazzup_channel_bind_v1").length, 0, error);
    assertNoSecrets(state);
  }
  const taken = harness({ rpc: { wazzup_channel_bind_v1: () => ({ data: null, error: { code: "55000", message: "wazzup_channel_already_bound" } }) } });
  assert.equal(await taken.run(["bind-channel", CHANNEL_ID, "--confirm-last4", "1234"]), 1);
  assert.deepEqual(taken.state.prints, [{ ok: false, error: "bind_failed", reason: "wazzup_channel_already_bound" }]);
});

// ---------------------------------------------------------------- transport

test("transport: passes the path and the switches through; an omitted switch is left as it is", async () => {
  const configure = (transport) => ({ data: { transport, aiTriggerEnabled: false, geminiEnabled: false, sendEnabled: false, version: 4, closedAlerts: 2, replayed: false }, error: null });
  const run = async (argv, answer = "wazzup") => {
    const h = harness({ rpc: { whatsapp_transport_configure_v1: () => configure(answer) } });
    const code = await h.run(argv);
    return { code, call: h.state.rpcCalls.find((item) => item.fn === "whatsapp_transport_configure_v1"), prints: h.state.prints };
  };
  const first = await run(["transport", "wazzup", "--ai-trigger", "off"]);
  assert.equal(first.code, 0);
  assert.deepEqual({ ...first.call.args, p_request_id: "x" }, { p_organization_id: ORGANIZATION_ID, p_transport: "wazzup", p_ai_trigger: false, p_gemini: null, p_request_id: "x" });
  assert.deepEqual(first.prints, [{ ok: true, command: "transport", transport: "wazzup", aiTriggerEnabled: false, geminiEnabled: false, sendEnabled: false, version: 4, closedAlerts: 2 }]);
  assert.equal((await run(["transport", "wazzup", "--ai-trigger", "on"])).call.args.p_ai_trigger, true);
  const plain = await run(["transport", "none"], "none");
  assert.deepEqual({ p_ai_trigger: plain.call.args.p_ai_trigger, p_gemini: plain.call.args.p_gemini, p_transport: plain.call.args.p_transport }, { p_ai_trigger: null, p_gemini: null, p_transport: "none" });
  assert.equal((await run(["transport", "waha"], "waha")).call.args.p_transport, "waha");
});

test("transport: Gemini for Wazzup chats needs the owner's explicit approval flag; turning it off does not", async () => {
  const configure = () => ({ data: { transport: "wazzup", aiTriggerEnabled: false, geminiEnabled: true, sendEnabled: false, version: 5, closedAlerts: 0 }, error: null });
  const without = harness({ rpc: { whatsapp_transport_configure_v1: configure } });
  assert.equal(await without.run(["transport", "wazzup", "--gemini", "on"]), 2);
  assert.equal(without.state.prints[0].error, "owner_approval_required");
  assert.equal(without.state.rpcCalls.filter((call) => call.fn === "whatsapp_transport_configure_v1").length, 0);
  const approved = harness({ rpc: { whatsapp_transport_configure_v1: configure } });
  assert.equal(await approved.run(["transport", "wazzup", "--gemini", "on", "--owner-approved"]), 0);
  assert.equal(approved.state.rpcCalls.find((call) => call.fn === "whatsapp_transport_configure_v1").args.p_gemini, true);
  const off = harness({ rpc: { whatsapp_transport_configure_v1: configure } });
  assert.equal(await off.run(["transport", "wazzup", "--gemini", "off"]), 0);
  assert.equal(off.state.rpcCalls.find((call) => call.fn === "whatsapp_transport_configure_v1").args.p_gemini, false);
  // The approval flag alone, or with Gemini off, means nothing and is refused rather than ignored.
  for (const argv of [["transport", "wazzup", "--owner-approved"], ["transport", "wazzup", "--gemini", "off", "--owner-approved"]]) {
    const { run, state } = harness();
    assert.equal(await run(argv), 2);
    assert.equal(state.rpcCalls.length, 0);
  }
});

test("transport: bad values are usage errors; a database refusal is reported by a fixed word", async () => {
  for (const argv of [["transport"], ["transport", "telegram"], ["transport", "wazzup", "--ai-trigger", "maybe"], ["transport", "wazzup", "--ai-trigger"], ["transport", "wazzup", "none"], ["transport", "wazzup", "--unknown", "on"]]) {
    const { run, state } = harness();
    assert.equal(await run(argv), 2, argv.join(" "));
    assert.equal(state.rpcCalls.length, 0);
  }
  const noChannel = harness({ rpc: { whatsapp_transport_configure_v1: () => ({ data: null, error: { code: "55000", message: "wazzup_channel_missing" } }) } });
  assert.equal(await noChannel.run(["transport", "wazzup"]), 1);
  assert.deepEqual(noChannel.state.prints, [{ ok: false, error: "transport_not_changed", reason: "wazzup_channel_missing" }]);
  const other = harness({ rpc: { whatsapp_transport_configure_v1: () => ({ data: null, error: { code: "XX000", message: `secret ${SECRET_KEY}` } }) } });
  assert.equal(await other.run(["transport", "none"]), 1);
  assert.deepEqual(other.state.prints, [{ ok: false, error: "transport_not_changed", reason: "database_error" }]);
  assertNoSecrets(other.state);
});

// ---------------------------------------------------------------- replay

const EVENT_1 = "77700000-0000-4000-8000-0000000000e1";
const EVENT_2 = "77700000-0000-4000-8000-0000000000e2";
const EVENT_3 = "77700000-0000-4000-8000-0000000000e3";
const EVENT_4 = "77700000-0000-4000-8000-0000000000e4";
const eventsAnswer = (events, missing = 0) => ({ data: { events, missing }, error: null });
const storedMessage = (eventId, element, eventType = "message") => ({ eventId, eventType, kind: "message", element });
const PRIVATE_ELEMENT = { messageId: "msg-1", text: "synthetic private text", chatId: PLAIN_ID, channelId: CHANNEL_ID, isEcho: false };

test("replay: the stored events come from the database by id; they are posted to the loopback with the right Host, the token only in the request path, and only counters are printed", async () => {
  const channelUpdate = { channelId: CHANNEL_ID, state: "active", timestamp: 5 };
  const { run, state } = harness({
    rpc: {
      whatsapp_intake_events_read_v1: () => eventsAnswer([
        storedMessage(EVENT_1, PRIVATE_ELEMENT),
        { eventId: EVENT_2, eventType: "channel.state", kind: "channel", element: channelUpdate },
        storedMessage(EVENT_3, { ...PRIVATE_ELEMENT, messageId: "msg-2", isEdited: true }, "message.edited"),
      ]),
    },
    local: { status: 200, body: JSON.stringify({ ok: true, stored: 0, deduplicated: 3, unparsed: 0, filtered: 0, failed: 0, projected: 0, deferred: 0 }) },
  });
  assert.equal(await run(["replay", EVENT_1.toUpperCase(), EVENT_2, EVENT_3, EVENT_1]), 0);
  // The database is asked once, with the lower-cased ids, each once, and only this organization.
  const reads = state.rpcCalls.filter((call) => call.fn === "whatsapp_intake_events_read_v1");
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].args, { p_organization_id: ORGANIZATION_ID, p_event_ids: [EVENT_1, EVENT_2, EVENT_3] });
  assert.equal(state.local.length, 1);
  const [request] = state.local;
  assert.equal(request.path, `/api/v2/whatsapp/wazzup/inbound?token=${HOOK_TOKEN}`);
  assert.equal(request.headers.host, "crm.evoadmissions.com");
  assert.equal(request.headers["content-type"], "application/json");
  assert.equal(request.headers["x-evo-wazzup-ip"], "127.0.0.1");
  assert.equal(request.headers["content-length"], String(Buffer.byteLength(request.body)));
  assert.deepEqual(JSON.parse(request.body), {
    messages: [PRIVATE_ELEMENT, { ...PRIVATE_ELEMENT, messageId: "msg-2", isEdited: true }],
    channelsUpdates: [channelUpdate],
  });
  assert.deepEqual(state.prints, [{
    ok: true, command: "replay", status: 200, events: 3, missing: 0, unrepeatable: 0, requests: 1,
    result: { ok: true, stored: 0, deduplicated: 3, unparsed: 0, filtered: 0, failed: 0, projected: 0, deferred: 0 },
  }]);
  assertNoSecrets(state, ["synthetic private text", "msg-1", "msg-2", EVENT_1, CHANNEL_ID]);
});

test("replay: the id list is the only input - no stdin batch is read, no stdin reader exists, and a hand-made batch cannot be injected", async () => {
  const { deps, run, state } = harness({ rpc: { whatsapp_intake_events_read_v1: () => eventsAnswer([storedMessage(EVENT_1, PRIVATE_ELEMENT)]) } });
  assert.equal("readBatch" in deps, false, "the stdin batch reader is gone");
  assert.equal(await run(["replay", EVENT_1]), 0);
  assert.equal(state.secretReads, 0);
  // With no ids there is nothing to do - no stdin fallback.
  const bare = harness();
  assert.equal(await bare.run(["replay"]), 2);
  assert.equal(bare.state.prints[0].error, "event_ids_required");
  assert.equal(bare.state.rpcCalls.length, 0);
  assert.equal(bare.state.local.length, 0);
  // The post body is built from what the database returned, never from anything the caller typed.
  for (const flag of ["--batch", "--stdin", "--file"]) {
    const other = harness();
    assert.equal(await other.run(["replay", EVENT_1, flag, "x"]), 2, flag);
    assert.equal(other.state.prints[0].error, "unknown_flag");
    assert.equal(other.state.rpcCalls.length, 0);
  }
});

test("replay: --token next posts with the rotation token; a non-200 answer is a failure and stops the rest; unreadable answers print only the status", async () => {
  const read = { whatsapp_intake_events_read_v1: () => eventsAnswer([storedMessage(EVENT_1, PRIVATE_ELEMENT)]) };
  const rotation = harness({ env: environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT: NEXT_TOKEN }), rpc: read });
  assert.equal(await rotation.run(["replay", EVENT_1, "--token", "next"]), 0);
  assert.ok(rotation.state.local[0].path.endsWith(`token=${NEXT_TOKEN}`));
  assertNoSecrets(rotation.state);

  const refused = harness({ rpc: read, local: { status: 503, body: JSON.stringify({ error: "transport_inactive" }) } });
  assert.equal(await refused.run(["replay", EVENT_1]), 1);
  assert.deepEqual(refused.state.prints, [{ ok: false, command: "replay", status: 503, events: 1, missing: 0, unrepeatable: 0, requests: 1, result: { error: "transport_inactive" } }]);

  const html = harness({ rpc: read, local: { status: 502, body: `<html>${HOOK_TOKEN}</html>` } });
  assert.equal(await html.run(["replay", EVENT_1]), 1);
  assert.deepEqual(html.state.prints, [{ ok: false, command: "replay", status: 502, events: 1, missing: 0, unrepeatable: 0, requests: 1, result: {} }]);
  assertNoSecrets(html.state);
});

test("replay: unrepeatable (unparsed) and missing events are counted and left out; nothing to send is a refusal without a POST", async () => {
  const mixed = harness({
    rpc: {
      whatsapp_intake_events_read_v1: () => eventsAnswer([
        storedMessage(EVENT_1, PRIVATE_ELEMENT),
        { eventId: EVENT_2, eventType: "unparsed", kind: null, element: null },
      ], 2),
    },
  });
  assert.equal(await mixed.run(["replay", EVENT_1, EVENT_2, EVENT_3, EVENT_4]), 0);
  assert.equal(mixed.state.local.length, 1);
  assert.deepEqual(JSON.parse(mixed.state.local[0].body), { messages: [PRIVATE_ELEMENT] });
  assert.equal(mixed.state.prints[0].events, 1);
  assert.equal(mixed.state.prints[0].missing, 2);
  assert.equal(mixed.state.prints[0].unrepeatable, 1);

  const none = harness({ rpc: { whatsapp_intake_events_read_v1: () => eventsAnswer([{ eventId: EVENT_2, eventType: "unparsed", kind: null, element: null }], 1) } });
  assert.equal(await none.run(["replay", EVENT_2, EVENT_3]), 1);
  assert.deepEqual(none.state.prints, [{ ok: false, error: "no_events_to_replay", events: 0, missing: 1, unrepeatable: 1 }]);
  assert.equal(none.state.local.length, 0);

  const nothing = harness({ rpc: { whatsapp_intake_events_read_v1: () => eventsAnswer([], 1) } });
  assert.equal(await nothing.run(["replay", EVENT_3]), 1);
  assert.equal(nothing.state.prints[0].error, "no_events_to_replay");
  assert.equal(nothing.state.local.length, 0);
});

test("replay: many events go in POSTs of at most 50 elements and the answers are added up; the first refusal stops the rest", async () => {
  const many = Array.from({ length: 120 }, (_, index) => storedMessage(`77700000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, { ...PRIVATE_ELEMENT, messageId: `msg-${index}` }));
  const ids = many.map((item) => item.eventId);
  const { run, state } = harness({
    rpc: { whatsapp_intake_events_read_v1: () => eventsAnswer(many.slice(0, 100)) },
    local: { status: 200, body: JSON.stringify({ ok: true, stored: 0, deduplicated: 50, failed: 0 }) },
  });
  assert.equal(await run(["replay", ...ids.slice(0, 100)]), 0);
  assert.deepEqual(state.local.map((request) => JSON.parse(request.body).messages.length), [50, 50]);
  assert.deepEqual(state.prints[0].result, { ok: true, stored: 0, deduplicated: 100, failed: 0 });
  assert.equal(state.prints[0].requests, 2);
  // More than 100 ids: a usage error before anything is asked.
  const over = harness();
  assert.equal(await over.run(["replay", ...ids]), 2);
  assert.equal(over.state.prints[0].error, "too_many_event_ids");
  assert.equal(over.state.rpcCalls.length, 0);
  // The first refusal stops the next POST.
  const answers = [{ status: 200, body: JSON.stringify({ ok: true, deduplicated: 50 }) }, { status: 503, body: JSON.stringify({ error: "wazzup_webhook_unavailable" }) }];
  let call = 0;
  const flaky = harness({ rpc: { whatsapp_intake_events_read_v1: () => eventsAnswer(many.slice(0, 100)) } });
  flaky.deps.postLocal = async (request) => { flaky.state.local.push(request); return answers[call++] ?? answers[1]; };
  assert.equal(await flaky.run(["replay", ...ids.slice(0, 100)]), 1);
  assert.equal(flaky.state.local.length, 2);
  assert.equal(flaky.state.prints[0].status, 503);
  assert.equal(flaky.state.prints[0].ok, false);
});

test("replay: bad ids, a missing token and a database that cannot answer all stop before any POST; the ids are never echoed", async () => {
  for (const bad of ["not-a-uuid", "77700000-0000-4000-8000-0000000000e", `${EVENT_1}0`, HOOK_TOKEN, "' OR 1=1 --"]) {
    const { run, state } = harness();
    assert.equal(await run(["replay", EVENT_1, bad]), 2, bad);
    assert.equal(state.prints[0].error, "event_id_invalid");
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.local.length, 0);
    assert.ok(!output(state).includes(bad), "a bad argument is not echoed");
  }
  const noToken = harness({ env: environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN: undefined }) });
  assert.equal(await noToken.run(["replay", EVENT_1]), 1);
  assert.equal(noToken.state.prints[0].error, "token_unavailable");
  assert.equal(noToken.state.rpcCalls.length, 0, "no token, no database read either");
  assert.equal(noToken.state.local.length, 0);

  for (const rpcAnswer of [
    () => ({ data: null, error: { message: "boom", code: "XX000" } }),
    () => ({ data: { events: "nope", missing: 0 }, error: null }),
    () => ({ data: { events: [], missing: "x" }, error: null }),
    () => ({ data: { events: [null], missing: 0 }, error: null }),
  ]) {
    const down = harness({ rpc: { whatsapp_intake_events_read_v1: rpcAnswer } });
    assert.equal(await down.run(["replay", EVENT_1]), 1);
    assert.equal(down.state.prints[0].error, "events_not_read");
    assert.equal(down.state.local.length, 0);
    assertNoSecrets(down.state);
  }
});

// ---------------------------------------------------------------- the whole surface

test("across every command nothing printed ever contains the key, the tokens, the service key or the full number", async () => {
  const env = environment({ EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT: NEXT_TOKEN });
  const rpc = {
    wazzup_api_key_provision_v1: () => ({ data: { ready: true, apiKeySha256: sha256(SYNTH_KEY), changed: false }, error: null }),
    wazzup_channel_bind_v1: () => ({ data: { channelId: CHANNEL_ID, replayed: true }, error: null }),
    whatsapp_transport_configure_v1: () => ({ data: { transport: "wazzup", aiTriggerEnabled: true, geminiEnabled: false, sendEnabled: false, version: 2, closedAlerts: 0 }, error: null }),
    whatsapp_intake_events_read_v1: () => eventsAnswer([storedMessage(EVENT_1, PRIVATE_ELEMENT)]),
  };
  const all = [
    ["set-key"], ["channels"], ["webhooks-get"], ["webhooks-patch", "--on"], ["webhooks-patch", "--off", "--token", "next"],
    ["bind-channel", CHANNEL_ID], ["bind-channel", CHANNEL_ID, "--confirm-last4", "1234"], ["transport", "wazzup", "--ai-trigger", "on"], ["replay", EVENT_1],
  ];
  for (const argv of all) {
    const { run, state } = harness({ env, rpc, webhooks: { webhooksUri: WEBHOOK_URI(HOOK_TOKEN), subscriptions: { ...ON } } });
    await run(argv);
    assertNoSecrets(state, ["synthetic private text", "msg-1"]);
    for (const line of state.prints) assert.ok(typeof line.ok === "boolean" && Object.values(line).every((value) => value === null || ["string", "number", "boolean", "object"].includes(typeof value)));
  }
  // Failure paths as well: every thrown error is turned into a fixed word.
  const exploding = harness({ listError: new TypeError(`fetch failed for ${WEBHOOK_URI(HOOK_TOKEN)} with ${SYNTH_KEY}`) });
  assert.equal(await exploding.run(["channels"]), 1);
  assert.deepEqual(exploding.state.prints, [{ ok: false, error: "unexpected_error" }]);
  assertNoSecrets(exploding.state);
});

// ---------------------------------------------------------------- the real stdin readers

function runModule(code, input) {
  return spawnSync(
    process.execPath,
    ["--conditions=react-server", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code],
    { input, encoding: "utf8", cwd: new URL("..", import.meta.url).pathname },
  );
}

test("the stdin reader: a piped key loses exactly one trailing newline and an absurdly long one is refused", () => {
  const read = `
    const { defaultWazzupOpsDependencies } = await import("./src/lib/server/platform-wazzup-ops.ts");
    const deps = defaultWazzupOpsDependencies();
    const value = await deps.readSecret();
    process.stdout.write(JSON.stringify({ value }));
  `;
  assert.deepEqual(JSON.parse(runModule(read, "piped-key-value\n").stdout), { value: "piped-key-value" });
  assert.deepEqual(JSON.parse(runModule(read, "piped-key-value\r\n").stdout), { value: "piped-key-value" });
  assert.deepEqual(JSON.parse(runModule(read, "piped-key-value").stdout), { value: "piped-key-value" });
  assert.deepEqual(JSON.parse(runModule(read, "piped-key-value\n\n").stdout), { value: "piped-key-value\n" }, "only one newline is dropped");
  const tooLong = runModule(read, "k".repeat(9000));
  assert.notEqual(tooLong.status, 0, "an absurdly long stdin is refused");
  assert.ok(!tooLong.stderr.includes("kkkkkkkk") || tooLong.stderr.length < 4000);
});
