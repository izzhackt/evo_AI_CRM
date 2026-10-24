// «ИИ-агенты» (решение владельца 22.10.2026, docs/design/ai-agents/contract.md §D.6):
// быстрые проверки интерфейса без сети и базы — чистые функции показа, разбор ответов
// RPC сотрудника, маршруты, права и пункт меню, рендер хаба и страницы агента в
// статической разметке (нормально · ключ Claude не задан · миграция не применена).
//
//   node --conditions=react-server --experimental-strip-types --test tests/ai-agents-ui.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { AI_AGENT_CATALOG, AI_AGENT_TOOL_ERROR_CODES, AI_AGENTS_MCP_FILE_PATH_PATTERN, AI_AGENTS_MCP_PATH, AI_AGENT_KEYS } from "../src/lib/ai-agents/contract.ts";
import { staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { FIXED_ROLE_ROUTES, fixedRoleCanAccessRoute } from "../src/lib/fixed-role-policy.ts";
import { isConnectedPlatformApi, isConnectedPlatformPage, isConnectedPlatformPrivateApi } from "../src/lib/platform-route-contract.ts";
import { buildV3Navigation, v3SectionTitle } from "../src/lib/v3/navigation.ts";
import { LINK_ICONS } from "../src/lib/v3/shell-tabs.ts";
import {
  AiAgentsShapeError,
  actionArgsWords,
  aiAgentHref,
  aiAgentNextStep,
  aiAgentRoleLine,
  aiAgentConsoleRestore,
  aiAgentIsRunnable,
  aiAgentNeedsSync,
  aiAgentRunIsActive,
  aiAgentStateChip,
  aiAgentSyncProblemText,
  answerRunMeta,
  answerTaskTitle,
  buildChatItems,
  chartAxisTop,
  chartBarRows,
  chartDateTicks,
  chartToolRows,
  cronFromPlan,
  describeSchedule,
  draftStatusWords,
  draftTargetHref,
  conversationPatch,
  conversationPatchChanged,
  conversationStatusWord,
  conversationTimeRu,
  durationWords,
  elapsedClock,
  formatClockRu,
  formatDayRu,
  formatUsdCents,
  groupChatItems,
  isValidCron,
  mapAiAgentsDbError,
  mergeConversations,
  ownCommandRuns,
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
  plainPreview,
  relativeTimeRu,
  runOriginLabel,
  runningToolWord,
  stepsSummary,
  successShare,
  toolErrorWords,
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

  assert.deepEqual(parseAiAgentRoute({}), { tab: "overview", runId: null, runsLimit: 30, draftsFilter: "pending", fresh: false });
  assert.equal(parseAiAgentRoute({ tab: "command", new: "1" })?.fresh, true, "?new=1 — «Новый разговор»");
  assert.equal(parseAiAgentRoute({ tab: "drafts", show: "all" })?.draftsFilter, "all");
  assert.equal(parseAiAgentRoute({ tab: "runs", run: "11111111-1111-4111-8111-111111111111" })?.runId, "11111111-1111-4111-8111-111111111111");
  assert.equal(parseAiAgentRoute({ tab: "runs", limit: "60" })?.runsLimit, 60);
  for (const bad of [{ tab: "nope" }, { tab: ["runs", "drafts"] }, { run: "x" }, { limit: "abc" }, { show: "weird" }, { new: "0" }, { new: ["1", "1"] }]) assert.equal(parseAiAgentRoute(bad), null, JSON.stringify(bad));
  assert.equal(aiAgentHref("director"), "/v3/ai-agents/director");
  assert.equal(aiAgentHref("sales", { tab: "drafts", show: "all" }), "/v3/ai-agents/sales?tab=drafts&show=all");
  assert.equal(aiAgentHref("sales", { tab: "runs", run: "r1" }), "/v3/ai-agents/sales?tab=runs&run=r1");
  assert.equal(aiAgentHref("sales", { tab: "command", fresh: true }), "/v3/ai-agents/sales?tab=command&new=1");
  assert.equal(aiAgentHref("sales", { tab: "command", run: "r1" }), "/v3/ai-agents/sales?tab=command&run=r1");

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
import { AgentSwitches } from "@/components/v3/ai-agents/AgentSwitches";
import { NotReady, Unavailable } from "@/components/v3/ai-agents/Notices";
import { PartShell } from "@/components/v3/PartShell";
export const html = {
  switches: (props) => renderToStaticMarkup(<AgentSwitches {...props} />),
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

test("хаб, нормальное состояние: три группы по порядку, семь карточек, Gemini, «Поручить» и очередь черновиков ссылками, спарклайн, без «0 из 0»", async () => {
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
  assert.doesNotMatch(html, /лимиты — в Claude Console|черновиков нет/u, "подписи, повторяющие значение, убраны");
  assert.match(html, /17,90\u00A0\$/u, "расход за 7 дней из costCents7d");
  assert.match(html, /Авто: вкл/u, "«Авто» — только когда включено");
  assert.doesNotMatch(html, /Авто: выкл/u, "обычное «Авто: выкл» на каждой карточке — шум");
  assert.doesNotMatch(html, /Sonnet 5\.5/u, "модель — в «Настройках», не на карточке");
  assert.match(html, /Ошибка синхронизации/u);
  assert.match(html, /Не настроены:[\s\S]*Куратор Европа[\s\S]*Куратор ОАЭ[\s\S]*Куратор Турция/u, "агенты без инструкции — одной строкой со ссылками");
  assert.doesNotMatch(html, /Инструкции пока нет|агент выключен/u, "состояние не повторяется описанием роли");
  // «Поручить →» — у агентов, которым можно поручать (не у Директора для не-админа и не у ненастроенных); очередь черновиков — ссылка
  assert.match(html, /<a[^>]*data-testid="v3-aia-ask-curator-cn"[^>]*href="\/v3\/ai-agents\/curator-cn\?tab=command"[^>]*>Поручить →<\/a>/u);
  assert.doesNotMatch(html, /v3-aia-ask-curator-eu/u);
  assert.match(html, /<a[^>]*data-testid="v3-aia-drafts-director"[^>]*href="\/v3\/ai-agents\/director\?tab=drafts"[^>]*>3 черновика ждут решения/u);
  assert.match(html, /<a[^>]*aria-label="Ждут решения: 10\. Открыть черновики"[^>]*href="\/v3\/ai-agents\/director\?tab=drafts"/u, "плитка «Ждут решения» — ссылка на первую очередь");
  assert.match(html, /role="img" aria-label="Запусков за последние 14 дней: 28\./u);
  assert.match(html, /data-testid="v3-aia-gemini"[\s\S]*href="\/v3\/ai-agent"[\s\S]*Помощник в чате WhatsApp[\s\S]*Подсказывает ответ, сам ничего не отправляет\./u);
  assert.doesNotMatch(html, /Информация для агента|Gemini/u, "список подразделов без ссылок и название вендора убраны");
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
  for (const label of ["Запусков за 7 дней", "Без ошибок", "Расход за 7 дней", "Ждут решения"]) assert.match(html, new RegExp(label, "u"), label);
  assert.doesNotMatch(html, /Действий за 7 дней|лимиты — в Claude Console|общий лимит задаёт владелец/u);
  assert.ok(html.indexOf("Последний отчёт") < html.indexOf("Запусков за 7 дней"), "отчёт — первым: он продукт Директора");
  assert.match(html, /data-testid="v3-aia-tools-panel"/u, "инструменты — свёрнутая панель");
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
  // Агент, который ещё не работал: одно слово и одна кнопка вместо десяти пустых блоков.
  assert.match(html, /data-testid="v3-aia-first-run"[\s\S]*Запусков ещё не было[\s\S]*href="\/v3\/ai-agents\/director\?tab=command"[^>]*>Поручить первую задачу/u);
  assert.doesNotMatch(html, /За 30 дней запусков не было|Расхода за 30 дней нет|Агент пока не вызывал инструменты|Отчётов пока нет|нет запусков/u);
  assert.doesNotMatch(html, /Запусков за 7 дней|v3-aia-day-bars/u, "нулевые плитки и графики не рисуются");
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
  assert.match(stale, /Изменения не отправлены в Claude/u);
  assert.match(stale, /data-testid="v3-aia-sync-now"/u);
  assert.doesNotMatch(stale, /data-testid="v3-aia-state-strip"|Авто: выкл|Claude Sonnet 5\.5/u, "строки «Включён · Авто · модель · расписание» нет: она повторяла шапку и «Настройки»");
  // На «Настройках» та же фраза не повторяется плашкой: о синхронизации говорит их блок.
  const staleSettings = body(bodyProps({ needsSync: true, tab: "settings" }));
  assert.doesNotMatch(staleSettings, /data-testid="v3-aia-needs-sync"/u);
  assert.equal((staleSettings.match(/Изменения не отправлены в Claude/gu) ?? []).length, 1, "на «Настройках» фраза — один раз");
  const failed = body(bodyProps({ detail: { ...DETAIL, sync: sync({ status: "error", error: "Среда не создана" }) } }));
  assert.match(failed, /Синхронизация с Claude не удалась: Среда не создана/u);
  assert.match(failed, /Повторить синхронизацию/u);
  assert.match(failed, /data-testid="v3-aia-sync-error"[\s\S]*role="alert"[\s\S]*Повторить синхронизацию/u, "кнопка — в той же плашке, что и слова");
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
  assert.match(panel, /Синхронизация с Claude не удалась: Среда не создана\. Агент продолжает работать по прежней настройке \(версия 3\)/u);
  assert.equal((panel.match(/Среда не создана/gu) ?? []).length, 1, "ошибка синхронизации — одна строка, не плашка плюс «Ошибка: …»");
  const never = body(bodyProps({ tab: "settings", detail: { ...DETAIL, sync: sync({ status: "never", claudeAgentId: null, configHash: null }) } }));
  assert.match(never, /Агент ещё не создан в Claude\./u);
});

test("вкладки «Поручить», «Запуски», «Черновики», «Инструкция», «Настройки» рисуются по данным", async () => {
  const { body } = await views();
  const command = body(bodyProps({ tab: "command" }));
  assert.match(command, /data-testid="v3-aia-input"/u);
  assert.doesNotMatch(command, /Авто выкл/u, "постоянной строки о выключенном «Авто» под полем нет: оно в шапке страницы");
  assert.match(command, /<button[^>]*aria-pressed="false"[^>]*data-testid="v3-aia-direct"[\s\S]*Без черновика/u, "переключатель — для ai.agent.manage");
  assert.match(command, /Агент отправит сообщения клиентам сразу, без вашего одобрения, на время этого разговора\./u);
  assert.doesNotMatch(command, /Покажи свои настройки/u, "«Покажи свои настройки» — не поручение, а выгрузка служебных ключей");
  assert.match(command, /Подготовь недельный отчёт за прошлую неделю/u, "примеры — настоящие поручения");
  assert.match(command, /placeholder="Что поручить\?"/u);
  assert.doesNotMatch(command, /Ctrl\+Enter|Разговор закончен/u, "подсказок о клавишах и «Разговор закончен» больше нет");
  assert.doesNotMatch(body(bodyProps({ tab: "command", canManage: false })), /Без черновика/u);
  const auto = body(bodyProps({ tab: "command", detail: { ...DETAIL, autoSend: true } }));
  assert.match(auto, /Авто вкл<\/span> · агент отправляет клиентам сам/u);
  assert.doesNotMatch(auto, /data-testid="v3-aia-direct"/u, "при включённом «Авто» выбирать «Без черновика» нечего");
  // «Мои разговоры»: колонка со ссылкой на «Запуски» и пустым словом; «Поручить» — рабочая область окна
  assert.match(command, /<nav aria-label="Мои разговоры с агентом"[^>]*data-testid="v3-aia-conversations"/u);
  assert.match(command, /Здесь появятся ваши разговоры с агентом\./u);
  assert.match(command, /href="\/v3\/ai-agents\/director\?tab=runs"[^>]*>Все запуски|data-testid="v3-aia-all-runs" href="\/v3\/ai-agents\/director\?tab=runs"/u);
  assert.match(command, /data-aia-workspace/u);
  assert.match(command, /<h2[^>]*class="sr-only">Поручить: Директор \/ Аналитик<\/h2>/u, "заголовок раздела остаётся для читалки");
  assert.doesNotMatch(command, /<h2[^>]*class="t-section text-fg">Поручить<\/h2>/u, "видимого «Поручить» над полем больше нет");
  assert.doesNotMatch(command, /Считает продажи, воронку и поступление/u, "строка роли — один раз, под заголовком страницы, а не ещё раз в пустом чате");
  assert.match(command, /data-testid="v3-aia-new"[^>]*>[\s\S]*?Новый<\/button>/u, "«Новый разговор» — компактная кнопка, а не во всю ширину");

  const run = { id: "11111111-1111-4111-8111-111111111111", agentKey: "director", status: "failed", triggerKind: "schedule", startedAt: NOW, endedAt: null,
    durationSeconds: 8, promptPreview: null, summary: null, errorCode: "mcp_auth_failed", errorMessage: null, model: "claude-sonnet-5-5", agentVersion: 3,
    sessionId: "sesn_1", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, costCents: 0, sendAuthority: false, startedByName: null, actionsCount: 0, draftsCount: 0 };
  const runs = body(bodyProps({ tab: "runs", runs: { status: "available", data: { runs: [run], hasMore: true } } }));
  assert.match(runs, /По расписанию/u);
  assert.match(runs, />Ошибка</u);
  assert.match(runs, /Токен доступа агента к CRM не принят/u, "причина ошибки словами, а не mcp_auth_failed");
  assert.match(runs, /href="\/v3\/ai-agents\/director\?tab=runs&amp;run=11111111-1111-4111-8111-111111111111"/u);
  assert.match(runs, /Показать ещё/u);
  assert.match(runs, /<span class="mt-0\.5 block t-meta text-fg-3">По расписанию<\/span>/u, "повод запуска — один раз, под датой");
  const empty = body(bodyProps({ tab: "runs", runs: { status: "available", data: { runs: [], hasMore: false } } }));
  assert.match(empty, /Запусков ещё не было/u);
  assert.match(empty, /href="\/v3\/ai-agents\/director\?tab=command"[^>]*>Поручить<\/a>/u, "пустые «Запуски» ведут к «Поручить»");
  assert.doesNotMatch(empty, /Запуск появляется, когда/u);
  const detail = body(bodyProps({ tab: "runs", runId: run.id, run: { status: "available", data: { run: { ...run, status: "completed", errorCode: null, summary: "Готово: **48**" }, actions: [{ id: "1", agentKey: "director", runId: run.id, tool: "sales_report", argsSummary: "from_month=2026-09", resultStatus: "ok", errorCode: null, durationMs: 5, at: NOW }], drafts: [] } } }));
  assert.doesNotMatch(detail, /Все запуски/u, "вкладка «Запуски» уже ведёт к списку: второй «Назад» не нужен");
  assert.match(detail, /Отчёт продаж/u);
  assert.match(detail, /Показать переписку</u);
  assert.match(detail, /data-testid="v3-aia-run-meta-line"[^>]*>[^<]*· 8 с · 0,00\u00A0\$ · По расписанию</u, "факты запуска — одной строкой");
  assert.match(detail, /<summary[^>]*>Технические данные<\/summary>[\s\S]*Модель[\s\S]*Токены/u, "модель и токены — под «Техническими данными»");
  assert.match(detail, /data-testid="v3-aia-run-copy"/u, "итог можно скопировать");
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
  assert.match(drafts, /<h2[^>]*class="sr-only">Черновики<\/h2>/u, "заголовок вкладки — только для читалки");
  assert.doesNotMatch(drafts, /Они уходят только после вашего одобрения|можно поправить перед отправкой|Текст агента без правок/u);
  assert.doesNotMatch(drafts, /действует до/u, "срок называется, только когда он близок");
  const readonlyDrafts = body(bodyProps({ tab: "drafts", canManage: false, drafts: { status: "available", data: { drafts: [draft], counts: { pending: 1, approved: 0, sending: 0, sent: 0, discarded: 0, failed: 0, expired: 0 } } } }));
  assert.equal((readonlyDrafts.match(/Решает сотрудник с правом управлять ИИ-агентами/gu) ?? []).length, 1, "правило — одной строкой над списком, а не на каждой карточке");
  const noDrafts = body(bodyProps({ tab: "drafts", drafts: { status: "available", data: { drafts: [], counts: { pending: 0, approved: 0, sending: 0, sent: 0, discarded: 0, failed: 0, expired: 0 } } } }));
  assert.match(noDrafts, /Нет черновиков, которые ждут решения\./u);
  assert.doesNotMatch(noDrafts, /Ждут решения[\s\S]*Все/u, "фильтр «Ждут решения · Все» без черновиков не нужен");

  const instructions = body(bodyProps({ tab: "instructions", detail: { ...DETAIL, instructionsOverride: "Своя инструкция", hasInstructionsOverride: true } }));
  assert.match(instructions, /Своя инструкция/u);
  assert.match(instructions, /Сбросить на стандартную|v3-aia-instructions-text/u);
  assert.doesNotMatch(instructions, /из 60\s?000|>Сохранено</u, "счётчик — только у предела, «Сохранено» не пишется постоянно");
  const longInstructions = body(bodyProps({ tab: "instructions", detail: { ...DETAIL, instructionsOverride: "я".repeat(55_000), hasInstructionsOverride: true } }));
  assert.match(longInstructions, /55\s?000 из 60\s?000/u, "у предела счётчик появляется");
  const readOnly = body(bodyProps({ tab: "instructions", canEdit: false }));
  assert.doesNotMatch(readOnly, /v3-aia-instructions-text/u, "читают все, правит администратор");

  const settings = body(bodyProps({ tab: "settings" }));
  for (const text of ["Модель и лимит", "Расписание и события", "Поручение для запуска по расписанию", "Запустить по расписанию сейчас", "Реагировать на", "Потолок расхода на один запуск", "ID агента в Claude", "Синхронизация с Claude", "Обновить токен"]) {
    assert.match(settings, new RegExp(escapeRegExp(text), "u"), text);
  }
  assert.doesNotMatch(settings, /role="switch"/u, "«Включён» и «Авто» — только в шапке страницы: второй пары переключателей здесь нет");
  assert.doesNotMatch(settings, /Агент работает: расписание и события активны|Сообщения клиентам уходят в «Черновики»/u);
  assert.match(settings, /Claude Sonnet 5\.5/u);
  assert.match(settings, /отпечаток 3f9a1c7d02be/u, "виден только отпечаток токена");
  assert.match(settings, /<summary[^>]*>Технические данные<\/summary>/u, "служебные номера Claude — под «Техническими данными»");
  assert.doesNotMatch(settings, /Общие лимиты расходов владелец задаёт в Claude Console|События запускают агента только пока|Пусто — агента создаст синхронизация\.$/u);
  // Время — два списка в 24-часовом виде: `type="time"` рисует 12-часовое «09:00 AM»
  assert.doesNotMatch(settings, /type="time"/u);
  assert.match(settings, /data-testid="v3-aia-time-hour"[\s\S]*<option value="09" selected="">09<\/option>/u);
  assert.match(settings, /data-testid="v3-aia-time-minute"[\s\S]*<option value="00" selected="">00<\/option>/u);
  // Кнопка «Запустить по расписанию сейчас» — платный запуск: просит подтверждения на месте (в разметке его нет до нажатия)
  assert.doesNotMatch(settings, /Агент начнёт работу сейчас/u);
  assert.match(settings, /<button[^>]*disabled=""[^>]*data-testid="v3-aia-settings-save"/u, "«Сохранить настройки» без правок заперта");
  assert.doesNotMatch(settings, /opacity-50/u, "недоступная кнопка — токены поверхности, без прозрачности");
  const settingsRead = body(bodyProps({ tab: "settings", canEdit: false }));
  assert.match(settingsRead, /v3-aia-settings-read/u);
  assert.doesNotMatch(settingsRead, /role="switch"/u, "не админ видит значения словом");
  assert.match(settingsRead, /Параметры меняет системный администратор/u);
});

/* ------------------------------------------- «Поручить»: восстановление запуска и первый клик */

const RESUME_RUN_ID = "11111111-1111-4111-8111-111111111111";
const resumeRun = (over = {}) => ({
  id: RESUME_RUN_ID, agentKey: "director", status: "running", triggerKind: "command", startedAt: "2026-10-22T10:20:00.000Z", endedAt: null,
  durationSeconds: null, promptPreview: "Покажи студентов с просроченными документами", summary: null, errorCode: null, errorMessage: null,
  model: "claude-sonnet-5-5", agentVersion: 3, sessionId: "sesn_1", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costCents: 0,
  sendAuthority: false, startedByName: "Админ", actionsCount: 0, draftsCount: 0, ...over,
});

test("восстановление запуска: «работает» — только active-статусы; заготовка хроники строится из строки запуска без Claude", () => {
  assert.deepEqual(["starting", "running", "completed", "failed", "budget_reached", "interrupted", "needs_attention"].map((status) => aiAgentRunIsActive(status)),
    [true, true, false, false, false, false, false]);

  const active = aiAgentConsoleRestore(resumeRun());
  assert.equal(active.working, true);
  assert.equal(active.status, "running");
  assert.deepEqual(active.seed.map((event) => event.kind), ["user"], "идёт работа: есть поручение, итога ещё нет");
  assert.equal(active.seed[0].text, "Покажи студентов с просроченными документами");

  const done = aiAgentConsoleRestore(resumeRun({ status: "completed", endedAt: "2026-10-22T10:21:00.000Z", summary: "Итог: **3** студента" }));
  assert.equal(done.working, false);
  assert.deepEqual(done.seed.map((event) => [event.kind, event.at]), [["user", "2026-10-22T10:20:00.000Z"], ["agent", "2026-10-22T10:21:00.000Z"]]);

  const failed = aiAgentConsoleRestore(resumeRun({ status: "failed", errorCode: "mcp_auth_failed" }));
  assert.deepEqual(failed.seed.map((event) => event.kind), ["user", "error"]);
  assert.match(buildChatItems(failed.seed).at(-1).text, /Токен доступа агента к CRM не принят/u);

  const bare = aiAgentConsoleRestore(resumeRun({ status: "interrupted", promptPreview: null }));
  assert.deepEqual(bare.seed, [], "нет ни поручения, ни итога — заготовки нет, а не пустые реплики");
  for (const { seed } of [active, done, failed]) {
    assert.equal(new Set(seed.map((event) => event.id)).size, seed.length, "id заготовки различны");
    for (const event of seed) assert.match(event.id, /^restore:/u, "и не совпадают с id событий Claude: заготовка и настоящие события не склеиваются");
  }
});

test("«Мои разговоры»: свои запуски, слияние с тем, что знает вкладка, подписи списка", () => {
  const row = (id, startedAt, over = {}) => resumeRun({ id, startedAt, ...over });
  const runs = [
    row("a", "2026-10-22T08:00:00.000Z"),
    row("b", "2026-10-22T09:00:00.000Z", { startedByName: "Другой сотрудник" }),
    row("c", "2026-10-22T07:00:00.000Z", { triggerKind: "schedule", startedByName: null }),
    row("d", "2026-10-22T10:00:00.000Z"),
    row("e", "2026-10-21T10:00:00.000Z", { startedByName: null }),
  ];
  assert.deepEqual(ownCommandRuns(runs, "Админ").map((one) => one.id), ["d", "a"], "только свои command-запуски, новые выше");
  assert.deepEqual(ownCommandRuns(runs, "Админ", 1).map((one) => one.id), ["d"], "потолок списка");
  assert.deepEqual(ownCommandRuns(runs, "  "), [], "без имени сотрудника своих нет, а не «все без имени»");

  const server = [row("d", "2026-10-22T10:00:00.000Z", { status: "running" }), row("a", "2026-10-22T08:00:00.000Z", { status: "completed" })];
  const local = { n: row("n", "2026-10-22T09:59:00.000Z", { status: "running" }), d: row("d", "2030-01-01T00:00:00.000Z") };
  assert.deepEqual(mergeConversations(server, local, {}).map((one) => one.id), ["n", "d", "a"], "начатый во вкладке и ещё не дошедший до сервера — наверху; строка сервера главнее локальной");
  const done = conversationPatch(row("d", "x", { status: "completed", costCents: 40, durationSeconds: 9, endedAt: "2026-10-22T10:01:00.000Z" }));
  const merged = mergeConversations(server, {}, { d: done });
  assert.equal(merged[0].status, "completed");
  assert.equal(merged[0].costCents, 40, "свежая строка из опроса дополняет список");
  assert.equal(merged[0].startedAt, "2026-10-22T10:00:00.000Z", "а дата и текст поручения остаются");
  const stale = conversationPatch(row("a", "x", { status: "running" }));
  assert.equal(mergeConversations(server, {}, { a: stale }).find((one) => one.id === "a").status, "completed", "закончившийся по данным сервера разговор не оживает устаревшей строкой опроса");
  assert.equal(mergeConversations(server, { n: local.n }, {}, 2).length, 2);
  // Открытый разговор опрашивается сейчас: продолжение закончившегося («Идёт», расход) видно в списке сразу, остальные не оживают.
  const live = conversationPatch(row("a", "x", { status: "running", costCents: 9 }));
  const liveRow = mergeConversations(server, {}, { a: live }, undefined, "a").find((one) => one.id === "a");
  assert.equal(liveRow.status, "running", "живой разговор берёт строку опроса, а не закончившуюся строку сервера");
  assert.equal(liveRow.costCents, 9);
  assert.equal(mergeConversations(server, {}, { a: live }, undefined, "d").find((one) => one.id === "a").status, "completed", "для чужого живого разговора устаревшая строка по-прежнему не оживает");
  assert.equal(conversationPatchChanged(undefined, done), true);
  assert.equal(conversationPatchChanged(done, { ...done }), false, "тот же опрос список не перерисовывает");
  assert.equal(conversationPatchChanged(done, { ...done, costCents: 41 }), true);

  const now = "2026-10-22T10:30:00.000Z";
  assert.equal(conversationTimeRu("2026-10-22T04:42:00.000Z", now), "Сегодня 10:42");
  assert.equal(conversationTimeRu("2026-10-21T12:05:00.000Z", now), "Вчера 18:05");
  assert.equal(conversationTimeRu("2026-10-21T18:30:00.000Z", now), "Сегодня 00:30", "день считается по Бишкеку, не по UTC");
  assert.equal(conversationTimeRu("2026-10-20T03:10:00.000Z", now), "20 окт 09:10");
  assert.equal(conversationTimeRu("2025-12-31T03:10:00.000Z", now), "31 дек 2025 09:10");
  assert.equal(conversationTimeRu("не дата", now), "—");

  assert.deepEqual(["starting", "running", "completed", "failed", "interrupted", "budget_reached", "needs_attention"].map((status) => conversationStatusWord(status)?.word ?? null),
    ["Идёт", "Идёт", null, "Ошибка", "Остановлен", "Лимит", "Нужно внимание"]);
  assert.equal(conversationStatusWord("failed").tone, "danger");
});

test("ход работы: вызовы подряд — один блок со словом шага, ошибки и идущий вызов говорят словами; живая строка", () => {
  const call = (id, tool) => ({ id, at: NOW, kind: "tool_call", tool, label: tool, argsSummary: "", builtin: false });
  const result = (id, tool, ok) => ({ id, at: NOW, kind: "tool_result", tool, ok, preview: "" });
  const items = buildChatItems([
    { id: "u", at: NOW, kind: "user", text: "Привет" },
    call("t1", "list_leads"), result("r1", "list_leads", true),
    call("t2", "get_case"), result("r2", "get_case", false),
    call("t3", "search_clients"),
    { id: "a", at: NOW, kind: "agent", text: "Ответ" },
    call("t4", "list_tasks"), result("r4", "list_tasks", true),
  ]);
  const blocks = groupChatItems(items);
  assert.deepEqual(blocks.map((block) => block.kind), ["user", "steps", "agent", "steps"]);
  assert.equal(blocks[1].id, "t1", "id блока — первого вызова: растущая серия остаётся тем же элементом");
  assert.equal(blocks[1].steps.length, 3);

  const running = stepsSummary(blocks[1].steps);
  assert.equal(running.title, "Ход работы · шаг 3 · ищет клиента…");
  assert.equal(running.errors, "1 ошибка");
  assert.equal(running.running, true);
  const parked = stepsSummary(blocks[1].steps, false);
  assert.equal(parked.title, "Ход работы · 3 шага", "прерванный запуск не делает вид, что вызов ещё идёт");
  assert.equal(stepsSummary(blocks[3].steps).title, "Ход работы · 1 шаг");
  assert.equal(stepsSummary(blocks[3].steps).errors, null);
  assert.equal(stepsSummary([...blocks[1].steps, ...blocks[3].steps, ...blocks[3].steps, ...blocks[3].steps].map((step) => ({ ...step, state: "error" })), false).errors, "6 ошибок");
  assert.equal(runningToolWord(items), "Ищет клиента", "«Сейчас: …» — слово идущего вызова");
  assert.equal(runningToolWord(items.slice(0, 2)), null, "ни один вызов не идёт — «Думает…»");
  // Вызов без ответа из прерванного оборота не «идёт» в новом обороте: после сообщения сотрудника — «Думает…».
  const interrupted = buildChatItems([
    { id: "u", at: NOW, kind: "user", text: "Раз" }, call("t1", "search_clients"),
    { id: "u2", at: NOW, kind: "user", text: "Два" },
  ]);
  assert.equal(runningToolWord(interrupted), null, "вызов из прошлого оборота не считается идущим");
  assert.equal(runningToolWord([...interrupted, ...buildChatItems([call("t2", "get_case")])]), "Читает дело студента", "а вызов в последнем обороте — считается");

  assert.equal(elapsedClock(0), "0:00");
  assert.equal(elapsedClock(12_400), "0:12");
  assert.equal(elapsedClock(185_000), "3:05");
  assert.equal(elapsedClock(3_723_000), "1:02:03");
  assert.equal(elapsedClock(-5), "0:00");
});

test("ответ агента: строка итога под ним и название задачи из первой содержательной строки", () => {
  // Сумма и «$» разделены неразрывным пробелом, чтобы не оказаться на разных строках.
  const meta = (over = {}, steps = 0) => answerRunMeta({ startedAt: "2026-10-22T10:20:00.000Z", endedAt: "2026-10-22T10:20:12.000Z", durationSeconds: 12, costCents: 11, actionsCount: 2, ...over }, steps).replaceAll("\u00a0", " ");
  assert.equal(meta({}, 5), "12 с · 0,11 $ · 5 шагов");
  assert.equal(meta({}, 0), "12 с · 0,11 $ · 2 шага", "нет вызовов в хронике — берётся число действий из строки запуска");
  assert.equal(meta({ durationSeconds: null }), "12 с · 0,11 $ · 2 шага", "длительность считается по началу и концу");
  assert.equal(meta({ durationSeconds: null, endedAt: null, costCents: 0, actionsCount: 0 }), "", "чего нет — того нет в строке");
  assert.equal(meta({ costCents: 0 }, 1), "12 с · 1 шаг");

  assert.equal(answerTaskTitle("## Итог недели\n\nВыручка выросла"), "Итог недели");
  assert.equal(answerTaskTitle("\n\n---\n**Позвонить** клиенту [Иванов](https://crm.example/x) до `пятницы`"), "Позвонить клиенту Иванов до пятницы");
  assert.equal(answerTaskTitle("```\nкод\n```\n- первый пункт\n- второй"), "первый пункт", "кодовый блок пропускается, маркер списка снимается");
  assert.equal(answerTaskTitle("> цитата\n\nдальше"), "цитата");
  assert.equal(answerTaskTitle("| Имя | Статус |\n|---|---|\n| Аня | ок |"), "Имя Статус");
  assert.equal(answerTaskTitle("Проверить list_tasks и _snake_case_ в отчёте"), "Проверить list_tasks и snake_case в отчёте", "подчёркивания внутри слов остаются");
  assert.equal(answerTaskTitle("---\n```\n```"), "");
  const long = answerTaskTitle(`Очень длинная строка ${"слово ".repeat(60)}`);
  assert.ok(long.length <= 120 && long.endsWith("…"), "название не длиннее 120 знаков");
});

test("«Поручить» при открытии на запуске: разметка сразу говорит правду — идёт ли работа, поручение, итог, «Новый разговор»", async () => {
  const { body } = await views();
  const command = (resume, over = {}) => body(bodyProps({ tab: "command", resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: resume, ...over } }));

  const active = command(resumeRun());
  assert.match(active, /data-testid="v3-aia-progress"/u, "работа идёт — сказано");
  assert.match(active, /data-testid="v3-aia-working">Думает…/u, "инструмент не вызван — «Думает…»");
  assert.match(active, /Покажи студентов с просроченными документами/u, "видно, что поручили");
  assert.match(active, /placeholder="Уточнение или следующий вопрос…"/u);
  assert.doesNotMatch(active, /<textarea[^>]*\sdisabled=""/u, "пока агент работает, следующее сообщение можно готовить");
  assert.match(active, /<button[^>]*aria-label="Остановить агента"[^>]*data-testid="v3-aia-stop"/u, "круглая кнопка — «Остановить агента»");
  assert.doesNotMatch(active, /data-testid="v3-aia-send"/u);
  assert.doesNotMatch(active, /data-testid="v3-aia-direct"/u, "«Без черновика» задаётся при старте, не в начатом разговоре");

  const done = command(resumeRun({ status: "completed", endedAt: "2026-10-22T10:21:00.000Z", durationSeconds: 60, costCents: 11, summary: "Итог: **3** студента с просрочкой" }));
  assert.doesNotMatch(done, /Агент работает|Думает/u, "работа закончилась — индикатора в разметке нет, пока опрос не ответил");
  assert.doesNotMatch(done, /data-testid="v3-aia-progress"/u);
  assert.match(done, /Покажи студентов с просроченными документами/u);
  assert.match(done, /Итог: <strong[^>]*>3<\/strong> студента с просрочкой/u, "итог — тот, что хранится в строке запуска");
  assert.match(done, /data-testid="v3-aia-copy"/u, "под ответом есть «Скопировать»");
  assert.match(done, /data-testid="v3-aia-run-meta">1 мин 00 с · 0,11[^<]*\$<\/span>/u, "под последним ответом закончившегося запуска — длительность и расход из строки запуска");
  assert.doesNotMatch(done, /Разговор закончен/u);
  assert.match(done, /data-testid="v3-aia-new"/u, "«Новый разговор» всегда в колонке разговоров");
  assert.doesNotMatch(done, /<textarea[^>]*\sdisabled=""/u, "после конца можно продолжить сообщением");
  assert.doesNotMatch(done, /data-testid="v3-aia-stop"/u);
  assert.match(done, /<button[^>]*aria-label="Отправить"[^>]*data-testid="v3-aia-send"/u);
  assert.doesNotMatch(done, /data-testid="v3-aia-make-task"/u, "без права создавать задачи «Сделать задачей» нет");
  assert.match(body(bodyProps({ tab: "command", canMakeTasks: true, resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: resumeRun({ status: "completed", summary: "Итог" }) } })), /data-testid="v3-aia-make-task"/u);

  const failed = command(resumeRun({ status: "failed", errorCode: "mcp_auth_failed" }));
  assert.match(failed, /Токен доступа агента к CRM не принят/u);
  assert.match(failed, /data-testid="v3-aia-new"/u);

  // Начатый с полномочием разговор: слово «Без черновика» стоит в мете, переключателя нет.
  assert.match(command(resumeRun({ sendAuthority: true }), { sendAuthority: true }), /data-tone="warn">Без черновика<\/span>/u);

  // Старое поведение для вызова без строки запуска: считаем, что работа идёт, пока опрос не скажет иначе.
  const legacy = body(bodyProps({ tab: "command", resume: { runId: RESUME_RUN_ID, sendAuthority: false } }));
  assert.match(legacy, /data-testid="v3-aia-progress"/u);

  // Восстановления нет там, где писать нельзя, и когда разговора нет.
  const locked = body(bodyProps({ tab: "command", runtimeConfigured: false, resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: resumeRun() }, conversations: [resumeRun()] }));
  assert.doesNotMatch(locked, /v3-aia-progress|Покажи студентов с просроченными/u);
  assert.doesNotMatch(locked, /v3-aia-conversations|v3-aia-new/u, "заперто — списка разговоров и поля нет, только объяснение");
  assert.match(locked, /<a[^>]*data-testid="v3-aia-back" href="\/v3\/ai-agents\/director">[\s\S]*К разделам агента<\/a>/u, "на телефоне шапки страницы нет: у запертого состояния остаётся выход к разделам агента");
  const fresh = body(bodyProps({ tab: "command" }));
  assert.doesNotMatch(fresh, /v3-aia-progress/u);
  assert.match(fresh, /placeholder="Что поручить\?"/u);
});

test("«Мои разговоры»: список из своих запусков, выбранный отмечен, слова состояния и расход", async () => {
  const { body } = await views();
  const mine = [
    resumeRun({ id: "aaaaaaaa-1111-4111-8111-111111111111", status: "failed", startedAt: "2026-10-21T12:05:00.000Z", promptPreview: "Старое поручение", costCents: 0 }),
    resumeRun({ id: RESUME_RUN_ID, status: "running", startedAt: "2026-10-22T10:20:00.000Z", costCents: 11 }),
    resumeRun({ id: "bbbbbbbb-1111-4111-8111-111111111111", status: "completed", startedAt: "2026-10-22T08:05:00.000Z", promptPreview: "Закончено", costCents: 250 }),
  ];
  const html = body(bodyProps({ tab: "command", conversations: mine, resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: mine[1] } }));
  const list = html.slice(html.indexOf('data-testid="v3-aia-conversations"'));
  assert.equal((list.match(/data-testid="v3-aia-conversation-item"/gu) ?? []).length, 3);
  assert.ok(list.indexOf("Покажи студентов") < list.indexOf("Закончено") && list.indexOf("Закончено") < list.indexOf("Старое поручение"), "новые выше");
  assert.match(list, /aria-current="true"[^>]*data-testid="v3-aia-conversation-item"[^>]*>[\s\S]*?Покажи студентов с просроченными документами/u, "открытый разговор отмечен");
  assert.equal((list.match(/aria-current="true"/gu) ?? []).length, 1);
  assert.match(list, /Сегодня 16:20[\s\S]*?v3-aia-working-dot[\s\S]*?Идёт[\s\S]*?0,11/u, "время (Бишкек), «Идёт» с точкой, расход");
  assert.match(list, /Вчера 18:05[\s\S]*?text-danger[^>]*>[\s\S]*?Ошибка/u, "ошибка — красным и словом");
  assert.doesNotMatch(list.slice(list.indexOf("Закончено"), list.indexOf("Старое поручение")), /Готово|Идёт|Ошибка/u, "обычный «Готово» не подписывается");
  assert.match(html, /<span class="tabular-nums text-fg-3">3<\/span>/u, "в узкой шапке у «Разговоры» — число");
});

test("первый клик: кнопки синхронизации заперты, пока страница не гидратирована, и не теряют нажатие молча", async () => {
  const { body } = await views();
  const settings = body(bodyProps({ tab: "settings", needsSync: true }));
  for (const testId of ["v3-aia-sync", "v3-aia-rotate"]) {
    assert.match(settings, new RegExp(`<button[^>]*disabled=""[^>]*data-testid="${testId}"|<button[^>]*data-testid="${testId}"[^>]*disabled=""`, "u"), `${testId}: в серверной разметке заперта`);
  }
  const banner = body(bodyProps({ tab: "command", needsSync: true }));
  assert.match(banner, /<button[^>]*data-testid="v3-aia-sync-now"[^>]*disabled=""|<button[^>]*disabled=""[^>]*data-testid="v3-aia-sync-now"/u, "кнопка в плашке «Нужна синхронизация» тоже");
  // Поле «Поручить» и «Отправить» до гидратации: кнопка заперта пустым состоянием, текст подхватывает Console при монтировании.
  const command = body(bodyProps({ tab: "command" }));
  assert.match(command, /<button[^>]*disabled=""[^>]*data-testid="v3-aia-send"|<button[^>]*data-testid="v3-aia-send"[^>]*disabled=""/u);
});

test("исходники «Поручить»: ключ чата — у рабочей области, страница передаёт строку запуска и «Мои разговоры», набранное до гидратации подхватывается", () => {
  const bodySource = read("src/components/v3/ai-agents/AgentBody.tsx");
  assert.doesNotMatch(bodySource, /key=\{props\.runId/u, "ключ не от ?run=: после перерисовки сервером адрес и свойства меняются, а разговор — нет");
  assert.doesNotMatch(bodySource, /key=\{props\.resume/u);
  const workspace = read("src/components/v3/ai-agents/CommandWorkspace.tsx");
  assert.match(workspace, /<Console\s+key=\{opened\.n\}/u, "ключ Console — счётчик рабочей области");
  assert.match(workspace, /n: previous\.n \+ 1/u, "растёт только по выбору строки или «Новому разговору»");
  assert.doesNotMatch(workspace, /history\.pushState/u, "адрес обновляется на месте, без записей в истории");
  assert.match(workspace, /window\.history\.replaceState\(null, "", href\)/u);
  const pageSource = read("src/app/(v3)/v3/ai-agents/[key]/page.tsx");
  assert.match(pageSource, /run: toConversationRow\(runRead\.data\.run\)/u);
  assert.match(pageSource, /run: mine \}/u);
  assert.match(pageSource, /!route\.runId && !route\.fresh/u, "?new=1 пропускает автоподхват");
  assert.match(pageSource, /ownCommandRuns\(conversationsRead\.data\.runs, actor\.displayName/u);
  assert.match(pageSource, /fill=\{tab === "command"\}/u);
  const consoleSource = read("src/components/v3/ai-agents/Console.tsx");
  assert.match(consoleSource, /useLayoutEffect\(\(\) => \{\s*const typed = input\.current\?\.value/u, "текст из поля, набранный до гидратации, попадает в состояние");
  assert.doesNotMatch(consoleSource, /setWorking\(true\);\s*schedule\(/u, "«работает» следует статусу запуска, а не тому, что опрос не закончился");
  assert.match(consoleSource, /setWorking\(aiAgentRunIsActive\(poll\.run\.status\)\)|setWorking\(active\)/u);
  assert.match(read("src/lib/v3/board-layout.ts"), /tab === "command"/u);
});

/* Настоящий React в Chromium: серверная разметка гидратируется, как на странице (без Next). Серверные действия — записанные
 * заглушки в `window.__fake`; без установленного Chromium проверка пропускается словами, а не зеленеет. */
const BROWSER_SSR = `import { renderToString } from "react-dom/server";
import { AgentBody } from "@/components/v3/ai-agents/AgentBody";
export const render = (props) => renderToString(<AgentBody {...props} />);`;
const BROWSER_CLIENT = `import { hydrateRoot } from "react-dom/client";
import { AgentBody } from "@/components/v3/ai-agents/AgentBody";
import { registerTaskComposerOpener } from "@/components/v3/tasks/task-composer-context";
window.__registerOpener = (open) => registerTaskComposerOpener(open);
window.__gate.then(() => {
  const root = hydrateRoot(document.getElementById("root"), <AgentBody {...window.__PROPS} />, { onRecoverableError: (error) => window.__errors.push(String(error)) });
  window.__rerender = (over) => root.render(<AgentBody {...window.__PROPS} {...over} />);
});`;
const BROWSER_ACTIONS = `const act = (name) => async (...args) => window.__fake.call(name, args);
module.exports = { updateAiAgentAction: act("update"), saveAiAgentInstructionsAction: act("saveInstructions"), syncAiAgentAction: act("sync"),
  startAiAgentRunAction: act("start"), followUpAiAgentRunAction: act("followUp"), pollAiAgentRunAction: act("poll"),
  interruptAiAgentRunAction: act("interrupt"), loadAiAgentRunTranscriptAction: act("transcript"), decideAiAgentDraftAction: act("decide") };`;
const BROWSER_FAKE = () => {
  window.__fake = {
    calls: [], sent: [], pollScript: [], pollIndex: 0, startResult: null,
    async call(name, args) {
      this.calls.push(name);
      if (name === "sync") return { status: "saved", code: null, message: "Агент синхронизирован с Claude.", requestId: "r" };
      if (name === "decide") return this.decideResult ?? { status: "idle", code: null, message: null, requestId: null };
      if (name === "poll") return this.pollScript[Math.min(this.pollIndex++, this.pollScript.length - 1)] ?? { ok: false, code: "unavailable" };
      if (name === "start" || name === "followUp") {
        const form = args[1];
        this.sent.push({ name, text: form.get("text"), authority: form.get("send_authority"), runId: form.get("run_id") });
        return this.startResult ?? { status: "idle", code: null, message: null, requestId: null };
      }
      return { status: "idle", code: null, message: null, requestId: null };
    },
  };
};

let browserKitPromise;
const browserCleanups = [];
after(async () => { for (const cleanup of browserCleanups) await cleanup(); });
function browserKit() {
  browserKitPromise ??= (async () => {
    let chromium;
    try { ({ chromium } = createRequire(root("package.json"))("playwright")); } catch { return { skip: "playwright не установлен" }; }
    const dir = mkdtempSync(join(tmpdir(), "aia-browser-"));
    let browser;
    try {
      const resolveRoot = root("");
      const common = {
        bundle: true, jsx: "automatic", tsconfig: root("tsconfig.json"), absWorkingDir: resolveRoot, nodePaths: [root("node_modules")], logLevel: "silent",
        define: { "process.env.NODE_ENV": '"production"' },
        plugins: [{
          name: "aia-browser",
          setup(b) {
            b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
            b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
            b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
            b.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: resolveRoot, loader: "js" }));
            b.onResolve({ filter: /^@\/lib\/platform-ai-agents-actions$/ }, () => ({ path: "actions", namespace: "browser-actions" }));
            b.onLoad({ filter: /.*/, namespace: "browser-actions" }, () => ({ contents: BROWSER_ACTIONS, loader: "js" }));
            b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
          },
        }],
      };
      writeFileSync(join(dir, "ssr.tsx"), BROWSER_SSR);
      writeFileSync(join(dir, "client.tsx"), BROWSER_CLIENT);
      await build({ ...common, entryPoints: [join(dir, "ssr.tsx")], outfile: join(dir, "ssr.cjs"), platform: "node", format: "cjs" });
      await build({ ...common, entryPoints: [join(dir, "client.tsx")], outfile: join(dir, "client.js"), platform: "browser", format: "iife" });
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      return { skip: `Chromium не запустился: ${String(error?.message ?? error).split("\n")[0]}` };
    }
    const { render } = createRequire(import.meta.url)(join(dir, "ssr.cjs"));
    const clientJs = readFileSync(join(dir, "client.js"), "utf8");
    const scenarios = new Map();
    const server = createServer((request, response) => {
      const url = new URL(request.url, "http://x");
      if (url.pathname === "/client.js") { response.writeHead(200, { "content-type": "text/javascript" }); response.end(clientJs); return; }
      const props = scenarios.get(url.searchParams.get("s"));
      if (!props) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "content-type": "text/html" });
      // Гидратацию держит `window.__gate`: так проверяется и окно «разметка есть, JS ещё не ожил», и обычная жизнь после него.
      response.end(`<!doctype html><html><head><meta charset="utf-8"><title>aia</title></head><body><div id="root">${render(props)}</div>
<script>window.__PROPS=${JSON.stringify(props).replace(/</gu, "\\u003c")};window.__errors=[];window.__gate=new Promise(function(r){window.__release=r});</script>
<script src="/client.js"></script></body></html>`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browserCleanups.push(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });
    return {
      async open(name, props, { release = true } = {}) {
        scenarios.set(name, props);
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        await page.addInitScript(BROWSER_FAKE);
        await page.goto(`${base}/?s=${name}`);
        const hydrated = (selector) => page.waitForFunction((css) => { const element = document.querySelector(css); return element && Object.keys(element).some((key) => key.startsWith("__react")); }, selector, { timeout: 10_000 });
        if (release) { await page.evaluate(() => window.__release()); await hydrated("[data-testid=v3-aia-agent] a"); }
        return { page, context, hydrated };
      },
    };
  })();
  return browserKitPromise;
}
const ev = (id, kind, extra) => ({ id, at: "2026-10-22T10:20:01.000Z", kind, ...extra });
const pollRun = (status) => ({
  id: RESUME_RUN_ID, status, sendAuthority: false, startedAt: "2026-10-22T10:20:00.000Z", endedAt: status === "completed" ? "2026-10-22T10:21:00.000Z" : null,
  durationSeconds: status === "completed" ? 60 : null, costCents: 11, actionsCount: 0, summary: null, errorCode: null, errorMessage: null,
});
const poll = (status, events, over = {}) => ({ ok: true, poll: { run: pollRun(status), events, cursor: "c", done: false, pollAfterMs: 200, ...over } });
const consoleText = (page) => page.evaluate(() => document.querySelector("[data-testid=v3-aia-console]")?.innerText ?? "");

test("браузер: поле «Поручить» переживает перерисовку страницы сервером и текст, набранный до гидратации", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const props = bodyProps({ tab: "command" });
  const { page, context, hydrated } = await kit.open("typing", props, { release: false });
  try {
    await page.click("[data-testid=v3-aia-input]");
    await page.keyboard.type("первое поручение");
    assert.equal(await page.isDisabled("[data-testid=v3-aia-send]"), true, "до гидратации «Отправить» заперт");
    await page.evaluate(() => window.__release());
    await hydrated("[data-testid=v3-aia-input]");
    await page.waitForFunction(() => !document.querySelector("[data-testid=v3-aia-send]").disabled, null, { timeout: 5000 });
    assert.equal(await page.inputValue("[data-testid=v3-aia-input]"), "первое поручение", "набранное до гидратации не потеряно");

    await page.keyboard.type(" и уточнение");
    const typed = await page.inputValue("[data-testid=v3-aia-input]");
    assert.equal(typed, "первое поручение и уточнение");
    // Сервер перерисовал страницу (revalidatePath после действия): теперь у него есть запуск этого сотрудника.
    await page.evaluate((resume) => window.__rerender({ resume }), { runId: RESUME_RUN_ID, sendAuthority: false, run: resumeRun() });
    await page.waitForTimeout(300);
    assert.equal(await page.inputValue("[data-testid=v3-aia-input]"), typed, "перерисовка сервером не стёрла набранное");
    assert.deepEqual(await page.evaluate(() => window.__errors), [], "гидратация без ошибок");
    assert.deepEqual(await page.evaluate(() => window.__fake.calls.filter((name) => name === "poll")), [], "перерисовка не запустила чужой опрос: разговор остался новым");
  } finally { await context.close(); }
});

test("браузер: перезагрузка во время поручения восстанавливает поручение, ход и итог; «Новый разговор» не откатывается", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const { page, context } = await kit.open("active", bodyProps({ tab: "command", resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: resumeRun() } }), { release: false });
  try {
    const ssr = await consoleText(page);
    assert.match(ssr, /Покажи студентов с просроченными документами/u);
    assert.match(ssr, /Думает…/u);
    await page.evaluate((script) => { window.__fake.pollScript = script; }, [
      poll("running", [ev("e1", "user", { text: "Покажи студентов с просроченными документами" }), ev("e2", "tool_call", { tool: "list_tasks", label: "Задачи", argsSummary: "", builtin: false })]),
      poll("running", []),
      poll("completed", [ev("e3", "agent", { text: "Итог: у троих студентов просрочены документы." })], { pollAfterMs: 1500 }),
      poll("completed", [], { cursor: null, done: true, pollAfterMs: 0 }),
    ]);
    await page.evaluate(() => window.__release());
    await page.waitForSelector("[data-testid=v3-aia-progress]");
    await page.waitForFunction(() => document.querySelector("[data-testid=v3-aia-working]")?.textContent?.startsWith("Сейчас: смотрит задачи"), null, { timeout: 8000 });
    await page.waitForFunction(() => document.querySelector("[data-testid=v3-aia-console]").innerText.includes("Итог: у троих"), null, { timeout: 8000 });
    // Итог уже пришёл, а последний опрос (`done`) ещё нет: статус «Готово» — значит, строка хода уже снята.
    assert.equal(await page.evaluate(() => window.__fake.calls.filter((name) => name === "poll").length), 3, "четвёртый опрос ещё не прошёл");
    assert.equal(await page.locator("[data-testid=v3-aia-progress]").count(), 0, "работа закончилась — строка хода снята, не ждёт последнего опроса");
    await page.waitForFunction(() => window.__fake.calls.filter((name) => name === "poll").length >= 4, null, { timeout: 8000 });
    const done = await consoleText(page);
    assert.doesNotMatch(done, /Думает…|Сейчас:/u);
    assert.equal(await page.locator("[data-testid=v3-aia-tool-row]").count(), 1, "вызов инструмента из хроники Claude показан");
    assert.equal(await page.locator("[data-testid=v3-aia-steps]").count(), 1, "вызовы свёрнуты в один блок «Ход работы»");
    assert.match(await page.locator("[data-testid=v3-aia-steps] > summary").innerText(), /^Ход работы · 1 шаг/u);
    assert.equal(await page.locator("[data-kind=user]").count(), 1, "поручение показано один раз: заготовка уступила место событию Claude");
    assert.equal(await page.isEnabled("[data-testid=v3-aia-input]"), true, "продолжить сообщением можно");
    assert.equal(await page.locator("[data-testid=v3-aia-stop]").count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector("[data-testid=v3-aia-announce]").textContent), "Агент закончил работу.");

    await page.click("[data-testid=v3-aia-new]");
    await page.evaluate((resume) => window.__rerender({ resume }), { runId: "22222222-2222-4222-8333-222222222222", sendAuthority: false, run: resumeRun({ id: "22222222-2222-4222-8333-222222222222", status: "completed", summary: "Другой итог" }) });
    await page.waitForTimeout(300);
    const fresh = await consoleText(page);
    assert.doesNotMatch(fresh, /Итог: у троих|Другой итог/u, "«Новый разговор» остался новым после перерисовки сервером");
    assert.equal(await page.getAttribute("[data-testid=v3-aia-input]", "placeholder"), "Что поручить?");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "v3-aia-input", "после «Нового разговора» фокус в поле");
    assert.match(new URL(page.url()).search, /^\?tab=command&new=1$/u, "адрес обновился на месте");
  } finally { await context.close(); }
});

test("браузер: перезагрузка после конца поручения сразу показывает итог и не объявляет «агент ответил» заново", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const run = resumeRun({ status: "completed", endedAt: "2026-10-22T10:21:00.000Z", summary: "Итог: у троих студентов просрочены документы." });
  const { page, context } = await kit.open("finished", bodyProps({ tab: "command", resume: { runId: RESUME_RUN_ID, sendAuthority: false, run } }), { release: false });
  try {
    const ssr = await consoleText(page);
    assert.match(ssr, /Итог: у троих студентов/u, "итог на месте до гидратации и до опроса");
    assert.doesNotMatch(ssr, /Думает…/u);
    await page.evaluate((script) => { window.__fake.pollScript = script; }, [
      poll("completed", [ev("e1", "user", { text: "Покажи студентов с просроченными документами" }), ev("e3", "agent", { text: "Итог: у троих студентов просрочены документы." })], { pollAfterMs: 1200 }),
      poll("completed", [], { cursor: null, done: true, pollAfterMs: 0 }),
    ]);
    await page.evaluate(() => window.__release());
    await page.waitForFunction(() => window.__fake.calls.filter((name) => name === "poll").length >= 1, null, { timeout: 8000 });
    const states = [];
    for (let i = 0; i < 6; i += 1) { states.push(await consoleText(page)); await page.waitForTimeout(100); }
    assert.equal(await page.evaluate(() => window.__fake.calls.filter((name) => name === "poll").length), 1, "хроника пришла, последний опрос ещё впереди");
    assert.equal(states.some((text) => /Думает…|Сейчас:/u.test(text)), false, "пока опрос дочитывает хронику закончившегося разговора, «работает» не мигает");
    await page.waitForFunction(() => window.__fake.calls.filter((name) => name === "poll").length >= 2, null, { timeout: 8000 });
    assert.equal(await page.locator("[data-kind=agent]").count(), 1);
    assert.equal(await page.evaluate(() => document.querySelector("[data-testid=v3-aia-announce]").textContent), "", "о восстановленном разговоре экранному диктору ничего не объявляется");
    assert.equal(await page.locator("[data-testid=v3-aia-run-meta]").count(), 1, "под ответом закончившегося запуска — длительность и расход");
  } finally { await context.close(); }
});

const NEW_RUN_ID = "33333333-3333-4333-8333-333333333333";

test("браузер: пример кладёт текст в поле и не отправляет; Enter отправляет, Shift+Enter — строка; во время работы кнопка «Остановить», Enter молчит", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const { page, context } = await kit.open("compose", bodyProps({ tab: "command" }));
  try {
    await page.waitForFunction(() => !document.querySelector("[data-testid=v3-aia-input]").readOnly, null, { timeout: 5000 });
    // Пример: текст в поле, фокус в поле, каретка в конце; ничего не отправлено.
    await page.click("ul[aria-label='Примеры поручений'] li:nth-child(1) button");
    assert.equal(await page.inputValue("[data-testid=v3-aia-input]"), "Подготовь недельный отчёт за прошлую неделю");
    assert.deepEqual(await page.evaluate(() => { const el = document.activeElement; return [el.getAttribute("data-testid"), el.selectionStart === el.value.length && el.selectionEnd === el.value.length]; }), ["v3-aia-input", true]);
    assert.deepEqual(await page.evaluate(() => window.__fake.sent), [], "пример не отправляется");
    await page.fill("[data-testid=v3-aia-input]", "");
    assert.equal(await page.isDisabled("[data-testid=v3-aia-send]"), true, "пусто — «Отправить» заперт");

    await page.evaluate(({ run }) => {
      window.__fake.startResult = { status: "saved", code: null, message: null, requestId: "r", runId: run };
      window.__fake.pollScript = [
        { ok: true, poll: { run: { id: run, status: "running", sendAuthority: false, startedAt: "2026-10-22T10:20:00.000Z", endedAt: null, durationSeconds: null, costCents: 0, actionsCount: 0 }, events: [
          { id: "u1", at: "2026-10-22T10:20:01.000Z", kind: "user", text: "первая строка\nвторая" },
          { id: "c1", at: "2026-10-22T10:20:02.000Z", kind: "tool_call", tool: "search_clients", label: "Клиенты", argsSummary: "", builtin: false }], cursor: "c", done: false, pollAfterMs: 200 } },
      ];
    }, { run: NEW_RUN_ID });
    await page.click("[data-testid=v3-aia-input]");
    await page.keyboard.type("первая строка");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("вторая");
    assert.equal(await page.inputValue("[data-testid=v3-aia-input]"), "первая строка\nвторая", "Shift+Enter — новая строка");
    assert.deepEqual(await page.evaluate(() => window.__fake.sent), [], "Shift+Enter не отправляет");
    await page.keyboard.press("Enter");
    await page.waitForSelector("[data-testid=v3-aia-stop]");
    assert.deepEqual(await page.evaluate(() => window.__fake.sent.map((one) => [one.name, one.text, one.authority, one.runId])), [["start", "первая строка\nвторая", "0", null]]);
    assert.equal(await page.inputValue("[data-testid=v3-aia-input]"), "", "после отправки поле пусто");
    assert.equal(await page.getAttribute("[data-testid=v3-aia-stop]", "aria-label"), "Остановить агента");
    assert.equal(await page.isEnabled("[data-testid=v3-aia-input]"), true, "поле доступно: следующее сообщение можно готовить");
    assert.equal(await page.getAttribute("[data-testid=v3-aia-input]", "placeholder"), "Уточнение или следующий вопрос…");

    // Разговор появился в списке сразу — «Идёт», адрес стал ?run=…
    await page.waitForFunction(() => document.querySelector("[data-testid=v3-aia-working]")?.textContent === "Сейчас: ищет клиента", null, { timeout: 5000 });
    const item = page.locator("[data-testid=v3-aia-conversation-item]");
    assert.equal(await item.count(), 1);
    assert.match(await item.innerText(), /первая строка\s+вторая[\s\S]*Идёт/u);
    assert.equal(await item.getAttribute("aria-current"), "true");
    assert.equal(new URL(page.url()).search, `?tab=command&run=${NEW_RUN_ID}`);
    assert.match(await page.locator("[data-testid=v3-aia-steps] > summary").innerText(), /^Ход работы · шаг 1 · ищет клиента…/u);
    assert.match(await page.locator("[data-testid=v3-aia-progress]").innerText(), /· 0:0\d/u, "время хода идёт");

    // Пока агент работает, Enter ничего не отправляет и не вставляет строку.
    await page.click("[data-testid=v3-aia-input]");
    await page.keyboard.type("дальше");
    await page.keyboard.press("Enter");
    assert.equal(await page.inputValue("[data-testid=v3-aia-input]"), "дальше");
    assert.equal(await page.evaluate(() => window.__fake.sent.length), 1);
    await page.click("[data-testid=v3-aia-stop]");
    await page.waitForFunction(() => window.__fake.calls.includes("interrupt"), null, { timeout: 3000 });
  } finally { await context.close(); }
});

test("браузер: «Скопировать» и «Сделать задачей» под ответом; без диалога задачи кнопка исчезает, а текст не теряется", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const answer = "## Итог недели\n\nВыручка выросла на **12 %**.";
  const run = resumeRun({ status: "completed", endedAt: "2026-10-22T10:21:00.000Z", summary: answer });
  const { page, context } = await kit.open("answer", bodyProps({ tab: "command", canMakeTasks: true, resume: { runId: RESUME_RUN_ID, sendAuthority: false, run } }));
  try {
    await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__copied = text; } } }); });

    await page.click("[data-testid=v3-aia-copy]");
    assert.equal(await page.evaluate(() => window.__copied), answer, "копируется текст ответа как Markdown");
    assert.equal(await page.locator("[data-testid=v3-aia-copy]").innerText(), "Скопировано");
    assert.equal(await page.locator("[data-testid=v3-aia-copy] ~ [role=status]").textContent(), "Скопировано", "слово слышно и вслух");

    // Диалога задач нет (нет права или страница вне оболочки): кнопка исчезает, адрес не меняется.
    const before = page.url();
    await page.click("[data-testid=v3-aia-make-task]");
    assert.equal(await page.locator("[data-testid=v3-aia-make-task]").count(), 0);
    assert.equal(page.url(), before);
  } finally { await context.close(); }

  // Диалог есть: он открывается с названием из первой строки и самим ответом в описании.
  const second = await kit.open("answer-task", bodyProps({ tab: "command", canMakeTasks: true, resume: { runId: RESUME_RUN_ID, sendAuthority: false, run } }));
  try {
    await second.page.evaluate(() => { window.__task = null; window.__registerOpener((context) => { window.__task = context; }); });
    await second.page.click("[data-testid=v3-aia-make-task]");
    assert.deepEqual(await second.page.evaluate(() => window.__task), { title: "Итог недели", description: answer });
    assert.equal(await second.page.locator("[data-testid=v3-aia-make-task]").count(), 1, "кнопка остаётся");
  } finally { await second.context.close(); }
});

test("браузер: выбор разговора в списке и лист «Разговоры» на узком экране", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const other = resumeRun({ id: "44444444-4444-4444-8444-444444444444", status: "completed", startedAt: "2026-10-21T12:05:00.000Z", endedAt: "2026-10-21T12:06:00.000Z", promptPreview: "Вчерашнее поручение", summary: "Вчерашний итог" });
  const current = resumeRun({ status: "completed", endedAt: "2026-10-22T10:21:00.000Z", summary: "Сегодняшний итог" });
  const { page, context } = await kit.open("select", bodyProps({ tab: "command", conversations: [current, other], resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: current } }));
  try {
    await page.evaluate(({ id }) => {
      window.__fake.pollScript = [{ ok: true, poll: { run: { id, status: "completed", sendAuthority: false, startedAt: "2026-10-21T12:05:00.000Z", endedAt: "2026-10-21T12:06:00.000Z", durationSeconds: 60, costCents: 0, actionsCount: 0 }, events: [], cursor: null, done: true, pollAfterMs: 0 } }];
    }, { id: other.id });
    assert.equal(await page.locator("[data-testid=v3-aia-conversation-item][aria-current=true]").innerText().then((text) => text.includes("Покажи студентов")), true);
    // Лист узкого экрана: открывается модально, строка выбирает разговор и закрывает лист, фокус возвращается на «Разговоры».
    await page.click("[data-testid=v3-aia-conversations-open]");
    await page.waitForSelector("dialog[open][data-testid=v3-aia-conversations-sheet]");
    assert.equal(await page.evaluate(() => document.querySelector("dialog[data-testid=v3-aia-conversations-sheet]").matches(":modal")), true);
    await page.click("dialog[open] [data-testid=v3-aia-conversation-item]:has-text('Вчерашнее поручение')");
    await page.waitForSelector("dialog[open]", { state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "v3-aia-conversations-open");
    await page.waitForFunction(() => document.querySelector("[data-testid=v3-aia-console]").innerText.includes("Вчерашний итог"), null, { timeout: 5000 });
    const consoleNow = await consoleText(page);
    assert.doesNotMatch(consoleNow, /Сегодняшний итог/u, "в чате — выбранный разговор, а не прежний");
    assert.equal(new URL(page.url()).search, `?tab=command&run=${other.id}`);
    assert.equal(await page.locator("aside [data-testid=v3-aia-conversation-item][aria-current=true]").innerText().then((text) => text.includes("Вчерашнее поручение")), true, "выделена выбранная строка");
    // Сервер перерисовал страницу с другим «последним» разговором: выбор вкладки не меняется.
    await page.evaluate((resume) => window.__rerender({ resume }), { runId: RESUME_RUN_ID, sendAuthority: false, run: current });
    await page.waitForTimeout(200);
    assert.match(await consoleText(page), /Вчерашний итог/u);

    // Esc закрывает лист и возвращает фокус.
    await page.click("[data-testid=v3-aia-conversations-open]");
    await page.waitForSelector("dialog[open]");
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog[open]", { state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "v3-aia-conversations-open");
  } finally { await context.close(); }
});

test("браузер: продолжение закончившегося разговора сразу видно в списке; прерванный вызов не делает «идущим» новый оборот, часы — от последнего сообщения", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const done = resumeRun({ status: "completed", endedAt: "2026-10-22T10:21:00.000Z", durationSeconds: 60, costCents: 5, summary: "Итог" });
  const first = [ev("e1", "user", { text: "Покажи студентов с просроченными документами" }), ev("e3", "agent", { text: "Итог" })];
  const { page, context } = await kit.open("follow-live", bodyProps({ tab: "command", conversations: [done], resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: done } }), { release: false });
  try {
    await page.evaluate(({ first, next }) => {
      window.__fake.startResult = { status: "saved", code: null, message: null, requestId: "r" };
      window.__fake.pollScript = [
        { ok: true, poll: { run: { id: next.run.id, status: "completed", sendAuthority: false, startedAt: next.run.startedAt, endedAt: "2026-10-22T10:21:00.000Z", durationSeconds: 60, costCents: 5, actionsCount: 0 }, events: first, cursor: "c", done: true, pollAfterMs: 0 } },
        { ok: true, poll: { run: { ...next.run, status: "running", costCents: 9 }, events: next.events, cursor: "c2", done: false, pollAfterMs: 200 } },
      ];
    }, {
      first,
      next: {
        run: { id: RESUME_RUN_ID, sendAuthority: false, startedAt: "2026-10-22T10:20:00.000Z", endedAt: null, durationSeconds: null, actionsCount: 0 },
        events: [
          ev("t1", "tool_call", { tool: "search_clients", label: "Клиенты", argsSummary: "", builtin: false }),
          ev("e5", "user", { text: "Уточни по двум", at: new Date(Date.now() - 5000).toISOString() }),
        ],
      },
    });
    await page.evaluate(() => window.__release());
    await page.waitForFunction(() => window.__fake.calls.filter((name) => name === "poll").length >= 1 && !document.querySelector("[data-testid=v3-aia-input]").readOnly, null, { timeout: 8000 });
    assert.doesNotMatch(await page.locator("[data-testid=v3-aia-conversation-item]").innerText(), /Идёт/u);

    await page.click("[data-testid=v3-aia-input]");
    await page.keyboard.type("Уточни по двум");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /Идёт/u.test(document.querySelector("[data-testid=v3-aia-conversation-item]")?.innerText ?? ""), null, { timeout: 5000 });
    assert.match(await page.locator("[data-testid=v3-aia-conversation-item]").innerText(), /0,09/u, "расход из опроса виден в строке списка");
    assert.equal(await page.locator("[data-testid=v3-aia-working]").innerText(), "Думает…", "вызов из прошлого оборота не идёт");
    assert.match(await page.locator("[data-testid=v3-aia-steps] > summary").innerText(), /^Ход работы · 1 шаг$/u, "и серия не говорит, что вызов ещё идёт");
    await page.waitForFunction(() => /· 0:\d\d$/u.test(document.querySelector("[data-testid=v3-aia-progress]")?.innerText ?? ""), null, { timeout: 5000 });
  } finally { await context.close(); }

  // Вкладку открыли посреди продолжения: пока опрос не принёс сообщение, часы показывают время с начала разговора,
  // затем — с последнего сообщения сотрудника.
  const running = resumeRun({ status: "running" });
  const reopened = await kit.open("clock", bodyProps({ tab: "command", resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: running } }), { release: false });
  try {
    await reopened.page.evaluate((events) => {
      window.__fake.pollScript = [{ ok: true, poll: { run: { id: events[0].runId, status: "running", sendAuthority: false, startedAt: "2026-10-22T10:20:00.000Z", endedAt: null, durationSeconds: null, costCents: 0, actionsCount: 0 }, events: events.slice(1), cursor: "c", done: false, pollAfterMs: 200 } }];
    }, [{ runId: RESUME_RUN_ID }, ev("e1", "user", { text: "Вопрос", at: new Date(Date.now() - 5000).toISOString() })]);
    await reopened.page.evaluate(() => window.__release());
    await reopened.page.waitForFunction(() => /· 0:\d\d$/u.test(document.querySelector("[data-testid=v3-aia-progress]")?.innerText ?? ""), null, { timeout: 5000 });
  } finally { await reopened.context.close(); }
});

test("исходники: меню страницы не прячет фокус на телефоне, поле поручения следит за шириной, запертое состояние не тупик", () => {
  const css = read("src/app/(v3)/v3.css");
  assert.equal((css.match(/> :not\(:last-child\):not\(:focus-within\)/gu) ?? []).length, 2, "скрытая шапка и полоса вкладок показываются, пока в них фокус");
  const composer = read("src/components/v3/ai-agents/AgentComposer.tsx");
  assert.match(composer, /new ResizeObserver/u, "высота поля пересчитывается и при смене ширины");
  assert.match(composer, /@max-md:flex-wrap/u);
  assert.match(composer, /bg-warn-weak text-warn @max-md:basis-full/u, "нажатая «Без черновика» на узком экране занимает свою строку");
  assert.match(read("src/components/v3/ai-agents/CommandWorkspace.tsx"), /data-testid="v3-aia-back"/u);
});

test("браузер: кнопка «Синхронизировать» после гидратации работает с первого нажатия", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const { page, context, hydrated } = await kit.open("sync", bodyProps({ tab: "settings", needsSync: true }), { release: false });
  try {
    assert.equal(await page.isDisabled("[data-testid=v3-aia-sync]"), true, "до гидратации кнопка видимо заперта, нажатие не пропадает молча");
    await page.evaluate(() => window.__release());
    await hydrated("[data-testid=v3-aia-sync]");
    await page.waitForFunction(() => !document.querySelector("[data-testid=v3-aia-sync]").disabled, null, { timeout: 5000 });
    await page.click("[data-testid=v3-aia-sync]");
    await page.waitForFunction(() => window.__fake.calls.includes("sync"), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__fake.calls.filter((name) => name === "sync").length), 1, "одно нажатие — одна синхронизация");
    await page.waitForSelector("[data-testid=v3-aia-sync-message]");
  } finally { await context.close(); }
});

const DRAFT_COUNTS = (over = {}) => ({ pending: 0, approved: 0, sending: 0, sent: 0, discarded: 0, failed: 0, expired: 0, ...over });
const browserDraft = (over = {}) => ({
  id: "d1", agentKey: "director", runId: null, channel: "whatsapp", status: "pending", text: "Здравствуйте!", editedText: null, targetLabel: "Чат · +996 *** 45 67",
  conversationId: "5d3b1a2c-1111-4222-8333-444455556666", studentCaseId: null, leadId: null, reason: null, failureCode: null,
  sourceMessage: { text: "Когда подавать документы?", at: NOW }, createdAt: NOW, expiresAt: "2026-10-29T10:00:00.000Z", decidedByName: null, decidedAt: null, sentAt: null, sentByAgent: false, ...over,
});

test("браузер: после «Одобрить и отправить» карточка остаётся со словом «Отправлено», хотя сервер уже не возвращает её в «Ждут решения»", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const draft = browserDraft();
  const props = bodyProps({ tab: "drafts", drafts: { status: "available", data: { drafts: [draft], counts: DRAFT_COUNTS({ pending: 1 }) } } });
  const { page, context, hydrated } = await kit.open("draft-approve", props);
  try {
    await hydrated("[data-testid=v3-aia-approve]");
    await page.waitForFunction(() => !document.querySelector("[data-testid=v3-aia-approve]").disabled, null, { timeout: 5000 });
    await page.fill("[data-testid=v3-aia-draft-text]", "Здравствуйте! Подавать можно с 1 ноября.");
    await page.evaluate(() => { window.__fake.decideResult = { status: "saved", code: null, message: "Отправлено.", requestId: "r", draftStatus: "sent", failureCode: null }; });
    await page.click("[data-testid=v3-aia-approve]");
    await page.waitForSelector("[data-testid=v3-aia-draft-result]");
    // Сервер перерисовал страницу (revalidatePath): ждущих решения больше нет, а «Все» уже показывает отправленный.
    await page.evaluate(() => window.__rerender({ drafts: { status: "available", data: { drafts: [], counts: { pending: 0, approved: 0, sending: 0, sent: 1, discarded: 0, failed: 0, expired: 0 } } } }));
    await page.waitForTimeout(300);
    const card = await page.innerText("[data-testid=v3-aia-drafts]");
    assert.match(card, /Отправлено\./u, "слово результата не пропало вместе с карточкой");
    assert.match(card, /Отправлен/u, "статус карточки — «Отправлен»");
    assert.match(card, /Здравствуйте! Подавать можно с 1 ноября\./u, "показан тот текст, что ушёл клиенту, а не исходный");
    assert.match(card, /Открыть чат/u);
    assert.equal(await page.locator("[data-testid=v3-aia-approve]").count(), 0, "решённую карточку не одобряют второй раз");
    assert.equal(await page.locator("[data-testid=v3-aia-drafts-empty]").count(), 0, "пустого «Нет черновиков» над решённой карточкой нет");
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
  } finally { await context.close(); }
});

test("браузер: несохранённая инструкция — переход по ссылке спрашивает подтверждение, «Отмена» оставляет на месте", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const { page, context, hydrated } = await kit.open("dirty", bodyProps({ tab: "instructions" }));
  try {
    const dialogs = [];
    page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await hydrated("[data-testid=v3-aia-instructions-text]");
    const before = page.url();
    await page.click("a[href='/v3/ai-agents/director?tab=runs']");
    assert.deepEqual(dialogs, [], "без правок переход не спрашивает (страницы-цели в стенде нет — запрос уходит и ничего не ломает)");
    await page.goto(before);
    await page.evaluate(() => window.__release());
    await hydrated("[data-testid=v3-aia-instructions-text]");
    await page.fill("[data-testid=v3-aia-instructions-text]", "Другая инструкция");
    assert.match(await page.innerText("[data-testid=v3-aia-instructions]"), /Есть несохранённые изменения/u);
    await page.click("a[href='/v3/ai-agents/director?tab=runs']");
    assert.deepEqual(dialogs, ["Есть несохранённые изменения. Перейти без сохранения?"]);
    assert.equal(page.url(), before, "«Отмена» — остались на странице");
    assert.equal(await page.inputValue("[data-testid=v3-aia-instructions-text]"), "Другая инструкция", "набранное цело");
  } finally { await context.close(); }
});

test("браузер: «Повторить» под ошибкой отправляет последнее сообщение сотрудника в тот же разговор", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const failedRun = resumeRun({ status: "failed", errorCode: "anthropic_error", endedAt: "2026-10-22T10:21:00.000Z" });
  const { page, context, hydrated } = await kit.open("retry", bodyProps({ tab: "command", resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: failedRun } }));
  try {
    await hydrated("[data-testid=v3-aia-retry]");
    await page.click("[data-testid=v3-aia-retry]");
    await page.waitForFunction(() => window.__fake.sent.length === 1, null, { timeout: 5000 });
    const sent = await page.evaluate(() => window.__fake.sent[0]);
    assert.equal(sent.name, "followUp");
    assert.equal(sent.runId, RESUME_RUN_ID);
    assert.equal(sent.text, "Покажи студентов с просроченными документами");
  } finally { await context.close(); }
});

/* ------------------------------------------- чистка интерфейса «ИИ-агенты» (24.10.2026) */

test("чистка: разметка Markdown в строке запуска снимается, роль без состояния, «кто запустил», время и коды ошибок — словами", () => {
  assert.equal(
    plainPreview("**Вывод.** В CRM за 7 дней — `curator-my`\n\n| Источник | Что это |\n|---|---|\n| amoCRM | заявки |"),
    "Вывод. В CRM за 7 дней — curator-my Источник · Что это amoCRM · заявки",
  );
  assert.equal(plainPreview("## Итоги\n- первое\n- **второе**\n```\nкод\n```\n---"), "Итоги первое второе", "заголовок, список, кодовый блок и линейка");
  assert.equal(plainPreview(null), "");
  const clipped = plainPreview("а".repeat(300), 50);
  assert.equal(clipped.length, 50);
  assert.ok(clipped.endsWith("…"));

  assert.equal(aiAgentRoleLine("Европа (Италия, Чехия): инструкции пока нет, агент выключен"), "Европа (Италия, Чехия)");
  assert.equal(aiAgentRoleLine("ОАЭ: инструкции пока нет, агент выключен"), "ОАЭ");
  assert.equal(aiAgentRoleLine("Считает продажи, воронку и поступление"), "Считает продажи, воронку и поступление");

  assert.equal(runOriginLabel({ triggerKind: "command", startedByName: "Админ" }, "Админ"), "Вы");
  assert.equal(runOriginLabel({ triggerKind: "command", startedByName: "Мария" }, "Админ"), "Мария");
  assert.equal(runOriginLabel({ triggerKind: "command", startedByName: null }, "Админ"), "Сотрудник");
  assert.equal(runOriginLabel({ triggerKind: "schedule", startedByName: null }, "Админ"), "По расписанию");
  assert.equal(runOriginLabel({ triggerKind: "website_lead", startedByName: null }), "Новая заявка с сайта");

  const started = "2026-10-23T06:34:00.000Z";
  assert.equal(formatClockRu("2026-10-23T06:35:00.000Z", started), "12:35", "в тот же день — только время");
  assert.equal(formatClockRu("2026-10-24T06:00:00.000Z", started), "24 окт, 12:00", "в другой день — с датой");

  assert.equal(actionArgsWords("body=<619 симв.>; dedupe_key=<29 симв.>; title=<61 симв.>"), "body=<619 симв.>; title=<61 симв.>", "служебный ключ повтора не показывается");
  assert.equal(actionArgsWords(null), "");
  assert.equal(toolErrorWords("not_found"), "не найдено");
  assert.equal(toolErrorWords("invalid_arguments"), "неверные данные");
  assert.equal(toolErrorWords("что-то_новое"), "ошибка");
  for (const code of AI_AGENT_TOOL_ERROR_CODES) assert.notEqual(toolErrorWords(code), "ошибка", `${code}: у каждого кода инструмента есть слово`);
});

test("следующий шаг запуска агента: инструкция → включить → синхронизировать; не админу, без ключа и в просмотре шага нет", () => {
  const ready = { canEdit: true, runtimeConfigured: true, preview: false, hasInstructions: true, enabled: true, synced: true };
  assert.equal(aiAgentNextStep(ready), null, "агент готов");
  assert.equal(aiAgentNextStep({ ...ready, hasInstructions: false, enabled: false, synced: false }), "instructions");
  assert.equal(aiAgentNextStep({ ...ready, enabled: false, synced: false }), "enable");
  assert.equal(aiAgentNextStep({ ...ready, synced: false }), "sync");
  for (const guard of [{ canEdit: false }, { runtimeConfigured: false }, { preview: true }]) {
    assert.equal(aiAgentNextStep({ ...ready, ...guard, hasInstructions: false }), null, JSON.stringify(guard));
  }
});

test("шапка агента: переключатели — единственное место; без инструкции «Включён» заперт и ведёт к инструкции; не админ видит слова", async () => {
  const { switches } = await views();
  const base = { agentKey: "director", enabled: true, autoSend: false, configVersion: 12, hasInstructions: true, canEdit: true };
  const admin = switches(base);
  assert.equal((admin.match(/role="switch"/gu) ?? []).length, 2, "«Включён» и «Авто»");
  assert.match(admin, /--switch-thumb-on:var\(--surface\)/u, "бегунок включённого переключателя — цвета листа, а не дорожки (иначе включённый — сплошной чёрный)");
  assert.doesNotMatch(admin, /Агент работает: расписание и события активны|Сообщения клиентам уходят в «Черновики»/u, "подсказки живут в подтверждении, не рядом с каждым переключателем");

  const locked = switches({ ...base, agentKey: "curator-eu", enabled: false, hasInstructions: false });
  assert.match(locked, /<button[^>]*role="switch"[^>]*aria-checked="false"[^>]*aria-disabled="true"[^>]*data-testid="v3-aia-switch-enabled"/u, "нажатие, которое заведомо кончится отказом, не предлагается");
  assert.match(locked, /<a[^>]*data-testid="v3-aia-switch-needs-instructions" href="\/v3\/ai-agents\/curator-eu\?tab=instructions">Сначала напишите инструкцию<\/a>/u);
  assert.doesNotMatch(switches({ ...base, enabled: true }), /v3-aia-switch-needs-instructions/u);

  const staff = switches({ ...base, canEdit: false, autoSend: true });
  assert.doesNotMatch(staff, /role="switch"/u);
  assert.match(staff, /data-testid="v3-aia-switch-enabled-readonly"[\s\S]*Включён/u, "одно слово состояния, не «Включён вкл»");
  assert.match(staff, /Авто: вкл/u);
  assert.doesNotMatch(staff, />вкл<|>выкл</u);
  const staffOff = switches({ ...base, canEdit: false, enabled: false });
  assert.match(staffOff, /Выключен/u);
  assert.doesNotMatch(staffOff, /Авто/u, "«Авто» показывается, только когда включено");
});

const unsetDetail = (over = {}) => ({
  ...DETAIL, key: "curator-eu", title: "Куратор Европа", roleLine: "Европа (Италия, Чехия)", hasInstructionsOverride: false, instructionsOverride: null, enabled: false,
  sync: sync({ status: "never", claudeAgentId: null, agentVersion: null, environmentId: null, vaultId: null, configHash: null }),
  stats: stats({ runs7d: 0, failed7d: 0, actions7d: 0, costCents7d: 0, draftsPending: 0, lastRunAt: null, lastRunStatus: null }),
  charts: { runsPerDay: [], spendPerDay: [], actionsByTool: [] }, lastDigest: null, ...over,
});

test("ненастроенный агент: «Обзор» — три шага и одна кнопка, «Поручить» — причина и та же кнопка; не админу — слова без кнопок", async () => {
  const { body } = await views();
  const overview = body(bodyProps({ detail: unsetDetail(), digests: { status: "available", data: { digests: [] } } }));
  assert.match(overview, /data-testid="v3-aia-setup"[\s\S]*Агент не настроен[\s\S]*Инструкция[\s\S]*Написать инструкцию[\s\S]*Включение[\s\S]*Отправка в Claude/u);
  assert.match(overview, /<a[^>]*data-testid="v3-aia-setup-instructions" href="\/v3\/ai-agents\/curator-eu\?tab=instructions">Написать инструкцию<\/a>/u);
  assert.doesNotMatch(overview, /Запусков ещё не было|Поручите агенту первую задачу|v3-aia-first-run/u, "«Поручить» не предлагается, пока оно заперто (раньше два экрана противоречили друг другу)");
  assert.doesNotMatch(overview, /Запусков за 7 дней|v3-aia-day-bars|Отчётов пока нет/u, "десяти пустых блоков нет");

  const chat = body(bodyProps({ tab: "command", detail: unsetDetail() }));
  assert.match(chat, /Писать агенту пока нельзя[\s\S]*У агента нет инструкции\. Без неё его не включить\.[\s\S]*Написать инструкцию/u);
  assert.doesNotMatch(chat, /data-testid="v3-aia-input"|Включает его системный администратор переключателем/u);
  assert.doesNotMatch(chat, /<h3[^>]*>Куратор Европа<\/h3>|Европа \(Италия, Чехия\)/u, "название и роль под заголовком страницы не повторяются");

  // Инструкция есть, агент выключен: первый шаг — «Включить агента» (то же действие, что у «Включён» в шапке)
  const off = unsetDetail({ hasInstructionsOverride: true, instructionsOverride: "Инструкция" });
  assert.match(body(bodyProps({ detail: off, digests: { status: "available", data: { digests: [] } } })), /data-testid="v3-aia-enable-now"[^>]*>Включить агента/u);
  assert.match(body(bodyProps({ tab: "command", detail: off })), /data-testid="v3-aia-enable-now"[^>]*>Включить агента/u);
  // Включён, но не отправлен в Claude: «Синхронизировать»
  assert.match(body(bodyProps({ tab: "command", detail: { ...off, enabled: true } })), /data-testid="v3-aia-sync-now"/u);

  const staffOverview = body(bodyProps({ canEdit: false, detail: unsetDetail(), digests: { status: "available", data: { digests: [] } } }));
  assert.match(staffOverview, /data-testid="v3-aia-blocked-note"[^>]*>[\s\S]*У агента нет инструкции — её пишет системный администратор\./u);
  assert.doesNotMatch(staffOverview, /v3-aia-setup|v3-aia-enable-now|v3-aia-sync-now|v3-aia-setup-instructions/u, "не администратору кнопок шагов нет");
  const staffChat = body(bodyProps({ canEdit: false, tab: "command", detail: unsetDetail() }));
  assert.match(staffChat, /Писать агенту пока нельзя[\s\S]*У агента нет инструкции — её пишет системный администратор\./u);
  assert.doesNotMatch(staffChat, /v3-aia-setup-instructions|v3-aia-enable-now/u);
  // Инструкции нет: в «Инструкции» одно слово об этом, а не чип и абзац с тем же; про загрузку, которой нет, ничего
  const instructions = body(bodyProps({ tab: "instructions", detail: unsetDetail() }));
  assert.match(instructions, /Инструкции нет\. Без неё агента не включить\./u);
  assert.doesNotMatch(instructions, /загрузите|Инструкции пока нет/u);
  // «Синхронизировать» без инструкции заперта и объясняет причину ссылкой
  const settings = body(bodyProps({ tab: "settings", detail: unsetDetail() }));
  assert.match(settings, /<button[^>]*disabled=""[^>]*data-testid="v3-aia-sync"/u);
  assert.match(settings, /Сначала напишите <a[^>]*href="\/v3\/ai-agents\/curator-eu\?tab=instructions">инструкцию<\/a>/u);
});

test("запуск: ошибки действий словами, неудавшиеся выше, «Готово» при ошибках говорит об этом, действия — над своим поручением", async () => {
  const { body } = await views();
  const runId = "33333333-3333-4333-8333-333333333333";
  const run = { id: runId, agentKey: "director", status: "completed", triggerKind: "command", startedAt: NOW, endedAt: "2026-10-22T10:31:00.000Z",
    durationSeconds: 42, promptPreview: "Покажи студентов", summary: "| Источник | Что это |\n|---|---|\n| amoCRM | заявки |", errorCode: null, errorMessage: null,
    model: "claude-sonnet-5-5", agentVersion: 2, sessionId: "sesn_1", inputTokens: 20, outputTokens: 3435, cacheReadTokens: 270025, costCents: 17,
    sendAuthority: false, startedByName: "Админ", actionsCount: 2, draftsCount: 0 };
  const action = (id, over) => ({ id, agentKey: "director", runId, tool: "sales_report", argsSummary: "from_month=2026-09", resultStatus: "ok", errorCode: null, durationMs: 5, at: "2026-10-22T10:31:00.000Z", ...over });
  const actions = [action("1"), action("2", { tool: "notify_staff", argsSummary: "body=<619 симв.>; dedupe_key=<29 симв.>; title=<61 симв.>", resultStatus: "error", errorCode: "not_found" })];
  const read = (over) => ({ status: "available", data: { run: { ...run, ...over }, actions, drafts: [] } });
  const html = body(bodyProps({ tab: "runs", runId, run: read({}), viewerName: "Админ" }));
  assert.doesNotMatch(html, /not_found|invalid_arguments|dedupe_key/u, "коды и служебные ключи на экран не выходят");
  assert.match(html, /ошибка · не найдено/u);
  assert.ok(html.indexOf("ошибка · не найдено") < html.indexOf("готово"), "неудавшееся действие — выше удавшегося");
  assert.match(html, /data-testid="v3-aia-run-partial"[^>]*>1 действие не выполнено/u, "«Готово» при ошибках действий говорит об этом");
  assert.match(html, /Действия агента <span[^>]*>2 · 1 с ошибкой<\/span>/u);
  assert.match(html, /<td[^>]*>16:31<\/td>/u, "время в тот же день — без даты: «22 окт» девять раз подряд — шум");
  assert.match(html, /data-testid="v3-aia-run-meta-line"[^>]*>[^<]*· 42 с · 0,17 \$ · Вы</u, "факты — одной строкой, свой запуск подписан «Вы»");
  assert.match(html, /<a[^>]*data-testid="v3-aia-run-open-chat" href="\/v3\/ai-agents\/director\?tab=command&amp;run=33333333-3333-4333-8333-333333333333"[^>]*>[\s\S]*Открыть в чате<\/a>/u);
  assert.match(html, /data-testid="v3-aia-run-copy"/u);
  assert.doesNotMatch(html, /data-testid="v3-aia-run-stop"|data-testid="v3-aia-run-repeat"/u, "готовый запуск не останавливают и не повторяют");
  assert.match(html, /<div data-testid="v3-aia-markdown">/u, "ширину таблицы не зажимает «72ch» текста");
  assert.doesNotMatch(html, /<table class="w-full min-w-max/u, "последний столбец таблицы переносится, а не обрезается");
  assert.match(html, /<table class="w-full t-body-compact"><thead>/u);
  assert.match(html, /<ul class="mt-2 divide-y divide-border @2xl:hidden"/u, "на узком экране действия — список, а не таблица с прокруткой в двух направлениях");

  // идущий запуск — «Остановить»; неудавшееся свое короткое поручение — «Повторить»
  assert.match(body(bodyProps({ tab: "runs", runId, run: read({ status: "running", summary: null }), viewerName: "Админ" })), /data-testid="v3-aia-run-stop"[^>]*>Остановить/u);
  const failed = body(bodyProps({ tab: "runs", runId, run: read({ status: "failed", errorCode: "anthropic_error", summary: null }), viewerName: "Админ" }));
  assert.match(failed, /data-testid="v3-aia-run-repeat"[^>]*>Повторить/u);
  assert.doesNotMatch(body(bodyProps({ tab: "runs", runId, run: read({ status: "failed", errorCode: "anthropic_error", summary: null, promptPreview: "я".repeat(500) }), viewerName: "Админ" })), /v3-aia-run-repeat/u, "длинное поручение могло быть обрезано в базе: повторять его нельзя");
  // чужое поручение: ни чата, ни повтора
  const foreign = body(bodyProps({ tab: "runs", runId, run: read({ status: "failed", errorCode: "anthropic_error", startedByName: "Мария" }), viewerName: "Админ" }));
  assert.doesNotMatch(foreign, /v3-aia-run-open-chat|v3-aia-run-repeat/u);
  assert.match(foreign, /· Мария</u);

  // список: простой текст без разметки, поручение выше итога, «Вы» вместо длинной подписи
  const list = body(bodyProps({ tab: "runs", viewerName: "Админ", runs: { status: "available", data: { runs: [{ ...run, summary: "**Вывод.** В CRM за 7 дней — `curator-my`" }], hasMore: false } } }));
  assert.match(list, /Покажи студентов<\/span><span class="mt-0\.5 line-clamp-2[^"]*">Вывод\. В CRM за 7 дней — curator-my<\/span>/u);
  assert.doesNotMatch(list, /\*\*Вывод|`curator-my`|Поручение сотрудника/u);
  assert.match(list, />Вы<\/span>/u);
  assert.match(list, /class="min-w-0 self-start"/u, "ячейка текста не растягивается по высоте строки: под многоточием не торчит кусок третьей строки");
});

test("запертый чат после ошибки: под ошибкой «Повторить», под «Авто» нечего повторять", async () => {
  const { body } = await views();
  const failedRun = resumeRun({ status: "failed", errorCode: "anthropic_error", endedAt: "2026-10-22T10:21:00.000Z" });
  const html = body(bodyProps({ tab: "command", resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: failedRun } }));
  assert.match(html, /data-kind="error"[\s\S]*Claude ответил ошибкой[\s\S]*data-testid="v3-aia-retry"[^>]*>Повторить/u);
  const locked = body(bodyProps({ tab: "command", runtimeConfigured: false, resume: { runId: RESUME_RUN_ID, sendAuthority: false, run: failedRun } }));
  assert.doesNotMatch(locked, /v3-aia-retry/u, "писать нельзя — повторять нечего");
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
