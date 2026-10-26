import "server-only";

import { AI_AGENT_RUNTIME_RPC } from "../../ai-agents/contract.ts";
import {
  AI_AGENT_CAP_OPEN_RUN_WINDOW_MINUTES,
  AI_AGENT_DAILY_BUDGET_REACHED_CODE,
  AI_AGENT_DAILY_SPEND_RPC,
  dailyCapRecordKey,
  dailyCapReachedMessage,
  evaluateWhatsappDailyCap,
  parseDailySpendFacts,
  readWhatsappDailyBudgetCents,
  type DailyCapDecision,
} from "../../ai-agents/daily-cap.ts";
import { callRpc, isRecord, resolveDeps, stringOrNull, type AiAgentsRuntimeDeps, type ServiceClient } from "./deps.ts";

/*
 * Дневной лимит расхода на запуски по входящему WhatsApp (решение владельца 26.10.2026, `$10` в день).
 * Правило и разбор — чистый `src/lib/ai-agents/daily-cap.ts`; здесь два вызова базы: прочитать расход агента за
 * сутки по Бишкеку (`ai_agent_runtime_daily_spend_v1`, миграция 322) и записать в «Запуски» одну строку
 * «лимит исчерпан» на агента и сутки — тем же приёмом, что строка паузы расписания (`recordPausedDeployment`):
 * резерв строки с ключом повтора и перевод в итоговый статус.
 */

export type WhatsappCapGate =
  | Readonly<{ ok: true; decision: DailyCapDecision }>
  /** Расход прочитать не удалось: запуск не стартует (лимит нельзя проверить — значит, нельзя и пропустить). */
  | Readonly<{ ok: false; code: string }>;

/**
 * Можно ли начинать запуск по WhatsApp этого агента сейчас. Не бросает. Время для «сегодняшних суток» — часы
 * приложения (`deps.now()`), их же получает база: день в базе и ключ строки «лимит исчерпан» совпадают.
 */
export async function gateWhatsappDailyCap(args: Readonly<{
  client: ServiceClient;
  organizationId: string;
  agentKey: string;
  runBudgetUsd: number;
  capCents: number;
  deps: AiAgentsRuntimeDeps;
}>): Promise<WhatsappCapGate> {
  const outcome = await callRpc(args.client, AI_AGENT_DAILY_SPEND_RPC, {
    p_organization_id: args.organizationId,
    p_key: args.agentKey,
    p_now: new Date(args.deps.now()).toISOString(),
    p_open_minutes: AI_AGENT_CAP_OPEN_RUN_WINDOW_MINUTES,
  });
  if (!outcome.ok) return { ok: false, code: outcome.code };
  const facts = parseDailySpendFacts(outcome.data);
  if (!facts) return { ok: false, code: "bad_shape" };
  return { ok: true, decision: evaluateWhatsappDailyCap({ capCents: args.capCents, runBudgetUsd: args.runBudgetUsd, facts }) };
}

/** Расход и резерв агента на сейчас — то, что видит сотрудник в строке лимита «Настроек». */
export type WhatsappCapState = Readonly<{ spentCents: number; reservedCents: number }>;

/**
 * Состояние лимита для страницы агента (только чтение, тем же вопросом, что решает приём события). Организация — из
 * проверенного актора страницы. Любой сбой (нет функции, база, форма ответа) — null: строка лимита тогда берёт
 * расход из графика и ничего не обещает про резерв. Не бросает.
 */
export async function readWhatsappDailyCapState(args: Readonly<{
  organizationId: string;
  agentKey: string;
  runBudgetUsd: number;
}>, overrides?: Partial<AiAgentsRuntimeDeps>): Promise<WhatsappCapState | null> {
  try {
    const deps = resolveDeps(overrides);
    const client = await deps.serviceClient();
    const gate = await gateWhatsappDailyCap({
      client,
      organizationId: args.organizationId,
      agentKey: args.agentKey,
      runBudgetUsd: args.runBudgetUsd,
      capCents: readWhatsappDailyBudgetCents(deps.env()),
      deps,
    });
    return gate.ok ? { spentCents: gate.decision.spentCents, reservedCents: gate.decision.reservedCents } : null;
  } catch {
    return null;
  }
}

export type DailyCapRecord = "recorded" | "known" | "skipped";

/**
 * Пишет в «Запуски» агента одну строку на сутки: статус «Остановлен по лимиту», код `daily_budget_reached`, слова
 * для сотрудника. Первая остановка за сутки создаёт строку, остальные находят её по ключу (`known`) и ничего не
 * добавляют: лента не засоряется сотнями строк, а агент и так не запущен до 00:00 по Бишкеку. Не бросает.
 * `skipped` — строку записать не удалось (в том числе идёт другой запуск по WhatsApp): запись повторится на
 * следующей остановке, а в журнале приложения остановка уже посчитана.
 */
export async function recordWhatsappDailyCapReached(args: Readonly<{
  client: ServiceClient;
  organizationId: string;
  target: Readonly<{ key: string; model: string | null; agentVersion: number | null }>;
  capCents: number;
  deps: AiAgentsRuntimeDeps;
}>): Promise<DailyCapRecord> {
  try {
    const nowMs = args.deps.now();
    const reserved = await callRpc(args.client, AI_AGENT_RUNTIME_RPC.runReserve, {
      p_organization_id: args.organizationId,
      p_key: args.target.key,
      p_trigger_kind: "whatsapp_inbound",
      p_dedupe_key: dailyCapRecordKey(nowMs),
      p_started_by_membership_id: null,
      p_send_authority_sha256: null,
      p_prompt_preview: "Новое сообщение в WhatsApp",
      p_model: args.target.model,
      p_agent_version: args.target.agentVersion,
    });
    if (!reserved.ok) return "skipped";
    const data = isRecord(reserved.data) ? reserved.data : {};
    const runId = data.reserved === true ? stringOrNull(data.runId) : null;
    if (!runId) return data.reason === "duplicate" ? "known" : "skipped";
    // Строка зарезервирована как «запускается»: без итогового статуса её закрыла бы сверка словами «сессия не
    // подтверждена», поэтому при сбое базы запись повторяется один раз.
    const patch = {
      status: "budget_reached",
      endedAt: new Date(nowMs).toISOString(),
      errorCode: AI_AGENT_DAILY_BUDGET_REACHED_CODE,
      errorMessage: dailyCapReachedMessage(args.capCents),
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const updated = await callRpc(args.client, AI_AGENT_RUNTIME_RPC.runUpdate, {
        p_organization_id: args.organizationId,
        p_run_id: runId,
        p_patch: patch,
      });
      if (updated.ok) return "recorded";
      if (updated.code === "55000" || updated.code === "22023" || updated.code === "P0002") break;
    }
    return "skipped";
  } catch {
    return "skipped";
  }
}
