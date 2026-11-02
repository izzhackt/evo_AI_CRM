"use server";

import { universityUuid } from "../platform-university-catalog";
import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import {
  PORTAL_CASE_MESSAGE_BODY_LIMIT,
  parsePortalCaseMessagePostReceipt,
  type PortalCaseMessageSendResult,
  type PortalCaseMessagesLoadResult,
} from "./messages";
import { readPortalCaseMessages } from "./messages-source";

const SEQUENCE_PATTERN = /^(0|[1-9][0-9]{0,18})$/;

/**
 * Обновление/догрузка треда для клиентского поллинга (PORT-5c). Реальная
 * граница — в RPC миграции 200 (гейт 192, assisted-only); здесь транспорт и
 * строгий разбор. Ошибка — честный { ok: false }, не пустой тред.
 */
export async function loadPortalCaseMessagesAction(
  beforeSequenceId: unknown,
): Promise<PortalCaseMessagesLoadResult> {
  try {
    await requireStudentPortalActor();
    if (
      beforeSequenceId !== null
      && (typeof beforeSequenceId !== "string" || !SEQUENCE_PATTERN.test(beforeSequenceId))
    ) {
      return { ok: false };
    }
    const page = await readPortalCaseMessages(beforeSequenceId);
    return { ok: true, page };
  } catch {
    return { ok: false };
  }
}

/**
 * Открытый чат снимает уведомление о сообщениях до показанного (миграция 330). Сбой не мешает читать:
 * уведомление останется, и студент снимет его в колокольчике.
 */
export async function markPortalCaseChatReadAction(upToSequenceId: unknown): Promise<{ ok: boolean }> {
  try {
    await requireStudentPortalActor();
    if (typeof upToSequenceId !== "string" || !SEQUENCE_PATTERN.test(upToSequenceId)) return { ok: false };
    const client = await createSupabaseServerClient();
    const { error } = await client
      .schema("platform")
      .rpc("mark_own_case_chat_notifications_read_v1", { p_up_to_sequence_id: upToSequenceId });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/**
 * Отправка сообщения по делу (PORT-5c, миграция 200). RPC идемпотентен по
 * request_id: повтор нажатия и retry сети возвращают исходный receipt,
 * дубль невозможен; тот же request_id с другим текстом сервер отклоняет
 * конфликтом — клиент держит requestId стабильным на попытку.
 */
export async function sendPortalCaseMessageAction(
  requestId: unknown,
  body: unknown,
): Promise<PortalCaseMessageSendResult> {
  try {
    await requireStudentPortalActor();
    const id = universityUuid(requestId);
    if (!id || typeof body !== "string") return { ok: false };
    const trimmed = body.trim();
    if (trimmed.length < 1 || trimmed.length > PORTAL_CASE_MESSAGE_BODY_LIMIT) {
      return { ok: false };
    }
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .schema("platform")
      .rpc("portal_case_chat_post_v1", {
        p_request_id: id,
        p_body: trimmed,
      });
    if (error) return { ok: false };
    const receipt = parsePortalCaseMessagePostReceipt(data);
    if (receipt === null || receipt.requestId !== id) return { ok: false };
    return { ok: true, receipt };
  } catch {
    return { ok: false };
  }
}
