// «ИИ-агенты»: фоновая сверка с Claude (аудит 24.10.2026, пункт 8) — проход, замок, бюджет времени,
// упаковка в образ и текст unit/timer в runbook. Подставные Claude API и RPC; живого Claude, боевой базы и
// VPS здесь нет — это техническая проверка кода, не приёмка.
//
// node --conditions=react-server --experimental-strip-types --test tests/ai-agents-maintenance.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { AI_AGENT_KEYS } from "../src/lib/ai-agents/contract.ts";
import { runAiAgentsMaintenance } from "../src/lib/server/ai-agents/maintenance.ts";
import { resetAiAgentReconcileMemory } from "../src/lib/server/ai-agents/runs.ts";
import { CLAUDE_TEST_KEY, NOW, ORG, claudeError, fakeClaude, fakeRpc, runtimeDeps } from "./ai-agents-fakes.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

const RUN_OPEN = "aaaaaaaa-0000-4000-8000-000000000001";
const RUN_NEW = "aaaaaaaa-0000-4000-8000-000000000002";
const PAUSED_UPDATED_AT = "2026-10-24T08:00:00Z";
const t = (seconds) => `2026-10-22T10:00:${String(seconds).padStart(2, "0")}.000Z`;

/** Строки `ai_agent_runtime_get_v1` для всех семи агентов: у трёх есть расписание Claude. */
function agentRows(overrides = {}) {
  const base = (key) => ({
    key, title: key, model: "claude-sonnet-5-5", enabled: false, scheduleCron: null, deploymentId: null,
    claudeAgentVersion: null, syncStatus: "ok",
  });
  const rows = Object.fromEntries(AI_AGENT_KEYS.map((key) => [key, base(key)]));
  rows.director = { ...rows.director, enabled: true, scheduleCron: "0 9 * * 1", deploymentId: "depl_director", claudeAgentVersion: 3 };
  rows.sales = { ...rows.sales, enabled: true };
  rows["curator-cn"] = { ...rows["curator-cn"], enabled: false, deploymentId: "depl_cn", claudeAgentVersion: 2 };
  rows["curator-my"] = { ...rows["curator-my"], enabled: true, scheduleCron: "0 8 * * 1", deploymentId: "depl_my", claudeAgentVersion: 4 };
  for (const [key, patch] of Object.entries(overrides)) rows[key] = patch === null ? null : { ...rows[key], ...patch };
  return rows;
}

const ENDED_SESSION = { id: "sesn_open", status: "idle", usage: { input_tokens: 10, output_tokens: 2, list_cost: { amount: "17", currency: "USD" } } };

function setup({ rows = agentRows(), claudeRoutes = {}, servicePatch = {}, now = NOW, noKey = false, env } = {}) {
  const dedupe = new Set();
  const service = fakeRpc({
    ai_agent_runtime_get_v1: (args) => (rows[args.p_key] ? { data: rows[args.p_key] } : { error: { code: "P0002", message: "ai_agent_not_found" } }),
    ai_agent_runtime_scheduled_run_upsert_v1: () => ({ data: { runId: RUN_NEW, created: false } }),
    // Подставная БД ведёт себя как таблица: тот же dedupe_key второй раз — duplicate.
    ai_agent_runtime_run_reserve_v1: (args) => {
      if (dedupe.has(args.p_dedupe_key)) return { data: { reserved: false, reason: "duplicate", existingRunId: RUN_NEW } };
      dedupe.add(args.p_dedupe_key);
      return { data: { reserved: true, runId: RUN_NEW } };
    },
    ai_agent_runtime_run_update_v1: () => ({ data: { ok: true } }),
    ai_agent_runtime_runs_open_v1: () => ({ data: [
      { runId: RUN_OPEN, agentKey: "director", sessionId: "sesn_open", status: "running", startedAt: t(0), lastReconciledAt: null },
    ] }),
    ...servicePatch,
  });
  const claude = fakeClaude({
    "GET /v1/deployment_runs": (call) => {
      const id = call.query.deployment_id;
      if (id === "depl_director" && !call.query.page) {
        return { data: [
          { id: "drun_1", deployment_id: id, session_id: "sesn_sched_1", error: null, created_at: t(1) },
          { id: "drun_2", deployment_id: id, session_id: null, error: { type: "session_rate_limited_error", message: "rate limited" }, created_at: new Date(NOW - 5 * 60_000).toISOString() },
          // Давний сбой (внутри 8 суток, вне часового окна) в «Запуски» не заносится: строка получила бы начало «сейчас».
          { id: "drun_old", deployment_id: id, session_id: null, error: { type: "session_rate_limited_error", message: "old" }, created_at: new Date(NOW - 3 * 24 * 60 * 60_000).toISOString() },
        ], next_page: "page_2" };
      }
      if (id === "depl_director") return { data: [{ id: "drun_3", deployment_id: id, session_id: "sesn_sched_3", error: null, created_at: t(3) }], next_page: null };
      return { data: [], next_page: null };
    },
    "GET /v1/deployments/depl_director": { id: "depl_director", status: "paused", archived_at: null, updated_at: PAUSED_UPDATED_AT, paused_reason: { type: "error", error: { type: "environment_archived_error" } } },
    "GET /v1/deployments/depl_my": { id: "depl_my", status: "active", archived_at: null, updated_at: PAUSED_UPDATED_AT, paused_reason: null },
    "GET /v1/deployments/depl_cn": { id: "depl_cn", status: "paused", archived_at: null, updated_at: PAUSED_UPDATED_AT, paused_reason: { type: "manual" } },
    "GET /v1/sessions/sesn_open": ENDED_SESSION,
    "GET /v1/sessions/:s/events": (call) => ({
      data: call.queryAll.getAll("types[]").includes("agent.message")
        ? [{ type: "agent.message", id: "m", processed_at: t(5), content: [{ type: "text", text: "Итог." }] }]
        : [{ type: "session.status_idle", id: "i", processed_at: t(6), stop_reason: { type: "end_turn" } }],
      next_page: null,
    }),
    ...claudeRoutes,
  });
  const { deps, logs } = runtimeDeps({ claude, service, now, noKey, env });
  const directory = mkdtempSync(join(tmpdir(), "ai-agents-maintenance-"));
  const lockPath = join(directory, "maintenance.lock");
  const run = (options = {}) => runAiAgentsMaintenance(deps, { lockPath, ...options });
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  return { service, claude, deps, logs, lockPath, run, cleanup, rows };
}

const mutating = (claude) => claude.calls.filter((call) => call.method !== "GET");

/* ------------------------------------------------------------------ включение */

test("без ключа Claude API проход ничего не делает: одна строка disabled, код 0, ни одного вызова", async () => {
  const { run, service, claude, cleanup } = setup({ noKey: true });
  try {
    const report = await run();
    assert.deepEqual(report, { exitCode: 0, log: { event: "ai_agents_maintenance", status: "disabled", reason: "api_key_missing" } });
    assert.equal(service.calls.length + claude.calls.length, 0);
  } finally { cleanup(); }
});

test("ключ есть, а организация не задана — понятный отказ с кодом 1 до любого вызова Claude", async () => {
  const { run, service, claude, cleanup } = setup({ env: { EVO_PLATFORM_ORGANIZATION_ID: "" } });
  try {
    const report = await run();
    assert.deepEqual(report, { exitCode: 1, log: { event: "ai_agents_maintenance", status: "failed", reason: "organization_not_configured" } });
    assert.equal(service.calls.length + claude.calls.length, 0);
  } finally { cleanup(); }
});

test("сервисный клиент недоступен — status failed, код 1, замок снят", async () => {
  const { deps, lockPath, cleanup } = setup();
  try {
    const report = await runAiAgentsMaintenance({ ...deps, serviceClient: async () => { throw new Error("no backend"); } }, { lockPath });
    assert.deepEqual([report.exitCode, report.log.status, report.log.reason], [1, "failed", "backend_not_configured"]);
    assert.equal(existsSync(lockPath), false);
  } finally { cleanup(); }
});

/* ---------------------------------------------------------------------- проход */

test("проход: запуски расписания читаются постранично, ошибка Claude становится строкой failed, пауза записывается и НЕ снимается, открытые запуски закрываются", async () => {
  resetAiAgentReconcileMemory();
  const { run, service, claude, logs, cleanup } = setup();
  try {
    const report = await run();
    assert.equal(report.exitCode, 0, JSON.stringify(report.log));
    const log = report.log;
    assert.deepEqual(
      [log.status, log.agents, log.deployments, log.deployment_runs_seen, log.deployment_runs_linked, log.deployment_runs_failed_recorded],
      ["ok", 7, 3, 4, 2, 1],
    );
    assert.deepEqual([log.deployments_paused, log.deployments_paused_recorded], [1, 1]);
    assert.deepEqual([log.open_runs, log.open_checked, log.open_closed], ["ok", 1, 1]);

    // Постранично: первая страница без page, вторая — по next_page; по 100 и не глубже 8 суток.
    const pages = claude.callsFor("GET", "/v1/deployment_runs").filter((call) => call.query.deployment_id === "depl_director");
    assert.deepEqual(pages.map((call) => call.query.page ?? null), [null, "page_2"]);
    assert.ok(pages.every((call) => call.query.limit === "100" && call.queryAll.get("beta") === "true"));
    assert.equal(pages[0].query["created_at[gte]"], new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString());

    // Сессии расписания — строки по id сессии; запуск без сессии — одна строка failed с кодом ошибки Claude.
    assert.deepEqual(service.called("ai_agent_runtime_scheduled_run_upsert_v1").map((call) => [call.args.p_key, call.args.p_session_id]), [["director", "sesn_sched_1"], ["director", "sesn_sched_3"]]);
    const reserves = service.called("ai_agent_runtime_run_reserve_v1").map((call) => call.args);
    const failedRun = reserves.find((args) => args.p_dedupe_key === "drun:drun_2");
    assert.deepEqual([failedRun.p_key, failedRun.p_trigger_kind, failedRun.p_agent_version], ["director", "schedule", 3]);
    const updates = service.called("ai_agent_runtime_run_update_v1").map((call) => call.args.p_patch);
    const recorded = updates.find((patch) => patch.errorCode === "session_rate_limited_error" && patch.errorMessage === "rate limited");
    assert.ok(recorded);
    // Конец не раньше начала строки (начало = момент записи, не время запуска Claude): длительность не отрицательна.
    assert.equal(recorded.endedAt, new Date(NOW).toISOString());
    assert.equal(reserves.some((args) => args.p_dedupe_key === "drun:drun_old"), false, "давний сбой в «Запуски» не заносится");

    // Пауза: расписание director включено и на паузе → одна строка failed; curator-cn выключен, curator-my активен → нет строки.
    const pause = reserves.filter((args) => args.p_dedupe_key.startsWith("dpause:"));
    assert.deepEqual(pause.map((args) => args.p_dedupe_key), [`dpause:depl_director:${PAUSED_UPDATED_AT}`]);
    const pausePatch = updates.find((patch) => patch.errorCode === "deployment_paused");
    assert.equal(pausePatch.status, "failed");
    assert.match(pausePatch.errorMessage, /environment_archived_error/u);
    assert.match(pausePatch.errorMessage, /Синхронизировать с Claude/u);
    assert.equal(claude.callsFor("GET", "/v1/deployments/depl_cn").length, 0, "выключенного агента на паузу не проверяют");
    assert.equal(claude.callsFor("GET", "/v1/deployments/depl_my").length, 1);

    // Ничего не чинит: ни одной записи в Claude (ни unpause, ни update).
    assert.deepEqual(mutating(claude), []);

    // Открытые запуски: до 100 за проход, расход и итог попадают в CRM.
    assert.deepEqual(service.called("ai_agent_runtime_runs_open_v1")[0].args, { p_organization_id: ORG, p_key: null, p_limit: 100 });
    const closed = updates.find((patch) => patch.status === "completed");
    assert.deepEqual([closed.costCents, closed.summary], [17, "Итог."]);

    // Журнал: только счётчики и фиксированные слова.
    assert.ok(Object.values(log).every((value) => ["string", "number", "boolean"].includes(typeof value)));
    const everything = JSON.stringify([log, logs]);
    for (const secret of [CLAUDE_TEST_KEY, "Итог.", "rate limited"]) assert.ok(!everything.includes(secret), secret);
  } finally { cleanup(); }
});

test("проход идемпотентен: повтор тех же запусков и той же паузы не создаёт вторых строк", async () => {
  const { run, service, cleanup } = setup();
  try {
    resetAiAgentReconcileMemory();
    const first = await run();
    assert.deepEqual([first.log.deployment_runs_failed_recorded, first.log.deployments_paused_recorded], [1, 1]);
    // Новый процесс (таймер) не помнит прошлого прохода: память процесса сбрасывается, база отвечает duplicate.
    resetAiAgentReconcileMemory();
    const second = await run();
    assert.equal(second.exitCode, 0);
    assert.deepEqual([second.log.deployment_runs_failed_recorded, second.log.deployments_paused_recorded], [0, 0]);
    assert.equal(second.log.deployments_paused, 1, "пауза по-прежнему видна, но заново не записывается");
    const created = service.called("ai_agent_runtime_run_update_v1").map((call) => call.args.p_patch)
      .filter((patch) => patch.errorCode === "deployment_paused" || patch.errorCode === "session_rate_limited_error");
    assert.equal(created.length, 2, "по одной строке на пережитую паузу и на запуск без сессии");
  } finally { cleanup(); }
});

test("пауза не записывается, пока идёт синхронизация агента (она сама снимет паузу), и у агента без cron", async () => {
  resetAiAgentReconcileMemory();
  const pending = setup({ rows: agentRows({ director: { syncStatus: "pending" } }) });
  try {
    const report = await pending.run();
    assert.deepEqual([report.log.deployments_paused, report.log.deployments_paused_recorded], [0, 0]);
    assert.equal(pending.claude.callsFor("GET", "/v1/deployments/depl_director").length, 0);
  } finally { pending.cleanup(); }
  resetAiAgentReconcileMemory();
  const noCron = setup({ rows: agentRows({ director: { scheduleCron: null } }) });
  try {
    const report = await noCron.run();
    assert.equal(report.log.deployments_paused, 0);
  } finally { noCron.cleanup(); }
});

test("сбой Claude по одному расписанию — код 1 и request_id в строке, остальные расписания и открытые запуски всё равно обработаны", async () => {
  resetAiAgentReconcileMemory();
  const { run, claude, service, cleanup } = setup({ claudeRoutes: {
    "GET /v1/deployment_runs": (call) => (call.query.deployment_id === "depl_director"
      ? new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), { status: 500, headers: { "request-id": "req_011MAINT" } })
      : { data: [], next_page: null }),
  } });
  try {
    const report = await run();
    assert.equal(report.exitCode, 1);
    assert.deepEqual([report.log.status, report.log.request_id], ["error", "req_011MAINT"]);
    assert.equal(claude.callsFor("GET", "/v1/deployment_runs").filter((call) => call.query.deployment_id === "depl_my").length, 1, "следующее расписание прочитано");
    assert.equal(report.log.open_closed, 1, "открытые запуски закрыты несмотря на сбой");
    assert.ok(service.called("ai_agent_runtime_runs_open_v1").length === 1);
  } finally { cleanup(); }
});

test("Claude не отдал сессию открытого запуска (5xx) — это сбой прохода: open_failed, код 1, request_id; запуск остаётся открытым", async () => {
  resetAiAgentReconcileMemory();
  const { run, service, cleanup } = setup({ claudeRoutes: {
    "GET /v1/sessions/sesn_open": () => new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), { status: 500, headers: { "request-id": "req_011OPEN" } }),
  } });
  try {
    const report = await run();
    assert.equal(report.exitCode, 1);
    assert.deepEqual([report.log.open_checked, report.log.open_closed, report.log.open_failed, report.log.request_id], [1, 0, 1, "req_011OPEN"]);
    assert.ok(!service.called("ai_agent_runtime_run_update_v1").some((call) => call.args.p_run_id === RUN_OPEN), "запуск не закрыт вслепую");
  } finally { cleanup(); }
});

test("расписание удалено в Console (404) — не сбой прохода, а счётчик deployments_missing", async () => {
  resetAiAgentReconcileMemory();
  const { run, cleanup } = setup({ claudeRoutes: {
    "GET /v1/deployment_runs": (call) => (call.query.deployment_id === "depl_director" ? claudeError(404, "not_found_error", "gone") : { data: [], next_page: null }),
  } });
  try {
    const report = await run();
    assert.equal(report.exitCode, 0);
    assert.equal(report.log.deployments_missing, 1);
  } finally { cleanup(); }
});

test("база не прочитана (настройки агента или список открытых запусков) — код 1 и честные поля в строке", async () => {
  resetAiAgentReconcileMemory();
  const unreadable = setup({ rows: agentRows({ "curator-eu": null }) });
  try {
    const report = await unreadable.run();
    assert.deepEqual([report.exitCode, report.log.agents, report.log.agents_unreadable, report.log.status], [1, 6, 1, "error"]);
  } finally { unreadable.cleanup(); }
  resetAiAgentReconcileMemory();
  const noOpen = setup({ servicePatch: { ai_agent_runtime_runs_open_v1: () => ({ error: { code: "XX000", message: "db down" } }) } });
  try {
    const report = await noOpen.run();
    assert.deepEqual([report.exitCode, report.log.open_runs, report.log.open_checked], [1, "unreadable", 0]);
  } finally { noOpen.cleanup(); }
});

/* ---------------------------------------------------- замок и бюджет времени */

test("замок: свежий замок — проход пропускается (код 0, замок цел), брошенный старше 6 минут снимается, после прохода замка нет", async () => {
  resetAiAgentReconcileMemory();
  const { run, lockPath, service, claude, cleanup } = setup({ now: () => Date.now() + 10 * 60_000 });
  try {
    writeFileSync(lockPath, "12345");
    // «Свежий» относительно deps.now (= реальное время + 10 мин): mtime = deps.now - 1 мин.
    const fresh = new Date(Date.now() + 9 * 60_000);
    utimesSync(lockPath, fresh, fresh);
    const skipped = await run();
    assert.deepEqual(skipped, { exitCode: 0, log: { event: "ai_agents_maintenance", status: "skipped", reason: "already_running" } });
    assert.equal(existsSync(lockPath), true, "чужой замок не трогаем");
    assert.equal(service.calls.length + claude.calls.length, 0);

    const stale = new Date(Date.now() - 60_000);
    utimesSync(lockPath, stale, stale);
    const taken = await run();
    assert.equal(taken.exitCode, 0, JSON.stringify(taken.log));
    assert.equal(taken.log.status, "ok");
    assert.equal(existsSync(lockPath), false, "свой замок снят");
    assert.ok(service.calls.length > 0);
  } finally { cleanup(); }
});

test("замок держится на время прохода, и два параллельных прохода не работают одновременно", async () => {
  resetAiAgentReconcileMemory();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { run, lockPath, cleanup } = setup({ claudeRoutes: {
    "GET /v1/deployment_runs": async () => { await gate; return { data: [], next_page: null }; },
  } });
  try {
    const first = run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(existsSync(lockPath), true);
    const second = await run();
    assert.equal(second.log.status, "skipped");
    release();
    assert.equal((await first).log.status, "ok");
    assert.equal(existsSync(lockPath), false);
  } finally { cleanup(); }
});

test("бюджет времени: по исчерпании новые шаги не начинаются, строка помечена budget_exhausted, это не сбой", async () => {
  resetAiAgentReconcileMemory();
  let clock = NOW;
  const { run, service, cleanup } = setup({ now: () => (clock += 40_000) });
  try {
    const report = await run({ runBudgetMs: 150_000 });
    assert.equal(report.exitCode, 0, JSON.stringify(report.log));
    assert.equal(report.log.budget_exhausted, true);
    assert.ok(report.log.agents < 7, "агенты прочитаны не все");
    assert.ok(service.called("ai_agent_runtime_get_v1").length < 7);
    assert.ok(report.log.duration_ms >= 150_000 - 40_000);
  } finally { cleanup(); }
});

/* --------------------------------------------------------------------- упаковка */

function runbookBlock(marker) {
  const runbook = read("docs/runbooks/ai-agents-managed.md");
  const match = new RegExp("```ini\\n# " + marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") + "\\n([\\s\\S]*?)```", "u").exec(runbook);
  assert.ok(match, `${marker} в runbook`);
  return match[1];
}

test("runbook: unit — oneshot docker exec упакованного скрипта с ограниченным временем, без секретов и флагов", () => {
  const unit = runbookBlock("/etc/systemd/system/evo-ai-agents-maintenance.service");
  assert.match(unit, /^Type=oneshot$/mu);
  assert.match(unit, /^ExecStart=\/usr\/bin\/docker exec evo-crm-app-1 node \/app\/ai-agents-maintenance\.mjs$/mu);
  assert.match(unit, /^TimeoutStartSec=240$/mu);
  assert.match(unit, /^Requires=docker\.service$/mu);
  assert.match(unit, /^After=docker\.service$/mu);
  const directives = unit.split("\n").filter((line) => line !== "" && !line.startsWith("#")).join("\n");
  assert.ok(!/Environment|TOKEN|KEY|SECRET/u.test(directives), "ключ читается из окружения контейнера, не из unit");
});

test("runbook: timer — через 5 минут после конца прошлого прохода (проходы не накладываются), без календаря", () => {
  const timer = runbookBlock("/etc/systemd/system/evo-ai-agents-maintenance.timer");
  assert.match(timer, /^OnUnitInactiveSec=5min$/mu);
  assert.match(timer, /^OnBootSec=\d+min$/mu);
  assert.match(timer, /^Unit=evo-ai-agents-maintenance\.service$/mu);
  assert.match(timer, /^WantedBy=timers\.target$/mu);
  assert.ok(!/OnCalendar/u.test(timer));
});

test("runbook: решение владельца 24.10.2026 о бессрочном хранении протоколов записано в разделе про удаление сессий", () => {
  const runbook = read("docs/runbooks/ai-agents-managed.md");
  const section = runbook.slice(runbook.indexOf("## 7. Удаление сессий"), runbook.indexOf("## 8."));
  assert.match(section, /Решение владельца 24\.10\.2026: протоколы сессий у Anthropic хранятся\s+\*\*бессрочно\*\*/u);
  assert.match(section, /удаляют только вручную в Console/u);
});

test("образ несёт сборку в /app/ai-agents-maintenance.mjs, сборка входит в npm run build", () => {
  const dockerfile = read("Dockerfile");
  assert.match(
    dockerfile,
    /^COPY --from=builder --chown=nextjs:nodejs --chmod=0555 \/app\/\.next\/ai-agents-maintenance\.mjs \.\/ai-agents-maintenance\.mjs$/mu,
  );
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["build:ai-agents-maintenance"], "node scripts/build-ai-agents-maintenance.mjs");
  assert.match(pkg.scripts.build, /npm run build:ai-agents-maintenance$/u);
  const builder = read("scripts/build-ai-agents-maintenance.mjs");
  assert.match(builder, /entryPoints: \["scripts\/ai-agents-maintenance\.mjs"\]/u);
  assert.match(builder, /outfile: "\.next\/ai-agents-maintenance\.mjs"/u);
  assert.match(builder, /conditions: \["react-server"\]/u);
});

test("точка входа: единственный вывод — одна JSON-строка или фиксированное слово, жёсткий предел меньше таймаута unit", () => {
  const entry = read("scripts/ai-agents-maintenance.mjs");
  assert.equal((entry.match(/console\./gu) ?? []).length, 3);
  assert.match(entry, /console\.log\(JSON\.stringify\(report\.log\)\)/u);
  assert.match(entry, /console\.error\("ai_agents_maintenance_failed"\)/u);
  assert.match(entry, /console\.error\("ai_agents_maintenance_timeout"\)/u);
  const hard = Number(/\}, (\d[\d_]*)\);/u.exec(entry)?.[1].replaceAll("_", ""));
  assert.ok(hard > 150_000 && hard < 240_000, "жёсткий предел между бюджетом прохода (150 с) и TimeoutStartSec (240 с)");
  assert.match(entry, /hardStop\.unref\(\)/u);
  assert.ok(!/console\./u.test(read("src/lib/server/ai-agents/maintenance.ts")), "модуль сверки сам ничего не печатает");
});

test("сборка самодостаточна: без ключа печатает одну строку disabled и выходит с 0; с ключом без организации — failed и 1, без обращения в сеть", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ai-agents-maintenance-bundle-"));
  try {
    const outfile = join(directory, "ai-agents-maintenance.mjs");
    await build({
      absWorkingDir: root,
      entryPoints: ["scripts/ai-agents-maintenance.mjs"],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      conditions: ["react-server"],
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      logLevel: "silent",
    });
    assert.ok(statSync(outfile).size > 10_000);
    const disabled = spawnSync(process.execPath, [outfile], { env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", cwd: directory });
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.deepEqual(JSON.parse(disabled.stdout), { event: "ai_agents_maintenance", status: "disabled", reason: "api_key_missing" });
    assert.equal(disabled.stderr, "");
    const noOrganization = spawnSync(process.execPath, [outfile], {
      env: { PATH: process.env.PATH ?? "", EVO_ANTHROPIC_API_KEY: CLAUDE_TEST_KEY },
      encoding: "utf8",
      cwd: directory,
    });
    assert.equal(noOrganization.status, 1);
    assert.deepEqual(JSON.parse(noOrganization.stdout), { event: "ai_agents_maintenance", status: "failed", reason: "organization_not_configured" });
    assert.ok(!noOrganization.stdout.includes(CLAUDE_TEST_KEY) && !noOrganization.stderr.includes(CLAUDE_TEST_KEY));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
