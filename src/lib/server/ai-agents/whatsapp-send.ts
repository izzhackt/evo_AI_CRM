import "server-only";

/*
 * ЗАГЛУШКА АРХИТЕКТОРА (контракт §C.5): файл принадлежит строителю C. Его зовут
 * MCP-сервер (B, инструмент send_message в режиме direct) и одобрение черновика
 * (C). Один путь: живая проверка сессии WAHA → ai_agent_runtime_whatsapp_authorize_v1
 * → executePlatformManualWhatsAppSend (claim → WAHA → finish) →
 * ai_agent_runtime_draft_mark_v1. Не бросает: итог — в результате.
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

export async function sendAiAgentWhatsAppDraft(
  _input: Readonly<{
    organizationId: string;
    draftId: string;
    /** Кто отправитель в журнале WhatsApp: утвердивший сотрудник или ответственный из настроек организации. */
    senderMembershipId: string;
    requestId: string;
  }>,
): Promise<AiAgentWhatsAppSendResult> {
  throw new Error("ai_agents_whatsapp_send_not_implemented");
}
