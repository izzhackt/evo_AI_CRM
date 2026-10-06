"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/icons";
import type { ReplySnippetPickerItem } from "@/components/v3/reply-snippets/ReplySnippetPicker";
import {
  reconcilePlatformWhatsAppSendAction,
  sendPlatformWhatsAppMessageAction,
} from "@/lib/platform-provider-actions";
import type { V3InboxMediaAttachmentContext } from "@/lib/v3/inbox-media";
import {
  CONNECTION_LOST_COPY,
  REPLY_ACCESS_COPY,
  SEND_REFUSAL_COPY,
  WHATSAPP_CHAT_PENDING_LIMIT,
  WHATSAPP_CHAT_QUEUED_RETRY_LIMIT,
  WHATSAPP_CHAT_TEXT_LIMIT,
  ackWord,
  chatDayKey,
  chatDayLabel,
  chatTextLength,
  chatTime,
  isRefusal,
  normalizeChatText,
  originWord,
  outgoingBubbles,
  queuedRetryDelay,
  settledLocalSends,
  speakerPrefix,
  unresolvedLocalCount,
  type InboxChatAttempt,
  type InboxChatMessage,
  type InboxReplyAccess,
  type LocalChatSend,
  type OutgoingBubble,
  type WhatsAppChatSendResult,
  type WhatsAppChatSendStatus,
} from "@/lib/v3/whatsapp-chat";

import { appendChatDraft, chatStoreKey, readChatStore, useChatStore, writeChatStore } from "./chat-store";
import { InboxComposer } from "./InboxComposer";
import { InboxMessageMedia } from "./InboxMessageMedia";
import { useInboxPulse } from "./useInboxPulse";

/** Часы ленты: «не ушло» и «итог неизвестен» зависят от времени, а не только от сервера. */
const CLOCK_TICK_MS = 15_000;

export type InboxChatData = Readonly<{
  messages: readonly InboxChatMessage[];
  hasOlder: boolean;
  attempts: readonly InboxChatAttempt[];
  latestInboundMessageId: string | null;
  replyAccess: InboxReplyAccess;
  readAt: string;
  pulse: string;
}>;

type FeedEntry =
  | Readonly<{ kind: "day"; key: string; label: string }>
  | Readonly<{ kind: "message"; key: string; message: InboxChatMessage }>
  | Readonly<{ kind: "outgoing"; key: string; bubble: OutgoingBubble }>;

function compareMessages(left: InboxChatMessage, right: InboxChatMessage): number {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function mergeMessages(
  known: readonly InboxChatMessage[],
  next: readonly InboxChatMessage[],
): readonly InboxChatMessage[] {
  const byId = new Map(known.map((message) => [message.id, message]));
  for (const message of next) byId.set(message.id, message);
  return Object.freeze([...byId.values()].sort(compareMessages));
}

/**
 * Контекст «В дело студента» страницы и подгруженных ранних страниц: слоты —
 * самые свежие, идентификаторы запросов — у каждого вложения свои.
 */
function mergeAttachmentContexts(
  base: V3InboxMediaAttachmentContext | null,
  older: V3InboxMediaAttachmentContext | null,
): V3InboxMediaAttachmentContext | null {
  if (!older) return base;
  if (!base) return older;
  if (base.conversationId !== older.conversationId || base.studentCaseId !== older.studentCaseId) return base;
  return Object.freeze({
    ...base,
    requestIdsByMediaId: Object.freeze({ ...older.requestIdsByMediaId, ...base.requestIdsByMediaId }),
  });
}

function feedEntries(
  messages: readonly InboxChatMessage[],
  bubbles: readonly OutgoingBubble[],
  readAt: string,
  hasOlder: boolean,
): readonly FeedEntry[] {
  // Отправки старше загруженной части ленты стоят на своём месте, когда та
  // будет загружена («Показать ранее»), а не в начале ленты.
  const oldest = messages[0]?.createdAt ?? null;
  const visibleBubbles = hasOlder && oldest ? bubbles.filter((bubble) => bubble.at >= oldest) : bubbles;
  const timeline: Array<Readonly<{ at: string; entry: FeedEntry }>> = [
    ...messages.map((message) => ({ at: message.createdAt, entry: { kind: "message", key: `m:${message.id}`, message } as FeedEntry })),
    ...visibleBubbles.map((bubble) => ({ at: bubble.at, entry: { kind: "outgoing", key: `o:${bubble.key}`, bubble } as FeedEntry })),
  ].sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0));
  const entries: FeedEntry[] = [];
  let day = "";
  for (const item of timeline) {
    const key = chatDayKey(item.at);
    if (key && key !== day) {
      day = key;
      entries.push({ kind: "day", key: `d:${key}`, label: chatDayLabel(item.at, readAt) });
    }
    entries.push(item.entry);
  }
  return entries;
}

/** Строка времени и происхождения под текстом пузыря. */
function MessageMeta({ message }: Readonly<{ message: InboxChatMessage }>) {
  const origin = originWord(message);
  const ack = message.inbound ? null : ackWord(message.ack);
  return (
    <p className="mt-1 flex flex-wrap items-center justify-end gap-x-1.5 t-meta text-fg-3">
      <time dateTime={message.createdAt} className="tabular-nums">{chatTime(message.createdAt)}</time>
      {origin ? <span>· {origin}</span> : null}
      {ack ? (
        <span className="inline-flex items-center gap-0.5" data-ack={message.ack ?? undefined}>
          <span aria-hidden="true">·</span>
          <Icon name={message.ack === "ERROR" ? "alert" : "check"} size={12} className="shrink-0" />
          {ack}
        </span>
      ) : null}
    </p>
  );
}

function MessageBubble({
  message,
  attachmentContext,
}: Readonly<{ message: InboxChatMessage; attachmentContext: V3InboxMediaAttachmentContext | null }>) {
  return (
    <li
      className={`flex ${message.inbound ? "justify-start" : "justify-end"}`}
      data-testid="v3-inbox-message"
      data-direction={message.inbound ? "inbound" : "outbound"}
      data-origin={message.origin}
    >
      <div
        className={`min-w-0 max-w-[min(36rem,85%)] rounded-ctl px-3 py-2 ${
          message.inbound ? "border border-border bg-surface" : "bg-accent-weak"
        }`}
      >
        <span className="sr-only">{speakerPrefix(message)} </span>
        <p className="whitespace-pre-wrap break-words t-body-compact text-fg">{message.body}</p>
        <InboxMessageMedia items={message.media} inbound={message.inbound} attachmentContext={attachmentContext} />
        <MessageMeta message={message} />
      </div>
    </li>
  );
}

const textActionCls =
  "inline-flex min-h-11 items-center rounded-nav px-1.5 -mx-1.5 t-label text-fg underline decoration-fg-3 underline-offset-2 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-wait disabled:text-fg-3";

/** Строка состояния под текстом отправки: слово и, если есть, одно действие в той же строке. */
function StatusRow({ tone, children, action, alert = false }: Readonly<{
  tone: "muted" | "warn" | "danger";
  children: ReactNode;
  action?: ReactNode;
  alert?: boolean;
}>) {
  const color = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-fg-2";
  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-3 border-t border-current/15 pt-1 text-end">
      <p className={`t-body-compact ${color}`} role={alert ? "alert" : undefined}>{children}</p>
      {action}
    </div>
  );
}

function OutgoingStatus({
  bubble,
  canAct,
  checking,
  checkFailed,
  onCheck,
  onRetry,
  onReturn,
}: Readonly<{
  bubble: OutgoingBubble;
  canAct: boolean;
  checking: boolean;
  checkFailed: boolean;
  onCheck: () => void;
  onRetry: () => void;
  onReturn: () => void;
}>) {
  const time = chatTime(bubble.at);
  const returnAction = canAct
    ? <button type="button" className={textActionCls} onClick={onReturn}>Вернуть текст в поле</button>
    : null;
  const retryAction = (label: string) => (
    <button type="button" className={textActionCls} aria-label={`${label}: сообщение от ${time}`} onClick={onRetry}>
      {label}
    </button>
  );
  if (bubble.state === "sending" || bubble.state === "queued" || bubble.state === "sent") {
    return (
      <p className="mt-0.5 flex items-center justify-end gap-1 t-meta text-fg-3" role="status">
        <Icon name={bubble.state === "sent" ? "check" : "clock"} size={12} className="shrink-0" />
        {bubble.state === "sending" ? "Отправляется…"
          : bubble.state === "sent" ? "отправлено"
            // Своя отправка ждёт, потому что выше есть ещё не ушедшая.
            : bubble.localRequestId ? "Ждёт очереди: выше сообщение, которое ещё не ушло" : "Ждёт очереди"}
      </p>
    );
  }
  if (bubble.state === "lost") {
    return (
      <StatusRow
        tone="danger"
        alert
        action={canAct && bubble.localRequestId
          ? <button type="button" className={textActionCls} onClick={onRetry}>Повторить</button>
          : null}
      >
        {CONNECTION_LOST_COPY}
      </StatusRow>
    );
  }
  if (bubble.state === "stalled") {
    // Записана, но никем не взята: действие автора оборвалось. Чат она не
    // держит; отправить её тем же запросом может только автор.
    const authorCanRetry = canAct && bubble.authorIsViewer && (bubble.localRequestId !== null || bubble.resend !== null);
    return (
      <StatusRow tone="danger" action={authorCanRetry ? retryAction("Повторить") : null}>
        {authorCanRetry ? "Не ушло: отправка прервалась" : "Не ушло: отправка прервалась — повторить может только автор"}
      </StatusRow>
    );
  }
  if (bubble.state === "stuck") {
    return (
      <StatusRow tone="danger" action={canAct && bubble.localRequestId ? retryAction("Повторить") : null}>
        Не ушло: очередь чата не освободилась
      </StatusRow>
    );
  }
  if (bubble.state === "refused") {
    return (
      <StatusRow tone="danger" alert action={returnAction}>
        {(bubble.refusal && SEND_REFUSAL_COPY[bubble.refusal]) ?? "Сообщение не отправлено."}
      </StatusRow>
    );
  }
  if (bubble.state === "rejected") {
    return <StatusRow tone="danger" action={returnAction}>Не отправлено: WhatsApp отклонил сообщение</StatusRow>;
  }
  // unknown: проверка этой попытки без новой отправки. «Проверить» остаётся и
  // после «не найдено»: ранняя проверка может не увидеть сообщение, которое
  // WhatsApp ещё отправлял. Текст можно вернуть в поле только после проверки
  // не раньше чем через 5 минут после отправки — тогда сервер примет его снова.
  const checkAction = canAct && bubble.attemptId ? (
    <button
      type="button"
      className={textActionCls}
      disabled={checking}
      aria-label={`Проверить результат сообщения от ${time}`}
      onClick={onCheck}
    >
      Проверить
    </button>
  ) : null;
  const notFound = bubble.readback === "message_not_found";
  const failed = checkFailed && !checking;
  return (
    <StatusRow
      tone={failed ? "danger" : notFound ? "muted" : "warn"}
      alert={failed}
      action={notFound && bubble.readbackSettled && returnAction
        // Два действия переносятся вместе, а не по одному.
        ? <span className="inline-flex flex-wrap items-center justify-end gap-x-3">{checkAction}{returnAction}</span>
        : checkAction}
    >
      {checking ? "Проверяем…"
        : failed ? "Не удалось проверить — попробуйте позже."
          : notFound && bubble.readbackSettled ? "В WhatsApp не найдено. Повторно не отправлялось"
            : notFound ? "В WhatsApp пока не найдено — проверьте ещё раз через несколько минут"
              : "Результат неизвестен"}
    </StatusRow>
  );
}

function OutgoingBubbleRow(props: Readonly<{
  bubble: OutgoingBubble;
  canAct: boolean;
  checking: boolean;
  checkFailed: boolean;
  onCheck: () => void;
  onRetry: () => void;
  onReturn: () => void;
}>) {
  const { bubble } = props;
  const author = bubble.authorIsViewer ? "вы" : bubble.authorName ?? "сотрудник";
  return (
    <li className="flex justify-end" data-testid="v3-inbox-outgoing" data-state={bubble.state}>
      <div className="min-w-0 max-w-[min(36rem,85%)] rounded-ctl bg-accent-weak px-3 py-2">
        <span className="sr-only">{bubble.authorIsViewer ? "Вы, из CRM:" : `${author}, из CRM:`} </span>
        <p className="whitespace-pre-wrap break-words t-body-compact text-fg">{bubble.text}</p>
        <p className="mt-1 flex flex-wrap items-center justify-end gap-x-1.5 t-meta text-fg-3">
          <time dateTime={bubble.at} className="tabular-nums">{chatTime(bubble.at)}</time>
          <span>· из CRM, {author}</span>
        </p>
        <OutgoingStatus {...props} />
      </div>
    </li>
  );
}

export function InboxChat({
  conversationId,
  person,
  chat,
  listPulse,
  searchQuery,
  waitingOnly,
  storageScope,
  replySnippets,
  mediaAttachmentContext,
  assistant = null,
}: Readonly<{
  conversationId: string;
  person: string;
  chat: InboxChatData;
  listPulse: string | null;
  searchQuery: string | null;
  waitingOnly: boolean;
  /** «организация:сотрудник» — черновики разных сотрудников не смешиваются. */
  storageScope: string;
  replySnippets: readonly ReplySnippetPickerItem[] | null;
  mediaAttachmentContext: V3InboxMediaAttachmentContext | null;
  /**
   * Место будущего окна ИИ (справа внизу ленты, свёрнутое по умолчанию). В
   * этом выпуске его нет: слот пустой и ничего не рисует. Окно не закрывает
   * поле ответа — оно лежит над лентой, а поле — под ней.
   */
  assistant?: ReactNode;
}>) {
  const router = useRouter();
  const fieldId = useId();
  const storeKey = chatStoreKey(storageScope, conversationId);
  const store = useChatStore(storeKey);
  const viewport = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);

  // Сообщения, однажды показанные, остаются в ленте: новые сдвигают окно
  // последних 50, а «Показать ранее» добавляет более ранние.
  const [feed, setFeed] = useState(() => ({ source: chat.messages, known: chat.messages, hasOlder: chat.hasOlder }));
  if (feed.source !== chat.messages) {
    setFeed((previous) => ({ source: chat.messages, known: mergeMessages(previous.known, chat.messages), hasOlder: previous.hasOlder }));
  }
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  // «В дело студента» у вложений из «Показать ранее»: их контекст приходит с
  // той же страницей сообщений.
  const [olderAttachments, setOlderAttachments] = useState<V3InboxMediaAttachmentContext | null>(null);
  const attachmentContext = useMemo(
    () => mergeAttachmentContexts(mediaAttachmentContext, olderAttachments),
    [mediaAttachmentContext, olderAttachments],
  );
  // Часы ленты идут, только пока есть отправка, состояние которой зависит от
  // времени; на сервере и при гидратации — момент чтения страницы.
  const [now, setNow] = useState(() => Date.parse(chat.readAt));
  const needsClock = chat.attempts.some((attempt) => attempt.status === "queued" || attempt.status === "prepared");
  useEffect(() => {
    if (!needsClock) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, CLOCK_TICK_MS);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [needsClock]);
  const [notice, setNotice] = useState<WhatsAppChatSendStatus | null>(null);
  const [checking, setChecking] = useState<readonly string[]>([]);
  const [checkFailed, setCheckFailed] = useState<readonly string[]>([]);

  const canSend = chat.replyAccess === "allowed" || chat.replyAccess === "attention";
  const canAct = chat.replyAccess !== "no_permission" && chat.replyAccess !== "preview";
  const messageIds = useMemo(() => new Set(feed.known.map((message) => message.id)), [feed.known]);
  const inFlight = useMemo(() => new Set(store.inFlight), [store.inFlight]);
  const bubbles = useMemo(
    () => outgoingBubbles(chat.attempts, store.local, messageIds, inFlight, now),
    [chat.attempts, store.local, messageIds, inFlight, now],
  );
  const entries = useMemo(
    () => feedEntries(feed.known, bubbles, chat.readAt, feed.hasOlder),
    [feed.known, bubbles, chat.readAt, feed.hasOlder],
  );
  const newestKey = entries.at(-1)?.key ?? "";
  const [view, setView] = useState({ atBottom: true, seenNewest: newestKey });
  const showJump = !view.atBottom && newestKey !== view.seenNewest;

  const { stalled, resume } = useInboxPulse({
    conversationId,
    listPulse,
    chatPulse: chat.pulse,
    query: searchQuery,
    waitingOnly,
    busy: store.inFlight.length > 0,
  });

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  // Лента открывается на последнем сообщении; новое внизу видно сразу, если
  // сотрудник был внизу, иначе — «Новые сообщения ↓».
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    if (anchor.current) {
      node.scrollTop = node.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
      return;
    }
    if (nearBottom.current) node.scrollTop = node.scrollHeight;
  }, [entries]);

  // Отправки, итог которых уже показывает сервер, уходят из очереди браузера.
  useEffect(() => {
    const settled = settledLocalSends(store.local, chat.attempts, messageIds);
    if (settled.length === 0) return;
    const drop = new Set(settled);
    writeChatStore(storeKey, (previous) => ({ ...previous, local: previous.local.filter((item) => !drop.has(item.requestId)) }));
  }, [store.local, chat.attempts, messageIds, storeKey]);

  const apply = useCallback((requestId: string, outcome: WhatsAppChatSendResult) => {
    writeChatStore(storeKey, (previous) => {
      const item = previous.local.find((entry) => entry.requestId === requestId);
      const inFlightNext = previous.inFlight.filter((id) => id !== requestId);
      if (!item) return { ...previous, inFlight: inFlightNext };
      if (isRefusal(outcome.status)) {
        // На сервере записи нет: пустое поле получает текст обратно.
        if (previous.draft.trim() === "") {
          return {
            ...previous,
            inFlight: inFlightNext,
            draft: item.text,
            local: previous.local.filter((entry) => entry.requestId !== requestId),
          };
        }
        return {
          ...previous,
          inFlight: inFlightNext,
          local: previous.local.map((entry) => entry.requestId === requestId
            ? { ...entry, state: "refused" as const, refusal: outcome.status } : entry),
        };
      }
      // «Ждёт очереди» браузер повторяет сам всё реже, а после
      // WHATSAPP_CHAT_QUEUED_RETRY_LIMIT ответов подряд — только по кнопке.
      const waiting = outcome.status === "queued" || outcome.status === "sending";
      const queuedAnswers = waiting ? item.queuedAnswers + 1 : 0;
      const state: LocalChatSend["state"] = outcome.status === "sent" ? "sent"
        : outcome.status === "unknown" ? "unknown"
          : outcome.status === "rejected" ? "rejected"
            : waiting ? (queuedAnswers >= WHATSAPP_CHAT_QUEUED_RETRY_LIMIT ? "stuck" : "queued") : "lost";
      return {
        ...previous,
        inFlight: inFlightNext,
        local: previous.local.map((entry) => entry.requestId === requestId
          ? { ...entry, state, queuedAnswers, messageId: outcome.messageId, attemptId: outcome.attemptId ?? entry.attemptId } : entry),
      };
    });
    if (isRefusal(outcome.status)) {
      setNotice(outcome.status);
      if (readChatStore(storeKey).draft !== "") requestAnimationFrame(() => textarea.current?.focus());
    }
    if (outcome.status !== "invalid" && outcome.status !== "forbidden") refresh();
  }, [refresh, storeKey]);

  // Очередь браузера: по одному сообщению за раз, в порядке написания.
  useEffect(() => {
    if (!canSend || store.inFlight.length > 0) return;
    const next = store.local.find((item) => item.state === "sending");
    if (!next) return;
    writeChatStore(storeKey, (previous) => ({ ...previous, inFlight: [...previous.inFlight, next.requestId] }));
    void (async () => {
      let outcome: WhatsAppChatSendResult;
      try {
        outcome = await sendPlatformWhatsAppMessageAction({
          conversationId,
          sourceMessageId: next.sourceMessageId,
          requestId: next.requestId,
          text: next.text,
        });
      } catch {
        outcome = { status: "unavailable", workItemId: null, attemptId: null, messageId: null };
      }
      apply(next.requestId, outcome);
    })();
  }, [store.local, store.inFlight, canSend, conversationId, storeKey, apply]);

  // Сообщение, которое очередь чата ещё держит, спрашивается снова тем же
  // запросом: через 5, 10, 20, затем 30 с.
  useEffect(() => {
    if (!canSend || store.inFlight.length > 0) return;
    const waiting = store.local.filter((item) => item.state === "queued");
    if (waiting.length === 0) return;
    const delay = queuedRetryDelay(Math.min(...waiting.map((item) => item.queuedAnswers)));
    const timer = setTimeout(() => {
      writeChatStore(storeKey, (previous) => ({
        ...previous,
        local: previous.local.map((item) => (item.state === "queued" ? { ...item, state: "sending" as const } : item)),
      }));
    }, delay);
    return () => clearTimeout(timer);
  }, [store.local, store.inFlight, canSend, storeKey]);

  function send() {
    const text = normalizeChatText(store.draft);
    if (!text || chatTextLength(text) > WHATSAPP_CHAT_TEXT_LIMIT || chat.latestInboundMessageId === null) return;
    if (unresolvedLocalCount(store.local) >= WHATSAPP_CHAT_PENDING_LIMIT) return;
    const item: LocalChatSend = {
      requestId: crypto.randomUUID(),
      text,
      sourceMessageId: chat.latestInboundMessageId,
      createdAt: new Date().toISOString(),
      state: "sending",
      messageId: null,
      attemptId: null,
      refusal: null,
      queuedAnswers: 0,
    };
    setNotice(null);
    nearBottom.current = true;
    writeChatStore(storeKey, (previous) => ({ ...previous, draft: "", local: [...previous.local, item] }));
    textarea.current?.focus();
  }

  function returnText(text: string, requestId: string | null) {
    appendChatDraft(storeKey, text);
    if (requestId) {
      writeChatStore(storeKey, (previous) => ({
        ...previous,
        local: previous.local.filter((item) => item.requestId !== requestId),
      }));
    }
    setNotice(null);
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function retry(requestId: string) {
    writeChatStore(storeKey, (previous) => ({
      ...previous,
      local: previous.local.map((item) => (item.requestId === requestId
        ? { ...item, state: "sending" as const, queuedAnswers: 0 } : item)),
    }));
  }

  /**
   * Повтор записанной сервером отправки автором с любого устройства: тот же
   * запрос, тот же текст и то же сообщение клиента — сервер воспроизводит
   * записанное и не создаёт второй отправки.
   */
  function retryBubble(bubble: OutgoingBubble) {
    if (bubble.localRequestId) {
      retry(bubble.localRequestId);
      return;
    }
    const resend = bubble.resend;
    if (!resend) return;
    writeChatStore(storeKey, (previous) => (previous.local.some((item) => item.requestId === resend.requestId) ? previous : {
      ...previous,
      local: [...previous.local, {
        requestId: resend.requestId,
        text: bubble.text,
        sourceMessageId: resend.sourceMessageId,
        createdAt: bubble.at,
        state: "sending" as const,
        messageId: null,
        attemptId: bubble.attemptId,
        refusal: null,
        queuedAnswers: 0,
      }],
    }));
  }

  async function check(attemptId: string) {
    setChecking((previous) => [...previous, attemptId]);
    setCheckFailed((previous) => previous.filter((id) => id !== attemptId));
    let status: string;
    try {
      ({ status } = await reconcilePlatformWhatsAppSendAction({
        conversationId,
        attemptId,
        requestId: crypto.randomUUID(),
      }));
    } catch {
      status = "unavailable";
    }
    setChecking((previous) => previous.filter((id) => id !== attemptId));
    if (status === "confirmed" || status === "not_found" || status === "already_completed") refresh();
    else setCheckFailed((previous) => [...previous, attemptId]);
  }

  async function loadOlder() {
    const oldest = feed.known[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    const node = viewport.current;
    try {
      const params = new URLSearchParams({ before_at: oldest.createdAt, before_id: oldest.id });
      const response = await fetch(`/api/v3/inbox/conversations/${conversationId}/messages?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("older_unavailable");
      const body = await response.json() as {
        messages: InboxChatMessage[];
        hasOlder: boolean;
        attachmentContext?: V3InboxMediaAttachmentContext | null;
      };
      if (!Array.isArray(body.messages) || typeof body.hasOlder !== "boolean") throw new Error("older_unavailable");
      if (node) anchor.current = { height: node.scrollHeight, top: node.scrollTop };
      setFeed((previous) => ({ ...previous, known: mergeMessages(previous.known, body.messages), hasOlder: body.hasOlder }));
      const older = body.attachmentContext ?? null;
      if (older && older.conversationId === conversationId) {
        setOlderAttachments((previous) => mergeAttachmentContexts(previous, older));
      }
    } catch {
      setOlderFailed(true);
    } finally {
      setLoadingOlder(false);
    }
  }

  function onScroll() {
    const node = viewport.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    nearBottom.current = atBottom;
    if (atBottom) {
      if (!view.atBottom || view.seenNewest !== newestKey) setView({ atBottom: true, seenNewest: newestKey });
    } else if (view.atBottom) {
      setView((previous) => ({ ...previous, atBottom: false }));
    }
  }

  function jumpToNewest() {
    const node = viewport.current;
    if (!node) return;
    nearBottom.current = true;
    node.scrollTo({ top: node.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  const unresolved = unresolvedLocalCount(store.local);
  const blocked = unresolved >= WHATSAPP_CHAT_PENDING_LIMIT;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="v3-inbox-chat">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={viewport}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={`Переписка: ${person}`}
          tabIndex={0}
          onScroll={onScroll}
          className="v3-inbox-feed min-h-0 flex-1 overflow-y-auto overscroll-contain bg-bg px-3 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring @2xl:px-5"
        >
          {feed.hasOlder ? (
            <div className="mb-3 flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="inline-flex min-h-11 items-center rounded-ctl border border-border bg-surface px-3 t-label text-fg-2 hover:text-fg disabled:cursor-wait disabled:text-fg-3"
                data-testid="v3-inbox-messages-older"
              >
                {loadingOlder ? "Загружаем…" : "Показать ранее"}
              </button>
              {olderFailed ? <p role="alert" className="t-body-compact text-danger">Ранние сообщения не загрузились. Повторите.</p> : null}
            </div>
          ) : null}
          <ol className="flex flex-col gap-2" aria-label="Сообщения" data-testid="v3-inbox-messages">
            {entries.map((entry) => {
              if (entry.kind === "day") {
                return (
                  <li key={entry.key} className="my-2 flex justify-center" aria-hidden="false">
                    <span className="rounded-card bg-surface-2 px-3 py-1 t-meta text-fg-3">{entry.label}</span>
                  </li>
                );
              }
              if (entry.kind === "message") {
                return <MessageBubble key={entry.key} message={entry.message} attachmentContext={attachmentContext} />;
              }
              const bubble = entry.bubble;
              return (
                <OutgoingBubbleRow
                  key={entry.key}
                  bubble={bubble}
                  canAct={canAct}
                  checking={bubble.attemptId !== null && checking.includes(bubble.attemptId)}
                  checkFailed={bubble.attemptId !== null && checkFailed.includes(bubble.attemptId)}
                  onCheck={() => { if (bubble.attemptId) void check(bubble.attemptId); }}
                  onRetry={() => retryBubble(bubble)}
                  onReturn={() => returnText(bubble.text, bubble.localRequestId)}
                />
              );
            })}
            {entries.length === 0 ? (
              <li className="py-10 text-center t-body-compact text-fg-3">В этой переписке пока нет сообщений.</li>
            ) : null}
          </ol>
        </div>
        {showJump ? (
          <button
            type="button"
            onClick={jumpToNewest}
            className="v3-raised absolute bottom-3 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-4 t-label text-fg hover:bg-surface-2"
          >
            Новые сообщения
            <Icon name="chevron-down" size={16} className="shrink-0" />
          </button>
        ) : null}
        {assistant ? (
          <div className="pointer-events-none absolute bottom-3 end-3 z-10" data-slot="assistant">
            <div className="pointer-events-auto">{assistant}</div>
          </div>
        ) : null}
      </div>
      {stalled ? (
        <p className="flex shrink-0 flex-wrap items-center gap-x-2 border-t border-border bg-surface px-4 py-1.5 t-body-compact text-fg-2" role="status">
          Новые сообщения не загружаются ·
          <button type="button" className={textActionCls} onClick={resume}>Обновить</button>
        </p>
      ) : null}
      {canSend ? (
        <InboxComposer
          fieldId={fieldId}
          value={store.draft}
          onChange={(value) => {
            if (notice) setNotice(null);
            writeChatStore(storeKey, (previous) => ({ ...previous, draft: value }));
          }}
          onSend={send}
          blocked={blocked}
          snippets={replySnippets}
          textareaRef={textarea}
        >
          {chat.replyAccess === "attention" ? (
            <p className="mb-2 flex items-center gap-1.5 t-body-compact text-warn">
              <Icon name="alert" size={16} className="shrink-0" />
              {REPLY_ACCESS_COPY.attention}
            </p>
          ) : null}
          {notice && SEND_REFUSAL_COPY[notice] ? (
            <p className="mb-2 t-body-compact text-danger" role="alert">{SEND_REFUSAL_COPY[notice]}</p>
          ) : null}
          {blocked ? (
            <p className="mb-2 t-body-compact text-fg-2" role="status">
              Три сообщения ещё в пути — следующее можно отправить, когда уйдёт первое.
            </p>
          ) : null}
          {store.storageError ? (
            <p className="mb-2 t-body-compact text-fg-3">Браузер не сохраняет черновик — не закрывайте вкладку до отправки.</p>
          ) : null}
        </InboxComposer>
      ) : (
        <p
          className="shrink-0 border-t border-border bg-surface px-4 py-3 t-body-compact text-fg-2"
          data-testid="v3-inbox-reply-unavailable"
          data-reason={chat.replyAccess}
        >
          {REPLY_ACCESS_COPY[chat.replyAccess as Exclude<InboxReplyAccess, "allowed">]}
        </p>
      )}
    </div>
  );
}
