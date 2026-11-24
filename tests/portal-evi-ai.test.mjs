import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resetEviSlots, takeEviSlot } from "../src/lib/server/evi/limiter.ts";
import {
  alternate,
  callEviModel,
  eviEffort,
  EviModelError,
  eviReplyText,
  eviRequestBody,
  readEviApiKey,
} from "../src/lib/server/evi/messages.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const KEY = "sk-ant-synthetic-key-0000000000000002";
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const reply = { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"message":"Привет"}' }] };

test("Эви's key is its own env name; empty means «недоступен»", () => {
  assert.equal(readEviApiKey({ EVO_EVI_ANTHROPIC_API_KEY: ` ${KEY} ` }), KEY);
  assert.equal(readEviApiKey({ EVO_EVI_ANTHROPIC_API_KEY: "   " }), null);
  assert.equal(readEviApiKey({ EVO_ANTHROPIC_API_KEY: KEY }), null, "the CRM agents key is not Эви's");
});

test("the request: Sonnet 5.5, cached system prompt, JSON schema, effort — and none of the parameters it rejects", () => {
  const body = eviRequestBody({
    system: "PROMPT",
    messages: [{ role: "user", content: "a" }, { role: "user", content: "b" }, { role: "assistant", content: "c" }],
    effort: "high",
    schema: { type: "object" },
  });
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.deepEqual(body.system, [{ type: "text", text: "PROMPT", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(body.output_config, { effort: "high", format: { type: "json_schema", schema: { type: "object" } } });
  assert.deepEqual(body.messages, [{ role: "user", content: "a\n\nb" }, { role: "assistant", content: "c" }]);
  for (const field of ["thinking", "temperature", "top_p", "top_k"]) assert.equal(field in body, false, field);
  assert.ok(body.max_tokens >= 16_000, "thinking counts toward max_tokens");
  assert.deepEqual(alternate([]), []);
});

test("effort: medium on questions, high from the 7th student message (the result window)", () => {
  assert.equal(eviEffort(1), "medium");
  assert.equal(eviEffort(6), "medium");
  assert.equal(eviEffort(7), "high");
  assert.equal(eviEffort(14), "high");
});

test("the reply text comes from text blocks; a refusal, a cut-off or no text is not read", () => {
  assert.equal(eviReplyText(reply), '{"message":"Привет"}');
  assert.throws(() => eviReplyText({ ...reply, stop_reason: "refusal" }), (error) => error instanceof EviModelError && error.code === "refused");
  assert.equal(eviReplyText({ ...reply, stop_reason: "max_tokens" }), null);
  assert.equal(eviReplyText({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }] }), null);
  assert.equal(eviReplyText(null), null);
});

test("the call: one POST with Эви's key, one retry on 429/5xx/network, none on a bad request", async () => {
  const calls = [];
  const fetchOk = async (url, init) => {
    calls.push({ url, init });
    return ok(reply);
  };
  assert.equal(await callEviModel({ apiKey: KEY, body: { a: 1 }, fetch: fetchOk, sleep: async () => {} }), '{"message":"Привет"}');
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], KEY);
  assert.equal(calls[0].init.headers["anthropic-version"], "2023-06-01");
  assert.ok(calls[0].init.signal instanceof AbortSignal, "a timeout is set");

  let attempts = 0;
  const flaky = async () => (++attempts === 1 ? new Response("", { status: 529 }) : ok(reply));
  assert.equal(await callEviModel({ apiKey: KEY, body: {}, fetch: flaky, sleep: async () => {} }), '{"message":"Привет"}');
  assert.equal(attempts, 2);

  attempts = 0;
  const limited = async () => { attempts += 1; return new Response("", { status: 429 }); };
  await assert.rejects(callEviModel({ apiKey: KEY, body: {}, fetch: limited, sleep: async () => {} }), (error) => error instanceof EviModelError && error.code === "rate_limited");
  assert.equal(attempts, 2);

  attempts = 0;
  const bad = async () => { attempts += 1; return new Response("", { status: 400 }); };
  await assert.rejects(callEviModel({ apiKey: KEY, body: {}, fetch: bad, sleep: async () => {} }), (error) => error instanceof EviModelError && error.code === "failed");
  assert.equal(attempts, 1, "a bad request is not repeated");

  attempts = 0;
  const offline = async () => { attempts += 1; throw new TypeError("network"); };
  await assert.rejects(callEviModel({ apiKey: KEY, body: {}, fetch: offline, sleep: async () => {} }), EviModelError);
  assert.equal(attempts, 2);

  const refused = async () => ok({ ...reply, stop_reason: "refusal" });
  await assert.rejects(callEviModel({ apiKey: KEY, body: {}, fetch: refused, sleep: async () => {} }), (error) => error.code === "refused");

  // Ключ отозван, нет денег, лимит трат, модель недоступна — «недоступен», без повтора.
  for (const status of [401, 402, 403, 404]) {
    attempts = 0;
    const dead = async () => { attempts += 1; return new Response("", { status }); };
    await assert.rejects(callEviModel({ apiKey: KEY, body: {}, fetch: dead, sleep: async () => {} }), (error) => error.code === "unavailable", String(status));
    assert.equal(attempts, 1, String(status));
  }

  // Таймаут — не повторяется: та же длинная переписка снова упрётся в него.
  attempts = 0;
  const slow = async () => { attempts += 1; throw new DOMException("timeout", "TimeoutError"); };
  await assert.rejects(callEviModel({ apiKey: KEY, body: {}, fetch: slow, sleep: async () => {} }), (error) => error.code === "failed");
  assert.equal(attempts, 1);
  // Ошибки не несут ни ключа, ни текста.
  const error = await callEviModel({ apiKey: KEY, body: { secret: "текст ученика" }, fetch: bad, sleep: async () => {} }).catch((caught) => caught);
  assert.doesNotMatch(`${error.message} ${error.stack}`, new RegExp(`${KEY}|текст ученика`, "u"));
});

test("the limiter: 40 answers per student in 10 minutes, then a pause", () => {
  resetEviSlots();
  const now = 1_000_000;
  for (let index = 0; index < 40; index += 1) assert.equal(takeEviSlot("student-a", now + index), true);
  assert.equal(takeEviSlot("student-a", now + 41), false);
  assert.equal(takeEviSlot("student-b", now + 42), true, "another student is not blocked");
  assert.equal(takeEviSlot("student-a", now + 10 * 60_000 + 1), true, "the window moves on");
  resetEviSlots();
});

test("the limiter: no more than 150 answers per student in a day", () => {
  resetEviSlots();
  const now = 1_000_000;
  // По 30 ответов каждые 10 минут — окно в 10 минут не мешает, держит суточный потолок.
  for (let index = 0; index < 150; index += 1) {
    assert.equal(takeEviSlot("student-a", now + Math.floor(index / 30) * 10 * 60_000 + index), true);
  }
  assert.equal(takeEviSlot("student-a", now + 5 * 10 * 60_000 + 1), false, "the day cap");
  assert.equal(takeEviSlot("student-b", now + 5 * 10 * 60_000 + 2), true, "another student is not blocked");
  assert.equal(takeEviSlot("student-a", now + 24 * 60 * 60_000 + 1), true, "a day later it opens again");
  resetEviSlots();
});

test("the shared core checks history, consent, key and rate before any model call, and sends only the chat and the test; web and mobile both go through it", () => {
  const action = read("src/lib/portal/evi-actions.ts");
  assert.match(action, /^"use server";/u);
  assert.match(action, /await requireStudentPortalActor\(\)/u);
  assert.match(action, /return runEviTurn\(\{ history, actor, client, locale \}\);/u);
  assert.doesNotMatch(action, /callEviModel|takeEviSlot|eviSystemPrompt/u, "the action holds no prompt, limit or model code of its own");
  const core = read("src/lib/portal/evi-core.ts");
  assert.doesNotMatch(core, /^"use server";/u);
  const order = [
    "historyTooLong(history)",
    "parseEviHistory(history)",
    "readAiConsentForProfile(actor.accessTier",
    "readEviApiKey(dependencies.env ?? process.env)",
    "takeEviSlot(actor.authUserId)",
    "callEviModel(",
  ].map((marker) => core.indexOf(marker));
  assert.ok(order.every((position, index) => position > 0 && (index === 0 || position > order[index - 1])), `order ${order}`);
  assert.match(core, /eviOpening\(orvis\?\.completed \? orvis\.profile : null\)/u);
  assert.match(core, /parseEviReply\(extractJsonObject\(text\), new Set\(keys\)\)/u);
  assert.doesNotMatch(core, /console\.|studentCaseId|displayName|email/u, "no logging and no profile data");
  // Мобильный маршрут идёт через то же ядро.
  assert.match(read("src/lib/server/student-portal-mobile-evi-route-handler.ts"), /import\("\.\.\/portal\/evi-core\.ts"\)/u);
  // Страница: ключ на сервере — чат отвечает, нет ключа — «недоступен».
  assert.match(read("src/components/portal/evi/EviTab.tsx"), /return online \? <EviChat strings=\{strings\} ask=\{askEviAction\} owner=\{owner\} stale=\{stale\} \/> : <EviChat strings=\{strings\} offline \/>;/u);
  const page = read("src/app/(portal)/portal/professions/page.tsx");
  assert.match(page, /const eviOnline = readEviApiKey\(process\.env\) !== null;/u);
  assert.match(page, /<EviTab strings=\{strings\} online=\{eviOnline\} owner=\{eviOwnerKey\(actor\.authUserId\)\} stale=\{\{ text: shell\.staleVersion, reload: shell\.staleVersionReload \}\} \/>/u);
  // Отказ модели — «начни заново», мёртвый ключ — «недоступен», перегрузка — «подожди».
  assert.match(core, /code === "rate_limited" \? "busy" : code === "refused" \? "invalid" : code === "unavailable" \? "unavailable" : "error"/u);
});
