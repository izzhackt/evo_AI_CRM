// «ИИ-агенты»: дневной лимит расхода на запуски по входящему WhatsApp ($10 в день по умолчанию, сутки по Бишкеку;
// решение владельца 26.10.2026, миграция 321). Чистая арифметика лимита, чтение расхода и запись «лимит исчерпан»,
// и настоящий `dispatchAiAgentEvent` на подставных RPC и Claude API. Живого Claude, WhatsApp и боевой базы нет;
// запросы в базу — подставные, SQL проверяет supabase/tests/platform_ai_agents_daily_spend.sql.
//
// node --conditions=react-server --experimental-strip-types --test tests/ai-agents-daily-cap.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_AGENT_CAP_OPEN_RUN_WINDOW_MINUTES,
  AI_AGENT_DAILY_SPEND_RPC,
  AI_AGENT_WHATSAPP_DAILY_BUDGET_DEFAULT_USD,
  AI_AGENT_WHATSAPP_DAILY_BUDGET_ENV,
  bishkekDay,
  dailyCapLine,
  dailyCapReachedMessage,
  dailyCapRecordKey,
  dailyCapValue,
  evaluateWhatsappDailyCap,
  formatCapUsd,
  parseDailySpendFacts,
  parseWhatsappDailyBudgetUsd,
  readWhatsappDailyBudgetCents,
  spentTodayCents,
} from "../src/lib/ai-agents/daily-cap.ts";
import { dispatchAiAgentEvent } from "../src/lib/server/ai-agents/dispatch.ts";
import { gateWhatsappDailyCap, recordWhatsappDailyCapReached } from "../src/lib/server/ai-agents/daily-cap.ts";
import { fakeClaude, fakeRpc, runtimeDeps, NOW, ORG } from "./ai-agents-fakes.mjs";

const RUN = "77777777-7777-4777-8777-777777777777";
const REQUEST_ID = "9f3c1d52-7a84-4e0b-9c61-2d5b8e7a4f10";
const TARGET = {
  key: "sales",
  title: "Продажи (Closer)",
  model: "claude-sonnet-5-5",
  claudeAgentId: "agent_01HqR2k7vXbZ9mNpL3wYcT8f",
  agentVersion: 3,
  environmentId: "env_01595EKxaaTTGwwY3kyXdtbs",
  vaultId: "vlt_01ABC",
  runBudgetUsd: 5,
  autoSend: false,
};
const RPC = AI_AGENT_DAILY_SPEND_RPC;
const COPY_10 = "Дневной лимит $10 на WhatsApp исчерпан — до завтра агент не запускается";

/* ------------------------------------------------------------ лимит из окружения */

test("лимит: по умолчанию $10; число больше нуля принимается; мусор, ноль, минус и бесконечность — снова $10, а не «без лимита»", () => {
  assert.equal(AI_AGENT_WHATSAPP_DAILY_BUDGET_DEFAULT_USD, 10);
  assert.equal(AI_AGENT_WHATSAPP_DAILY_BUDGET_ENV, "EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD");
  for (const [raw, expected] of [
    [undefined, 10], [null, 10], ["", 10], ["   ", 10],
    ["10", 10], ["7", 7], ["7.5", 7.5], ["0.5", 0.5], ["25.25", 25.25], [" 12 ", 12], ["100000", 100000],
  ]) {
    assert.equal(parseWhatsappDailyBudgetUsd(raw), expected, JSON.stringify(raw));
  }
  for (const raw of ["0", "0.0", "0.00", "-1", "-0.5", "abc", "много", "NaN", "Infinity", "-Infinity", "1e2", "1e999", "0x10", "10abc", "10,5",
    "1 000", "10.555", "10.", ".5", "+5", "1234567"]) {
    assert.equal(parseWhatsappDailyBudgetUsd(raw), 10, `${raw} -> $10, не «без лимита»`);
  }
});

test("лимит из окружения в центах: по имени переменной, всегда больше нуля", () => {
  assert.equal(readWhatsappDailyBudgetCents({}), 1000);
  assert.equal(readWhatsappDailyBudgetCents({ EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD: "7.5" }), 750);
  assert.equal(readWhatsappDailyBudgetCents({ EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD: "0.01" }), 1);
  assert.equal(readWhatsappDailyBudgetCents({ EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD: "0" }), 1000);
  assert.equal(readWhatsappDailyBudgetCents({ EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD: "-3" }), 1000);
  // Чужая переменная лимит не меняет (в том числе потолок одного запуска).
  assert.equal(readWhatsappDailyBudgetCents({ EVO_AI_AGENTS_RUN_BUDGET_USD: "3" }), 1000);
});

/* ------------------------------------------------------------ сутки по Бишкеку */

test("сутки по Бишкеку: граница в 00:00 (18:00 UTC), ключ строки «лимит исчерпан» — по этому дню", () => {
  assert.equal(bishkekDay(Date.parse("2026-10-26T17:59:59.999Z")), "2026-10-26");
  assert.equal(bishkekDay(Date.parse("2026-10-26T18:00:00.000Z")), "2026-10-27");
  assert.equal(bishkekDay(Date.parse("2026-10-25T18:00:00.000Z")), "2026-10-26");
  assert.equal(bishkekDay(Date.parse("2026-10-26T00:00:00.000Z")), "2026-10-26", "полночь UTC — уже 06:00 по Бишкеку того же дня");
  assert.equal(bishkekDay(Date.parse("2026-12-31T17:59:59.999Z")), "2026-12-31");
  assert.equal(bishkekDay(Date.parse("2026-12-31T18:00:00.000Z")), "2027-01-01", "граница года");
  assert.equal(bishkekDay(Date.parse("2028-02-28T18:00:00.000Z")), "2028-02-29", "високосный день");
  assert.equal(dailyCapRecordKey(Date.parse("2026-10-26T17:59:59.999Z")), "wacap:2026-10-26");
  assert.equal(dailyCapRecordKey(Date.parse("2026-10-26T18:00:00.000Z")), "wacap:2026-10-27");
  assert.ok(dailyCapRecordKey(NOW).length <= 200);
});

/* ------------------------------------------------------------------ слова */

test("слова: «$10», «$7,50», текст строки запуска и строка настроек — как у владельца", () => {
  assert.equal(formatCapUsd(1000), "$10");
  assert.equal(formatCapUsd(750), "$7,50");
  assert.equal(formatCapUsd(35), "$0,35");
  assert.equal(formatCapUsd(0), "$0");
  assert.equal(formatCapUsd(-5), "$0");
  assert.equal(formatCapUsd(Number.NaN), "$0");
  assert.equal(dailyCapReachedMessage(1000), COPY_10);
  assert.equal(dailyCapReachedMessage(750), "Дневной лимит $7,50 на WhatsApp исчерпан — до завтра агент не запускается");
  assert.ok(dailyCapReachedMessage(1000).length <= 500, "помещается в error_message");
  assert.equal(dailyCapLine(1000, 125), "Лимит на WhatsApp: $10 в день, сегодня потрачено $1,25");
  assert.equal(dailyCapValue(1000, 0), "$10 в день, сегодня потрачено $0");
});

test("расход за сегодня из ряда страницы агента: точка сегодняшних суток по Бишкеку, иначе 0", () => {
  const series = [
    { date: "2026-10-21", count: 1, costCents: 900 },
    { date: "2026-10-22", count: 2, costCents: 87 },
    { date: "2026-10-23", count: 0 },
  ];
  assert.equal(spentTodayCents(series, Date.parse("2026-10-22T10:30:00.000Z")), 87);
  assert.equal(spentTodayCents(series, Date.parse("2026-10-22T18:00:00.000Z")), 0, "в 00:00 по Бишкеку день сменился: 23-е без расхода");
  assert.equal(spentTodayCents(series, Date.parse("2026-10-21T17:59:59.999Z")), 900);
  assert.equal(spentTodayCents([], NOW), 0);
  assert.equal(spentTodayCents([{ date: "2026-10-22", count: 1, costCents: -5 }], NOW), 0);
});

/* ------------------------------------------------------------ арифметика лимита */

const facts = (spentCents, open = []) => ({ day: "2026-10-22", spentCents, open: open.map((costCents) => ({ costCents })) });
const decide = (spent, open, over = {}) => evaluateWhatsappDailyCap({ capCents: 1000, runBudgetUsd: 5, facts: facts(spent, open), ...over });

test("лимит: ровно $10,00 — уже остановка; $9,99 — ещё нет; ноль расхода — запуск", () => {
  assert.deepEqual(decide(1000, []), { blocked: true, reason: "daily_budget_reached", capCents: 1000, spentCents: 1000, reservedCents: 0, usedCents: 1000 });
  assert.equal(decide(999, []).blocked, false);
  assert.equal(decide(999, []).reason, null);
  assert.equal(decide(0, []).blocked, false);
  assert.equal(decide(1001, []).blocked, true);
  assert.equal(decide(250_000, []).reason, "daily_budget_reached");
});

test("резерв под запуски в работе: потолок запуска минус уже записанный расход; граница тоже включительно", () => {
  // $6 потрачено + один запуск с потолком $5 и нулём записанного: 6 + 5 = 11 >= 10 — остановка из-за резерва, не из-за расхода.
  const reserved = decide(600, [0]);
  assert.deepEqual([reserved.blocked, reserved.reason, reserved.reservedCents, reserved.usedCents], [true, "daily_budget_reserved", 500, 1100]);
  // $4 потрачено, запуск уже записал $1: резерв $4 (а не $5), итого 8 < 10 — можно.
  const partly = decide(400, [100]);
  assert.deepEqual([partly.blocked, partly.reservedCents, partly.usedCents], [false, 400, 800]);
  // Ровно на границе: 5,00 расход + 5,00 резерв = 10,00 — остановка.
  assert.equal(decide(500, [0]).blocked, true);
  assert.equal(decide(499, [0]).blocked, false);
  // Запуск, который уже потратил больше потолка (сверка отстала), резерва не добавляет и не уменьшает сумму.
  assert.equal(decide(300, [900]).reservedCents, 0);
  // Два запуска в работе (WhatsApp и заявка сайта) держат по своей доле.
  assert.equal(decide(0, [0, 0]).reservedCents, 1000);
  assert.equal(decide(0, [0, 0]).blocked, true, "два запуска с потолком по $5 уже занимают весь лимит");
  assert.equal(decide(0, [200, 0]).reservedCents, 800);
  assert.equal(decide(0, [200, 0]).blocked, false);
});

test("запуск «без потолка» (0) резервирует весь остаток лимита; отрицательный или нечисловой потолок — то же", () => {
  const noCeiling = decide(300, [100], { runBudgetUsd: 0 });
  assert.deepEqual([noCeiling.reservedCents, noCeiling.usedCents, noCeiling.blocked], [900, 1200, true]);
  assert.equal(decide(300, [], { runBudgetUsd: 0 }).blocked, false, "без запусков в работе резерва нет");
  assert.equal(decide(300, [100], { runBudgetUsd: -1 }).reservedCents, 900);
  assert.equal(decide(300, [100], { runBudgetUsd: Number.NaN }).reservedCents, 900);
});

test("лимит агента задан иначе — арифметика та же; лимит в центах не бывает нулём", () => {
  assert.equal(decide(299, [], { capCents: 300 }).blocked, false);
  assert.equal(decide(300, [], { capCents: 300 }).blocked, true);
  assert.equal(decide(0, [], { capCents: 0 }).capCents, 1, "нулевой лимит не означает «без лимита»: минимум один цент");
  assert.equal(decide(1, [], { capCents: 0 }).blocked, true);
});

test("ответ базы: форма проверяется, любая другая — null (решать нечем)", () => {
  assert.deepEqual(parseDailySpendFacts({ day: "2026-10-22", dayStart: "x", spentCents: 12, open: [{ costCents: 3, startedAt: "y" }] }),
    { day: "2026-10-22", spentCents: 12, open: [{ costCents: 3 }] });
  assert.deepEqual(parseDailySpendFacts({ day: "2026-10-22", spentCents: 0, open: [] }), { day: "2026-10-22", spentCents: 0, open: [] });
  for (const bad of [null, undefined, "x", 5, [], {}, { day: "2026-10-22", spentCents: "12", open: [] }, { day: "2026-10-22", spentCents: -1, open: [] },
    { day: "22.10", spentCents: 1, open: [] }, { day: "2026-10-22", spentCents: 1 }, { day: "2026-10-22", spentCents: 1, open: [{}] },
    { day: "2026-10-22", spentCents: 1, open: [{ costCents: -2 }] }, { day: "2026-10-22", spentCents: Number.NaN, open: [] }]) {
    assert.equal(parseDailySpendFacts(bad), null, JSON.stringify(bad));
  }
});

/* ------------------------------------------------- чтение расхода и запись в базе */

function gateDeps(handler, now = NOW) {
  const service = fakeRpc({ [RPC]: handler });
  const { deps } = runtimeDeps({ claude: fakeClaude({}), service, now });
  return { service, deps };
}

test("чтение расхода: вызов с организацией, агентом, часами приложения и окном; ответ → решение", async () => {
  const { service, deps } = gateDeps(() => ({ data: { day: "2026-10-22", dayStart: "x", spentCents: 1000, open: [] } }));
  const gate = await gateWhatsappDailyCap({ client: service.client, organizationId: ORG, agentKey: "sales", runBudgetUsd: 5, capCents: 1000, deps });
  assert.equal(gate.ok, true);
  assert.deepEqual([gate.decision.blocked, gate.decision.reason], [true, "daily_budget_reached"]);
  assert.deepEqual(service.called(RPC)[0].args, {
    p_organization_id: ORG, p_key: "sales", p_now: new Date(NOW).toISOString(), p_open_minutes: AI_AGENT_CAP_OPEN_RUN_WINDOW_MINUTES,
  });
  assert.equal(AI_AGENT_CAP_OPEN_RUN_WINDOW_MINUTES, 60);
});

test("чтение расхода: сбой базы, нет функции (миграция не применена) или кривая форма — не «пропустить», а ok:false с кодом", async () => {
  for (const [handler, code] of [
    [() => ({ error: { code: "PGRST202", message: "no function" } }), "PGRST202"],
    [() => ({ error: { code: "XX000", message: "db down" } }), "XX000"],
    [() => ({ data: { nonsense: true } }), "bad_shape"],
    [() => ({ data: null }), "bad_shape"],
  ]) {
    const { service, deps } = gateDeps(handler);
    const gate = await gateWhatsappDailyCap({ client: service.client, organizationId: ORG, agentKey: "sales", runBudgetUsd: 5, capCents: 1000, deps });
    assert.deepEqual(gate, { ok: false, code });
  }
});

test("запись «лимит исчерпан»: резерв строки под ключом суток и перевод в «Остановлен по лимиту» с кодом и словами; повтор за сутки ничего не добавляет", async () => {
  const reserves = [];
  const service = fakeRpc({
    ai_agent_runtime_run_reserve_v1: (args) => {
      reserves.push(args);
      return { data: reserves.length === 1 ? { reserved: true, runId: RUN } : { reserved: false, reason: "duplicate", existingRunId: RUN } };
    },
    ai_agent_runtime_run_update_v1: () => ({ data: { ok: true } }),
  });
  const { deps } = runtimeDeps({ claude: fakeClaude({}), service });
  const target = { key: "sales", model: "claude-sonnet-5-5", agentVersion: 3 };
  assert.equal(await recordWhatsappDailyCapReached({ client: service.client, organizationId: ORG, target, capCents: 1000, deps }), "recorded");
  assert.equal(await recordWhatsappDailyCapReached({ client: service.client, organizationId: ORG, target, capCents: 1000, deps }), "known");

  assert.deepEqual(reserves[0], {
    p_organization_id: ORG, p_key: "sales", p_trigger_kind: "whatsapp_inbound", p_dedupe_key: "wacap:2026-10-22",
    p_started_by_membership_id: null, p_send_authority_sha256: null, p_prompt_preview: "Новое сообщение в WhatsApp",
    p_model: "claude-sonnet-5-5", p_agent_version: 3,
  });
  const updates = service.called("ai_agent_runtime_run_update_v1");
  assert.equal(updates.length, 1, "второй раз строка не пишется");
  assert.equal(updates[0].args.p_run_id, RUN);
  assert.deepEqual(updates[0].args.p_patch, {
    status: "budget_reached", endedAt: new Date(NOW).toISOString(), errorCode: "daily_budget_reached", errorMessage: COPY_10,
  });
});

test("запись «лимит исчерпан»: идёт другой запуск по WhatsApp, сбой резерва или обновления — skipped; обновление повторяется один раз; исключение не наружу", async () => {
  const inProgress = fakeRpc({ ai_agent_runtime_run_reserve_v1: () => ({ data: { reserved: false, reason: "run_in_progress", existingRunId: RUN } }) });
  const target = { key: "sales", model: null, agentVersion: null };
  const base = (service) => ({ client: service.client, organizationId: ORG, target, capCents: 1000, deps: runtimeDeps({ claude: fakeClaude({}), service }).deps });
  assert.equal(await recordWhatsappDailyCapReached(base(inProgress)), "skipped");
  assert.equal(inProgress.called("ai_agent_runtime_run_update_v1").length, 0);

  const reserveDown = fakeRpc({ ai_agent_runtime_run_reserve_v1: () => ({ error: { code: "XX000", message: "down" } }) });
  assert.equal(await recordWhatsappDailyCapReached(base(reserveDown)), "skipped");

  let attempts = 0;
  const flaky = fakeRpc({
    ai_agent_runtime_run_reserve_v1: () => ({ data: { reserved: true, runId: RUN } }),
    ai_agent_runtime_run_update_v1: () => { attempts += 1; return attempts === 1 ? { error: { code: "XX000", message: "blip" } } : { data: { ok: true } }; },
  });
  assert.equal(await recordWhatsappDailyCapReached(base(flaky)), "recorded");
  assert.equal(attempts, 2, "одно повторение при сбое базы");

  const refused = fakeRpc({
    ai_agent_runtime_run_reserve_v1: () => ({ data: { reserved: true, runId: RUN } }),
    ai_agent_runtime_run_update_v1: () => ({ error: { code: "55000", message: "ai_agent_run_transition" } }),
  });
  assert.equal(await recordWhatsappDailyCapReached(base(refused)), "skipped");
  assert.equal(refused.called("ai_agent_runtime_run_update_v1").length, 1, "отказ по существу не повторяется");

  const throwing = { client: { schema() { throw new Error("boom"); } }, organizationId: ORG, target, capCents: 1000, deps: runtimeDeps({ claude: fakeClaude({}), service: inProgress }).deps };
  assert.equal(await recordWhatsappDailyCapReached(throwing), "skipped");
});

/* ------------------------------------------------------- приём события целиком */

function setup({ spend, targets = [TARGET], env, now, reserve, update } = {}) {
  const service = fakeRpc({
    ai_agent_runtime_dispatch_targets_v1: () => ({ data: targets }),
    [RPC]: spend ?? (() => ({ data: { day: "2026-10-22", dayStart: "x", spentCents: 0, open: [] } })),
    ai_agent_runtime_run_reserve_v1: reserve ?? (() => ({ data: { reserved: true, runId: RUN } })),
    ai_agent_runtime_run_update_v1: update ?? (() => ({ data: { ok: true } })),
  });
  const claude = fakeClaude({ "POST /v1/sessions": () => ({ id: "sesn_01", status: "running" }) });
  const { deps, logs } = runtimeDeps({ claude, service, env, ...(now === undefined ? {} : { now }) });
  return { service, claude, deps, logs };
}
const spent = (cents, open = []) => () => ({ data: { day: "2026-10-22", dayStart: "x", spentCents: cents, open: open.map((costCents) => ({ costCents })) } });
const WA = { kind: "whatsapp_inbound", ref: null };

test("WhatsApp: расход ниже лимита — запуск идёт как раньше; перед резервом читается расход этого агента по часам приложения", async () => {
  const { service, claude, deps } = setup({ spend: spent(999) });
  assert.deepEqual(await dispatchAiAgentEvent(WA, deps), { started: 1 });
  assert.equal(claude.callsFor("POST", "/v1/sessions").length, 1);
  const read = service.called(RPC);
  assert.equal(read.length, 1);
  assert.deepEqual(read[0].args, { p_organization_id: ORG, p_key: "sales", p_now: new Date(NOW).toISOString(), p_open_minutes: 60 });
  const order = service.calls.map((call) => call.fn);
  assert.ok(order.indexOf(RPC) < order.indexOf("ai_agent_runtime_run_reserve_v1"), "расход читается ДО резерва запуска");
  const reserve = service.called("ai_agent_runtime_run_reserve_v1");
  assert.equal(reserve.length, 1);
  assert.match(reserve[0].args.p_dedupe_key, /^wa:\d+$/u, "обычный ключ 5-минутного окна, а не ключ суток");
});

test("WhatsApp: расход ровно $10,00 — запуск не стартует, в «Запусках» одна строка «Остановлен по лимиту» с кодом и словами; журнал — счётчики", async () => {
  const { service, claude, deps, logs } = setup({ spend: spent(1000) });
  assert.deepEqual(await dispatchAiAgentEvent(WA, deps), { started: 0 });
  assert.equal(claude.calls.length, 0, "сессия Claude не создаётся");

  const reserve = service.called("ai_agent_runtime_run_reserve_v1");
  assert.equal(reserve.length, 1, "резерв один — строка лимита, не запуск");
  assert.equal(reserve[0].args.p_dedupe_key, "wacap:2026-10-22");
  assert.equal(reserve[0].args.p_trigger_kind, "whatsapp_inbound");
  const update = service.called("ai_agent_runtime_run_update_v1");
  assert.equal(update.length, 1);
  assert.equal(update[0].args.p_patch.status, "budget_reached");
  assert.equal(update[0].args.p_patch.errorCode, "daily_budget_reached");
  assert.equal(update[0].args.p_patch.errorMessage, COPY_10);

  const cap = logs.find((line) => line.op === "dispatch_cap");
  assert.deepEqual(
    [cap.status, cap.agent, cap.event, cap.reason, cap.record, cap.cap_cents, cap.spent_cents, cap.reserved_cents],
    ["ok", "sales", "whatsapp_inbound", "daily_budget_reached", "recorded", 1000, 1000, 0],
  );
  const line = logs.at(-1);
  assert.deepEqual([line.op, line.status, line.targets, line.started, line.skipped, line.failed, line.capped], ["dispatch", "ok", 1, 0, 1, 0, 1]);
  assert.equal(JSON.stringify(logs).includes("+996"), false);
});

test("WhatsApp: повторные сообщения в тот же день не плодят строк — ключ суток уже занят (duplicate)", async () => {
  let reserves = 0;
  const { service, claude, deps, logs } = setup({
    spend: spent(1500),
    reserve: () => { reserves += 1; return { data: reserves === 1 ? { reserved: true, runId: RUN } : { reserved: false, reason: "duplicate", existingRunId: RUN } }; },
  });
  await dispatchAiAgentEvent(WA, deps);
  await dispatchAiAgentEvent(WA, deps);
  await dispatchAiAgentEvent(WA, deps);
  assert.equal(claude.calls.length, 0);
  assert.equal(service.called("ai_agent_runtime_run_update_v1").length, 1, "строка переведена в итоговый статус один раз");
  assert.deepEqual(logs.filter((line) => line.op === "dispatch_cap").map((line) => line.record), ["recorded", "known", "known"], "каждая остановка видна в журнале");
});

test("WhatsApp: ночь по Бишкеку — за секунду до полуночи ключ старого дня, в 00:00 — нового; расход читается за те же часы", async () => {
  for (const [iso, key] of [["2026-10-22T17:59:59.999Z", "wacap:2026-10-22"], ["2026-10-22T18:00:00.000Z", "wacap:2026-10-23"]]) {
    const { service, deps } = setup({ spend: spent(1000), now: Date.parse(iso) });
    await dispatchAiAgentEvent(WA, deps);
    assert.equal(service.called("ai_agent_runtime_run_reserve_v1")[0].args.p_dedupe_key, key, iso);
    assert.equal(service.called(RPC)[0].args.p_now, iso);
  }
  // Новые сутки начинаются с нуля (расход новых суток база уже вернула нулём): запуск идёт.
  const fresh = setup({ spend: spent(0), now: Date.parse("2026-10-22T18:00:00.000Z") });
  assert.deepEqual(await dispatchAiAgentEvent(WA, fresh.deps), { started: 1 });
});

test("WhatsApp: расход ниже лимита, но с резервом под запуск в работе — не стартует и строки не пишет (после запуска решит настоящий расход)", async () => {
  const { service, claude, deps, logs } = setup({ spend: spent(600, [0]) });
  assert.deepEqual(await dispatchAiAgentEvent(WA, deps), { started: 0 });
  assert.equal(claude.calls.length, 0);
  assert.equal(service.called("ai_agent_runtime_run_reserve_v1").length, 0, "ни запуска, ни строки лимита");
  const cap = logs.find((line) => line.op === "dispatch_cap");
  assert.deepEqual([cap.reason, cap.record, cap.spent_cents, cap.reserved_cents], ["daily_budget_reserved", "none", 600, 500]);
  assert.equal(logs.at(-1).capped, 1);
});

test("WhatsApp: резерв не мешает, пока сумма ниже лимита ($4 + остаток потолка запуска, уже записавшего $1)", async () => {
  const { claude, deps } = setup({ spend: spent(400, [100]) });
  assert.deepEqual(await dispatchAiAgentEvent(WA, deps), { started: 1 });
  assert.equal(claude.callsFor("POST", "/v1/sessions").length, 1);
});

test("WhatsApp: потолок запуска агента берётся из настроек агента (runBudgetUsd цели), «без потолка» резервирует весь остаток", async () => {
  // Потолок $1: $6 + $1 резерва = $7 < $10 — запуск идёт.
  const cheap = setup({ spend: spent(600, [0]), targets: [{ ...TARGET, runBudgetUsd: 1 }] });
  assert.deepEqual(await dispatchAiAgentEvent(WA, cheap.deps), { started: 1 });
  // Потолок 0: запуск в работе может потратить всё — $3 + остаток $7 = $10 — остановка.
  const open = setup({ spend: spent(300, [0]), targets: [{ ...TARGET, runBudgetUsd: 0 }] });
  assert.deepEqual(await dispatchAiAgentEvent(WA, open.deps), { started: 0 });
  assert.equal(open.claude.calls.length, 0);
});

test("лимит из окружения: $3 останавливает на $3,00 и пишет $3 в строке запуска; мусор и ноль — снова $10", async () => {
  const three = setup({ spend: spent(300), env: { EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD: "3" } });
  assert.deepEqual(await dispatchAiAgentEvent(WA, three.deps), { started: 0 });
  assert.equal(three.service.called("ai_agent_runtime_run_update_v1")[0].args.p_patch.errorMessage, "Дневной лимит $3 на WhatsApp исчерпан — до завтра агент не запускается");
  const under = setup({ spend: spent(299), env: { EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD: "3" } });
  assert.deepEqual(await dispatchAiAgentEvent(WA, under.deps), { started: 1 });

  for (const garbage of ["0", "-5", "много", "Infinity", ""]) {
    const stillTen = setup({ spend: spent(999), env: { EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD: garbage } });
    assert.deepEqual(await dispatchAiAgentEvent(WA, stillTen.deps), { started: 1 }, `${garbage}: $9,99 при лимите $10 — запуск`);
    const blocked = setup({ spend: spent(1000), env: { EVO_AI_AGENT_WHATSAPP_DAILY_BUDGET_USD: garbage } });
    assert.deepEqual(await dispatchAiAgentEvent(WA, blocked.deps), { started: 0 }, `${garbage}: $10,00 при лимите $10 — остановка, не «без лимита»`);
  }
});

test("заявка сайта лимитом WhatsApp не останавливается и расход не читает, даже если у агента расход давно выше $10", async () => {
  const { service, claude, deps } = setup({ spend: spent(999_999) });
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, deps), { started: 1 });
  assert.equal(claude.callsFor("POST", "/v1/sessions").length, 1);
  assert.equal(service.called(RPC).length, 0, "расход для заявок не читается");
  const reserve = service.called("ai_agent_runtime_run_reserve_v1");
  assert.equal(reserve.length, 1);
  assert.equal(reserve[0].args.p_dedupe_key, `wl:${REQUEST_ID}`);
  assert.equal(service.called("ai_agent_runtime_run_update_v1").every((call) => call.args.p_patch.status !== "budget_reached"), true);
});

test("в одном приёме лимит у каждого агента свой: у одного исчерпан, другой запускается", async () => {
  const curator = { ...TARGET, key: "curator-cn", title: "Куратор Китая" };
  const { service, claude, deps } = setup({
    targets: [TARGET, curator],
    spend: (args) => ({ data: { day: "2026-10-22", dayStart: "x", spentCents: args.p_key === "sales" ? 1000 : 0, open: [] } }),
    reserve: (args) => ({ data: { reserved: true, runId: args.p_key === "sales" ? RUN : "88888888-8888-4888-8888-888888888888" } }),
  });
  assert.deepEqual(await dispatchAiAgentEvent(WA, deps), { started: 1 });
  assert.deepEqual(service.called(RPC).map((call) => call.args.p_key), ["sales", "curator-cn"]);
  assert.equal(claude.callsFor("POST", "/v1/sessions").length, 1);
  assert.equal(claude.callsFor("POST", "/v1/sessions")[0].body.metadata.evo_agent_key, "curator-cn");
});

test("расход прочитать не удалось (нет функции, сбой базы, кривой ответ) — WhatsApp-запуск не стартует, это сбой в журнале, наружу ничего не бросается", async () => {
  for (const [spend, code] of [
    [() => ({ error: { code: "PGRST202", message: "no function" } }), "PGRST202"],
    [() => ({ error: { code: "XX000", message: "down" } }), "XX000"],
    [() => ({ data: { nope: 1 } }), "bad_shape"],
  ]) {
    const { service, claude, deps, logs } = setup({ spend });
    assert.deepEqual(await dispatchAiAgentEvent(WA, deps), { started: 0 });
    assert.equal(claude.calls.length, 0);
    assert.equal(service.called("ai_agent_runtime_run_reserve_v1").length, 0);
    const cap = logs.find((line) => line.op === "dispatch_cap");
    assert.deepEqual([cap.status, cap.code], ["error", code]);
    assert.deepEqual([logs.at(-1).status, logs.at(-1).failed], ["error", 1]);
  }
  // Заявки сайта при том же сбое идут как раньше: лимит их не касается.
  const lead = setup({ spend: () => ({ error: { code: "PGRST202", message: "no function" } }) });
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, lead.deps), { started: 1 });
});

test("лимит исчерпан, а записать строку не удалось — запуск всё равно не стартует, остановка видна в журнале", async () => {
  const { claude, deps, logs } = setup({ spend: spent(1000), reserve: () => ({ error: { code: "XX000", message: "down" } }) });
  assert.deepEqual(await dispatchAiAgentEvent(WA, deps), { started: 0 });
  assert.equal(claude.calls.length, 0);
  const cap = logs.find((line) => line.op === "dispatch_cap");
  assert.deepEqual([cap.reason, cap.record], ["daily_budget_reached", "skipped"]);
});
