"use client";

import { useActionState, useLayoutEffect, useRef, useState } from "react";
import { teamChatCommandAction } from "@/lib/platform-team-chat-actions";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import { TEAM_CHAT_INITIAL_ACTION, type TeamChatActionState, type TeamChatFailure, type TeamChatMessage, type TeamChatParticipant } from "@/lib/platform-team-chat";
import { TEAM_CHAT_COMMAND_FAILURE_COPY } from "@/lib/team-chat-command-feedback";
import type { TeamChatQuote } from "@/lib/platform-team-chat-timeline";
import { plainTextLinks } from "@/lib/plain-text-links";
import { teamChatDeletedRunLabel } from "@/lib/team-chat-deleted-runs";
import { Icon } from "@/components/icons";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";
import styles from "./team-chat.module.css";

export type TeamChatDeletionAttempt = { message: TeamChatMessage; requestId: string; isOwn: boolean };

export function TeamChatMessageRow({ message, quote, ownMembershipId, canModerate, participants, onReply, onEdit, onDelete, onQuote, highlighted = false, continuation = false }: {
  message: TeamChatMessage; quote: TeamChatQuote | null; ownMembershipId: string; canModerate: boolean;
  participants: readonly TeamChatParticipant[]; onReply: (message: TeamChatMessage) => void;
  onEdit: (message: TeamChatMessage) => void; onDelete: (message: TeamChatMessage) => void; onQuote: (id: string) => void; highlighted?: boolean; continuation?: boolean;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const isOwn = message.authorMembershipId === ownMembershipId;
  // replyCount counts legacy root children, not incoming direct quotes to a reply.
  const compactDeleted = Boolean(message.deletedAt) && message.parentMessageId === null
    && message.replyCount === 0 && quote === null;
  const initials = message.authorName.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU");
  const mentionedNames = message.mentionedMembershipIds.map((id) => participants.find((person) => person.membershipId === id)?.displayName ?? "Участник");
  function closeMenu() { if (menu.current) menu.current.open = false; }
  return <article id={`team-message-channel-${message.id}`} data-chat-row={message.id} tabIndex={-1}
    className={`${styles.message} ${isOwn ? styles.ownMessage : ""} ${highlighted ? styles.highlighted : ""} ${continuation ? styles.continuation : ""} ${compactDeleted ? styles.compactDeleted : ""}`}>
    {!isOwn ? <span className={`t-caption ${styles.authorAvatar} ${continuation ? styles.continuationAvatar : ""}`} aria-hidden="true">{initials}</span> : null}
    <div className={styles.messageContent}>
      <div className={continuation ? styles.srOnly : `t-meta ${styles.messageHeader}`}>
        <strong>{message.authorName}</strong>
      </div>
      <div className={styles.bubble}>
        {quote ? <button id={`team-quote-${message.id}`} type="button" className={styles.quote} onClick={() => onQuote(quote.id)} aria-label={`Перейти к сообщению ${quote.authorName}`}>
          <strong>{quote.authorName}</strong><span>{quote.deletedAt ? "Сообщение удалено" : quote.bodyPreview}</span>
        </button> : null}
        {message.deletedAt ? <p className={styles.muted}>Сообщение удалено</p> : <p className={`t-body-compact ${styles.body}`} data-chat-body={isOwn ? undefined : message.id.toLowerCase()}>
          {plainTextLinks(message.body).map((part, index) => part.href ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">{part.text}</a> : part.text)}
        </p>}
        {!message.deletedAt && mentionedNames.length ? <p className={styles.mentionNames}>Упоминания: {mentionedNames.join(", ")}</p> : null}
      </div>
      <div className={`${styles.messageActions} ${styles.messageFooter}`}>
        <span className={`t-meta ${styles.messageMetadata}`}>
          <time className="font-mono" dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: PLATFORM_ORGANIZATION_TIMEZONE })}>{new Date(message.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: PLATFORM_ORGANIZATION_TIMEZONE })}</time>
          {message.editedAt && !message.deletedAt ? <span className={styles.muted}>изменено</span> : null}
        </span>
        <button type="button" className={styles.textButton} onClick={() => onReply(message)}><Icon name="message-circle" size={16} />Ответить</button>
        <details ref={menu} className={styles.messageMenu}>
          <summary aria-label="Действия с сообщением"><Icon name="more-horizontal" size={20} /></summary>
          <div className={styles.menuItems}>
            {!message.deletedAt && isOwn ? <button type="button" className={styles.textButton} onClick={() => { onEdit(message); closeMenu(); }}>Изменить</button> : null}
            {!message.deletedAt && (isOwn || canModerate) ? <button type="button" className={styles.textButton} onClick={() => { onDelete(message); closeMenu(); }}>{isOwn ? "Удалить" : "Модерация"}</button> : null}
            <a className={styles.textButton} href={`/v3/team-chat?channel=${message.channelKey}&message=${message.id}`}>Ссылка</a>
          </div>
        </details>
      </div>
    </div>
  </article>;
}

/**
 * Подряд удалённые сообщения без живых ответов — одна тихая строка (Э8.9,
 * `teamChatFeedItems`). У каждого свёрнутого сообщения остаётся своя цель
 * `team-message-channel-<id>`/`data-chat-row` на всю строку: ссылка на
 * сообщение, источник задачи, «К непрочитанным», подсветка и якоря прокрутки
 * приходят сюда. Фокус при переходе получает сама строка.
 */
export function TeamChatDeletedRun({ messages, highlighted }: { messages: readonly TeamChatMessage[]; highlighted: boolean }) {
  return <div className={`${styles.deletedRun} ${highlighted ? styles.highlighted : ""}`} data-chat-deleted-run={messages.length} tabIndex={-1}>
    {messages.map((message) => <span key={message.id} id={`team-message-channel-${message.id}`} data-chat-row={message.id} className={styles.deletedAnchor} />)}
    <p className="t-body-compact">{teamChatDeletedRunLabel(messages.length)}</p>
  </div>;
}

/** Kept above the feed so context/search navigation cannot discard an unknown request. */
export function TeamChatDeleteConfirmation({ attempt, visible, onCancel, onSaved, onFailure }: {
  attempt: TeamChatDeletionAttempt; visible: boolean; onCancel: (uncertain: boolean) => void;
  onSaved: () => void; onFailure: (failure: TeamChatFailure) => void;
}) {
  const { message, requestId, isOwn } = attempt;
  const [reason, setReason] = useState("");
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [state, action, pending] = useActionState(async (): Promise<TeamChatActionState> => {
    if (!mounted.current) return { status: "unavailable", requestId, messageId: null };
    const form = new FormData();
    form.set("channel", message.channelKey); form.set("request_id", requestId);
    form.set("input", JSON.stringify({ operation: isOwn ? "delete" : "moderate", messageId: message.id,
      expectedVersion: message.version, ...(!isOwn ? { reason } : {}) }));
    let result: TeamChatActionState;
    try { result = await teamChatCommandAction(TEAM_CHAT_INITIAL_ACTION, form); }
    catch { result = { status: "unavailable", requestId, messageId: null }; }
    if (!mounted.current) return result;
    if (result.status === "saved") onSaved();
    else if (result.status === "forbidden") onFailure("forbidden");
    return result;
  }, TEAM_CHAT_INITIAL_ACTION);
  if (!visible) return null;
  const cancel = () => { if (!pending) onCancel(state.status === "unavailable"); };
  return <form action={action} className={styles.confirmation} data-chat-overlay="true" aria-label={isOwn ? "Подтвердить удаление" : "Модерация сообщения"}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
    <p>{isOwn ? "Удалить текст сообщения? Ответы останутся." : "Удалить сообщение как администратор? Причина останется в журнале."}</p>
    <p className={styles.draftPreview}>{message.body}</p>
    {!isOwn ? <label className={styles.label}>Причина модерации<input autoFocus value={reason} minLength={3} maxLength={500} required
      readOnly={pending || state.status === "unavailable"} onChange={(event) => setReason(event.target.value)} /></label> : null}
    <div className={styles.messageActions}>
      <button type="submit" autoFocus={isOwn} className={QUEUE_CONFIRM} disabled={pending}>{pending ? "Удаляем…" : state.status === "unavailable" ? "Повторить тот же запрос" : "Подтвердить удаление"}</button>
      <button type="button" className={styles.secondary} disabled={pending} onClick={cancel}>Отмена</button>
    </div>
    {state.status !== "saved" && state.status !== "idle" ? <p role="alert" className={styles.error}>{TEAM_CHAT_COMMAND_FAILURE_COPY[isOwn ? "delete" : "moderate"][state.status]}</p> : null}
  </form>;
}
