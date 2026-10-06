// «ИИ-агент» P4 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §11 правила 9–11, §15
// P4; ADR 0031): маршрут отправки ночного автоответа
// `POST /api/internal/ai-agent/send`. База — подделка с записью вызовов
// (authorize → claim → runtime → finish → record), WhatsApp — поддельный
// провайдер; ни WAHA, ни Supabase, ни Gemini. Данные синтетические.
//
// Что доказывается: выключатель стоит раньше всего (нет `1` — ни одного вызова),
// подпись — схема брокера со своим секретом, тело — ровно {decisionId}, текст
// берётся у базы, повтор того же решения не отправляет второй раз, 463/475
// записываются как `provider_restricted`, а ручная отправка этим путём не
// затронута (её собственные тесты — tests/platform-provider-*.test.mjs).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_AUTOSEND_ID_NAMESPACE,
  AI_AUTOSEND_SEND_PATH,
  AI_AUTOSEND_REPLAY_WINDOW_SECONDS,
  aiAutosendOutcome,
  aiAutosendReplayStep,
  aiAutosendServerState,
  aiAutosendStepId,
  aiAutosendSwitchOn,
  aiAutosendTypingMs,
  createAiAutosendSendHandler,
  parseAiAutosendBody,
  readAiSendSecret,
  signAiSendRequest,
  uuidV5,
} from "../src/lib/server/ai-agent-send.ts";
import { PlatformWahaProviderError } from "../src/lib/server/platform-waha-provider.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = (n) => `27500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = ID(90);
const DECISION = "27500000-abcd-4def-8abc-000000000001";
const CONVERSATION = ID(2);
const SOURCE = ID(3);
const RESPONSIBLE = ID(4);
const AUTHORIZATION = ID(5);
const WORK_ITEM = ID(6);
const ATTEMPT = ID(7);
const MESSAGE = ID(8);
const SECRET = "a".repeat(24) + "-synthetic-autosend-send-secret";
const INTERNAL = "s".repeat(24) + "-synthetic-ai-agent-secret";
const STORAGE = "b".repeat(24) + "-synthetic-storage-broker-secret";
const NOW = Date.parse("2026-10-07T21:14:05Z"); // 03:14 по Бишкеку
const TEXT = "Здравствуйте! Магистратура в Малайзии длится полтора-два года. В какой стране хотите учиться?";
const SHA = createHash("sha256").update(TEXT, "utf8").digest("hex");
const RECIPIENT = "996700000001@c.us";
const ON = Object.freeze({ EVO_AI_AGENT_AUTOSEND: "1", EVO_AI_AGENT_SEND_SECRET: SECRET, EVO_AI_AGENT_INTERNAL_SECRET: INTERNAL, EVO_AI_AGENT_STORAGE_SECRET: STORAGE });

/** Ответ `ai_autosend_authorize_v1` (276): поля ручного запроса, `authorized`, `replayed`, id решения. */
function authorizedRow(overrides = {}) {
  return {
    authorized: true,
    replayed: false,
    ai_autosend_decision_id: DECISION,
    organization_id: ORG,
    manual_send_authorization_id: AUTHORIZATION,
    communication_conversation_id: CONVERSATION,
    source_message_id: SOURCE,
    ai_draft_id: null,
    final_text: TEXT,
    final_text_sha256: SHA,
    authorized_by_membership_id: RESPONSIBLE,
    state: "manual_send_authorized",
    requested_by_membership_id: RESPONSIBLE,
    work_item_id: WORK_ITEM,
    work_state: "queued",
    queue_message_id: 42,
    business_key_sha256: "b".repeat(64),
    waha_readiness: "ready",
    waha_readiness_evidence_kind: "provider_observed",
    waha_readiness_fresh: true,
    waha_readiness_observed_at: "2026-10-07T21:14:05.120+00:00",
    ...overrides,
  };
}
const replayRow = (status, workState = "leased") => authorizedRow({ replayed: true, decision_status: status, work_state: workState });

const claimedRow = () => ({
  claimed: true, organization_id: ORG, work_item_id: WORK_ITEM, requested_work_item_id: WORK_ITEM, attempt_id: ATTEMPT,
  kind: "manual_whatsapp_send", manual_send_authorization_id: AUTHORIZATION, conversation_id: CONVERSATION, source_message_id: SOURCE,
  waha_session_name: "crm_primary", raw_chat_id: RECIPIENT, raw_reply_to: "false_996700000001@c.us_3EB0SYNTHETIC", final_text: TEXT,
  final_text_sha256: SHA, attempt_number: 1, max_attempts: 1, lease_expires_at: "2026-10-07T21:16:05Z", queue_payload_is_pointer_only: true,
});

/** Поддельная база: шаги по имени RPC; `replay` — повторный claim тем же id (077: claimed=true не переигрывается). */
function fakeDatabase(overrides = {}) {
  const calls = [];
  const claimIds = new Set();
  const respond = {
    ai_autosend_authorize_v1: () => ({ data: authorizedRow(), error: null }),
    claim_manual_whatsapp_send_item: (args) => {
      if (claimIds.has(args.p_request_id)) return { data: { claimed: false, queue: "platform_work_v1", requested_work_item_id: WORK_ITEM }, error: null };
      claimIds.add(args.p_request_id);
      return { data: claimedRow(), error: null };
    },
    resolve_manual_send_waha_runtime: () => ({
      data: [{ waha_session_name: "crm_primary", waha_base_url: "http://evo-crm-waha:3000", waha_api_key: "synthetic-provider-key-value", binding_version: "3" }],
      error: null,
    }),
    finish_manual_whatsapp_send: (args) => ({
      data: {
        organization_id: ORG, work_item_id: WORK_ITEM, attempt_id: ATTEMPT, kind: "manual_whatsapp_send",
        state: args.p_outcome === "succeeded" ? "succeeded" : "failed", outcome: args.p_outcome, queue_message_id: "42",
        active_message_archived: true, automatic_retry_allowed: false,
        communication_message_id: args.p_outcome === "succeeded" ? MESSAGE : null, provider_identity_private: true,
      },
      error: null,
    }),
    ai_autosend_record_v1: () => ({ data: { recorded: true }, error: null }),
    ...overrides,
  };
  return {
    calls,
    client: {
      schema(schema) {
        assert.equal(schema, "platform");
        return {
          rpc(name, args) {
            calls.push({ name, args });
            const handler = respond[name];
            if (!handler) throw new Error(`unexpected RPC ${name}`);
            return Promise.resolve(handler(args, calls));
          },
        };
      },
    },
  };
}

/** Поддельный WhatsApp: присутствие и отправка пишутся по порядку. */
function fakeProvider({ sendError = null, presenceError = null } = {}) {
  const events = [];
  const provider = {
    async sendSeen(input) { events.push(`seen:${input.recipientId}`); if (presenceError) throw presenceError; },
    async startTyping(input) { events.push(`typing:${input.recipientId}`); if (presenceError) throw presenceError; },
    async stopTyping(input) { events.push(`stop:${input.recipientId}`); if (presenceError) throw presenceError; },
    async sendText(input) {
      events.push(`send:${input.recipientId}:${input.replyTo}:${input.text === TEXT}`);
      if (sendError) throw sendError;
      return { providerMessageId: "true_996700000001@c.us_3EB0AUTOREPLY1", providerSource: "api", providerObservedAt: "2026-10-07T21:14:30Z", ackState: "server", ackObservedAt: "2026-10-07T21:14:30Z" };
    },
    async getMessage() { throw new Error("send must not read back"); },
    async findUniqueMessage() { throw new Error("send must not search"); },
  };
  return { events, provider };
}

function harness({ env = ON, database = fakeDatabase(), provider = fakeProvider(), status = "WORKING" } = {}) {
  const sleeps = [];
  const probes = [];
  const deps = {
    env: () => env,
    organizationId: () => ORG,
    serviceClient: async () => database.client,
    probe: async (organizationId) => { probes.push(organizationId); return status; },
    createWahaProvider: () => provider.provider,
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => NOW,
  };
  return { handler: createAiAutosendSendHandler(deps), database, provider, sleeps, probes };
}

function signed(body = JSON.stringify({ decisionId: DECISION }), options = {}) {
  const timestamp = options.timestamp ?? String(Math.floor(NOW / 1000));
  const worker = options.worker ?? "evo-ai-agent-worker-1:7";
  const path = options.path ?? AI_AUTOSEND_SEND_PATH;
  const signature = options.signature ?? signAiSendRequest(options.secret ?? SECRET, timestamp, "POST", options.signedPath ?? path, options.signedWorker ?? worker, options.signedBody ?? body);
  return new Request(`http://evo-crm-app:3000${path}${options.search ?? ""}`, {
    method: options.method ?? "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      "X-EVO-AI-Timestamp": timestamp,
      "X-EVO-AI-Worker": worker,
      "X-EVO-AI-Signature": signature,
    },
    body: (options.method ?? "POST") === "GET" ? undefined : body,
  });
}

// ------------------------------------------------------------ switch

test("switch: anything but EVO_AI_AGENT_AUTOSEND exactly 1 with a valid secret answers 503 before any RPC or WhatsApp call", async () => {
  for (const env of [
    {}, { ...ON, EVO_AI_AGENT_AUTOSEND: "0" }, { ...ON, EVO_AI_AGENT_AUTOSEND: "" }, { ...ON, EVO_AI_AGENT_AUTOSEND: " 1" },
    { ...ON, EVO_AI_AGENT_AUTOSEND: "true" }, { ...ON, EVO_AI_AGENT_AUTOSEND: "yes" },
    { ...ON, EVO_AI_AGENT_SEND_SECRET: "" }, { ...ON, EVO_AI_AGENT_SEND_SECRET: "short" },
    { ...ON, EVO_AI_AGENT_SEND_SECRET: INTERNAL }, { ...ON, EVO_AI_AGENT_SEND_SECRET: STORAGE },
  ]) {
    const run = harness({ env });
    const response = await run.handler(signed());
    assert.equal(response.status, 503, JSON.stringify(env));
    assert.deepEqual(await response.json(), { error: { code: "autosend_disabled" } });
    assert.equal(run.database.calls.length, 0, "no RPC while off");
    assert.equal(run.provider.events.length, 0, "no WhatsApp while off");
    assert.equal(run.probes.length, 0, "no session probe while off");
  }
  assert.equal(aiAutosendSwitchOn({ EVO_AI_AGENT_AUTOSEND: "1" }), true);
  assert.equal(aiAutosendSwitchOn({ EVO_AI_AGENT_AUTOSEND: "01" }), false);
  assert.equal(aiAutosendServerState(ON), "on");
  assert.equal(aiAutosendServerState({ ...ON, EVO_AI_AGENT_AUTOSEND: "0" }), "off");
  assert.equal(aiAutosendServerState({ EVO_AI_AGENT_AUTOSEND: "1" }), "off", "no secret — off");
  assert.equal(readAiSendSecret({ EVO_AI_AGENT_SEND_SECRET: ` ${SECRET} ` }), SECRET);
  assert.equal(readAiSendSecret({ EVO_AI_AGENT_SEND_SECRET: "x".repeat(257) }), null);
});

// ------------------------------------------------------------ signature

test("HMAC: storage-broker scheme over ts.POST.path.worker.sha256(body) with its own secret; any mismatch is 401 with no RPC", async () => {
  const cases = [
    ["wrong secret", signed(undefined, { secret: STORAGE })],
    ["signature over another worker", signed(undefined, { signedWorker: "someone-else" })],
    ["signature over another body", signed(undefined, { signedBody: JSON.stringify({ decisionId: ID(9) }) })],
    ["signature over another path", signed(undefined, { signedPath: "/api/internal/ai-agent/storage" })],
    ["61 s in the past", signed(undefined, { timestamp: String(Math.floor(NOW / 1000) - 61) })],
    ["61 s in the future", signed(undefined, { timestamp: String(Math.floor(NOW / 1000) + 61) })],
    ["not hex", signed(undefined, { signature: "z".repeat(64) })],
    ["short signature", signed(undefined, { signature: "a".repeat(63) })],
    ["no worker", signed(undefined, { worker: "" })],
    ["worker with a space", signed(undefined, { worker: "worker one" })],
  ];
  for (const [label, request] of cases) {
    const run = harness();
    const response = await run.handler(request);
    assert.equal(response.status, 401, label);
    assert.deepEqual(await response.json(), { error: { code: "unauthorized" } }, label);
    assert.equal(run.database.calls.length, 0, label);
  }
  // На границе окна (±60 с) подпись принимается.
  const edge = harness();
  assert.equal((await edge.handler(signed(undefined, { timestamp: String(Math.floor(NOW / 1000) - 60) }))).status, 200);
});

test("HMAC vector shared with the private agent (night_send signs the same string)", () => {
  // Синтетический вектор; тот же проверяет клиент отправки в приватном evo-ai-agent:
  // смена подписываемой строки на любой стороне ломает оба теста.
  const secret = "s".repeat(24) + "-synthetic-autosend-send-vector";
  assert.equal(
    signAiSendRequest(secret, "1790000000", "POST", "/api/internal/ai-agent/send", "evo-ai-agent-worker-1:42",
      JSON.stringify({ decisionId: "11111111-1111-4111-8111-111111111111" })),
    "3f2b765954271f50f874651f6baab54bc7d5621fd16ff99768cd86b751c1b857",
  );
});

// ------------------------------------------------------------ body

test("body: exactly {decisionId} — text, any other key, arrays, uppercase ids and non-JSON are refused before the database", async () => {
  for (const [label, body, status] of [
    ["text alongside", JSON.stringify({ decisionId: DECISION, text: "Оплатите на карту" }), 400],
    ["text only", JSON.stringify({ text: "Привет" }), 400],
    ["other key", JSON.stringify({ decisionId: DECISION, organizationId: ORG }), 400],
    ["empty object", "{}", 400],
    ["array", JSON.stringify([DECISION]), 400],
    ["uppercase id", JSON.stringify({ decisionId: DECISION.toUpperCase() }), 400],
    ["not a uuid", JSON.stringify({ decisionId: "decision-1" }), 400],
    ["number", JSON.stringify({ decisionId: 1 }), 400],
    ["not json", "decisionId=1", 400],
    ["too large", JSON.stringify({ decisionId: DECISION, pad: "x".repeat(400) }), 413],
  ]) {
    const run = harness();
    const response = await run.handler(signed(body));
    assert.equal(response.status, status, label);
    assert.equal(run.database.calls.length, 0, label);
    assert.equal(run.provider.events.length, 0, label);
  }
  const wrongType = harness();
  assert.equal((await wrongType.handler(signed(undefined, { contentType: "text/plain" }))).status, 415);
  assert.equal(parseAiAutosendBody(new TextEncoder().encode(JSON.stringify({ decisionId: DECISION }))), DECISION);
  assert.equal(parseAiAutosendBody(new TextEncoder().encode(` {"decisionId" : "${DECISION}"} `)), DECISION, "whitespace is JSON");
  // Чужой путь или query — 404; другой метод — 405.
  const query = harness();
  assert.equal((await query.handler(signed(undefined, { search: "?text=1" }))).status, 404);
  const method = harness();
  assert.equal((await method.handler(signed(undefined, { method: "PUT" }))).status, 405);
  assert.equal(query.database.calls.length + method.database.calls.length, 0);
});

// ------------------------------------------------------------ authorize

test("refusal: authorize answers {authorized:false, reason} → 409, nothing is claimed or sent", async () => {
  const database = fakeDatabase({ ai_autosend_authorize_v1: () => ({
    data: { authorized: false, reason: "staff_active", reasonRu: "Сотрудник писал в чат после клиента", decisionId: DECISION, status: "skipped" },
    error: null,
  }) });
  const run = harness({ database, status: "STOPPED" });
  const response = await run.handler(signed());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: { code: "refused", reason: "staff_active" } });
  assert.deepEqual(run.database.calls.map((call) => call.name), ["ai_autosend_authorize_v1"]);
  assert.equal(run.provider.events.length, 0);
  // Живая сессия передаётся как есть: не WORKING — база ставит паузу provider_down.
  assert.deepEqual(run.database.calls[0].args, {
    p_organization_id: ORG, p_decision_id: DECISION, p_provider_status: "STOPPED",
    p_request_id: aiAutosendStepId(DECISION, "authorize"),
  });
  assert.equal(run.probes.length, 1, "one uncached probe per request");
});

test("authorize: unknown answer shapes, a tampered text hash, another organization or a missing decision never reach WhatsApp", async () => {
  const unknownProbe = harness({ status: null, database: fakeDatabase({ ai_autosend_authorize_v1: () => ({ data: null, error: { code: "P0002" } }) }) });
  const missing = await unknownProbe.handler(signed());
  assert.equal(missing.status, 404);
  assert.equal(unknownProbe.database.calls[0].args.p_provider_status, "UNKNOWN", "a probe that cannot say is UNKNOWN, never WORKING");
  for (const [label, row, status] of [
    ["sha of another text", authorizedRow({ final_text_sha256: "c".repeat(64) }), 503],
    ["another organization", authorizedRow({ organization_id: ID(91) }), 503],
    ["another decision", authorizedRow({ ai_autosend_decision_id: ID(92) }), 503],
    ["no decision id", (() => { const row = authorizedRow(); delete row.ai_autosend_decision_id; return row; })(), 503],
    ["fresh but not queued", authorizedRow({ work_state: "succeeded" }), 503],
    ["stale readiness", authorizedRow({ waha_readiness_fresh: false }), 503],
    ["an ai draft", authorizedRow({ ai_draft_id: ID(93) }), 503],
    ["author is not the requester", authorizedRow({ requested_by_membership_id: ID(94) }), 503],
    ["unknown key", authorizedRow({ final_text_override: "x" }), 503],
    ["over 1000 characters", authorizedRow({ final_text: "а".repeat(1001), final_text_sha256: createHash("sha256").update("а".repeat(1001)).digest("hex") }), 503],
    ["refusal with extra data", { authorized: false, reason: "paused", final_text: TEXT }, 503],
    ["refusal for another decision", { authorized: false, reason: "paused", decisionId: ID(95) }, 503],
    ["refusal with a bad reason", { authorized: false, reason: "Пауза" }, 503],
  ]) {
    const run = harness({ database: fakeDatabase({ ai_autosend_authorize_v1: () => ({ data: row, error: null }) }) });
    const response = await run.handler(signed());
    assert.equal(response.status, status, label);
    assert.deepEqual(run.database.calls.map((call) => call.name), ["ai_autosend_authorize_v1"], label);
    assert.equal(run.provider.events.length, 0, label);
  }
  const invalid = harness({ database: fakeDatabase({ ai_autosend_authorize_v1: () => ({ data: null, error: { code: "22023" } }) }) });
  assert.equal((await invalid.handler(signed())).status, 400);
  const forbidden = harness({ database: fakeDatabase({ ai_autosend_authorize_v1: () => ({ data: null, error: { code: "42501" } }) }) });
  assert.equal((await forbidden.handler(signed())).status, 503);
});

// ------------------------------------------------------------ send

test("send: seen → typing → wait → stop → the stored text, plain (no quote), through the manual-send claim and finish; then record sent", async () => {
  const run = harness();
  const response = await run.handler(signed());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { outcome: "sent", code: null });
  assert.deepEqual(run.database.calls.map((call) => call.name), [
    "ai_autosend_authorize_v1", "claim_manual_whatsapp_send_item", "resolve_manual_send_waha_runtime",
    "finish_manual_whatsapp_send", "ai_autosend_record_v1",
  ]);
  assert.deepEqual(run.provider.events, [
    `seen:${RECIPIENT}`, `typing:${RECIPIENT}`, `stop:${RECIPIENT}`, `send:${RECIPIENT}:null:true`,
  ]);
  assert.deepEqual(run.sleeps, [aiAutosendTypingMs(TEXT)], "typing lasts by the text length");
  const [, claim, , finish, record] = run.database.calls;
  assert.deepEqual(claim.args, {
    p_organization_id: ORG, p_work_item_id: WORK_ITEM, p_visibility_timeout_seconds: 120,
    p_worker_ref: "ai-autosend", p_request_id: aiAutosendStepId(DECISION, "claim"),
  });
  assert.equal(finish.args.p_request_id, aiAutosendStepId(DECISION, "complete"));
  assert.equal(finish.args.p_outcome, "succeeded");
  assert.deepEqual(record.args, {
    p_organization_id: ORG, p_decision_id: DECISION, p_outcome: "sent", p_code: null,
    p_request_id: aiAutosendStepId(DECISION, "record:sent:-"),
  });
});

test("retry while the first request still holds the work: 409 in_progress — no claim, no record, one WhatsApp message", async () => {
  const database = fakeDatabase();
  const provider = fakeProvider();
  const first = harness({ database, provider });
  assert.equal((await first.handler(signed())).status, 200);
  // Повтор: база отдаёт прежнюю авторизацию до своих проверок (решение ещё `authorized`, работа взята).
  for (const workState of ["leased", "retry_wait"]) {
    const retry = harness({ database: fakeDatabase({ ai_autosend_authorize_v1: () => ({ data: replayRow("authorized", workState), error: null }) }), provider });
    const response = await retry.handler(signed());
    assert.equal(response.status, 409, workState);
    assert.deepEqual(await response.json(), { error: { code: "in_progress", workState } });
    // Итог запишет исходный запрос: запись `unknown` здесь закрыла бы решение раньше
    // (и 463/475 исходного запроса потеряли бы паузу — PT409).
    assert.deepEqual(retry.database.calls.map((call) => call.name), ["ai_autosend_authorize_v1"], workState);
  }
  assert.equal(provider.events.filter((event) => event.startsWith("send:")).length, 1, "exactly one WhatsApp message");
});

test("retry after the work was taken: 276 answers already_claimed → 409 in_progress — no claim, no record, no WhatsApp", async () => {
  // 276: решение `authorized`, работа уже не в очереди (взята, завершена, в ручной проверке) — отказ
  // `already_claimed` без записи в журнал; итог пишет взявший запрос, зависшие закрывает база (277).
  const run = harness({ database: fakeDatabase({ ai_autosend_authorize_v1: () => ({
    data: { authorized: false, reason: "already_claimed", decisionId: DECISION, status: "authorized" }, error: null,
  }) }) });
  const response = await run.handler(signed());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: { code: "in_progress", reason: "already_claimed" } });
  assert.deepEqual(run.database.calls.map((call) => call.name), ["ai_autosend_authorize_v1"]);
  assert.equal(run.provider.events.length, 0);
  // Защита на случай, если база всё же отдаст повтор с завершённой работой: CRM итог по ней не пишет.
  for (const workState of ["succeeded", "dead_lettered", "unknown_manual_review", "conflict_manual_review"]) {
    const replay = harness({ database: fakeDatabase({ ai_autosend_authorize_v1: () => ({ data: replayRow("authorized", workState), error: null }) }) });
    const answer = await replay.handler(signed());
    assert.equal(answer.status, 409, workState);
    assert.deepEqual(await answer.json(), { error: { code: "in_progress", workState } }, workState);
    assert.deepEqual(replay.database.calls.map((call) => call.name), ["ai_autosend_authorize_v1"], workState);
    assert.equal(replay.provider.events.length, 0, workState);
  }
});

test("retry of a decision that already has an outcome: 409 already_finished, no claim, no record, no WhatsApp", async () => {
  for (const status of ["sent", "failed", "unknown"]) {
    const run = harness({ database: fakeDatabase({ ai_autosend_authorize_v1: () => ({ data: replayRow(status, "succeeded"), error: null }) }) });
    const response = await run.handler(signed());
    assert.equal(response.status, 409, status);
    assert.deepEqual(await response.json(), { error: { code: "already_finished", status } });
    assert.deepEqual(run.database.calls.map((call) => call.name), ["ai_autosend_authorize_v1"], status);
    assert.equal(run.provider.events.length, 0, status);
  }
});

test("replayed authorization never claimed: sent only within a minute of authorization and with a WORKING session", async () => {
  const replayAt = (authorizedAt, overrides = {}) => fakeDatabase({
    ai_autosend_authorize_v1: () => ({ data: authorizedRow({
      replayed: true, decision_status: "authorized", work_state: "queued", waha_readiness_observed_at: authorizedAt, ...overrides,
    }), error: null }),
  });
  // CRM упала между авторизацией и claim; агент повторил через 10 с — отправка идёт как в первый раз.
  const resumed = harness({ database: replayAt(new Date(NOW - 10_000).toISOString()) });
  assert.deepEqual(await (await resumed.handler(signed())).json(), { outcome: "sent", code: null });
  assert.equal(resumed.provider.events.filter((event) => event.startsWith("send:")).length, 1);
  assert.equal(resumed.database.calls.find((call) => call.name === "claim_manual_whatsapp_send_item").args.p_request_id, aiAutosendStepId(DECISION, "claim"));

  // Старая авторизация (6 часов; пауза или выключение после неё базе на повторе не видны) —
  // закрыть итогом без отправки, даже при живой сессии.
  for (const [label, at] of [
    ["six hours old", "2026-10-07T15:14:05.000+00:00"],
    ["just over a minute", new Date(NOW - (AI_AUTOSEND_REPLAY_WINDOW_SECONDS + 1) * 1000).toISOString()],
    ["from the future", new Date(NOW + 10 * 60_000).toISOString()],
  ]) {
    const run = harness({ database: replayAt(at) });
    const response = await run.handler(signed());
    assert.equal(response.status, 409, label);
    assert.deepEqual(await response.json(), { error: { code: "refused", reason: "authorization_expired" } }, label);
    assert.deepEqual(run.database.calls.map((call) => call.name), ["ai_autosend_authorize_v1", "ai_autosend_record_v1"], label);
    assert.deepEqual(run.database.calls[1].args, {
      p_organization_id: ORG, p_decision_id: DECISION, p_outcome: "failed", p_code: "authorization_expired",
      p_request_id: aiAutosendStepId(DECISION, "record:failed:authorization_expired"),
    }, label);
    assert.equal(run.provider.events.length, 0, label);
  }

  // Свежая, но сессия сейчас не WORKING (первый запрос база проверила бы сама, повтор — нет).
  for (const status of ["STOPPED", "SCAN_QR_CODE", null]) {
    const run = harness({ database: replayAt(new Date(NOW - 5_000).toISOString()), status });
    const response = await run.handler(signed());
    assert.equal(response.status, 409, String(status));
    assert.deepEqual(await response.json(), { error: { code: "refused", reason: "provider_down" } });
    assert.deepEqual(run.database.calls.map((call) => [call.name, call.args.p_code]),
      [["ai_autosend_authorize_v1", undefined], ["ai_autosend_record_v1", "provider_down"]], String(status));
    assert.equal(run.provider.events.length, 0, String(status));
  }

  // Запись итога не удалась — 503, агент повторит (и повтор снова закроет решение, ничего не отправив).
  const down = harness({ database: fakeDatabase({
    ai_autosend_authorize_v1: () => ({ data: authorizedRow({ replayed: true, decision_status: "authorized", work_state: "queued",
      waha_readiness_observed_at: "2026-10-07T15:14:05.000+00:00" }), error: null }),
    ai_autosend_record_v1: () => ({ data: null, error: { code: "XX000" } }),
  }) });
  const unrecorded = await down.handler(signed());
  assert.equal(unrecorded.status, 503);
  assert.deepEqual(await unrecorded.json(), { error: { code: "record_unavailable", outcome: "failed" } });
  assert.equal(down.provider.events.length, 0);

  // Повтор без времени авторизации или в чужом состоянии — сбой формы, в WhatsApp ничего.
  for (const [label, overrides] of [
    ["no authorized_at", { waha_readiness_observed_at: null }],
    ["unparsable authorized_at", { waha_readiness_observed_at: "вчера" }],
    ["decision skipped", { decision_status: "skipped" }],
    ["decision missing status", { decision_status: null }],
  ]) {
    const run = harness({ database: replayAt(new Date(NOW - 5_000).toISOString(), overrides) });
    const response = await run.handler(signed());
    assert.equal(response.status, 503, label);
    assert.deepEqual(run.database.calls.map((call) => call.name), ["ai_autosend_authorize_v1"], label);
    assert.equal(run.provider.events.length, 0, label);
  }
});

test("claim refused (another send of the chat ahead, or the same decision taken by a parallel request): 503 not_claimed, nothing recorded", async () => {
  const run = harness({ database: fakeDatabase({
    claim_manual_whatsapp_send_item: () => ({ data: { claimed: false, queue: "platform_work_v1", requested_work_item_id: WORK_ITEM }, error: null }),
  }) });
  const response = await run.handler(signed());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "not_claimed" } });
  assert.deepEqual(run.database.calls.map((call) => call.name), ["ai_autosend_authorize_v1", "claim_manual_whatsapp_send_item"]);
  assert.equal(run.provider.events.length, 0);
});

test("463 and 475 from WhatsApp are recorded as provider_restricted (the database pauses); other rejections keep their code", async () => {
  for (const [status, code, outcome] of [[463, "provider_restricted", "failed"], [475, "provider_restricted", "failed"], [400, "provider_rejected", "failed"]]) {
    const run = harness({ provider: fakeProvider({ sendError: new PlatformWahaProviderError("provider_rejected", "failed", status) }) });
    const response = await run.handler(signed());
    assert.equal(response.status, 200, String(status));
    assert.deepEqual(await response.json(), { outcome, code }, String(status));
    const finish = run.database.calls.find((call) => call.name === "finish_manual_whatsapp_send");
    assert.equal(finish.args.p_outcome, "terminal_error", "the manual-send finish is unchanged: 4xx is a terminal error");
    assert.equal(finish.args.p_error_code, "provider_rejected");
    const record = run.database.calls.find((call) => call.name === "ai_autosend_record_v1");
    assert.deepEqual([record.args.p_outcome, record.args.p_code], [outcome, code], String(status));
  }
  const timeout = harness({ provider: fakeProvider({ sendError: new PlatformWahaProviderError("provider_timeout", "unknown") }) });
  assert.deepEqual(await (await timeout.handler(signed())).json(), { outcome: "unknown", code: "provider_timeout" });
});

test("seen and typing failures never stop the send; claim or finish trouble is 503 without a record", async () => {
  const run = harness({ provider: fakeProvider({ presenceError: new PlatformWahaProviderError("provider_unavailable", "unknown", 502) }) });
  const response = await run.handler(signed());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { outcome: "sent", code: null });
  const claimDown = harness({ database: fakeDatabase({ claim_manual_whatsapp_send_item: () => ({ data: null, error: { code: "XX000" } }) }) });
  const unavailable = await claimDown.handler(signed());
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: { code: "unavailable" } });
  assert.equal(claimDown.provider.events.length, 0);
  assert.equal(claimDown.database.calls.some((call) => call.name === "ai_autosend_record_v1"), false);
});

test("record: retried twice, an already-recorded outcome counts as recorded, a lasting failure is 503 for the agent to retry", async () => {
  let attempts = 0;
  const flaky = harness({ database: fakeDatabase({ ai_autosend_record_v1: () => (++attempts < 3 ? { data: null, error: { code: "XX000" } } : { data: {}, error: null }) }) });
  assert.equal((await flaky.handler(signed())).status, 200);
  assert.equal(attempts, 3);
  assert.equal(flaky.sleeps.length, 1 + 2, "typing + two record back-offs");
  const recorded = harness({ database: fakeDatabase({ ai_autosend_record_v1: () => ({ data: null, error: { code: "PT409" } }) }) });
  assert.equal((await recorded.handler(signed())).status, 200);
  const down = harness({ database: fakeDatabase({ ai_autosend_record_v1: () => ({ data: null, error: { code: "XX000" } }) }) });
  const response = await down.handler(signed());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "record_unavailable", outcome: "sent" } });
});

// ------------------------------------------------------------ pure parts

test("ids, typing and outcome mapping", () => {
  // RFC 9562 / 4122 вектор UUIDv5 (DNS, www.example.com).
  assert.equal(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com"), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
  assert.equal(aiAutosendStepId("11111111-1111-4111-8111-111111111111", "claim"), "5abb9c6f-a20c-5d5a-92ef-0a491932ec71");
  assert.notEqual(aiAutosendStepId(DECISION, "claim"), aiAutosendStepId(DECISION, "complete"));
  assert.notEqual(aiAutosendStepId(DECISION, "claim"), aiAutosendStepId(ID(2), "claim"));
  assert.match(AI_AUTOSEND_ID_NAMESPACE, /^[0-9a-f-]{36}$/u);
  assert.equal(aiAutosendTypingMs("Да"), 1500);
  assert.equal(aiAutosendTypingMs("а".repeat(100)), 4000);
  assert.equal(aiAutosendTypingMs("а".repeat(1000)), 6000);
  const replay = (workState, authorizedAt = new Date(NOW).toISOString()) => ({ workState, authorizedAt });
  assert.deepEqual(aiAutosendReplayStep(replay("queued"), { now: NOW, providerStatus: "WORKING" }), { step: "send" });
  assert.deepEqual(aiAutosendReplayStep(replay("queued", new Date(NOW - 60_000).toISOString()), { now: NOW, providerStatus: "WORKING" }), { step: "send" },
    "exactly the window still sends");
  assert.equal(aiAutosendReplayStep(replay("queued", new Date(NOW - 60_001).toISOString()), { now: NOW, providerStatus: "WORKING" }).step, "close");
  assert.equal(aiAutosendReplayStep(replay("queued", "not a date"), { now: NOW, providerStatus: "WORKING" }).step, "close");
  assert.deepEqual(aiAutosendReplayStep(replay("queued"), { now: NOW, providerStatus: "UNKNOWN" }),
    { step: "close", outcome: { outcome: "failed", code: "provider_down" }, refusal: "provider_down" });
  assert.deepEqual(aiAutosendReplayStep(replay("leased"), { now: NOW, providerStatus: "WORKING" }), { step: "in_progress", workState: "leased" });
  assert.deepEqual(aiAutosendReplayStep(replay("some_new_state"), { now: NOW, providerStatus: "WORKING" }), { step: "in_progress", workState: "some_new_state" },
    "an unknown work state is never sent or recorded");
  assert.deepEqual(aiAutosendReplayStep(replay("constructor"), { now: NOW, providerStatus: "WORKING" }), { step: "in_progress", workState: "constructor" });
  assert.deepEqual(aiAutosendReplayStep(replay("succeeded"), { now: NOW, providerStatus: "WORKING" }), { step: "in_progress", workState: "succeeded" },
    "finished work is never recorded by a replay (277 closes stuck decisions)");
  assert.equal(AI_AUTOSEND_REPLAY_WINDOW_SECONDS, 60);
  const finished = (outcome) => ({ status: "finished", result: { outcome } });
  assert.deepEqual(aiAutosendOutcome(finished("succeeded"), null), { outcome: "sent", code: null });
  assert.deepEqual(aiAutosendOutcome(finished("terminal_error"), null), { outcome: "failed", code: "send_failed" });
  assert.deepEqual(aiAutosendOutcome(finished("unknown_result"), null), { outcome: "unknown", code: "send_unknown" });
  assert.deepEqual(aiAutosendOutcome(finished("terminal_error"), { code: "provider_rejected", httpStatus: 475 }), { outcome: "failed", code: "provider_restricted" });
});

// ------------------------------------------------------------ manual send untouched

test("manual send is untouched: no switch, presence, record or autosend id in its path; presence is additive on the provider", () => {
  const actions = read("src/lib/platform-provider-actions.ts");
  const orchestrator = read("src/lib/server/platform-provider-orchestrator.ts");
  for (const source of [actions, orchestrator]) {
    assert.doesNotMatch(source, /sendSeen|startTyping|stopTyping|EVO_AI_AGENT_AUTOSEND|ai_autosend|ai-agent-send/u);
  }
  // Ручная отправка по-прежнему: случайные id запроса, свой воркер, без цитаты.
  assert.match(actions, /workerRef: MANUAL_SEND_WORKER_REF,\n\s+claimRequestId: randomUUID\(\),\n\s+completionRequestId: randomUUID\(\),/u);
  const provider = read("src/lib/server/platform-waha-provider.ts");
  assert.match(provider, /export type PlatformWahaChatPresence = Readonly<\{/u);
  assert.match(provider, /`\$\{runtime\.wahaBaseUrl\}\/api\/\$\{path\}`/u);
  // Маршрут отправки — только POST, обработчик с выключателем, никаких других методов.
  const route = read("src/app/api/internal/ai-agent/send/route.ts");
  assert.match(route, /export const POST = createAiAutosendSendHandler\(\);/u);
  assert.doesNotMatch(route, /export const (?:GET|PUT|PATCH|DELETE)/u);
  const send = read("src/lib/server/ai-agent-send.ts");
  assert.ok(send.indexOf("if (!secret) return refuse(503, \"autosend_disabled\");") < send.indexOf("new URL(request.url)"),
    "the switch is the first check");
});
