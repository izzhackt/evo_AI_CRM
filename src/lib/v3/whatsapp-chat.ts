/**
 * «Продажи → WhatsApp» как чат (решение владельца 06.10.2026, миграция 266).
 * Чистая логика ленты и поля ответа без React и без сервера: её читают и
 * серверная страница, и клиентская лента, и Node-тесты.
 *
 * Всё время — по Бишкеку (часовой пояс организации). «Сегодня» и «Вчера»
 * считаются от момента чтения на сервере (`readAt`), а не от часов браузера:
 * разметка сервера и гидратация совпадают и около полуночи.
 */
import { PLATFORM_ORGANIZATION_TIMEZONE } from "../platform-organization-time.ts";
import type { V3InboxMessageMedia } from "./inbox-media.ts";

/** Предел текста одного сообщения WhatsApp из CRM (контракт отправки, знаки Unicode). */
export const WHATSAPP_CHAT_TEXT_LIMIT = 3000;
/** Счётчик знаков появляется только у предела. */
export const WHATSAPP_CHAT_COUNTER_FROM = 2700;
/** Сколько сообщений одного сотрудника может ждать отправки в одном чате. */
export const WHATSAPP_CHAT_PENDING_LIMIT = 3;
/**
 * Заявленная отправка, которую никто не взял дольше минуты, больше не держит
 * чат (миграция 266): её действие оборвалось между записью и отправкой. Лента
 * называет её «не ушло» с запасом в 15 с на ещё идущее действие автора.
 */
export const WHATSAPP_CHAT_STALL_MS = 75_000;
/** Аренда отправки (120 с) и запас: после неё итог взятой отправки неизвестен. */
export const WHATSAPP_CHAT_LEASE_OVER_MS = 135_000;
/** Повтор отправки, которую очередь чата ещё держит: 5, 10, 20, затем 30 с. */
export function queuedRetryDelay(answers: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, answers - 1), 30_000);
}
/** После стольких ответов «ждёт очереди» браузер перестаёт повторять сам (≈2,5 мин). */
export const WHATSAPP_CHAT_QUEUED_RETRY_LIMIT = 8;

export type WhatsAppMessageOrigin = "client" | "crm" | "phone" | "history" | "other";
export type WhatsAppAckName = "ERROR" | "PENDING" | "SERVER" | "DEVICE" | "READ" | "PLAYED";

/** Сообщение ленты — то, что видит браузер: без идентификаторов WhatsApp. */
export type InboxChatMessage = Readonly<{
  id: string;
  inbound: boolean;
  body: string;
  createdAt: string;
  origin: WhatsAppMessageOrigin;
  senderName: string | null;
  /** Сообщение из CRM написал тот, кто смотрит. */
  senderIsViewer: boolean;
  ack: WhatsAppAckName | null;
  media: readonly V3InboxMessageMedia[];
}>;

/** Отправка из CRM, ещё не ставшая сообщением ленты (чтение 266). */
export type InboxChatAttempt = Readonly<{
  attemptId: string | null;
  workItemId: string;
  requestId: string | null;
  status: "queued" | "prepared" | "unknown" | "rejected";
  reconciliationRequired: boolean;
  text: string;
  authorName: string;
  authorIsViewer: boolean;
  at: string;
  /** Когда отправку взяли (null — ещё не брали). */
  claimedAt: string | null;
  /** Сообщение клиента, на которое она отвечает: повтор автора тем же запросом. */
  sourceMessageId: string;
  failureCode: string | null;
  readback: "message_confirmed" | "message_not_found" | "delivery_refreshed" | null;
  /**
   * Проверка ничего не нашла не раньше чем через 5 минут после отправки: только
   * тогда сервер примет тот же текст снова (266).
   */
  readbackSettled: boolean;
}>;

/**
 * Можно ли отвечать из CRM и почему нет. Поле ответа есть только при
 * `allowed` и `attention`; остальное — честная строка вместо поля.
 */
export type InboxReplyAccess =
  | "allowed"
  | "attention"
  | "no_client_message"
  | "no_permission"
  | "preview"
  | "old_session"
  | "not_connected"
  | "closed";

export const REPLY_ACCESS_COPY: Readonly<Record<Exclude<InboxReplyAccess, "allowed">, string>> = Object.freeze({
  attention: "WhatsApp требует проверки — сообщение может не уйти.",
  no_client_message: "Клиент ещё не писал в этот чат. Из CRM можно только отвечать — первое сообщение отправьте с телефона продаж.",
  no_permission: "Только просмотр: у вашей роли нет права отвечать в WhatsApp.",
  preview: "Просмотр роли — отправка отключена.",
  old_session: "Чат пришёл через прежний номер WhatsApp — ответить из CRM нельзя.",
  not_connected: "WhatsApp не подключён к CRM — ответить отсюда нельзя.",
  closed: "Диалог закрыт — ответить из CRM нельзя.",
});

const TIME = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PLATFORM_ORGANIZATION_TIMEZONE,
});
const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: PLATFORM_ORGANIZATION_TIMEZONE,
});
const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", timeZone: PLATFORM_ORGANIZATION_TIMEZONE,
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", year: "numeric", timeZone: PLATFORM_ORGANIZATION_TIMEZONE,
});

function validDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** «14:05» по Бишкеку; пусто, если время не читается. */
export function chatTime(iso: string): string {
  const date = validDate(iso);
  return date ? TIME.format(date) : "";
}

/** День по Бишкеку, «2026-10-06». */
export function chatDayKey(iso: string): string {
  const date = validDate(iso);
  return date ? DAY_KEY.format(date) : "";
}

/**
 * Разделитель дня: «Сегодня», «Вчера», «5 октября»; год — только если он не
 * текущий (как у «Командного чата»).
 */
export function chatDayLabel(iso: string, readAt: string): string {
  const date = validDate(iso);
  const now = validDate(readAt);
  if (!date) return "";
  if (now) {
    const today = DAY_KEY.format(now);
    const day = DAY_KEY.format(date);
    if (day === today) return "Сегодня";
    const yesterday = DAY_KEY.format(new Date(now.getTime() - 86_400_000));
    if (day === yesterday) return "Вчера";
    if (day.slice(0, 4) === today.slice(0, 4)) return DAY_MONTH.format(date);
  }
  return DAY_MONTH_YEAR.format(date).replace(/\s*г\.$/u, "");
}

/** Слово отметки WhatsApp у нашего сообщения; нет отметки — нет слова. */
export function ackWord(ack: WhatsAppAckName | null): string | null {
  switch (ack) {
    case "PENDING": return "отправляется";
    case "SERVER": return "отправлено";
    case "DEVICE": return "доставлено";
    case "READ":
    case "PLAYED": return "прочитано";
    case "ERROR": return "не доставлено";
    default: return null;
  }
}

/** Откуда наше сообщение: «из CRM, Айгерим», «из CRM, вы», «с телефона». История — без пометки. */
export function originWord(message: Pick<InboxChatMessage, "inbound" | "origin" | "senderName" | "senderIsViewer">): string | null {
  if (message.inbound) return null;
  if (message.origin === "crm") return message.senderIsViewer ? "из CRM, вы" : `из CRM, ${message.senderName ?? "сотрудник"}`;
  if (message.origin === "phone") return "с телефона";
  return null;
}

/** Невидимое начало сообщения для читалки: кто говорит. */
export function speakerPrefix(message: Pick<InboxChatMessage, "inbound" | "origin" | "senderName" | "senderIsViewer">): string {
  if (message.inbound) return "Клиент:";
  if (message.origin === "crm") return message.senderIsViewer ? "Вы, из CRM:" : `${message.senderName ?? "Сотрудник"}, из CRM:`;
  if (message.origin === "phone") return "С телефона продаж:";
  return "Продажи:";
}

/**
 * Текст, который уйдёт: переводы строк — `\n`, табуляция — пробел, прочие
 * управляющие знаки убраны (контракт отправки их не принимает), края обрезаны.
 */
export function normalizeChatText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/\t/gu, " ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, "")
    .trim();
}

export function chatTextLength(value: string): number {
  return Array.from(value).length;
}

/** Ответ сервера на отправку одного сообщения. */
export type WhatsAppChatSendStatus =
  | "sent"
  | "queued"
  | "sending"
  | "unknown"
  | "rejected"
  | "stale_source"
  | "closed"
  | "duplicate"
  | "not_ready"
  | "forbidden"
  | "invalid"
  | "unavailable";

export type WhatsAppChatSendResult = Readonly<{
  status: WhatsAppChatSendStatus;
  workItemId: string | null;
  attemptId: string | null;
  messageId: string | null;
}>;

export type WhatsAppChatReconcileStatus =
  | "confirmed"
  | "not_found"
  | "already_completed"
  | "readback_failed"
  | "forbidden"
  | "invalid"
  | "unavailable";

/** Отказ до записи: текст возвращается в поле, под ним — почему. */
export const SEND_REFUSAL_COPY: Readonly<Partial<Record<WhatsAppChatSendStatus, string>>> = Object.freeze({
  stale_source: "Пока вы писали, клиент прислал новое сообщение. Проверьте ответ и отправьте ещё раз.",
  closed: "Диалог закрыли — ответить из CRM нельзя. Текст остался в поле.",
  duplicate: "Такое же сообщение выше ещё не дошло до итога — дождитесь его или нажмите «Проверить» у него.",
  not_ready: "WhatsApp сейчас не принимает отправку из CRM. Текст сохранён — попробуйте позже.",
  forbidden: "Отправка недоступна: права на этот чат изменились. Обновите страницу.",
  invalid: "Сообщение не прошло проверку. Уберите лишние знаки и отправьте ещё раз.",
});

export const CONNECTION_LOST_COPY = "Связь прервалась — неизвестно, ушло ли сообщение. «Повторить» не отправит его дважды.";

/** Отказы, после которых текст можно вернуть в поле: на сервере записи нет. */
export function isRefusal(status: WhatsAppChatSendStatus): boolean {
  return status in SEND_REFUSAL_COPY;
}

/** Сообщение, которое этот браузер отправляет (очередь этого чата). */
export type LocalChatSend = Readonly<{
  requestId: string;
  text: string;
  sourceMessageId: string;
  createdAt: string;
  /**
   * sending — ждёт сервера; queued — сервер записал, очередь чата ещё занята
   * (браузер повторяет сам, всё реже); stuck — очередь не освободилась за
   * ≈2,5 мин, браузер больше не повторяет сам; lost — связь прервалась, итог
   * неизвестен (повтор тем же запросом); sent — принято; unknown / rejected —
   * итог сервера до перечитывания ленты; refused — сервер отказал до записи
   * (текст можно вернуть в поле).
   */
  state: "sending" | "queued" | "stuck" | "lost" | "sent" | "unknown" | "rejected" | "refused";
  messageId: string | null;
  attemptId: string | null;
  refusal: WhatsAppChatSendStatus | null;
  /** Сколько раз сервер ответил «ждёт очереди» подряд. */
  queuedAnswers: number;
}>;

export type OutgoingBubble = Readonly<{
  key: string;
  text: string;
  at: string;
  authorName: string | null;
  authorIsViewer: boolean;
  /**
   * stalled — сервер записал, но никто не взял её дольше минуты: действие
   * автора оборвалось. Чат она больше не держит; отправить её может только
   * автор тем же запросом.
   */
  state: "sending" | "queued" | "stalled" | "stuck" | "lost" | "sent" | "unknown" | "rejected" | "refused";
  attemptId: string | null;
  readback: InboxChatAttempt["readback"];
  readbackSettled: boolean;
  refusal: WhatsAppChatSendStatus | null;
  /** Отправка этого браузера (её можно повторить тем же запросом или убрать). */
  localRequestId: string | null;
  /** Автор может повторить записанную сервером отправку тем же запросом (с любого устройства). */
  resend: Readonly<{ requestId: string; sourceMessageId: string }> | null;
}>;

/**
 * Исходящие пузыри поверх ленты: попытки сервера, ещё не ставшие сообщением,
 * и отправки этого браузера, которых сервер ещё не показал. Отправка, которую
 * сервер уже знает (тот же requestId), показывается его состоянием; та, что
 * идёт прямо сейчас, — «Отправляется…»; принятая — пока перечитанная лента не
 * принесёт её сообщение.
 */
export function outgoingBubbles(
  attempts: readonly InboxChatAttempt[],
  local: readonly LocalChatSend[],
  messageIds: ReadonlySet<string>,
  inFlight: ReadonlySet<string> = new Set(),
  now: number = Number.NaN,
): readonly OutgoingBubble[] {
  const serverRequests = new Set(attempts.flatMap((attempt) => (attempt.requestId ? [attempt.requestId] : [])));
  const localByRequest = new Map(local.map((item) => [item.requestId, item]));
  const olderThan = (iso: string | null, ms: number) => iso !== null && now - Date.parse(iso) > ms;
  const bubbles: OutgoingBubble[] = attempts.map((attempt) => {
    const mine = attempt.requestId ? localByRequest.get(attempt.requestId) : undefined;
    const sending = Boolean(attempt.requestId && inFlight.has(attempt.requestId));
    let state: OutgoingBubble["state"];
    if (sending) state = "sending";
    else if (attempt.status === "prepared") {
      // Взятая отправка без итога дольше аренды: приложение оборвалось во
      // время отправки, итог неизвестен (проверка сначала закрепит это).
      state = olderThan(attempt.claimedAt, WHATSAPP_CHAT_LEASE_OVER_MS) ? "unknown" : "sending";
    } else if (attempt.status === "queued") {
      // Свою отправку браузер ещё повторяет сам — она ждёт очереди.
      const retrying = mine !== undefined && (mine.state === "queued" || mine.state === "sending");
      state = mine?.state === "stuck" || mine?.state === "lost" ? mine.state
        : !retrying && olderThan(attempt.at, WHATSAPP_CHAT_STALL_MS) ? "stalled" : "queued";
    } else state = attempt.status === "unknown" ? "unknown" : "rejected";
    return Object.freeze({
      key: attempt.workItemId,
      text: attempt.text,
      at: attempt.at,
      authorName: attempt.authorName,
      authorIsViewer: attempt.authorIsViewer,
      state,
      attemptId: attempt.attemptId,
      readback: attempt.readback,
      readbackSettled: attempt.readbackSettled,
      refusal: null,
      localRequestId: mine ? mine.requestId : null,
      resend: attempt.authorIsViewer && attempt.requestId
        ? Object.freeze({ requestId: attempt.requestId, sourceMessageId: attempt.sourceMessageId })
        : null,
    });
  });
  for (const item of local) {
    if (serverRequests.has(item.requestId)) continue;
    if (item.state === "sent" && (item.messageId === null || messageIds.has(item.messageId))) continue;
    bubbles.push(Object.freeze({
      key: item.requestId,
      text: item.text,
      at: item.createdAt,
      authorName: null,
      authorIsViewer: true,
      state: inFlight.has(item.requestId) ? "sending" : item.state,
      attemptId: item.attemptId,
      readback: null,
      readbackSettled: false,
      refusal: item.refusal,
      localRequestId: item.requestId,
      resend: null,
    }));
  }
  return Object.freeze(bubbles.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0)));
}

/**
 * Локальные отправки, которые больше не нужны: сервер показывает их итог
 * (неизвестный или отклонённый), или лента уже принесла принятое сообщение.
 */
export function settledLocalSends(
  local: readonly LocalChatSend[],
  attempts: readonly InboxChatAttempt[],
  messageIds: ReadonlySet<string>,
): readonly string[] {
  const shownByServer = new Set(attempts
    .filter((attempt) => attempt.requestId && (attempt.status === "unknown" || attempt.status === "rejected"))
    .map((attempt) => attempt.requestId as string));
  return local
    .filter((item) => shownByServer.has(item.requestId)
      || (item.state === "sent" && (item.messageId === null || messageIds.has(item.messageId))))
    .map((item) => item.requestId);
}

/** Сообщений этого браузера, которые ещё в пути: от трёх поле ждёт. */
export function unresolvedLocalCount(local: readonly LocalChatSend[]): number {
  return local.filter((item) => item.state === "sending" || item.state === "queued" || item.state === "stuck"
    || item.state === "lost").length;
}

/**
 * Подпись состояния для опроса: только идентификаторы, время и состояния —
 * ни текста, ни имени. Тот же расчёт у страницы и у `/api/v3/inbox/pulse`,
 * поэтому первый опрос после загрузки ничего не перечитывает.
 */
export function inboxPulseSignature(parts: readonly (string | null | undefined)[]): string {
  // Две FNV-1a 32 с разными началами: короткая устойчивая подпись без
  // криптографии и без BigInt (цель сборки — ES2017).
  let first = 0x811c9dc5;
  let second = 0x9747b28c;
  for (const part of parts) {
    const text = `${part ?? "\u2205"}|`;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ code, 0x5bd1e995) >>> 0;
    }
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}
