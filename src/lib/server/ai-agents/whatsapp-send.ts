import "server-only";

import { createHash } from "node:crypto";

import { AI_AGENT_RUNTIME_RPC, AI_AGENT_LIMITS } from "../../ai-agents/contract.ts";
import type { PlatformManualWhatsAppSendAuthorization, PlatformProviderRpcClient } from "../../platform-provider-workflows.ts";
import { uuidV5 } from "../ai-agent-send.ts";
import { executePlatformManualWhatsAppSend, type PlatformManualWhatsAppSendExecutionResult } from "../platform-provider-orchestrator.ts";
import { callRpc, isRecord, type RpcOutcome } from "./deps.ts";

/*
 * Контракт §C.5. Один путь отправки ответа агента клиенту в WhatsApp: живая
 * проверка сессии WAHA → ai_agent_runtime_whatsapp_authorize_v1 (БД проверяет
 * правила и переводит черновик approved → sending) →
 * executePlatformManualWhatsAppSend (claim → WAHA → finish) →
 * ai_agent_runtime_draft_mark_v1. Машину состояний черновика ведёт БД. Функция
 * не бросает: итог — в результате. Образец — ai-agent-send.ts (автоответчик).
 *
 * Не проверено на живом WhatsApp: сессия crm_primary отключена; путь проверяется
 * тестами с подставным провайдером.
 */

export type AiAgentWhatsAppSendResult = Readonly<{
  /** `sent` — WAHA принял; `unknown` — итог неизвестен, проверьте чат; `failed` — не отправлено, черновик остался (pending или failed). */
  status: "sent" | "unknown" | "failed";
  failureCode:
    | null
    | "whatsapp_unavailable"
    | "conversation_moved_on"
    | "conversation_closed"
    | "rate_limited"
    | "staff_active"
    | "unknown_result"
    | "provider_error"
    | "unavailable";
}>;

export type AiAgentWhatsAppSendInput = Readonly<{
  organizationId: string;
  draftId: string;
  /** Кто отправитель в журнале WhatsApp: утвердивший сотрудник или ответственный из настроек организации. */
  senderMembershipId: string;
  requestId: string;
}>;

export type AiAgentWhatsAppSendDependencies = Readonly<{
  serviceClient(): Promise<PlatformProviderRpcClient>;
  /** Статус сессии WAHA сейчас, без кэша; null — проверка не может сказать. */
  probe(organizationId: string): Promise<string | null>;
  execute(
    client: PlatformProviderRpcClient,
    input: Readonly<{
      authorization: PlatformManualWhatsAppSendAuthorization;
      visibilityTimeoutSeconds: number;
      workerRef: string;
      claimRequestId: string;
      completionRequestId: string;
    }>,
  ): Promise<PlatformManualWhatsAppSendExecutionResult>;
  sleep(milliseconds: number): Promise<void>;
  now(): number;
  log(line: Readonly<Record<string, unknown>>): void;
}>;

/** Пространство имён UUIDv5 шагов отправки одного черновика (claim, finish, authorize). */
export const AI_AGENT_SEND_ID_NAMESPACE = "5a1c7e38-2b94-5d06-8f13-9c4e0b7d6a21";
export const AI_AGENT_SEND_WORKER_REF = "ai-agent-send";
/** Аренда claim: больше одной отправки в WAHA (20 с) с запасом. */
export const AI_AGENT_SEND_VISIBILITY_TIMEOUT_SECONDS = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REASON = /^[a-z][a-z0-9_]{0,63}$/u;
const STEP_RETRY_DELAYS_MS = [250, 1_000] as const;

const uuid = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value.toLowerCase()) ? value.toLowerCase() : null;

export function aiAgentSendStepId(draftId: string, requestId: string, step: string): string {
  return uuidV5(AI_AGENT_SEND_ID_NAMESPACE, `${draftId}:${requestId}:${step}`);
}

const SAFE_REFUSALS: readonly string[] = ["whatsapp_unavailable", "conversation_moved_on", "conversation_closed", "rate_limited", "staff_active"];

export type ParsedAiAgentAuthorization =
  | Readonly<{ kind: "authorized"; replayed: boolean; authorization: PlatformManualWhatsAppSendAuthorization }>
  | Readonly<{ kind: "refused"; reason: string }>
  | Readonly<{ kind: "unavailable" }>;

/**
 * Ответ `ai_agent_runtime_whatsapp_authorize_v1` → авторизация для общего кода
 * отправки. Отказ — `{authorized:false, reason}`; успех — поля ответа ручной
 * отправки (050/266). Текст берётся только у базы, CRM ещё раз сверяет его
 * SHA-256. Любая другая форма — сбой: в WhatsApp ничего не уходит.
 */
export function parseAiAgentWhatsAppAuthorization(
  data: unknown,
  expected: Readonly<{ organizationId: string; observedAt: string }>,
): ParsedAiAgentAuthorization {
  if (!isRecord(data)) return { kind: "unavailable" };
  if (data.authorized === false) {
    return typeof data.reason === "string" && REASON.test(data.reason) ? { kind: "refused", reason: data.reason } : { kind: "unavailable" };
  }
  if (data.authorized !== true || typeof data.replayed !== "boolean") return { kind: "unavailable" };
  const organizationId = uuid(data.organization_id);
  const authorizationId = uuid(data.manual_send_authorization_id);
  const conversationId = uuid(data.communication_conversation_id);
  const sourceMessageId = uuid(data.source_message_id);
  const authorId = uuid(data.authorized_by_membership_id);
  const requestedBy = uuid(data.requested_by_membership_id);
  const workItemId = uuid(data.work_item_id);
  const finalText = data.final_text;
  const finalTextSha256 = data.final_text_sha256;
  const queueMessageId = typeof data.queue_message_id === "number" && Number.isSafeInteger(data.queue_message_id) && data.queue_message_id > 0
    ? String(data.queue_message_id)
    : typeof data.queue_message_id === "string" && /^[1-9]\d{0,18}$/u.test(data.queue_message_id) ? data.queue_message_id : null;
  if (
    organizationId !== expected.organizationId || !authorizationId || !conversationId || !sourceMessageId || !authorId || !workItemId
    || requestedBy !== authorId
    || (data.ai_draft_id !== null && data.ai_draft_id !== undefined)
    || typeof finalText !== "string" || finalText.length < 1 || finalText.length > AI_AGENT_LIMITS.whatsappTextMaxChars
    || typeof finalTextSha256 !== "string" || !SHA256.test(finalTextSha256)
    || createHash("sha256").update(finalText, "utf8").digest("hex") !== finalTextSha256
    || data.state !== "manual_send_authorized"
    || (data.replayed ? typeof data.work_state !== "string" || !REASON.test(data.work_state) : data.work_state !== "queued")
    || typeof data.business_key_sha256 !== "string" || !SHA256.test(data.business_key_sha256)
    || queueMessageId === null
    || data.waha_readiness !== "ready" || data.waha_readiness_evidence_kind !== "provider_observed" || data.waha_readiness_fresh !== true
  ) {
    return { kind: "unavailable" };
  }
  const observedAt = typeof data.waha_readiness_observed_at === "string" && Number.isFinite(Date.parse(data.waha_readiness_observed_at))
    ? data.waha_readiness_observed_at : expected.observedAt;
  return {
    kind: "authorized",
    replayed: data.replayed,
    authorization: Object.freeze({
      organizationId,
      manualSendAuthorizationId: authorizationId,
      communicationConversationId: conversationId,
      sourceMessageId,
      aiDraftId: null,
      finalText,
      finalTextSha256,
      authorizedByMembershipId: authorId,
      state: "manual_send_authorized" as const,
      requestedByMembershipId: authorId,
      workItemId,
      workState: "queued" as const,
      queueMessageId,
      businessKeySha256: data.business_key_sha256,
      wahaReadiness: "ready" as const,
      wahaReadinessEvidenceKind: "provider_observed" as const,
      wahaReadinessFresh: true as const,
      wahaReadinessObservedAt: observedAt,
    }),
  };
}

const defaultDependencies: AiAgentWhatsAppSendDependencies = {
  async serviceClient() {
    const [{ getPlatformSupabaseBackendConfig }, { createPlatformSupabaseServiceClient }] = await Promise.all([
      import("../platform-supabase-backend-config.ts"),
      import("../platform-supabase-service-client.ts"),
    ]);
    return createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()) as unknown as PlatformProviderRpcClient;
  },
  async probe(organizationId) {
    const { probePlatformWahaSessionLiveUncached } = await import("../platform-waha-live-health.ts");
    return (await probePlatformWahaSessionLiveUncached(organizationId))?.status ?? null;
  },
  execute: (client, input) => executePlatformManualWhatsAppSend(client, input, {}, { quoteSource: false }),
  sleep: (milliseconds) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); }),
  now: () => Date.now(),
  log(line) {
    console.info(JSON.stringify({ event: "ai_agents_whatsapp_send", ...line }));
  },
};

type MarkInput = Readonly<{
  organizationId: string;
  draftId: string;
  status: "pending" | "failed" | "sent";
  failureCode: string | null;
  senderMembershipId: string | null;
  provider: Readonly<Record<string, string | null>> | null;
}>;

async function mark(client: PlatformProviderRpcClient, input: MarkInput, deps: AiAgentWhatsAppSendDependencies): Promise<boolean> {
  for (let attempt = 0; attempt <= STEP_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await deps.sleep(STEP_RETRY_DELAYS_MS[attempt - 1]!);
    const outcome: RpcOutcome = await callRpc(client, AI_AGENT_RUNTIME_RPC.draftMark, {
      p_organization_id: input.organizationId,
      p_draft_id: input.draftId,
      p_status: input.status,
      p_failure_code: input.failureCode,
      p_sent_by_membership_id: input.senderMembershipId,
      p_provider: input.provider,
    });
    if (outcome.ok) return true;
    // Переход не разрешён (черновик уже в другом состоянии) — повторять нечего.
    if (outcome.code === "55000" || outcome.code === "P0002" || outcome.code === "42501") return false;
  }
  return false;
}

/**
 * Отправляет одобренный (или созданный в режиме direct) WhatsApp-черновик.
 * Не бросает: любая непредвиденная ошибка — `failed/unavailable`, а если
 * черновик уже `sending`, итог неизвестен — `unknown` и `failed('unknown_result')`.
 */
export async function sendAiAgentWhatsAppDraft(
  input: AiAgentWhatsAppSendInput,
  dependencies: AiAgentWhatsAppSendDependencies = defaultDependencies,
): Promise<AiAgentWhatsAppSendResult> {
  const deps = dependencies;
  let client: PlatformProviderRpcClient | null = null;
  let sending = false;
  try {
    client = await deps.serviceClient();
    const org = input.organizationId;

    // 1. Живая проверка сессии WAHA, без кэша.
    const status = await deps.probe(org).catch(() => null);
    if (status !== "WORKING") {
      await mark(client, { organizationId: org, draftId: input.draftId, status: "pending", failureCode: "whatsapp_unavailable", senderMembershipId: null, provider: null }, deps);
      return { status: "failed", failureCode: "whatsapp_unavailable" };
    }

    // 2. Авторизация базы: правила, отправитель, лимиты; approved → sending.
    const observedAt = new Date(deps.now()).toISOString();
    const authorize = await callRpc(client, AI_AGENT_RUNTIME_RPC.whatsappAuthorize, {
      p_organization_id: org,
      p_draft_id: input.draftId,
      p_sender_membership_id: input.senderMembershipId,
      p_provider_status: "WORKING",
      p_request_id: aiAgentSendStepId(input.draftId, input.requestId, "authorize"),
    });
    if (!authorize.ok) return { status: "failed", failureCode: "unavailable" };
    const parsed = parseAiAgentWhatsAppAuthorization(authorize.data, { organizationId: org, observedAt });
    if (parsed.kind === "refused") {
      const code = SAFE_REFUSALS.includes(parsed.reason) ? (parsed.reason as AiAgentWhatsAppSendResult["failureCode"]) : "unavailable";
      return { status: "failed", failureCode: code };
    }
    if (parsed.kind !== "authorized") return { status: "failed", failureCode: "unavailable" };
    sending = true;

    // 3. claim → WAHA → finish тем же кодом, что у ручной отправки.
    const execution = await deps.execute(client, {
      authorization: parsed.authorization,
      visibilityTimeoutSeconds: AI_AGENT_SEND_VISIBILITY_TIMEOUT_SECONDS,
      workerRef: AI_AGENT_SEND_WORKER_REF,
      claimRequestId: aiAgentSendStepId(input.draftId, input.requestId, "claim"),
      completionRequestId: aiAgentSendStepId(input.draftId, input.requestId, "complete"),
    });
    // Работу уже взял другой запрос (или повтор уже начатой отправки): итог за ним, черновик не трогаем.
    if (execution.status === "not_claimed") {
      deps.log({ op: "whatsapp_send", status: "not_claimed", replayed: parsed.replayed });
      return { status: "unknown", failureCode: "unknown_result" };
    }

    // 4. Итог → черновик.
    const outcome = execution.result.outcome;
    if (outcome === "succeeded") {
      const marked = await mark(client, {
        organizationId: org,
        draftId: input.draftId,
        status: "sent",
        failureCode: null,
        senderMembershipId: input.senderMembershipId,
        provider: {
          messageId: execution.result.communicationMessageId,
          authorizationId: parsed.authorization.manualSendAuthorizationId,
          workItemId: parsed.authorization.workItemId,
        },
      }, deps);
      // Сообщение ушло: запись итога не отменяет факт отправки.
      if (!marked) deps.log({ op: "whatsapp_send", status: "mark_failed", outcome });
      return { status: "sent", failureCode: null };
    }
    if (outcome === "terminal_error") {
      await mark(client, { organizationId: org, draftId: input.draftId, status: "failed", failureCode: "provider_error", senderMembershipId: input.senderMembershipId, provider: null }, deps);
      return { status: "failed", failureCode: "provider_error" };
    }
    await mark(client, { organizationId: org, draftId: input.draftId, status: "failed", failureCode: "unknown_result", senderMembershipId: input.senderMembershipId, provider: null }, deps);
    return { status: "unknown", failureCode: "unknown_result" };
  } catch {
    deps.log({ op: "whatsapp_send", status: "error", sending });
    if (sending && client) {
      await mark(client, { organizationId: input.organizationId, draftId: input.draftId, status: "failed", failureCode: "unknown_result", senderMembershipId: input.senderMembershipId, provider: null }, deps).catch(() => false);
      return { status: "unknown", failureCode: "unknown_result" };
    }
    return { status: "failed", failureCode: "unavailable" };
  }
}
