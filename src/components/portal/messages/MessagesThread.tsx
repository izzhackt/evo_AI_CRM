"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { Locale } from "@/lib/i18n-data";
import {
  PORTAL_CASE_MESSAGE_BODY_LIMIT,
  mergePortalCaseMessages,
  type PortalCaseChatAwaitState,
  type PortalCaseMessage,
  type PortalCaseMessagesPage,
} from "@/lib/portal/messages";
import {
  loadPortalCaseMessagesAction,
  sendPortalCaseMessageAction,
} from "@/lib/portal/messages-actions";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";

/**
 * Тред «Сообщений по делу» (PORT-5c, план §6 «Общение»): старые выше, догрузка
 * более ранних по before-курсору, отправка с честными состояниями
 * (отправляем/ошибка+повтор с тем же request_id — идемпотентность в RPC 200),
 * автообновление умеренным поллингом 30s по паттерну PortalNotificationUpdates
 * (visibility/focus/online, только видимая вкладка).
 */
export function MessagesThread({
  initialPage,
  strings,
  locale,
}: {
  initialPage: PortalCaseMessagesPage;
  strings: PortalStrings<"messages">;
  locale: Locale;
}) {
  const [messages, setMessages] = useState<readonly PortalCaseMessage[]>(
    () => mergePortalCaseMessages([], initialPage.messages),
  );
  const [awaitState, setAwaitState] = useState<PortalCaseChatAwaitState>(initialPage.awaitState);
  const [hasEarlier, setHasEarlier] = useState(initialPage.hasMore);
  const [earlierCursor, setEarlierCursor] = useState(initialPage.cursor);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const [loadingEarlier, startEarlier] = useTransition();

  // Стабильный request_id на ПОПЫТКУ: повтор после ошибки шлёт тот же id с тем
  // же текстом (сервер вернёт исходный receipt, дубль невозможен); новый id
  // выдаётся только после подтверждённой отправки или смены текста.
  const [draft, setDraft] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [sendFailed, setSendFailed] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [sending, startSending] = useTransition();

  const refreshRef = useRef<() => void>(() => {});
  // A11y (PORT-6a): зеркало messages для поллинга (замыкание в refresh()
  // видит устаревший state) + текст объявления о новом входящем сообщении.
  const messagesRef = useRef<readonly PortalCaseMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [incomingNotice, setIncomingNotice] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let disposed = false;
    let running = false;
    async function refresh() {
      if (disposed || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const result = await loadPortalCaseMessagesAction(null);
        if (disposed) return;
        if (!result.ok) {
          setRefreshFailed(true);
          return;
        }
        setRefreshFailed(false);
        setAwaitState(result.page.awaitState);
        // A11y (PORT-6a, WCAG 4.1.3): поллинг добавляет сообщения молча —
        // объявляем новое входящее (не своё) короткой sr-only live-областью,
        // не заставляя скринридер перечитывать весь тред.
        const existing = messagesRef.current;
        const merged = mergePortalCaseMessages(existing, result.page.messages);
        const newest = merged[merged.length - 1];
        if (
          existing.length > 0
          && merged.length > existing.length
          && newest
          && !newest.mine
          && newest.sequenceId !== existing[existing.length - 1]?.sequenceId
        ) {
          setIncomingNotice(formatPortalString(strings.newMessageNotice, { name: newest.authorName }));
        }
        setMessages(merged);
      } catch {
        if (!disposed) setRefreshFailed(true);
      } finally {
        running = false;
      }
    }
    refreshRef.current = () => { void refresh(); };
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    const resume = () => { void refresh(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      refreshRef.current = () => {};
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
    // Единственная внешняя зависимость эффекта — строка объявления о новом
    // сообщении (a11y, PORT-6a); меняется только со сменой локали.
  }, [strings.newMessageNotice]);

  const loadEarlier = () => {
    setEarlierFailed(false);
    startEarlier(async () => {
      const result = await loadPortalCaseMessagesAction(earlierCursor);
      if (!result.ok) {
        setEarlierFailed(true);
        return;
      }
      setMessages((existing) => mergePortalCaseMessages(existing, result.page.messages));
      setHasEarlier(result.page.hasMore);
      setEarlierCursor(result.page.cursor);
      // A11y (PORT-6a): когда более ранних не осталось, кнопка «Показать
      // более ранние» размонтируется вместе с фокусом — переносим фокус на
      // начало треда, чтобы он не падал молча на <body>.
      if (!result.page.hasMore) {
        requestAnimationFrame(() => listRef.current?.focus());
      }
    });
  };

  const send = () => {
    const body = draft.trim();
    if (body.length < 1 || body.length > PORTAL_CASE_MESSAGE_BODY_LIMIT) return;
    setSendFailed(false);
    setJustSent(false);
    startSending(async () => {
      const result = await sendPortalCaseMessageAction(requestId, body);
      if (!result.ok) {
        setSendFailed(true);
        return;
      }
      setDraft("");
      setRequestId(crypto.randomUUID());
      setJustSent(true);
      refreshRef.current();
    });
  };

  const timeLabel = new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bishkek",
  });

  return (
    <div className="pt-chat">
      {awaitState === "awaiting_student" ? (
        <p role="status" className="pt-chat-awaiting">{strings.awaitingYou}</p>
      ) : null}

      {hasEarlier ? (
        <div className="pt-chat-earlier">
          <button
            type="button"
            className="pt-btn-ghost"
            onClick={loadEarlier}
            disabled={loadingEarlier}
          >
            {loadingEarlier ? strings.loadingEarlier : strings.loadEarlier}
          </button>
          {earlierFailed ? (
            <p role="alert" className="pt-chat-error">{strings.loadEarlierError}</p>
          ) : null}
        </div>
      ) : null}

      {messages.length === 0 ? (
        <div className="pt-chat-empty">
          <h2 className="pt-section-title">{strings.emptyTitle}</h2>
          <p className="pt-chat-empty-body">{strings.emptyBody}</p>
        </div>
      ) : (
        <ol ref={listRef} tabIndex={-1} aria-label={strings.threadAria} className="pt-chat-list">
          {messages.map((message) => (
            <li
              key={message.sequenceId}
              className={message.mine ? "pt-chat-item pt-chat-item-mine" : "pt-chat-item"}
            >
              <div className={message.mine ? "pt-chat-bubble pt-chat-bubble-mine" : "pt-chat-bubble"}>
                {message.quotedBodyPreview !== null ? (
                  <p className="pt-chat-quote">
                    {formatPortalString(strings.quotedPrefix, { preview: message.quotedBodyPreview })}
                  </p>
                ) : null}
                {message.body !== "" ? (
                  <p className="pt-chat-body">{message.body}</p>
                ) : null}
                {/* Контракт 191→200 §6: карточки-ссылки на задачи в портале не
                    показываются вовсе (kind=case_task пропускается; RPC 200 и
                    так отдаёт для них label NULL). Документные карточки —
                    только подпись под portal authz. */}
                {message.attachmentKind === "document" ? (
                  <p className="pt-chat-attachment">
                    {formatPortalString(strings.attachmentDocument, {
                      label: message.attachmentLabel ?? "—",
                    })}
                  </p>
                ) : null}
                <p className="pt-chat-meta">
                  {message.mine ? null : <span className="pt-chat-author">{message.authorName}</span>}
                  <time dateTime={message.createdAt}>
                    {timeLabel.format(new Date(message.createdAt))}
                  </time>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p role="status" className="pt-sr-only">{incomingNotice}</p>

      {refreshFailed ? (
        <div className="pt-chat-refresh-error">
          <p role="alert" className="pt-chat-error">{strings.refreshError}</p>
          <button type="button" className="pt-link" onClick={() => refreshRef.current()}>
            {strings.retry}
          </button>
        </div>
      ) : null}

      <form
        className="pt-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="pt-field-label" htmlFor="portal-chat-composer">
          {strings.composerLabel}
        </label>
        <textarea
          id="portal-chat-composer"
          className="pt-input pt-chat-input"
          rows={3}
          maxLength={PORTAL_CASE_MESSAGE_BODY_LIMIT}
          placeholder={strings.composerPlaceholder}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            // Новый текст — новая попытка: прежний request_id связан со старым
            // телом, и сервер честно отклонил бы его конфликтом.
            if (sendFailed) {
              setRequestId(crypto.randomUUID());
              setSendFailed(false);
            }
          }}
          disabled={sending}
        />
        <div className="pt-chat-composer-row">
          <p className="pt-chat-limit">{strings.limitHint}</p>
          <button
            type="submit"
            className="pt-btn"
            disabled={sending || draft.trim().length < 1}
          >
            {sending ? strings.sending : strings.send}
          </button>
        </div>
        <p role="status" className="pt-chat-send-status">
          {sending ? strings.sending : justSent ? strings.sentStatus : ""}
        </p>
        {sendFailed ? (
          <div className="pt-chat-refresh-error">
            <p role="alert" className="pt-chat-error">{strings.sendError}</p>
            <button type="button" className="pt-link" onClick={send} disabled={sending}>
              {strings.retry}
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
