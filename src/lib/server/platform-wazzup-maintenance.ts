import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { planWhatsAppHealth, type WhatsAppHealthObservation } from "../platform-whatsapp-health.ts";
import {
  WAZZUP_BACKLOG_DEGRADED_SECONDS,
  WAZZUP_CHANNEL_MISSING_WORD,
  WAZZUP_HEALTH_SESSION,
  WAZZUP_KEY_REJECTED_WORD,
  WAZZUP_UNREACHABLE_WORD,
  wazzupReconciliationVerdict,
  wazzupReconciliationWindow,
  wazzupStateHealthWord,
} from "../platform-wazzup-health.ts";
import {
  getPlatformMessagingBackendConfig,
  type PlatformMessagingBackendConfig,
} from "./platform-messaging-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  parseWhatsAppHealthState,
  salesHeadMembership,
  WhatsAppHealthDatabaseError,
} from "./platform-whatsapp-health-maintenance.ts";
import {
  createWazzupClient,
  resolveWazzupApiKey,
  WazzupApiError,
  type WazzupClient,
} from "./platform-wazzup-client.ts";
import {
  isPlatformWazzupIngressEnabled,
  readPlatformWazzupIntakeOwner,
  readPlatformWazzupWebhookTokens,
} from "./platform-wazzup-ingress-config.ts";

/**
 * Часть задачи таймера `evo-whatsapp-health` для WhatsApp через Wazzup (docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.2,
 * §5.4, §9). Запускается тем же `docker exec evo-crm-app-1 node /app/whatsapp-health-maintenance.mjs`, после шага WAHA
 * (его код не менялся), и состоит из трёх независимых шагов: сбой одного не останавливает другие.
 *
 *  - **а) догрузка** (`sweep`): проецирует сохранённые, но не разобранные события (`platform.wazzup_projection_sweep_v1`)
 *    небольшими порциями и измеряет возраст самого старого; бежит на каждом проходе, пока аварийный стоп env открыт и
 *    действующий путь - Wazzup, и не зависит от опроса Wazzup. Возраст старше 30 минут - слово `degraded` в отчёте.
 *    Новое входящее при включённом в базе запуске ИИ - один запуск агентов за проход, но не здесь: он идёт после шага в)
 *    и ограничен сроком `aiDispatchDeadlineMs` (медленный Claude API не должен отнимать время у здоровья и сверки).
 *  - **б) здоровье** (`health`): `GET /v3/channels` (таймаут 10 с, ключ из Vault) -> слово состояния -> серия 321 сессии
 *    `wazzup` теми же правилами, что у WAHA (`planWhatsAppHealth`). Серию пишет только этот шаг, один раз за проход.
 *  - **в) сверка** (`reconcile`): в окне [00:10, 06:00) по Бишкеку считает входящие за прошлые сутки в EVO
 *    (`platform.wazzup_daily_counts_v1`) и сравнивает с числом amoCRM, если чтение amoCRM настроено; расхождение больше
 *    max(3, 2 %) - тревога вида `gap`, сошлось - закрывается `counts_match`.
 *
 * Действующий путь (`whatsapp_transport_state.active_transport`) читать из service_role нечем: у миграции 325 нет
 * читающей функции. Шаги узнают его одним вызовом `wazzup_webhook_persist_v1` с пустой порцией: это единственная функция,
 * которая без записи отвечает и «путь Wazzup?», и номером привязанного канала (тот же вызов с пустой порцией делает
 * маршрут приёма для пакета из одних статусов). Не Wazzup - шаг пишет `transport_inactive` и ничего не опрашивает.
 * Слова пути (`none` или `waha`) вызов не отдаёт, поэтому «расхождение» плана §9 (env `1`, путь `waha`) блок не называет:
 * известное отклонение, docs/runbooks/wazzup-whatsapp.md §10 п. 7.
 *
 * Аварийный стоп (`EVO_PLATFORM_WAZZUP_INGRESS_ENABLED` не "1") и в env нет токена вебхука (настройки Wazzup не
 * начаты) - ничего не делает и в базу не ходит. Стоп закрыт, но токен задан (настройка начата или приём остановлен
 * аварийно): один безопасный вызов узнаёт путь; путь не Wazzup - блок молчит; путь Wazzup - это «деградация»
 * (`ingress_off_transport_wazzup`): догрузка и сверка пропускаются (приём остановлен), шаг здоровья идёт, чтобы
 * «молчит» сработало (план §9, таблица состояний). Ничего не отправляет клиентам; у Wazzup только `GET /v3/channels`.
 * В журнале (одна JSON-строка) - слова и счётчики: ни номера, ни ключа, ни токена, ни текста.
 */

const DEFAULT_RPC_DEADLINE_MS = 15_000;
const DEFAULT_SWEEP_LIMIT = 50;
const DEFAULT_SWEEP_MAX_ROUNDS = 4;
const DEFAULT_SWEEP_BUDGET_MS = 40_000;
/** Запуск ИИ-агентов идёт после трёх шагов и ждёт не дольше этого срока: 70 с блока + 15 с остаются в 100 с хард-стопа скрипта. */
const DEFAULT_AI_DISPATCH_DEADLINE_MS = 15_000;
/** Весь блок: хард-стоп скрипта 100 с, шаг WAHA до него тоже тратит время. */
const DEFAULT_TOTAL_BUDGET_MS = 70_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PROBE_BATCH_SHA256 = createHash("sha256").update("evo:wazzup:transport-probe", "utf8").digest("hex");

type RpcClient = Pick<SupabaseClient, "schema">;
type JsonObject = Record<string, unknown>;
type LogValue = string | number | boolean;

export type WazzupMaintenanceDependencies = Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  createServiceClient(config: PlatformMessagingBackendConfig): RpcClient;
  createWazzupClient(apiKey: string): WazzupClient;
  /**
   * Число входящих чатов Wazzup в amoCRM за сутки по Бишкеку (`YYYY-MM-DD`), только чтение и только количество, либо null,
   * когда чтение amoCRM не настроено (по умолчанию так: см. §5.4 в и вопрос 16 плана).
   */
  readAmocrmInboundCount(day: string): Promise<number | null>;
  /** Запуск включённых ИИ-агентов по событию «входящее WhatsApp»; не бросает. */
  dispatchAiAgents(): Promise<void>;
  now(): number;
  rpcDeadlineMs: number;
  sweepLimit: number;
  sweepMaxRounds: number;
  sweepBudgetMs: number;
  totalBudgetMs: number;
  /** Сколько ждать `dispatchAiAgents` после шага в); дольше - проход идёт дальше (`degraded`, `sweep_ai_dispatch: deadline`). */
  aiDispatchDeadlineMs: number;
}>;

export type WazzupMaintenanceReport = Readonly<{
  /** 1 - сбой базы или записи на этом проходе; выключенный приём, неактивный путь и «сказать нельзя» - 0. */
  exitCode: 0 | 1;
  log: Readonly<Record<string, LogValue>>;
}>;

export function defaultWazzupMaintenanceDependencies(): WazzupMaintenanceDependencies {
  return {
    environment: process.env,
    createServiceClient: createPlatformSupabaseServiceClient,
    createWazzupClient: (apiKey) => createWazzupClient({ apiKey }),
    // Чтение amoCRM для сверки не подключено: нужен ответ владельца (вопрос 16) и настроенный провайдер только для чтения.
    // Пока шаг пишет только число EVO, а сверку первые 7 дней делает агент вручную.
    readAmocrmInboundCount: async () => null,
    async dispatchAiAgents() {
      try {
        const dispatch = await import("./ai-agents/dispatch.ts");
        await dispatch.dispatchAiAgentEvent({ kind: "whatsapp_inbound", ref: null });
      } catch {
        // dispatchAiAgentEvent и так не бросает; сбой загрузки - не сбой прохода.
      }
    },
    now: Date.now,
    rpcDeadlineMs: DEFAULT_RPC_DEADLINE_MS,
    sweepLimit: DEFAULT_SWEEP_LIMIT,
    sweepMaxRounds: DEFAULT_SWEEP_MAX_ROUNDS,
    sweepBudgetMs: DEFAULT_SWEEP_BUDGET_MS,
    totalBudgetMs: DEFAULT_TOTAL_BUDGET_MS,
    aiDispatchDeadlineMs: DEFAULT_AI_DISPATCH_DEADLINE_MS,
  };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Слово статуса канала по ответу Wazzup: состояние привязанного канала, либо слово сбоя; null - сказать нельзя. */
function observationFromError(error: unknown): string | null {
  if (!(error instanceof WazzupApiError)) return null;
  if (error.kind === "unauthorized" || error.kind === "forbidden") return WAZZUP_KEY_REJECTED_WORD;
  if (error.kind === "server" || error.kind === "network" || error.kind === "timeout") return WAZZUP_UNREACHABLE_WORD;
  // 429, 400, нечитаемый ответ: это не состояние канала - не пишем в серию ни «работает», ни «не работает».
  return null;
}

/** Один проход трёх шагов. Не бросает: итог - отчёт. */
export async function runWazzupMaintenance(
  overrides?: Partial<WazzupMaintenanceDependencies>,
): Promise<WazzupMaintenanceReport> {
  const log: Record<string, LogValue> = {};
  const dependencies: WazzupMaintenanceDependencies = { ...defaultWazzupMaintenanceDependencies(), ...overrides };
  const done = (exitCode: 0 | 1): WazzupMaintenanceReport => Object.freeze({ exitCode, log });

  const intakeOpen = isPlatformWazzupIngressEnabled(dependencies.environment);
  if (!intakeOpen && readPlatformWazzupWebhookTokens(dependencies.environment) === null) {
    log.status = "disabled";
    log.reason = "ingress_off";
    return done(0);
  }

  let config: PlatformMessagingBackendConfig;
  let client: RpcClient;
  try {
    config = getPlatformMessagingBackendConfig(dependencies.environment as NodeJS.ProcessEnv);
    client = dependencies.createServiceClient(config);
  } catch {
    log.status = "failed";
    log.reason = "backend_not_configured";
    return done(1);
  }
  const organizationId = config.organizationId;
  const startedAt = dependencies.now();
  const overBudget = (): boolean => dependencies.now() - startedAt > dependencies.totalBudgetMs;

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

  // Действующий путь и привязанный канал: один вызов на проход, общий для шагов б) и в).
  let transport: Promise<Readonly<{ active: boolean; channelId: string | null }>> | null = null;
  const transportOf = (): Promise<Readonly<{ active: boolean; channelId: string | null }>> => {
    transport ??= (async () => {
      const data = await rpc("wazzup_webhook_persist_v1", {
        p_organization_id: organizationId,
        p_batch_sha256: PROBE_BATCH_SHA256,
        p_token_slot: "current",
        p_elements: [],
        p_counters: {},
      });
      if (!isObject(data) || typeof data.transportActive !== "boolean") throw new WhatsAppHealthDatabaseError();
      const channelId = typeof data.channelId === "string" && UUID_PATTERN.test(data.channelId) ? data.channelId : null;
      return Object.freeze({ active: data.transportActive, channelId });
    })();
    return transport;
  };

  // Приём остановлен аварийно (или настройка начата), а путь в базе всё ещё Wazzup: вебхуки закрыты, канал может быть
  // рабочим. Блок молчит, пока путь не Wazzup; иначе идёт дальше «деградацией» без догрузки и сверки.
  if (!intakeOpen) {
    try {
      if (!(await transportOf()).active) {
        log.status = "disabled";
        log.reason = "ingress_off";
        return done(0);
      }
    } catch (error) {
      log.status = "failed";
      log.reason = error instanceof WhatsAppHealthDatabaseError ? error.word : "database";
      return done(1);
    }
    log.reason = "ingress_off_transport_wazzup";
  }

  let failures = 0;
  const failed = (step: string, error: unknown): void => {
    failures += 1;
    log[`${step}_status`] = "failed";
    log[`${step}_reason`] = error instanceof WhatsAppHealthDatabaseError ? error.word : "database";
  };

  // Решает шаг а): были новые входящие и запуск ИИ включён в базе. Сам запуск - после шага в).
  let aiDispatchWanted = false;

  // ---------------------------------------------------------------- а) догрузка
  try {
    const owner = readPlatformWazzupIntakeOwner(dependencies.environment);
    if (!intakeOpen) {
      // Приём остановлен: догрузка, как и сам приём, ждёт открытого стопа (план §5.2).
      log.sweep_status = "skipped";
      log.sweep_reason = "ingress_off";
    } else if (owner === null) {
      failures += 1;
      log.sweep_status = "failed";
      log.sweep_reason = "owner_missing";
    } else {
      const started = dependencies.now();
      let rounds = 0;
      let processed = 0;
      let busy = 0;
      let newInbound = 0;
      let exhausted = 0;
      let oldest: number | null = null;
      let aiTrigger = false;
      let inactive = false;
      while (rounds < dependencies.sweepMaxRounds && dependencies.now() - started < dependencies.sweepBudgetMs) {
        const data = await rpc("wazzup_projection_sweep_v1", {
          p_organization_id: organizationId,
          p_intake_sales_membership_id: owner,
          p_limit: dependencies.sweepLimit,
        });
        if (!isObject(data) || typeof data.transportActive !== "boolean") throw new WhatsAppHealthDatabaseError();
        if (!data.transportActive) {
          inactive = true;
          break;
        }
        rounds += 1;
        const roundProcessed = count(data.processed);
        const roundBusy = count(data.busy);
        const roundFailed = isObject(data.outcomes) ? count(data.outcomes.failed) : 0;
        processed += roundProcessed;
        busy += roundBusy;
        newInbound += count(data.newInbound);
        exhausted = count(data.failedExhausted);
        oldest = typeof data.oldestPendingSeconds === "number" && Number.isSafeInteger(data.oldestPendingSeconds)
          && data.oldestPendingSeconds >= 0 ? data.oldestPendingSeconds : null;
        aiTrigger = data.aiTriggerEnabled === true;
        // Дальше только пока впереди есть работа и она не одна и та же упавшая: иначе попытки (их не больше 8) сгорели
        // бы за один проход, а не растянулись на несколько.
        const full = roundProcessed + roundBusy >= dependencies.sweepLimit;
        const progressed = roundProcessed - roundFailed > 0;
        if (!(full && progressed)) break;
      }
      if (inactive) {
        log.sweep_status = "transport_inactive";
      } else {
        log.sweep_status = "ok";
        log.sweep_rounds = rounds;
        log.sweep_processed = processed;
        if (busy > 0) log.sweep_busy = busy;
        log.sweep_new_inbound = newInbound;
        if (exhausted > 0) log.sweep_failed_exhausted = exhausted;
        log.oldest_pending_seconds = oldest ?? 0;
        if (oldest !== null && oldest > WAZZUP_BACKLOG_DEGRADED_SECONDS) log.backlog = "degraded";
        // Запуск агентов - после шагов б) и в) (ниже): он ходит в Claude API (сессия до 30 с, с повторами) и не должен
        // отнимать бюджет у здоровья и сверки. События уже спроецированы, терять нечего.
        aiDispatchWanted = newInbound > 0 && aiTrigger;
      }
    }
  } catch (error) {
    failed("sweep", error);
  }

  // ---------------------------------------------------------------- б) здоровье
  try {
    if (overBudget()) {
      log.health_status = "skipped";
      log.health_reason = "budget";
    } else {
      const path = await transportOf();
      if (!path.active || path.channelId === null) {
        log.health_status = "transport_inactive";
      } else {
        let observation: WhatsAppHealthObservation = { kind: "unknown" };
        let rawState: string | null = null;
        const key = await resolveWazzupApiKey(client, organizationId);
        if (!key.ready) {
          log.health_key = key.reason;
        } else {
          try {
            const channels = await dependencies.createWazzupClient(key.apiKey).listChannels();
            const own = channels.find((channel) => channel.channelId === path.channelId);
            if (own === undefined) {
              observation = { kind: "status", status: WAZZUP_CHANNEL_MISSING_WORD };
            } else {
              rawState = own.state;
              observation = { kind: "status", status: wazzupStateHealthWord(own.state) };
            }
          } catch (error) {
            const word = observationFromError(error);
            if (word !== null) observation = { kind: "status", status: word };
            log.health_api = error instanceof WazzupApiError ? error.kind : "error";
          }
        }

        if (observation.kind !== "status") {
          // «Сказать нельзя» (нет ключа, 429, нечитаемый ответ) - не тревога и не меняет серию, как у WAHA.
          log.health_status = "unknown";
        } else {
          if (rawState !== null && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(rawState)) {
            // Состояние для «Настроек» между проходами; сбой записи не ломает серию.
            await rpc("wazzup_channel_observe_v1", {
              p_organization_id: organizationId,
              p_channel_id: path.channelId,
              p_state: rawState,
            }).catch(() => {
              log.health_observe = "failed";
            });
          }
          const state = parseWhatsAppHealthState(
            await rpc("whatsapp_health_read_v1", { p_organization_id: organizationId, p_session: WAZZUP_HEALTH_SESSION }),
          );
          const plan = planWhatsAppHealth({
            now: state.now,
            observation,
            monitor: state.monitor,
            disconnected: state.disconnected,
            silent: state.silent,
            lastInboundAt: state.lastInboundAt,
          });
          log.health_status = "ok";
          log.health_word = observation.status;
          log.health_verdict = plan.verdict;
          if (plan.downMinutes > 0) log.down_minutes = plan.downMinutes;
          if (plan.silentWorkingMinutes > 0) log.silent_working_minutes = plan.silentWorkingMinutes;

          // Запись: серия, закрытия, открытия. Каждый шаг сам по себе; сбой одного не снимает остальные.
          let stepFailures = 0;
          let lastFailure = "";
          const fail = (error: unknown): void => {
            stepFailures += 1;
            lastFailure = error instanceof WhatsAppHealthDatabaseError ? error.word : "database";
          };
          if (plan.observe !== null) {
            try {
              await rpc("whatsapp_health_observe_v1", {
                p_organization_id: organizationId,
                p_session: WAZZUP_HEALTH_SESSION,
                p_status: plan.observe.status,
                p_restart: plan.observe.restart,
                p_working_restart: plan.observe.workingRestart,
              });
            } catch (error) {
              fail(error);
            }
          }
          let resolved = 0;
          for (const item of plan.resolve) {
            try {
              const result = await rpc("whatsapp_health_resolve_v1", {
                p_organization_id: organizationId,
                p_session: WAZZUP_HEALTH_SESSION,
                p_kind: item.kind,
                p_reason: item.reason,
              });
              if (isObject(result) && result.resolved === true) resolved += 1;
            } catch (error) {
              fail(error);
            }
          }
          let opened = 0;
          const salesHead = salesHeadMembership(dependencies.environment);
          for (const item of plan.open) {
            try {
              const result = await rpc("whatsapp_health_open_v1", {
                p_organization_id: organizationId,
                p_session: WAZZUP_HEALTH_SESSION,
                p_kind: item.kind,
                p_status: item.status,
                p_extra_recipient: salesHead,
              });
              if (isObject(result) && result.opened === true) opened += 1;
            } catch (error) {
              fail(error);
            }
          }
          log.health_opened = opened;
          log.health_resolved = resolved;
          if (stepFailures > 0) {
            failures += 1;
            log.health_status = "failed";
            log.health_reason = lastFailure;
          }
        }
      }
    }
  } catch (error) {
    failed("health", error);
  }

  // ---------------------------------------------------------------- в) сверка за сутки
  try {
    const window = wazzupReconciliationWindow(dependencies.now());
    if (!intakeOpen) {
      log.reconcile_status = "skipped";
      log.reconcile_reason = "ingress_off";
    } else if (!window.due) {
      log.reconcile_status = "not_due";
    } else if (overBudget()) {
      log.reconcile_status = "skipped";
      log.reconcile_reason = "budget";
    } else {
      const path = await transportOf();
      if (!path.active) {
        log.reconcile_status = "transport_inactive";
      } else {
        const counts = await rpc("wazzup_daily_counts_v1", { p_organization_id: organizationId, p_day: window.day });
        const evoCount = isObject(counts) && typeof counts.inboundTotal === "number" && Number.isSafeInteger(counts.inboundTotal)
          && counts.inboundTotal >= 0 ? counts.inboundTotal : null;
        if (evoCount === null) throw new WhatsAppHealthDatabaseError();
        log.reconcile_day = window.day;
        log.reconcile_evo = evoCount;
        const amoCount = await dependencies.readAmocrmInboundCount(window.day).catch(() => null);
        if (amoCount === null || !Number.isSafeInteger(amoCount) || amoCount < 0) {
          // Чтение amoCRM не настроено или не ответило: число EVO записано, сравнить нечем.
          log.reconcile_status = "evo_only";
        } else {
          const verdict = wazzupReconciliationVerdict(evoCount, amoCount);
          log.reconcile_status = "ok";
          log.reconcile_amo = amoCount;
          log.reconcile_verdict = verdict;
          // Открытая тревога `gap` лежит в ответе чтения серии рядом с остальными (миграция 325, п. 12).
          const state = await rpc("whatsapp_health_read_v1", {
            p_organization_id: organizationId,
            p_session: WAZZUP_HEALTH_SESSION,
          });
          const hasGap = isObject(state) && isObject(state.gap) && typeof state.gap.id === "string";
          if (verdict === "gap" && !hasGap) {
            const opened = await rpc("whatsapp_health_open_v1", {
              p_organization_id: organizationId,
              p_session: WAZZUP_HEALTH_SESSION,
              p_kind: "gap",
              p_status: "COUNTS_GAP",
              p_extra_recipient: salesHeadMembership(dependencies.environment),
            });
            log.reconcile_opened = isObject(opened) && opened.opened === true ? 1 : 0;
          } else if (verdict !== "gap" && hasGap) {
            const resolvedGap = await rpc("whatsapp_health_resolve_v1", {
              p_organization_id: organizationId,
              p_session: WAZZUP_HEALTH_SESSION,
              p_kind: "gap",
              p_reason: "counts_match",
            });
            log.reconcile_resolved = isObject(resolvedGap) && resolvedGap.resolved === true ? 1 : 0;
          }
        }
      }
    }
  } catch (error) {
    failed("reconcile", error);
  }

  // ---------------------------------------------------------------- запуск ИИ-агентов (после а), б), в))
  if (aiDispatchWanted) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Сбой запуска (в том числе синхронный) проход не ломает: событие уже спроецировано, агент увидит чат по «неотвеченным».
    const dispatch = (async (): Promise<"done"> => {
      try {
        await dependencies.dispatchAiAgents();
      } catch {
        // запуск не бросает по контракту; всё равно не сбой прохода
      }
      return "done";
    })();
    try {
      const outcome = await Promise.race([
        dispatch,
        new Promise<"deadline">((resolve) => {
          timer = setTimeout(() => resolve("deadline"), dependencies.aiDispatchDeadlineMs);
        }),
      ]);
      if (outcome === "done") log.sweep_ai_dispatched = true;
      else log.sweep_ai_dispatch = "deadline";
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  if (failures > 0) {
    log.status = "failed";
    return done(1);
  }
  // «Пропущено» - не «в порядке»: шаг, который не бежал из-за бюджета, или запуск ИИ, не уложившийся в срок.
  const degraded = !intakeOpen || log.backlog === "degraded" || log.health_status === "skipped"
    || log.reconcile_status === "skipped" || log.sweep_ai_dispatch === "deadline";
  log.status = degraded ? "degraded" : "ok";
  return done(0);
}
