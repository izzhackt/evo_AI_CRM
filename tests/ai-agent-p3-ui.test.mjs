// «ИИ-агент» P3 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §9, §12.1, §15 P3):
// CRM-сторона памяти о клиенте — маршруты `GET/DELETE
// /api/v3/ai-agent/conversations/[id]/memory` (сессия, same-origin, строгий
// UUID в контракте прокси, коды базы), чистый контракт блока «Что ИИ знает о
// клиенте» и переключателя «Память о клиенте», и тексты интерфейса. База —
// подделка с записью вызовов; данные синтетические, ни агента, ни Gemini. Что
// сотрудник может прочитать, забыть и включить, решает база (274,
// supabase/tests/platform_ai_agent_p3.sql в ветке P3 SQL).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { build } from "esbuild";
import { NextRequest } from "next/server.js";

import { normalizeAiSettings } from "../src/lib/v3/ai-agent.ts";
import {
  AI_MEMORY_COPY,
  AI_MEMORY_INTEREST_LIMIT,
  AI_MEMORY_SETTINGS_COPY,
  AI_MEMORY_SUMMARY_LIMIT,
  AI_MEMORY_WINDOW,
  aiLeadLine,
  aiMemoryHint,
  aiMemoryInterestState,
  aiMemoryMeta,
  aiMemoryState,
  aiMemorySummaryState,
  aiMemoryUpdated,
  aiMessagesDative,
  normalizeAiMemoryView,
} from "../src/lib/v3/ai-agent-memory.ts";
import {
  aiMemoryClearOutcome,
  createAiMemoryClearHandler,
  createAiMemoryReadHandler,
} from "../src/lib/server/ai-agent-route-handlers.ts";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformPrivateApi,
  isRetiredPlatformRoute,
} from "../src/lib/platform-route-contract.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = (n) => `27400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACTOR = Object.freeze({ organizationId: ID(90), membershipId: ID(91) });
const NOW = new Date("2026-10-06T10:00:00Z"); // 16:00 по Бишкеку

// Форма `ai_agent_memory_v1` (274) целиком: active = включена и согласие есть;
// summaryDue/interestDue — false, пока память не работает.
const RAW = Object.freeze({
  enabled: true, consentRecorded: true, active: true, canManage: true, messageCount: 45, summaryDue: false, interestDue: false,
  memory: {
    interest: "Магистратура по IT в Малайзии,\nбюджет до 6 000 $ в год",
    summary: "Клиент выбирает между Малайзией и Китаем. Предложили две программы.",
    coveredCount: 25, updatedAt: "2026-10-06T08:20:00Z",
  },
  lead: { name: "Айгуль", interestDirection: "MY", stage: "qualified" },
});
const view = (overrides = {}) => normalizeAiMemoryView({ ...RAW, ...overrides });

// ------------------------------------------------------------ contract

test("view: strict shape; interest is one line ≤ 140, summary ≤ 1500; lead keeps only what the model sees", () => {
  const ready = view();
  assert.equal(ready.memory.interest, "Магистратура по IT в Малайзии, бюджет до 6 000 $ в год");
  assert.equal(ready.memory.coveredCount, 25);
  assert.deepEqual(ready.lead, { name: "Айгуль", interestDirection: "MY", stage: "qualified" });
  assert.equal(view({ memory: { ...RAW.memory, interest: "и".repeat(400) } }).memory.interest.length, AI_MEMORY_INTEREST_LIMIT);
  assert.equal(view({ memory: { ...RAW.memory, summary: "с".repeat(4000) } }).memory.summary.length, AI_MEMORY_SUMMARY_LIMIT);
  // Пустые строки — «нет», а не пустая сводка; дата не ISO — без даты.
  const blank = view({ memory: { interest: "  ", summary: "", coveredCount: -1, updatedAt: "вчера" } });
  assert.deepEqual(blank.memory, { interest: null, summary: null, coveredCount: 0, updatedAt: null });
  // Имя, похожее на номер или адрес, не показывается (как в карточке модели); ключи — только ключи.
  assert.deepEqual(view({ lead: { name: "+996555", interestDirection: "MY<script>", stage: "new" } }).lead,
    { name: null, interestDirection: null, stage: "new" });
  assert.equal(view({ memory: null, lead: null }).memory, null);
  for (const bad of [null, [], {}, { ...RAW, enabled: "yes" }, { ...RAW, messageCount: -1 }, { ...RAW, messageCount: 1.5 },
    { ...RAW, canManage: undefined }, { ...RAW, memory: "сводка" }, { ...RAW, memory: { ...RAW.memory, summary: 7 } }, { ...RAW, lead: [] },
    { ...RAW, active: undefined }, { ...RAW, summaryDue: null }, { ...RAW, interestDue: "true" },
    // active без включённой памяти или согласия база (274) не отдаёт.
    { ...RAW, enabled: false, active: true }, { ...RAW, consentRecorded: false, active: true }]) {
    assert.throws(() => normalizeAiMemoryView(bad), /ai_agent_shape_invalid/u, JSON.stringify(bad));
  }
  assert.deepEqual(Object.keys(view()).sort(),
    ["active", "canManage", "consentRecorded", "enabled", "interestDue", "lead", "memory", "messageCount", "summaryDue"]);
  // «Пора» без работающей памяти не бывает.
  const paused = view({ active: false, summaryDue: true, interestDue: true });
  assert.equal(paused.summaryDue, false);
  assert.equal(paused.interestDue, false);
});

test("states follow 274: off, paused (no consent), short, waiting (21–25), due (summaryDue), ready — and the collapsed hint", () => {
  assert.equal(aiMemoryState(view({ enabled: false, active: false, memory: null })), "off");
  assert.equal(aiMemoryHint(view({ enabled: false, active: false, memory: null })), "Память выключена");
  // Включена без согласия: в 274 отзыв выключает память, так что это защитный ответ
  // (active=false, memory=null) — блок говорит «на паузе», а не «готовится».
  const revoked = view({ consentRecorded: false, active: false, memory: null, messageCount: 45 });
  assert.equal(aiMemoryState(revoked), "paused");
  assert.equal(aiMemoryHint(revoked), "Память на паузе");
  // Окно (08.10, «давай без этого»): пауза одной строкой, без слов о согласии на Gemini.
  assert.equal(AI_MEMORY_COPY.paused, "Память на паузе: сводка и интерес не собираются.");
  assert.equal(aiMemorySummaryState("paused"), null);
  // ≤ 20 сообщений — сводка не нужна.
  assert.equal(aiMemoryState(view({ messageCount: AI_MEMORY_WINDOW, memory: null })), "short");
  assert.equal(aiMemoryHint(view({ messageCount: 12, memory: null })), "Вся переписка на виду у ИИ");
  // 21–25 сообщений: за окном меньше шести — summaryDue false, сводки не будет, пока переписка не вырастет.
  for (const messageCount of [AI_MEMORY_WINDOW + 1, 25]) {
    const waiting = view({ messageCount, memory: null });
    assert.equal(aiMemoryState(waiting), "waiting", String(messageCount));
    assert.equal(aiMemoryHint(waiting), "Сводка пока не нужна");
    assert.equal(aiMemorySummaryState("waiting"), "Сводка появится, когда переписка станет длиннее.");
  }
  // Пора — только по summaryDue базы. Указатель ставят и новое сообщение клиента, и
  // «Забыть», и включение (274), а стоит ли он сейчас, база не отдаёт: «соберёт сам», без срока.
  const due = view({ messageCount: 26, summaryDue: true, memory: null });
  assert.equal(aiMemoryState(due), "due");
  assert.equal(aiMemoryHint(due), "Сводки пока нет");
  assert.equal(aiMemorySummaryState("due"), "Сводки пока нет — ИИ соберёт её сам.");
  // Интерес: последнее сообщение клиента не учтено — ИИ определит сам; учтено (или клиент не писал) — ждём сообщения.
  assert.equal(aiMemoryInterestState(view({ memory: null, interestDue: true })), "Интереса пока нет — ИИ определит его сам.");
  assert.equal(aiMemoryInterestState(view({ memory: null, interestDue: false })), "Интерес появится после следующего сообщения клиента.");
  assert.equal(aiMemoryInterestState(view({ memory: { ...RAW.memory, interest: null }, interestDue: false })),
    "Интерес появится после следующего сообщения клиента.");
  assert.equal(aiMemoryInterestState(view({ interestDue: true })), null, "a known interest is shown, not a state");
  assert.equal(aiMemoryInterestState(view({ active: false, memory: null, interestDue: true })),
    "Интерес появится после следующего сообщения клиента.", "interestDue never survives a stopped memory");
  assert.equal(aiMemoryState(view({ summaryDue: true, memory: { ...RAW.memory, summary: null } })), "due");
  assert.equal(aiMemoryState(view({ summaryDue: false, memory: { ...RAW.memory, summary: null } })), "waiting");
  assert.equal(aiMemoryState(view()), "ready");
  assert.equal(aiMemoryState(view({ summaryDue: true })), "ready", "an older summary stays shown while a new one is due");
  assert.equal(aiMemoryHint(view()), "Магистратура по IT в Малайзии, бюджет до 6 000 $ в год");
  assert.equal(aiMemoryHint(view({ memory: { ...RAW.memory, interest: null } })), "Интереса пока нет");
  for (const text of Object.values(AI_MEMORY_COPY)) assert.doesNotMatch(text, /готовится/u, "nothing promises a build that is not running");
});

test("lead line: «Имя · Направление · Этап», only what the card has; no card is said so", () => {
  assert.equal(aiLeadLine(view().lead), "Айгуль · Малайзия · Квалифицирован");
  assert.equal(aiLeadLine({ name: null, interestDirection: "CN", stage: "meeting_scheduled" }), "Китай · Встреча назначена");
  assert.equal(aiLeadLine({ name: "Бакыт", interestDirection: "XX", stage: "unknown_stage" }), "Бакыт");
  assert.equal(aiLeadLine({ name: null, interestDirection: null, stage: null }), "В карточке лида пусто.");
  assert.equal(aiLeadLine(null), "Карточки лида нет.");
});

test("meta: «Сводка по N сообщениям · обновлена 14:20» in Bishkek time; yesterday and older days in words", () => {
  for (const [n, word] of [[1, "1 сообщению"], [3, "3 сообщениям"], [11, "11 сообщениям"], [21, "21 сообщению"], [25, "25 сообщениям"], [111, "111 сообщениям"]]) {
    assert.equal(aiMessagesDative(n), word);
  }
  assert.equal(aiMemoryUpdated("2026-10-06T08:20:00Z", NOW), "14:20");
  assert.equal(aiMemoryUpdated("2026-10-05T18:30:00Z", NOW), "00:30", "after midnight in Bishkek is today");
  assert.equal(aiMemoryUpdated("2026-10-05T08:20:00Z", NOW), "вчера в 14:20");
  assert.equal(aiMemoryUpdated("2026-10-01T08:20:00Z", NOW), "1 октября в 14:20");
  assert.equal(aiMemoryUpdated("2025-12-30T08:20:00Z", NOW), "30 декабря 2025 в 14:20");
  assert.equal(aiMemoryUpdated("не дата", NOW), null);
  assert.equal(aiMemoryMeta(view().memory, NOW), "Сводка по 25 сообщениям · обновлена 14:20");
  assert.equal(aiMemoryMeta({ ...view().memory, updatedAt: null }, NOW), "Сводка по 25 сообщениям");
  assert.equal(aiMemoryMeta({ ...view().memory, summary: null }, NOW), null, "no summary — no meta");
});

test("settings: memoryEnabled comes from ai_agent_settings_v1 and is off unless the database says true", () => {
  const settings = {
    version: 7, models: { answer: "a", fast: "f", embedding: "e" }, unpricedModels: [], monthlyCapUsd: 50, ratePerMemberMinute: 20,
    consent: { recorded: true, at: null, byName: null, textVersion: null }, canManage: true, isAdmin: false,
  };
  assert.equal(normalizeAiSettings(settings).memoryEnabled, false);
  assert.equal(normalizeAiSettings({ ...settings, memoryEnabled: "true" }).memoryEnabled, false);
  assert.equal(normalizeAiSettings({ ...settings, memoryEnabled: true }).memoryEnabled, true);
});

// ------------------------------------------------------------ routes

function deps(overrides = {}) {
  const calls = [];
  return {
    calls,
    authorize: async () => ({ status: "authorized", actor: ACTOR }),
    readMemory: async (actor, conversationId) => { calls.push(["read", actor, conversationId]); return view(); },
    clearMemory: async (actor, conversationId, requestId) => { calls.push(["clear", actor, conversationId, requestId]); return { status: "cleared", deleted: true, enqueued: true }; },
    ...overrides,
  };
}
const origin = { origin: "https://crm.test", host: "crm.test" };
const memoryPath = (id = ID(1)) => `/api/v3/ai-agent/conversations/${id}/memory`;
const get = (path = memoryPath()) => new Request(`https://crm.test${path}`);
const del = (body, headers = origin, path = memoryPath()) => new Request(`https://crm.test${path}`, {
  method: "DELETE", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const conversation = (id = ID(1)) => ({ params: Promise.resolve({ conversationId: id }) });

test("GET memory: the staff session reads ai_agent_memory_v1 for this conversation — no agent, no Gemini", async () => {
  const dependencies = deps();
  const handler = createAiMemoryReadHandler(dependencies);
  const response = await handler(get(), conversation());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.memory.memory.summary, RAW.memory.summary);
  assert.deepEqual(normalizeAiMemoryView(body.memory), view(), "the window re-reads the same shape");
  assert.deepEqual(dependencies.calls, [["read", ACTOR, ID(1)]]);
  assert.equal(Object.hasOwn(dependencies, "config"), false, "memory needs no agent secret");
});

test("GET memory: refusals — session, preview, bad id, query string, database 42501/P0002, failure", async () => {
  const cases = [
    [deps({ authorize: async () => ({ status: "anonymous", actor: null }) }), 401, "authentication_required"],
    [deps({ authorize: async () => ({ status: "preview", actor: null }) }), 403, "preview"],
    [deps({ authorize: async () => ({ status: "forbidden", actor: null }) }), 403, "forbidden"],
    [deps({ readMemory: async () => "forbidden" }), 403, "forbidden"],
    [deps({ readMemory: async () => "not_found" }), 404, "not_found"],
    [deps({ readMemory: async () => { throw new Error("db down"); } }), 503, "unavailable"],
  ];
  for (const [dependencies, status, code] of cases) {
    const response = await createAiMemoryReadHandler(dependencies)(get(), conversation());
    assert.equal(response.status, status, code);
    assert.deepEqual(await response.json(), { error: { code } });
  }
  const handler = createAiMemoryReadHandler(deps());
  assert.equal((await handler(get(), conversation("x"))).status, 400);
  assert.equal((await handler(get(), conversation("00000000-0000-0000-0000-000000000000"))).status, 400);
  assert.equal((await handler(get(`${memoryPath()}?full=1`), conversation())).status, 400);
});

test("DELETE memory: «Забыть сводку» — same origin, exact {requestId}, the database decides; replay is the same id", async () => {
  const dependencies = deps();
  const handler = createAiMemoryClearHandler(dependencies);
  const response = await handler(del({ requestId: ID(7) }), conversation());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true, enqueued: true });
  assert.deepEqual(dependencies.calls, [["clear", ACTOR, ID(1), ID(7)]]);
  const idle = createAiMemoryClearHandler(deps({ clearMemory: async () => ({ status: "cleared", deleted: false, enqueued: false }) }));
  assert.deepEqual(await (await idle(del({ requestId: ID(8) }), conversation())).json(), { deleted: false, enqueued: false });

  for (const [request, status] of [
    [del({ requestId: ID(7) }, { host: "crm.test" }), 403],
    [del({ requestId: ID(7) }, { origin: "https://evil.test", host: "crm.test" }), 403],
    [del({}), 400],
    [del({ requestId: "x" }), 400],
    [del({ requestId: ID(7), text: "сводка" }), 400],
    [del("not json"), 400],
    [del({ requestId: ID(7) }, origin, `${memoryPath()}?all=1`), 400],
  ]) {
    const calls = deps();
    assert.equal((await createAiMemoryClearHandler(calls)(request, conversation())).status, status);
    assert.equal(calls.calls.length, 0, "nothing reaches the database");
  }
  for (const [result, status, code] of [
    [{ status: "conflict" }, 409, "request_conflict"], [{ status: "forbidden" }, 403, "forbidden"],
    [{ status: "not_found" }, 404, "not_found"], [{ status: "invalid" }, 400, "invalid_request"], [{ status: "unavailable" }, 503, "unavailable"],
  ]) {
    const response = await createAiMemoryClearHandler(deps({ clearMemory: async () => result }))(del({ requestId: ID(7) }), conversation());
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }
  const preview = createAiMemoryClearHandler(deps({ authorize: async () => ({ status: "preview", actor: null }) }));
  assert.equal((await preview(del({ requestId: ID(7) }), conversation())).status, 403);
});

test("clear outcome: the real 274 receipt says whether a row was there and whether the rebuild is queued", () => {
  // Квитанция ai_agent_memory_clear_v1 (274) через ai_request_finish (269): status, conversationId, deleted, enqueued, replayed.
  assert.deepEqual(aiMemoryClearOutcome(null, { status: "cleared", conversationId: ID(1), deleted: true, enqueued: true, replayed: false }),
    { status: "cleared", deleted: true, enqueued: true });
  // Память не работает или собирать нечего — пересборка не поставлена.
  assert.deepEqual(aiMemoryClearOutcome(null, { status: "cleared", conversationId: ID(1), deleted: false, enqueued: false, replayed: false }),
    { status: "cleared", deleted: false, enqueued: false });
  // Повтор тем же id — прежняя квитанция с replayed=true: тот же итог.
  assert.deepEqual(aiMemoryClearOutcome(null, { status: "cleared", conversationId: ID(1), deleted: true, enqueued: true, replayed: true }),
    { status: "cleared", deleted: true, enqueued: true });
  // Чужая форма — не «удалено»; квитанция без enqueued — не 274.
  for (const data of [null, [], {}, { cleared: true }, { status: "cleared" }, { status: "cleared", deleted: "true", enqueued: true },
    { status: "cleared", conversationId: ID(1), deleted: true, replayed: false }, { status: "cleared", deleted: true, enqueued: "true" },
    { status: "applied", deleted: true, enqueued: true }]) {
    assert.deepEqual(aiMemoryClearOutcome(null, data), { status: "unavailable" }, JSON.stringify(data));
  }
  assert.deepEqual(aiMemoryClearOutcome({ code: "PT409" }, null), { status: "conflict" });
  assert.deepEqual(aiMemoryClearOutcome({ code: "23505" }, null), { status: "conflict" });
  assert.deepEqual(aiMemoryClearOutcome({ code: "42501" }, null), { status: "forbidden" });
  assert.deepEqual(aiMemoryClearOutcome({ code: "P0002" }, null), { status: "not_found" });
  assert.deepEqual(aiMemoryClearOutcome({ code: "22023" }, null), { status: "invalid" });
  assert.deepEqual(aiMemoryClearOutcome({ code: "57014" }, null), { status: "unavailable" });
});

// ------------------------------------------------------------ route contract

const MEMORY_NEAR_MISSES = [
  "/api/v3/ai-agent/conversations/memory",
  `/api/v3/ai-agent/conversations/${ID(1)}/memory/`,
  `/api/v3/ai-agent/conversations/${ID(1)}/memory/x`,
  `/api/v3/ai-agent/conversations/${ID(1)}/memories`,
  "/api/v3/ai-agent/conversations/0D6F2C3E-9A41-4B7E-B2A8-5C1E7F90AB34/memory",
  "/api/v3/ai-agent/conversations/27400000-0000-0000-8000-000000000001/memory", // версия 0
  "/api/v3/ai-agent/conversations/27400000-0000-4000-c000-000000000001/memory", // вариант не RFC
  "/api/v3/ai-agent/conversations/27400000-0000-4000-8000-00000000001/memory",
  "/api/v3/ai-agent/conversations/x/memory",
  `/api/v3/ai-agent/memory/${ID(1)}`,
];

test("route contract: memory GET/DELETE is connected with a strict lowercase RFC UUID; near misses stay closed", () => {
  for (const id of [ID(1), "0d6f2c3e-9a41-4b7e-b2a8-5c1e7f90ab34", "0d6f2c3e-9a41-1b7e-a2a8-5c1e7f90ab34"]) {
    const path = memoryPath(id);
    assert.equal(isConnectedPlatformApi(path), true, path);
    assert.equal(isConnectedPlatformPrivateApi(path), false, path);
    assert.equal(isConnectedPlatformPage(path), false, path);
    assert.equal(isRetiredPlatformRoute(path), false, path);
  }
  for (const path of MEMORY_NEAR_MISSES) assert.equal(isConnectedPlatformApi(path), false, path);
  // Урок 06.10: каждый новый route.ts — под шаблоном контракта, иначе в production 403.
  const file = "src/app/api/v3/ai-agent/conversations/[conversationId]/memory/route.ts";
  const source = read(file);
  assert.match(source, /export const runtime = "nodejs";/u);
  assert.match(source, /export const dynamic = "force-dynamic";/u);
  assert.match(source, /export const GET = createAiMemoryReadHandler\(\);/u);
  assert.match(source, /export const DELETE = createAiMemoryClearHandler\(\);/u);
  assert.doesNotMatch(source, /export const (?:POST|PUT|PATCH)/u);
  assert.equal(isConnectedPlatformApi(`/${file.replace(/^src\/app\//u, "").replace(/\/route\.ts$/u, "").replace("[conversationId]", ID(1))}`), true);
});

async function loadBundledProxy() {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL("../src/proxy.ts", import.meta.url))],
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports.proxy;
}

test("real proxy: GET and DELETE memory reach the session gate (401); near misses are 403 not connected", async () => {
  const proxy = await loadBundledProxy();
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:45421";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_routing-boundary-only";
  const request = (path, method) => new NextRequest(`https://crm.evoadmissions.com${path}`, { method, headers: { host: "crm.evoadmissions.com" } });
  try {
    for (const method of ["GET", "DELETE"]) {
      const response = await proxy(request(memoryPath(), method));
      assert.equal(response.status, 401, method);
      assert.deepEqual(await response.json(), { error: "authentication_required" }, method);
    }
    for (const path of MEMORY_NEAR_MISSES) {
      const response = await proxy(request(path, "GET"));
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).error, "platform_route_not_connected", path);
    }
  } finally {
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.key;
  }
});

// ------------------------------------------------------------ UI source

test("UI window: a collapsed «Что ИИ знает о клиенте» under the answer, read on open, never blocking the answer", () => {
  const assistant = read("src/components/v3/inbox/InboxAiAssistant.tsx");
  const body = assistant.slice(assistant.indexOf('<div className="v3-ai-body">'));
  // Окно «как в SoodaCloser» (08.10): ответ, «Стоит уточнить», «Источники», «Почему такой ответ», затем память.
  const at = (needle) => { const index = body.indexOf(needle); assert.notEqual(index, -1, needle); return index; };
  assert.ok(at('data-testid="v3-ai-answer"') < at("Стоит уточнить"));
  assert.ok(at("Стоит уточнить") < at('data-testid="v3-ai-sources"'));
  assert.ok(at('data-testid="v3-ai-sources"') < at("Почему такой ответ"));
  assert.ok(at("Почему такой ответ") < at("<InboxAiMemory conversationId={conversationId} />"),
    "the memory block follows the answer and its sources");
  assert.ok(at("<InboxAiMemory conversationId={conversationId} />") < at("Обновить ответ\n"), "«Обновить ответ» closes the card");
  // Память — в одном и том же месте дерева во всех состояниях: смена состояния её не перечитывает.
  // Лимит, баланс, квота, выключенный агент и нет согласия её не прячут — это её единственное место
  // («Забыть сводку», исключение из автоответчика); нет её только без права на чат и в просмотре роли.
  assert.match(body, /\{showExtras \? \(\n\s+<div className="v3-ai-extras">\n\s+<InboxAiMemory conversationId=\{conversationId\} \/>/u);
  assert.match(assistant, /const NO_EXTRAS = new Set\(\["forbidden", "preview"\]\);/u);
  assert.match(assistant, /const showExtras = !\(phase\.kind === "blocked" && NO_EXTRAS\.has\(phase\.code\)\);/u);
  const memory = read("src/components/v3/inbox/InboxAiMemory.tsx");
  assert.match(memory, /<details className="v3-ai-memory"/u);
  assert.doesNotMatch(memory, /<details[^>]*\bopen\b/u, "collapsed by default");
  assert.match(memory, /`\/api\/v3\/ai-agent\/conversations\/\$\{conversationId\}\/memory`/u);
  assert.match(memory, /method: "DELETE"/u);
  const urls = [...memory.matchAll(/fetch\(`([^`]+)`/gu)].map((match) => match[1]);
  assert.deepEqual(urls, ["/api/v3/ai-agent/conversations/${conversationId}/memory", "/api/v3/ai-agent/conversations/${conversationId}/memory"],
    "the block only reads and clears its memory — never the agent's answer route");
  // Неизвестный итог «Забыть» повторяется тем же id запроса.
  assert.match(memory, /if \(outcome !== "unknown"\) requestId\.current = null;/u);
  assert.equal(AI_MEMORY_COPY.title, "Что ИИ знает о клиенте");
  assert.equal(AI_MEMORY_COPY.off, "Память о клиенте выключена.");
  assert.equal(AI_MEMORY_COPY.short, "ИИ видит всю переписку — сводка не нужна.");
  assert.equal(AI_MEMORY_COPY.waiting, "Сводка появится, когда переписка станет длиннее.");
  assert.equal(AI_MEMORY_COPY.due, "Сводки пока нет — ИИ соберёт её сам.");
  assert.equal(AI_MEMORY_COPY.interestDue, "Интереса пока нет — ИИ определит его сам.");
  assert.equal(AI_MEMORY_COPY.noInterest, "Интерес появится после следующего сообщения клиента.");
  assert.equal(AI_MEMORY_COPY.noLead, "Карточки лида нет.");
  assert.equal(AI_MEMORY_COPY.unavailable, "Память этого чата недоступна.");
  // clear удаляет и интерес и, пока память работает, сразу ставит пересборку (274, enqueued).
  assert.equal(AI_MEMORY_COPY.forgetConfirm, "Сводка и интерес удалятся. ИИ сразу начнёт собирать их заново.");
  assert.equal(AI_MEMORY_COPY.forgotten, "Сводка и интерес удалены.");
  assert.equal(AI_MEMORY_COPY.forgottenRebuilding, "Сводка и интерес удалены — ИИ собирает их заново.");
  // Сводку не обещают «после следующего сообщения клиента»: «Забыть» и включение ставят её сразу.
  for (const text of Object.values(AI_MEMORY_COPY)) assert.doesNotMatch(text, /собер[её]т (?:её|их).*после следующего сообщения/u, text);
  // Итог «Забыть» — по квитанции: пересборка в очереди — так и сказано, иначе без обещания.
  assert.match(memory, /if \(response\.ok\) enqueued = await response\.json\(\)\.then\(\(body: \{ enqueued\?: unknown \}\) => body\.enqueued === true, \(\) => false\);/u);
  assert.match(memory, /text: enqueued \? AI_MEMORY_COPY\.forgottenRebuilding : AI_MEMORY_COPY\.forgotten/u);
  assert.match(memory, /\{memory\?\.interest \?\? aiMemoryInterestState\(view\)\}/u);
  for (const word of ["Интерес", "Сводка", "Карточка лида", "Показать всё"]) assert.ok(memory.includes(word), word);
  // Окно (08.10, «давай без этого»): ни «Включить» в «Расходы», ни слов о согласии — выключено и пауза одной строкой.
  const memoryCode = memory.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  assert.doesNotMatch(memoryCode, /<Link\b|href=|AI_MEMORY_SETTINGS_COPY|Gemini|согласи/u);
  assert.match(memory, /data-testid="v3-ai-memory-off">\{AI_MEMORY_COPY\.off\}<\/p>/u);
  assert.match(memory, /data-testid="v3-ai-memory-paused">\{AI_MEMORY_COPY\.paused\}<\/p>/u);
  for (const text of Object.values(AI_MEMORY_COPY)) assert.doesNotMatch(text, /Gemini|согласи|Включить/u, text);
  // Интерес и сводка — только пока память работает (не off и не paused).
  assert.match(memory, /const running = state !== null && state !== "off" && state !== "paused";/u);
  // Окончательный отказ (400/401/403/404) — без «Повторить» и без role=alert.
  assert.match(memory, /const FINAL_STATUSES = new Set\(\[400, 401, 403, 404\]\);/u);
  // Раскрыто — строка интереса под заголовком скрыта (не повторяет «Интерес»).
  assert.match(read("src/app/(v3)/ai-agent.css"), /\.v3-ai-memory\[open\] \.v3-ai-memory-hint \{\s*display: none;/u);
  const css = read("src/app/(v3)/ai-agent.css");
  assert.match(css, /\.v3-ai-memory-summary\[data-clamped\] \{[^}]*-webkit-line-clamp: 6;/u);
});

test("UI section: «Память о клиенте» in «Агент и лимит» — status, toggle, disable confirm, no consent is disabled", () => {
  const views = read("src/components/v3/ai-agent/AiAgentViews.tsx");
  const settings = views.slice(views.indexOf("function AiMemorySettings"));
  assert.match(views, /<AiMemorySettings settings=\{data\} preview=\{preview\} requestId=\{memoryRequestId\} \/>/u);
  assert.match(settings, /id="ai-memory"/u);
  assert.match(settings, /action=\{saveAiMemoryAction\}/u);
  assert.match(settings, /settings\.canManage && !preview/u);
  assert.match(settings, /<AiMemoryToggle\s/u);
  // Один клиентский переключатель на оба положения: строка итога вне ветвей переживает перерисовку.
  const toggle = read("src/components/v3/ai-agent/AiMemoryToggle.tsx");
  assert.match(toggle, /^"use client";/u);
  assert.match(toggle, /hidden\("enable"\)/u);
  assert.match(toggle, /hidden\("disable"\)/u);
  assert.match(toggle, /aria-disabled="true"\s+aria-describedby="ai-memory-consent-hint"/u);
  assert.match(toggle, /<details className="group" data-testid="v3-ai-memory-disable">/u, "disable is confirmed by disclosure");
  const branchesEnd = toggle.indexOf("{/* Вне ветвей");
  assert.ok(branchesEnd > toggle.indexOf("</details>"), "the status line follows the branches");
  assert.match(toggle.slice(branchesEnd), /<p role="status"[^>]*data-testid="v3-ai-memory-status">\{saved\}<\/p>/u);
  assert.match(toggle, /if \(result\.status === "saved" \|\| result\.status === "conflict" \|\| result\.status === "invalid"\) setRequestId/u);
  assert.equal(AI_MEMORY_SETTINGS_COPY.about, "Сводка длинных переписок и интерес клиента. Тексты уходят в Gemini, фото и файлы\u00A0— нет.");
  assert.equal(AI_MEMORY_SETTINGS_COPY.enable, "Включить память");
  assert.equal(AI_MEMORY_SETTINGS_COPY.disable, "Выключить память");
  assert.equal(AI_MEMORY_SETTINGS_COPY.disableConfirm, "Сводки всех клиентов удалятся.");
  assert.equal(AI_MEMORY_SETTINGS_COPY.noConsent, "Сначала администратор записывает согласие на Gemini.");
  assert.match(read("src/app/(v3)/v3/ai-agent/page.tsx"), /memoryRequestId=\{randomUUID\(\)\}/u);
  // Отзыв согласия (274) выключает память и удаляет сводки всех клиентов; новое согласие её не включает.
  assert.equal(AI_MEMORY_SETTINGS_COPY.revokeConfirm,
    "ИИ перестанет готовить ответы. Память о клиенте выключится, сводки всех клиентов удалятся. После нового согласия память нужно включить снова.");
  assert.equal(AI_MEMORY_SETTINGS_COPY.revokeSubmit, "Отозвать и удалить сводки");
  assert.equal(AI_MEMORY_SETTINGS_COPY.revoked, "Согласие отозвано, память выключена, сводки удалены. После нового согласия память нужно включить снова.");
  const revoke = views.slice(views.indexOf('data-testid="v3-ai-consent-revoke"'), views.indexOf("<AiMemorySettings settings="));
  assert.match(revoke, /\{data\.memoryEnabled \? \(\s*<p [^>]*>\{AI_MEMORY_SETTINGS_COPY\.revokeConfirm\}<\/p>/u, "the consequence is said before the button");
  assert.match(revoke, /label=\{data\.memoryEnabled \? AI_MEMORY_SETTINGS_COPY\.revokeSubmit : /u);
  assert.match(revoke, /saved: data\.memoryEnabled \? AI_MEMORY_SETTINGS_COPY\.revoked : /u);

  const actions = read("src/lib/platform-ai-agent-actions.ts");
  assert.match(actions, /exactActionStringFields\(form, \["request_id", "expected_version", "memory_action"\]\)/u);
  assert.match(actions, /action !== "enable" && action !== "disable"/u);
  const source = read("src/lib/v3/ai-agent-source.ts");
  assert.match(source, /rpc\("ai_agent_memory_toggle_v1", \{\s*p_organization_id: actor\.organizationId, p_enabled: input\.enabled,\s*p_expected_version: input\.expectedVersion, p_request_id: input\.requestId,/u);
  assert.match(source, /code === "PT412" \? "consent_required"/u);
  assert.match(source, /export async function saveAiMemory[\s\S]*?if \(isStaffPreview\(actor\)\) return "forbidden";/u);
  assert.match(read("src/components/v3/ai-agent/AiActionForm.tsx"), /consent_required: "Сначала администратор записывает согласие на Gemini\."/u);
});
