import "server-only";

import type { AiAgentEventKind } from "../../ai-agents/contract.ts";
import { AI_AGENT_LIMITS, AI_AGENT_RUNTIME_RPC } from "../../ai-agents/contract.ts";
import { callRpc, isRecord, numberOr, resolveDeps, stringOrNull, truncate, type AiAgentsRuntimeDeps } from "./deps.ts";
import { readWhatsappDailyBudgetCents } from "../../ai-agents/daily-cap.ts";
import { gateWhatsappDailyCap, recordWhatsappDailyCapReached } from "./daily-cap.ts";
import { readOrganizationId } from "./env.ts";
import {
  anthropicFailure,
  anthropicRequestIdField,
  attachSessionToRun,
  closeOpenAiAgentRuns,
  createAgentSession,
  isAmbiguousSessionCreateFailure,
  sessionCreateFailurePatch,
} from "./runs.ts";

/*
 * Контракт §C.4. Хуки приёма заявки сайта и входящего WhatsApp зовут
 * `scheduleAiAgentEvent` и никогда не ждут: `dispatchAiAgentEvent` не бросает и
 * сама глотает любую ошибку. Работает только для включённых и синхронизированных
 * агентов с нужным триггером (решает БД: `dispatch_targets_v1`), только при
 * заданном ключе Claude API. Запуски по входящему WhatsApp, кроме того, стоят за дневным лимитом расхода агента
 * ($10 по умолчанию, сутки по Бишкеку; `daily-cap.ts`): исчерпан — запуск не стартует, а в «Запусках» агента
 * появляется строка с причиной `daily_budget_reached`. Заявки сайта этим лимитом не останавливаются.
 */

export type AiAgentEvent = Readonly<{ kind: AiAgentEventKind; ref: string | null }>;

const EVENT_PROMPTS: Readonly<Record<AiAgentEventKind, (ref: string | null) => string>> = {
  website_lead: (ref) =>
    `Событие: новая заявка с сайта (request_id=${ref ?? "неизвестен"}). Найди новый лид (list_leads, source=website, created_from=сегодня), `
    + "проверь дубли, оцени заявку и подготовь первое сообщение или задачу по инструкции.",
  whatsapp_inbound: () =>
    "Событие: новое входящее сообщение в WhatsApp продаж. Посмотри неотвеченные чаты (list_conversations, filter=unanswered), "
    + "для каждого прочитай переписку и подготовь ответ по инструкции.",
};

const EVENT_TITLES: Readonly<Record<AiAgentEventKind, string>> = {
  website_lead: "Новая заявка с сайта",
  whatsapp_inbound: "Входящее WhatsApp",
};

/** Ключ дедупликации: заявка — по id запроса; WhatsApp — не чаще одного запуска на агента за 5 минут. */
export function eventDedupeKey(event: AiAgentEvent, nowMs: number): string {
  const window = Math.floor(nowMs / 1_000 / AI_AGENT_LIMITS.eventDebounceSeconds);
  return event.kind === "website_lead" && event.ref ? `wl:${event.ref}` : `${event.kind === "website_lead" ? "wl" : "wa"}:${window}`;
}

/**
 * Запускает сессии включённых агентов под событие. Не бросает. Итог — одна
 * JSON-строка со счётчиками (без заявок, номеров и текстов).
 */
export async function dispatchAiAgentEvent(
  event: AiAgentEvent,
  overrides?: Partial<AiAgentsRuntimeDeps>,
): Promise<Readonly<{ started: number }>> {
  let started = 0;
  let targets = 0;
  let skipped = 0;
  let failed = 0;
  let capped = 0;
  const deps = resolveDeps(overrides);
  try {
    const anthropic = deps.anthropic();
    const organizationId = readOrganizationId(deps.env());
    if (!anthropic || !organizationId) return { started: 0 };

    const client = await deps.serviceClient();
    const listed = await callRpc(client, AI_AGENT_RUNTIME_RPC.dispatchTargets, {
      p_organization_id: organizationId,
      p_trigger_kind: event.kind,
    });
    const list = listed.ok && Array.isArray(listed.data) ? listed.data : [];
    targets = list.length;
    const dedupeKey = eventDedupeKey(event, deps.now());
    const text = EVENT_PROMPTS[event.kind](event.ref);
    // Дневной лимит касается только входящего WhatsApp: заявки сайта, расписание и поручения его не читают.
    const dailyCapCents = event.kind === "whatsapp_inbound" ? readWhatsappDailyBudgetCents(deps.env()) : 0;

    for (const raw of list) {
      if (!isRecord(raw)) continue;
      const key = stringOrNull(raw.key);
      const agentId = stringOrNull(raw.claudeAgentId);
      const environmentId = stringOrNull(raw.environmentId);
      const vaultId = stringOrNull(raw.vaultId);
      if (!key || !agentId || !environmentId || !vaultId) { skipped += 1; continue; }
      const version = numberOr(raw.agentVersion, NaN);
      try {
        if (event.kind === "whatsapp_inbound") {
          const gate = await gateWhatsappDailyCap({
            client,
            organizationId,
            agentKey: key,
            runBudgetUsd: numberOr(raw.runBudgetUsd, AI_AGENT_LIMITS.defaultRunBudgetUsd),
            capCents: dailyCapCents,
            deps,
          });
          if (!gate.ok) {
            // Расход прочитать не удалось: лимит не проверить, значит, запуск не начинаем (журнал — только код).
            failed += 1;
            deps.log({ op: "dispatch_cap", status: "error", agent: key, event: event.kind, code: gate.code });
            continue;
          }
          if (gate.decision.blocked) {
            capped += 1;
            skipped += 1;
            const decision = gate.decision;
            let record = "none";
            // Строка в «Запусках» — когда расход действительно дошёл до лимита; остановка только из-за резерва
            // под идущий запуск ничего не пишет (после него решение примется по настоящему расходу).
            if (decision.reason === "daily_budget_reached") {
              record = await recordWhatsappDailyCapReached({
                client,
                organizationId,
                target: { key, model: stringOrNull(raw.model), agentVersion: Number.isFinite(version) && version > 0 ? Math.floor(version) : null },
                capCents: dailyCapCents,
                deps,
              });
            }
            deps.log({
              op: "dispatch_cap", status: "ok", agent: key, event: event.kind, reason: decision.reason, record,
              cap_cents: decision.capCents, spent_cents: decision.spentCents, reserved_cents: decision.reservedCents,
            });
            continue;
          }
        }
        const reserve = () => callRpc(client, AI_AGENT_RUNTIME_RPC.runReserve, {
          p_organization_id: organizationId,
          p_key: key,
          p_trigger_kind: event.kind,
          p_dedupe_key: dedupeKey,
          p_started_by_membership_id: null,
          p_send_authority_sha256: null,
          p_prompt_preview: truncate(text, 500),
          p_model: stringOrNull(raw.model),
          p_agent_version: Number.isFinite(version) && version > 0 ? Math.floor(version) : null,
        });
        let reserved = await reserve();
        // Прошлый запуск по событию мог закончиться, пока никто не открывал раздел: закрываем его по сессии и пробуем ещё раз.
        if (reserved.ok && isRecord(reserved.data) && reserved.data.reason === "run_in_progress") {
          await closeOpenAiAgentRuns(anthropic, client, organizationId, key, deps);
          reserved = await reserve();
        }
        const reservation = reserved.ok && isRecord(reserved.data) ? reserved.data : null;
        const runId = reservation?.reserved === true ? stringOrNull(reservation.runId) : null;
        if (!runId) { skipped += 1; continue; }
        try {
          const sessionId = await createAgentSession(anthropic, {
            agentId,
            agentVersion: Number.isFinite(version) && version > 0 ? Math.floor(version) : null,
            environmentId,
            vaultId,
            title: truncate(`${stringOrNull(raw.title) ?? key} · ${EVENT_TITLES[event.kind]}`, 120),
            text,
            budgetUsd: numberOr(raw.runBudgetUsd, AI_AGENT_LIMITS.defaultRunBudgetUsd),
            runId,
            agentKey: key,
          });
          // Записать сессию не удалось — она остановлена (или нет), запуск не считается начатым.
          const link = await attachSessionToRun({ anthropic, client, organizationId, runId, sessionId, agentKey: key, deps });
          if (link.ok) started += 1; else failed += 1;
        } catch (error) {
          failed += 1;
          try {
            deps.log({
              op: "dispatch_run", status: "error", agent: key, event: event.kind, code: anthropicFailure(error).code,
              run_id: runId, ...(isAmbiguousSessionCreateFailure(error) ? { ambiguous: true } : {}), ...anthropicRequestIdField(error),
            });
          } catch {
            // журнал не должен ломать приём
          }
          await callRpc(client, AI_AGENT_RUNTIME_RPC.runUpdate, {
            p_organization_id: organizationId,
            p_run_id: runId,
            p_patch: sessionCreateFailurePatch(error),
          });
        }
      } catch {
        failed += 1;
      }
    }
  } catch {
    failed += 1;
  }
  try {
    deps.log({ op: "dispatch", status: failed > 0 ? "error" : "ok", event: event.kind, targets, started, skipped, failed, capped });
  } catch {
    // журнал не должен ломать приём
  }
  return { started };
}

/**
 * Вызывается хуком приёма ПОСЛЕ ответа: `after()` из `next/server`, а вне запроса
 * (тесты, скрипты) — обычный фон без ожидания. Не бросает и не блокирует.
 */
export function scheduleAiAgentEvent(event: AiAgentEvent): void {
  const task = async (): Promise<void> => {
    try {
      await dispatchAiAgentEvent(event);
    } catch {
      // dispatchAiAgentEvent и так не бросает
    }
  };
  try {
    // Динамический импорт: модули приёма грузятся и вне Next (тесты Node не знают «next/server» без расширения).
    import("next/server").then(
      (module) => {
        try {
          module.after(task);
        } catch {
          void task();
        }
      },
      () => { void task(); },
    ).catch(() => undefined);
  } catch {
    void task();
  }
}
