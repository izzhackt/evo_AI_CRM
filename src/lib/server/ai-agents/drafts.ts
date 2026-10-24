import "server-only";

import {
  AI_AGENT_LIMITS,
  AI_AGENT_RUNTIME_RPC,
  AI_AGENT_STAFF_RPC,
  type AiAgentDraftDecisionResult,
  type AiAgentDraftStatus,
  AI_AGENT_DRAFT_STATUSES,
} from "../../ai-agents/contract.ts";
import { isStaffPreview } from "../../platform-access.ts";
import { callRpc, failureHas, isRecord, resolveDeps, stringOrNull, UUID_PATTERN, type AiAgentsRuntimeDeps, type AiAgentsStaffContext } from "./deps.ts";
import { aiAgentSendStepId, sendAiAgentWhatsAppDraft, type AiAgentWhatsAppSendDependencies, type AiAgentWhatsAppSendInput, type AiAgentWhatsAppSendResult } from "./whatsapp-send.ts";

/*
 * Контракт §C.2.6: решение сотрудника по черновику агента. Право и состояние
 * проверяет БД (`ai_agents_draft_decide_v1`); одобренный черновик кабинета
 * уходит сразу в чат дела, WhatsApp — общим путём отправки (whatsapp-send.ts).
 * Итоговый статус и код отказа читаются из БД после попытки: машину состояний
 * ведёт она.
 */

export type DecideDraftExtras = Readonly<{
  /** Подмена отправки WhatsApp для тестов. */
  sendWhatsApp?: (input: AiAgentWhatsAppSendInput, dependencies?: AiAgentWhatsAppSendDependencies) => Promise<AiAgentWhatsAppSendResult>;
}>;

const DRAFT_STATUSES: readonly string[] = AI_AGENT_DRAFT_STATUSES;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function bad(code: Extract<AiAgentDraftDecisionResult, { ok: false }>["code"], message: string): AiAgentDraftDecisionResult {
  return { ok: false, code, message };
}

const asStatus = (value: unknown): AiAgentDraftStatus | null =>
  typeof value === "string" && DRAFT_STATUSES.includes(value) ? (value as AiAgentDraftStatus) : null;

export async function decideAiAgentDraftImpl(
  ctx: AiAgentsStaffContext,
  input: Readonly<{ draftId: string; decision: "approve" | "discard"; editedText?: string | null; requestId: string }>,
  overrides?: Partial<AiAgentsRuntimeDeps>,
  extras: DecideDraftExtras = {},
): Promise<AiAgentDraftDecisionResult> {
  if (isStaffPreview(ctx.actor)) return bad("preview_read_only", "В режиме просмотра роли решения недоступны");
  const edited = input.editedText ?? null;
  if (
    !UUID_PATTERN.test(input.draftId) || !UUID_PATTERN.test(input.requestId)
    || (input.decision !== "approve" && input.decision !== "discard")
    || (edited !== null && (typeof edited !== "string" || !edited.trim() || edited.length > AI_AGENT_LIMITS.portalTextMaxChars || CONTROL_CHARACTERS.test(edited)))
    || (input.decision === "discard" && edited !== null)
  ) {
    return bad("invalid_input", "Проверьте текст сообщения");
  }
  const deps = resolveDeps(overrides);
  const organizationId = ctx.actor.organizationId;

  // 1. Решение — RPC сотрудника: право, срок и состояние проверяет база.
  const decided = await callRpc(ctx.staffClient, AI_AGENT_STAFF_RPC.draftDecide, {
    p_organization_id: organizationId,
    p_draft_id: input.draftId,
    p_decision: input.decision,
    p_edited_text: edited,
    p_request_id: input.requestId,
  });
  if (!decided.ok) {
    if (decided.code === "42501") return bad("forbidden", "Нет права решать по сообщениям ИИ-агентов");
    if (decided.code === "55000" || failureHas(decided, "ai_agent_draft_not_pending")) return bad("not_pending", "Это сообщение уже обработано или устарело");
    if (decided.code === "22023" || decided.code === "40001") return bad("invalid_input", "Проверьте текст сообщения");
    deps.log({ op: "draft_decide", status: "error", code: decided.code });
    return bad("unavailable", "Не удалось сохранить решение. Повторите позже");
  }
  const result = isRecord(decided.data) ? decided.data : {};
  if (input.decision === "discard") return { ok: true, status: "discarded", failureCode: null };

  const channel = result.channel;
  const approver = stringOrNull(result.approverMembershipId) ?? ctx.actor.membershipId;

  // 2. Одобренное уходит сразу.
  if (channel === "portal") {
    const sent = await callRpc(await deps.serviceClient(), AI_AGENT_RUNTIME_RPC.portalSend, {
      p_organization_id: organizationId,
      p_draft_id: input.draftId,
      p_sender_membership_id: approver,
      p_request_id: aiAgentSendStepId(input.draftId, input.requestId, "portal"),
    });
    if (sent.ok) return { ok: true, status: "sent", failureCode: null };
    if (sent.code === "P0002") {
      await callRpc(await deps.serviceClient(), AI_AGENT_RUNTIME_RPC.draftMark, {
        p_organization_id: organizationId,
        p_draft_id: input.draftId,
        p_status: "failed",
        p_failure_code: "target_not_found",
        p_sent_by_membership_id: null,
        p_provider: null,
      });
      return { ok: true, status: "failed", failureCode: "target_not_found" };
    }
    deps.log({ op: "draft_portal_send", status: "error", code: sent.code });
    return bad("unavailable", "Не удалось отправить в кабинет студента. Повторите позже");
  }

  if (channel === "whatsapp") {
    const send = extras.sendWhatsApp ?? sendAiAgentWhatsAppDraft;
    const outcome = await send({ organizationId, draftId: input.draftId, senderMembershipId: approver, requestId: input.requestId });
    // Итог и код отказа — из БД: она сама вернула черновик в pending или пометила failed.
    const read = await callRpc(await deps.serviceClient(), AI_AGENT_RUNTIME_RPC.draftGet, {
      p_organization_id: organizationId,
      p_draft_id: input.draftId,
    });
    const row = read.ok && isRecord(read.data) ? read.data : null;
    const status = asStatus(row?.status);
    if (status) return { ok: true, status, failureCode: stringOrNull(row?.failureCode) ?? outcome.failureCode };
    if (outcome.status === "sent") return { ok: true, status: "sent", failureCode: null };
    if (outcome.status === "unknown") return { ok: true, status: "failed", failureCode: "unknown_result" };
    return bad("unavailable", "Не удалось отправить в WhatsApp. Повторите позже");
  }

  return bad("unavailable", "Не удалось определить канал сообщения");
}
