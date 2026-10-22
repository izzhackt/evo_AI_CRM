// «ИИ-агенты»: события сессии Claude → хроника интерфейса, статус запуска и курсор опроса
// (docs/design/ai-agents/contract.md §C.2.3). Чистые функции на образцах событий по форме
// документации Managed Agents (22.10.2026); сети нет.
//
// node --conditions=react-server --experimental-strip-types --test tests/ai-agents-events.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AI_AGENT_AUTHORITY_NOTE_MARKER } from "../src/lib/ai-agents/contract.ts";
import {
  advanceCursor,
  convertSessionEvents,
  costCentsOf,
  decodeEventCursor,
  deriveRunState,
  encodeEventCursor,
  previewToolResult,
  readUsage,
  summarizeToolArgs,
  unseenEvents,
} from "../src/lib/server/ai-agents/events.ts";

const NOW = "2026-10-22T12:00:00.000Z";
const t = (seconds) => `2026-10-22T10:00:${String(seconds).padStart(2, "0")}.000Z`;
const text = (value) => [{ type: "text", text: value }];

const SAMPLE = [
  { type: "user.message", id: "e1", processed_at: t(1), content: text(`Покажи свои настройки\n\n${AI_AGENT_AUTHORITY_NOTE_MARKER}ABCDEFGHIJ234567ABCD]] Staff granted immediate-send authority.`) },
  { type: "session.status_running", id: "e2", processed_at: t(2) },
  { type: "agent.message", id: "e3", processed_at: t(3), content: [{ type: "redacted" }, { type: "text", text: "Смотрю " }, { type: "text", text: "настройки." }] },
  { type: "agent.mcp_tool_use", id: "e4", processed_at: t(4), name: "get_my_settings", mcp_server_name: "evo_crm", input: {} },
  { type: "agent.mcp_tool_result", id: "e5", processed_at: t(5), mcp_tool_use_id: "e4", is_error: false, content: text(`{"enabled":true}`) },
  { type: "agent.tool_use", id: "e6", processed_at: t(6), name: "bash", input: { command: "curl -sS -o file https://x.test/very/long/url" } },
  { type: "span.model_request_end", id: "e7", processed_at: t(7), model_usage: { input_tokens: 10 } },
  { type: "session.usage", id: "e8", processed_at: t(8), usage: { input_tokens: 1200, output_tokens: 300, list_cost: { amount: "42", currency: "USD" } } },
  { type: "session.status_idle", id: "e9", processed_at: t(9), stop_reason: { type: "end_turn" } },
];

test("events: каждый тип события превращается в событие интерфейса, лишние типы пропускаются", () => {
  const names = new Map();
  const ui = convertSessionEvents(SAMPLE, names, NOW);
  assert.deepEqual(ui.map((event) => event.kind), ["user", "status", "agent", "tool_call", "tool_result", "tool_call", "usage", "status"]);
  // Записка полномочия вырезана из показа.
  assert.equal(ui[0].text, "Покажи свои настройки");
  // Блоки redacted пропущены, текстовые склеены.
  assert.equal(ui[2].text, "Смотрю настройки.");
  assert.deepEqual(ui[3], { id: "e4", at: t(4), kind: "tool_call", tool: "get_my_settings", label: "Мои настройки", argsSummary: "", builtin: false });
  assert.deepEqual(ui[4], { id: "e5", at: t(5), kind: "tool_result", tool: "get_my_settings", ok: true, preview: `{"enabled":true}` });
  assert.equal(ui[5].builtin, true);
  assert.equal(ui[5].label, "Песочница: bash");
  assert.deepEqual(ui[6], { id: "e8", at: t(8), kind: "usage", inputTokens: 1200, outputTokens: 300, costCents: 42 });
  assert.deepEqual(ui[7], { id: "e9", at: t(9), kind: "status", status: "idle", stopReason: "end_turn" });
});

test("events: результат инструмента без вызова в пачке получает имя «инструмент», с картой — своё", () => {
  const lonely = { type: "agent.mcp_tool_result", id: "r1", processed_at: t(1), mcp_tool_use_id: "zz", is_error: true, content: text("error_code") };
  assert.equal(convertSessionEvents([lonely], new Map(), NOW)[0].tool, "инструмент");
  const known = convertSessionEvents([lonely], new Map([["zz", "list_leads"]]), NOW)[0];
  assert.equal(known.tool, "list_leads");
  assert.equal(known.ok, false);
});

test("events: сводка аргументов прячет тексты длиной, режется до 200 символов", () => {
  assert.equal(summarizeToolArgs({ text: "Здравствуйте, это приватное сообщение клиенту", channel: "whatsapp", limit: 5 }), "text=<45 симв.>, channel=whatsapp, limit=5");
  assert.equal(summarizeToolArgs({ query: "иванов" }), "query=<6 симв.>");
  const wide = summarizeToolArgs(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i])));
  assert.ok(wide.length <= 200, wide.length);
  assert.equal(summarizeToolArgs(null), "");
  assert.equal(previewToolResult(text("x".repeat(500))).length, 240);
});

test("events: ошибки сессии — понятные фразы для токена и MCP, прочее — короткое сообщение", () => {
  const ui = convertSessionEvents([
    { type: "session.error", id: "x1", processed_at: t(1), error: { type: "mcp_authentication_failed_error", mcp_server_name: "evo_crm" } },
    { type: "session.error", id: "x2", processed_at: t(2), error: { type: "mcp_connection_failed_error", mcp_server_name: "evo_crm" } },
    { type: "session.error", id: "x3", processed_at: t(3), error: { type: "model_overloaded_error", message: "перегрузка" } },
  ], new Map(), NOW);
  assert.deepEqual(ui.map((event) => event.code), ["mcp_authentication_failed_error", "mcp_connection_failed_error", "model_overloaded_error"]);
  assert.equal(ui[0].message, "Токен MCP не принят — обновите токен в настройках");
  assert.equal(ui[1].message, "MCP недоступен: проверьте адрес и IP-фильтр");
  assert.equal(ui[2].message, "перегрузка");
});

test("events: статус запуска по пачке — окончания, лимит, остановка, продолжение разговора", () => {
  const idle = (stop) => ({ type: "session.status_idle", id: "i", processed_at: t(5), stop_reason: { type: stop } });
  assert.equal(deriveRunState([idle("end_turn")], "running").status, "completed");
  assert.equal(deriveRunState([idle("budget_reached")], "running").status, "budget_reached");
  assert.equal(deriveRunState([idle("requires_action")], "running").status, "needs_attention");
  // Остановка сотрудником: user.interrupt перед idle.
  assert.equal(deriveRunState([{ type: "user.interrupt", id: "u", processed_at: t(4) }, idle("end_turn")], "running").status, "interrupted");
  // Обрыв сессии.
  const dead = deriveRunState([{ type: "session.status_terminated", id: "d", processed_at: t(6) }], "running");
  assert.deepEqual([dead.status, dead.errorCode], ["failed", "terminated"]);
  // Продолжение: running после completed возвращает работу.
  assert.equal(deriveRunState([{ type: "session.status_running", id: "r", processed_at: t(7) }], "completed").status, "running");
  // Нет событий статуса — статус прежний.
  const same = deriveRunState([{ type: "agent.message", id: "m", processed_at: t(1), content: text("Привет") }], "running");
  assert.deepEqual([same.status, same.changed, same.lastAgentText], ["running", false, "Привет"]);
});

test("events: ошибка сессии с исчерпанными повторами без дальнейшего running — failed", () => {
  const exhausted = { type: "session.error", id: "s", processed_at: t(3), error: { type: "model_overloaded_error", retry_status: { type: "exhausted" } } };
  const result = deriveRunState([exhausted], "running");
  assert.deepEqual([result.status, result.errorCode], ["failed", "model_overloaded_error"]);
  // Повтор ещё идёт — статус не трогаем.
  const retrying = { ...exhausted, error: { type: "model_overloaded_error", retry_status: { type: "retrying" } } };
  assert.equal(deriveRunState([retrying], "running").status, "running");
  // После ошибки сессия снова пошла — не failed.
  assert.equal(deriveRunState([exhausted, { type: "session.status_running", id: "r", processed_at: t(4) }], "running").status, "running");
});

test("events: расход из list_cost и итога сессии", () => {
  assert.equal(costCentsOf({ amount: "125", currency: "USD" }), 125);
  assert.equal(costCentsOf("7"), 7);
  assert.equal(costCentsOf(12), 12);
  assert.equal(costCentsOf({ amount: "x" }), 0);
  assert.equal(costCentsOf(undefined), 0);
  assert.deepEqual(
    readUsage({ usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5, list_cost: { amount: "9", currency: "USD" }, active_seconds: 12.345 } }),
    { inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, costCents: 9, activeSeconds: 12.35 },
  );
  assert.deepEqual(readUsage(null), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costCents: 0, activeSeconds: null });
});

test("events: курсор — круг кодирования, мусор даёт null, виденные события отбрасываются", () => {
  const names = new Map([["e4", "get_my_settings"]]);
  const first = SAMPLE.slice(0, 4);
  const cursor = advanceCursor(null, first, names);
  assert.deepEqual([cursor.t, cursor.ids, cursor.n, cursor.u], [t(4), ["e4"], 4, { e4: "get_my_settings" }]);
  const decoded = decodeEventCursor(encodeEventCursor(cursor));
  assert.deepEqual(decoded, cursor);
  for (const bad of [null, "", "!!!", Buffer.from("[]").toString("base64url"), Buffer.from(`{"t":5}`).toString("base64url")]) {
    assert.equal(decodeEventCursor(bad), null);
  }
  // Сервер отдаёт события с created_at[gte]=t: событие того же момента уже показано.
  const refetched = SAMPLE.slice(3);
  const fresh = unseenEvents(refetched, cursor);
  assert.deepEqual(fresh.map((event) => event.id), ["e5", "e6", "e7", "e8", "e9"]);
  // Результат пришёл в следующей пачке — имя берётся из курсора.
  const next = advanceCursor(cursor, fresh, new Map([["e4", "get_my_settings"]]));
  assert.equal(next.n, 9);
  assert.deepEqual(next.u, {});
  assert.equal(convertSessionEvents(fresh, new Map(Object.entries(cursor.u)), NOW)[0].tool, "get_my_settings");
});

test("events: два события с одним processed_at не теряются и не дублируются", () => {
  const a = { type: "agent.message", id: "a", processed_at: t(1), content: text("A") };
  const b = { type: "agent.message", id: "b", processed_at: t(1), content: text("B") };
  const c = { type: "agent.message", id: "c", processed_at: t(2), content: text("C") };
  const cursor = advanceCursor(null, [a], new Map());
  const fresh = unseenEvents([a, b, c], cursor);
  assert.deepEqual(fresh.map((event) => event.id), ["b", "c"]);
  const after = advanceCursor(cursor, fresh, new Map());
  assert.deepEqual([after.t, after.ids], [t(2), ["c"]]);
});
