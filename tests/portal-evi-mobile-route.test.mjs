import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isConnectedStudentPortalApi, isPublicStudentRegistrationApi } from "../src/lib/platform-route-contract.ts";
import { runEviTurn } from "../src/lib/portal/evi-core.ts";
import { parseProfessionCard } from "../src/lib/portal/professions.ts";
import { resetEviSlots } from "../src/lib/server/evi/limiter.ts";
import { readEviApiKey } from "../src/lib/server/evi/messages.ts";
import { createStudentPortalMobileEviHandler, createStudentPortalMobileEviStatusHandler } from "../src/lib/server/student-portal-mobile-evi-route-handler.ts";

// «Подбор с Эви» в приложении: границы маршрута и общее ядро. Все данные выдуманы; Supabase и модель не вызываются:
// клиент базы — заглушка с записью вызовов, сеть модели — подмена `fetch` на границе провайдера (api.anthropic.com).

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const TOKEN = ["synthetichead", "syntheticbody", "syntheticpart"].join(".");
const STUDENT = { authUserId: "3f6a1e9c-2b3d-4c5e-8f90-123456789abc", accessTier: "assisted" };
const KEY = "sk-ant-synthetic-key-0000000000000003";
const ENV = { EVO_EVI_ANTHROPIC_API_KEY: KEY };

// Те же опубликованные карточки, что в проверке промта (миграция 359); id карточки — по порядку.
const BODIES = [...read("supabase/migrations/359_platform_profession_cards_v1_1.sql").matchAll(/'(\{"id":.*?\})'/gu)]
  .map((match) => JSON.parse(match[1].replaceAll("''", "'")));
const cardId = (index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const CARD_ROWS = BODIES.map((body, index) => ({ cardId: cardId(index), cardKey: body.id, version: "1.1.0", body }));

const GRANTED = { status: "granted", policyVersion: "2026-10-25", decidedAt: "2026-11-01T10:00:00Z", currentPolicyVersion: "2026-10-25" };
const DECLINED = { ...GRANTED, status: "declined" };
const OLD_POLICY = { ...GRANTED, policyVersion: "2026-01-01" };

function fakeClient(consent = GRANTED) {
  const calls = [];
  return {
    calls,
    schema() {
      return {
        async rpc(name, args) {
          calls.push(name);
          if (name === "portal_ai_consent_get_v1") return { data: consent, error: null };
          return { data: null, error: { code: "XX000" } };
        },
      };
    },
  };
}

// Чтение каталога и теста интересов идёт тем же клиентом ученика: читатель-заглушка записывает, какой клиент ему дали.
function readers(client) {
  return {
    async readCatalog(given) {
      client.calls.push(given === client ? "catalog:own-client" : "catalog:OTHER-CLIENT");
      return CARD_ROWS.map((row) => parseProfessionCard(row));
    },
    async readOrvis(given) {
      client.calls.push(given === client ? "orvis:own-client" : "orvis:OTHER-CLIENT");
      return null;
    },
  };
}

function providerFetch(replyText, log = []) {
  return async (url, init) => {
    log.push({ url, init });
    return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: replyText }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

const HISTORY = [{ role: "assistant", content: "Привет! Начнём?" }, { role: "user", content: "Начнём!" }];

function harness({ actor = STUDENT, consent = GRANTED, env = ENV, replyText = '{"message":"Что тебе нравится делать?","options":["Рисовать","Считать"],"mood":"talk","progress":{"step":1,"total":10}}', resolve } = {}) {
  const state = { resolved: [], clients: [], provider: [], client: fakeClient(consent) };
  const handler = createStudentPortalMobileEviHandler({
    async resolveActor(token) {
      state.resolved.push(token);
      return resolve ? resolve(token) : { status: "authenticated", actor };
    },
    createClient(token) {
      state.clients.push(token);
      return state.client;
    },
    core: { env, fetch: providerFetch(replyText, state.provider), sleep: async () => {}, ...readers(state.client) },
  });
  return { handler, state };
}

function post(body, headers = { authorization: `Bearer ${TOKEN}` }, contentType = "application/json") {
  return new Request("https://app.evoadmissions.com/api/portal/mobile/evi", {
    method: "POST",
    headers: { "content-type": contentType, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test.beforeEach(() => resetEviSlots());

test("no token, a malformed token or another scheme: 401 before anything is read or resolved", async () => {
  const { handler, state } = harness();
  for (const headers of [{}, { authorization: "Bearer" }, { authorization: "Bearer not-a-jwt" }, { authorization: `Basic ${TOKEN}` }, { authorization: `Bearer ${TOKEN} extra` }]) {
    const response = await handler(post({ history: HISTORY }, headers));
    assert.equal(response.status, 401, JSON.stringify(headers));
    assert.deepEqual(await response.json(), { error: "unauthorized" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.deepEqual(state.resolved, []);
  assert.deepEqual(state.provider, []);
});

test("an expired or rejected session is 401; a staff account or any non-student is 403; an unavailable authority is 503", async () => {
  const outcomes = [
    [{ status: "invalid", actor: null, reason: "supabase_session_invalid" }, 401],
    [{ status: "anonymous", actor: null }, 401],
    [{ status: "invalid", actor: null, reason: "student_authority_invalid" }, 403],
    [{ status: "invalid", actor: null, reason: "student_authority_unavailable" }, 503],
  ];
  for (const [result, status] of outcomes) {
    const { handler, state } = harness({ resolve: () => result });
    const response = await handler(post({ history: HISTORY }));
    assert.equal(response.status, status, JSON.stringify(result));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(state.clients, [], "no database client is opened for a refused caller");
    assert.deepEqual(state.provider, [], "the model is never called for a refused caller");
  }
});

test("the body: one JSON object with only history and an optional ru/ky locale, bounded in size", async () => {
  const { handler, state } = harness();
  const bad = [
    post({ history: HISTORY }, { authorization: `Bearer ${TOKEN}` }, "text/plain"),
    post("not json"),
    post("[]"),
    post({}),
    post({ history: HISTORY, extra: true }),
    post({ history: HISTORY, locale: "en" }),
    post({ history: HISTORY, locale: 7 }),
    post({ history: HISTORY, pad: "x".repeat(130 * 1024) }),
    post({ history: HISTORY }, { authorization: `Bearer ${TOKEN}`, "content-length": String(200 * 1024) }),
  ];
  for (const request of bad) {
    const response = await handler(request);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.deepEqual(state.provider, []);
  assert.equal(state.client.calls.length, 0, "nothing is read for a malformed request");
});

test("history is validated by the same parser as the web: a bad shape is «invalid», a long chat is «limit»; the model is not called", async () => {
  const { handler, state } = harness();
  const invalid = [
    [],
    [{ role: "user", content: "Привет" }],
    [{ role: "assistant", content: "Привет" }],
    [{ role: "assistant", content: "Привет" }, { role: "user", content: "" }],
    [{ role: "assistant", content: "Привет" }, { role: "system", content: "x" }],
    [{ role: "assistant", content: "Привет" }, { role: "user", content: "я".repeat(501) }],
    "history",
  ];
  for (const history of invalid) {
    const response = await handler(post({ history }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: false, reason: "invalid" }, JSON.stringify(history).slice(0, 60));
  }
  const long = Array.from({ length: 31 }, (_, index) => ({ role: index % 2 === 0 ? "assistant" : "user", content: "ок" }));
  assert.deepEqual(await (await handler(post({ history: long }))).json(), { ok: false, reason: "limit" });
  assert.deepEqual(state.provider, []);
  assert.equal(state.client.calls.length, 0, "the shape is checked before the database is read");
});

test("a withdrawn or outdated AI consent gives the same «consent» result as the web, without a model call", async () => {
  for (const consent of [DECLINED, OLD_POLICY, { ...GRANTED, status: null, policyVersion: null, decidedAt: null }]) {
    const { handler, state } = harness({ consent });
    const response = await handler(post({ history: HISTORY }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: false, reason: "consent" });
    assert.deepEqual(state.provider, []);
    assert.deepEqual(state.client.calls, ["portal_ai_consent_get_v1"], "only the own consent row is read");
  }
  // Чтение согласия не удалось — «error», а не «согласие есть».
  const failing = createStudentPortalMobileEviHandler({
    resolveActor: async () => ({ status: "authenticated", actor: STUDENT }),
    createClient: () => ({ schema: () => ({ rpc: async () => ({ data: null, error: { code: "XX000" } }) }) }),
    core: { env: ENV, fetch: providerFetch("{}"), sleep: async () => {}, ...readers({ calls: [] }) },
  });
  assert.deepEqual(await (await failing(post({ history: HISTORY }))).json(), { ok: false, reason: "error" });
});

test("no Эви key on the server: «unavailable», and no rate slot is spent", async () => {
  const { handler, state } = harness({ env: {} });
  assert.deepEqual(await (await handler(post({ history: HISTORY }))).json(), { ok: false, reason: "unavailable" });
  assert.deepEqual(state.provider, []);
});

test("happy path: the student's own client is built from the token, the model gets the chat, and the answer is the web's EviActionResult", async () => {
  const { handler, state } = harness();
  const response = await handler(post({ history: HISTORY, locale: "ky" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), {
    ok: true,
    answer: { message: "Что тебе нравится делать?", mood: "talk", options: ["Рисовать", "Считать"], multi: false, results: null, progress: { step: 1, total: 10 } },
  });
  assert.deepEqual(state.resolved, [TOKEN]);
  assert.deepEqual(state.clients, [TOKEN], "database reads carry the student's own token");
  assert.deepEqual(state.client.calls, ["portal_ai_consent_get_v1", "catalog:own-client", "orvis:own-client"], "consent, catalogue and test are read with that one client");
  assert.equal(state.provider.length, 1);
  const [{ url, init }] = state.provider;
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.headers["x-api-key"], KEY);
  const sent = JSON.parse(init.body);
  assert.equal(sent.model, "claude-sonnet-5-5");
  // Разговор: заметка кабинета, затем реплики; реплики Эви уходят в форме JSON. Ничего о деле и профиле.
  assert.deepEqual(sent.messages.slice(1), [{ role: "assistant", content: '{"message":"Привет! Начнём?"}' }, { role: "user", content: "Начнём!" }]);
  assert.match(sent.system[0].text, /Пиши по-кыргызски;/u, "the app's locale reaches the prompt");
  assert.doesNotMatch(init.body, new RegExp(`${STUDENT.authUserId}|${TOKEN}`, "u"));
});

test("a three-card result is mapped to the catalogue in the student's language", async () => {
  const picks = BODIES.slice(0, 3).map((body) => ({ cardKey: body.id, why: "Подходит по интересам." }));
  const replyText = JSON.stringify({ message: "Придумал!", results: picks });
  const { handler } = harness({ replyText });
  const body = await (await handler(post({ history: HISTORY, locale: "ky" }))).json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.answer.results.map((result) => [result.cardId, result.cardKey, result.title]), BODIES.slice(0, 3).map((card, index) => [cardId(index), card.id, card.title_ky]));
  assert.equal(body.answer.mood, "eureka");
  // Карточка вне каталога отвергает весь ответ — не выдумка.
  const unknown = harness({ replyText: JSON.stringify({ message: "x", results: picks.map((pick) => ({ ...pick, cardKey: "no-such-card" })) }) });
  assert.deepEqual(await (await unknown.handler(post({ history: HISTORY }))).json(), { ok: false, reason: "error" });
});

test("model failures keep the web's mapping: refusal → invalid, key revoked → unavailable, overload → busy", async () => {
  const cases = [[{ stop_reason: "refusal", content: [] }, 200, "invalid"], [{}, 401, "unavailable"], [{}, 429, "busy"], [{}, 500, "error"]];
  for (const [payload, status, reason] of cases) {
    const client = fakeClient();
    const result = await runEviTurn(
      { history: HISTORY, actor: STUDENT, client, locale: "ru" },
      { env: ENV, sleep: async () => {}, fetch: async () => new Response(JSON.stringify(payload), { status }), ...readers(client) },
    );
    assert.deepEqual(result, { ok: false, reason }, `${status} ${reason}`);
    resetEviSlots();
  }
});

test("the rate limit is per student: the 41st answer in ten minutes is «busy», another student is not blocked", async () => {
  const first = harness();
  for (let index = 0; index < 40; index += 1) assert.equal((await (await first.handler(post({ history: HISTORY }))).json()).ok, true, `answer ${index + 1}`);
  assert.deepEqual(await (await first.handler(post({ history: HISTORY }))).json(), { ok: false, reason: "busy" });
  assert.equal(first.state.provider.length, 40, "the 41st never reached the model");
  const other = harness({ actor: { ...STUDENT, authUserId: "b1111111-2222-4333-8444-555555555555" } });
  assert.equal((await (await other.handler(post({ history: HISTORY }))).json()).ok, true);
});

test("route contract: a connected Student path for POST (the turn) and GET (the status) only, never public, no look-alikes", () => {
  const path = "/api/portal/mobile/evi";
  for (const method of ["POST", "GET"]) {
    assert.equal(isConnectedStudentPortalApi(path, method), true, method);
    assert.equal(isPublicStudentRegistrationApi(path, method), false, method);
  }
  for (const method of ["PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) assert.equal(isConnectedStudentPortalApi(path, method), false, method);
  for (const variant of [`${path}/`, `${path}/x`, path.toUpperCase(), "/api/portal/mobile/evi2", "/api/portal/mobile/evi/status"]) {
    for (const method of ["POST", "GET"]) {
      assert.equal(isConnectedStudentPortalApi(variant, method) || isPublicStudentRegistrationApi(variant, method), false, `${method} ${variant}`);
    }
  }
});

test("the route file exports exactly POST (the turn) and GET (the status) on the node runtime, and web and mobile share one core", () => {
  const route = read("src/app/api/portal/mobile/evi/route.ts");
  assert.match(route, /export const POST = createStudentPortalMobileEviHandler\(\);/u);
  assert.match(route, /export const GET = createStudentPortalMobileEviStatusHandler\(\);/u);
  assert.match(route, /export const runtime = "nodejs";/u);
  assert.match(route, /export const dynamic = "force-dynamic";/u);
  assert.deepEqual([...route.matchAll(/^export const ([A-Za-z]+) =/gmu)].map((match) => match[1]).sort(), ["GET", "POST", "dynamic", "runtime"]);
  assert.doesNotMatch(route, /export (?:async )?function|export const (?:PUT|DELETE|PATCH|HEAD|OPTIONS)\b/u);
  const handler = read("src/lib/server/student-portal-mobile-evi-route-handler.ts");
  assert.match(handler, /resolveStudentPortalBearerActor/u);
  assert.match(handler, /createSupabaseBearerServerClient/u);
  assert.doesNotMatch(handler, /cookies\(|createSupabaseServerClient|console\./u, "no cookie path, no logging");
  assert.doesNotMatch(handler, /eviSystemPrompt|callEviModel|takeEviSlot/u, "no prompt, model or limiter code of its own");
});

// ---------------------------------------------------------------------------------------------------------------------
// GET: «есть ли у сервера ключ Эви» (приложение не предлагает разговор, который заведомо не ответит, как страница «Профессий»)

const STATUS_URL = "https://app.evoadmissions.com/api/portal/mobile/evi";
const get = (headers = { authorization: `Bearer ${TOKEN}` }, method = "GET") => new Request(STATUS_URL, { method, headers });

function statusHarness({ env = ENV, resolve } = {}) {
  const state = { resolved: [] };
  const handler = createStudentPortalMobileEviStatusHandler({
    async resolveActor(token) {
      state.resolved.push(token);
      return resolve ? resolve(token) : { status: "authenticated", actor: STUDENT };
    },
    env,
  });
  return { handler, state };
}

test("status: no token, a malformed token or another scheme is 401 before anything is resolved; cookies are never read or set", async () => {
  const { handler, state } = statusHarness();
  for (const headers of [{}, { authorization: "Bearer" }, { authorization: "Bearer not-a-jwt" }, { authorization: `Basic ${TOKEN}` }, { authorization: `Bearer ${TOKEN} extra` }, { cookie: "sb-access-token=abc; sb-refresh-token=def" }]) {
    const response = await handler(get(headers));
    assert.equal(response.status, 401, JSON.stringify(headers));
    assert.deepEqual(await response.json(), { error: "unauthorized" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.deepEqual(state.resolved, []);
});

test("status: an expired or rejected session is 401, a staff account or any non-student is 403, an unavailable authority is 503 - as for the turn", async () => {
  const outcomes = [
    [{ status: "invalid", actor: null, reason: "supabase_session_invalid" }, 401, "unauthorized"],
    [{ status: "anonymous", actor: null }, 401, "unauthorized"],
    [{ status: "invalid", actor: null, reason: "student_authority_invalid" }, 403, "not_a_student"],
    [{ status: "invalid", actor: null, reason: "student_authority_unavailable" }, 503, "unavailable"],
  ];
  for (const [result, status, error] of outcomes) {
    const { handler } = statusHarness({ resolve: () => result });
    const response = await handler(get());
    assert.equal(response.status, status, JSON.stringify(result));
    assert.deepEqual(await response.json(), { error });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    // Отказ тем же словом, что у POST: приложение не отличает два маршрута по тексту ошибки.
    const turn = harness({ resolve: () => result });
    const turnResponse = await turn.handler(post({ history: HISTORY }));
    assert.equal(turnResponse.status, status);
    assert.deepEqual(await turnResponse.json(), { error });
  }
});

test("status: with the key set on the server the answer is exactly { available: true }, uncached, and never carries the key", async () => {
  const { handler, state } = statusHarness();
  const response = await handler(get());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("set-cookie"), null);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { available: true });
  assert.deepEqual(Object.keys(JSON.parse(text)), ["available"]);
  assert.ok(!text.includes(KEY) && !text.includes("sk-ant"), "the key is never part of the answer");
  assert.deepEqual(state.resolved, [TOKEN], "the caller is verified with the token before the flag is read");
});

test("status: no key, an empty key or a blank key on the server is { available: false } - the same check the web page makes", async () => {
  for (const env of [{}, { EVO_EVI_ANTHROPIC_API_KEY: "" }, { EVO_EVI_ANTHROPIC_API_KEY: "   " }, { EVO_EVI_ANTHROPIC_API_KEY: undefined }, { OTHER_KEY: KEY }]) {
    const { handler } = statusHarness({ env });
    const response = await handler(get());
    assert.equal(response.status, 200, JSON.stringify(env));
    assert.deepEqual(await response.json(), { available: false }, JSON.stringify(env));
    // Совпадение с проверкой страницы веба (`readEviApiKey(process.env) !== null`), а не вторая своя.
    assert.equal(readEviApiKey(env) !== null, false);
  }
  for (const env of [ENV, { EVO_EVI_ANTHROPIC_API_KEY: ` ${KEY} ` }]) {
    assert.equal(readEviApiKey(env) !== null, true);
    assert.deepEqual(await (await statusHarness({ env }).handler(get())).json(), { available: true });
  }
});

test("status: without an injected environment the flag follows the server's process.env at the time of each request", async () => {
  const before = process.env.EVO_EVI_ANTHROPIC_API_KEY;
  try {
    const handler = createStudentPortalMobileEviStatusHandler({ resolveActor: async () => ({ status: "authenticated", actor: STUDENT }) });
    delete process.env.EVO_EVI_ANTHROPIC_API_KEY;
    assert.deepEqual(await (await handler(get())).json(), { available: false });
    process.env.EVO_EVI_ANTHROPIC_API_KEY = KEY;
    assert.deepEqual(await (await handler(get())).json(), { available: true });
  } finally {
    if (before === undefined) delete process.env.EVO_EVI_ANTHROPIC_API_KEY; else process.env.EVO_EVI_ANTHROPIC_API_KEY = before;
  }
});

test("status: it is read-only - no database client, no model call, no rate slot is spent, and it works for a student who has used up the turn limit", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); throw new Error("the status route must not call the network"); };
  try {
    const first = harness();
    for (let index = 0; index < 40; index += 1) assert.equal((await (await first.handler(post({ history: HISTORY }))).json()).ok, true);
    assert.deepEqual(await (await first.handler(post({ history: HISTORY }))).json(), { ok: false, reason: "busy" });
    const { handler } = statusHarness();
    for (let index = 0; index < 5; index += 1) assert.deepEqual(await (await handler(get())).json(), { available: true });
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = realFetch;
  }
  const handlerSource = read("src/lib/server/student-portal-mobile-evi-route-handler.ts");
  const status = handlerSource.slice(handlerSource.indexOf("export function createStudentPortalMobileEviStatusHandler"));
  assert.doesNotMatch(status, /createClient|createSupabase|runTurn|callEviModel|takeEviSlot|cookies\(|console\./u);
  assert.match(status, /readEviApiKey\(deps\.env \?\? process\.env\) !== null/u);
});

test("status: the web page and the status route use one key check, so «Эви отвечает» cannot drift between them", () => {
  const page = read("src/app/(portal)/portal/professions/page.tsx");
  assert.match(page, /const eviOnline = readEviApiKey\(process\.env\) !== null;/u);
  assert.match(page, /import \{ eviOwnerKey, readEviApiKey \} from "@\/lib\/server\/evi\/messages";/u);
  assert.match(read("src/lib/server/student-portal-mobile-evi-route-handler.ts"), /import \{ readEviApiKey, type Env \} from "\.\/evi\/messages\.ts";/u);
  // Ядро разговора берёт ключ той же функцией: без ключа ход отвечает «unavailable», и это то же состояние.
  assert.match(read("src/lib/portal/evi-core.ts"), /readEviApiKey\(dependencies\.env \?\? process\.env\)/u);
});

test("status: nothing is read from the request body or its content type", async () => {
  const { handler } = statusHarness();
  // Метод выбирает Next по экспорту маршрута; обработчик тело не читает, лишний заголовок ничего не меняет.
  const response = await handler(new Request(STATUS_URL, { method: "GET", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: true });
});
