import "server-only";

import { closeSync, openSync, statSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AI_AGENT_KEYS, AI_AGENT_RUNTIME_RPC, type AiAgentKey } from "../../ai-agents/contract.ts";
import { AnthropicApiError } from "./anthropic.ts";
import {
  callRpc,
  isRecord,
  numberOr,
  resolveDeps,
  stringOrNull,
  type AiAgentsRuntimeDeps,
  type ServiceClient,
} from "./deps.ts";
import { readOrganizationId } from "./env.ts";
import {
  anthropicRequestIdField,
  closeOpenAiAgentRunsDetailed,
  recordPausedDeployment,
  syncDeploymentRuns,
  type DeploymentTarget,
} from "./runs.ts";

/*
 * Фоновая сверка ИИ-агентов с Claude (аудит 24.10.2026, пункт 8). Раньше статусы и расход запусков обновлялись
 * только когда кто-то открывал страницу раздела, а запуски расписания читались одной страницей из 20.
 * Запускается раз в ~5 минут таймером systemd на хосте: `docker exec evo-crm-app-1 node /app/ai-agents-maintenance.mjs`
 * (как телефония: scripts/ai-agents-maintenance.mjs → .next/ai-agents-maintenance.mjs, docs/runbooks/ai-agents-managed.md).
 *
 * Один проход:
 *  1. без ключа Claude API ничего не делает (раздел выключен);
 *  2. один проход за раз: файл-замок в /tmp контейнера (старше 6 минут считается брошенным);
 *  3. читает настройки всех агентов из БД (service_role) и для каждого расписания Claude (deployment) постранично
 *     читает его запуски за последние 8 суток: запуск с сессией становится строкой «Запусков», запуск, который
 *     Claude не создал, — строкой `failed`. Повтор безопасен: строки ищутся по id сессии и по ключу `drun:<id>`;
 *  4. расписание, которому положено работать (агент включён, cron задан), но которое стоит на паузе в Claude,
 *     записывается в «Запуски» одной строкой `failed` (`deployment_paused`). Пауза НЕ снимается автоматически:
 *     её снимает только осознанное «Синхронизировать с Claude»;
 *  5. закрывает открытые запуски по состоянию сессии (расход и итог попадают в CRM без открытия страницы).
 * Проход ограничен по времени (150 с, жёсткий предел — в точке входа), не бросает: итог — отчёт. В журнале только
 * счётчики и фиксированные слова: ни текстов, ни ключей, ни данных клиентов.
 */

type LogValue = string | number | boolean;

export type AiAgentsMaintenanceOptions = Readonly<{
  lockPath: string;
  /** После этого времени новые шаги не начинаются (один вызов Claude с повторами занимает до ~1 минуты). */
  runBudgetMs: number;
  /** Насколько глубоко читать запуски расписания (недельный отчёт директора укладывается с запасом). */
  deploymentRunsLookbackMs: number;
  deploymentRunsPageLimit: number;
  deploymentRunsMaxPages: number;
  openRunsLimit: number;
}>;

export type AiAgentsMaintenanceReport = Readonly<{
  /** 1 — база или Claude дали сбой на этом проходе (записано в `log`); отключённый раздел и пропуск — 0. */
  exitCode: 0 | 1;
  log: Readonly<Record<string, LogValue>>;
}>;

const LOCK_STALE_MS = 6 * 60_000;

export function defaultAiAgentsMaintenanceOptions(): AiAgentsMaintenanceOptions {
  return {
    lockPath: join(tmpdir(), "evo-ai-agents-maintenance.lock"),
    runBudgetMs: 150_000,
    deploymentRunsLookbackMs: 8 * 24 * 60 * 60 * 1_000,
    deploymentRunsPageLimit: 100,
    deploymentRunsMaxPages: 5,
    openRunsLimit: 100,
  };
}

/** Замок «один проход за раз»: `O_EXCL`-файл; брошенный (старше `LOCK_STALE_MS`) снимается. Возвращает снятие или null. */
function acquireLock(path: string, nowMs: number): (() => void) | null {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      try {
        writeSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          unlinkSync(path);
        } catch {
          // замок уже снят
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let ageMs = 0;
      try {
        ageMs = nowMs - statSync(path).mtimeMs;
      } catch {
        continue; // замок исчез между попытками: пробуем ещё раз
      }
      if (ageMs <= LOCK_STALE_MS) return null;
      try {
        unlinkSync(path);
      } catch {
        return null;
      }
    }
  }
  return null;
}

type AgentInfo = Readonly<{
  key: AiAgentKey;
  enabled: boolean;
  scheduleCron: string | null;
  deploymentId: string | null;
  model: string | null;
  agentVersion: number | null;
  syncStatus: string | null;
}>;

/** Ответ `ai_agent_runtime_get_v1`: плоские поля, при их отсутствии — из вложенного `sync`. */
function parseAgentInfo(key: AiAgentKey, data: unknown): AgentInfo | null {
  if (!isRecord(data)) return null;
  const sync = isRecord(data.sync) ? data.sync : {};
  const version = numberOr(data.claudeAgentVersion, numberOr(sync.agentVersion, NaN));
  return {
    key,
    enabled: data.enabled === true,
    scheduleCron: stringOrNull(data.scheduleCron),
    deploymentId: stringOrNull(data.deploymentId) ?? stringOrNull(sync.deploymentId),
    model: stringOrNull(data.model),
    agentVersion: Number.isFinite(version) && version > 0 ? Math.floor(version) : null,
    syncStatus: stringOrNull(data.syncStatus) ?? stringOrNull(sync.status),
  };
}

const isNotFound = (error: unknown): boolean => error instanceof AnthropicApiError && error.status === 404;

/** Один проход. Не бросает: итог — отчёт. */
export async function runAiAgentsMaintenance(
  overrides?: Partial<AiAgentsRuntimeDeps>,
  optionOverrides?: Partial<AiAgentsMaintenanceOptions>,
): Promise<AiAgentsMaintenanceReport> {
  const log: Record<string, LogValue> = { event: "ai_agents_maintenance" };
  const options: AiAgentsMaintenanceOptions = { ...defaultAiAgentsMaintenanceOptions(), ...optionOverrides };
  const done = (exitCode: 0 | 1): AiAgentsMaintenanceReport => Object.freeze({ exitCode, log });

  let deps: AiAgentsRuntimeDeps;
  let release: (() => void) | null = null;
  try {
    deps = resolveDeps(overrides);
    const anthropic = deps.anthropic();
    if (!anthropic) {
      log.status = "disabled";
      log.reason = "api_key_missing";
      return done(0);
    }
    const organizationId = readOrganizationId(deps.env());
    if (!organizationId) {
      log.status = "failed";
      log.reason = "organization_not_configured";
      return done(1);
    }
    release = acquireLock(options.lockPath, deps.now());
    if (release === null) {
      log.status = "skipped";
      log.reason = "already_running";
      return done(0);
    }

    let client: ServiceClient;
    try {
      client = await deps.serviceClient();
    } catch {
      log.status = "failed";
      log.reason = "backend_not_configured";
      return done(1);
    }

    const startedAt = deps.now();
    const deadline = startedAt + options.runBudgetMs;
    const shouldStop = (): boolean => deps.now() >= deadline;
    let failures = 0;
    const seen: { requestId: string | null } = { requestId: null };
    const noteFailure = (error: unknown): void => {
      failures += 1;
      seen.requestId ??= anthropicRequestIdField(error).request_id ?? null;
    };

    // 1. Настройки агентов.
    const infos: AgentInfo[] = [];
    let agentsUnreadable = 0;
    for (const key of AI_AGENT_KEYS) {
      if (shouldStop()) break;
      const loaded = await callRpc(client, AI_AGENT_RUNTIME_RPC.get, { p_organization_id: organizationId, p_key: key });
      const info = loaded.ok ? parseAgentInfo(key, loaded.data) : null;
      if (info) infos.push(info); else agentsUnreadable += 1;
    }
    log.agents = infos.length;
    if (agentsUnreadable > 0) {
      log.agents_unreadable = agentsUnreadable;
      failures += 1;
    }

    // 2. Расписания: запуски (постранично) и пауза.
    let deployments = 0;
    let runsSeen = 0;
    let runsLinked = 0;
    let runsFailedRecorded = 0;
    let paused = 0;
    let pausedRecorded = 0;
    let missing = 0;
    const lookbackIso = new Date(startedAt - options.deploymentRunsLookbackMs).toISOString();
    for (const info of infos) {
      if (!info.deploymentId) continue;
      if (shouldStop()) break;
      deployments += 1;
      const target: DeploymentTarget = { key: info.key, deploymentId: info.deploymentId, model: info.model, agentVersion: info.agentVersion };
      try {
        const summary = await syncDeploymentRuns(anthropic, client, organizationId, target, deps, {
          limit: options.deploymentRunsPageLimit,
          maxPages: options.deploymentRunsMaxPages,
          createdAtGte: lookbackIso,
          shouldStop,
        });
        runsSeen += summary.seen;
        runsLinked += summary.linked;
        runsFailedRecorded += summary.failedRecorded;
        // Паузу ищем у расписания, которому положено работать; во время синхронизации её снимает сама синхронизация.
        if (info.enabled && info.scheduleCron !== null && info.syncStatus !== "pending" && !shouldStop()) {
          const deployment = await anthropic.deployments.get(info.deploymentId);
          if (!deployment.archived_at && deployment.status === "paused") {
            paused += 1;
            if (await recordPausedDeployment(client, organizationId, target, deployment, deps) === "recorded") pausedRecorded += 1;
          }
        }
      } catch (error) {
        if (isNotFound(error)) {
          missing += 1; // расписание удалено в Console: это видно по пустому deploymentId после «Синхронизировать»
          continue;
        }
        noteFailure(error);
        deps.log({ op: "maintenance_deployment", status: "error", agent: info.key, http: error instanceof AnthropicApiError ? error.status : null, ...anthropicRequestIdField(error) });
      }
    }
    log.deployments = deployments;
    log.deployment_runs_seen = runsSeen;
    log.deployment_runs_linked = runsLinked;
    log.deployment_runs_failed_recorded = runsFailedRecorded;
    log.deployments_paused = paused;
    log.deployments_paused_recorded = pausedRecorded;
    if (missing > 0) log.deployments_missing = missing;

    // 3. Открытые запуски: итог и расход по состоянию сессии.
    const closed = await closeOpenAiAgentRunsDetailed(anthropic, client, organizationId, null, deps, {
      limit: options.openRunsLimit,
      shouldStop,
    });
    log.open_runs = closed.ok ? "ok" : "unreadable";
    log.open_checked = closed.checked;
    log.open_closed = closed.closed;
    if (!closed.ok) failures += 1;
    if (closed.failed > 0) {
      log.open_failed = closed.failed;
      failures += 1;
      seen.requestId ??= closed.requestId;
    }

    if (shouldStop()) log.budget_exhausted = true;
    if (seen.requestId !== null) log.request_id = seen.requestId;
    log.duration_ms = Math.max(0, deps.now() - startedAt);
    log.status = failures > 0 ? "error" : "ok";
    return done(failures > 0 ? 1 : 0);
  } catch {
    log.status = "failed";
    log.reason = "internal_error";
    return done(1);
  } finally {
    release?.();
  }
}
