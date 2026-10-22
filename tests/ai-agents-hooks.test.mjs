// «ИИ-агенты»: хуки приёма — заявка сайта и входящее WhatsApp запускают включённых агентов ПОСЛЕ
// ответа и никогда не меняют сам ответ (docs/design/ai-agents/contract.md §C.4). Настоящие
// `receiveWebsiteLead` и обработчик вебхука WAHA; база — локальный HTTP-приёмник вместо PostgREST,
// Claude API — подставной fetch на адрес api.anthropic.com. Живого Claude, WhatsApp и боевой базы нет.
//
// node --conditions=react-server --experimental-strip-types --test tests/ai-agents-hooks.test.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";

import { createPlatformWahaWebhookHandler } from "../src/lib/server/platform-waha-webhook.ts";
import { receiveWebsiteLead } from "../src/lib/server/website-lead-intake.ts";

const ORG = "77100000-0000-4000-8000-000000000001";
const KEY = "k".repeat(43);
const REQUEST_ID = "11111111-2222-4333-8444-555555555555";
const RUN = "77777777-7777-4777-8777-777777777777";
const WEBHOOK_SECRET = "waha-webhook-secret-material-123456";
const TARGET = {
  key: "sales", title: "Продажи (Closer)", model: "claude-sonnet-5-5", claudeAgentId: "agent_01HqR2k7vXbZ9mNpL3wYcT8f", agentVersion: 3,
  environmentId: "env_01595EKxaaTTGwwY3kyXdtbs", vaultId: "vlt_01ABC", runBudgetUsd: 5, autoSend: false,
};

const dbCalls = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const name = request.url.replace("/rest/v1/rpc/", "");
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    dbCalls.push({ name, body });
    const answers = {
      receive_website_lead: { status: "accepted", request_id: REQUEST_ID },
      ai_agent_runtime_dispatch_targets_v1: [TARGET],
      ai_agent_runtime_run_reserve_v1: { reserved: true, runId: RUN },
      ai_agent_runtime_run_update_v1: { ok: true },
    };
    response.writeHead(name in answers ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(answers[name] ?? { message: "unexpected" }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
Object.assign(process.env, {
  EVO_ANTHROPIC_API_KEY: "sk-ant-test-0000000000000000000000",
  EVO_WEBSITE_INTAKE_EDGE_KEY: KEY,
  EVO_PLATFORM_ORGANIZATION_ID: ORG,
  EVO_WEBSITE_INTAKE_OWNER_MEMBERSHIP_ID: "ffffffff-0000-4111-8222-333333333333",
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`,
  EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_synthetic_test_key_000",
  EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1",
  EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: WEBHOOK_SECRET,
  EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: "77100000-0000-4000-8000-000000000401",
});

// Claude API: любой запрос на api.anthropic.com идёт в подставной обработчик, остальное — как есть.
const realFetch = globalThis.fetch;
const claudeCalls = [];
let claudeStatus = 200;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://api.anthropic.com/")) return realFetch(input, init);
  claudeCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
  return claudeStatus === 200
    ? new Response(JSON.stringify({ id: "sesn_hook", status: "running" }), { status: 200, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), { status: claudeStatus });
};
test.after(() => { globalThis.fetch = realFetch; server.close(); });

function reset() {
  dbCalls.length = 0;
  claudeCalls.length = 0;
  claudeStatus = 200;
}
async function waitFor(condition, ms = 3_000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LEAD = { requestId: REQUEST_ID, name: "Тест Синтетический", phone: "+996 555 000 000", age: 18, city: "Бишкек", country: "Malaysia", consent: true, website: "" };
function postLead(body) {
  return receiveWebsiteLead(new Request("https://crm.test/api/public/website-leads", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evoadmissions.com", "x-evo-website-key": KEY, "x-evo-website-ip": "203.0.113.7" },
    body: JSON.stringify(body),
  }));
}

test("заявка сайта принята — агент продаж запускается с id заявки, ответ приёма прежний", async () => {
  reset();
  const response = await postLead(LEAD);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "accepted", requestId: REQUEST_ID });
  assert.ok(await waitFor(() => claudeCalls.some((call) => call.url.endsWith("/v1/sessions"))), "сессия Claude создана");
  const session = claudeCalls.find((call) => call.url.endsWith("/v1/sessions")).body;
  assert.match(session.initial_events[0].content[0].text, new RegExp(REQUEST_ID, "u"));
  assert.ok(!JSON.stringify(session).includes("Тест Синтетический"), "имя заявителя агенту в событии не передаётся");
  assert.ok(!/996\s?555|\+996/u.test(JSON.stringify(session)), "телефон заявителя агенту в событии не передаётся");
  assert.ok(await waitFor(() => dbCalls.some((call) => call.name === "ai_agent_runtime_run_update_v1")));
  const reserve = dbCalls.find((call) => call.name === "ai_agent_runtime_run_reserve_v1").body;
  assert.deepEqual([reserve.p_trigger_kind, reserve.p_dedupe_key], ["website_lead", `wl:${REQUEST_ID}`]);
});

test("сбой Claude после приёма заявки не меняет ответ приёма", async () => {
  reset();
  claudeStatus = 500;
  const response = await postLead(LEAD);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "accepted", requestId: REQUEST_ID });
  assert.ok(await waitFor(() => dbCalls.some((call) => call.name === "ai_agent_runtime_run_update_v1" && call.body.p_patch.status === "failed")));
});

test("отклонённая заявка агентов не запускает", async () => {
  reset();
  const response = await postLead({ ...LEAD, consent: false });
  assert.equal(response.status, 400);
  await sleep(150);
  assert.equal(claudeCalls.length, 0);
  assert.equal(dbCalls.some((call) => call.name === "ai_agent_runtime_dispatch_targets_v1"), false);
});

// ---- WAHA: фикстура вебхука по образцу tests/platform-waha-webhook.test.mjs
function wahaRpc(calls) {
  return async (name, args) => {
    calls.push(name);
    const data = {
      persist_provider_webhook_event: { organization_id: ORG, provider_webhook_event_id: "77100000-0000-4000-8000-000000000101", event_type: "message.any", deduplicated: false, persisted_before_processing: true },
      enqueue_verified_webhook_work: { work_item_id: "77100000-0000-4000-8000-000000000201", state: "pending", deduplicated: false },
      claim_waha_webhook_work_item: {
        claimed: true, completed: false, requested_work_item_id: "77100000-0000-4000-8000-000000000201", organization_id: ORG,
        work_item_id: "77100000-0000-4000-8000-000000000201", attempt_id: "77100000-0000-4000-8000-000000000301",
        source_webhook_event_id: "77100000-0000-4000-8000-000000000101", kind: "provider_webhook_process", event_type: "message.any",
        queue: "platform_work_v1", queue_message_id: 91, attempt_number: 1, max_attempts: 8, lease_expires_at: "2026-09-02T10:00:00Z",
      },
      project_claimed_waha_event: {
        organization_id: ORG, work_item_id: "77100000-0000-4000-8000-000000000201", attempt_id: "77100000-0000-4000-8000-000000000301",
        disposition: "succeeded", evidence_ref: "waha-inbound-projected:77100000-0000-4000-8000-000000000101", error_code: null,
      },
      finish_waha_webhook_work: { organization_id: ORG, work_item_id: "77100000-0000-4000-8000-000000000201", attempt_id: "77100000-0000-4000-8000-000000000301", outcome: "succeeded", state: "succeeded" },
    }[name];
    if (!data) throw new Error(`Unexpected RPC: ${name} ${JSON.stringify(args).slice(0, 40)}`);
    return { data, error: null };
  };
}
function wahaRequest(body) {
  const rawBody = JSON.stringify(body);
  return new Request("http://localhost/api/v2/whatsapp/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-hmac": createHmac("sha512", WEBHOOK_SECRET).update(rawBody).digest("hex"),
      "x-webhook-hmac-algorithm": "sha512",
    },
    body: rawBody,
  });
}
const message = (fromMe, id) => ({
  id: `evt-${id}`, event: "message.any", session: "crm_primary", timestamp: 1_727_745_026,
  payload: { id: `${fromMe}_996999111222@c.us_${id}`, from: "996999111222@c.us", to: "996000000000@c.us", fromMe, body: "Hello EVO" },
});

test("входящее сообщение клиента в WhatsApp запускает агента продаж, ответ вебхука прежний", async () => {
  reset();
  const rpcCalls = [];
  const handler = createPlatformWahaWebhookHandler({ createServiceClient: () => ({ schema: () => ({ rpc: wahaRpc(rpcCalls) }) }) });
  const response = await handler(wahaRequest(message(false, "IN1")));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "projected", eventType: "message.any", deduplicated: false });
  assert.ok(await waitFor(() => claudeCalls.some((call) => call.url.endsWith("/v1/sessions"))));
  const session = claudeCalls.find((call) => call.url.endsWith("/v1/sessions")).body;
  assert.match(session.initial_events[0].content[0].text, /list_conversations/u);
  assert.ok(!JSON.stringify(session).includes("Hello EVO"), "текст сообщения клиента агенту в событии не передаётся");
  const reserve = dbCalls.find((call) => call.name === "ai_agent_runtime_run_reserve_v1").body;
  assert.equal(reserve.p_trigger_kind, "whatsapp_inbound");
  assert.match(reserve.p_dedupe_key, /^wa:\d+$/u);
});

test("свои исходящие и подтверждения доставки агентов не запускают", async () => {
  reset();
  const rpcCalls = [];
  const handler = createPlatformWahaWebhookHandler({ createServiceClient: () => ({ schema: () => ({ rpc: wahaRpc(rpcCalls) }) }) });
  const response = await handler(wahaRequest(message(true, "OUT1")));
  assert.equal(response.status, 202);
  await sleep(150);
  assert.equal(claudeCalls.length, 0);
  assert.equal(dbCalls.some((call) => call.name === "ai_agent_runtime_dispatch_targets_v1"), false);
});
