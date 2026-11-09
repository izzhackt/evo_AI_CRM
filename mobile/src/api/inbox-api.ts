// Чтения и записи «Входящих» через RPC схемы `platform`
// (web-portal-spec.md §2.3 п. 5). Транспорт приходит аргументом.
import {
  decodeChatPage,
  decodePostReceipt,
  decodePoll,
  type PollResult,
  type PollSection,
  type PortalCaseMessagePostReceipt,
  type PortalCaseMessagesPage,
} from "@/domain/inbox-model";
import { createWrite, rpcRead, rpcWrite, type FrozenWrite, type RpcTransport } from "@/lib/rpc";

/** Страница чата, новые первыми. Первая страница: аргумент опускается (GET не передаёт null). */
export async function readChatPage(transport: RpcTransport, before: string | null = null): Promise<PortalCaseMessagesPage> {
  const args = before === null ? {} : { p_before_sequence_id: before };
  return decodeChatPage(await rpcRead(transport, "portal_case_chat_page_v1", args, { get: true }));
}

/** Запись сообщения замораживается один раз на попытку: повтор шлёт тот же id и тот же текст. */
export function chatPostWrite(body: string, newId?: () => string): FrozenWrite {
  return createWrite("portal_case_chat_post_v1", { p_body: body }, newId ? { newId } : {});
}

export async function postChatMessage(transport: RpcTransport, write: FrozenWrite): Promise<PortalCaseMessagePostReceipt> {
  return decodePostReceipt(await rpcWrite(transport, write), write.requestId);
}

/**
 * «Чат прочитан до …». У функции нет `p_request_id` (она идемпотентна по смыслу:
 * снимает уведомления до номера), поэтому это обычный POST, а не замороженная запись.
 */
export async function markChatRead(transport: RpcTransport, upToSequenceId: string): Promise<void> {
  await rpcRead(transport, "mark_own_case_chat_notifications_read_v1", { p_up_to_sequence_id: upToSequenceId }, { get: false });
}

/** «Прочитано» для одного уведомления; id детерминированный, повтор безопасен. */
export function notificationReadWrite(notificationId: string, requestId: string): FrozenWrite {
  return createWrite("mark_own_student_portal_notification_read_v2", { p_notification_id: notificationId }, { requestId });
}

export async function sendNotificationRead(transport: RpcTransport, write: FrozenWrite): Promise<void> {
  await rpcWrite(transport, write);
}

/** Лёгкий опрос: число непрочитанных и отпечаток раздела (`student_portal_poll_v1`, STABLE). */
export async function readPoll(transport: RpcTransport, section: PollSection): Promise<PollResult> {
  return decodePoll(await rpcRead(transport, "student_portal_poll_v1", { p_section: section }, { get: true }));
}
