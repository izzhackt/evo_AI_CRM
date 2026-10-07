// «ИИ-агент» P1, срез 5 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §4.3, §6, §12):
// маршруты CRM — билет, подпись HMAC, поток SSE агента через CRM, сохранённый
// ответ, «Вставить в ответ» (409 — устарел); чистый контракт окна; маршрут,
// меню и права раздела; необязательное имя секрета в контракте env. Агент —
// поддельный HTTP-сервер этого теста (синтетические данные, ни одного
// вызова Google). Что сотрудник может прочитать и вставить, решает база:
// supabase/tests/platform_ai_agent_p1.sql и platform_ai_agent_answer_sources.sql.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import {
  AI_AGENT_SECTIONS,
  AI_ERROR_COPY,
  aiAgentHref,
  aiErrorBlocked,
  aiErrorRetryable,
  answerWarnings,
  createSseDecoder,
  documentStatus,
  formatUsd,
  normalizeAiAnswerView,
  normalizeAiDocuments,
  normalizeAiRules,
  normalizeAiSettings,
  normalizeAiSpend,
  parseAiAgentSection,
  parseAiStreamEvent,
  replySegments,
  sourcePlace,
  sourcesWord,
} from "../src/lib/v3/ai-agent.ts";
import {
  AI_AGENT_DEFAULT_URL,
  readAiAgentConfig,
  signAiAgentRequest,
} from "../src/lib/server/ai-agent-internal-auth.ts";
import {
  createAiAnswerInsertHandler,
  createAiAnswerReadHandler,
  createAiAnswerStreamHandler,
  readAiAgentStatus,
} from "../src/lib/server/ai-agent-route-handlers.ts";
import { isConnectedPlatformApi, isConnectedPlatformPage } from "../src/lib/platform-route-contract.ts";
import { staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
import { validateAppEnvironmentContract } from "../scripts/evo-app-env-contract.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = (n) => `27100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SECRET = "s".repeat(24) + "-synthetic-ai-agent-secret";
const TICKET = "a1".repeat(32);
const ACTOR = Object.freeze({ organizationId: ID(90), membershipId: ID(91) });

// ------------------------------------------------------------ fake agent

/** The agent's verification (evo-ai-agent `internal_auth.verify`), restated. */
function agentVerifies(request, body) {
  const ts = request.headers["x-evo-ai-timestamp"];
  const signature = request.headers["x-evo-ai-signature"];
  if (typeof ts !== "string" || typeof signature !== "string" || !/^\d{1,12}$/u.test(ts)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60) return false;
  const digest = createHash("sha256").update(body).digest("hex");
  const expected = createHmac("sha256", SECRET).update(`${ts}.${request.method}.${request.url}.${digest}`).digest("hex");
  return expected === signature;
}

async function fakeAgent(behaviour) {
  const seen = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const entry = { method: request.method, url: request.url, verified: agentVerifies(request, body), body: body.toString("utf8"), closed: false };
      seen.push(entry);
      response.on("close", () => { entry.closed = !response.writableFinished; });
      behaviour(entry, response);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    seen,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function deps(overrides = {}) {
  return {
    authorize: async () => ({ status: "authorized", actor: ACTOR }),
    config: () => ({ secret: SECRET, baseUrl: "http://127.0.0.1:9" }),
    issueTicket: async () => ({ status: "issued", ticket: TICKET }),
    readAnswer: async () => ({ answer: null, latestInboundMessageId: ID(5), lastMessageDirection: "inbound", consentRecorded: true }),
    insertAnswer: async () => ({ status: "inserted", text: "Готовый ответ" }),
    fetch: (...args) => fetch(...args),
    now: () => Date.now(),
    ...overrides,
  };
}

const origin = { origin: "https://crm.test", host: "crm.test" };
const post = (path, body, headers = {}) => new Request(`https://crm.test${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...origin, ...headers }, body: JSON.stringify(body),
});
const conversation = (id = ID(1)) => ({ params: Promise.resolve({ conversationId: id }) });
const answerContext = (id = ID(2)) => ({ params: Promise.resolve({ answerId: id }) });

async function readAll(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
}

// ------------------------------------------------------------ stream route

test("stream: ticket → signed request → SSE piped unbuffered with no-transform headers", async () => {
  const agent = await fakeAgent((entry, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" });
    response.write(frame("status", { stage: "searching" }));
    setTimeout(() => {
      response.write(": ping\n\n");
      response.write(frame("delta", { text: "Обучение стоит" }));
      response.end(frame("final", { answer: { answer_id: ID(7) } }));
    }, 250);
  });
  try {
    const tickets = [];
    const handler = createAiAnswerStreamHandler(deps({
      config: () => ({ secret: SECRET, baseUrl: agent.baseUrl }),
      issueTicket: async (actor, input) => { tickets.push([actor, input]); return { status: "issued", ticket: TICKET }; },
    }));
    const started = Date.now();
    const response = await handler(post(`/api/v3/ai-agent/conversations/${ID(1)}/answer`, { intent: "reply", refId: ID(5) }), conversation());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: status/u);
    assert.ok(Date.now() - started < 240, "the first frame arrives before the agent finishes (no buffering)");
    let rest = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
    assert.match(rest, /event: delta[\s\S]*event: final/u);
    assert.deepEqual(tickets, [[ACTOR, { conversationId: ID(1), refId: ID(5) }]]);
    assert.equal(agent.seen.length, 1);
    assert.equal(agent.seen[0].url, "/v1/answer");
    assert.equal(agent.seen[0].verified, true, "HMAC over ts.METHOD.path.sha256(body) with the internal secret");
    assert.deepEqual(JSON.parse(agent.seen[0].body), { ticket: TICKET, intent: "reply" });
  } finally {
    await agent.close();
  }
});

test("stream: the browser leaving aborts the request to the agent", async () => {
  const agent = await fakeAgent((entry, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(frame("status", { stage: "searching" }));
    // Never ends by itself.
  });
  try {
    const handler = createAiAnswerStreamHandler(deps({ config: () => ({ secret: SECRET, baseUrl: agent.baseUrl }) }));
    const browser = new AbortController();
    const request = new Request(`https://crm.test/api/v3/ai-agent/conversations/${ID(1)}/answer`, {
      method: "POST", headers: { "content-type": "application/json", ...origin }, body: JSON.stringify({ intent: "followup" }),
      signal: browser.signal,
    });
    const response = await handler(request, conversation());
    const reader = response.body.getReader();
    await reader.read();
    browser.abort();
    await reader.cancel();
    for (let i = 0; i < 40 && !agent.seen[0].closed; i += 1) await wait(25);
    assert.equal(agent.seen[0].closed, true, "the agent connection is closed before it finished");
    assert.deepEqual(JSON.parse(agent.seen[0].body), { ticket: TICKET, intent: "followup" });
  } finally {
    await agent.close();
  }
});

test("stream: an agent that dies mid-stream ends with an «unavailable» error frame", async () => {
  const agent = await fakeAgent((entry, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(frame("status", { stage: "writing" }));
    setTimeout(() => response.socket.destroy(), 50);
  });
  try {
    const handler = createAiAnswerStreamHandler(deps({ config: () => ({ secret: SECRET, baseUrl: agent.baseUrl }) }));
    const response = await handler(post(`/api/v3/ai-agent/conversations/${ID(1)}/answer`, { intent: "reply" }), conversation());
    const text = await readAll(response);
    const decode = createSseDecoder();
    const events = decode(text).map((item) => parseAiStreamEvent(item.event, item.data)).filter(Boolean);
    assert.deepEqual(events.at(-1), { type: "error", code: "agent_unavailable", message: "ИИ-агент сейчас недоступен.", status: 503 });
  } finally {
    await agent.close();
  }
});

test("stream: honest refusals before any agent call", async () => {
  const path = `/api/v3/ai-agent/conversations/${ID(1)}/answer`;
  const calls = [];
  const counting = (overrides) => createAiAnswerStreamHandler(deps({
    fetch: async () => { calls.push("fetch"); throw new Error("must not be called"); },
    ...overrides,
  }));
  const code = async (response) => (await response.json()).error.code;
  // Cross-site: no Origin, another Origin.
  const noOrigin = new Request(`https://crm.test${path}`, { method: "POST", headers: { "content-type": "application/json", host: "crm.test" }, body: "{}" });
  assert.equal((await counting()(noOrigin, conversation())).status, 403);
  assert.equal((await counting()(post(path, { intent: "reply" }, { origin: "https://evil.test" }), conversation())).status, 403);
  for (const [status, http, expected] of [["anonymous", 401, "authentication_required"], ["preview", 403, "preview"],
    ["forbidden", 403, "forbidden"], ["unavailable", 503, "unavailable"]]) {
    const response = await counting({ authorize: async () => ({ status, actor: null }) })(post(path, { intent: "reply" }), conversation());
    assert.equal(response.status, http, status);
    assert.equal(await code(response), expected);
  }
  for (const body of [{}, { intent: "draft" }, { intent: "reply", refId: "nope" }, { intent: "reply", extra: 1 },
    { intent: "reply", refId: "x".repeat(2000) }]) {
    assert.equal((await counting()(post(path, body), conversation())).status, 400, JSON.stringify(body));
  }
  assert.equal((await counting()(post(path, { intent: "reply" }), conversation("not-a-uuid"))).status, 400);
  const off = await counting({ config: () => null })(post(path, { intent: "reply" }), conversation());
  assert.equal(off.status, 503);
  assert.equal(await code(off), "ai_agent_off");
  for (const [refusal, http] of [["consent_required", 412], ["rate_limited", 429], ["forbidden", 403], ["invalid_request", 400], ["unavailable", 503]]) {
    const response = await counting({ issueTicket: async () => ({ status: "refused", code: refusal }) })(post(path, { intent: "reply" }), conversation());
    assert.equal(response.status, http, refusal);
    assert.equal(await code(response), refusal);
  }
  assert.deepEqual(calls, [], "no refusal reaches the agent");
});

test("stream: agent refusals before the stream map to the window's honest states", async () => {
  const replies = [
    [401, { error: { code: "unauthorized", status: 401 } }, 503, "agent_unavailable"],
    [403, { error: { code: "ticket_invalid", message_ru: "x", status: 403 } }, 503, "agent_unavailable"],
    [412, { error: { code: "consent_required", status: 412 } }, 412, "consent_required"],
    [429, { error: { code: "rate_limited", status: 429 } }, 429, "rate_limited"],
    [402, { error: { code: "budget_exhausted", status: 402 } }, 402, "budget_exhausted"],
    [402, { error: { code: "model_unpriced", message_ru: "x", status: 402 } }, 402, "model_unpriced"],
    [500, "<html>oops</html>", 503, "agent_unavailable"],
  ];
  let index = 0;
  const agent = await fakeAgent((entry, response) => {
    const [status, body] = replies[index++];
    response.writeHead(status, { "Content-Type": typeof body === "string" ? "text/html" : "application/json" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  try {
    const handler = createAiAnswerStreamHandler(deps({ config: () => ({ secret: SECRET, baseUrl: agent.baseUrl }) }));
    for (const [, , http, expected] of replies) {
      const response = await handler(post(`/api/v3/ai-agent/conversations/${ID(1)}/answer`, { intent: "reply" }), conversation());
      assert.equal(response.status, http, expected);
      assert.deepEqual(await response.json(), { error: { code: expected } }, "the agent's own text never reaches the browser");
    }
  } finally {
    await agent.close();
  }
  // Nobody listening: «ИИ-агент сейчас недоступен».
  const closed = await createAiAnswerStreamHandler(deps({ config: () => ({ secret: SECRET, baseUrl: agent.baseUrl }) }))(
    post(`/api/v3/ai-agent/conversations/${ID(1)}/answer`, { intent: "reply" }), conversation());
  assert.equal(closed.status, 503);
  assert.deepEqual(await closed.json(), { error: { code: "agent_unavailable" } });
});

// ------------------------------------------------------------ saved answer and insert

test("saved answer: read-only, exact query, no agent call; feature flag reported", async () => {
  const calls = [];
  const handler = createAiAnswerReadHandler(deps({
    readAnswer: async (actor, id, intent) => { calls.push([actor, id, intent]); return { answer: null, latestInboundMessageId: null, lastMessageDirection: null, consentRecorded: false }; },
    config: () => null,
    fetch: async () => { throw new Error("no agent"); },
  }));
  const ok = await handler(new Request(`https://crm.test/api/v3/ai-agent/conversations/${ID(1)}/answer?intent=followup`), conversation());
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ok.json(), { view: { answer: null, latestInboundMessageId: null, lastMessageDirection: null, consentRecorded: false }, featureOn: false });
  assert.deepEqual(calls, [[ACTOR, ID(1), "followup"]]);
  for (const query of ["intent=draft", "intent=reply&intent=reply", "x=1"]) {
    assert.equal((await handler(new Request(`https://crm.test/api/v3/ai-agent/conversations/${ID(1)}/answer?${query}`), conversation())).status, 400, query);
  }
  const forbidden = createAiAnswerReadHandler(deps({ readAnswer: async () => "forbidden" }));
  assert.equal((await forbidden(new Request(`https://crm.test/api/v3/ai-agent/conversations/${ID(1)}/answer`), conversation())).status, 403);
  const failing = createAiAnswerReadHandler(deps({ readAnswer: async () => { throw new Error("db"); } }));
  assert.equal((await failing(new Request(`https://crm.test/api/v3/ai-agent/conversations/${ID(1)}/answer`), conversation())).status, 503);
  const preview = createAiAnswerReadHandler(deps({ authorize: async () => ({ status: "preview", actor: null }) }));
  assert.equal((await preview(new Request(`https://crm.test/api/v3/ai-agent/conversations/${ID(1)}/answer`), conversation())).status, 403);
});

test("insert: the stored checked text; 409 «stale_answer» when a newer message came; nothing is sent", async () => {
  const calls = [];
  const handler = createAiAnswerInsertHandler(deps({
    insertAnswer: async (actor, id, part) => { calls.push([actor, id, part]); return { status: "inserted", text: "Обучение стоит 5000 долларов в год." }; },
  }));
  const path = `/api/v3/ai-agent/answers/${ID(2)}/insert`;
  const ok = await handler(post(path, { part: "reply" }), answerContext());
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { text: "Обучение стоит 5000 долларов в год." });
  assert.deepEqual(calls, [[ACTOR, ID(2), "reply"]]);
  for (const [status, http, code] of [["stale", 409, "stale_answer"], ["forbidden", 403, "forbidden"], ["not_found", 404, "not_found"],
    ["invalid", 400, "invalid_request"], ["unavailable", 503, "unavailable"]]) {
    const refused = createAiAnswerInsertHandler(deps({ insertAnswer: async () => ({ status }) }));
    const response = await refused(post(path, { part: "question" }), answerContext());
    assert.equal(response.status, http, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }
  assert.equal((await handler(post(path, { part: "all" }), answerContext())).status, 400);
  assert.equal((await handler(post(path, { part: "reply" }, { origin: "https://evil.test" }), answerContext())).status, 403);
  assert.equal(calls.length, 1, "refused requests never reach the database");
});

test("agent status for «Расходы»: off without a secret, signed GET, unavailable on failure", async () => {
  assert.deepEqual(await readAiAgentStatus(ID(90), { config: null }), { state: "off" });
  const agent = await fakeAgent((entry, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ configured: true, keyAccepted: true, model: "gemini-3.8-flash", block: { code: "gemini_billing" } }));
  });
  try {
    const status = await readAiAgentStatus(ID(90), { config: { secret: SECRET, baseUrl: agent.baseUrl } });
    assert.deepEqual(status, { state: "ready", keyAccepted: true, model: "gemini-3.8-flash", block: "gemini_billing" });
    assert.equal(agent.seen[0].url, `/v1/status?organization_id=${ID(90)}`);
    assert.equal(agent.seen[0].verified, true, "the query is part of the signed path; the body is empty");
  } finally {
    await agent.close();
  }
  assert.deepEqual(await readAiAgentStatus(ID(90), { config: { secret: SECRET, baseUrl: agent.baseUrl }, timeoutMs: 300 }), { state: "unavailable" });
});

// ------------------------------------------------------------ signing and config

test("signature: the agent's canonical string, fixed vector", () => {
  const body = JSON.stringify({ ticket: TICKET, intent: "reply" });
  const digest = createHash("sha256").update(body).digest("hex");
  const expected = createHmac("sha256", SECRET).update(`1791270000.POST./v1/answer.${digest}`).digest("hex");
  assert.equal(signAiAgentRequest(SECRET, "1791270000", "post", "/v1/answer", body), expected);
  assert.equal(signAiAgentRequest(SECRET, "1791270000", "GET", "/v1/status?organization_id=x", ""),
    createHmac("sha256", SECRET).update(`1791270000.GET./v1/status?organization_id=x.${createHash("sha256").update("").digest("hex")}`).digest("hex"));
});

test("config: the feature is off without a well-formed secret; production talks only to the private alias", () => {
  assert.equal(readAiAgentConfig({}), null);
  assert.equal(readAiAgentConfig({ EVO_AI_AGENT_INTERNAL_SECRET: "short" }), null);
  assert.equal(readAiAgentConfig({ EVO_AI_AGENT_INTERNAL_SECRET: `${SECRET} with space` }), null);
  assert.deepEqual(readAiAgentConfig({ EVO_AI_AGENT_INTERNAL_SECRET: SECRET }), { secret: SECRET, baseUrl: AI_AGENT_DEFAULT_URL });
  assert.equal(AI_AGENT_DEFAULT_URL, "http://evo-ai-agent:8080");
  assert.equal(readAiAgentConfig({ EVO_AI_AGENT_INTERNAL_SECRET: SECRET, NODE_ENV: "production", EVO_AI_AGENT_URL: "http://127.0.0.1:8099" }).baseUrl, AI_AGENT_DEFAULT_URL);
  assert.equal(readAiAgentConfig({ EVO_AI_AGENT_INTERNAL_SECRET: SECRET, NODE_ENV: "development", EVO_AI_AGENT_URL: "http://127.0.0.1:8099" }).baseUrl, "http://127.0.0.1:8099");
  assert.equal(readAiAgentConfig({ EVO_AI_AGENT_INTERNAL_SECRET: SECRET, EVO_AI_AGENT_URL: "https://evil.test/x" }).baseUrl, AI_AGENT_DEFAULT_URL);
});

test("env contract: EVO_AI_AGENT_INTERNAL_SECRET is optional — absent or empty releases, malformed does not", () => {
  const exampleText = read("deploy/env.production.example");
  assert.match(exampleText, /^EVO_AI_AGENT_INTERNAL_SECRET=$/mu, "documented in the shipped example, empty");
  const ref = "aaaaaaaaaaaaaaaaaaaa";
  const base = {
    EVO_CRM_DOMAIN: "crm.evoadmissions.com", EVO_CADDY_NETWORK: "evo_public_web",
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_runtime_safe",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_ssssssssssssssssssssssss", EVO_PLATFORM_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
    EVO_STAFF_ADMIN_LOGIN_EMAIL: "", EVO_PLATFORM_WAHA_INGRESS_ENABLED: "0", EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: "",
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: "", EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "0", EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "",
    ANTHROPIC_API_KEY: "", ZAI_API_KEY: "", NEXT_PUBLIC_TRANSCRIPTION_SPLINE_SCENE_URL: "", EVO_ENABLE_LOCAL_TRANSCRIPTION: "0",
  };
  const text = (extra = {}) => Object.entries({ ...base, ...extra }).map(([key, value]) => `${key}=${value}`).join("\n");
  const check = (actualText) => validateAppEnvironmentContract({ exampleText, actualText, expectedSupabaseProjectRef: ref });
  assert.deepEqual(check(text()), { ok: true, code: "valid" }, "a release without the name stays valid");
  assert.deepEqual(check(text({ EVO_AI_AGENT_INTERNAL_SECRET: "" })), { ok: true, code: "valid" });
  assert.deepEqual(check(text({ EVO_AI_AGENT_INTERNAL_SECRET: SECRET })), { ok: true, code: "valid" });
  for (const bad of ["short", `${SECRET} space`, "é".repeat(40)]) {
    assert.throws(() => check(text({ EVO_AI_AGENT_INTERNAL_SECRET: bad })), /optional_feature_configuration_invalid/u, bad);
  }
  // Свой секрет: совпадение с любым другим значением env (здесь — WAHA HMAC) не выпускается.
  assert.throws(() => check(text({ EVO_AI_AGENT_INTERNAL_SECRET: SECRET, EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: SECRET })),
    /optional_feature_configuration_invalid/u, "reused WAHA HMAC secret");
  assert.throws(() => check(text({ EVO_PLATFORM_ORGANIZATION_ID: undefined }).replace(/^EVO_PLATFORM_ORGANIZATION_ID=.*$/mu, "")), /required_env_name_missing/u,
    "other example names stay required");
});

// ------------------------------------------------------------ pure contract

test("SSE decoder: frames split across chunks, CRLF, comments, multi-line data", () => {
  const decode = createSseDecoder();
  assert.deepEqual(decode("event: status\r\ndata: {\"stage\":\"sea"), []);
  assert.deepEqual(decode("rching\"}\r\n\r\n: ping\n\nevent: delta\ndata: {\"text\":\n"), [{ event: "status", data: "{\"stage\":\"searching\"}" }]);
  assert.deepEqual(decode("data: \"ab\"}\n\n"), [{ event: "delta", data: "{\"text\":\n\"ab\"}" }]);
  assert.deepEqual(parseAiStreamEvent("status", "{\"stage\":\"searching\"}"), { type: "status", stage: "searching" });
  assert.deepEqual(parseAiStreamEvent("sources", "{\"count\":3}"), { type: "sources", count: 3 });
  assert.deepEqual(parseAiStreamEvent("final", JSON.stringify({ answer: { answer_id: ID(7).toUpperCase() } })), { type: "final", answerId: ID(7) });
  assert.deepEqual(parseAiStreamEvent("error", JSON.stringify({ code: "rate_limited", message_ru: "Слишком много", status: 429 })),
    { type: "error", code: "rate_limited", message: "Слишком много", status: 429 });
  assert.deepEqual(parseAiStreamEvent("error", JSON.stringify({ code: "BAD CODE" })), { type: "error", code: "unavailable", message: null, status: 503 });
  assert.equal(parseAiStreamEvent("status", "not json"), null);
  assert.equal(parseAiStreamEvent("other", "{}"), null);
});

const SOURCES = [
  { n: 1, chunk_id: 11, document_id: ID(31), title: "Прайс 2026", audience: "client", page_from: 2, page_to: 2, sheet_name: null,
    section_path: "Прайс 2026 › Малайзия", quote: "Обучение в Малайзии стоит 5000 долларов в год.", live: true, missing: false,
    unverified: true, unverified_values: ["5000"] },
  { n: 2, chunk_id: 12, document_id: ID(32), title: "Правила скидок", audience: "internal", page_from: null, page_to: null,
    sheet_name: null, section_path: "Скидки", quote: "Скидка до 15 процентов.", live: true, missing: false, unverified: false, unverified_values: [] },
  { n: 3, chunk_id: null, document_id: null, title: null, audience: null, quote: null, live: false, missing: true, unverified: false, unverified_values: [] },
];
const VIEW = {
  answer: {
    answerId: ID(7), status: "ready", intent: "reply", current: true, createdAt: "2026-10-06T08:00:00Z", insertedAt: null, errorCode: null,
    result: {
      reply: "Обучение стоит 5000 долларов 🎓 в год. Скидки нет.", reason: "Из прайса", question: "На какую программу?", language: "ru",
      citations: [{ n: 1, chunk_id: 11 }, { n: 2, chunk_id: 12 }], reply_citations: [{ n: 1, start: 0, end: 37 }, { n: 2, start: 38, end: 49 }],
      sources: SOURCES, warnings: [],
    },
  },
  latestInboundMessageId: ID(5), lastMessageDirection: "inbound", consentRecorded: true,
};

test("saved answer view: DB-backed sources, marks only on client sources, code-point offsets, amber facts", () => {
  const view = normalizeAiAnswerView(VIEW);
  assert.equal(view.answer.current, true);
  assert.equal(view.answer.result.sources.length, 3);
  assert.equal(view.answer.result.sources[2].missing, true);
  assert.equal(view.answer.result.sources[2].quote, null);
  const segments = replySegments(view.answer.result);
  // The emoji is one code point (the agent counts code points): the mark follows «год.».
  assert.deepEqual(segments.map((segment) => [segment.text, [...segment.marks]]), [
    ["Обучение стоит 5000 долларов 🎓 в год.", [1]],
    [" Скидки нет.", []],
  ], "an internal source (n 2) never gets a mark in the client reply");
  assert.deepEqual([...answerWarnings(view.answer.result)], ["Число в источнике ещё не проверено"]);
  const noSources = normalizeAiAnswerView({ ...VIEW, answer: { ...VIEW.answer, result: { ...VIEW.answer.result, sources: [SOURCES[1]], citations: [] } } });
  assert.deepEqual([...answerWarnings(noSources.answer.result)], ["Проверьте факты — источники не найдены"]);
  assert.throws(() => normalizeAiAnswerView({ ...VIEW, consentRecorded: "yes" }), /ai_agent_shape_invalid/u);
  assert.throws(() => normalizeAiAnswerView({ ...VIEW, answer: { ...VIEW.answer, result: null } }), /ai_agent_shape_invalid/u);
  assert.equal(normalizeAiAnswerView({ ...VIEW, answer: { ...VIEW.answer, status: "superseded", current: true, result: null } }).answer.current, false);
  assert.equal(sourcePlace({ pageFrom: 2, pageTo: 3, sheetName: null }), "стр. 2–3");
  assert.equal(sourcePlace({ pageFrom: null, pageTo: null, sheetName: "Тарифы" }), "лист «Тарифы»");
  assert.deepEqual([1, 2, 3, 5, 11, 21, 22, 25].map(sourcesWord),
    ["1 источник", "2 источника", "3 источника", "5 источников", "11 источников", "21 источник", "22 источника", "25 источников"]);
});

test("honest copy for every state of the window (plan §6.8)", () => {
  for (const code of ["ai_agent_off", "consent_required", "agent_unavailable", "rate_limited", "budget_exhausted", "gemini_billing",
    "gemini_quota_day", "stale_answer", "preview"]) {
    assert.ok(AI_ERROR_COPY[code], code);
  }
  assert.equal(AI_ERROR_COPY.gemini_billing, "Закончился оплаченный баланс Gemini. Пополните его в Google Cloud.");
  assert.equal(AI_ERROR_COPY.rate_limited, "Слишком много запросов. Подождите минуту.");
  assert.equal(AI_ERROR_COPY.agent_unavailable, "ИИ-агент сейчас недоступен.");
  assert.equal(AI_ERROR_COPY.stale_answer, "Пришло новое сообщение — обновите ответ.");
});

test("an unpriced model is a blocked state of its own, not the exhausted budget", () => {
  // The agent's code and text (evo-ai-agent errors.py): PT402 ai_model_unpriced -> model_unpriced, HTTP 402.
  assert.equal(AI_ERROR_COPY.model_unpriced, "Модель без цены — выберите модель в настройках или обновите цены.");
  assert.notEqual(AI_ERROR_COPY.model_unpriced, AI_ERROR_COPY.budget_exhausted);
  assert.equal(AI_ERROR_COPY.ai_model_unpriced, undefined, "the database's message never reaches the window as a code");
  assert.deepEqual(parseAiStreamEvent("error", JSON.stringify({ code: "model_unpriced", message_ru: "Модель без цены", status: 402 })),
    { type: "error", code: "model_unpriced", message: "Модель без цены", status: 402 });
  assert.equal(aiErrorBlocked("model_unpriced"), true);
  assert.equal(aiErrorRetryable("model_unpriced"), false);
  assert.equal(aiErrorBlocked("budget_exhausted"), false, "the budget stays an error with «Открыть «Расходы»»");
  assert.equal(aiErrorRetryable("budget_exhausted"), false);
  assert.equal(aiErrorRetryable("rate_limited"), true);
  const assistant = read("src/components/v3/inbox/InboxAiAssistant.tsx");
  assert.match(assistant, /if \(aiErrorBlocked\(code\)\) \{\n\s+setPhase\(\{ kind: "blocked", code \}\);/u);
  assert.match(assistant, /\{phase\.code === "model_unpriced" \? \(\n[^\n]*\n\s+<Link href="\/v3\/ai-agent\?section=spend"/u);
  assert.match(assistant, /\{phase\.code === "budget_exhausted" \? \(/u);
  assert.doesNotMatch(assistant, /ai_model_unpriced/u);
});

test("section reads: documents, rules, spend and settings are validated, money keeps cents", () => {
  const docs = normalizeAiDocuments({ items: [{ id: ID(31), title: "Прайс", kind: "knowledge", audience: "client", status: "processing", stage: "embed",
    progress: 60, errorCode: null, source: "seed_kb", sourceRef: { nodeId: ID(40), nodeVersion: 3 }, editedInLab: false, rowVersion: 2,
    pageCount: null, chunkCount: 0, openReviewCount: 0, updatedAt: "2026-10-06T08:00:00Z" }], hasMore: false, canManage: true, isAdmin: false });
  assert.equal(docs.items[0].sourceNodeVersion, 3);
  assert.deepEqual(documentStatus(docs.items[0]), { label: "Обрабатывается · векторы · 60%", tone: "muted" });
  assert.throws(() => normalizeAiDocuments({ items: [{ id: "x" }], hasMore: false, canManage: true, isAdmin: false }), /shape/u);
  const rules = normalizeAiRules({ current: { id: ID(50), version: 2, body: "Тон: вежливо.", source: "seed", createdAt: "2026-10-06T08:00:00Z",
    createdByName: null, confirmedAt: null, confirmedByName: null, needsReview: true }, versions: [], canManage: false });
  assert.equal(rules.current.needsReview, true);
  const spend = normalizeAiSpend({ today: "2026-10-06", monthStart: "2026-10-01", todayUsd: 0.0123, monthUsd: "1.5", monthEstimated: true,
    forecastUsd: 7.75, monthlyCapUsd: 50, reservedUsd: 0, remainingUsd: 48.5, answers: 42, averageAnswerUsd: 0.0107,
    byGroup: [{ group: "answers", usd: 1.2, calls: 84, estimated: false }],
    priceChanges: [{ model: "gemini-3.8-flash", kind: "input", effectiveFrom: "2027-01-01", usdPerMillion: 1.5, previousUsdPerMillion: 0.75 }] });
  assert.equal(spend.monthUsd, 1.5);
  assert.equal(formatUsd(0.0123).replace(/\s/gu, " "), "0,0123 $");
  assert.equal(formatUsd(12.5, true).replace(/\s/gu, " "), "≈ 12,50 $");
  assert.match(formatUsd(0.17, true), /^≈\u00A00,17\u00A0\$$/u, "«≈» and «$» hold to the amount with U+00A0");
  assert.throws(() => normalizeAiSpend({ ...spend, byGroup: [{ group: "unknown", usd: 1 }] }), /shape/u);
  const settings = normalizeAiSettings({ version: 3, models: { answer: "gemini-3.8-flash", fast: "gemini-3.5-flash-lite", embedding: "gemini-embedding-2" },
    unpricedModels: [], monthlyCapUsd: 50, ratePerMemberMinute: 20, consent: { recorded: false, at: null, byName: null, textVersion: null },
    canManage: true, isAdmin: true });
  assert.equal(settings.consent.recorded, false);
  assert.equal(parseAiAgentSection(undefined), "documents");
  assert.equal(parseAiAgentSection("spend"), "spend");
  assert.equal(parseAiAgentSection("laboratory"), null, "P2–P4 sub-pages do not exist yet");
  assert.equal(aiAgentHref("rules"), "/v3/ai-agent?section=rules");
});

// ------------------------------------------------------------ route, access, menu

test("route contract: only the three AI routes and the section page are connected", () => {
  assert.equal(isConnectedPlatformApi(`/api/v3/ai-agent/conversations/${ID(1)}/answer`), true);
  assert.equal(isConnectedPlatformApi(`/api/v3/ai-agent/answers/${ID(2)}/insert`), true);
  for (const path of ["/api/v3/ai-agent", `/api/v3/ai-agent/conversations/${ID(1)}`, `/api/v3/ai-agent/conversations/x/answer`,
    `/api/v3/ai-agent/answers/${ID(2)}`, "/api/v3/ai-agent/status", "/api/internal/ai-agent/storage/x"]) {
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
  assert.equal(isConnectedPlatformPage("/v3/ai-agent"), true);
  assert.equal(isConnectedPlatformPage("/v3/ai-agent/laboratory"), false);
});

test("access: the section and the menu item follow ai.agent.use; every preview role sees it", () => {
  const staff = (permissionKeys) => ({ systemRole: "staff", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys });
  assert.equal(staffCanAccessRoute(staff(["ai.agent.use"]), "/v3/ai-agent"), true);
  assert.equal(staffCanAccessRoute(staff(["communication.read.full"]), "/v3/ai-agent"), false);
  assert.equal(staffCanAccessRoute({ ...staff([]), systemRole: "admin" }, "/v3/ai-agent"), true);
  for (const role of ["sales", "admissions"]) {
    assert.equal(staffCanAccessRoute({ ...staff([]), systemRole: "admin", presentationRole: role }, "/v3/ai-agent"), true, role);
  }
  const nav = buildV3Navigation(staff(["ai.agent.use"]), "/v3/ai-agent", new URLSearchParams());
  assert.equal(nav.activeId, "ai-agent");
  assert.deepEqual(nav.common.map((link) => [link.label, link.href]), [["ИИ-агент", "/v3/ai-agent"]]);
});

// ------------------------------------------------------------ source contract

test("the window never reaches the agent, inserts only stored text and never sends", () => {
  const assistant = read("src/components/v3/inbox/InboxAiAssistant.tsx");
  assert.doesNotMatch(assistant, /evo-ai-agent|:8080|\/v1\//u, "the browser talks only to CRM routes");
  assert.match(assistant, /fetch\(`\/api\/v3\/ai-agent\/conversations\/\$\{conversationId\}\/answer`/u);
  assert.match(assistant, /fetch\(`\/api\/v3\/ai-agent\/answers\/\$\{answer\.answerId\}\/insert`/u);
  assert.doesNotMatch(assistant, /sendPlatformWhatsAppMessageAction|dangerouslySetInnerHTML/u);
  assert.match(assistant, /onInsert\(body\.text\)/u, "the inserted text is the database's, not the streamed preview");
  assert.match(assistant, /window\.localStorage\.setItem/u);
  assert.match(assistant, /\} catch \{\n\s+\/\/ Позиция окна/u, "storage failures are tolerated");
  assert.match(assistant, /event\.key === "Escape"/u);
  assert.match(assistant, /aria-label="Помочь с ответом — открыть помощника"/u);
  const chat = read("src/components/v3/inbox/InboxChat.tsx");
  assert.match(chat, /appendChatDraft\(storeKey, text\);/u);
  assert.match(chat, /\{assistant && canSend \? \(/u);
  const routes = read("src/lib/server/ai-agent-route-handlers.ts");
  assert.match(routes, /"Cache-Control": "no-cache, no-transform"/u);
  assert.match(routes, /"X-Accel-Buffering": "no"/u);
  assert.match(routes, /request\.signal\.addEventListener\("abort", abort/u);
});

test("the section shows only P1 sub-pages and no fake controls", () => {
  assert.deepEqual(AI_AGENT_SECTIONS.map((section) => section.title), ["Информация для агента", "Правила общения", "Расходы"]);
  // Code only: the header comment names the later sub-pages on purpose.
  const views = read("src/components/v3/ai-agent/AiAgentViews.tsx").replace(/\/\*[\s\S]*?\*\//gu, "");
  for (const later of ["Лист сверки", "Автоответчик", "Диктовка", "Загрузить", "Взять из базы знаний", "Новая версия файла"]) {
    assert.equal(views.includes(later), false, later);
  }
  const page = read("src/app/(v3)/v3/ai-agent/page.tsx");
  assert.match(page, /requireV3PageActor\("\/v3\/ai-agent"\)/u);
  assert.match(page, /<PartShell title="ИИ-агент"/u);
});
