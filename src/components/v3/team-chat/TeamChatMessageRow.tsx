"use client";

import { useActionState, useLayoutEffect, useRef, useState } from "react";
import { teamChatCommandAction } from "@/lib/platform-team-chat-actions";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import { TEAM_CHAT_FAILURE_COPY, TEAM_CHAT_INITIAL_ACTION, type TeamChatActionState, type TeamChatFailure, type TeamChatMessage, type TeamChatParticipant } from "@/lib/platform-team-chat";
import type { TeamChatQuote } from "@/lib/platform-team-chat-timeline";
import { plainTextLinks } from "@/lib/plain-text-links";
import { Icon } from "@/components/icons";
import styles from "./team-chat.module.css";

export type TeamChatDeletionAttempt = { message: TeamChatMessage; requestId: string; isOwn: boolean };

export function TeamChatMessageRow({ message, quote, ownMembershipId, canModerate, participants, onReply, onEdit, onDelete, onQuote, highlighted = false, continuation = false }: {
  message: TeamChatMessage; quote: TeamChatQuote | null; ownMembershipId: string; canModerate: boolean;
  participants: readonly TeamChatParticipant[]; onReply: (message: TeamChatMessage) => void;
  onEdit: (message: TeamChatMessage) => void; onDelete: (message: TeamChatMessage) => void; onQuote: (id: string) => void; highlighted?: boolean; continuation?: boolean;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const isOwn = message.authorMembershipId === ownMembershipId;
  const initials = message.authorName.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU");
  const mentionedNames = message.mentionedMembershipIds.map((id) => participants.find((person) => person.membershipId === id)?.displayName ?? "Участник");
  function closeMenu() { if (menu.current) menu.current.open = false; }
  return <article id={`team-message-channel-${message.id}`} data-chat-row={message.id} tabIndex={-1}
    className={`${styles.message} ${isOwn ? styles.ownMessage : ""} ${highlighted ? styles.highlighted : ""} ${continuation ? styles.continuation : ""}`}>
    {!isOwn ? <span className={`${styles.authorAvatar} ${continuation ? styles.continuationAvatar : ""}`} aria-hidden="true">{initials}</span> : null}
    <div className={styles.messageContent}>
      <div className={continuation ? styles.srOnly : styles.messageHeader}>
        <strong>{message.authorName}</strong>
      </div>
      <div className={styles.bubble}>
        {quote ? <button id={`team-quote-${message.id}`} type="button" className={styles.quote} onClick={() => onQuote(quote.id)} aria-label={`Перейти к сообщению ${quote.authorName}`}>
          <strong>{quote.authorName}</strong><span>{quote.deletedAt ? "Сообщение удалено" : quote.bodyPreview}</span>
        </button> : null}
        {message.deletedAt ? <p className={styles.muted}>Сообщение удалено</p> : <p className={styles.body} data-chat-body={isOwn ? undefined : message.id.toLowerCase()}>
          {plainTextLinks(message.body).map((part, index) => part.href ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">{part.text}</a> : part.text)}
        </p>}
        {!message.deletedAt && mentionedNames.length ? <p className={styles.mentionNames}>Упоминания: {mentionedNames.join(", ")}</p> : null}
      </div>
      <div className={`${styles.messageActions} ${styles.messageFooter}`}>
        <span className={styles.messageMetadata}>
          <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: PLATFORM_ORGANIZATION_TIMEZONE })}>{new Date(message.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: PLATFORM_ORGANIZATION_TIMEZONE })}</time>
          {message.editedAt && !message.deletedAt ? <span className={styles.muted}>изменено</span> : null}
        </span>
        <button type="button" className={styles.textButton} onClick={() => onReply(message)}><Icon name="message-circle" size={16} />Ответить</button>
        <details ref={menu} className={styles.messageMenu}>
          <summary aria-label="Действия с сообщением"><span aria-hidden="true">···</span></summary>
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
      <button type="submit" autoFocus={isOwn} className={styles.primary} disabled={pending}>{pending ? "Удаляем…" : state.status === "unavailable" ? "Повторить тот же запрос" : "Подтвердить удаление"}</button>
      <button type="button" className={styles.secondary} disabled={pending} onClick={cancel}>Отмена</button>
    </div>
    {state.status !== "saved" && state.status !== "idle" ? <p role="alert" className={styles.error}>{TEAM_CHAT_FAILURE_COPY[state.status]}</p> : null}
  </form>;
}
