import "server-only";

import { createHash } from "node:crypto";

import { effectiveAiAgentInstructions, buildAiAgentSystemPrompt } from "../../../content/ai-agents/index.ts";
import {
  AI_AGENT_DISABLED_BUILTIN_TOOLS,
  AI_AGENTS_CLAUDE_MCP_SERVER_NAME,
  AI_AGENT_RUNTIME_RPC,
  ANTHROPIC_API,
  isAiAgentKey,
  isAiAgentModelId,
  type AiAgentKey,
  type AiAgentModelId,
  type AiAgentSyncResult,
} from "../../ai-agents/contract.ts";
import { isStaffPreview } from "../../platform-access.ts";
import { AnthropicApiError, type AnthropicClient, type AnthropicJson } from "./anthropic.ts";
import { computeAiAgentConfigHash, effectiveAiAgentSchedulePrompt, resolveAiAgentsMcpUrl } from "./config-hash.ts";
import {
  callRpc,
  isRecord,
  numberOr,
  resolveDeps,
  stringOrNull,
  truncate,
  UUID_PATTERN,
  type AiAgentsRuntimeDeps,
  type AiAgentsStaffContext,
  type RpcOutcome,
  type ServiceClient,
} from "./deps.ts";
import { mcpHost, sessionBudget } from "./env.ts";
import { userMessageEvent } from "./runs.ts";

/*
 * Синхронизация агента с Claude (контракт §C.2.1): среда → vault и токен MCP →
 * агент → расписание. Идемпотентна: каждое полученное id сразу пишется в БД
 * (`sync_record_v1`), повтор достраивает недостающее. Токен MCP нигде не
 * логируется и не возвращается: он уходит только в vault Claude (write-only);
 * в БД остаётся SHA-256.
 */

export const AI_AGENTS_ENVIRONMENT_NAME = "evo-crm-agents";

const inFlight = new Set<string>();

/** Сколько ждать чужую аренду среды: 30 опросов раз в 2 секунды (аренда в БД живёт 3 минуты). */
const ENVIRONMENT_WAIT_ATTEMPTS = 30;
const ENVIRONMENT_WAIT_MAX_MS = 5_000;
const ENVIRONMENT_BUSY_MESSAGE = "Среду Claude сейчас создаёт другая синхронизация. Повторите через минуту";

/** Аренда среды занята дольше, чем мы готовы ждать: синхронизация не ошибка Claude, а конфликт. */
class EnvironmentBusy extends Error {}

type AgentRuntimeConfig = Readonly<{
  title: string;
  roleLine: string;
  model: AiAgentModelId;
  instructionsOverride: string | null;
  scheduleCron: string | null;
  scheduleTz: string;
  schedulePromptOverride: string | null;
  enabled: boolean;
  runBudgetUsd: number;
  claudeAgentId: string | null;
  environmentId: string | null;
  vaultId: string | null;
  credentialId: string | null;
  deploymentId: string | null;
  mcpUrl: string | null;
}>;

/** Конфигурация из `ai_agent_runtime_get_v1`: плоские поля, а при их отсутствии — из вложенного `sync`. */
export function parseRuntimeConfig(data: unknown): AgentRuntimeConfig | null {
  if (!isRecord(data)) return null;
  const sync = isRecord(data.sync) ? data.sync : {};
  const pick = (flat: string, nested = flat): string | null => stringOrNull(data[flat]) ?? stringOrNull(sync[nested]);
  const title = stringOrNull(data.title);
  const model = data.model;
  if (!title || !isAiAgentModelId(model)) return null;
  return {
    title,
    roleLine: stringOrNull(data.roleLine) ?? title,
    model,
    instructionsOverride: stringOrNull(data.instructionsOverride),
    scheduleCron: stringOrNull(data.scheduleCron),
    scheduleTz: stringOrNull(data.scheduleTz) ?? "Asia/Bishkek",
    schedulePromptOverride: stringOrNull(data.schedulePromptOverride),
    enabled: data.enabled === true,
    runBudgetUsd: numberOr(data.runBudgetUsd, 5),
    claudeAgentId: pick("claudeAgentId"),
    environmentId: pick("environmentId"),
    vaultId: pick("vaultId"),
    credentialId: pick("credentialId"),
    deploymentId: pick("deploymentId"),
    mcpUrl: pick("mcpUrl"),
  };
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "")}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const isStatus = (error: unknown, ...statuses: number[]): boolean =>
  error instanceof AnthropicApiError && statuses.includes(error.status);

function bad(code: Extract<AiAgentSyncResult, { ok: false }>["code"], message: string): AiAgentSyncResult {
  return { ok: false, code, message };
}

function describeAnthropicError(error: AnthropicApiError): string {
  if (error.status === 401 || error.status === 403) return "Claude отклонил ключ API — проверьте EVO_ANTHROPIC_API_KEY";
  if (error.status === 429) return "Claude ограничил число запросов — повторите через минуту";
  return `Claude вернул ошибку: ${truncate(error.message, 200)}`;
}

/** Среда с именем `evo-crm-agents` в Claude: находится по имени среди неархивных, иначе создаётся. */
async function findOrCreateEnvironment(
  anthropic: AnthropicClient, mcpUrl: string,
): Promise<Readonly<{ id: string; created: boolean }>> {
  const existing = (await anthropic.environments.list()).find((item) => item.name === AI_AGENTS_ENVIRONMENT_NAME && !item.archived_at);
  const existingId = existing ? stringOrNull(existing.id) : null;
  if (existingId) return { id: existingId, created: false };
  const made = await anthropic.environments.create({
    name: AI_AGENTS_ENVIRONMENT_NAME,
    config: {
      type: "cloud",
      networking: { type: "limited", allowed_hosts: [mcpHost(mcpUrl)], allow_mcp_servers: true },
    },
  });
  const madeId = stringOrNull(made.id);
  if (!madeId) throw new AnthropicApiError(502, "invalid_response", "Claude API не вернул id среды");
  return { id: madeId, created: true };
}

const isMissingRpc = (outcome: Extract<RpcOutcome, { ok: false }>): boolean =>
  outcome.code === "PGRST202" || outcome.code === "42883";

/**
 * Среда одна на организацию (контракт §C.2.1). Две синхронизации разных агентов не должны создать две:
 * находит или создаёт её только держатель аренды в БД (`environment_claim_v1`, миграция 318), остальные ждут
 * и берут записанную им среду. Найденный id записывается в строку агента ДО снятия аренды — следующий
 * увидит его как `known`. Без миграции 318 (PGRST202) — прежний путь без аренды.
 */
async function resolveSharedEnvironment(args: Readonly<{
  client: ServiceClient;
  anthropic: AnthropicClient;
  deps: AiAgentsRuntimeDeps;
  organizationId: string;
  key: AiAgentKey;
  mcpUrl: string;
  record: (result: Record<string, unknown>) => Promise<RpcOutcome>;
}>): Promise<Readonly<{ id: string; created: boolean }>> {
  const { client, anthropic, deps, organizationId, key, mcpUrl, record } = args;
  for (let attempt = 0; attempt < ENVIRONMENT_WAIT_ATTEMPTS; attempt += 1) {
    const claim = await callRpc(client, AI_AGENT_RUNTIME_RPC.environmentClaim, { p_organization_id: organizationId, p_key: key });
    if (!claim.ok) {
      if (!isMissingRpc(claim)) throw new Error("environment_claim_failed");
      const found = await findOrCreateEnvironment(anthropic, mcpUrl);
      await record({ status: "pending", environmentId: found.id });
      return found;
    }
    const data = isRecord(claim.data) ? claim.data : {};
    const knownId = data.status === "known" ? stringOrNull(data.environmentId) : null;
    if (knownId) {
      await record({ status: "pending", environmentId: knownId });
      return { id: knownId, created: false };
    }
    const token = data.status === "claimed" ? stringOrNull(data.claimToken) : null;
    if (token) {
      try {
        const found = await findOrCreateEnvironment(anthropic, mcpUrl);
        // Следующий держатель аренды увидит среду только если она записана: иначе он создал бы вторую.
        const recorded = await record({ status: "pending", environmentId: found.id });
        if (!recorded.ok) throw new Error("environment_record_failed");
        return found;
      } finally {
        await callRpc(client, AI_AGENT_RUNTIME_RPC.environmentRelease, { p_organization_id: organizationId, p_claim_token: token });
      }
    }
    if (data.status !== "busy") throw new Error("environment_claim_invalid");
    await deps.sleep(Math.min(ENVIRONMENT_WAIT_MAX_MS, Math.max(1, numberOr(data.retryAfterSeconds, 2)) * 1_000));
  }
  throw new EnvironmentBusy(ENVIRONMENT_BUSY_MESSAGE);
}

/**
 * Ранее созданный объект Claude с тем же `metadata.evo_agent_key` (агент или хранилище): список Claude
 * не фильтруется по метаданным, поэтому читается постранично. Нужен, чтобы потерянный ответ на создание
 * (сеть, тайм-аут, сбой записи id в БД) не породил второго агента или второе хранилище при повторной
 * синхронизации. Несколько кандидатов — берётся самый ранний, остальные оставлены как есть.
 */
function pickByAgentKey(items: readonly AnthropicJson[], key: AiAgentKey): Readonly<{ item: AnthropicJson; extra: number }> | null {
  const matches = items.filter((item) => !item.archived_at && isRecord(item.metadata) && item.metadata.evo_agent_key === key
    && stringOrNull(item.id) !== null);
  if (matches.length === 0) return null;
  const created = (item: AnthropicJson): number => {
    const at = typeof item.created_at === "string" ? Date.parse(item.created_at) : NaN;
    return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
  };
  const earliest = matches.reduce((best, item) => (created(item) < created(best) ? item : best));
  return { item: earliest, extra: matches.length - 1 };
}

/** Создаёт или обновляет агента Claude; обновление — по версии, одна повторная попытка при 409. */
async function upsertAgent(
  anthropic: AnthropicClient, existingId: string | null, body: AnthropicJson, warnings: string[], key: AiAgentKey,
): Promise<Readonly<{ id: string; version: number; created: boolean }>> {
  let id = existingId;
  let adopted = false;
  if (!id) {
    const found = pickByAgentKey(await anthropic.agents.list(), key);
    if (found) {
      id = stringOrNull(found.item.id);
      adopted = id !== null;
      if (adopted) {
        warnings.push("Агент с этим ключом уже был в Claude — подключён, заново не создан");
        if (found.extra > 0) warnings.push("В Claude есть лишние агенты с тем же ключом — лишних архивируйте в Claude Console");
      }
    }
  }
  if (id) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let current: AnthropicJson;
      try {
        current = await anthropic.agents.get(id);
      } catch (error) {
        if (isStatus(error, 404)) {
          id = null;
          if (!adopted) warnings.push("Прежний агент не найден в Claude — создан новый");
          break;
        }
        throw error;
      }
      if (current.archived_at) {
        id = null;
        if (!adopted) warnings.push("Прежний агент в Claude архивирован — создан новый");
        break;
      }
      try {
        const updated = await anthropic.agents.update(id, { ...body, version: numberOr(current.version, 1) });
        return { id, version: numberOr(updated.version, numberOr(current.version, 1)), created: false };
      } catch (error) {
        if (isStatus(error, 409) && attempt === 0) continue;
        throw error;
      }
    }
  }
  const created = await anthropic.agents.create(body);
  const newId = stringOrNull(created.id);
  if (!newId) throw new AnthropicApiError(502, "invalid_response", "Claude API не вернул id агента");
  return { id: newId, version: numberOr(created.version, 1), created: true };
}

/** Хранилище агента: найденное по `metadata.evo_agent_key` или новое. */
async function findOrCreateVault(
  anthropic: AnthropicClient, key: AiAgentKey, warnings: string[],
): Promise<Readonly<{ id: string; created: boolean }>> {
  const found = pickByAgentKey(await anthropic.vaults.list(), key);
  const foundId = found ? stringOrNull(found.item.id) : null;
  if (found && foundId) {
    warnings.push("Хранилище токена с этим ключом уже было в Claude — подключено, заново не создано");
    if (found.extra > 0) warnings.push("В Claude есть лишние хранилища с тем же ключом — лишние архивируйте в Claude Console");
    return { id: foundId, created: false };
  }
  const vault = await anthropic.vaults.create({ display_name: `EVO CRM · ${key}`, metadata: { evo_agent_key: key } });
  const vaultId = stringOrNull(vault.id);
  if (!vaultId) throw new AnthropicApiError(502, "invalid_response", "Claude API не вернул id хранилища");
  return { id: vaultId, created: true };
}

/** Новый креденшл `static_bearer`; если адрес уже занят (409) — находит его и обновляет токен. */
async function createOrAdoptCredential(
  anthropic: AnthropicClient, vaultId: string, mcpUrl: string, token: string,
): Promise<string> {
  try {
    const created = await anthropic.vaults.credentials.create(vaultId, {
      display_name: "EVO CRM MCP",
      auth: { type: "static_bearer", mcp_server_url: mcpUrl, token },
    });
    const id = stringOrNull(created.id);
    if (!id) throw new AnthropicApiError(502, "invalid_response", "Claude API не вернул id креденшла");
    return id;
  } catch (error) {
    if (!isStatus(error, 409)) throw error;
    const wanted = normalizeUrl(mcpUrl);
    const list = await anthropic.vaults.credentials.list(vaultId);
    const found = list.find((item) => {
      const auth = isRecord(item.auth) ? item.auth : {};
      const url = stringOrNull(auth.mcp_server_url) ?? stringOrNull(item.mcp_server_url);
      return !item.archived_at && url !== null && normalizeUrl(url) === wanted;
    });
    const foundId = found ? stringOrNull(found.id) : null;
    if (!foundId) throw error;
    await anthropic.vaults.credentials.update(vaultId, foundId, { auth: { type: "static_bearer", token } });
    return foundId;
  }
}

export async function syncAiAgentImpl(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ key: AiAgentKey; rotateToken?: boolean; requestId: string }>,
  overrides?: Partial<AiAgentsRuntimeDeps>,
): Promise<AiAgentSyncResult> {
  if (isStaffPreview(ctx.actor)) return bad("preview_read_only", "В режиме просмотра роли синхронизация недоступна");
  if (ctx.actor.systemRole !== "admin") return bad("forbidden", "Синхронизировать агентов с Claude может только системный администратор");
  if (!isAiAgentKey(input.key) || !UUID_PATTERN.test(input.requestId)) return bad("unavailable", "Неизвестный агент");
  const deps = resolveDeps(overrides);
  const anthropic = deps.anthropic();
  if (!anthropic) return bad("api_key_missing", "Ключ Claude API не задан (EVO_ANTHROPIC_API_KEY)");
  let mcpUrl: string;
  try {
    mcpUrl = resolveAiAgentsMcpUrl(deps.env());
  } catch {
    return bad("unavailable", "Адрес MCP в настройках приложения некорректен (EVO_AI_AGENTS_MCP_URL)");
  }
  const scope = `${ctx.actor.organizationId}:${input.key}`;
  if (inFlight.has(scope)) return bad("conflict", "Синхронизация этого агента уже идёт");
  inFlight.add(scope);
  try {
    return await runSync(ctx, input, deps, anthropic, mcpUrl);
  } finally {
    inFlight.delete(scope);
  }
}

async function runSync(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ key: AiAgentKey; rotateToken?: boolean; requestId: string }>,
  deps: AiAgentsRuntimeDeps,
  anthropic: AnthropicClient,
  mcpUrl: string,
): Promise<AiAgentSyncResult> {
  const organizationId = ctx.actor.organizationId;
  const key = input.key;
  let client: ServiceClient;
  let config: AgentRuntimeConfig;
  try {
    client = await deps.serviceClient();
    const loaded = await callRpc(client, AI_AGENT_RUNTIME_RPC.get, { p_organization_id: organizationId, p_key: key });
    const parsed = loaded.ok ? parseRuntimeConfig(loaded.data) : null;
    if (!parsed) return bad("unavailable", "Не удалось прочитать настройки агента");
    config = parsed;
  } catch {
    return bad("unavailable", "Сервис временно недоступен. Повторите позже");
  }
  if (!effectiveAiAgentInstructions(key, config.instructionsOverride).trim()) {
    return bad("instructions_empty", "У агента нет инструкции. Добавьте её в настройках и повторите");
  }

  const record = (result: Record<string, unknown>) =>
    callRpc(client, AI_AGENT_RUNTIME_RPC.syncRecord, {
      p_organization_id: organizationId,
      p_key: key,
      p_actor_membership_id: ctx.actor.membershipId,
      p_result: result,
    });

  const warnings: string[] = [];
  const created = { agent: false, environment: false, vault: false, deployment: false };
  let tokenRotated = false;
  let tokenStaged = false;
  try {
    await record({ status: "pending" });

    // 1. Среда: одна на все агенты (под арендой в БД), сеть ограничена хостом MCP.
    let environmentId = config.environmentId;
    if (!environmentId) {
      const shared = await resolveSharedEnvironment({ client, anthropic, deps, organizationId, key, mcpUrl, record });
      environmentId = shared.id;
      created.environment = shared.created;
    } else if (config.mcpUrl && normalizeUrl(config.mcpUrl) !== normalizeUrl(mcpUrl)) {
      warnings.push("Адрес MCP изменился: проверьте список разрешённых хостов среды evo-crm-agents в Claude Console");
    }

    // 2. Vault агента.
    let vaultId = config.vaultId;
    if (!vaultId) {
      const vault = await findOrCreateVault(anthropic, key, warnings);
      vaultId = vault.id;
      created.vault = vault.created;
      await record({ status: "pending", vaultId });
    }

    // 3. Токен MCP: новый нужен без креденшла, по запросу или при смене адреса.
    let credentialId = config.credentialId;
    const urlChanged = config.mcpUrl !== null && normalizeUrl(config.mcpUrl) !== normalizeUrl(mcpUrl);
    if (!credentialId || input.rotateToken === true || urlChanged) {
      const token = Buffer.from(deps.randomBytes(32)).toString("base64url");
      const staged = await callRpc(client, AI_AGENT_RUNTIME_RPC.tokenSet, {
        p_organization_id: organizationId,
        p_key: key,
        p_actor_membership_id: ctx.actor.membershipId,
        p_new_sha256: sha256Hex(token),
        p_mode: "stage",
      });
      if (!staged.ok) throw new Error("token_stage_failed");
      tokenStaged = true;
      const previousCredentialId = credentialId;
      if (!credentialId) {
        credentialId = await createOrAdoptCredential(anthropic, vaultId, mcpUrl, token);
      } else if (!urlChanged) {
        await anthropic.vaults.credentials.update(vaultId, credentialId, { auth: { type: "static_bearer", token } });
      } else {
        // Адрес креденшла неизменяем: новый создаётся первым, старый архивируется после.
        credentialId = await createOrAdoptCredential(anthropic, vaultId, mcpUrl, token);
        if (previousCredentialId && previousCredentialId !== credentialId) {
          await anthropic.vaults.credentials.archive(vaultId, previousCredentialId)
            .catch(() => { warnings.push("Прежний креденшл MCP не удалось заархивировать — сделайте это в Claude Console"); });
        }
      }
      tokenStaged = false;
      tokenRotated = true;
      await record({ status: "pending", credentialId, mcpUrl });
    }

    // 4. Агент.
    const configHash = computeAiAgentConfigHash({
      key,
      title: config.title,
      model: config.model,
      instructionsOverride: config.instructionsOverride,
      scheduleCron: config.scheduleCron,
      scheduleTz: config.scheduleTz,
      schedulePromptOverride: config.schedulePromptOverride,
      enabled: config.enabled,
      mcpUrl,
    });
    const permission = { permission_policy: { type: "always_allow" } };
    const agent = await upsertAgent(anthropic, config.claudeAgentId, {
      name: config.title,
      description: config.roleLine,
      model: { id: config.model },
      system: buildAiAgentSystemPrompt(key, config.instructionsOverride),
      mcp_servers: [{ type: "url", name: AI_AGENTS_CLAUDE_MCP_SERVER_NAME, url: mcpUrl }],
      tools: [
        // Интернета у агентов нет (решение владельца 24.10.2026): web_search и web_fetch выключены поштучно,
        // остальной набор (bash и файловые инструменты) работает: platform.claude.com/docs/en/managed-agents/tools.
        {
          type: ANTHROPIC_API.agentToolset,
          default_config: permission,
          configs: AI_AGENT_DISABLED_BUILTIN_TOOLS.map((name) => ({ name, enabled: false })),
        },
        { type: "mcp_toolset", mcp_server_name: AI_AGENTS_CLAUDE_MCP_SERVER_NAME, default_config: permission },
      ],
      metadata: { evo_agent_key: key, evo_config_hash: configHash },
    }, warnings, key);
    created.agent = agent.created;
    await record({ status: "pending", claudeAgentId: agent.id, agentVersion: agent.version });

    // 5. Расписание: нужен deployment, пока агент включён и cron задан.
    let deploymentId = config.deploymentId;
    const wantsSchedule = config.enabled && config.scheduleCron !== null;
    const prompt = effectiveAiAgentSchedulePrompt(key, config.schedulePromptOverride);
    if (wantsSchedule && !prompt) warnings.push("Для расписания нет текста поручения — расписание не создано");
    if (wantsSchedule && prompt) {
      const budget = sessionBudget(config.runBudgetUsd);
      const body: AnthropicJson = {
        name: truncate(`EVO · ${config.title}`, 120),
        agent: agent.id,
        environment_id: environmentId,
        vault_ids: [vaultId],
        initial_events: [userMessageEvent(prompt)],
        schedule: { type: "cron", expression: config.scheduleCron, timezone: config.scheduleTz },
      };
      let deployment: AnthropicJson | null = null;
      if (deploymentId) {
        try {
          deployment = await anthropic.deployments.update(deploymentId, { ...body, budget: budget ?? null });
        } catch (error) {
          if (!isStatus(error, 404)) throw error;
          deploymentId = null;
        }
      }
      if (!deployment) {
        deployment = await anthropic.deployments.create(budget ? { ...body, budget } : body);
        created.deployment = true;
      }
      deploymentId = stringOrNull(deployment.id) ?? deploymentId;
      if (!deploymentId) throw new AnthropicApiError(502, "invalid_response", "Claude API не вернул id расписания");
      if (deployment.status === "paused") await anthropic.deployments.unpause(deploymentId);
      await record({ status: "pending", deploymentId });
    } else if (deploymentId) {
      // Агент выключен или расписание убрано: запуски по cron прекращаются.
      await anthropic.deployments.pause(deploymentId).catch((error: unknown) => {
        if (!isStatus(error, 400, 404, 409)) throw error;
      });
    }

    // 6. Готово: конфигурация, которую видит Claude, записана хешем.
    const finished = await record({
      status: "ok",
      claudeAgentId: agent.id,
      agentVersion: agent.version,
      environmentId,
      vaultId,
      credentialId,
      ...(deploymentId ? { deploymentId } : {}),
      mcpUrl,
      configHash,
    });
    if (!finished.ok) throw new Error("sync_record_failed");
    deps.log({ op: "sync", status: "ok", agent: key, token_rotated: tokenRotated });
    return {
      ok: true,
      syncedAt: new Date(deps.now()).toISOString(),
      agentVersion: agent.version,
      tokenRotated,
      created,
      warnings,
    };
  } catch (error) {
    if (tokenStaged) {
      await callRpc(client, AI_AGENT_RUNTIME_RPC.tokenSet, {
        p_organization_id: organizationId,
        p_key: key,
        p_actor_membership_id: ctx.actor.membershipId,
        p_new_sha256: null,
        p_mode: "restore",
      }).catch(() => undefined);
    }
    if (error instanceof EnvironmentBusy) {
      await record({ status: "error", error: ENVIRONMENT_BUSY_MESSAGE }).catch(() => undefined);
      deps.log({ op: "sync", status: "error", agent: key, reason: "environment_busy" });
      return bad("conflict", ENVIRONMENT_BUSY_MESSAGE);
    }
    const anthropicError = error instanceof AnthropicApiError ? error : null;
    const reason = anthropicError
      ? `${anthropicError.type}${anthropicError.requestId ? ` [request-id ${anthropicError.requestId}]` : ""}: ${anthropicError.message}`
      : "ошибка CRM при синхронизации";
    await record({ status: "error", error: truncate(reason.replace(/\s+/gu, " "), 300) }).catch(() => undefined);
    deps.log({
      op: "sync", status: "error", agent: key, http: anthropicError?.status ?? null,
      ...(anthropicError?.requestId ? { request_id: anthropicError.requestId } : {}),
    });
    return anthropicError
      ? bad("anthropic_error", describeAnthropicError(anthropicError))
      : bad("unavailable", "Не удалось завершить синхронизацию. Повторите позже");
  }
}
