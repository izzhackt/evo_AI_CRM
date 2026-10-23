// «ИИ-агенты» (решение владельца 22.10.2026, docs/design/ai-agents/contract.md §D.6):
// быстрые проверки интерфейса без сети и базы — чистые функции показа, разбор ответов
// RPC сотрудника, маршруты, права и пункт меню, рендер хаба и страницы агента в
// статической разметке (нормально · ключ Claude не задан · миграция не применена).
//
//   node --conditions=react-server --experimental-strip-types --test tests/ai-agents-ui.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { AI_AGENT_CATALOG, AI_AGENTS_MCP_FILE_PATH_PATTERN, AI_AGENTS_MCP_PATH, AI_AGENT_KEYS } from "../src/lib/ai-agents/contract.ts";
import { staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { FIXED_ROLE_ROUTES, fixedRoleCanAccessRoute } from "../src/lib/fixed-role-policy.ts";
import { isConnectedPlatformApi, isConnectedPlatformPage, isConnectedPlatformPrivateApi } from "../src/lib/platform-route-contract.ts";
import { buildV3Navigation, v3SectionTitle } from "../src/lib/v3/navigation.ts";
import { LINK_ICONS } from "../src/lib/v3/shell-tabs.ts";
import {
  AiAgentsShapeError,
  aiAgentHref,
  aiAgentIsRunnable,
  aiAgentNeedsSync,
  aiAgentStateChip,
  aiAgentSyncProblemText,
  buildChatItems,
  chartAxisTop,
  chartBarRows,
  chartDateTicks,
  chartToolRows,
  cronFromPlan,
  describeSchedule,
  draftStatusWords,
  draftTargetHref,
  durationWords,
  formatDayRu,
  formatUsdCents,
  isValidCron,
  mapAiAgentsDbError,
  parseAiAgentDetail,
  parseAiAgentDigests,
  parseAiAgentDrafts,
  parseAiAgentRoute,
  parseAiAgentRun,
  parseAiAgentRuns,
  parseAiAgentsList,
  parseCronPlan,
  parseDigestMetrics,
  parseMarkdown,
  parseMarkdownInline,
  relativeTimeRu,
  successShare,
} from "../src/lib/v3/ai-agents-view.ts";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");
const NOW = "2026-10-22T10:30:00.000Z";

/* ------------------------------------------------------------------ фикстуры */

const sync = (over = {}) => ({
  status: "ok", error: null, syncedAt: "2026-10-22T08:00:00.000Z", agentVersion: 3, claudeAgentId: "agent_01AbCdEfGh",
  environmentId: "env_1", vaultId: "vlt_1", deploymentId: null, configHash: "a".repeat(64), mcpUrl: "https://crm.example/api/mcp/v1",
  tokenFingerprint: "3f9a1c7d02be", tokenRotatedAt: null, ...over,
});
const stats = (over = {}) => ({
  runs7d: 17, runsRunning: 0, failed7d: 2, actions7d: 143, costCents7d: 412, draftsPending: 3, lastRunAt: "2026-10-22T08:20:00.000Z",
  lastRunStatus: "completed", lastDigestAt: null, runsPerDay14: [0, 1, 0, 2, 3, 1, 0, 0, 4, 2, 5, 3, 1, 6], ...over,
});
const listItem = (entry, over = {}) => ({
  ...entry, enabled: true, autoSend: false, model: "claude-sonnet-5-5", hasInstructionsOverride: true, sync: sync(), stats: stats(), ...over,
});
const LIST = {
  agents: AI_AGENT_CATALOG.map((entry) => entry.key === "curator-eu" || entry.key === "curator-ae" || entry.key === "curator-tr"
    ? listItem(entry, { enabled: false, hasInstructionsOverride: false, sync: sync({ status: "never", claudeAgentId: null, configHash: null }), stats: stats({ runs7d: 0, costCents7d: 0, draftsPending: 0, lastRunAt: null, lastRunStatus: null, runsPerDay14: new Array(14).fill(0) }) })
    : entry.key === "sales" ? listItem(entry, { autoSend: true, sync: sync({ status: "error", error: "x" }) }) : listItem(entry)),
  org: { responsibleMembershipId: null, responsibleName: null },
  summary: { enabled: 4, runs7d: 64, costCents7d: 1790, draftsPending: 10 },
  canManage: true, isAdmin: true, now: NOW,
};
const day = (offset) => new Date(Date.parse(NOW) - offset * 86400000).toISOString().slice(0, 10);
const DETAIL = {
  ...LIST.agents[0], instructionsOverride: null, schedulePromptOverride: null, triggerWebsiteLead: false, triggerWhatsappInbound: false,
  runBudgetUsd: 5, configVersion: 12,
  charts: {
    runsPerDay: Array.from({ length: 30 }, (_, index) => ({ date: day(29 - index), count: index % 4, failed: index % 7 === 0 ? 1 : 0 })),
    spendPerDay: Array.from({ length: 30 }, (_, index) => ({ date: day(29 - index), count: 1, costCents: index * 3 })),
    actionsByTool: [{ tool: "sales_report", count: 38 }, { tool: "funnel_stats", count: 29 }],
  },
  lastDigest: {
    id: "d1", agentKey: "director", runId: null, kind: "weekly", title: "Неделя 12–18 октября", createdAt: "2026-10-20T06:00:00.000Z",
    periodFrom: "2026-10-12", periodTo: "2026-10-18",
    bodyMd: "## Итоги\n\nЗаявок — **48**.\n\n<script>alert(1)</script>\n\n[плохая](javascript:alert(1)) и [хорошая](https://crm.example/x)",
    metrics: { kpis: [{ label: "Заявок", value: 48 }], series: [{ label: "Заявки по дням", points: [{ x: "2026-10-16", y: 5 }, { x: "2026-10-17", y: 8 }] }] },
  },
};

/* ------------------------------------------------------- чистые функции показа */

test("деньги, время и длительность — словами и без «0 из 0»", () => {
  assert.equal(formatUsdCents(0), "0,00\u00A0$");
  assert.equal(formatUsdCents(412), "4,12\u00A0$");
  assert.equal(formatUsdCents(0.4), "< 0,01\u00A0$");
  assert.equal(formatUsdCents(129000), "1290,00\u00A0$");
  assert.equal(relativeTimeRu("2026-10-22T10:29:50.000Z", NOW), "только что");
  assert.equal(relativeTimeRu("2026-10-22T10:10:00.000Z", NOW), "20 мин назад");
  assert.equal(relativeTimeRu("2026-10-22T08:20:00.000Z", NOW), "2 ч назад");
  assert.equal(relativeTimeRu("2026-10-21T08:20:00.000Z", NOW), "вчера");
  assert.equal(relativeTimeRu("2026-10-19T08:20:00.000Z", NOW), "3 дн. назад");
  assert.match(relativeTimeRu("2026-10-01T08:20:00.000Z", NOW), /^1 окт, \d\d:\d\d$/u);
  assert.equal(relativeTimeRu(null, NOW), "—");
  assert.equal(durationWords(134), "2 мин 14 с");
  assert.equal(durationWords(45), "45 с");
  assert.equal(durationWords(3900), "1 ч 05 мин");
  assert.equal(durationWords(null), "—");
  assert.equal(formatDayRu("2026-10-05"), "5 окт");
});

test("расписание: cron ↔ слова и простой выбор", () => {
  assert.equal(describeSchedule("0 9 * * 1", "Asia/Bishkek"), "Каждый понедельник в 09:00, Бишкек");
  assert.equal(describeSchedule("30 18 * * 5", "Asia/Bishkek"), "Каждую пятницу в 18:30, Бишкек");
  assert.equal(describeSchedule("0 8 * * *", "UTC"), "Каждый день в 08:00, UTC");
  assert.equal(describeSchedule("0 8 * * 1-5", "Asia/Almaty"), "По будням в 08:00, Алматы");
  assert.equal(describeSchedule(null, "Asia/Bishkek"), "Без расписания");
  assert.match(describeSchedule("*/15 * * * *", "UTC"), /\*\/15 \* \* \* \*/u);
  assert.deepEqual(parseCronPlan("0 9 * * 1"), { kind: "weekly", time: "09:00", weekday: 1 });
  assert.deepEqual(parseCronPlan("5 7 * * 0"), { kind: "weekly", time: "07:05", weekday: 0 });
  assert.equal(parseCronPlan("*/15 * * * *"), "custom");
  assert.equal(parseCronPlan("0 9 1 * *"), "custom");
  assert.equal(cronFromPlan({ kind: "weekly", time: "09:00", weekday: 1 }), "0 9 * * 1");
  assert.equal(cronFromPlan({ kind: "weekdays", time: "18:30", weekday: 1 }), "30 18 * * 1-5");
  assert.equal(cronFromPlan({ kind: "daily", time: "07:05", weekday: 1 }), "5 7 * * *");
  assert.equal(cronFromPlan({ kind: "none", time: "09:00", weekday: 1 }), null);
  for (const cron of ["0 9 * * 1", "30 18 * * 1-5", "5 7 * * *", "5 7 * * 0"]) {
    assert.equal(cronFromPlan(parseCronPlan(cron)), cron, cron);
  }
  assert.equal(isValidCron("0 9 * * 1"), true);
  assert.equal(isValidCron("0 9 * *"), false);
  assert.equal(isValidCron("0 9 * * MON"), false);
});

test("состояние агента одним словом; «нужна синхронизация» — по хешу", () => {
  const chip = (over) => aiAgentStateChip({ enabled: true, hasInstructions: true, syncStatus: "ok", needsSync: false, ...over });
  assert.deepEqual(chip({}), { label: "Включён", tone: "ok" });
  assert.deepEqual(chip({ enabled: false }), { label: "Выключен", tone: "neutral" });
  assert.deepEqual(chip({ hasInstructions: false }), { label: "Инструкции пока нет", tone: "neutral" });
  assert.deepEqual(chip({ syncStatus: "error" }), { label: "Ошибка синхронизации", tone: "danger" });
  assert.deepEqual(chip({ syncStatus: "never" }), { label: "Нужна синхронизация", tone: "warn" });
  assert.deepEqual(chip({ needsSync: true }), { label: "Нужна синхронизация", tone: "warn" });
  assert.equal(aiAgentNeedsSync("ok", "a", "b"), true);
  assert.equal(aiAgentNeedsSync("ok", "a", "a"), false);
  assert.equal(aiAgentNeedsSync("never", "a", "b"), false);
  assert.equal(aiAgentNeedsSync("ok", null, "b"), false);
  assert.equal(aiAgentNeedsSync("ok", "a", null), false, "не смог посчитать — не гадаем");
  assert.equal(successShare({ runs7d: 17, failed7d: 2 }), 88);
  assert.equal(successShare({ runs7d: 0, failed7d: 0 }), null);
});

test("ряды графиков: дни без запусков — нули, ось от нуля с чётным верхом, русские названия инструментов", () => {
  const rows = chartBarRows([
    { date: "2026-10-20", count: 2, failed: 1 }, { date: "2026-10-22", count: 3 },
  ], "count");
  assert.deepEqual(rows.map((row) => [row.date, row.value, row.failed]), [["2026-10-20", 2, 1], ["2026-10-21", 0, 0], ["2026-10-22", 3, 0]]);
  assert.deepEqual(chartBarRows([], "count"), []);
  assert.equal(chartBarRows([{ date: "2026-10-20", count: 1, costCents: 77 }], "costCents")[0].value, 77);
  assert.deepEqual([1, 3, 8, 10, 13, 34, 125].map(chartAxisTop), [2, 4, 8, 10, 20, 40, 200]);
  const tools = chartToolRows([{ tool: "funnel_stats", count: 29 }, { tool: "zzz_unknown", count: 3 }, { tool: "sales_report", count: 38 }, { tool: "list_leads", count: 0 }]);
  assert.deepEqual(tools.map((row) => [row.label, row.count]), [["Отчёт продаж", 38], ["Воронка", 29], ["zzz_unknown", 3]]);
  const ticks = chartDateTicks(chartBarRows(DETAIL.charts.runsPerDay, "count"));
  assert.equal(ticks.length, 3);
  assert.equal(ticks[0].index, 0);
  assert.equal(ticks[2].index, 29);
});

test("метрики отчёта: форма проверяется при показе, мусор отбрасывается", () => {
  const parsed = parseDigestMetrics({
    kpis: [{ label: "Заявок", value: 48 }, { label: "Оплаты", value: "7 400", unit: "$" }, { label: "", value: 1 }, { value: 2 }, null, { label: "Без значения" }],
    series: [{ label: "Заявки", points: [{ x: "2026-10-16", y: 5 }, { x: "2026-10-17", y: 8 }, { x: "2026-10-18", y: "бред" }] }, { label: "Одна точка", points: [{ x: 1, y: 1 }] }, { label: "Не массив", points: "x" }],
  });
  assert.deepEqual(parsed.kpis.map((kpi) => [kpi.label, kpi.value, kpi.unit]), [["Заявок", "48", null], ["Оплаты", "7 400", "$"]]);
  assert.equal(parsed.series.length, 1);
  assert.deepEqual(parsed.series[0].values, [5, 8]);
  assert.deepEqual(parsed.series[0].ticks, ["16 окт", "17 окт"]);
  assert.deepEqual(parseDigestMetrics(null), { kpis: [], series: [] });
  assert.deepEqual(parseDigestMetrics({ kpis: "x", series: 5 }), { kpis: [], series: [] });
});

test("безопасный Markdown: известные блоки, ссылки только http(s), HTML остаётся текстом", () => {
  const blocks = parseMarkdown("## Итоги\n\nТекст **жирный** и *курсив* и `код`.\n\n- один\n- два\n\n1. раз\n2. два\n\n| А | Б |\n|---|---|\n| 1 | 2 |\n\n> цитата\n\n---\n\n```\nкод <b>\n```");
  assert.deepEqual(blocks.map((block) => block.t), ["heading", "paragraph", "list", "list", "table", "quote", "rule", "code"]);
  assert.equal(blocks[2].ordered, false);
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[4].rows.length, 1);
  const inline = parseMarkdownInline("[плохая](javascript:alert(1)) [хорошая](https://crm.example/x) <img src=x onerror=alert(1)>");
  assert.equal(inline.filter((node) => node.t === "link").length, 1);
  assert.equal(inline.find((node) => node.t === "link").href, "https://crm.example/x");
  assert.ok(inline.some((node) => node.t === "text" && node.text.includes("<img src=x onerror=alert(1)>")), "HTML — обычный текст");
  assert.ok(!JSON.stringify(inline).includes("javascript:alert(1)\"") || !inline.some((node) => node.t === "link" && /javascript/u.test(node.href)));
});

test("хроника: результат склеивается со своим вызовом, статусы схлопываются, расход не показывается", () => {
  const items = buildChatItems([
    { id: "1", at: NOW, kind: "user", text: "Привет" },
    { id: "2", at: NOW, kind: "status", status: "running", stopReason: null },
    { id: "3", at: NOW, kind: "status", status: "running", stopReason: null },
    { id: "4", at: NOW, kind: "tool_call", tool: "get_case", label: "Дело студента", argsSummary: "case_id=…", builtin: false },
    { id: "5", at: NOW, kind: "tool_call", tool: "get_case", label: "Дело студента", argsSummary: "case_id=2", builtin: false },
    { id: "6", at: NOW, kind: "tool_result", tool: "get_case", ok: true, preview: "ok" },
    { id: "7", at: NOW, kind: "tool_result", tool: "get_case", ok: false, preview: "not_found" },
    { id: "8", at: NOW, kind: "usage", inputTokens: 1, outputTokens: 1, costCents: 3 },
    { id: "9", at: NOW, kind: "agent", text: "Готово" },
    { id: "10", at: NOW, kind: "status", status: "idle", stopReason: "end_turn" },
    { id: "11", at: NOW, kind: "error", code: "mcp_authentication_failed_error", message: "x" },
  ]);
  assert.deepEqual(items.map((item) => item.kind), ["user", "status", "tool", "tool", "agent", "status", "error"]);
  assert.deepEqual(items.filter((item) => item.kind === "tool").map((item) => [item.state, item.word]), [["ok", "Читает дело студента"], ["error", "Читает дело студента"]]);
  assert.match(items.at(-1).text, /Токен доступа агента к CRM не принят/u);
  assert.equal(items.at(-2).text, "Готово");
});

test("ошибки: сообщения базы → коды → русские фразы; маршрут и адреса вкладок", () => {
  assert.equal(mapAiAgentsDbError({ code: "42501", message: "ai_agent_forbidden" }), "forbidden");
  assert.equal(mapAiAgentsDbError({ code: "40001", message: "ai_agent_version_conflict" }), "version_conflict");
  assert.equal(mapAiAgentsDbError({ code: "55000", message: "agent_not_synced" }), "agent_not_synced");
  assert.equal(mapAiAgentsDbError({ code: "55000", message: "agent_disabled" }), "agent_disabled");
  assert.equal(mapAiAgentsDbError({ code: "55000", message: "run_in_progress" }), "run_in_progress");
  assert.equal(mapAiAgentsDbError({ code: "PGRST202", message: "Could not find the function platform.ai_agents_list_v1" }), "not_ready");
  assert.equal(mapAiAgentsDbError({ code: "42883", message: "function does not exist" }), "not_ready");
  assert.equal(mapAiAgentsDbError({ code: "P0002", message: "ai_agent_not_found" }), "not_found");
  assert.equal(mapAiAgentsDbError({ code: "XX000", message: "boom" }), "unavailable");

  assert.deepEqual(parseAiAgentRoute({}), { tab: "overview", runId: null, runsLimit: 30, draftsFilter: "pending" });
  assert.equal(parseAiAgentRoute({ tab: "drafts", show: "all" })?.draftsFilter, "all");
  assert.equal(parseAiAgentRoute({ tab: "runs", run: "11111111-1111-4111-8111-111111111111" })?.runId, "11111111-1111-4111-8111-111111111111");
  assert.equal(parseAiAgentRoute({ tab: "runs", limit: "60" })?.runsLimit, 60);
  for (const bad of [{ tab: "nope" }, { tab: ["runs", "drafts"] }, { run: "x" }, { limit: "abc" }, { show: "weird" }]) assert.equal(parseAiAgentRoute(bad), null, JSON.stringify(bad));
  assert.equal(aiAgentHref("director"), "/v3/ai-agents/director");
  assert.equal(aiAgentHref("sales", { tab: "drafts", show: "all" }), "/v3/ai-agents/sales?tab=drafts&show=all");
  assert.equal(aiAgentHref("sales", { tab: "runs", run: "r1" }), "/v3/ai-agents/sales?tab=runs&run=r1");

  assert.deepEqual(draftStatusWords({ status: "pending", failureCode: "whatsapp_unavailable", sentByAgent: false }), { label: "Ждёт решения", tone: "warn", note: "Остаётся в очереди: WhatsApp сейчас не подключён" });
  assert.equal(draftStatusWords({ status: "failed", failureCode: "conversation_moved_on", sentByAgent: false }).note, "Не отправлено: клиент написал ещё — ответ устарел");
  assert.equal(draftStatusWords({ status: "sent", failureCode: null, sentByAgent: true }).note, "Агент отправил сам (Авто)");
  assert.equal(draftTargetHref({ channel: "whatsapp", conversationId: "5d3b1a2c-1111-4222-8333-444455556666", studentCaseId: null }), "/v3/inbox?conversation=5d3b1a2c-1111-4222-8333-444455556666");
  assert.equal(draftTargetHref({ channel: "portal", conversationId: null, studentCaseId: "7e3b1a2c-1111-4222-8333-444455556666" }), "/v3/messages?case=7e3b1a2c-1111-4222-8333-444455556666");
  assert.equal(draftTargetHref({ channel: "portal", conversationId: null, studentCaseId: "не-uuid" }), null);
});

/* ------------------------------------------------------------ разбор ответов RPC */

test("разбор ответов RPC: нормальная форма проходит, кривая — ошибка формы, а не падение страницы", () => {
  const list = parseAiAgentsList(JSON.parse(JSON.stringify(LIST)));
  assert.equal(list.agents.length, 7);
  assert.equal(list.agents[0].stats.runsPerDay14.length, 14);
  assert.equal(parseAiAgentsList({ ...LIST, agents: LIST.agents.map((a) => ({ ...a, stats: { ...a.stats, runsPerDay14: [1, 2] } })) }).agents[0].stats.runsPerDay14.length, 14, "короткий ряд дополняется нулями слева");
  assert.throws(() => parseAiAgentsList({ ...LIST, agents: [{ ...LIST.agents[0], key: "unknown" }] }), AiAgentsShapeError);
  assert.throws(() => parseAiAgentsList({ ...LIST, agents: [{ ...LIST.agents[0], model: "gpt" }] }), AiAgentsShapeError);
  assert.throws(() => parseAiAgentsList({ ...LIST, canManage: "yes" }), AiAgentsShapeError);
  assert.throws(() => parseAiAgentsList(null), AiAgentsShapeError);
  assert.throws(() => parseAiAgentsList({ ...LIST, agents: "x" }), AiAgentsShapeError);

  const detail = parseAiAgentDetail(JSON.parse(JSON.stringify(DETAIL)));
  assert.equal(detail.configVersion, 12);
  assert.equal(detail.lastDigest.kind, "weekly");
  assert.throws(() => parseAiAgentDetail({ ...DETAIL, configVersion: "x" }), AiAgentsShapeError);
  assert.throws(() => parseAiAgentDetail({ ...DETAIL, sync: { ...DETAIL.sync, status: "ok2" } }), AiAgentsShapeError);

  const run = { id: "r", agentKey: "director", status: "completed", triggerKind: "schedule", startedAt: NOW, endedAt: null, durationSeconds: 5, costCents: 3 };
  assert.equal(parseAiAgentRuns({ runs: [run], hasMore: true }).runs[0].actionsCount, 0);
  assert.throws(() => parseAiAgentRuns({ runs: [{ ...run, status: "weird" }] }), AiAgentsShapeError);
  assert.equal(parseAiAgentRun({ run, actions: [{ id: 5, agentKey: "director", tool: "get_case", resultStatus: "ok", at: NOW }], drafts: [] }).actions[0].id, "5");
  const draft = { id: "d", agentKey: "sales", channel: "whatsapp", status: "pending", text: "Привет", createdAt: NOW, expiresAt: NOW };
  const drafts = parseAiAgentDrafts({ drafts: [draft], counts: { pending: 1 } });
  assert.equal(drafts.counts.sent, 0, "отсутствующий счётчик — ноль");
  assert.equal(drafts.drafts[0].sourceMessage, null);
  assert.throws(() => parseAiAgentDrafts({ drafts: [{ ...draft, channel: "sms" }], counts: {} }), AiAgentsShapeError);
  assert.equal(parseAiAgentDigests({ digests: [DETAIL.lastDigest] }).digests.length, 1);
  assert.throws(() => parseAiAgentDigests({ digests: [{ ...DETAIL.lastDigest, kind: "x" }] }), AiAgentsShapeError);
});

/* --------------------------------------------- маршрут, права, пункт меню */

test("маршруты: хаб и семь страниц агентов подключены, чужие — нет; MCP — приватный путь", () => {
  assert.equal(isConnectedPlatformPage("/v3/ai-agents"), true);
  for (const key of AI_AGENT_KEYS) assert.equal(isConnectedPlatformPage(`/v3/ai-agents/${key}`), true, key);
  for (const path of ["/v3/ai-agents/unknown", "/v3/ai-agents/director/extra", "/v3/ai-agents/", "/v3/ai-agents/Director", "/v3/ai-agents/director?x=1"]) {
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
  assert.equal(isConnectedPlatformPage("/v3/ai-agent"), true, "Gemini-страница осталась");
  // MCP — частный путь со своей проверкой токена: сессионных cookie у него нет и браузерным API он не становится.
  assert.equal(isConnectedPlatformPrivateApi(AI_AGENTS_MCP_PATH), true);
  assert.equal(isConnectedPlatformApi(AI_AGENTS_MCP_PATH), true);
  const token = "A".repeat(43);
  assert.equal(AI_AGENTS_MCP_FILE_PATH_PATTERN.test(`${AI_AGENTS_MCP_PATH}/files/${token}`), true);
  assert.equal(isConnectedPlatformPrivateApi(`${AI_AGENTS_MCP_PATH}/files/${token}`), true);
  for (const path of [`${AI_AGENTS_MCP_PATH}/files/short`, `${AI_AGENTS_MCP_PATH}/files/${token}/x`, `${AI_AGENTS_MCP_PATH}/v2`, "/api/mcp", "/api/mcp/v1/"]) {
    assert.equal(isConnectedPlatformPrivateApi(path), false, path);
  }
});

test("доступ: раздел и пункт меню — право ai.agent.use, каждая роль просмотра видит; активен на хабе, странице агента и Gemini", () => {
  assert.ok(FIXED_ROLE_ROUTES.includes("/v3/ai-agents") && FIXED_ROLE_ROUTES.includes("/v3/ai-agent"));
  const staff = (permissionKeys, over = {}) => ({ systemRole: "staff", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys, ...over });
  assert.equal(staffCanAccessRoute(staff(["ai.agent.use"]), "/v3/ai-agents"), true);
  assert.equal(staffCanAccessRoute(staff(["communication.read.full"]), "/v3/ai-agents"), false);
  assert.equal(staffCanAccessRoute(staff([], { systemRole: "admin" }), "/v3/ai-agents"), true);
  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(fixedRoleCanAccessRoute(role, "/v3/ai-agents"), true, role);
    assert.equal(staffCanAccessRoute(staff([], { systemRole: "admin", presentationRole: role }), "/v3/ai-agents"), true, role);
  }
  const actor = staff(["ai.agent.use"]);
  for (const path of ["/v3/ai-agents", "/v3/ai-agents/director", "/v3/ai-agents/curator-cn", "/v3/ai-agent"]) {
    const nav = buildV3Navigation(actor, path, new URLSearchParams());
    assert.equal(nav.activeId, "ai-agents", path);
    assert.deepEqual(nav.common.map((link) => [link.id, link.label, link.href]), [["ai-agents", "ИИ-агенты", "/v3/ai-agents"]], path);
  }
  assert.equal(LINK_ICONS["ai-agents"], "sparkles");
  assert.equal(v3SectionTitle("/v3/ai-agents"), "ИИ-агенты");
  assert.equal(v3SectionTitle("/v3/ai-agents/director"), "ИИ-агенты");
  assert.equal(v3SectionTitle("/v3/ai-agent"), "ИИ-агент", "вкладка Gemini-страницы называет саму страницу");
  assert.match(read("src/app/(v3)/access-denied/page.tsx"), /"\/v3\/ai-agents": "ИИ-агенты",/u);
});

/* ------------------------------------------------------------ рендер разметки */

const ENTRY = `
import { renderToStaticMarkup } from "react-dom/server";
import { AgentsHub } from "@/components/v3/ai-agents/AgentsHub";
import { AgentBody } from "@/components/v3/ai-agents/AgentBody";
import { NotReady, Unavailable } from "@/components/v3/ai-agents/Notices";
import { PartShell } from "@/components/v3/PartShell";
export const html = {
  hub: (list, runtimeConfigured) => renderToStaticMarkup(<PartShell title="ИИ-агенты"><AgentsHub list={list} runtimeConfigured={runtimeConfigured} /></PartShell>),
  body: (props) => renderToStaticMarkup(<AgentBody {...props} />),
  notReady: () => renderToStaticMarkup(<PartShell title="ИИ-агенты"><NotReady /></PartShell>),
  unavailable: () => renderToStaticMarkup(<Unavailable what="агентов" retryHref="/v3/ai-agents" />),
};
`;
const LINK_SHIM = `const React = require("react");
function Link(props) { const { href, prefetch, scroll, replace, children, ...rest } = props; return React.createElement("a", { ...rest, href: String(href) }, children); }
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;`;
const ACTION_STUB = `const f = async () => ({ status: "idle", code: null, message: null, requestId: null });
module.exports = { updateAiAgentAction: f, saveAiAgentInstructionsAction: f, syncAiAgentAction: f, startAiAgentRunAction: f, followUpAiAgentRunAction: f,
  pollAiAgentRunAction: async () => ({ ok: false, code: "unavailable" }), interruptAiAgentRunAction: f, loadAiAgentRunTranscriptAction: async () => ({ ok: false, code: "unavailable" }), decideAiAgentDraftAction: f };`;

let rendered;
async function views() {
  if (rendered) return rendered;
  const dir = mkdtempSync(join(tmpdir(), "aia-ui-"));
  try {
    writeFileSync(join(dir, "entry.tsx"), ENTRY);
    const outfile = join(dir, "out.cjs");
    const resolveRoot = root("");
    await build({
      entryPoints: [join(dir, "entry.tsx")], outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic",
      tsconfig: root("tsconfig.json"), absWorkingDir: resolveRoot, nodePaths: [root("node_modules")], logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{
        name: "aia-ui-test",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
          b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
          b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
          b.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: resolveRoot, loader: "js" }));
          b.onResolve({ filter: /^@\/lib\/platform-ai-agents-actions$/ }, () => ({ path: "actions-stub", namespace: "actions" }));
          b.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: ACTION_STUB, loader: "js" }));
          b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
        },
      }],
    });
    const require = createRequire(root("package.json"));
    rendered = require(outfile).html;
    return rendered;
  } finally {
    // Бандл уже загружен в память require-кэшем; каталог больше не нужен.
    rmSync(dir, { recursive: true, force: true });
  }
}

const bodyProps = (over = {}) => ({
  detail: DETAIL, tab: "overview", now: NOW, canEdit: true, canManage: true, preview: false, runtimeConfigured: true, needsSync: false,
  digests: { status: "available", data: { digests: [DETAIL.lastDigest] } }, runs: null, runsLimit: 30, run: null, runId: null, drafts: null,
  draftsFilter: "pending", resume: { runId: null, sendAuthority: false }, ...over,
});

test("хаб, нормальное состояние: три группы по порядку, семь карточек, Gemini, расход «в Console», спарклайн, без «0 из 0»", async () => {
  const { hub } = await views();
  const html = hub(LIST, true);
  const groups = [...html.matchAll(/data-testid="v3-aia-group-(sales|analytics|curators)"/gu)].map((match) => match[1]);
  assert.deepEqual(groups, ["sales", "analytics", "curators"]);
  for (const entry of AI_AGENT_CATALOG) {
    assert.match(html, new RegExp(`data-testid="v3-aia-card-${entry.key}"`, "u"), entry.key);
    assert.match(html, new RegExp(`href="/v3/ai-agents/${entry.key}"`, "u"), `${entry.key}: карточка — ссылка`);
    assert.match(html, new RegExp(escapeRegExp(entry.title), "u"), entry.title);
  }
  assert.match(html, /Продажи[\s\S]*Аналитика[\s\S]*Кураторы/u);
  assert.match(html, /лимиты — в Claude Console/u);
  assert.match(html, /17,90\u00A0\$/u, "расход за 7 дней из costCents7d");
  assert.match(html, /Авто: вкл/u);
  assert.match(html, /Авто: выкл/u);
  assert.match(html, /Ошибка синхронизации/u);
  assert.match(html, /Инструкции пока нет/u, "заготовки подписаны");
  assert.match(html, /role="img" aria-label="Запусков за последние 14 дней: 28\./u);
  assert.match(html, /data-testid="v3-aia-gemini"[\s\S]*href="\/v3\/ai-agent"[\s\S]*Подсказывает ответ в чате WhatsApp, сам ничего не отправляет\./u);
  assert.doesNotMatch(html, /v3-aia-key-missing/u);
  assert.doesNotMatch(html, /\b0 из 0\b/u);
  assert.doesNotMatch(html, /dangerouslySetInnerHTML|<script/u);
});

test("хаб, ключ Claude не задан: предупреждение сверху словами владельца", async () => {
  const { hub } = await views();
  const html = hub(LIST, false);
  assert.match(html, /data-testid="v3-aia-key-missing"[^>]*>[\s\S]*Ключ Claude API не задан в CRM: агенты не запустятся\. Его добавляет администратор\./u);
});

test("хаб, миграция не применена: «Раздел готовится», а не ошибка", async () => {
  const { notReady, unavailable } = await views();
  assert.match(notReady(), /data-testid="v3-aia-not-ready"[\s\S]*Раздел готовится[\s\S]*База ещё не обновлена/u);
  assert.match(unavailable(), /role="alert"[\s\S]*Не удалось загрузить агентов[\s\S]*href="\/v3\/ai-agents"[\s\S]*Повторить/u);
});

test("страница агента, «Обзор»: показатели, три графика с таблицей-эквивалентом, отчёт без сырого HTML", async () => {
  const { body } = await views();
  const html = body(bodyProps());
  for (const label of ["Запусков за 7 дней", "Без ошибок", "Действий за 7 дней", "Расход за 7 дней", "Ждут решения"]) assert.match(html, new RegExp(label, "u"), label);
  assert.match(html, /Запуски по дням/u);
  assert.match(html, /Расход по дням/u);
  assert.match(html, /Что делает агент/u);
  assert.equal((html.match(/Показать данные таблицей/gu) ?? []).length, 2, "у столбцовых графиков есть таблица");
  assert.match(html, /data-testid="v3-aia-tool-bars"[\s\S]*Отчёт продаж[\s\S]*Воронка/u);
  assert.match(html, /Последний отчёт[\s\S]*Неделя 12–18 октября/u);
  assert.match(html, /Каждый понедельник в 09:00, Бишкек/u);
  // отчёт — безопасный: тег <script> стал текстом, javascript:-ссылка не стала ссылкой
  assert.doesNotMatch(html, /<script/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /href="javascript:/u);
  assert.match(html, /href="https:\/\/crm\.example\/x"[^>]*rel="noopener noreferrer nofollow"/u);
  // вкладки — настоящие ссылки, текущая отмечена
  for (const tab of ["command", "runs", "drafts", "instructions", "settings"]) assert.match(html, new RegExp(`href="/v3/ai-agents/director\\?tab=${tab}"`, "u"), tab);
  assert.match(html, /<a aria-current="page"[^>]*href="\/v3\/ai-agents\/director">Обзор<\/a>/u);
});

test("страница агента, пустое состояние: слова вместо нулей и ссылка на «Поручить»", async () => {
  const { body } = await views();
  const empty = { ...DETAIL, stats: stats({ runs7d: 0, failed7d: 0, actions7d: 0, costCents7d: 0, draftsPending: 0, lastRunAt: null, lastRunStatus: null }),
    charts: { runsPerDay: [], spendPerDay: [], actionsByTool: [] }, lastDigest: null };
  const html = body(bodyProps({ detail: empty, digests: { status: "available", data: { digests: [] } } }));
  assert.match(html, /Запусков ещё не было\. Поручите агенту первую задачу/u);
  assert.match(html, /За 30 дней запусков не было\./u);
  assert.match(html, /Расхода за 30 дней нет\./u);
  assert.match(html, /Агент пока не вызывал инструменты\./u);
  assert.match(html, /Отчётов пока нет\./u);
  assert.match(html, /нет запусков/u);
});

test("страница агента: ключ Claude не задан, просмотр роли, нужна синхронизация, ошибка синхронизации", async () => {
  const { body } = await views();
  const noKey = body(bodyProps({ runtimeConfigured: false, tab: "command" }));
  assert.match(noKey, /v3-aia-key-missing/u);
  assert.match(noKey, /Писать агенту пока нельзя/u);
  assert.match(noKey, /Ключ Claude API не задан в CRM — его добавляет администратор\./u);
  assert.doesNotMatch(noKey, /data-testid="v3-aia-input"/u, "поля ввода нет");
  const preview = body(bodyProps({ preview: true, canEdit: false, tab: "command" }));
  assert.match(preview, /data-testid="v3-aia-preview"/u);
  assert.match(preview, /В просмотре роли писать агенту нельзя\./u);
  // Директору поручает только системный администратор; другому агенту — любой сотрудник.
  const directorLocked = body(bodyProps({ canEdit: false, tab: "command" }));
  assert.match(directorLocked, /Директору поручает только системный администратор/u);
  assert.doesNotMatch(directorLocked, /data-testid="v3-aia-input"/u, "поля ввода у Директора для не-администратора нет");
  assert.doesNotMatch(body(bodyProps({ canEdit: false, tab: "command", detail: { ...DETAIL, key: "sales" } })), /Директору поручает/u);
  const stale = body(bodyProps({ needsSync: true }));
  assert.match(stale, /Нужна синхронизация/u);
  assert.match(stale, /Изменения не отправлены в Claude/u);
  assert.match(stale, /data-testid="v3-aia-sync-now"/u);
  const failed = body(bodyProps({ detail: { ...DETAIL, sync: sync({ status: "error", error: "Среда не создана" }) } }));
  assert.match(failed, /Синхронизация с Claude не удалась: Среда не создана/u);
  assert.match(failed, /Повторить синхронизацию/u);
  const notSynced = body(bodyProps({ tab: "command", detail: { ...DETAIL, sync: sync({ status: "never", claudeAgentId: null, configHash: null }) } }));
  assert.match(notSynced, /Агент ещё не синхронизирован с Claude/u);
});

test("агента можно запускать, пока у него есть рабочая настройка: сбой или незавершённая синхронизация не запирает (ревью #1290)", () => {
  assert.equal(aiAgentIsRunnable(sync()), true, "ok");
  assert.equal(aiAgentIsRunnable(sync({ status: "error", error: "x" })), true, "error с агентом, версией, средой и хранилищем");
  assert.equal(aiAgentIsRunnable(sync({ status: "pending" })), true, "pending с настройкой");
  assert.equal(aiAgentIsRunnable(sync({ status: "never", claudeAgentId: null })), false, "never");
  assert.equal(aiAgentIsRunnable(sync({ status: "never" })), false, "never даже с id (смена claudeAgentId обнуляет версию и статус)");
  for (const missing of [{ claudeAgentId: null }, { agentVersion: null }, { environmentId: null }, { vaultId: null }]) {
    assert.equal(aiAgentIsRunnable(sync({ status: "error", error: "x", ...missing })), false, JSON.stringify(missing));
    assert.equal(aiAgentIsRunnable(sync({ status: "pending", ...missing })), false, JSON.stringify(missing));
  }
  assert.equal(aiAgentSyncProblemText(sync()), null);
  assert.equal(aiAgentSyncProblemText(sync({ status: "never" })), null);
  assert.equal(
    aiAgentSyncProblemText(sync({ status: "error", error: "Среда не создана" })),
    "Синхронизация с Claude не удалась: Среда не создана. Агент продолжает работать по прежней настройке (версия 3). Повторите синхронизацию.",
  );
  assert.equal(
    aiAgentSyncProblemText(sync({ status: "error", error: null, claudeAgentId: null })),
    "Синхронизация с Claude не удалась. Агент не запустится, пока синхронизация не пройдёт.",
  );
  assert.match(aiAgentSyncProblemText(sync({ status: "pending" })) ?? "", /не завершена\. Агент работает по прежней настройке \(версия 3\)/u);
  assert.match(aiAgentSyncProblemText(sync({ status: "pending", agentVersion: null })) ?? "", /агент пока не запустится/u);
});

test("страница агента: после неудачной повторной синхронизации «Поручить» открыто и показывает ошибку; без настройки в Claude — заперто", async () => {
  const { body } = await views();
  const failedButUsable = body(bodyProps({ tab: "command", detail: { ...DETAIL, sync: sync({ status: "error", error: "Claude вернул ошибку: overloaded" }) } }));
  assert.match(failedButUsable, /data-testid="v3-aia-input"/u, "поле ввода есть: настройка в Claude рабочая");
  assert.doesNotMatch(failedButUsable, /Агент ещё не синхронизирован с Claude/u);
  assert.match(failedButUsable, /Синхронизация с Claude не удалась: Claude вернул ошибку: overloaded\. Агент продолжает работать по прежней настройке \(версия 3\)/u);
  assert.match(failedButUsable, /Повторить синхронизацию/u);

  const pendingUsable = body(bodyProps({ tab: "command", detail: { ...DETAIL, sync: sync({ status: "pending" }) } }));
  assert.match(pendingUsable, /data-testid="v3-aia-input"/u);
  assert.match(pendingUsable, /Синхронизация с Claude не завершена\./u);

  const failedNoAgent = body(bodyProps({ tab: "command", detail: { ...DETAIL, sync: sync({ status: "error", error: "Среда не создана", claudeAgentId: null, agentVersion: null }) } }));
  assert.doesNotMatch(failedNoAgent, /data-testid="v3-aia-input"/u, "агента в Claude нет: писать нельзя");
  assert.match(failedNoAgent, /Агент ещё не синхронизирован с Claude/u);
  assert.match(failedNoAgent, /Агент не запустится, пока синхронизация не пройдёт\./u);

  const panel = body(bodyProps({ tab: "settings", detail: { ...DETAIL, sync: sync({ status: "error", error: "Среда не создана" }) } }));
  assert.match(panel, /Агент в Claude уже создан \(версия 3\) и работает по прежней настройке/u);
  assert.match(panel, /Ошибка: Среда не создана/u);
  const never = body(bodyProps({ tab: "settings", detail: { ...DETAIL, sync: sync({ status: "never", claudeAgentId: null, configHash: null }) } }));
  assert.match(never, /Агент ещё не создан в Claude/u);
});

test("вкладки «Поручить», «Запуски», «Черновики», «Инструкция», «Настройки» рисуются по данным", async () => {
  const { body } = await views();
  const command = body(bodyProps({ tab: "command" }));
  assert.match(command, /data-testid="v3-aia-input"/u);
  assert.match(command, /Авто выключен: сообщения клиентам и студентам агент кладёт в «Черновики»/u);
  assert.match(command, /Отправлять без черновика/u, "переключатель — для ai.agent.manage");
  assert.match(command, /Агент отправит сообщения клиентам сразу, без вашего одобрения, на время этого разговора\./u);
  assert.match(command, /Покажи свои настройки/u);
  assert.doesNotMatch(body(bodyProps({ tab: "command", canManage: false })), /Отправлять без черновика/u);
  assert.match(body(bodyProps({ tab: "command", detail: { ...DETAIL, autoSend: true } })), /Авто включён: сообщения клиентам и студентам агент отправляет сам\./u);

  const run = { id: "11111111-1111-4111-8111-111111111111", agentKey: "director", status: "failed", triggerKind: "schedule", startedAt: NOW, endedAt: null,
    durationSeconds: 8, promptPreview: null, summary: null, errorCode: "mcp_auth_failed", errorMessage: null, model: "claude-sonnet-5-5", agentVersion: 3,
    sessionId: "sesn_1", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, costCents: 0, sendAuthority: false, startedByName: null, actionsCount: 0, draftsCount: 0 };
  const runs = body(bodyProps({ tab: "runs", runs: { status: "available", data: { runs: [run], hasMore: true } } }));
  assert.match(runs, /По расписанию/u);
  assert.match(runs, />Ошибка</u);
  assert.match(runs, /Токен доступа агента к CRM не принят/u, "причина ошибки словами, а не mcp_auth_failed");
  assert.match(runs, /href="\/v3\/ai-agents\/director\?tab=runs&amp;run=11111111-1111-4111-8111-111111111111"/u);
  assert.match(runs, /Показать ещё/u);
  const empty = body(bodyProps({ tab: "runs", runs: { status: "available", data: { runs: [], hasMore: false } } }));
  assert.match(empty, /Запусков ещё не было/u);
  const detail = body(bodyProps({ tab: "runs", runId: run.id, run: { status: "available", data: { run: { ...run, status: "completed", errorCode: null, summary: "Готово: **48**" }, actions: [{ id: "1", agentKey: "director", runId: run.id, tool: "sales_report", argsSummary: "from_month=2026-09", resultStatus: "ok", errorCode: null, durationMs: 5, at: NOW }], drafts: [] } } }));
  assert.match(detail, /Все запуски/u);
  assert.match(detail, /Отчёт продаж/u);
  assert.match(detail, /Показать переписку агента/u);
  assert.match(body(bodyProps({ tab: "runs", runs: { status: "not_ready" } })), /Раздел готовится/u);
  assert.match(body(bodyProps({ tab: "runs", runs: { status: "unavailable" } })), /Не удалось загрузить запуски/u);

  const draft = { id: "d1", agentKey: "director", runId: null, channel: "whatsapp", status: "pending", text: "Здравствуйте!", editedText: null, targetLabel: "Чат · +996 *** 45 67",
    conversationId: "5d3b1a2c-1111-4222-8333-444455556666", studentCaseId: null, leadId: null, reason: "Клиент спросил про сроки", failureCode: "whatsapp_unavailable",
    sourceMessage: { text: "Когда подавать документы?", at: NOW }, createdAt: NOW, expiresAt: "2026-10-29T10:00:00.000Z", decidedByName: null, decidedAt: null, sentAt: null, sentByAgent: false };
  const drafts = body(bodyProps({ tab: "drafts", drafts: { status: "available", data: { drafts: [draft], counts: { pending: 1, approved: 0, sending: 0, sent: 0, discarded: 0, failed: 0, expired: 0 } } } }));
  assert.match(drafts, /Одобрить и отправить/u);
  assert.match(drafts, />Отклонить</u);
  assert.match(drafts, /Клиент написал[\s\S]*Когда подавать документы\?/u);
  assert.match(drafts, /Остаётся в очереди: WhatsApp сейчас не подключён/u);
  assert.match(drafts, /Подключите WhatsApp в[\s\S]*Настройки → Интеграции/u);
  assert.match(drafts, /href="\/v3\/inbox\?conversation=5d3b1a2c-1111-4222-8333-444455556666"/u);
  assert.doesNotMatch(body(bodyProps({ tab: "drafts", canManage: false, drafts: { status: "available", data: { drafts: [draft], counts: { pending: 1, approved: 0, sending: 0, sent: 0, discarded: 0, failed: 0, expired: 0 } } } })), /Одобрить и отправить/u);
  assert.match(body(bodyProps({ tab: "drafts", drafts: { status: "available", data: { drafts: [], counts: { pending: 0, approved: 0, sending: 0, sent: 0, discarded: 0, failed: 0, expired: 0 } } } })), /Черновиков, которые ждут решения, нет/u);

  const instructions = body(bodyProps({ tab: "instructions", detail: { ...DETAIL, instructionsOverride: "Своя инструкция", hasInstructionsOverride: true } }));
  assert.match(instructions, /Своя инструкция/u);
  assert.match(instructions, /Сбросить на стандартную|v3-aia-instructions-text/u);
  assert.match(instructions, /из 60\s?000/u);
  const readOnly = body(bodyProps({ tab: "instructions", canEdit: false }));
  assert.doesNotMatch(readOnly, /v3-aia-instructions-text/u, "читают все, правит администратор");

  const settings = body(bodyProps({ tab: "settings" }));
  for (const text of ["Модель", "Расписание", "Поручение для запуска по расписанию", "Запустить по расписанию сейчас", "Реагировать на", "Потолок расхода на один запуск", "ID агента в Claude", "Синхронизация с Claude", "Обновить токен доступа"]) {
    assert.match(settings, new RegExp(escapeRegExp(text), "u"), text);
  }
  assert.match(settings, /role="switch"/u);
  assert.match(settings, /Claude Sonnet 5\.5/u);
  assert.match(settings, /отпечаток 3f9a1c7d02be/u, "виден только отпечаток токена");
  assert.match(settings, /старый токен ещё 10 минут принимается/u);
  assert.match(settings, /общие лимиты расходов владелец задаёт в Claude Console/iu);
  const settingsRead = body(bodyProps({ tab: "settings", canEdit: false }));
  assert.match(settingsRead, /v3-aia-settings-read/u);
  assert.doesNotMatch(settingsRead, /role="switch"/u, "не админ видит значения словом");
  assert.match(settingsRead, /Параметры меняет системный администратор/u);
});

/* ------------------------------------------------------------- исходники */

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("исходники: нет сырого HTML и service-клиента в интерфейсе, действия — только async, заголовки страниц совпадают с меню", () => {
  const files = readdirSync(root("src/components/v3/ai-agents")).map((file) => `src/components/v3/ai-agents/${file}`);
  const own = [...files, "src/lib/v3/ai-agents-source.ts", "src/lib/v3/ai-agents-view.ts", "src/lib/platform-ai-agents-actions.ts",
    "src/app/(v3)/v3/ai-agents/page.tsx", "src/app/(v3)/v3/ai-agents/[key]/page.tsx"];
  for (const file of own) {
    const text = read(file);
    assert.doesNotMatch(text, /dangerouslySetInnerHTML/u, file);
    assert.doesNotMatch(text, /createPlatformSupabaseServiceClient|service_role|getPlatformSupabaseBackendConfig/u, `${file}: service-клиент в UI не открывается`);
    assert.doesNotMatch(text, /amocrm|kommo/iu, `${file}: агенты не зависят от amoCRM`);
  }
  const actions = read("src/lib/platform-ai-agents-actions.ts");
  assert.match(actions, /^"use server";/u);
  assert.deepEqual([...actions.matchAll(/^export (?!async function|type )(\w+)/gmu)].map((match) => match[1]), [], "в «use server» экспортируются только async-функции и типы");
  for (const name of ["updateAiAgentAction", "saveAiAgentInstructionsAction", "syncAiAgentAction", "startAiAgentRunAction", "followUpAiAgentRunAction",
    "pollAiAgentRunAction", "interruptAiAgentRunAction", "loadAiAgentRunTranscriptAction", "decideAiAgentDraftAction"]) {
    assert.match(actions, new RegExp(`export async function ${name}\\(`, "u"), name);
  }
  assert.match(actions, /isStaffPreview\(actor\)\) return \{ ok: false, code: "preview_read_only" \}/u);
  assert.match(actions, /actor\.systemRole !== "admin"\) return failed\("forbidden"/u, "настройки и синхронизация — только администратор");
  assert.match(actions, /Инструкции пока нет|instructions_empty/u);
  // «Включить» агента без инструкции отказывает до обращения к базе
  assert.ok(actions.indexOf("instructions_empty") < actions.indexOf("AI_AGENT_STAFF_RPC.update, {"), "отказ раньше записи в базу");
  const page = read("src/app/(v3)/v3/ai-agents/page.tsx");
  assert.match(page, /export const metadata = \{ title: "ИИ-агенты" \};/u);
  assert.match(page, /requireV3PageActor\("\/v3\/ai-agents"\)/u);
  assert.match(page, /export const dynamic = "force-dynamic"/u);
  const agentPage = read("src/app/(v3)/v3/ai-agents/[key]/page.tsx");
  assert.match(agentPage, /isAiAgentKey\(key\)\) notFound\(\)/u);
  assert.match(agentPage, /parseAiAgentRoute\(await searchParams\);\s*if \(!route\) notFound\(\)/u);
  assert.match(agentPage, /requireV3PageActor\("\/v3\/ai-agents"\)/u);
});
