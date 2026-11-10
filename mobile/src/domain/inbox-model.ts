// «Входящие»: чистая модель чата и ленты «Что нового». Разбор страниц, слияние,
// состояния отправки, счётчик непрочитанного, раздел опроса и детерминированный
// request id «прочитано» (UUIDv5) считаются здесь без React и сети.
// Образец: src/components/portal/messages/*, src/lib/portal/messages*.ts (веб #1412).
import {
  PORTAL_CASE_MESSAGE_BODY_LIMIT,
  mergePortalCaseMessages,
  parsePortalCaseMessagePostReceipt,
  parsePortalCaseMessagesPage,
  type PortalCaseChatAwaitState,
  type PortalCaseMessage,
  type PortalCaseMessagePostReceipt,
  type PortalCaseMessagesPage,
} from "@web/lib/portal/messages";

import { PortalDecodeError, type StudentPortalNotification } from "@/domain/portal-source";
import type { SectionId } from "@/shell/sections";

export { PORTAL_CASE_MESSAGE_BODY_LIMIT, mergePortalCaseMessages };
export type { PortalCaseChatAwaitState, PortalCaseMessage, PortalCaseMessagePostReceipt, PortalCaseMessagesPage };

export function decodeChatPage(data: unknown): PortalCaseMessagesPage {
  const page = parsePortalCaseMessagesPage(data);
  if (!page) throw new PortalDecodeError();
  return page;
}

export function decodePostReceipt(data: unknown, requestId: string): PortalCaseMessagePostReceipt {
  const receipt = parsePortalCaseMessagePostReceipt(data);
  // Квитанция обязана подтвердить именно эту отправку.
  if (!receipt || receipt.requestId !== requestId.toLowerCase()) throw new PortalDecodeError();
  return receipt;
}

/** Текст к отправке: обрезка пробелов, 1..2000 символов; иначе `null`. */
export function prepareBody(draft: string): string | null {
  const body = draft.trim();
  return body.length >= 1 && body.length <= PORTAL_CASE_MESSAGE_BODY_LIMIT ? body : null;
}

// ---- отправка ------------------------------------------------------------------

/** Сообщение в пути: пока сервер не подтвердил, показывается внизу ленты. */
export type OutboxItem = Readonly<{ requestId: string; body: string; status: "sending" | "failed"; createdAt: string }>;

/**
 * Квитанция получена: сообщение уходит из очереди. Само сообщение придёт со страницей
 * чата; если страница уже содержит его `sequenceId`, дубля нет (слияние по sequenceId).
 */
export function dropSent(outbox: readonly OutboxItem[], requestId: string): readonly OutboxItem[] {
  return outbox.filter((item) => item.requestId !== requestId);
}

export function markOutbox(outbox: readonly OutboxItem[], requestId: string, status: OutboxItem["status"]): readonly OutboxItem[] {
  return outbox.map((item) => (item.requestId === requestId ? { ...item, status } : item));
}

// ---- непрочитанное ---------------------------------------------------------------

export function unreadNotifications(items: readonly StudentPortalNotification[] | undefined): readonly StudentPortalNotification[] {
  return (items ?? []).filter((item) => item.readAt === null);
}

/** Самое новое чужое сообщение: до него чат считается прочитанным (веб: useMarkCaseChatRead). */
export function newestSequenceId(messages: readonly PortalCaseMessage[]): string | null {
  return messages.length === 0 ? null : messages[messages.length - 1]!.sequenceId;
}

/** Нужно ли слать «прочитано»: чат виден, приложение на переднем плане, есть что отметить и это ещё не отправлено. */
export function shouldMarkRead(input: { visible: boolean; foreground: boolean; newest: string | null; lastSent: string | null }): boolean {
  return input.visible && input.foreground && input.newest !== null && input.newest !== input.lastSent;
}

/** Есть ли чужое сообщение новее уже отмеченного: подпись «Команда ждёт» не нужна, нужна точка в списке. */
export function chatHasUnreadFromTeam(notifications: readonly StudentPortalNotification[] | undefined): boolean {
  return unreadNotifications(notifications).some((item) => item.eventCode === "case_chat_message");
}

// ---- опрос --------------------------------------------------------------------

export type PollSection = "home" | "admission" | "documents" | "payments" | "notifications" | "messages";

/** Раздел приложения -> раздел `student_portal_poll_v1` (lib/portal-poll-section.ts, веб). */
export function pollSectionFor(section: SectionId | null): PollSection {
  switch (section) {
    case "home":
      // #1355: «Главная» — единственная страница /portal, веб опрашивает её как раздел «admission».
      return "admission";
    case "documents":
      return "documents";
    case "payments":
      return "payments";
    case "messages":
      return "messages";
    default:
      return "notifications";
  }
}

export type PollResult = Readonly<{ access: boolean; unread: number; version: string | null }>;

export function decodePoll(data: unknown): PollResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new PortalDecodeError();
  const row = data as Record<string, unknown>;
  if (row.access === false) return { access: false, unread: 0, version: null };
  if (row.access !== true) throw new PortalDecodeError();
  const unread = typeof row.unread === "number" ? row.unread : typeof row.unread === "string" && /^\d{1,9}$/.test(row.unread) ? Number(row.unread) : NaN;
  if (!Number.isInteger(unread) || unread < 0) throw new PortalDecodeError();
  if (row.version !== null && (typeof row.version !== "string" || !/^[0-9a-f]{32}$/.test(row.version))) throw new PortalDecodeError();
  return { access: true, unread, version: row.version as string | null };
}

/** Версия сменилась (и это не первый ответ): нужно перечитать содержимое. */
export function versionChanged(previous: string | null | undefined, next: string | null): boolean {
  return previous !== undefined && previous !== null && next !== null && previous !== next;
}

// ---- «прочитано» для уведомления: UUIDv5 ----------------------------------------------

const COMMAND_NAMESPACE = "73f89df8-d811-5352-9a97-a87652d591c1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sha1(bytes: Uint8Array): Uint8Array {
  const rol = (v: number, n: number) => ((v << n) | (v >>> (32 - n))) >>> 0;
  const length = bytes.length;
  const padded = new Uint8Array((((length + 9 + 63) >> 6) << 6));
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i += 1) w[i] = rol(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (rol(a, 5) + (f >>> 0) + e + k + w[i]!) >>> 0;
      e = d; d = c; c = rol(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h));
  return out;
}

function uuidBytes(value: string): Uint8Array {
  if (!UUID_PATTERN.test(value)) throw new TypeError("invalid_uuid");
  const hex = value.replaceAll("-", "").toLowerCase();
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

export function uuidV5(name: string, namespace: string = COMMAND_NAMESPACE): string {
  const nameBytes = new TextEncoder().encode(name);
  const ns = uuidBytes(namespace);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns);
  input.set(nameBytes, ns.length);
  const hash = sha1(input).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** studentPortalNotificationReadRequestId (веб): один студент и одно уведомление дают один id. */
export function notificationReadRequestId(
  actor: Readonly<{ authUserId: string; membershipId: string; organizationId: string; studentCaseId: string }>,
  notificationId: string,
): string {
  const lower = (v: string) => (uuidBytes(v), v.toLowerCase());
  return uuidV5(`notification-read:${lower(actor.organizationId)}:${lower(actor.studentCaseId)}:${lower(actor.membershipId)}:${lower(actor.authUserId)}:${lower(notificationId)}`);
}
