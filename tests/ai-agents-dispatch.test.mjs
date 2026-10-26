// «ИИ-агенты»: запуск агентов по событиям — заявка сайта и входящее WhatsApp
// (docs/design/ai-agents/contract.md §C.4). Подставные Claude API и RPC; живого Claude, WhatsApp
// и боевой базы нет. Хуки приёма проверены существующими тестами этих модулей.
//
// node --conditions=react-server --experimental-strip-types --test tests/ai-agents-dispatch.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { dispatchAiAgentEvent, eventDedupeKey, scheduleAiAgentEvent } from "../src/lib/server/ai-agents/dispatch.ts";
import { fakeClaude, fakeRpc, runtimeDeps, claudeError, NOW, ORG } from "./ai-agents-fakes.mjs";

const REQUEST_ID = "9f3c1d52-7a84-4e0b-9c61-2d5b8e7a4f10";
const RUN = "77777777-7777-4777-8777-777777777777";
const RUN_OLD = "88888888-8888-4888-8888-888888888888";

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

// Дневной лимит WhatsApp (миграция 321): до запуска по WhatsApp читается расход агента; здесь он нулевой, сам лимит
// проверяет tests/ai-agents-daily-cap.test.mjs.
const NO_SPEND = () => ({ data: { day: "2026-10-22", dayStart: "2026-10-21T18:00:00+00:00", spentCents: 0, open: [] } });

function setup({ targets = [TARGET], reserve, sessions, env, update, events } = {}) {
  const service = fakeRpc({
    ai_agent_runtime_dispatch_targets_v1: () => ({ data: targets }),
    ai_agent_runtime_daily_spend_v1: NO_SPEND,
    ai_agent_runtime_run_reserve_v1: reserve ?? (() => ({ data: { reserved: true, runId: RUN } })),
    ai_agent_runtime_run_update_v1: update ?? (() => ({ data: { ok: true } })),
  });
  const claude = fakeClaude({
    "POST /v1/sessions": sessions ?? (() => ({ id: "sesn_01", status: "running" })),
    ...(events ? { "POST /v1/sessions/:s/events": events } : {}),
  });
  const { deps, logs } = runtimeDeps({ claude, service, env });
  return { service, claude, deps, logs };
}

test("dispatch: заявка сайта — резерв, сессия с событием и запись running", async () => {
  const { service, claude, deps } = setup();
  const result = await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, deps);
  assert.deepEqual(result, { started: 1 });

  const targets = service.called("ai_agent_runtime_dispatch_targets_v1");
  assert.deepEqual(targets[0].args, { p_organization_id: ORG, p_trigger_kind: "website_lead" });

  const reserve = service.called("ai_agent_runtime_run_reserve_v1")[0].args;
  assert.equal(reserve.p_key, "sales");
  assert.equal(reserve.p_trigger_kind, "website_lead");
  assert.equal(reserve.p_dedupe_key, `wl:${REQUEST_ID}`);
  assert.equal(reserve.p_started_by_membership_id, null);
  assert.equal(reserve.p_send_authority_sha256, null);
  assert.equal(reserve.p_agent_version, 3);

  const session = claude.callsFor("POST", "/v1/sessions")[0];
  assert.equal(session.headers["x-api-key"], "sk-ant-test-0000000000000000000000");
  assert.equal(session.headers["anthropic-beta"], "managed-agents-2026-04-01");
  assert.equal(session.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(session.body.agent, { type: "agent", id: TARGET.claudeAgentId, version: 3 });
  assert.equal(session.body.environment_id, TARGET.environmentId);
  assert.deepEqual(session.body.vault_ids, [TARGET.vaultId]);
  assert.deepEqual(session.body.budget, { type: "limit", max_list_cost: { amount: "500", currency: "USD" } });
  const message = session.body.initial_events[0];
  assert.equal(message.type, "user.message");
  const prompt = message.content[0].text;
  assert.match(prompt, /новая заявка с сайта/u);
  assert.ok(prompt.includes(REQUEST_ID), "в событии только id заявки");
  // Никаких персональных данных и кодов отправки в событии нет.
  assert.doesNotMatch(prompt, /evo-send-authority|\+\d{6,}/u);

  const update = service.called("ai_agent_runtime_run_update_v1")[0].args;
  assert.deepEqual(update.p_patch, { sessionId: "sesn_01", status: "running" });
  assert.equal(update.p_run_id, RUN);
});

test("dispatch: WhatsApp — дедупликация окном 5 минут, одно окно — один ключ", async () => {
  const early = NOW;
  const sameWindow = NOW + 120_000;
  const nextWindow = NOW + 400_000;
  const key = (ms) => eventDedupeKey({ kind: "whatsapp_inbound", ref: null }, ms);
  assert.match(key(early), /^wa:\d+$/u);
  assert.equal(key(early), key(sameWindow));
  assert.notEqual(key(early), key(nextWindow));
  assert.equal(eventDedupeKey({ kind: "website_lead", ref: REQUEST_ID }, NOW), `wl:${REQUEST_ID}`);

  const { service, claude, deps } = setup();
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "whatsapp_inbound", ref: null }, deps), { started: 1 });
  assert.equal(service.called("ai_agent_runtime_run_reserve_v1")[0].args.p_dedupe_key, key(NOW));
  assert.match(claude.callsFor("POST", "/v1/sessions")[0].body.initial_events[0].content[0].text, /list_conversations/u);
});

test("dispatch: резерв отказал (повтор или уже идёт запуск) — сессия не создаётся", async () => {
  for (const reserve of [
    { reserved: false, reason: "duplicate", existingRunId: RUN },
    { reserved: false, reason: "run_in_progress", existingRunId: RUN },
  ]) {
    const { claude, deps, service } = setup({ reserve: () => ({ data: reserve }) });
    assert.deepEqual(await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, deps), { started: 0 });
    assert.equal(claude.calls.length, 0);
    assert.equal(service.called("ai_agent_runtime_run_update_v1").length, 0);
  }
});

test("dispatch: прошлый запуск по событию закончился, но не закрыт — закрывается по сессии, резерв повторяется и сессия стартует", async () => {
  let reserveCalls = 0;
  const service = fakeRpc({
    ai_agent_runtime_dispatch_targets_v1: () => ({ data: [TARGET] }),
    ai_agent_runtime_daily_spend_v1: NO_SPEND,
    ai_agent_runtime_run_reserve_v1: () => {
      reserveCalls += 1;
      return { data: reserveCalls === 1 ? { reserved: false, reason: "run_in_progress", existingRunId: RUN_OLD } : { reserved: true, runId: RUN } };
    },
    ai_agent_runtime_runs_open_v1: () => ({ data: [
      { runId: RUN_OLD, agentKey: "sales", sessionId: "sesn_old", status: "running", startedAt: new Date(NOW - 20 * 60_000).toISOString(), lastReconciledAt: null },
    ] }),
    ai_agent_runtime_run_update_v1: () => ({ data: { ok: true } }),
  });
  const claude = fakeClaude({
    "GET /v1/sessions/sesn_old": { id: "sesn_old", status: "idle", usage: { input_tokens: 5, output_tokens: 1 } },
    "GET /v1/sessions/:s/events": { data: [], next_page: null },
    "POST /v1/sessions": () => ({ id: "sesn_new", status: "running" }),
  });
  const { deps } = runtimeDeps({ claude, service });
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "whatsapp_inbound", ref: null }, deps), { started: 1 });

  assert.equal(reserveCalls, 2);
  const updates = service.called("ai_agent_runtime_run_update_v1").map((call) => [call.args.p_run_id, call.args.p_patch.status]);
  assert.deepEqual(updates[0], [RUN_OLD, "completed"], "старый запуск закрыт по состоянию сессии");
  assert.deepEqual(updates.at(-1), [RUN, "running"]);
  assert.equal(claude.callsFor("POST", "/v1/sessions").length, 1);
});

test("dispatch: запуск по событию действительно идёт — после сверки резерв отказывает снова, сессия не создаётся", async () => {
  let reserveCalls = 0;
  const service = fakeRpc({
    ai_agent_runtime_dispatch_targets_v1: () => ({ data: [TARGET] }),
    ai_agent_runtime_run_reserve_v1: () => { reserveCalls += 1; return { data: { reserved: false, reason: "run_in_progress", existingRunId: RUN_OLD } }; },
    ai_agent_runtime_runs_open_v1: () => ({ data: [
      { runId: RUN_OLD, agentKey: "sales", sessionId: "sesn_old", status: "running", startedAt: new Date(NOW - 60_000).toISOString(), lastReconciledAt: null },
    ] }),
    ai_agent_runtime_run_update_v1: () => ({ data: { ok: true } }),
  });
  const claude = fakeClaude({ "GET /v1/sessions/sesn_old": { id: "sesn_old", status: "running" } });
  const { deps } = runtimeDeps({ claude, service });
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, deps), { started: 0 });
  assert.equal(reserveCalls, 2, "ровно одна повторная попытка");
  assert.equal(claude.callsFor("POST", "/v1/sessions").length, 0);
  assert.ok(service.called("ai_agent_runtime_run_update_v1").every((call) => call.args.p_patch.status !== "completed"));
});

test("dispatch: нет ключа Claude, нет организации или нет целей — ничего не вызывается", async () => {
  const noKey = setup();
  const deps = { ...noKey.deps, anthropic: () => null };
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, deps), { started: 0 });
  assert.equal(noKey.service.calls.length + noKey.claude.calls.length, 0);

  const noOrg = setup({ env: { EVO_PLATFORM_ORGANIZATION_ID: "" } });
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, noOrg.deps), { started: 0 });
  assert.equal(noOrg.service.calls.length + noOrg.claude.calls.length, 0);

  const none = setup({ targets: [] });
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "whatsapp_inbound", ref: null }, none.deps), { started: 0 });
  assert.equal(none.service.called("ai_agent_runtime_run_reserve_v1").length, 0);
  assert.equal(none.claude.calls.length, 0);
});

test("dispatch: цель без id Claude пропускается, остальные запускаются", async () => {
  const { claude, deps } = setup({ targets: [{ ...TARGET, key: "curator-cn", claudeAgentId: null }, TARGET] });
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, deps), { started: 1 });
  assert.equal(claude.callsFor("POST", "/v1/sessions").length, 1);
});

test("dispatch: Claude отказал — запуск помечен failed, наружу ничего не бросается", async () => {
  const { service, deps, logs } = setup({ sessions: () => claudeError(400, "invalid_request_error", "environment_archived") });
  const result = await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, deps);
  assert.deepEqual(result, { started: 0 });
  const patch = service.called("ai_agent_runtime_run_update_v1")[0].args.p_patch;
  assert.equal(patch.status, "failed");
  assert.equal(patch.errorCode, "anthropic_error");
  assert.match(patch.errorMessage, /environment_archived/u);
  // Журнал: только счётчики, без текстов события и ключа.
  const line = logs.at(-1);
  assert.deepEqual([line.op, line.event, line.targets, line.started, line.failed], ["dispatch", "website_lead", 1, 0, 1]);
  assert.ok(!JSON.stringify(logs).includes(REQUEST_ID));
  assert.ok(!JSON.stringify(logs).includes("sk-ant"));
});

test("dispatch: исключение внутри не доходит до вызывающего", async () => {
  const { deps } = setup();
  const broken = { ...deps, serviceClient: async () => { throw new Error("boom"); } };
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, broken), { started: 0 });
  const brokenEnv = { ...deps, env: () => { throw new Error("env"); }, log: () => { throw new Error("log"); } };
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "whatsapp_inbound", ref: null }, brokenEnv), { started: 0 });
});

test("dispatch: хук приёма (scheduleAiAgentEvent) без ключа в окружении — не бросает и ничего не ждёт", async () => {
  const saved = process.env.EVO_ANTHROPIC_API_KEY;
  delete process.env.EVO_ANTHROPIC_API_KEY;
  try {
    const started = Date.now();
    assert.equal(scheduleAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }), undefined);
    assert.ok(Date.now() - started < 50, "хук возвращает управление сразу");
    // Дать фоновой задаче (запасной путь вне запроса Next) отработать без необработанных ошибок.
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    if (saved !== undefined) process.env.EVO_ANTHROPIC_API_KEY = saved;
  }
});

/* ------------------------------------------------ аудит 24.10.2026, пункт 2 */

test("dispatch: id запуска CRM уходит в metadata сессии, чтобы сверка могла сопоставить сессию с запуском", async () => {
  const { claude, deps } = setup();
  await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, deps);
  assert.deepEqual(claude.callsFor("POST", "/v1/sessions")[0].body.metadata, { evo_run_id: RUN, evo_agent_key: "sales" });
});

test("dispatch: сессию записать в запуск не удалось — она останавливается, запуск failed и в started не считается", async () => {
  const { service, claude, deps, logs } = setup({
    update: (args) => (args.p_patch.sessionId ? { error: { code: "XX000", message: "db down" } } : { data: { ok: true } }),
    events: { data: [] },
  });
  const result = await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, deps);
  assert.deepEqual(result, { started: 0 });
  const interrupt = claude.callsFor("POST", "/v1/sessions/sesn_01/events");
  assert.equal(interrupt.length, 1);
  assert.deepEqual(interrupt[0].body, { events: [{ type: "user.interrupt" }] });
  const patches = service.called("ai_agent_runtime_run_update_v1").map((call) => call.args.p_patch);
  assert.deepEqual([patches.at(-1).status, patches.at(-1).errorCode], ["failed", "session_unlinked"]);
  const summary = logs.at(-1);
  assert.deepEqual([summary.op, summary.started, summary.failed, summary.status], ["dispatch", 0, 1, "error"]);
  const link = logs.find((line) => line.op === "run_link");
  assert.deepEqual([link.run_id, link.session_id, link.interrupted], [RUN, "sesn_01", true]);
});

test("dispatch: обрыв при создании сессии — запуск failed с честным «не подтверждено», в журнале ambiguous", async () => {
  const { service, deps, logs } = setup({ sessions: () => claudeError(503, "overloaded_error", "later") });
  assert.deepEqual(await dispatchAiAgentEvent({ kind: "website_lead", ref: REQUEST_ID }, deps), { started: 0 });
  const patch = service.called("ai_agent_runtime_run_update_v1")[0].args.p_patch;
  assert.deepEqual([patch.status, patch.errorCode], ["failed", "create_unconfirmed"]);
  assert.match(patch.errorMessage, /могла быть создана без записи в CRM/u);
  const line = logs.find((entry) => entry.op === "dispatch_run");
  assert.deepEqual([line.run_id, line.ambiguous], [RUN, true]);
});
