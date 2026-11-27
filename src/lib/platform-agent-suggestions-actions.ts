"use server";

/**
 * Серверные действия карточки дела для агента-куратора (миграция 383): «Предложить шаг», «Собрать передачу»,
 * «Принять» / «Не то» и опрос запуска. Тонкие обёртки: сотрудник проверяется здесь (вошёл, не просмотр роли, держатель
 * записи шага дела), а право на дело и запись шага решает база (RPC сотрудника, те же, что у «Следующего шага»).
 * Запуск агента идёт существующим путём «Поручить» (`startAiAgentRun`, право ai.agent.use проверяет база); агент выключен,
 * не синхронизирован или ключа Claude нет — сотрудник получает понятное слово из `wording.ts`, а не падение. Шаг агент сам
 * не пишет: он только предлагает, принимает человек.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import type { AgentSuggestionStatus } from "./agent-suggestions-contract.ts";
import { runErrorWords } from "./v3/ai-agents-view.ts";
import { isStaffPreview, staffCan } from "./platform-access.ts";
import { resolvePlatformActor, type ActivePlatformActor } from "./platform-auth";
import { AgentSuggestionError, decideAgentSuggestion } from "./platform-agent-suggestions";
import { agentWorkFailed, runAgentWork, type AgentWorkActionState } from "./platform-agent-work";
import { parseExpectedAdmissionsVersion, parseQueueUuid } from "./platform-student-case-queue-contract.ts";
import { exactActionStringFields } from "./server/action-form-fields";
import { pollAiAgentRun, type AiAgentsStaffContext } from "./server/ai-agents/runtime.ts";
import { createSupabaseServerClient } from "./supabase/server";
import { agentSuggestionOutcome } from "./v3/wording";

const CONTROL = /[\u0000-\u001f\u007f]/u;
const DIRECTION = /^[A-Za-z]{2,12}$/u;
const COUNTRY_MAX = 80;
const DISMISS_REASON_MAX = 300;

/* ----------------------------------------------------------- запуск агента */

type Authorized =
  | Readonly<{ ok: true; actor: ActivePlatformActor; ctx: AiAgentsStaffContext }>
  | Readonly<{ ok: false; code: "forbidden" | "preview_read_only" }>;

async function authorize(): Promise<Authorized> {
  const result = await resolvePlatformActor();
  if (result.status !== "authenticated") return { ok: false, code: "forbidden" };
  const actor = result.actor;
  if (isStaffPreview(actor)) return { ok: false, code: "preview_read_only" };
  // Те же держатели, что у записи шага дела; саму запись и право на дело решает база.
  if (!staffCan(actor, "admissions.write")) return { ok: false, code: "forbidden" };
  return { ok: true, actor, ctx: { staffClient: await createSupabaseServerClient(), actor } };
}

/**
 * «Предложить шаг» (`kind=next_step`) и «Собрать передачу» (`kind=handoff`): поручение агенту-куратору по стране и
 * направлению дела. Поля: `student_case_id`, `kind`, `direction`, `country`, `request_id`.
 */
export async function requestAgentWorkAction(_previous: AgentWorkActionState, form: FormData): Promise<AgentWorkActionState> {
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, ["student_case_id", "kind", "direction", "country", "request_id"]);
    requestId = parseQueueUuid(fields?.get("request_id"));
    const studentCaseId = parseQueueUuid(fields?.get("student_case_id"));
    const kind = fields?.get("kind");
    const direction = (fields?.get("direction") ?? "").trim();
    const country = (fields?.get("country") ?? "").trim();
    if (!fields || !requestId || !studentCaseId || (kind !== "next_step" && kind !== "handoff")
      || (direction !== "" && !DIRECTION.test(direction)) || [...country].length > COUNTRY_MAX || CONTROL.test(country)) {
      return agentWorkFailed("invalid_input", requestId);
    }
    const access = await authorize();
    if (!access.ok) return agentWorkFailed(access.code, requestId);
    return await runAgentWork(access.ctx, {
      kind, studentCaseId, direction: direction || null, country: country || null, requestId,
    });
  } catch {
    return agentWorkFailed("unavailable", requestId);
  }
}

export type AgentWorkPoll =
  | Readonly<{ state: "running" }>
  | Readonly<{ state: "done" }>
  | Readonly<{ state: "failed"; message: string }>
  | Readonly<{ state: "unavailable" }>;

/** Опрос запуска «Агент думает…»: закончился ли он и чем (слова ошибки — из словаря раздела «ИИ-агенты»). */
export async function pollAgentWorkAction(runId: string): Promise<AgentWorkPoll> {
  try {
    if (!parseQueueUuid(runId)) return { state: "unavailable" };
    const result = await resolvePlatformActor();
    if (result.status !== "authenticated") return { state: "unavailable" };
    const polled = await pollAiAgentRun({ staffClient: await createSupabaseServerClient(), actor: result.actor }, { runId, cursor: null });
    if (!polled.ok) return { state: "unavailable" };
    const { run, done } = polled.poll;
    if (run.status === "failed" || run.status === "needs_attention" || run.status === "budget_reached" || run.status === "interrupted") {
      return { state: "failed", message: runErrorWords(run.errorCode ?? run.status, run.errorMessage) };
    }
    return done || run.status === "completed" ? { state: "done" } : { state: "running" };
  } catch {
    return { state: "unavailable" };
  }
}

/* ------------------------------------------------------ «Принять» / «Не то» */

export type AgentSuggestionActionState = Readonly<{
  status: "idle" | AgentSuggestionStatus;
  requestId: string;
  message: string | null;
  /** Новая версия дела после «Принять», чтобы строка шага обновилась без перечитывания. */
  receipt: Readonly<{ nextAction: string | null; nextActionDueOn: string | null; admissionsVersion: string }> | null;
}>;

function decisionOutcome(status: Exclude<AgentSuggestionStatus, "accepted" | "dismissed">, requestId: string | null): AgentSuggestionActionState {
  // Прежний id остаётся только при неизвестном исходе: база отдаст прежнюю квитанцию, а не запишет шаг второй раз.
  const keep = status === "unavailable" && requestId !== null;
  return { status, requestId: keep ? requestId : randomUUID(), message: agentSuggestionOutcome(status), receipt: null };
}

const DECISION_FIELDS = ["suggestion_id", "student_case_id", "decision", "expected_version", "dismiss_reason", "request_id"] as const;

/**
 * «Принять» (шаг пишет база существующим `set_case_next_action_v1` с версией дела сотрудника) и «Не то» (короткая причина,
 * необязательна). Права — те же, что у записи шага; чужую организацию и чужое предложение база отвечает отказом.
 */
export async function decideAgentSuggestionAction(
  _previous: AgentSuggestionActionState,
  form: FormData,
): Promise<AgentSuggestionActionState> {
  let requestId: string | null = null;
  try {
    const fields = exactActionStringFields(form, DECISION_FIELDS);
    requestId = parseQueueUuid(fields?.get("request_id"));
    const suggestionId = parseQueueUuid(fields?.get("suggestion_id"));
    const studentCaseId = parseQueueUuid(fields?.get("student_case_id"));
    const decision = fields?.get("decision");
    const rawReason = (fields?.get("dismiss_reason") ?? "").replace(/\s+/gu, " ").trim();
    const expectedVersion = decision === "accept" ? parseExpectedAdmissionsVersion(fields?.get("expected_version")) : null;
    if (!fields || !requestId || !suggestionId || !studentCaseId || (decision !== "accept" && decision !== "dismiss")
      || (decision === "accept" && (expectedVersion === null || rawReason !== ""))
      || [...rawReason].length > DISMISS_REASON_MAX || CONTROL.test(rawReason)) {
      return decisionOutcome("invalid", requestId);
    }
    const access = await authorize();
    if (!access.ok) {
      return access.code === "preview_read_only"
        ? { status: "preview", requestId: randomUUID(), message: agentSuggestionOutcome("preview"), receipt: null }
        : decisionOutcome("forbidden", requestId);
    }
    const decided = await decideAgentSuggestion(access.actor, {
      suggestionId, decision, expectedVersion, dismissReason: rawReason || null, requestId,
    });
    revalidatePath("/profile");
    return {
      status: decided.status,
      requestId: randomUUID(),
      message: agentSuggestionOutcome(decided.status),
      receipt: decided.receipt,
    };
  } catch (error) {
    return decisionOutcome(error instanceof AgentSuggestionError ? error.status : "unavailable", requestId);
  }
}
