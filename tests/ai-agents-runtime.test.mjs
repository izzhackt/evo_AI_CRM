// «ИИ-агенты» на Claude Managed Agents: рантайм CRM — клиент Claude, синхронизация, запуски,
// опрос, сверка, решения по черновикам, отправка WhatsApp, хеш конфигурации
// (docs/design/ai-agents/contract.md §C). Всё на подставном fetch по форме документации
// (platform.claude.com/docs/en/managed-agents, 22.10.2026) и подставных RPC; живого Claude API,
// WhatsApp и боевой базы здесь нет — это техническая проверка кода, не приёмка у провайдера.
//
// node --conditions=react-server --experimental-strip-types --test tests/ai-agents-runtime.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AnthropicApiError, createAnthropicClient } from "../src/lib/server/ai-agents/anthropic.ts";
import { computeAiAgentConfigHash, resolveAiAgentsMcpUrl } from "../src/lib/server/ai-agents/config-hash.ts";
import { readDefaultRunBudgetUsd, sessionBudget } from "../src/lib/server/ai-agents/env.ts";
import { resetAiAgentReconcileMemory } from "../src/lib/server/ai-agents/runs.ts";
import {
  aiAgentsRuntimeAvailability,
  decideAiAgentDraft,
  followUpAiAgentRun,
  interruptAiAgentRun,
  loadAiAgentRunTranscript,
  pollAiAgentRun,
  reconcileAiAgentRuns,
  startAiAgentRun,
  syncAiAgent,
} from "../src/lib/server/ai-agents/runtime.ts";
import {
  aiAgentSendStepId,
  parseAiAgentWhatsAppAuthorization,
  sendAiAgentWhatsAppDraft,
} from "../src/lib/server/ai-agents/whatsapp-send.ts";
import {
  ADMIN_ID, CLAUDE_TEST_KEY, DRAFT_ID, NOW, ORG, REQ_ID, RUN_ID, STAFF_ID,
  actor, claudeError, fakeClaude, fakeRpc, runtimeDeps, sha256,
} from "./ai-agents-fakes.mjs";

const DEFAULT_MCP = "https://crm.evoadmissions.com/api/mcp/v1";
const NOW_ISO = new Date(NOW).toISOString();
const t = (seconds) => `2026-10-22T10:00:${String(seconds).padStart(2, "0")}.000Z`;

/* ------------------------------------------------------------------ клиент Claude */

test("anthropic: заголовки, ?beta=true только где нужно, параметры списка событий", async () => {
  const claude = fakeClaude({
    "POST /v1/agents": { id: "agent_1", version: 1 },
    "GET /v1/sessions/sesn_1/events": { data: [], next_page: null },
  });
  const client = createAnthropicClient({ fetch: claude.fetch, apiKey: CLAUDE_TEST_KEY });
  await client.agents.create({ name: "x" });
  await client.sessions.listEvents("sesn_1", { order: "asc", limit: 100, createdAtGte: t(4), types: ["agent.message", "session.status_idle"], page: "p2" });
  const [create, events] = claude.calls;
  assert.equal(create.headers["x-api-key"], CLAUDE_TEST_KEY);
  assert.equal(create.headers["anthropic-version"], "2023-06-01");
  assert.equal(create.headers["anthropic-beta"], "managed-agents-2026-04-01");
  assert.equal(create.headers["content-type"], "application/json");
  assert.equal(create.search, "", "agents без ?beta=true");
  assert.equal(events.queryAll.get("beta"), "true");
  assert.deepEqual([events.query.order, events.query.limit, events.query["created_at[gte]"], events.query.page], ["asc", "100", t(4), "p2"]);
  assert.deepEqual(events.queryAll.getAll("types[]"), ["agent.message", "session.status_idle"]);
});

test("anthropic: 429 повторяется с учётом retry-after, GET на 5xx повторяется, создание сессии на 5xx — нет", async () => {
  const delays = [];
  let attempts = 0;
  const claude = fakeClaude({
    "GET /v1/sessions/sesn_1": () => {
      attempts += 1;
      return attempts < 3
        ? new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow" } }), { status: 429, headers: { "retry-after": "2" } })
        : { id: "sesn_1", status: "idle" };
    },
    "POST /v1/sessions": claudeError(500, "api_error", "boom"),
    "GET /v1/agents/agent_1": claudeError(503, "overloaded_error", "later"),
  });
  const client = createAnthropicClient({ fetch: claude.fetch, apiKey: CLAUDE_TEST_KEY, sleep: async (ms) => { delays.push(ms); } });
  assert.deepEqual(await client.sessions.get("sesn_1"), { id: "sesn_1", status: "idle" });
  assert.deepEqual(delays, [2000, 2000], "retry-after 2 с побеждает базовую паузу 400/1200 мс");

  await assert.rejects(client.sessions.create({ agent: "a" }), (error) => error instanceof AnthropicApiError && error.status === 500 && error.type === "api_error");
  assert.equal(claude.callsFor("POST", "/v1/sessions").length, 1, "вторая сессия от повтора запрещена");

  await assert.rejects(client.agents.get("agent_1"), (error) => error.status === 503);
  assert.equal(claude.callsFor("GET", "/v1/agents/agent_1").length, 3, "чтение: попытка и два повтора");
});

test("anthropic: сетевая ошибка и ошибка API — понятные типы, ключа в сообщении нет", async () => {
  const down = createAnthropicClient({ fetch: async () => { throw new TypeError("fetch failed"); }, apiKey: CLAUDE_TEST_KEY, sleep: async () => {} });
  await assert.rejects(down.agents.get("agent_1"), (error) => {
    assert.equal(error.status, 0);
    assert.equal(error.type, "network_error");
    assert.ok(!error.message.includes(CLAUDE_TEST_KEY));
    return true;
  });
  const claude = fakeClaude({ "GET /v1/agents/agent_x": claudeError(401, "authentication_error", "invalid x-api-key") });
  const client = createAnthropicClient({ fetch: claude.fetch, apiKey: CLAUDE_TEST_KEY });
  await assert.rejects(client.agents.get("agent_x"), (error) => error.status === 401 && error.type === "authentication_error" && !error.message.includes(CLAUDE_TEST_KEY));
});

test("anthropic: списки читаются постранично по next_page", async () => {
  let page = 0;
  const claude = fakeClaude({
    "GET /v1/environments": (call) => {
      page += 1;
      return call.query.page === "next" ? { data: [{ id: "env_2" }], next_page: null } : { data: [{ id: "env_1" }], next_page: "next" };
    },
  });
  const client = createAnthropicClient({ fetch: claude.fetch, apiKey: CLAUDE_TEST_KEY });
  assert.deepEqual((await client.environments.list()).map((item) => item.id), ["env_1", "env_2"]);
  assert.equal(page, 2);
});

/* ---------------------------------------------------------------- хеш и окружение */

test("config-hash: стабилен, меняется от каждого поля, расписание учитывается только у включённого агента", () => {
  const base = {
    key: "director", title: "Директор / Аналитик", model: "claude-sonnet-5-5", instructionsOverride: "Ты аналитик.",
    scheduleCron: "0 9 * * 1", scheduleTz: "Asia/Bishkek", schedulePromptOverride: "Отчёт.", enabled: true, mcpUrl: DEFAULT_MCP,
  };
  const hash = computeAiAgentConfigHash(base);
  assert.match(hash, /^[0-9a-f]{64}$/u);
  assert.equal(computeAiAgentConfigHash({ ...base }), hash);
  for (const change of [
    { title: "Другое имя" }, { model: "claude-opus-5-5" }, { instructionsOverride: "Другая инструкция." }, { scheduleCron: "0 8 * * 1" },
    { scheduleTz: "Asia/Almaty" }, { schedulePromptOverride: "Другой отчёт." }, { enabled: false }, { mcpUrl: "https://other.example.test/api/mcp/v1" },
  ]) {
    assert.notEqual(computeAiAgentConfigHash({ ...base, ...change }), hash, JSON.stringify(change));
  }
  const off = computeAiAgentConfigHash({ ...base, enabled: false });
  assert.equal(computeAiAgentConfigHash({ ...base, enabled: false, scheduleCron: "5 5 * * *", schedulePromptOverride: "x" }), off, "у выключенного агента расписание в хеш не входит");
  assert.equal(computeAiAgentConfigHash({ ...base, scheduleCron: null }), computeAiAgentConfigHash({ ...base, scheduleCron: null, schedulePromptOverride: "y", scheduleTz: "UTC" }));
});

test("config-hash: адрес MCP — https, без query и учётных данных, без завершающего «/»", () => {
  assert.equal(resolveAiAgentsMcpUrl({}), DEFAULT_MCP);
  assert.equal(resolveAiAgentsMcpUrl({ EVO_AI_AGENTS_MCP_URL: " " }), DEFAULT_MCP);
  assert.equal(resolveAiAgentsMcpUrl({ EVO_AI_AGENTS_MCP_URL: "https://CRM.Example.test:443/api/mcp/v1/" }), "https://crm.example.test/api/mcp/v1");
  for (const bad of ["http://crm.example.test/api/mcp/v1", "https://u:p@crm.example.test/x", "https://crm.example.test/x?a=1", "https://crm.example.test/x#f", "https://crm.example.test/x?", "not a url"]) {
    assert.throws(() => resolveAiAgentsMcpUrl({ EVO_AI_AGENTS_MCP_URL: bad }), /ai_agents_mcp_url_invalid/u, bad);
  }
});

test("env: потолок расхода сессии в центах строкой, значение по умолчанию и граница 0..100, доступность по ключу", () => {
  assert.deepEqual(sessionBudget(5), { type: "limit", max_list_cost: { amount: "500", currency: "USD" } });
  assert.equal(sessionBudget(0.5).max_list_cost.amount, "50");
  assert.equal(sessionBudget(0.001).max_list_cost.amount, "1");
  assert.equal(sessionBudget(0), null);
  assert.equal(sessionBudget(-1), null);
  assert.equal(readDefaultRunBudgetUsd({}), 5);
  assert.equal(readDefaultRunBudgetUsd({ EVO_AI_AGENTS_RUN_BUDGET_USD: "0" }), 0);
  assert.equal(readDefaultRunBudgetUsd({ EVO_AI_AGENTS_RUN_BUDGET_USD: "12.5" }), 12.5);
  assert.equal(readDefaultRunBudgetUsd({ EVO_AI_AGENTS_RUN_BUDGET_USD: "101" }), 5);
  assert.equal(readDefaultRunBudgetUsd({ EVO_AI_AGENTS_RUN_BUDGET_USD: "дорого" }), 5);
  assert.deepEqual(aiAgentsRuntimeAvailability({}), { configured: false, reason: "api_key_missing" });
  assert.deepEqual(aiAgentsRuntimeAvailability({ EVO_ANTHROPIC_API_KEY: "  " }), { configured: false, reason: "api_key_missing" });
  assert.deepEqual(aiAgentsRuntimeAvailability({ EVO_ANTHROPIC_API_KEY: CLAUDE_TEST_KEY }), { configured: true, reason: null });
});

/* ------------------------------------------------------------- синхронизация */

const FRESH_CONFIG = {
  key: "director", title: "Директор / Аналитик", roleLine: "Считает продажи и воронку", model: "claude-sonnet-5-5",
  instructionsOverride: "Ты аналитик EVO. Работай только с данными CRM.", scheduleCron: "0 9 * * 1", scheduleTz: "Asia/Bishkek",
  schedulePromptOverride: "Подготовь недельный отчёт и опубликуй его.", enabled: true, runBudgetUsd: 5,
  claudeAgentId: null, claudeAgentVersion: null, environmentId: null, vaultId: null, credentialId: null, deploymentId: null,
  mcpUrl: null, configHash: null, tokenFingerprint: null, syncStatus: "never",
};
const SYNCED_CONFIG = {
  ...FRESH_CONFIG, claudeAgentId: "agent_old", claudeAgentVersion: 4, environmentId: "env_old", vaultId: "vlt_old",
  credentialId: "vcrd_old", deploymentId: "depl_old", mcpUrl: DEFAULT_MCP, syncStatus: "ok",
};

function syncSetup({ config = FRESH_CONFIG, routes = {}, noKey = false, servicePatch = {} } = {}) {
  const service = fakeRpc({
    ai_agent_runtime_get_v1: () => ({ data: config }),
    ai_agent_runtime_sync_record_v1: () => ({ data: { ok: true } }),
    ai_agent_runtime_token_set_v1: () => ({ data: { tokenFingerprint: "abcdef012345" } }),
    ...servicePatch,
  });
  const claude = fakeClaude({
    "GET /v1/environments": { data: [] },
    "POST /v1/environments": { id: "env_new" },
    "POST /v1/vaults": { id: "vlt_new" },
    "POST /v1/vaults/:v/credentials": { id: "vcrd_new" },
    "POST /v1/vaults/:v/credentials/:c": { id: "vcrd_old" },
    "POST /v1/vaults/:v/credentials/:c/archive": { id: "vcrd_old", archived_at: NOW_ISO },
    "POST /v1/agents": { id: "agent_new", version: 1 },
    "GET /v1/agents/:a": { id: "agent_old", version: 4, archived_at: null },
    "POST /v1/agents/:a": { id: "agent_old", version: 5 },
    "POST /v1/deployments": { id: "depl_new", status: "active" },
    "POST /v1/deployments/:d": { id: "depl_old", status: "active" },
    "POST /v1/deployments/:d/pause": { id: "depl_old", status: "paused" },
    "POST /v1/deployments/:d/unpause": { id: "depl_old", status: "active" },
    ...routes,
  });
  const { deps, logs } = runtimeDeps({ claude, service, noKey });
  return { service, claude, deps, logs, ctx: { staffClient: fakeRpc().client, actor: actor() } };
}

const records = (service) => service.called("ai_agent_runtime_sync_record_v1").map((call) => call.args.p_result);

test("sync с нуля: среда, vault, токен, агент, расписание; id пишутся по мере получения, токен только в vault", async () => {
  const { service, claude, deps, logs, ctx } = syncSetup();
  const result = await syncAiAgent(ctx, { key: "director", requestId: REQ_ID }, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.created, { agent: true, environment: true, vault: true, deployment: true });
  assert.equal(result.tokenRotated, true);
  assert.equal(result.agentVersion, 1);
  assert.deepEqual(result.warnings, []);

  // Среда: сеть ограничена хостом MCP.
  const environment = claude.callsFor("POST", "/v1/environments")[0].body;
  assert.equal(environment.name, "evo-crm-agents");
  assert.deepEqual(environment.config, { type: "cloud", networking: { type: "limited", allowed_hosts: ["crm.evoadmissions.com"], allow_mcp_servers: true } });

  // Vault и креденшл: токен 43 символа base64url, в БД только его SHA-256.
  assert.deepEqual(claude.callsFor("POST", "/v1/vaults")[0].body, { display_name: "EVO CRM · director", metadata: { evo_agent_key: "director" } });
  const credential = claude.callsFor("POST", "/v1/vaults/vlt_new/credentials")[0].body;
  assert.equal(credential.auth.type, "static_bearer");
  assert.equal(credential.auth.mcp_server_url, DEFAULT_MCP);
  const token = credential.auth.token;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  const stage = service.called("ai_agent_runtime_token_set_v1");
  assert.equal(stage.length, 1);
  assert.deepEqual([stage[0].args.p_mode, stage[0].args.p_new_sha256, stage[0].args.p_actor_membership_id], ["stage", sha256(token), ADMIN_ID]);

  // Агент: MCP-сервер, оба набора инструментов без подтверждений, метаданные.
  const agent = claude.callsFor("POST", "/v1/agents")[0].body;
  assert.equal(agent.name, "Директор / Аналитик");
  assert.deepEqual(agent.model, { id: "claude-sonnet-5-5" });
  assert.ok(agent.system.includes("Ты аналитик EVO. Работай только с данными CRM."));
  assert.deepEqual(agent.mcp_servers, [{ type: "url", name: "evo_crm", url: DEFAULT_MCP }]);
  const allow = { permission_policy: { type: "always_allow" } };
  assert.deepEqual(agent.tools, [
    { type: "agent_toolset_20260401", default_config: allow },
    { type: "mcp_toolset", mcp_server_name: "evo_crm", default_config: allow },
  ]);
  assert.equal(agent.metadata.evo_agent_key, "director");
  assert.match(agent.metadata.evo_config_hash, /^[0-9a-f]{64}$/u);

  // Расписание: cron, пояс, поручение, потолок 5 USD = "500" центов, vault.
  const deployment = claude.callsFor("POST", "/v1/deployments")[0];
  assert.equal(deployment.queryAll.get("beta"), "true");
  assert.deepEqual(deployment.body.schedule, { type: "cron", expression: "0 9 * * 1", timezone: "Asia/Bishkek" });
  assert.equal(deployment.body.agent, "agent_new");
  assert.equal(deployment.body.environment_id, "env_new");
  assert.deepEqual(deployment.body.vault_ids, ["vlt_new"]);
  assert.deepEqual(deployment.body.initial_events, [{ type: "user.message", content: [{ type: "text", text: "Подготовь недельный отчёт и опубликуй его." }] }]);
  assert.deepEqual(deployment.body.budget, { type: "limit", max_list_cost: { amount: "500", currency: "USD" } });

  // Запись в БД: pending → id по мере получения → ok с хешем, который видит интерфейс.
  const written = records(service);
  assert.deepEqual(written.map((item) => item.status), ["pending", "pending", "pending", "pending", "pending", "pending", "ok"]);
  const last = written.at(-1);
  assert.deepEqual(
    [last.claudeAgentId, last.agentVersion, last.environmentId, last.vaultId, last.credentialId, last.deploymentId, last.mcpUrl],
    ["agent_new", 1, "env_new", "vlt_new", "vcrd_new", "depl_new", DEFAULT_MCP],
  );
  assert.equal(last.configHash, agent.metadata.evo_config_hash);
  assert.equal(last.configHash, computeAiAgentConfigHash({
    key: "director", title: FRESH_CONFIG.title, model: FRESH_CONFIG.model, instructionsOverride: FRESH_CONFIG.instructionsOverride,
    scheduleCron: "0 9 * * 1", scheduleTz: "Asia/Bishkek", schedulePromptOverride: FRESH_CONFIG.schedulePromptOverride, enabled: true, mcpUrl: DEFAULT_MCP,
  }));

  // Токен нигде, кроме запроса в vault Claude: ни в БД, ни в журнале, ни в ответе.
  const everywhereElse = JSON.stringify([service.calls, logs, result]);
  assert.ok(!everywhereElse.includes(token));
  assert.ok(!JSON.stringify(claude.calls.filter((call) => call.path !== "/v1/vaults/vlt_new/credentials")).includes(token));
});

test("sync повторный: ничего не создаётся заново, агент обновляется по версии, токен остаётся", async () => {
  const { service, claude, deps, ctx } = syncSetup({ config: SYNCED_CONFIG, routes: {
    "POST /v1/deployments/:d": { id: "depl_old", status: "paused" },
  } });
  const result = await syncAiAgent(ctx, { key: "director", requestId: REQ_ID }, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.created, { agent: false, environment: false, vault: false, deployment: false });
  assert.equal(result.tokenRotated, false);
  assert.equal(result.agentVersion, 5);
  assert.equal(service.called("ai_agent_runtime_token_set_v1").length, 0);
  assert.equal(claude.callsFor("POST", "/v1/environments").length + claude.callsFor("POST", "/v1/vaults").length + claude.callsFor("POST", "/v1/agents").length, 0);
  assert.equal(claude.callsFor("GET", "/v1/environments").length, 0);
  assert.equal(claude.callsFor("POST", "/v1/vaults/vlt_old/credentials").length, 0);
  assert.equal(claude.callsFor("GET", "/v1/agents/agent_old").length, 1);
  assert.equal(claude.callsFor("POST", "/v1/agents/agent_old")[0].body.version, 4);
  assert.equal(claude.callsFor("POST", "/v1/deployments/depl_old").length, 1);
  assert.equal(claude.callsFor("POST", "/v1/deployments/depl_old/unpause").length, 1, "расписание на паузе снимается с паузы");
  assert.equal(records(service).at(-1).status, "ok");
});

test("sync: 409 при обновлении агента — повтор с актуальной версией один раз", async () => {
  let reads = 0;
  let writes = 0;
  const { claude, deps, ctx } = syncSetup({ config: SYNCED_CONFIG, routes: {
    "GET /v1/agents/:a": () => { reads += 1; return { id: "agent_old", version: reads === 1 ? 4 : 6, archived_at: null }; },
    "POST /v1/agents/:a": () => { writes += 1; return writes === 1 ? claudeError(409, "conflict_error", "version mismatch") : { id: "agent_old", version: 7 }; },
  } });
  const result = await syncAiAgent(ctx, { key: "director", requestId: REQ_ID }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.agentVersion, 7);
  assert.deepEqual(claude.callsFor("POST", "/v1/agents/agent_old").map((call) => call.body.version), [4, 6]);
});

test("sync: агент, архивированный в Claude, заменяется новым с предупреждением", async () => {
  const { claude, deps, ctx } = syncSetup({ config: SYNCED_CONFIG, routes: {
    "GET /v1/agents/:a": { id: "agent_old", version: 4, archived_at: NOW_ISO },
  } });
  const result = await syncAiAgent(ctx, { key: "director", requestId: REQ_ID }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.created.agent, true);
  assert.equal(claude.callsFor("POST", "/v1/agents").length, 1);
  assert.match(result.warnings[0], /архивирован/u);
});

test("sync: ротация токена — обновляет креденшл в vault; при сбое Claude токен откатывается, статус error, токена в ответе нет", async () => {
  const ok = syncSetup({ config: SYNCED_CONFIG });
  const rotated = await syncAiAgent(ok.ctx, { key: "director", rotateToken: true, requestId: REQ_ID }, ok.deps);
  assert.equal(rotated.ok, true);
  assert.equal(rotated.tokenRotated, true);
  const update = ok.claude.callsFor("POST", "/v1/vaults/vlt_old/credentials/vcrd_old")[0].body;
  assert.equal(update.auth.type, "static_bearer");
  assert.match(update.auth.token, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(ok.service.called("ai_agent_runtime_token_set_v1")[0].args.p_new_sha256, sha256(update.auth.token));

  const broken = syncSetup({ config: SYNCED_CONFIG, routes: {
    "POST /v1/vaults/:v/credentials/:c": claudeError(500, "api_error", "vault is down"),
  } });
  const failed = await syncAiAgent(broken.ctx, { key: "director", rotateToken: true, requestId: REQ_ID }, broken.deps);
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "anthropic_error");
  assert.deepEqual(broken.service.called("ai_agent_runtime_token_set_v1").map((call) => call.args.p_mode), ["stage", "restore"]);
  const final = records(broken.service).at(-1);
  assert.equal(final.status, "error");
  assert.match(final.error, /vault is down/u);
  assert.equal(broken.claude.callsFor("POST", "/v1/agents/agent_old").length, 0, "после сбоя токена агент не трогается");
  const sentToken = broken.claude.callsFor("POST", "/v1/vaults/vlt_old/credentials/vcrd_old")[0].body.auth.token;
  assert.ok(!JSON.stringify([failed, broken.service.calls, broken.logs]).includes(sentToken));
});

test("sync: смена адреса MCP — новый креденшл создаётся первым, старый архивируется, токен новый", async () => {
  const { service, claude, deps, ctx } = syncSetup({ config: { ...SYNCED_CONFIG, mcpUrl: "https://old.example.test/api/mcp/v1" } });
  const result = await syncAiAgent(ctx, { key: "director", requestId: REQ_ID }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.tokenRotated, true);
  assert.match(result.warnings.join(" "), /Адрес MCP изменился/u);
  const order = claude.calls.filter((call) => call.path.includes("/credentials")).map((call) => `${call.method} ${call.path}`);
  assert.deepEqual(order, ["POST /v1/vaults/vlt_old/credentials", "POST /v1/vaults/vlt_old/credentials/vcrd_old/archive"]);
  assert.equal(claude.callsFor("POST", "/v1/vaults/vlt_old/credentials")[0].body.auth.mcp_server_url, DEFAULT_MCP);
  assert.equal(claude.callsFor("POST", "/v1/agents/agent_old")[0].body.mcp_servers[0].url, DEFAULT_MCP);
  const last = records(service).at(-1);
  assert.deepEqual([last.credentialId, last.mcpUrl], ["vcrd_new", DEFAULT_MCP]);
});

test("sync: адрес MCP уже занят в vault (409) — креденшл находится по адресу и получает новый токен", async () => {
  const { service, claude, deps, ctx } = syncSetup({
    config: { ...FRESH_CONFIG, environmentId: "env_old", vaultId: "vlt_old" },
    routes: {
      "POST /v1/vaults/:v/credentials": claudeError(409, "conflict_error", "duplicate mcp_server_url"),
      "GET /v1/vaults/:v/credentials": { data: [
        { id: "vcrd_gone", archived_at: NOW_ISO, auth: { type: "static_bearer", mcp_server_url: DEFAULT_MCP } },
        { id: "vcrd_exist", archived_at: null, auth: { type: "static_bearer", mcp_server_url: `${DEFAULT_MCP.toUpperCase().replace("HTTPS", "https")}/` } },
      ] },
      "POST /v1/vaults/:v/credentials/:c": { id: "vcrd_exist" },
    },
  });
  const result = await syncAiAgent(ctx, { key: "director", requestId: REQ_ID }, deps);
  assert.equal(result.ok, true);
  assert.equal(claude.callsFor("POST", "/v1/vaults/vlt_old/credentials/vcrd_exist").length, 1);
  assert.equal(records(service).at(-1).credentialId, "vcrd_exist");
});

test("sync: расписание останавливается, когда агент выключен или cron убран; без текста поручения — предупреждение", async () => {
  const off = syncSetup({ config: { ...SYNCED_CONFIG, enabled: false } });
  const stopped = await syncAiAgent(off.ctx, { key: "director", requestId: REQ_ID }, off.deps);
  assert.equal(stopped.ok, true);
  assert.equal(off.claude.callsFor("POST", "/v1/deployments/depl_old/pause").length, 1);
  assert.equal(off.claude.callsFor("POST", "/v1/deployments/depl_old").length, 0);
  assert.equal(records(off.service).at(-1).deploymentId, "depl_old", "id приостановленного расписания остаётся записанным");

  const noCron = syncSetup({ config: { ...SYNCED_CONFIG, scheduleCron: null } });
  assert.equal((await syncAiAgent(noCron.ctx, { key: "director", requestId: REQ_ID }, noCron.deps)).ok, true);
  assert.equal(noCron.claude.callsFor("POST", "/v1/deployments/depl_old/pause").length, 1);

  const alreadyPaused = syncSetup({ config: { ...SYNCED_CONFIG, enabled: false }, routes: {
    "POST /v1/deployments/:d/pause": claudeError(409, "conflict_error", "already paused"),
  } });
  assert.equal((await syncAiAgent(alreadyPaused.ctx, { key: "director", requestId: REQ_ID }, alreadyPaused.deps)).ok, true);

  const noPrompt = syncSetup({ config: { ...FRESH_CONFIG, key: "curator-cn", title: "Куратор Китай", scheduleCron: "0 8 * * *", schedulePromptOverride: null } });
  const warned = await syncAiAgent(noPrompt.ctx, { key: "curator-cn", requestId: REQ_ID }, noPrompt.deps);
  assert.equal(warned.ok, true);
  assert.match(warned.warnings.join(" "), /нет текста поручения/u);
  assert.equal(noPrompt.claude.callsFor("POST", "/v1/deployments").length, 0);
});

test("sync: отказы до обращения к Claude — нет ключа, не админ, просмотр роли, нет инструкции; Claude не вызывается", async () => {
  const noKey = syncSetup({ noKey: true });
  const missing = await syncAiAgent(noKey.ctx, { key: "director", requestId: REQ_ID }, noKey.deps);
  assert.deepEqual([missing.ok, missing.code], [false, "api_key_missing"]);
  assert.equal(noKey.claude.calls.length + noKey.service.calls.length, 0);

  const staff = syncSetup();
  const forbidden = await syncAiAgent({ ...staff.ctx, actor: actor({ systemRole: "staff", membershipId: STAFF_ID }) }, { key: "director", requestId: REQ_ID }, staff.deps);
  assert.deepEqual([forbidden.ok, forbidden.code], [false, "forbidden"]);

  const preview = syncSetup();
  const previewed = await syncAiAgent({ ...preview.ctx, actor: actor({ presentationRole: "sales" }) }, { key: "director", requestId: REQ_ID }, preview.deps);
  assert.deepEqual([previewed.ok, previewed.code], [false, "preview_read_only"]);
  assert.equal(staff.claude.calls.length + preview.claude.calls.length, 0);

  // Агент без инструкции («Куратор Европа»): синхронизировать нельзя.
  const empty = syncSetup({ config: { ...FRESH_CONFIG, key: "curator-eu", title: "Куратор Европа", instructionsOverride: null, scheduleCron: null, schedulePromptOverride: null, enabled: false } });
  const instructions = await syncAiAgent(empty.ctx, { key: "curator-eu", requestId: REQ_ID }, empty.deps);
  assert.deepEqual([instructions.ok, instructions.code], [false, "instructions_empty"]);
  assert.equal(empty.claude.calls.length, 0);
  assert.equal(empty.service.called("ai_agent_runtime_sync_record_v1").length, 0);
});

test("sync: ошибка Claude фиксируется статусом error без значений ключей; повторный запуск одновременно — conflict", async () => {
  const denied = syncSetup({ routes: { "GET /v1/environments": claudeError(401, "authentication_error", "invalid x-api-key") } });
  const result = await syncAiAgent(denied.ctx, { key: "director", requestId: REQ_ID }, denied.deps);
  assert.deepEqual([result.ok, result.code], [false, "anthropic_error"]);
  assert.match(result.message, /отклонил ключ/u);
  assert.ok(!JSON.stringify([result, denied.service.calls, denied.logs]).includes(CLAUDE_TEST_KEY));
  assert.equal(records(denied.service).at(-1).status, "error");

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = syncSetup({ routes: { "GET /v1/environments": async () => { await gate; return { data: [] }; } } });
  const first = syncAiAgent(slow.ctx, { key: "director", requestId: REQ_ID }, slow.deps);
  await new Promise((resolve) => setImmediate(resolve));
  const second = await syncAiAgent(slow.ctx, { key: "director", requestId: REQ_ID }, slow.deps);
  assert.deepEqual([second.ok, second.code], [false, "conflict"]);
  release();
  assert.equal((await first).ok, true);
});

/* ------------------------------------------- аренда среды (миграция 318, ревью #1290) */

const CLAIM_TOKEN = "77777777-7777-4777-8777-777777777777";

test("sync: среда под арендой — аренда, поиск или создание, запись id в строку агента, и только потом снятие аренды", async () => {
  const order = [];
  const { service, claude, deps, ctx } = syncSetup({
    servicePatch: {
      ai_agent_runtime_environment_claim_v1: () => { order.push("claim"); return { data: { status: "claimed", claimToken: CLAIM_TOKEN } }; },
      ai_agent_runtime_environment_release_v1: () => { order.push("release"); return { data: { released: true } }; },
      ai_agent_runtime_sync_record_v1: (args) => { if (args.p_result.environmentId && args.p_result.status === "pending") order.push("record_environment"); return { data: { ok: true } }; },
    },
    routes: { "POST /v1/environments": () => { order.push("create"); return { id: "env_new" }; } },
  });
  const result = await syncAiAgent(ctx, { key: "director", requestId: REQ_ID }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.created.environment, true);
  assert.deepEqual(order, ["claim", "create", "record_environment", "release"], "id записан в БД до снятия аренды");
  assert.deepEqual(service.called("ai_agent_runtime_environment_claim_v1")[0].args, { p_organization_id: ORG, p_key: "director" });
  assert.deepEqual(service.called("ai_agent_runtime_environment_release_v1")[0].args, { p_organization_id: ORG, p_claim_token: CLAIM_TOKEN });
  assert.equal(claude.callsFor("GET", "/v1/environments").length, 1);
});

test("sync: среда уже записана у другого агента (known) — Claude не опрашивается и среда не создаётся, аренды нет", async () => {
  const { service, claude, deps, ctx } = syncSetup({
    servicePatch: {
      ai_agent_runtime_environment_claim_v1: () => ({ data: { status: "known", environmentId: "env_shared" } }),
      ai_agent_runtime_environment_release_v1: () => ({ data: { released: true } }),
    },
  });
  const result = await syncAiAgent(ctx, { key: "director", requestId: REQ_ID }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.created.environment, false);
  assert.equal(claude.callsFor("GET", "/v1/environments").length + claude.callsFor("POST", "/v1/environments").length, 0);
  assert.equal(service.called("ai_agent_runtime_environment_release_v1").length, 0);
  const written = records(service);
  assert.equal(written[1].environmentId, "env_shared");
  assert.equal(written.at(-1).environmentId, "env_shared");
  assert.equal(claude.callsFor("POST", "/v1/deployments")[0].body.environment_id, "env_shared");
});

test("sync: аренда занята — ждёт и берёт среду, записанную держателем; дольше предела — conflict и статус error", async () => {
  let polls = 0;
  const sleeps = [];
  const waits = syncSetup({
    servicePatch: {
      ai_agent_runtime_environment_claim_v1: () => {
        polls += 1;
        return { data: polls < 4 ? { status: "busy", retryAfterSeconds: 2 } : { status: "known", environmentId: "env_by_holder" } };
      },
    },
  });
  waits.deps.sleep = async (ms) => { sleeps.push(ms); };
  const ok = await syncAiAgent(waits.ctx, { key: "director", requestId: REQ_ID }, waits.deps);
  assert.equal(ok.ok, true);
  assert.deepEqual(sleeps, [2000, 2000, 2000]);
  assert.equal(waits.claude.callsFor("POST", "/v1/environments").length, 0, "пока ждали, второй среды не создано");

  let tries = 0;
  const stuck = syncSetup({
    servicePatch: { ai_agent_runtime_environment_claim_v1: () => { tries += 1; return { data: { status: "busy", retryAfterSeconds: 30 } }; } },
  });
  stuck.deps.sleep = async (ms) => { assert.ok(ms <= 5000, "пауза ограничена"); };
  const conflict = await syncAiAgent(stuck.ctx, { key: "director", requestId: REQ_ID }, stuck.deps);
  assert.deepEqual([conflict.ok, conflict.code], [false, "conflict"]);
  assert.match(conflict.message, /Среду Claude сейчас создаёт другая синхронизация/u);
  assert.equal(tries, 30);
  assert.equal(stuck.claude.callsFor("POST", "/v1/environments").length, 0);
  assert.equal(stuck.claude.callsFor("POST", "/v1/vaults").length, 0, "дальше среды синхронизация не идёт");
  const last = records(stuck.service).at(-1);
  assert.equal(last.status, "error");
  assert.match(last.error, /Среду Claude сейчас создаёт/u);
});

test("sync: аренда снимается и при сбое создания среды; без миграции 318 (PGRST202) — прежний путь без аренды", async () => {
  const failing = syncSetup({
    servicePatch: {
      ai_agent_runtime_environment_claim_v1: () => ({ data: { status: "claimed", claimToken: CLAIM_TOKEN } }),
      ai_agent_runtime_environment_release_v1: () => ({ data: { released: true } }),
    },
    routes: { "POST /v1/environments": claudeError(500, "api_error", "env is down") },
  });
  const failed = await syncAiAgent(failing.ctx, { key: "director", requestId: REQ_ID }, failing.deps);
  assert.deepEqual([failed.ok, failed.code], [false, "anthropic_error"]);
  assert.equal(failing.service.called("ai_agent_runtime_environment_release_v1").length, 1, "аренда снята в finally");
  assert.equal(records(failing.service).at(-1).status, "error");

  const old = syncSetup();
  const fine = await syncAiAgent(old.ctx, { key: "director", requestId: REQ_ID }, old.deps);
  assert.equal(fine.ok, true);
  assert.equal(fine.created.environment, true);
  assert.equal(old.service.called("ai_agent_runtime_environment_claim_v1").length, 1, "аренду пробовали, функции в базе нет");
  assert.equal(old.service.called("ai_agent_runtime_environment_release_v1").length, 0);
  assert.equal(old.claude.callsFor("POST", "/v1/environments").length, 1);

  const broken = syncSetup({ servicePatch: { ai_agent_runtime_environment_claim_v1: () => ({ error: { code: "XX000", message: "boom" } }) } });
  const unavailable = await syncAiAgent(broken.ctx, { key: "director", requestId: REQ_ID }, broken.deps);
  assert.deepEqual([unavailable.ok, unavailable.code], [false, "unavailable"]);
  assert.equal(broken.claude.callsFor("POST", "/v1/environments").length, 0, "при другой ошибке аренды среду не создаём");
});

test("sync: среда создана, но id не записан в БД — синхронизация падает (иначе следующий создал бы вторую среду), аренда снята", async () => {
  const { service, deps, ctx } = syncSetup({
    servicePatch: {
      ai_agent_runtime_environment_claim_v1: () => ({ data: { status: "claimed", claimToken: CLAIM_TOKEN } }),
      ai_agent_runtime_environment_release_v1: () => ({ data: { released: true } }),
      ai_agent_runtime_sync_record_v1: (args) => (args.p_result.environmentId && args.p_result.status === "pending"
        ? { error: { code: "XX000", message: "write failed" } } : { data: { ok: true } }),
    },
  });
  const result = await syncAiAgent(ctx, { key: "director", requestId: REQ_ID }, deps);
  assert.deepEqual([result.ok, result.code], [false, "unavailable"]);
  assert.equal(service.called("ai_agent_runtime_environment_release_v1").length, 1);
});

test("sync: два агента синхронизируются одновременно — среда создаётся один раз, оба получают её id", async () => {
  // Подставная аренда ведёт себя как таблица в БД: known — если у какого-то агента среда записана, busy — пока аренда у другого.
  const recorded = new Map();
  let held = null;
  const createdBodies = [];
  const configs = {
    director: { ...FRESH_CONFIG },
    sales: { ...FRESH_CONFIG, key: "sales", title: "Продажи (Closer)", scheduleCron: null, enabled: true },
  };
  const service = fakeRpc({
    ai_agent_runtime_get_v1: (args) => ({ data: configs[args.p_key] }),
    ai_agent_runtime_sync_record_v1: (args) => {
      if (args.p_result.environmentId) recorded.set(args.p_key, args.p_result.environmentId);
      return { data: { ok: true } };
    },
    ai_agent_runtime_token_set_v1: () => ({ data: { tokenFingerprint: "abcdef012345" } }),
    ai_agent_runtime_environment_claim_v1: (args) => {
      const known = [...recorded.values()][0];
      if (known) return { data: { status: "known", environmentId: known } };
      if (held) return { data: { status: "busy", retryAfterSeconds: 1 } };
      held = `${args.p_key}-lease`;
      return { data: { status: "claimed", claimToken: CLAIM_TOKEN } };
    },
    ai_agent_runtime_environment_release_v1: () => { held = null; return { data: { released: true } }; },
  });
  let listed = [];
  const claude = fakeClaude({
    "GET /v1/environments": async () => { await new Promise((resolve) => setImmediate(resolve)); return { data: listed }; },
    "POST /v1/environments": async (call) => {
      await new Promise((resolve) => setImmediate(resolve));
      createdBodies.push(call.body);
      listed = [{ id: "env_only_one", name: call.body.name }];
      return { id: "env_only_one" };
    },
    "POST /v1/vaults": (call) => ({ id: `vlt_${call.body.metadata.evo_agent_key}` }),
    "POST /v1/vaults/:v/credentials": { id: "vcrd_new" },
    "POST /v1/agents": (call) => ({ id: `agent_${call.body.metadata.evo_agent_key}`, version: 1 }),
    "POST /v1/deployments": { id: "depl_new", status: "active" },
  });
  const { deps } = runtimeDeps({ claude, service });
  deps.sleep = async () => { await new Promise((resolve) => setImmediate(resolve)); };
  const ctx = { staffClient: fakeRpc().client, actor: actor() };
  const [a, b] = await Promise.all([
    syncAiAgent(ctx, { key: "director", requestId: REQ_ID }, deps),
    syncAiAgent(ctx, { key: "sales", requestId: REQ_ID }, deps),
  ]);
  assert.deepEqual([a.ok, b.ok], [true, true]);
  assert.equal(createdBodies.length, 1, "создана ровно одна среда");
  assert.equal(claude.callsFor("POST", "/v1/environments").length, 1);
  assert.deepEqual([recorded.get("director"), recorded.get("sales")], ["env_only_one", "env_only_one"]);
  assert.equal(a.created.environment !== b.created.environment, true, "создала одна из двух синхронизаций");
  assert.equal(claude.callsFor("POST", "/v1/vaults").length, 2, "хранилище у каждого агента своё");
  const environmentsUsed = claude.callsFor("POST", "/v1/agents").length;
  assert.equal(environmentsUsed, 2);
});

/* ------------------------------------------------------------------ запуски */

const AUTH = {
  agentKey: "director", title: "Директор / Аналитик", enabled: true, autoSend: false, model: "claude-sonnet-5-5", runBudgetUsd: 5,
  membershipId: STAFF_ID, claude: { agentId: "agent_1", agentVersion: 2, environmentId: "env_1", vaultId: "vlt_1" },
};

function runRow(overrides = {}) {
  return {
    id: RUN_ID, agentKey: "director", status: "running", triggerKind: "command", startedAt: t(0), endedAt: null, durationSeconds: null,
    promptPreview: "Покажи настройки", summary: null, errorCode: null, errorMessage: null, model: "claude-sonnet-5-5", agentVersion: 2,
    sessionId: "sesn_1", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costCents: 0, sendAuthority: false,
    startedByName: "Сотрудник", actionsCount: 0, draftsCount: 0, ...overrides,
  };
}

function runSetup({ staff = {}, service = {}, routes = {}, noKey = false } = {}) {
  const staffRpc = fakeRpc({
    ai_agents_run_authorize_v1: () => ({ data: AUTH }),
    ai_agents_run_get_v1: () => ({ data: { run: runRow(), actions: [], drafts: [] } }),
    ...staff,
  });
  const serviceRpc = fakeRpc({
    ai_agent_runtime_run_reserve_v1: () => ({ data: { reserved: true, runId: RUN_ID } }),
    ai_agent_runtime_run_update_v1: () => ({ data: { ok: true } }),
    ...service,
  });
  const claude = fakeClaude({
    "POST /v1/sessions": { id: "sesn_1", status: "running" },
    ...routes,
  });
  const { deps, logs } = runtimeDeps({ claude, service: serviceRpc, noKey });
  return { staffRpc, serviceRpc, claude, deps, logs, ctx: { staffClient: staffRpc.client, actor: actor({ membershipId: STAFF_ID, systemRole: "staff" }) } };
}

test("поручение: право → резерв → сессия с первым сообщением и потолком → запись running", async () => {
  const { staffRpc, serviceRpc, claude, deps, ctx } = runSetup();
  const result = await startAiAgentRun(ctx, { key: "director", text: "Покажи свои настройки", sendAuthority: false, requestId: REQ_ID }, deps);
  assert.deepEqual(result, { ok: true, runId: RUN_ID });

  assert.deepEqual(staffRpc.called("ai_agents_run_authorize_v1")[0].args, { p_organization_id: ORG, p_key: "director", p_send_authority: false });
  const reserve = serviceRpc.called("ai_agent_runtime_run_reserve_v1")[0].args;
  assert.deepEqual(
    [reserve.p_trigger_kind, reserve.p_dedupe_key, reserve.p_started_by_membership_id, reserve.p_send_authority_sha256, reserve.p_model, reserve.p_agent_version],
    ["command", `cmd:${REQ_ID}`, STAFF_ID, null, "claude-sonnet-5-5", 2],
  );
  assert.equal(reserve.p_prompt_preview, "Покажи свои настройки");

  const body = claude.callsFor("POST", "/v1/sessions")[0].body;
  assert.deepEqual(body.agent, { type: "agent", id: "agent_1", version: 2 });
  assert.equal(body.environment_id, "env_1");
  assert.deepEqual(body.vault_ids, ["vlt_1"]);
  assert.match(body.title, /^Директор \/ Аналитик · Покажи свои настройки$/u);
  assert.deepEqual(body.budget, { type: "limit", max_list_cost: { amount: "500", currency: "USD" } });
  assert.deepEqual(body.initial_events, [{ type: "user.message", content: [{ type: "text", text: "Покажи свои настройки" }] }]);
  assert.deepEqual(serviceRpc.called("ai_agent_runtime_run_update_v1")[0].args.p_patch, { sessionId: "sesn_1", status: "running" });
});

test("поручение с правом отправки: код в записке агенту, в БД только его SHA-256", async () => {
  const { serviceRpc, claude, deps, logs, ctx } = runSetup();
  const result = await startAiAgentRun(ctx, { key: "director", text: "Ответь клиенту на WhatsApp", sendAuthority: true, requestId: REQ_ID }, deps);
  assert.equal(result.ok, true);
  const text = claude.callsFor("POST", "/v1/sessions")[0].body.initial_events[0].content[0].text;
  const match = /^Ответь клиенту на WhatsApp\n\n\[\[evo-send-authority:([A-Z2-7]{20})\]\] Staff granted immediate-send authority/u.exec(text);
  assert.ok(match, text);
  assert.match(text, new RegExp(`authority_code="${match[1]}"`, "u"));
  const reserve = serviceRpc.called("ai_agent_runtime_run_reserve_v1")[0].args;
  assert.equal(reserve.p_send_authority_sha256, sha256(match[1]));
  assert.ok(!reserve.p_prompt_preview.includes(match[1]), "в превью нет кода");
  assert.ok(!JSON.stringify([serviceRpc.calls, logs]).includes(match[1]), "код не попадает в БД и журнал");
});

test("поручение: повтор по requestId возвращает прежний запуск без второй сессии", async () => {
  const { claude, deps, ctx } = runSetup({ service: {
    ai_agent_runtime_run_reserve_v1: () => ({ data: { reserved: false, reason: "duplicate", existingRunId: RUN_ID } }),
  } });
  assert.deepEqual(await startAiAgentRun(ctx, { key: "director", text: "Привет", sendAuthority: false, requestId: REQ_ID }, deps), { ok: true, runId: RUN_ID });
  assert.equal(claude.callsFor("POST", "/v1/sessions").length, 0);
});

test("поручение: отказы базы и проверки ввода переводятся в коды интерфейса, Claude не вызывается", async () => {
  const cases = [
    [{ code: "55000", message: "agent_disabled" }, "agent_disabled"],
    [{ code: "55000", message: "agent_not_synced" }, "agent_not_synced"],
    [{ code: "55000", message: "run_in_progress" }, "run_in_progress"],
    [{ code: "42501", message: "ai_agent_forbidden" }, "forbidden"],
    [{ code: "XX000", message: "oops" }, "unavailable"],
  ];
  for (const [error, code] of cases) {
    const { claude, deps, ctx } = runSetup({ staff: { ai_agents_run_authorize_v1: () => ({ error }) } });
    const result = await startAiAgentRun(ctx, { key: "director", text: "Привет", sendAuthority: false, requestId: REQ_ID }, deps);
    assert.deepEqual([result.ok, result.code], [false, code], code);
    assert.ok(result.message.length > 5);
    assert.equal(claude.calls.length, 0);
  }
  const base = runSetup();
  const input = { key: "director", sendAuthority: false, requestId: REQ_ID };
  for (const text of ["", "   ", "x".repeat(8_001), "a\u0000b"]) {
    assert.equal((await startAiAgentRun(base.ctx, { ...input, text }, base.deps)).code, "invalid_input");
  }
  assert.equal((await startAiAgentRun(base.ctx, { ...input, key: "nobody", text: "ok" }, base.deps)).code, "invalid_input");
  assert.equal(base.staffRpc.calls.length, 0, "ввод проверен до базы");

  const noKey = runSetup({ noKey: true });
  assert.equal((await startAiAgentRun(noKey.ctx, { ...input, text: "ok" }, noKey.deps)).code, "api_key_missing");
  const previewCtx = { ...base.ctx, actor: actor({ presentationRole: "sales" }) };
  assert.equal((await startAiAgentRun(previewCtx, { ...input, text: "ok" }, base.deps)).code, "preview_read_only");
  const notSynced = runSetup({ staff: { ai_agents_run_authorize_v1: () => ({ data: { ...AUTH, claude: { agentId: null } } }) } });
  assert.equal((await startAiAgentRun(notSynced.ctx, { ...input, text: "ok" }, notSynced.deps)).code, "agent_not_synced");
});

test("поручение: Claude отказал — запуск failed, ответ с кодом; 429 — rate_limited", async () => {
  const broken = runSetup({ routes: { "POST /v1/sessions": claudeError(400, "invalid_request_error", "environment archived") } });
  const failed = await startAiAgentRun(broken.ctx, { key: "director", text: "Привет", sendAuthority: false, requestId: REQ_ID }, broken.deps);
  assert.deepEqual([failed.ok, failed.code], [false, "anthropic_error"]);
  const patch = broken.serviceRpc.called("ai_agent_runtime_run_update_v1")[0].args.p_patch;
  assert.equal(patch.status, "failed");
  assert.equal(patch.errorCode, "anthropic_error");
  assert.match(patch.errorMessage, /environment archived/u);

  const limited = runSetup({ routes: { "POST /v1/sessions": claudeError(429, "rate_limit_error", "too many") } });
  const slow = await startAiAgentRun(limited.ctx, { key: "director", text: "Привет", sendAuthority: false, requestId: REQ_ID }, limited.deps);
  assert.equal(slow.code, "rate_limited");
  assert.equal(limited.claude.callsFor("POST", "/v1/sessions").length, 3, "429 повторяется дважды");
});

test("продолжение разговора: сессия idle получает user.message; running — run_in_progress; лимит — отказ", async () => {
  const idle = runSetup({ routes: {
    "GET /v1/sessions/sesn_1": { id: "sesn_1", status: "idle" },
    "POST /v1/sessions/sesn_1/events": { data: [] },
  }, staff: { ai_agents_run_get_v1: () => ({ data: { run: runRow({ status: "completed" }), actions: [], drafts: [] } }) } });
  assert.deepEqual(await followUpAiAgentRun(idle.ctx, { runId: RUN_ID, text: "А теперь по Китаю", requestId: REQ_ID }, idle.deps), { ok: true });
  const sent = idle.claude.callsFor("POST", "/v1/sessions/sesn_1/events")[0];
  assert.equal(sent.queryAll.get("beta"), "true");
  assert.deepEqual(sent.body, { events: [{ type: "user.message", content: [{ type: "text", text: "А теперь по Китаю" }] }] });
  assert.deepEqual(idle.serviceRpc.called("ai_agent_runtime_run_update_v1")[0].args.p_patch, { status: "running" });
  assert.equal(idle.staffRpc.called("ai_agents_run_authorize_v1")[0].args.p_key, "director");

  const busy = runSetup({ routes: { "GET /v1/sessions/sesn_1": { id: "sesn_1", status: "running" } } });
  const refused = await followUpAiAgentRun(busy.ctx, { runId: RUN_ID, text: "Ещё", requestId: REQ_ID }, busy.deps);
  assert.deepEqual([refused.ok, refused.code], [false, "run_in_progress"]);
  assert.equal(busy.claude.callsFor("POST", "/v1/sessions/sesn_1/events").length, 0);

  const capped = runSetup({ staff: { ai_agents_run_get_v1: () => ({ data: { run: runRow({ status: "budget_reached" }), actions: [], drafts: [] } }) } });
  const stopped = await followUpAiAgentRun(capped.ctx, { runId: RUN_ID, text: "Ещё", requestId: REQ_ID }, capped.deps);
  assert.equal(stopped.ok, false);
  assert.match(stopped.message, /лимиту расхода/u);
  assert.equal(capped.claude.calls.length, 0);

  const denied = runSetup({ staff: { ai_agents_run_get_v1: () => ({ error: { code: "42501", message: "ai_agent_forbidden" } }) } });
  assert.equal((await followUpAiAgentRun(denied.ctx, { runId: RUN_ID, text: "Ещё", requestId: REQ_ID }, denied.deps)).code, "forbidden");
});

test("остановка: user.interrupt уходит в сессию запуска", async () => {
  const { claude, deps, ctx } = runSetup({ routes: { "POST /v1/sessions/sesn_1/events": { data: [] } } });
  assert.deepEqual(await interruptAiAgentRun(ctx, { runId: RUN_ID }, deps), { ok: true });
  assert.deepEqual(claude.callsFor("POST", "/v1/sessions/sesn_1/events")[0].body, { events: [{ type: "user.interrupt" }] });
  const missing = runSetup({ staff: { ai_agents_run_get_v1: () => ({ error: { code: "P0002", message: "ai_agent_not_found" } }) } });
  assert.deepEqual((await interruptAiAgentRun(missing.ctx, { runId: RUN_ID }, missing.deps)).code, "not_found");
});

/* -------------------------------------------------------------------- опрос */

const SAMPLE_EVENTS = [
  { type: "user.message", id: "e1", processed_at: t(1), content: [{ type: "text", text: "Покажи настройки" }] },
  { type: "session.status_running", id: "e2", processed_at: t(2) },
  { type: "agent.mcp_tool_use", id: "e3", processed_at: t(3), name: "get_my_settings", mcp_server_name: "evo_crm", input: {} },
  { type: "agent.mcp_tool_result", id: "e4", processed_at: t(4), mcp_tool_use_id: "e3", is_error: false, content: [{ type: "text", text: "{\"enabled\":true}" }] },
  { type: "agent.message", id: "e5", processed_at: t(5), content: [{ type: "text", text: "Агент включён, Авто выключен." }] },
  { type: "session.status_idle", id: "e6", processed_at: t(6), stop_reason: { type: "end_turn" } },
];
const SESSION_DONE = {
  id: "sesn_1", status: "idle",
  usage: { input_tokens: 1500, output_tokens: 320, cache_read_input_tokens: 900, list_cost: { amount: "42", currency: "USD" }, active_seconds: 18.5 },
};

test("опрос: пачка событий → хроника, окончание запуска пишет статус, расход и сводку; следующий опрос с курсора — конец", async () => {
  const eventsRoute = (call) => {
    const since = call.query["created_at[gte]"];
    return { data: since ? SAMPLE_EVENTS.filter((event) => event.processed_at >= since) : SAMPLE_EVENTS, next_page: null };
  };
  const first = runSetup({ routes: { "GET /v1/sessions/sesn_1/events": eventsRoute, "GET /v1/sessions/sesn_1": SESSION_DONE } });
  const poll = await pollAiAgentRun(first.ctx, { runId: RUN_ID, cursor: null }, first.deps);
  assert.equal(poll.ok, true);
  assert.deepEqual(poll.poll.events.map((event) => event.kind), ["user", "status", "tool_call", "tool_result", "agent", "status"]);
  assert.equal(poll.poll.events[3].tool, "get_my_settings");

  const events = first.claude.callsFor("GET", "/v1/sessions/sesn_1/events")[0];
  assert.deepEqual([events.query.order, events.query.limit, events.query["created_at[gte]"]], ["asc", "100", undefined]);

  const patch = first.serviceRpc.called("ai_agent_runtime_run_update_v1")[0].args.p_patch;
  assert.deepEqual(
    [patch.status, patch.endedAt, patch.inputTokens, patch.outputTokens, patch.cacheReadTokens, patch.costCents, patch.activeSeconds, patch.summary, patch.eventCount],
    ["completed", NOW_ISO, 1500, 320, 900, 42, 18.5, "Агент включён, Авто выключен.", 6],
  );
  assert.equal(poll.poll.run.status, "completed");
  assert.equal(poll.poll.run.costCents, 42);
  assert.equal(poll.poll.done, false, "в пачке были события — следующий опрос подтвердит конец");
  assert.ok(poll.poll.cursor);

  const second = runSetup({
    routes: { "GET /v1/sessions/sesn_1/events": eventsRoute, "GET /v1/sessions/sesn_1": SESSION_DONE },
    staff: { ai_agents_run_get_v1: () => ({ data: { run: runRow({ status: "completed" }), actions: [], drafts: [] } }) },
  });
  const again = await pollAiAgentRun(second.ctx, { runId: RUN_ID, cursor: poll.poll.cursor }, second.deps);
  assert.equal(again.ok, true);
  assert.deepEqual(again.poll.events, []);
  assert.equal(again.poll.done, true);
  assert.equal(again.poll.cursor, null);
  assert.equal(again.poll.pollAfterMs, 0);
  assert.equal(second.claude.callsFor("GET", "/v1/sessions/sesn_1/events")[0].query["created_at[gte]"], t(6), "опрос идёт с processed_at последнего события");
  assert.equal(second.serviceRpc.called("ai_agent_runtime_run_update_v1").length, 0, "статус не пишется второй раз");
});

test("опрос: пока агент работает — статус не меняется, опрос через 2 с; продолжение разговора возвращает running", async () => {
  const working = [SAMPLE_EVENTS[0], SAMPLE_EVENTS[1], SAMPLE_EVENTS[2]];
  const { serviceRpc, deps, ctx } = runSetup({ routes: { "GET /v1/sessions/sesn_1/events": { data: working, next_page: null } } });
  const result = await pollAiAgentRun(ctx, { runId: RUN_ID, cursor: null }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.poll.done, false);
  assert.equal(result.poll.pollAfterMs, 2000);
  assert.equal(serviceRpc.called("ai_agent_runtime_run_update_v1").length, 0);

  const resumed = runSetup({
    routes: { "GET /v1/sessions/sesn_1/events": { data: [{ type: "session.status_running", id: "e9", processed_at: t(9) }], next_page: null } },
    staff: { ai_agents_run_get_v1: () => ({ data: { run: runRow({ status: "completed" }), actions: [], drafts: [] } }) },
  });
  const next = await pollAiAgentRun(resumed.ctx, { runId: RUN_ID, cursor: null }, resumed.deps);
  assert.deepEqual(resumed.serviceRpc.called("ai_agent_runtime_run_update_v1")[0].args.p_patch, { status: "running" });
  assert.equal(next.poll.run.status, "running");
});

test("опрос: лимит расхода и остановка сотрудником ставят свои статусы; обрыв сессии — failed", async () => {
  const cases = [
    [[{ type: "session.status_idle", id: "z1", processed_at: t(7), stop_reason: { type: "budget_reached" } }], "budget_reached"],
    [[{ type: "user.interrupt", id: "z0", processed_at: t(6) }, { type: "session.status_idle", id: "z1", processed_at: t(7), stop_reason: { type: "end_turn" } }], "interrupted"],
    [[{ type: "session.status_terminated", id: "z1", processed_at: t(7) }], "failed"],
    [[{ type: "session.status_idle", id: "z1", processed_at: t(7), stop_reason: { type: "requires_action" } }], "needs_attention"],
  ];
  for (const [events, status] of cases) {
    const { serviceRpc, deps, ctx } = runSetup({ routes: { "GET /v1/sessions/sesn_1/events": { data: events, next_page: null }, "GET /v1/sessions/sesn_1": SESSION_DONE } });
    await pollAiAgentRun(ctx, { runId: RUN_ID, cursor: null }, deps);
    assert.equal(serviceRpc.called("ai_agent_runtime_run_update_v1")[0].args.p_patch.status, status, status);
  }
});

test("опрос: Claude недоступен — не ошибка запуска: прежний статус, пустая пачка, курсор не сдвинут", async () => {
  const cursor = "eyJ0IjoiMjAyNi0xMC0yMlQxMDowMDowNC4wMDBaIiwiaWRzIjpbXSwidSI6e30sIm4iOjR9";
  for (const route of [claudeError(503, "overloaded_error", "later"), () => { throw new TypeError("fetch failed"); }]) {
    const { serviceRpc, deps, ctx } = runSetup({ routes: { "GET /v1/sessions/sesn_1/events": route } });
    const result = await pollAiAgentRun(ctx, { runId: RUN_ID, cursor }, deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.poll.events, []);
    assert.equal(result.poll.run.status, "running");
    assert.equal(result.poll.cursor, cursor);
    assert.equal(result.poll.done, false);
    assert.equal(serviceRpc.calls.length, 0);
  }
  const noKey = runSetup({ noKey: true });
  assert.equal((await pollAiAgentRun(noKey.ctx, { runId: RUN_ID, cursor: null }, noKey.deps)).ok, true);
});

test("опрос и хроника: чужой или отсутствующий запуск — forbidden / not_found", async () => {
  const forbidden = runSetup({ staff: { ai_agents_run_get_v1: () => ({ error: { code: "42501", message: "ai_agent_forbidden" } }) } });
  assert.deepEqual(await pollAiAgentRun(forbidden.ctx, { runId: RUN_ID, cursor: null }, forbidden.deps), { ok: false, code: "forbidden" });
  const missing = runSetup({ staff: { ai_agents_run_get_v1: () => ({ error: { code: "P0002", message: "ai_agent_not_found" } }) } });
  assert.deepEqual(await pollAiAgentRun(missing.ctx, { runId: RUN_ID, cursor: null }, missing.deps), { ok: false, code: "not_found" });
  assert.deepEqual(await loadAiAgentRunTranscript(missing.ctx, { runId: "not-a-uuid" }, missing.deps), { ok: false, code: "not_found" });
  assert.deepEqual(await pollAiAgentRun(missing.ctx, { runId: "not-a-uuid", cursor: null }, missing.deps), { ok: false, code: "not_found" });
});

test("хроника запуска: до 400 событий, если больше — truncated", async () => {
  const page = (n) => Array.from({ length: 100 }, (_, i) => ({ type: "agent.message", id: `m${n}-${i}`, processed_at: t(1), content: [{ type: "text", text: `m${n}-${i}` }] }));
  const long = runSetup({ routes: { "GET /v1/sessions/sesn_1/events": (call) => {
    const n = call.query.page ? Number(call.query.page) : 1;
    return { data: page(n), next_page: String(n + 1) };
  } } });
  const result = await loadAiAgentRunTranscript(long.ctx, { runId: RUN_ID }, long.deps);
  assert.equal(result.ok, true);
  assert.equal(result.events.length, 400);
  assert.equal(result.truncated, true);
  assert.equal(long.claude.callsFor("GET", "/v1/sessions/sesn_1/events").length, 4);

  const short = runSetup({ routes: { "GET /v1/sessions/sesn_1/events": { data: SAMPLE_EVENTS, next_page: null } } });
  const whole = await loadAiAgentRunTranscript(short.ctx, { runId: RUN_ID }, short.deps);
  assert.deepEqual([whole.ok, whole.events.length, whole.truncated], [true, 6, false]);
  const unavailable = runSetup({ routes: { "GET /v1/sessions/sesn_1/events": claudeError(500, "api_error", "x") } });
  assert.deepEqual(await loadAiAgentRunTranscript(unavailable.ctx, { runId: RUN_ID }, unavailable.deps), { ok: false, code: "unavailable" });
});

/* ------------------------------------------------------------------- сверка */

const RUN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const RUN_B = "aaaaaaaa-0000-4000-8000-000000000002";
const RUN_C = "aaaaaaaa-0000-4000-8000-000000000003";

test("сверка: закрывает зависшие запуски по состоянию сессии, подтягивает запуски по расписанию, не чаще раза в 60 с", async () => {
  resetAiAgentReconcileMemory();
  let clock = NOW;
  const old = new Date(NOW - 10 * 60_000).toISOString();
  const newRuns = [];
  const staff = fakeRpc({
    ai_agents_list_v1: () => ({ data: { agents: [
      { key: "director", model: "claude-sonnet-5-5", sync: { deploymentId: "depl_1", agentVersion: 3 } },
      { key: "sales", model: "claude-sonnet-5-5", sync: { deploymentId: null } },
    ] } }),
  });
  const service = fakeRpc({
    ai_agent_runtime_scheduled_run_upsert_v1: () => ({ data: { runId: RUN_A, created: true } }),
    ai_agent_runtime_run_reserve_v1: (args) => { newRuns.push(args); return { data: { reserved: true, runId: RUN_C } }; },
    ai_agent_runtime_run_update_v1: () => ({ data: { ok: true } }),
    ai_agent_runtime_runs_open_v1: () => ({ data: [
      { runId: RUN_A, agentKey: "director", sessionId: "sesn_a", status: "running", startedAt: old, lastReconciledAt: null },
      { runId: RUN_B, agentKey: "director", sessionId: null, status: "starting", startedAt: old, lastReconciledAt: null },
      { runId: RUN_C, agentKey: "sales", sessionId: "sesn_t", status: "running", startedAt: old, lastReconciledAt: null },
    ] }),
  });
  const claude = fakeClaude({
    "GET /v1/deployment_runs": { data: [
      { id: "drun_1", deployment_id: "depl_1", session_id: "sesn_sched", error: null, created_at: t(1) },
      { id: "drun_2", deployment_id: "depl_1", session_id: null, error: { type: "session_rate_limited_error", message: "rate limited" }, created_at: t(2) },
    ] },
    "GET /v1/sessions/sesn_a": SESSION_DONE,
    "GET /v1/sessions/sesn_t": { id: "sesn_t", status: "terminated", usage: { input_tokens: 5, output_tokens: 1, list_cost: { amount: "3", currency: "USD" } } },
    "GET /v1/sessions/:s/events": (call) => ({
      data: call.queryAll.getAll("types[]").includes("agent.message")
        ? [{ type: "agent.message", id: "m", processed_at: t(5), content: [{ type: "text", text: "Итог недели." }] }]
        : [{ type: "session.status_idle", id: "i", processed_at: t(6), stop_reason: { type: "budget_reached" } }],
      next_page: null,
    }),
  });
  const { deps } = runtimeDeps({ claude, service, now: () => clock });
  const ctx = { staffClient: staff.client, actor: actor() };

  await reconcileAiAgentRuns(ctx, {}, deps);

  // Запуск по расписанию: найден по session_id, ошибка deployment_run — отдельная строка failed.
  const upsert = service.called("ai_agent_runtime_scheduled_run_upsert_v1");
  assert.deepEqual(upsert.map((call) => [call.args.p_key, call.args.p_session_id, call.args.p_started_at, call.args.p_status]), [["director", "sesn_sched", t(1), "running"]]);
  assert.equal(newRuns[0].p_dedupe_key, "drun:drun_2");
  assert.equal(newRuns[0].p_trigger_kind, "schedule");
  assert.equal(newRuns[0].p_agent_version, 3);

  // Закрытие открытых: idle + budget_reached → budget_reached с расходом и сводкой; нет сессии 10 минут → start_lost; terminated → failed.
  const byRun = service.called("ai_agent_runtime_run_update_v1").map((call) => [call.args.p_run_id, call.args.p_patch]);
  const patchFor = (runId) => byRun.filter(([id]) => id === runId).map(([, patch]) => patch);
  assert.equal(patchFor(RUN_A)[0].status, "budget_reached");
  assert.deepEqual([patchFor(RUN_A)[0].costCents, patchFor(RUN_A)[0].summary], [42, "Итог недели."]);
  assert.equal(patchFor(RUN_B)[0].errorCode, "start_lost");
  assert.equal(patchFor(RUN_B)[0].status, "failed");
  const dropped = byRun.find(([id, patch]) => id === RUN_C && patch.errorCode === "terminated");
  assert.ok(dropped, "terminated → failed");
  const failedSchedule = byRun.find(([, patch]) => patch.errorCode === "session_rate_limited_error");
  assert.deepEqual([failedSchedule[1].status, failedSchedule[1].errorMessage], ["failed", "rate limited"]);

  // Не чаще раза в 60 с: повтор сразу — ни одного вызова; через минуту — снова работает.
  const before = service.calls.length + claude.calls.length;
  await reconcileAiAgentRuns(ctx, {}, deps);
  assert.equal(service.calls.length + claude.calls.length, before);
  clock += 61_000;
  await reconcileAiAgentRuns(ctx, {}, deps);
  assert.ok(service.calls.length + claude.calls.length > before);
});

test("сверка: не бросает при сбоях и без ключа ничего не делает", async () => {
  resetAiAgentReconcileMemory();
  const service = fakeRpc({});
  const claude = fakeClaude({});
  const { deps } = runtimeDeps({ claude, service, noKey: true });
  const ctx = { staffClient: fakeRpc({}).client, actor: actor() };
  assert.equal(await reconcileAiAgentRuns(ctx, { key: "director" }, deps), undefined);
  assert.equal(service.calls.length + claude.calls.length, 0);
  const broken = runtimeDeps({ claude, service }).deps;
  assert.equal(await reconcileAiAgentRuns(ctx, { key: "sales" }, { ...broken, serviceClient: async () => { throw new Error("db down"); } }), undefined);
});

/* ------------------------------------------------------------------ черновики */

const DECISION = { draftId: DRAFT_ID, agentKey: "sales", channel: "portal", status: "approved", text: "Здравствуйте!", conversationId: null, studentCaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", approverMembershipId: STAFF_ID };

function draftSetup({ decide, service = {} } = {}) {
  const staff = fakeRpc({ ai_agents_draft_decide_v1: decide ?? (() => ({ data: DECISION })) });
  const serviceRpc = fakeRpc({
    ai_agent_runtime_portal_send_v1: () => ({ data: { messageId: "m1", sequenceId: 1 } }),
    ai_agent_runtime_draft_mark_v1: () => ({ data: { ok: true } }),
    ai_agent_runtime_draft_get_v1: () => ({ data: { id: DRAFT_ID, status: "sent", failureCode: null } }),
    ...service,
  });
  const claude = fakeClaude({});
  const { deps } = runtimeDeps({ claude, service: serviceRpc });
  return { staff, serviceRpc, deps, ctx: { staffClient: staff.client, actor: actor({ membershipId: STAFF_ID, systemRole: "staff" }) } };
}

test("черновик: отклонить — только решение базы, ничего не отправляется", async () => {
  const { staff, serviceRpc, deps, ctx } = draftSetup({ decide: () => ({ data: { ...DECISION, status: "discarded" } }) });
  assert.deepEqual(await decideAiAgentDraft(ctx, { draftId: DRAFT_ID, decision: "discard", requestId: REQ_ID }, deps), { ok: true, status: "discarded", failureCode: null });
  assert.deepEqual(staff.called("ai_agents_draft_decide_v1")[0].args, { p_organization_id: ORG, p_draft_id: DRAFT_ID, p_decision: "discard", p_edited_text: null, p_request_id: REQ_ID });
  assert.equal(serviceRpc.calls.length, 0);
});

test("черновик: одобрить для кабинета — запись в чат дела от утвердившего, итог sent; пропавшее дело — failed", async () => {
  const sent = draftSetup();
  assert.deepEqual(await decideAiAgentDraft(sent.ctx, { draftId: DRAFT_ID, decision: "approve", editedText: "Здравствуйте! Поправил текст.", requestId: REQ_ID }, sent.deps), { ok: true, status: "sent", failureCode: null });
  assert.equal(sent.staff.called("ai_agents_draft_decide_v1")[0].args.p_edited_text, "Здравствуйте! Поправил текст.");
  const call = sent.serviceRpc.called("ai_agent_runtime_portal_send_v1")[0].args;
  assert.deepEqual([call.p_organization_id, call.p_draft_id, call.p_sender_membership_id], [ORG, DRAFT_ID, STAFF_ID]);
  assert.notEqual(call.p_request_id, REQ_ID, "для записи в чат — свой детерминированный id шага");
  assert.equal(call.p_request_id, aiAgentSendStepId(DRAFT_ID, REQ_ID, "portal"));

  const gone = draftSetup({ service: { ai_agent_runtime_portal_send_v1: () => ({ error: { code: "P0002", message: "target_not_found" } }) } });
  assert.deepEqual(await decideAiAgentDraft(gone.ctx, { draftId: DRAFT_ID, decision: "approve", requestId: REQ_ID }, gone.deps), { ok: true, status: "failed", failureCode: "target_not_found" });
  const mark = gone.serviceRpc.called("ai_agent_runtime_draft_mark_v1")[0].args;
  assert.deepEqual([mark.p_status, mark.p_failure_code], ["failed", "target_not_found"]);

  const down = draftSetup({ service: { ai_agent_runtime_portal_send_v1: () => ({ error: { code: "XX000", message: "db" } }) } });
  const result = await decideAiAgentDraft(down.ctx, { draftId: DRAFT_ID, decision: "approve", requestId: REQ_ID }, down.deps);
  assert.deepEqual([result.ok, result.code], [false, "unavailable"]);
});

test("черновик: одобрить для WhatsApp — отправка общим путём, итог и код отказа берутся из базы", async () => {
  const calls = [];
  const whatsapp = { ...DECISION, channel: "whatsapp", conversationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", studentCaseId: null };
  const back = draftSetup({
    decide: () => ({ data: whatsapp }),
    service: { ai_agent_runtime_draft_get_v1: () => ({ data: { id: DRAFT_ID, status: "pending", failureCode: "whatsapp_unavailable" } }) },
  });
  const result = await decideAiAgentDraft(back.ctx, { draftId: DRAFT_ID, decision: "approve", requestId: REQ_ID }, back.deps, {
    sendWhatsApp: async (input) => { calls.push(input); return { status: "failed", failureCode: "whatsapp_unavailable" }; },
  });
  assert.deepEqual(result, { ok: true, status: "pending", failureCode: "whatsapp_unavailable" });
  assert.deepEqual(calls, [{ organizationId: ORG, draftId: DRAFT_ID, senderMembershipId: STAFF_ID, requestId: REQ_ID }]);

  const sent = draftSetup({ decide: () => ({ data: whatsapp }) });
  const ok = await decideAiAgentDraft(sent.ctx, { draftId: DRAFT_ID, decision: "approve", requestId: REQ_ID }, sent.deps, {
    sendWhatsApp: async () => ({ status: "sent", failureCode: null }),
  });
  assert.deepEqual(ok, { ok: true, status: "sent", failureCode: null });
});

test("черновик: отказы — не на рассмотрении, нет права, просмотр роли, плохой текст", async () => {
  const stale = draftSetup({ decide: () => ({ error: { code: "55000", message: "ai_agent_draft_not_pending" } }) });
  assert.equal((await decideAiAgentDraft(stale.ctx, { draftId: DRAFT_ID, decision: "approve", requestId: REQ_ID }, stale.deps)).code, "not_pending");
  const denied = draftSetup({ decide: () => ({ error: { code: "42501", message: "ai_agent_forbidden" } }) });
  assert.equal((await decideAiAgentDraft(denied.ctx, { draftId: DRAFT_ID, decision: "approve", requestId: REQ_ID }, denied.deps)).code, "forbidden");
  const base = draftSetup();
  for (const editedText of ["", "   ", "bad\u0000text", "x".repeat(8_001)]) {
    assert.equal((await decideAiAgentDraft(base.ctx, { draftId: DRAFT_ID, decision: "approve", editedText, requestId: REQ_ID }, base.deps)).code, "invalid_input");
  }
  assert.equal((await decideAiAgentDraft(base.ctx, { draftId: DRAFT_ID, decision: "discard", editedText: "x", requestId: REQ_ID }, base.deps)).code, "invalid_input");
  assert.equal((await decideAiAgentDraft(base.ctx, { draftId: "bad", decision: "approve", requestId: REQ_ID }, base.deps)).code, "invalid_input");
  assert.equal(base.staff.calls.length, 0);
  const preview = await decideAiAgentDraft({ ...base.ctx, actor: actor({ presentationRole: "sales" }) }, { draftId: DRAFT_ID, decision: "approve", requestId: REQ_ID }, base.deps);
  assert.equal(preview.code, "preview_read_only");
});

/* --------------------------------------------------------- отправка WhatsApp */

const U = (n) => `eeeeeeee-0000-4000-8000-00000000000${n}`;
const TEXT = "Здравствуйте! Подскажем по документам для Китая.";

function authorization(overrides = {}, text = TEXT) {
  return {
    authorized: true, replayed: false, organization_id: ORG, manual_send_authorization_id: U(1), communication_conversation_id: U(2),
    source_message_id: U(3), ai_draft_id: null, final_text: text, final_text_sha256: sha256(text), authorized_by_membership_id: STAFF_ID,
    state: "manual_send_authorized", requested_by_membership_id: STAFF_ID, work_item_id: U(4), work_state: "queued", queue_message_id: 17,
    business_key_sha256: sha256("business-key"), waha_readiness: "ready", waha_readiness_evidence_kind: "provider_observed",
    waha_readiness_fresh: true, waha_readiness_observed_at: NOW_ISO, ...overrides,
  };
}

function waSetup({ probe = "WORKING", authorize = () => ({ data: authorization() }), execute, mark } = {}) {
  const service = fakeRpc({
    ai_agent_runtime_whatsapp_authorize_v1: authorize,
    ai_agent_runtime_draft_mark_v1: mark ?? (() => ({ data: { ok: true } })),
  });
  const executed = [];
  const deps = {
    serviceClient: async () => service.client,
    probe: async () => probe,
    execute: execute ?? (async (_client, input) => { executed.push(input); return { status: "finished", result: { outcome: "succeeded", communicationMessageId: U(5), workItemId: U(4), attemptId: U(6), organizationId: ORG, providerIdentityPrivate: true } }; }),
    sleep: async () => {},
    now: () => NOW,
    log: () => {},
  };
  return { service, deps, executed };
}
const sendInput = { organizationId: ORG, draftId: DRAFT_ID, senderMembershipId: STAFF_ID, requestId: REQ_ID };
const marks = (service) => service.called("ai_agent_runtime_draft_mark_v1").map((call) => call.args);

test("whatsapp: сессия не WORKING — черновик возвращается в pending, авторизация не запрашивается", async () => {
  for (const probe of ["FAILED", "SCAN_QR_CODE", null]) {
    const { service, deps, executed } = waSetup({ probe });
    assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, deps), { status: "failed", failureCode: "whatsapp_unavailable" });
    assert.equal(service.called("ai_agent_runtime_whatsapp_authorize_v1").length, 0);
    assert.equal(executed.length, 0);
    assert.deepEqual(marks(service).map((mark) => [mark.p_status, mark.p_failure_code]), [["pending", "whatsapp_unavailable"]]);
  }
});

test("whatsapp: отказы базы переводятся в коды; чужие причины — unavailable; отправки нет", async () => {
  for (const [reason, code] of [
    ["whatsapp_unavailable", "whatsapp_unavailable"], ["conversation_moved_on", "conversation_moved_on"], ["conversation_closed", "conversation_closed"],
    ["rate_limited", "rate_limited"], ["staff_active", "staff_active"], ["sender_unavailable", "unavailable"], ["not_approved", "unavailable"],
  ]) {
    const { service, deps, executed } = waSetup({ authorize: () => ({ data: { authorized: false, reason } }) });
    assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, deps), { status: "failed", failureCode: code }, reason);
    assert.equal(executed.length, 0);
    assert.equal(marks(service).length, 0, "состояние черновика ведёт база");
  }
  const rpcDown = waSetup({ authorize: () => ({ error: { code: "XX000", message: "db" } }) });
  assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, rpcDown.deps), { status: "failed", failureCode: "unavailable" });
  const clientDown = waSetup();
  assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, { ...clientDown.deps, serviceClient: async () => { throw new Error("boom"); } }), { status: "failed", failureCode: "unavailable" });
});

test("whatsapp: успех — claim/finish с детерминированными id, итог sent с отправителем и квитанцией без текста", async () => {
  const { service, deps, executed } = waSetup();
  assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, deps), { status: "sent", failureCode: null });
  const authorize = service.called("ai_agent_runtime_whatsapp_authorize_v1")[0].args;
  assert.deepEqual(
    [authorize.p_organization_id, authorize.p_draft_id, authorize.p_sender_membership_id, authorize.p_provider_status],
    [ORG, DRAFT_ID, STAFF_ID, "WORKING"],
  );
  assert.equal(authorize.p_request_id, aiAgentSendStepId(DRAFT_ID, REQ_ID, "authorize"));
  assert.equal(executed.length, 1);
  assert.equal(executed[0].authorization.finalText, TEXT);
  assert.equal(executed[0].authorization.workItemId, U(4));
  assert.equal(executed[0].claimRequestId, aiAgentSendStepId(DRAFT_ID, REQ_ID, "claim"));
  assert.equal(executed[0].completionRequestId, aiAgentSendStepId(DRAFT_ID, REQ_ID, "complete"));
  assert.notEqual(executed[0].claimRequestId, executed[0].completionRequestId);
  const [mark] = marks(service);
  assert.deepEqual([mark.p_status, mark.p_failure_code, mark.p_sent_by_membership_id], ["sent", null, STAFF_ID]);
  assert.deepEqual(mark.p_provider, { messageId: U(5), authorizationId: U(1), workItemId: U(4) });
  assert.ok(!JSON.stringify(mark).includes(TEXT), "текст сообщения в квитанции не хранится");

  // Повтор того же запроса — те же id шагов (claim второй раз работу не возьмёт).
  const again = waSetup();
  await sendAiAgentWhatsAppDraft(sendInput, again.deps);
  assert.equal(again.executed[0].claimRequestId, executed[0].claimRequestId);
});

test("whatsapp: ошибка провайдера, неизвестный итог и сбой во время отправки", async () => {
  const finished = (outcome) => async () => ({ status: "finished", result: { outcome, communicationMessageId: null, workItemId: U(4), attemptId: U(6), organizationId: ORG, providerIdentityPrivate: true } });

  const terminal = waSetup({ execute: finished("terminal_error") });
  assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, terminal.deps), { status: "failed", failureCode: "provider_error" });
  assert.deepEqual(marks(terminal.service).map((mark) => [mark.p_status, mark.p_failure_code]), [["failed", "provider_error"]]);

  const unknown = waSetup({ execute: finished("unknown_result") });
  assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, unknown.deps), { status: "unknown", failureCode: "unknown_result" });
  assert.deepEqual(marks(unknown.service).map((mark) => [mark.p_status, mark.p_failure_code]), [["failed", "unknown_result"]]);

  const thrown = waSetup({ execute: async () => { throw new Error("finish failed"); } });
  assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, thrown.deps), { status: "unknown", failureCode: "unknown_result" });
  assert.deepEqual(marks(thrown.service).map((mark) => [mark.p_status, mark.p_failure_code]), [["failed", "unknown_result"]]);

  // Работу уже взял другой запрос: итог за ним, черновик не трогаем.
  const claimed = waSetup({ execute: async () => ({ status: "not_claimed", workItemId: U(4) }) });
  assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, claimed.deps), { status: "unknown", failureCode: "unknown_result" });
  assert.equal(marks(claimed.service).length, 0);

  // Сообщение ушло, а запись итога не удалась — результат всё равно «отправлено».
  const lost = waSetup({ mark: () => ({ error: { code: "XX000", message: "db" } }) });
  assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, lost.deps), { status: "sent", failureCode: null });
});

test("whatsapp: ответ базы с чужим текстом, организацией или лишней формой — в WhatsApp ничего не уходит", async () => {
  const bad = [
    authorization({ final_text: "Подменённый текст" }),
    authorization({ organization_id: "ffffffff-0000-4000-8000-000000000000" }),
    authorization({ ai_draft_id: U(9) }),
    authorization({ waha_readiness: "not_ready" }),
    authorization({ requested_by_membership_id: ADMIN_ID }),
    authorization({ work_state: "claimed" }),
    authorization({ queue_message_id: "x" }),
    authorization({}, "я".repeat(4_001)),
    { authorized: true },
    "authorized",
  ];
  for (const data of bad) {
    const { deps, executed } = waSetup({ authorize: () => ({ data }) });
    assert.deepEqual(await sendAiAgentWhatsAppDraft(sendInput, deps), { status: "failed", failureCode: "unavailable" });
    assert.equal(executed.length, 0);
  }
  // Повтор уже начатой отправки: состояние работы любое, текст и хеш по-прежнему сверяются.
  const replay = parseAiAgentWhatsAppAuthorization(authorization({ replayed: true, work_state: "claimed" }), { organizationId: ORG, observedAt: NOW_ISO });
  assert.equal(replay.kind, "authorized");
  assert.equal(replay.replayed, true);
  assert.equal(replay.authorization.workState, "queued");
});
