import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  planWhatsAppHealth,
  WHATSAPP_HEALTH_SESSION,
  whatsAppHealthStatusWord,
  type WhatsAppHealthAlertKind,
  type WhatsAppHealthMonitor,
  type WhatsAppHealthObservation,
  type WhatsAppHealthOpenAlert,
} from "../platform-whatsapp-health.ts";
import {
  getPlatformMessagingBackendConfig,
  type PlatformMessagingBackendConfig,
} from "./platform-messaging-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import { isPlatformWahaIngressEnabled } from "./platform-waha-ingress-config.ts";
import { probePlatformWahaSessionForAlertUncached } from "./platform-waha-live-health.ts";

/**
 * Тревога о связи WhatsApp продаж (миграция 321, runbook docs/runbooks/whatsapp-go-live.md, раздел «Тревога об
 * отключении и тишине»). Запускается таймером systemd на хосте раз в 5 минут:
 * `docker exec evo-crm-app-1 node /app/whatsapp-health-maintenance.mjs` (как телефония и ИИ-агенты).
 *
 * Один проход:
 *  1. приём WhatsApp выключен (`EVO_PLATFORM_WAHA_INGRESS_ENABLED` не ровно `1`) - ничего не делает: WhatsApp
 *     намеренно выключен, тревог нет;
 *  2. спрашивает WAHA о статусе `crm_primary` тем же живым опросом, что и «Настройки» (без кэша, ключ из Vault не
 *     покидает опрос), но с одним отличием: ответ WAHA «сессии нет» (404) - слово `SESSION_MISSING`, «ключ не принят»
 *     (401/403) - `UNAUTHORIZED`; оба считаются «не работает» и через 10 минут дают тревогу (приём включён и привязка
 *     есть, значит WhatsApp выключен не намеренно). Ответ «сказать нельзя» (нет привязки ключа или настройки бэкенда,
 *     непонятный ответ) - не тревога и не меняет ничего: WhatsApp может быть выключен намеренно. WAHA не отвечает
 *     совсем или отвечает 5xx - статус `UNREACHABLE`;
 *  3. читает из базы серию наблюдений, открытые тревоги и последнее входящее клиента; часы - базы;
 *  4. решает чистыми правилами (`src/lib/platform-whatsapp-health.ts`): отключён ≥ 10 минут - тревога
 *     «отключён»; «работает», но нет входящих ≥ 3 рабочих часов - «молчит»; связь вернулась - обе закрываются;
 *  5. записывает: серию, закрытия, открытия. Открытие и закрытие идемпотентны в базе (одна открытая тревога вида).
 *
 * Никого не уведомляет сообщениями: тревога - задача сотрудникам (системным администраторам и руководителю продаж
 * приёма) в самой CRM. Ничего не трогает у WAHA: только `GET /api/sessions/{session}`. Не бросает: итог - отчёт.
 * В журнале только счётчики и фиксированные слова: ни номеров, ни ключей, ни текстов.
 */

const DEFAULT_RPC_DEADLINE_MS = 20_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

type RpcClient = Pick<SupabaseClient, "schema">;
type JsonObject = Record<string, unknown>;
type LogValue = string | number | boolean;

export type WhatsAppHealthMaintenanceDependencies = Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  createServiceClient(config: PlatformMessagingBackendConfig): RpcClient;
  /** Статус сессии по живому опросу WAHA или null, когда опрос сказать не может. */
  probe(organizationId: string): Promise<string | null>;
  rpcDeadlineMs: number;
}>;

export type WhatsAppHealthMaintenanceReport = Readonly<{
  /** 1 - сбой базы или записи на этом проходе (записан в `log`); выключенный приём и пропуск - 0. */
  exitCode: 0 | 1;
  log: Readonly<Record<string, LogValue>>;
}>;

export function defaultWhatsAppHealthMaintenanceDependencies(): WhatsAppHealthMaintenanceDependencies {
  return {
    environment: process.env,
    createServiceClient: createPlatformSupabaseServiceClient,
    async probe(organizationId) {
      const health = await probePlatformWahaSessionForAlertUncached(organizationId);
      return health === null ? null : health.status;
    },
    rpcDeadlineMs: DEFAULT_RPC_DEADLINE_MS,
  };
}

class WhatsAppHealthDatabaseError extends Error {
  readonly word: "database" | "no_recipient";
  constructor(word: "database" | "no_recipient" = "database") {
    super("whatsapp_health_database_error");
    this.name = "WhatsAppHealthDatabaseError";
    this.word = word;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function openAlert(value: unknown): WhatsAppHealthOpenAlert | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) throw new WhatsAppHealthDatabaseError();
  const openedAt = timestampMs(value.openedAt);
  if (typeof value.id !== "string" || !UUID_PATTERN.test(value.id) || openedAt === null) {
    throw new WhatsAppHealthDatabaseError();
  }
  return Object.freeze({ id: value.id, openedAt });
}

function monitorState(value: unknown): WhatsAppHealthMonitor | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) throw new WhatsAppHealthDatabaseError();
  const lastStatus = whatsAppHealthStatusWord(value.lastStatus);
  const lastSeenAt = timestampMs(value.lastSeenAt);
  const sinceAt = timestampMs(value.sinceAt);
  const workingSinceAt = timestampMs(value.workingSinceAt);
  if (lastStatus === null || lastSeenAt === null || sinceAt === null || workingSinceAt === null) {
    throw new WhatsAppHealthDatabaseError();
  }
  return Object.freeze({ lastStatus, lastSeenAt, sinceAt, workingSinceAt });
}

type DatabaseState = Readonly<{
  now: number;
  monitor: WhatsAppHealthMonitor | null;
  disconnected: WhatsAppHealthOpenAlert | null;
  silent: WhatsAppHealthOpenAlert | null;
  lastInboundAt: number | null;
}>;

function parseState(value: unknown): DatabaseState {
  if (!isObject(value)) throw new WhatsAppHealthDatabaseError();
  const now = timestampMs(value.now);
  if (now === null) throw new WhatsAppHealthDatabaseError();
  const lastInbound = value.lastInboundAt;
  const lastInboundAt = lastInbound === null || lastInbound === undefined ? null : timestampMs(lastInbound);
  if (lastInbound !== null && lastInbound !== undefined && lastInboundAt === null) {
    throw new WhatsAppHealthDatabaseError();
  }
  return Object.freeze({
    now,
    monitor: monitorState(value.monitor),
    disconnected: openAlert(value.disconnected),
    silent: openAlert(value.silent),
    lastInboundAt,
  });
}

/** Руководитель продаж приёма WhatsApp (его назначает env приёма); null, если не задан или не UUID. */
function salesHeadMembership(environment: Readonly<Record<string, string | undefined>>): string | null {
  const value = environment.EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID;
  if (value === undefined || value !== value.trim() || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

/** Один проход. Не бросает: итог - отчёт. */
export async function runWhatsAppHealthMaintenance(
  overrides?: Partial<WhatsAppHealthMaintenanceDependencies>,
): Promise<WhatsAppHealthMaintenanceReport> {
  const log: Record<string, LogValue> = { event: "whatsapp_health_maintenance" };
  const dependencies: WhatsAppHealthMaintenanceDependencies = {
    ...defaultWhatsAppHealthMaintenanceDependencies(),
    ...overrides,
  };
  const done = (exitCode: 0 | 1): WhatsAppHealthMaintenanceReport => Object.freeze({ exitCode, log });

  if (!isPlatformWahaIngressEnabled(dependencies.environment)) {
    log.status = "disabled";
    log.reason = "ingress_off";
    return done(0);
  }

  let config: PlatformMessagingBackendConfig;
  try {
    config = getPlatformMessagingBackendConfig(dependencies.environment as NodeJS.ProcessEnv);
  } catch {
    log.status = "failed";
    log.reason = "backend_not_configured";
    return done(1);
  }

  let client: RpcClient;
  try {
    client = dependencies.createServiceClient(config);
  } catch {
    log.status = "failed";
    log.reason = "backend_not_configured";
    return done(1);
  }
  const organizationId = config.organizationId;

  async function rpc(name: string, args: JsonObject): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        Promise.resolve(client.schema("platform").rpc(name, args)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new WhatsAppHealthDatabaseError()), dependencies.rpcDeadlineMs);
        }),
      ]);
      if (outcome.error) {
        const message = typeof outcome.error.message === "string" ? outcome.error.message : "";
        throw new WhatsAppHealthDatabaseError(
          message.includes("whatsapp_health_no_recipient") ? "no_recipient" : "database",
        );
      }
      return outcome.data;
    } catch (error) {
      if (error instanceof WhatsAppHealthDatabaseError) throw error;
      throw new WhatsAppHealthDatabaseError();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // 2. Что говорит WAHA. Сбой самого опроса - «сказать нельзя», а не тревога.
  let observation: WhatsAppHealthObservation = { kind: "unknown" };
  try {
    const status = await dependencies.probe(organizationId);
    const word = status === null ? null : whatsAppHealthStatusWord(status);
    if (word !== null) observation = { kind: "status", status: word };
  } catch {
    observation = { kind: "unknown" };
  }

  try {
    // 3. База: серия, открытые тревоги, последнее входящее, часы базы.
    const state = parseState(
      await rpc("whatsapp_health_read_v1", { p_organization_id: organizationId, p_session: WHATSAPP_HEALTH_SESSION }),
    );

    // 4. Решение.
    const plan = planWhatsAppHealth({
      now: state.now,
      observation,
      monitor: state.monitor,
      disconnected: state.disconnected,
      silent: state.silent,
      lastInboundAt: state.lastInboundAt,
    });
    log.status = "ok";
    log.probe = observation.kind === "status" ? "answered" : "unknown";
    if (observation.kind === "status") log.session_status = observation.status;
    log.verdict = plan.verdict;
    if (plan.downMinutes > 0) log.down_minutes = plan.downMinutes;
    if (plan.silentWorkingMinutes > 0) log.silent_working_minutes = plan.silentWorkingMinutes;

    // 5. Запись: серия, затем закрытия, затем открытия. Каждый шаг сам по себе; сбой одного не снимает остальные.
    let failures = 0;
    let lastFailure = "";
    const fail = (error: unknown): void => {
      failures += 1;
      lastFailure = error instanceof WhatsAppHealthDatabaseError ? error.word : "database";
    };

    if (plan.observe !== null) {
      try {
        await rpc("whatsapp_health_observe_v1", {
          p_organization_id: organizationId,
          p_session: WHATSAPP_HEALTH_SESSION,
          p_status: plan.observe.status,
          p_restart: plan.observe.restart,
          p_working_restart: plan.observe.workingRestart,
        });
      } catch (error) {
        fail(error);
      }
    }

    const resolved: WhatsAppHealthAlertKind[] = [];
    let tasksClosed = 0;
    for (const item of plan.resolve) {
      try {
        const result = await rpc("whatsapp_health_resolve_v1", {
          p_organization_id: organizationId,
          p_session: WHATSAPP_HEALTH_SESSION,
          p_kind: item.kind,
          p_reason: item.reason,
        });
        if (isObject(result) && result.resolved === true) {
          resolved.push(item.kind);
          if (typeof result.tasksClosed === "number" && Number.isSafeInteger(result.tasksClosed)) {
            tasksClosed += result.tasksClosed;
          }
        }
      } catch (error) {
        fail(error);
      }
    }

    const opened: WhatsAppHealthAlertKind[] = [];
    let tasksCreated = 0;
    const salesHead = salesHeadMembership(dependencies.environment);
    for (const item of plan.open) {
      try {
        const result = await rpc("whatsapp_health_open_v1", {
          p_organization_id: organizationId,
          p_session: WHATSAPP_HEALTH_SESSION,
          p_kind: item.kind,
          p_status: item.status,
          p_extra_recipient: salesHead,
        });
        if (isObject(result) && result.opened === true) {
          opened.push(item.kind);
          if (typeof result.tasks === "number" && Number.isSafeInteger(result.tasks)) tasksCreated += result.tasks;
        }
      } catch (error) {
        fail(error);
      }
    }

    log.opened = opened.length;
    if (opened.length > 0) log.opened_kinds = opened.join(",");
    log.resolved = resolved.length;
    if (resolved.length > 0) log.resolved_kinds = resolved.join(",");
    log.tasks_created = tasksCreated;
    log.tasks_closed = tasksClosed;
    if (failures > 0) {
      log.status = "failed";
      log.failed = failures;
      log.reason = lastFailure;
      return done(1);
    }
    return done(0);
  } catch (error) {
    log.status = "failed";
    log.reason = error instanceof WhatsAppHealthDatabaseError ? error.word : "database";
    return done(1);
  }
}
