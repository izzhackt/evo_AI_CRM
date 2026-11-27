// «Предложение агента, которое принимает человек» (миграция 383): «Предложить шаг» и страница передачи дела.
// Проверяется код приложения на подставных RPC и подставном Claude; живого Claude (ключ на проде сейчас отвечает 401),
// базы и людей здесь нет. SQL — supabase/tests/platform_agent_suggestions.sql, разметка — tests/v3-case-work.test.mjs.
//
// node --conditions=react-server --experimental-strip-types --test tests/agent-suggestions.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_AGENT_TOOLS,
  AI_AGENT_TOOL_NAMES,
  AI_AGENT_LIMITS,
} from "../src/lib/ai-agents/contract.ts";
import {
  agentSuggestionStatusFromRpcError,
  curatorAgentKey,
  handoffCommandText,
  nextStepCommandText,
  parseAgentCaseTarget,
  parseAgentSuggestion,
  parseAgentSuggestionDecided,
  parseHandoffNote,
} from "../src/lib/agent-suggestions-contract.ts";
import { AI_AGENT_DEFAULTS } from "../src/content/ai-agents/index.ts";
import { AI_AGENT_TOOL_GRANTS } from "../src/content/ai-agents/tool-grants.generated.ts";
import { decideAgentSuggestion, readAgentSuggestion, readCaseHandoffNote } from "../src/lib/platform-agent-suggestions.ts";
import { runAgentWork } from "../src/lib/platform-agent-work.ts";
import { agentSuggestionOutcome, agentSuggestionWords } from "../src/lib/v3/wording.ts";
import { AI_AGENTS_ERROR_COPY, agentRunStartOutcome } from "../src/lib/v3/ai-agents-view.ts";
import { ORG, REQ_ID, RUN_ID, STAFF_ID, actor, fakeClaude, fakeRpc, runtimeDeps } from "./ai-agents-fakes.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CASE = "70000000-0000-4000-8000-000000000001";
const SUGGESTION = "80000000-0000-4000-8000-000000000001";
const NOTE = "90000000-0000-4000-8000-000000000001";

const suggestionAnswer = (overrides = {}) => ({
  suggestion_id: SUGGESTION, kind: "next_step", student_case_id: CASE, text: "Запросить скан загранпаспорта", due_on: "2026-12-03",
  assignee_membership_id: STAFF_ID, assignee_name: "Тестовый Куратор", reason: "В деле нет скана паспорта", agent_key: "curator-my",
  agent_title: "Куратор Малайзия", created_at: "2026-11-28T10:00:00.123456+00:00", expires_at: "2026-12-05T10:00:00+00:00", ...overrides,
});

/* ---------------------------------------------------------------- реестр и контракт */

test("инструмент propose_next_step: запись с журналом, схема входа, имя функции, только пять кураторов", () => {
  assert.ok(AI_AGENT_TOOL_NAMES.includes("propose_next_step"));
  const tool = AI_AGENT_TOOLS.find((item) => item.name === "propose_next_step");
  assert.ok(tool);
  assert.deepEqual([tool.kind, tool.audit, tool.rpc], ["write", "write", "ai_agent_tool_propose_next_step_v1"]);
  assert.deepEqual(tool.inputSchema.required, ["case_id", "text", "reason"]);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(tool.inputSchema.properties.text.maxLength, 300);
  assert.equal(tool.inputSchema.properties.reason.maxLength, 300);
  for (const key of ["curator-cn", "curator-my", "curator-eu", "curator-ae", "curator-tr"]) {
    assert.ok(AI_AGENT_TOOL_GRANTS[key].includes("propose_next_step"), `${key} предлагает шаг`);
    assert.ok(AI_AGENT_TOOL_GRANTS[key].includes("get_lead_dossier"), `${key} читает досье лида для страницы передачи`);
    assert.ok(AI_AGENT_TOOL_GRANTS[key].includes("add_note"), `${key} сохраняет страницу заметкой`);
  }
  for (const key of ["director", "sales"]) assert.equal(AI_AGENT_TOOL_GRANTS[key].includes("propose_next_step"), false, `${key} шаги дел не предлагает`);
  // Агент не получает инструмента записи шага: шаг пишет только человек через «Принять».
  assert.equal(AI_AGENT_TOOLS.some((item) => /set_.*next|next_action/u.test(item.name)), false);
});

test("поручения кнопок: дело названо id, клиенту не пишут, этапы не двигают, помещаются в предел поручения", () => {
  const next = nextStepCommandText(CASE);
  assert.match(next, new RegExp(`case_id=${CASE}`, "u"));
  for (const part of ["get_case_dossier", "ОДИН следующий шаг", "propose_next_step", "300 символов", "клиенту не пиши", "этапы не двигай"]) {
    assert.ok(next.includes(part), part);
  }
  const handoff = handoffCommandText(CASE);
  for (const part of ["get_case_dossier", "get_lead_dossier", "add_note", "«Передача дела»", "клиенту не пиши"]) assert.ok(handoff.includes(part), part);
  for (const text of [next, handoff]) assert.ok(text.length < AI_AGENT_LIMITS.commandTextMaxChars);
});

test("правила кураторов Китая и Малайзии несут шаблон «Передача дела»: поля по порядку, деньги тремя строками, «не сказано»", () => {
  for (const key of ["curator-cn", "curator-my"]) {
    const text = AI_AGENT_DEFAULTS[key].instructions;
    const start = text.indexOf("### «Собрать передачу»");
    assert.ok(start > 0, `${key}: раздел есть`);
    const section = text.slice(start, text.indexOf("## Общение со студентом"));
    const order = ["Студент:", "Что обещали:", "Деньги", "Документы:", "Следующий шаг:", "Открытые вопросы:", "Несовершеннолетний / решает родитель:"].map((label) => section.indexOf(label));
    assert.ok(order.every((index) => index > 0), `${key}: все поля`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${key}: порядок полей`);
    for (const money of ["Условия продажи (до договора, не долг)", "По договору", "Каталог вузов"]) assert.ok(section.includes(money), `${key}: ${money}`);
    assert.match(section, /«Не сказано» вместо догадок/u);
    assert.match(section, /«да — по словам …»[\s\S]*«не сказано»/u);
    assert.match(section, /`add_note`/u);
    assert.match(text, /### «Предложить шаг»[\s\S]*`propose_next_step`/u);
    assert.match(text, /Шаг не пишется в дело сам: его принимает куратор/u);
  }
});

/* ------------------------------------------------------------------ разбор ответов */

test("предложение: форма ответа базы разбирается, чужое дело и неверная форма — null", () => {
  const ok = parseAgentSuggestion(suggestionAnswer(), CASE);
  assert.equal(ok.id, SUGGESTION);
  assert.equal(ok.text, "Запросить скан загранпаспорта");
  assert.equal(ok.dueOn, "2026-12-03");
  assert.equal(ok.assigneeName, "Тестовый Куратор");
  assert.equal(ok.agentTitle, "Куратор Малайзия");
  assert.equal(parseAgentSuggestion(suggestionAnswer({ due_on: null, assignee_membership_id: null, assignee_name: null }), CASE).dueOn, null);
  assert.equal(parseAgentSuggestion(suggestionAnswer(), "70000000-0000-4000-8000-000000000002"), null, "другое дело");
  for (const bad of [null, [], "x", suggestionAnswer({ text: "" }), suggestionAnswer({ text: "a\nb" }), suggestionAnswer({ reason: null }),
    suggestionAnswer({ suggestion_id: "nope" }), suggestionAnswer({ due_on: "03.12.2026" }), suggestionAnswer({ created_at: "вчера" })]) {
    assert.equal(parseAgentSuggestion(bad, CASE), null);
  }
});

test("решение: квитанция записи шага при «Принять», пусто при «Не то»; ошибки базы — честные итоги", () => {
  const accepted = parseAgentSuggestionDecided({ suggestion_id: SUGGESTION, status: "accepted", replayed: false, receipt: { next_action: "Шаг", next_action_due_on: "2026-12-03", admissions_version: "8" } });
  assert.deepEqual([accepted.status, accepted.receipt.admissionsVersion, accepted.receipt.nextAction, accepted.replayed], ["accepted", "8", "Шаг", false]);
  assert.deepEqual(parseAgentSuggestionDecided({ status: "dismissed", receipt: null }), { status: "dismissed", receipt: null, replayed: false });
  assert.equal(parseAgentSuggestionDecided({ status: "accepted", receipt: { admissions_version: "x" } }), null);
  assert.equal(parseAgentSuggestionDecided({ status: "pending" }), null);
  for (const [error, status] of [
    [{ code: "42501", message: "Student case is unavailable" }, "forbidden"],
    [{ code: "PT409", message: "case_next_action_version_conflict" }, "stale"],
    [{ code: "55000", message: "agent_suggestion_not_pending" }, "gone"],
    [{ code: "22023", message: "case_next_action_case_not_active" }, "not_active"],
    [{ code: "22023", message: "case_next_action_request_conflict" }, "request_conflict"],
    [{ code: "22023", message: "agent_suggestion_invalid" }, "invalid"],
    [{ code: "57014", message: "timeout" }, "unavailable"],
    [null, "unavailable"],
  ]) assert.equal(agentSuggestionStatusFromRpcError(error), status, JSON.stringify(error));
  for (const status of ["accepted", "dismissed", "forbidden", "preview", "invalid", "stale", "not_active", "gone", "request_conflict", "unavailable"]) {
    assert.ok(agentSuggestionOutcome(status)?.length > 5, status);
  }
});

test("агент по делу: сначала страна (Китай, Малайзия), иначе направление; без обоих — агента нет", () => {
  assert.equal(curatorAgentKey({ direction: null, country: "CN" }), "curator-cn");
  assert.equal(curatorAgentKey({ direction: null, country: "Китай" }), "curator-cn");
  assert.equal(curatorAgentKey({ direction: "EUROPE", country: "Malaysia" }), "curator-my");
  assert.equal(curatorAgentKey({ direction: "EUROPE", country: "CZ" }), "curator-eu");
  assert.equal(curatorAgentKey({ direction: "AE", country: null }), "curator-ae");
  assert.equal(curatorAgentKey({ direction: "TR", country: null }), "curator-tr");
  assert.equal(curatorAgentKey({ direction: null, country: null }), null);
  assert.equal(curatorAgentKey({ direction: "MARS", country: "Атлантида" }), null);
});

test("страница передачи: заметка «Передача дела» разбирается в поля; чужая заметка — null", () => {
  const body = ["[ИИ «Куратор Малайзия»] Передача дела", "Студент: Тестов, Малайзия, бакалавриат", "Что обещали: не сказано",
    "Деньги:", "— Условия продажи (до договора, не долг): план 1 000 USD", "- По договору: нет обязательств", "Открытые вопросы", ""].join("\n");
  const note = parseHandoffNote({ case_note_id: NOTE, body, created_at: "2026-11-28T10:00:00+00:00" });
  assert.equal(note.agentTitle, "Куратор Малайзия");
  assert.deepEqual(note.lines[0], { label: "Студент", text: "Тестов, Малайзия, бакалавриат", sub: false });
  assert.deepEqual(note.lines[1], { label: "Что обещали", text: "не сказано", sub: false });
  assert.deepEqual(note.lines[3], { label: "Условия продажи (до договора, не долг)", text: "план 1 000 USD", sub: true });
  assert.deepEqual(note.lines[4], { label: "По договору", text: "нет обязательств", sub: true });
  assert.deepEqual(note.lines[5], { label: null, text: "Открытые вопросы", sub: false });
  assert.equal(parseHandoffNote({ case_note_id: NOTE, body: "Обычная заметка", created_at: "2026-11-28T10:00:00+00:00" }), null);
  assert.equal(parseHandoffNote({ case_note_id: "x", body, created_at: "2026-11-28T10:00:00+00:00" }), null);
  assert.equal(parseHandoffNote(null), null);
});

/* ------------------------------------------------------------- чтения и решение */

test("чтение предложения и страницы: аргументы RPC, отказ базы — forbidden, сбой и непонятная форма — не «пусто»", async () => {
  const fake = fakeRpc({ agent_suggestion_read_v1: () => ({ data: suggestionAnswer() }), case_handoff_note_v1: () => ({ data: null }) });
  const read1 = await readAgentSuggestion(actor(), CASE, fake.client);
  assert.equal(read1.kind, "ready");
  assert.equal(read1.value.text, "Запросить скан загранпаспорта");
  assert.deepEqual(fake.called("agent_suggestion_read_v1")[0].args, { p_organization_id: ORG, p_student_case_id: CASE });
  assert.deepEqual(await readCaseHandoffNote(actor(), CASE, fake.client), { kind: "ready", value: null });

  const none = fakeRpc({ agent_suggestion_read_v1: () => ({ data: null }) });
  assert.deepEqual(await readAgentSuggestion(actor(), CASE, none.client), { kind: "ready", value: null });
  const denied = fakeRpc({ agent_suggestion_read_v1: () => ({ error: { code: "42501", message: "Student case is unavailable" } }) });
  assert.deepEqual(await readAgentSuggestion(actor(), CASE, denied.client), { kind: "forbidden" });
  const broken = fakeRpc({ agent_suggestion_read_v1: () => ({ error: { code: "XX000", message: "oops" } }) });
  assert.deepEqual(await readAgentSuggestion(actor(), CASE, broken.client), { kind: "unavailable" });
  const odd = fakeRpc({ agent_suggestion_read_v1: () => ({ data: { surprise: true } }) });
  assert.deepEqual(await readAgentSuggestion(actor(), CASE, odd.client), { kind: "unavailable" });
  assert.deepEqual(await readAgentSuggestion(actor(), "not-a-uuid", none.client), { kind: "unavailable" });
  assert.equal(none.calls.length, 1, "плохой id не доходит до базы");
});

test("«Принять» и «Не то»: версия дела сотрудника уходит в базу, шаг пишет база, повтор тем же id, устаревшее — stale", async () => {
  const receipt = { next_action: "Запросить скан загранпаспорта", next_action_due_on: "2026-12-03", admissions_version: "8" };
  const fake = fakeRpc({ agent_suggestion_decide_v1: () => ({ data: { suggestion_id: SUGGESTION, status: "accepted", receipt, replayed: false } }) });
  const accepted = await decideAgentSuggestion(actor(), { suggestionId: SUGGESTION, decision: "accept", expectedVersion: "7", dismissReason: null, requestId: REQ_ID }, fake.client);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.receipt.admissionsVersion, "8");
  assert.deepEqual(fake.called("agent_suggestion_decide_v1")[0].args, {
    p_organization_id: ORG, p_suggestion_id: SUGGESTION, p_decision: "accept", p_expected_version: "7", p_dismiss_reason: null, p_request_id: REQ_ID,
  });

  const dismiss = fakeRpc({ agent_suggestion_decide_v1: () => ({ data: { suggestion_id: SUGGESTION, status: "dismissed", receipt: null, replayed: false } }) });
  const dismissed = await decideAgentSuggestion(actor(), { suggestionId: SUGGESTION, decision: "dismiss", expectedVersion: "7", dismissReason: "Уже сделано", requestId: REQ_ID }, dismiss.client);
  assert.equal(dismissed.status, "dismissed");
  const args = dismiss.called("agent_suggestion_decide_v1")[0].args;
  assert.deepEqual([args.p_decision, args.p_expected_version, args.p_dismiss_reason], ["dismiss", null, "Уже сделано"]);

  const stale = fakeRpc({ agent_suggestion_decide_v1: () => ({ error: { code: "PT409", message: "case_next_action_version_conflict" } }) });
  await assert.rejects(
    decideAgentSuggestion(actor(), { suggestionId: SUGGESTION, decision: "accept", expectedVersion: "6", dismissReason: null, requestId: REQ_ID }, stale.client),
    (error) => error.name === "AgentSuggestionError" && error.status === "stale",
  );
  const lost = fakeRpc({ agent_suggestion_decide_v1: () => ({ data: { status: "accepted", receipt: { admissions_version: "no" } } }) });
  await assert.rejects(
    decideAgentSuggestion(actor(), { suggestionId: SUGGESTION, decision: "accept", expectedVersion: "6", dismissReason: null, requestId: REQ_ID }, lost.client),
    (error) => error.status === "unavailable",
    "ответ непонятной формы — исход неизвестен, повтор тем же id",
  );
  const guard = fakeRpc({});
  for (const bad of [
    { suggestionId: "x", decision: "accept", expectedVersion: "1", dismissReason: null, requestId: REQ_ID },
    { suggestionId: SUGGESTION, decision: "accept", expectedVersion: null, dismissReason: null, requestId: REQ_ID },
    { suggestionId: SUGGESTION, decision: "accept", expectedVersion: "-1", dismissReason: null, requestId: REQ_ID },
    { suggestionId: SUGGESTION, decision: "dismiss", expectedVersion: null, dismissReason: null, requestId: "nope" },
  ]) {
    await assert.rejects(decideAgentSuggestion(actor(), bad, guard.client), (error) => error.status === "invalid");
  }
  assert.equal(guard.calls.length, 0, "ввод проверен до базы");
});

/* -------------------------------------------------- «Агент думает…» и запуск агента */

const AUTH = {
  agentKey: "curator-my", title: "Куратор Малайзия", enabled: true, autoSend: false, model: "claude-sonnet-5-5", runBudgetUsd: 5,
  membershipId: STAFF_ID, claude: { agentId: "agent_1", agentVersion: 2, environmentId: "env_1", vaultId: "vlt_1" },
};

const TARGET = { student_case_id: CASE, state: "active", admissions_direction: "MY", target_country: "MY" };

function workSetup({ staff = {}, noKey = false } = {}) {
  const staffRpc = fakeRpc({
    agent_case_target_v1: () => ({ data: TARGET }),
    ai_agents_run_authorize_v1: () => ({ data: AUTH }),
    ...staff,
  });
  const serviceRpc = fakeRpc({
    ai_agent_runtime_run_reserve_v1: () => ({ data: { reserved: true, runId: RUN_ID } }),
    ai_agent_runtime_run_update_v1: () => ({ data: { ok: true } }),
  });
  const claude = fakeClaude({ "POST /v1/sessions": { id: "sesn_1", status: "running" } });
  const { deps } = runtimeDeps({ claude, service: serviceRpc, noKey });
  return { staffRpc, serviceRpc, claude, deps, ctx: { staffClient: staffRpc.client, actor: actor({ membershipId: STAFF_ID, systemRole: "staff" }) } };
}
const WORK = { kind: "next_step", studentCaseId: CASE, requestId: REQ_ID };

test("«Предложить шаг»: запуск агента-куратора по стране дела с поручением из контракта, права на дело проверены чтением", async () => {
  const { staffRpc, serviceRpc, claude, deps, ctx } = workSetup();
  const state = await runAgentWork(ctx, WORK, deps);
  assert.equal(state.status, "started");
  assert.equal(state.runId, RUN_ID);
  assert.notEqual(state.requestId, REQ_ID, "следующее нажатие — новый id");
  assert.equal(staffRpc.called("agent_case_target_v1").length, 1, "дело перечитано сервером до запуска");
  assert.deepEqual(staffRpc.called("ai_agents_run_authorize_v1")[0].args, { p_organization_id: ORG, p_key: "curator-my", p_send_authority: false });
  assert.equal(serviceRpc.called("ai_agent_runtime_run_reserve_v1")[0].args.p_dedupe_key, `cmd:${REQ_ID}`);
  const message = claude.callsFor("POST", "/v1/sessions")[0].body.initial_events[0].content[0].text;
  assert.equal(message, nextStepCommandText(CASE));
  // Китай: другой агент; «Собрать передачу»: другое поручение.
  const china = workSetup({ staff: { agent_case_target_v1: () => ({ data: { ...TARGET, admissions_direction: "CN", target_country: "CN" } }), ai_agents_run_authorize_v1: () => ({ data: { ...AUTH, agentKey: "curator-cn" } }) } });
  await runAgentWork(china.ctx, { ...WORK, kind: "handoff" }, china.deps);
  assert.equal(china.staffRpc.called("ai_agents_run_authorize_v1")[0].args.p_key, "curator-cn");
  assert.equal(china.claude.callsFor("POST", "/v1/sessions")[0].body.initial_events[0].content[0].text, handoffCommandText(CASE));
});

test("«Предложить шаг»: агент выключен, не синхронизирован, ключа нет, прав нет — понятное слово, а не падение, Claude не вызывается", async () => {
  const cases = [
    [{ ai_agents_run_authorize_v1: () => ({ error: { code: "55000", message: "agent_disabled" } }) }, false, "agent_disabled"],
    [{ ai_agents_run_authorize_v1: () => ({ error: { code: "55000", message: "agent_not_synced" } }) }, false, "agent_not_synced"],
    [{ ai_agents_run_authorize_v1: () => ({ error: { code: "55000", message: "run_in_progress" } }) }, false, "run_in_progress"],
    [{ ai_agents_run_authorize_v1: () => ({ error: { code: "42501", message: "ai_agent_forbidden" } }) }, false, "forbidden"],
    [{}, true, "api_key_missing"],
  ];
  for (const [staff, noKey, code] of cases) {
    const { claude, deps, ctx } = workSetup({ staff, noKey });
    const state = await runAgentWork(ctx, WORK, deps);
    assert.equal(state.status, "failed", code);
    assert.equal(state.message, agentRunStartOutcome(code), code);
    assert.equal(state.runId, null);
    assert.notEqual(state.requestId, REQ_ID, "после отказа id новый");
    assert.equal(claude.calls.length, 0, `${code}: Claude не вызывался`);
    assert.doesNotMatch(state.message, /agent_|_v1|42501|55000/u, "кодов в словах нет");
  }
  // Сбой базы при запуске: id остаётся, повтор не задвоит запуск.
  const down = workSetup({ staff: { ai_agents_run_authorize_v1: () => ({ error: { code: "XX000", message: "oops" } }) } });
  const unknown = await runAgentWork(down.ctx, WORK, down.deps);
  assert.deepEqual([unknown.status, unknown.requestId], ["failed", REQ_ID]);
});

test("«Предложить шаг»: нет права на дело, дело не прочитано, у дела нет агента — отказ до запуска", async () => {
  const denied = workSetup({ staff: { agent_case_target_v1: () => ({ error: { code: "42501", message: "Student case is unavailable" } }) } });
  const forbidden = await runAgentWork(denied.ctx, WORK, denied.deps);
  assert.equal(forbidden.message, agentRunStartOutcome("forbidden"));
  assert.equal(denied.staffRpc.called("ai_agents_run_authorize_v1").length, 0);
  const down = workSetup({ staff: { agent_case_target_v1: () => ({ error: { code: "XX000", message: "oops" } }) } });
  assert.equal((await runAgentWork(down.ctx, WORK, down.deps)).requestId, REQ_ID);
  const nobody = workSetup({ staff: { agent_case_target_v1: () => ({ data: { ...TARGET, admissions_direction: null, target_country: null } }) } });
  const none = await runAgentWork(nobody.ctx, WORK, nobody.deps);
  assert.equal(none.message, agentRunStartOutcome("no_agent"));
  assert.equal(nobody.staffRpc.called("ai_agents_run_authorize_v1").length, 0);
});

test("слова кнопок и ошибок запуска: по-русски, без кодов, ключи и номера версий людям не показываются", () => {
  for (const code of ["forbidden", "preview_read_only", "api_key_missing", "agent_disabled", "agent_not_synced", "no_agent", "run_in_progress", "duplicate",
    "invalid_input", "anthropic_error", "rate_limited", "session_unlinked", "create_unconfirmed", "unavailable"]) {
    const text = agentRunStartOutcome(code);
    assert.match(text, /[А-Яа-я]{4}/u, code);
    assert.doesNotMatch(text, /[a-z]+_[a-z_]+|\b\d{3}\b/u, `${code}: без кодов`);
  }
  assert.equal(agentRunStartOutcome("surprise"), agentRunStartOutcome("unavailable"));
  assert.equal(agentSuggestionWords.suggest, "Предложить шаг");
  assert.equal(agentSuggestionWords.thinking, "Агент думает…");
  assert.equal(agentSuggestionWords.accept, "Принять");
  assert.equal(agentSuggestionWords.dismiss, "Не то");
  assert.equal(agentSuggestionWords.handoffBuild, "Собрать передачу");
});

/* ---------------------------------------------------------------- миграция и экран */

test("383: журнал и права в самой миграции, таблица закрыта, «Принять» идёт через set_case_next_action_v1 в одной транзакции", () => {
  const sql = read("supabase/migrations/383_platform_agent_suggestions.sql");
  assert.match(sql, /ALTER TABLE platform_private\.agent_suggestions FORCE ROW LEVEL SECURITY/u);
  assert.match(sql, /REVOKE ALL ON TABLE platform_private\.agent_suggestions\s+FROM PUBLIC, anon, authenticated, service_role/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.ai_agent_tool_propose_next_step_v1\(UUID, TEXT, JSONB\) TO service_role/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION\s+platform\.agent_case_target_v1\(UUID, UUID\),\s+platform\.agent_suggestion_read_v1\(UUID, UUID\),\s+platform\.agent_suggestion_decide_v1\(UUID, UUID, TEXT, BIGINT, TEXT, UUID\),\s+platform\.case_handoff_note_v1\(UUID, UUID\) TO authenticated/u);
  assert.match(sql, /platform\.set_case_next_action_v1\(p_organization_id, s\.case_id, p_expected_version, s\.text, s\.due_on, p_request_id\)/u);
  assert.match(sql, /platform_private\.admissions_lock_case\(s\.case_id, 'case\.route\.manage'\)/u);
  assert.match(sql, /ai_agent_tool_begin\(p_organization_id, p_agent_key, 'propose_next_step', p_args\)/u);
  assert.match(sql, /'ai\.agent\.tool\.write'/u);
  assert.match(sql, /CREATE UNIQUE INDEX agent_suggestions_one_pending_idx[\s\S]*WHERE status = 'pending'/u);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION/u, "383 не заменяет существующих функций");
  assert.doesNotMatch(sql, /sk-ant-|Bearer [A-Za-z0-9]|\+996\d{6,}|@gmail\.|@mail\./u);
  assert.ok(sql.indexOf("a383_already_applied") < sql.indexOf("CREATE TABLE platform_private.agent_suggestions"));
  const suite = read("supabase/tests/platform_agent_suggestions.sql");
  assert.match(suite, /A383_AGENT_SUGGESTIONS_SUITE_PASSED/u);
  for (const address of suite.matchAll(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/gu)) assert.ok(/\.invalid$/u.test(address[0]), address[0]);
  assert.match(read("scripts/test-runners/test-postgres-authorization.sh"), /platform_agent_suggestions\.sql did not reach its PASSED marker/u);
});

test("экран: строка предложения под «Шаг не задан», «Принять» с версией дела, «Агент думает…», блок «Передача» в «Обзоре»", () => {
  const component = read("src/components/staff/profile/AgentNextStep.tsx");
  const row = read("src/components/staff/profile/AgentSuggestionRow.tsx");
  assert.match(component, /form\.set\("expected_version", decision === "accept" \? version \?\? "" : ""\)/u);
  assert.match(row, /data-testid="v3-agent-suggestion"/u);
  assert.match(component, /words\.thinking/u);
  assert.match(row, /words\.accept/u);
  assert.match(row, /words\.dismiss\b/u);
  assert.doesNotMatch(component + row, /set_case_next_action|saveCaseNextActionAction/u, "шаг пишет база в решении, а не экран мимо него");
  for (const file of [component, row]) assert.ok(file.split("\n").length <= 150, "файл UI до 150 строк");
  const step = read("src/components/staff/profile/CaseNextStep.tsx");
  assert.match(step, /<AgentNextStep[\s\S]*noStep=\{!step\}[\s\S]*editable=\{editable\}/u);
  const header = read("src/components/staff/profile/CaseHeader.tsx");
  assert.match(header, /agent=\{work\.agent && row \?/u);
  const overview = read("src/components/staff/profile/next/CaseNextOverview.tsx");
  assert.match(overview, /<TasksCard input=\{input\} \/>\s*<CaseHandoff input=\{input\} \/>/u);
  const hook = read("src/components/staff/profile/use-agent-work.ts");
  assert.match(hook, /pollAgentWorkAction/u);
  assert.match(hook, /router\.refresh\(\)/u);
  const source = read("src/lib/v3/case-work-source.ts");
  assert.match(source, /readAgentSuggestion\(actor, target\.studentCaseId\)/u);
  assert.match(source, /overview \? readCaseHandoffNote/u);
});

test("«Предложить шаг»: страну и направление сервер читает сам, форма их не несёт; дело не в работе и нет права записи шага — отказ", async () => {
  // Агент выбирается по делу из базы: в аргументах запуска нет ни страны, ни направления.
  const { staffRpc, deps, ctx } = workSetup({ staff: { agent_case_target_v1: () => ({ data: { ...TARGET, admissions_direction: "CN", target_country: "Китай" } }) } });
  await runAgentWork({ ...ctx }, { ...WORK, country: "MY", direction: "MY" }, deps);
  assert.equal(staffRpc.called("ai_agents_run_authorize_v1")[0].args.p_key, "curator-cn", "чужой country из формы выбор агента не меняет");
  const actions = read("src/lib/platform-agent-suggestions-actions.ts");
  assert.match(actions, /exactActionStringFields\(form, \["student_case_id", "kind", "request_id"\]\)/u);
  assert.doesNotMatch(actions, /get\("country"\)|get\("direction"\)/u);
  // Закрытое дело: агент не запускается.
  const closed = workSetup({ staff: { agent_case_target_v1: () => ({ data: { ...TARGET, state: "closed" } }) } });
  const refused = await runAgentWork(closed.ctx, WORK, closed.deps);
  assert.equal(refused.message, agentRunStartOutcome("not_active"));
  assert.equal(closed.staffRpc.called("ai_agents_run_authorize_v1").length, 0);
  // Нет права записи шага (42501 от базы): отказ до запуска, для обоих видов кнопок.
  for (const kind of ["next_step", "handoff"]) {
    const no = workSetup({ staff: { agent_case_target_v1: () => ({ error: { code: "42501", message: "Student case is unavailable" } }) } });
    assert.equal((await runAgentWork(no.ctx, { ...WORK, kind }, no.deps)).message, agentRunStartOutcome("forbidden"));
    assert.equal(no.claude.calls.length, 0);
  }
  assert.deepEqual(parseAgentCaseTarget({ student_case_id: CASE, state: "active", admissions_direction: null, target_country: "MY" }, CASE),
    { studentCaseId: CASE, state: "active", direction: null, country: "MY" });
  assert.equal(parseAgentCaseTarget({ student_case_id: CASE, state: "weird" }, CASE), null);
  const sql = read("supabase/migrations/383_platform_agent_suggestions.sql");
  assert.match(sql, /require_case_operator\(c\.organization_id, c\.id, 'case\.route\.manage'\)/u);
});

test("слова отказов запуска берутся из словаря раздела «ИИ-агенты», второго словаря нет", () => {
  for (const code of ["agent_disabled", "api_key_missing", "run_in_progress", "no_agent", "not_active"]) assert.equal(agentRunStartOutcome(code), AI_AGENTS_ERROR_COPY[code], code);
  assert.doesNotMatch(read("src/lib/v3/wording.ts"), /agentRunStartOutcome/u);
  const ui = read("src/components/staff/profile/AgentNextStep.tsx");
  assert.doesNotMatch(ui, /Не удалось подтвердить/u, "строк слов в компоненте нет");
  assert.match(read("src/components/staff/profile/use-agent-work.ts"), /kind: "starting"/u);
  assert.match(ui, /disabled=\{running\}/u);
  assert.match(ui, /onAccepted\(state\.receipt, id\)/u, "в квитанции шага id решения, не запуска");
  assert.match(read("src/components/staff/profile/next/CaseHandoffCard.tsx"), /handoffNoNote/u);
  const smoke = read("scripts/checks/ai-agents-mcp-smoke.mjs");
  assert.match(smoke, /EXPECTED_TOOLS = readToolNames\(\)\.length/u);
  assert.doesNotMatch(read("docs/runbooks/ai-agents-managed.md"), /\(26 инструментов\)/u);
});
