// What the application does so that nothing is ever sent to a customer while WhatsApp is connected through Wazzup
// (plan docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §0, §6 B.9, §8, §9): the 409 on the WAHA connect route, the `receive_only`
// refusal in every application send path, the second line of the double-receive ban, and the route contract. Fakes only: no
// WAHA, no Wazzup, no Supabase. Everything is synthetic. Run with:
// node --conditions=react-server --experimental-strip-types --test tests/platform-wazzup-refusals.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AI_AGENT_DRAFT_FAILURE_LABELS } from "../src/lib/ai-agents/contract.ts";
import { classifyManualSendRefusal, PlatformManualSendRefusedError, requestManualWhatsAppSendWithAuthorization } from "../src/lib/platform-provider-workflows.ts";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPrivateApi,
  isRetiredPlatformRoute,
} from "../src/lib/platform-route-contract.ts";
import { parsePlatformWhatsAppTransport, readPlatformWhatsAppTransport } from "../src/lib/platform-whatsapp-transport.ts";
import { AI_AUTOSEND_SEND_PATH, createAiAutosendSendHandler, signAiSendRequest } from "../src/lib/server/ai-agent-send.ts";
import { createWhatsAppConnectHandler } from "../src/lib/server/platform-waha-connect-route-handlers.ts";
import { createPlatformWahaWebhookHandler } from "../src/lib/server/platform-waha-webhook.ts";
import { runWhatsAppHealthMaintenance } from "../src/lib/server/platform-whatsapp-health-maintenance.ts";
import { isRefusal, SEND_REFUSAL_COPY } from "../src/lib/v3/whatsapp-chat.ts";
import { AI_AGENTS_DRAFT_FAILURE_WORDS, draftStatusWords } from "../src/lib/v3/ai-agents-view.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ORG = "77800000-0000-4000-8000-000000000001";
const ADMIN = { systemRole: "admin", presentationRole: null, organizationId: ORG, profileId: "p", membershipId: "m", permissionKeys: [], platformAccessVersion: 1 };

// ---------------------------------------------------------------- 409 on the WAHA connect route

function connectRoute({ transport, authorization = { status: "authorized", actor: ADMIN }, withTransport = true } = {}) {
  const calls = { perform: 0, transport: 0, authorize: 0 };
  const handle = createWhatsAppConnectHandler({
    authorize: async () => {
      calls.authorize += 1;
      return authorization;
    },
    perform: async () => {
      calls.perform += 1;
      return { status: "ok", session: "SCAN_QR_CODE", qr: null, code: null };
    },
    ...(withTransport
      ? {
          transport: async (actor) => {
            calls.transport += 1;
            assert.equal(actor, ADMIN);
            if (transport instanceof Error) throw transport;
            return transport;
          },
        }
      : {}),
  });
  const request = (body = { action: "connect" }) => new Request("https://crm.evoadmissions.com/api/v3/settings/whatsapp-connect", {
    method: "POST",
    headers: { origin: "https://crm.evoadmissions.com", host: "crm.evoadmissions.com", "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { handle, calls, request };
}

test("connect route: while Wazzup is the active path every action answers 409 transport_wazzup before the body, the limits or WAHA", async () => {
  for (const body of [{ action: "connect" }, { action: "status", withQr: true }, { action: "code", phone: "+14155550100" }, "{not even json", {}]) {
    const { handle, calls, request } = connectRoute({ transport: "wazzup" });
    const response = await handle(request(body));
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: { code: "transport_wazzup" } });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.perform, 0, "WAHA is never touched");
    assert.equal(calls.transport, 1);
  }
});

test("connect route: another path proceeds exactly as before; an unreadable path is closed (503) and also never reaches WAHA", async () => {
  const other = connectRoute({ transport: "other" });
  const ok = await other.handle(other.request());
  assert.equal(ok.status, 200);
  assert.equal(other.calls.perform, 1);

  for (const transport of ["unknown", new Error("database down")]) {
    const closed = connectRoute({ transport });
    const response = await closed.handle(closed.request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: "transport_check_failed" } });
    assert.equal(closed.calls.perform, 0);
  }
});

test("connect route: the sign-in rules still come first - a stranger learns nothing about the transport", async () => {
  for (const [authorization, status] of [
    [{ status: "anonymous", actor: null }, 401],
    [{ status: "forbidden", actor: null }, 403],
    [{ status: "preview", actor: null }, 403],
    [{ status: "unavailable", actor: null }, 503],
  ]) {
    const { handle, calls, request } = connectRoute({ transport: "wazzup", authorization });
    assert.equal((await handle(request())).status, status);
    assert.equal(calls.transport, 0, "the transport is not even read for someone who may not connect");
  }
  // A foreign Origin is refused before the session is looked at.
  const { handle, calls } = connectRoute({ transport: "wazzup" });
  const foreign = new Request("https://crm.evoadmissions.com/api/v3/settings/whatsapp-connect", {
    method: "POST",
    headers: { origin: "https://evil.example.test", host: "crm.evoadmissions.com", "content-type": "application/json" },
    body: '{"action":"connect"}',
  });
  assert.equal((await handle(foreign)).status, 403);
  assert.equal(calls.authorize, 0);
});

test("connect route: the production handler carries the transport check by default; a handler built without it behaves as before", async () => {
  assert.match(read("src/lib/server/platform-waha-connect-route-handlers.ts"), /const defaultDependencies[^;]*transport: defaultTransport,/su);
  const legacy = connectRoute({ withTransport: false });
  assert.equal((await legacy.handle(legacy.request())).status, 200);
  assert.equal(legacy.calls.perform, 1);
});

// ---------------------------------------------------------------- the transport reader

const validTransport = (overrides = {}) => ({
  activeTransport: "wazzup",
  canReply: false,
  replyMode: "receive_only",
  channel: { transport: "whatsapp", state: "active", observedAt: "2026-10-27T10:00:00.000+00:00" },
  lastInboundAt: "2026-10-27T10:05:00+00:00",
  ...overrides,
});

test("transport read: the exact answer of staff_whatsapp_transport_v1 is parsed; any other shape is null (closed by default)", () => {
  assert.deepEqual(parsePlatformWhatsAppTransport(validTransport()), validTransport());
  assert.deepEqual(parsePlatformWhatsAppTransport(validTransport({ channel: null, lastInboundAt: null })).channel, null);
  assert.equal(parsePlatformWhatsAppTransport({ activeTransport: "none", canReply: true, replyMode: "waha", channel: null, lastInboundAt: null }).activeTransport, "none");
  assert.equal(parsePlatformWhatsAppTransport({ activeTransport: "waha", canReply: true, replyMode: "waha", channel: null, lastInboundAt: null }).canReply, true);
  const bad = [
    null, [], "wazzup", {},
    { ...validTransport(), extra: 1 },
    validTransport({ activeTransport: "telegram" }),
    validTransport({ canReply: true }),
    validTransport({ replyMode: "waha" }),
    validTransport({ activeTransport: "waha", canReply: true, replyMode: "receive_only" }),
    validTransport({ channel: { transport: "whatsapp", state: "active" } }),
    validTransport({ channel: { transport: "instagram", state: "active", observedAt: null } }),
    validTransport({ channel: { transport: "whatsapp", state: "bad state!", observedAt: null } }),
    validTransport({ channel: { transport: "whatsapp", state: "active", observedAt: "yesterday" } }),
    validTransport({ lastInboundAt: "yesterday" }),
  ];
  for (const value of bad) assert.equal(parsePlatformWhatsAppTransport(value), null, JSON.stringify(value));
  const fields = Object.keys(parsePlatformWhatsAppTransport(validTransport()));
  assert.deepEqual(fields.sort(), ["activeTransport", "canReply", "channel", "lastInboundAt", "replyMode"]);
});

test("transport read: calls the staff function with the organization only; an error or a thrown client is null", async () => {
  const seen = [];
  const client = (answer) => ({ schema: (name) => ({ rpc: async (fn, args) => { seen.push({ name, fn, args }); if (answer instanceof Error) throw answer; return answer; } }) });
  const ok = await readPlatformWhatsAppTransport({ organizationId: ORG }, client({ data: validTransport(), error: null }));
  assert.equal(ok.activeTransport, "wazzup");
  assert.deepEqual(seen, [{ name: "platform", fn: "staff_whatsapp_transport_v1", args: { p_organization_id: ORG } }]);
  assert.equal(await readPlatformWhatsAppTransport({ organizationId: ORG }, client({ data: null, error: { code: "42501" } })), null);
  assert.equal(await readPlatformWhatsAppTransport({ organizationId: ORG }, client({ data: { weird: true }, error: null })), null);
  assert.equal(await readPlatformWhatsAppTransport({ organizationId: ORG }, client(new Error("down"))), null);
});

// ---------------------------------------------------------------- manual send

test("manual send: the database's receive_only refusal (55000) becomes a staff-readable refusal, never a generic failure", async () => {
  assert.equal(classifyManualSendRefusal({ code: "55000", message: "receive_only: WhatsApp is connected read-only; send from amoCRM or Wazzup" }), "receive_only");
  assert.equal(classifyManualSendRefusal({ code: "55000", message: "duplicate_of_unresolved x" }), "duplicate", "the other reasons are unchanged");
  assert.equal(classifyManualSendRefusal({ code: "XX000", message: "receive_only" }), null, "only the 55000 gate counts");
  const client = { schema: () => ({ rpc: async () => ({ data: null, error: { code: "55000", message: "receive_only: WhatsApp is connected read-only" } }) }) };
  const input = {
    organizationId: ORG, conversationId: "77800000-0000-4000-8000-000000000002", sourceMessageId: "77800000-0000-4000-8000-000000000003",
    aiDraftId: null, finalText: "Здравствуйте", reason: "staff_chat_reply", businessKeySha256: createHash("sha256").update("k").digest("hex"),
    requestId: "77800000-0000-4000-8000-000000000004",
  };
  await assert.rejects(
    () => requestManualWhatsAppSendWithAuthorization(client, input),
    (error) => error instanceof PlatformManualSendRefusedError && error.reason === "receive_only",
  );
});

test("manual send: the chat shows the refusal in words and hands the text back to the field", () => {
  assert.match(SEND_REFUSAL_COPY.receive_only, /только на чтение/u);
  assert.match(SEND_REFUSAL_COPY.receive_only, /amoCRM или Wazzup/u);
  assert.match(SEND_REFUSAL_COPY.receive_only, /Текст остался в поле/u);
  assert.equal(isRefusal("receive_only"), true, "no record on the server: the text may go back to the field");
  const action = read("src/lib/platform-provider-actions.ts");
  assert.match(action, /error\.reason/u, "the reason travels through refusalStatus unchanged");
});

// ---------------------------------------------------------------- AI drafts

test("drafts: the receive_only code has words in every table the screens read", () => {
  assert.match(AI_AGENT_DRAFT_FAILURE_LABELS.receive_only, /только на чтение/u);
  assert.match(AI_AGENTS_DRAFT_FAILURE_WORDS.receive_only, /только на чтение/u);
  const words = draftStatusWords({ status: "pending", failureCode: "receive_only", sentByAgent: false });
  assert.ok(words.label.length > 0);
});

// ---------------------------------------------------------------- the night autoresponder route

const DECISION = "77800000-abcd-4def-8abc-000000000001";
const SECRET = "a".repeat(24) + "-synthetic-autosend-send-secret";
const INTERNAL = "s".repeat(24) + "-synthetic-ai-agent-secret";
const NOW = Date.parse("2026-10-27T21:14:05Z");

test("autosend route: a receive_only refusal from the database is a 409 with that reason - no claim, no seen/typing/send at WAHA", async () => {
  const dbCalls = [];
  const providerCalls = [];
  const database = {
    schema: () => ({
      rpc: async (name, args) => {
        dbCalls.push({ name, args });
        if (name !== "ai_autosend_authorize_v1") throw new Error(`unexpected RPC ${name}`);
        return { data: { authorized: false, reason: "receive_only", reasonRu: "WhatsApp подключён только на чтение", decisionId: DECISION }, error: null };
      },
    }),
  };
  const handler = createAiAutosendSendHandler({
    env: () => ({ EVO_AI_AGENT_AUTOSEND: "1", EVO_AI_AGENT_SEND_SECRET: SECRET, EVO_AI_AGENT_INTERNAL_SECRET: INTERNAL }),
    organizationId: () => ORG,
    serviceClient: async () => database,
    probe: async () => "FAILED",
    createWahaProvider: () => new Proxy({}, { get: (_t, property) => () => { providerCalls.push(String(property)); throw new Error("WAHA must not be called"); } }),
    sleep: async () => undefined,
    now: () => NOW,
  });
  const body = JSON.stringify({ decisionId: DECISION });
  const timestamp = String(Math.floor(NOW / 1000));
  const worker = "evo-ai-agent-worker-1:7";
  const response = await handler(new Request(`http://evo-crm-app:3000${AI_AUTOSEND_SEND_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-EVO-AI-Timestamp": timestamp,
      "X-EVO-AI-Worker": worker,
      "X-EVO-AI-Signature": signAiSendRequest(SECRET, timestamp, "POST", AI_AUTOSEND_SEND_PATH, worker, body),
    },
    body,
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: { code: "refused", reason: "receive_only" } });
  assert.deepEqual(dbCalls.map((call) => call.name), ["ai_autosend_authorize_v1"], "no claim, no finish, no record");
  assert.equal(dbCalls[0].args.p_provider_status, "FAILED", "the probe word goes to the database, which decides");
  assert.deepEqual(providerCalls, []);
});

// ---------------------------------------------------------------- double receive ban

test("WAHA intake: with both receive switches on the WAHA route answers 503 transport_conflict before the body, the signature or the database", async () => {
  const saved = { waha: process.env.EVO_PLATFORM_WAHA_INGRESS_ENABLED, wazzup: process.env.EVO_PLATFORM_WAZZUP_INGRESS_ENABLED };
  try {
    process.env.EVO_PLATFORM_WAHA_INGRESS_ENABLED = "1";
    process.env.EVO_PLATFORM_WAZZUP_INGRESS_ENABLED = "1";
    const handler = createPlatformWahaWebhookHandler();
    let read = false;
    const body = new ReadableStream({ pull() { read = true; throw new Error("the body must not be read"); } }, { highWaterMark: 0 });
    const response = await handler(new Request("http://localhost/api/v2/whatsapp/inbound", { method: "POST", body, duplex: "half" }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: "transport_conflict" });
    assert.equal(read, false);
    // With only WAHA on, the answer is NOT the conflict (the ordinary checks run and refuse for their own reasons).
    process.env.EVO_PLATFORM_WAZZUP_INGRESS_ENABLED = "0";
    const ordinary = await handler(new Request("http://localhost/api/v2/whatsapp/inbound", { method: "POST", body: "{}" }));
    assert.notEqual((await ordinary.json()).error, "transport_conflict");
  } finally {
    for (const [name, value] of [["EVO_PLATFORM_WAHA_INGRESS_ENABLED", saved.waha], ["EVO_PLATFORM_WAZZUP_INGRESS_ENABLED", saved.wazzup]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("timer WAHA step: with both receive switches on it probes nothing and fails loudly; with WAHA off it is unchanged", async () => {
  let touched = false;
  const both = await runWhatsAppHealthMaintenance({
    environment: { EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1", EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: "1" },
    createServiceClient: () => { touched = true; throw new Error("must not be created"); },
    probe: async () => { touched = true; return "WORKING"; },
  });
  assert.deepEqual(both.log, { event: "whatsapp_health_maintenance", status: "failed", reason: "transport_conflict" });
  assert.equal(both.exitCode, 1);
  assert.equal(touched, false);
  const off = await runWhatsAppHealthMaintenance({ environment: { EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: "1" } });
  assert.deepEqual(off.log, { event: "whatsapp_health_maintenance", status: "disabled", reason: "ingress_off" });
  assert.equal(off.exitCode, 0);
});

// ---------------------------------------------------------------- route contract

test("route contract: the Wazzup webhook is one exact private service route; near misses stay out; the WAHA path is untouched", () => {
  const path = "/api/v2/whatsapp/wazzup/inbound";
  assert.equal(isConnectedPlatformPrivateApi(path), true);
  assert.equal(isConnectedPlatformApi(path), true);
  assert.equal(isRetiredPlatformRoute(path), false);
  for (const near of [`${path}/`, `${path}/child`, "/API/v2/whatsapp/wazzup/inbound", "/api/v2/whatsapp/wazzup", "/api/v2/whatsapp/wazzup/", `${path}.json`, "/api/v3/whatsapp/wazzup/inbound", "/api/internal/whatsapp/wazzup/inbound", "/api/v2/wazzup/inbound", `${path}%2f`]) {
    assert.equal(isConnectedPlatformPrivateApi(near), false, near);
    assert.equal(isConnectedPlatformApi(near), false, near);
  }
  assert.equal(isConnectedPlatformPrivateApi("/api/v2/whatsapp/inbound"), true);
  assert.equal(isConnectedPlatformApi("/api/v2/whatsapp/inbound/"), false);
});

test("the route file hands every method to one handler; the edge keeps the path public but the handler checks the host itself", () => {
  const route = read("src/app/api/v2/whatsapp/wazzup/inbound/route.ts");
  for (const method of ["POST", "GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.match(route, new RegExp(`export const ${method} = handler;`, "u"));
  assert.match(route, /export const runtime = "nodejs";/u);
  assert.match(route, /export const dynamic = "force-dynamic";/u);
  assert.match(route, /createPlatformWazzupInboundHandler\(\)/u);
});
