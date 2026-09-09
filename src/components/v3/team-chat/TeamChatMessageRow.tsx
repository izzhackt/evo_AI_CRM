"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { teamChatCommandAction } from "@/lib/platform-team-chat-actions";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import { TEAM_CHAT_FAILURE_COPY, TEAM_CHAT_INITIAL_ACTION, type TeamChatMessage, type TeamChatParticipant } from "@/lib/platform-team-chat";
import { TeamChatComposer } from "./TeamChatComposer";
import styles from "./team-chat.module.css";

type DeletionAttempt = { message: TeamChatMessage; requestId: string; isOwn: boolean };

export function TeamChatMessageRow({ message, ownMembershipId, canModerate, participants, storageScope, onReply, onSaved, renderMessageAction, highlighted = false, location = "channel" }: {
  message: TeamChatMessage; ownMembershipId: string; canModerate: boolean;
  participants: readonly TeamChatParticipant[]; storageScope: string;
  onReply: (message: TeamChatMessage) => void; onSaved: () => void;
  renderMessageAction?: (message: TeamChatMessage) => ReactNode; highlighted?: boolean; location?: "channel" | "thread";
}) {
  const [editing, setEditing] = useState<TeamChatMessage | null>(null);
  const [deleting, setDeleting] = useState<DeletionAttempt | null>(null);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const isOwn = message.authorMembershipId === ownMembershipId;
  const mentionedNames = message.mentionedMembershipIds.map((id) => participants.find((person) => person.membershipId === id)?.displayName ?? "Участник");
  return (
    <article id={`team-message-${location}-${message.id}`} tabIndex={-1} className={`${styles.message} ${highlighted ? styles.highlighted : ""}`}>
      <div className={styles.messageHeader}>
        <strong>{message.authorName}</strong>
        <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: PLATFORM_ORGANIZATION_TIMEZONE })}</time>
        {message.editedAt && !message.deletedAt ? <span className={styles.muted}>изменено</span> : null}
      </div>
      {message.deletedAt ? <p className={styles.muted}>Сообщение удалено</p> : <p className={styles.body}>{message.body}</p>}
      {mentionedNames.length ? <p className={styles.mentionNames}>Упоминания: {mentionedNames.join(", ")}</p> : null}
      <div className={styles.messageActions}>
        <button type="button" className={styles.textButton} onClick={() => onReply(message)}>
          {message.parentMessageId ? "К обсуждению" : message.replyCount ? `Ответы · ${message.replyCount}` : "Ответить"}
        </button>
        {!message.deletedAt && isOwn ? <button ref={editButton} className={styles.textButton} type="button" onClick={() => setEditing(message)}>Изменить</button> : null}
        {!message.deletedAt && (isOwn || canModerate) ? <button ref={deleteButton} className={styles.textButton} type="button"
          onClick={() => { if (!deleting) setDeleting({ message, requestId: crypto.randomUUID(), isOwn }); setConfirmingDeletion(true); }}>
          {isOwn ? "Удалить" : "Модерация"}
        </button> : null}
        {!message.deletedAt && !editing && !confirmingDeletion ? renderMessageAction ? renderMessageAction(message) : <a className={styles.textButton}
          href={`/v3/tasks?create=staff&message=${message.id}&channel=${message.channelKey}`}>Создать задачу</a> : null}
        {message.linkedTaskIds?.map((id) => <a className={styles.textButton} key={id} href={`/v3/tasks?task=${id}`}>Задача создана ↗</a>)}
        <a className={styles.textButton} href={`/v3/team-chat?channel=${message.channelKey}&message=${message.id}`}>Ссылка</a>
      </div>
      {editing ? <TeamChatComposer key={`edit:${editing.id}`} channel={message.channelKey} edit={editing}
        participants={participants} storageScope={storageScope}
        onCancel={() => { setEditing(null); editButton.current?.focus(); }}
        onSaved={() => { setEditing(null); onSaved(); editButton.current?.focus(); }} /> : null}
      {deleting ? <TeamChatDeleteConfirmation key={deleting.requestId} attempt={deleting} visible={confirmingDeletion}
        onCancel={(uncertain) => {
          setConfirmingDeletion(false);
          // An unknown result must retain the mounted form and its original retry payload.
          if (!uncertain) setDeleting(null);
          deleteButton.current?.focus();
        }}
        onSaved={() => { setDeleting(null); setConfirmingDeletion(false); onSaved(); deleteButton.current?.focus(); }} /> : null}
    </article>
  );
}

function TeamChatDeleteConfirmation({ attempt, visible, onCancel, onSaved }: {
  attempt: DeletionAttempt; visible: boolean; onCancel: (uncertain: boolean) => void; onSaved: () => void;
}) {
  const { message, requestId, isOwn } = attempt;
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(async (previous: typeof TEAM_CHAT_INITIAL_ACTION, form: FormData) => {
    try {
      const result = await teamChatCommandAction(previous, form);
      if (result.status === "saved") onSaved();
      return result;
    } catch { return { status: "unavailable" as const, requestId, messageId: null }; }
  }, TEAM_CHAT_INITIAL_ACTION);
  const cancel = () => onCancel(state.status === "unavailable");
  if (!visible) return null;
  return (
    <form action={action} className={styles.confirmation}
      onKeyDown={(event) => { if (event.key === "Escape" && !pending) cancel(); }}>
      <p>{isOwn ? "Удалить текст сообщения? Ответы останутся." : "Удалить сообщение как администратор? Причина останется в журнале."}</p>
      <input type="hidden" name="channel" value={message.channelKey} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="input" value={JSON.stringify({ operation: isOwn ? "delete" : "moderate",
        messageId: message.id, expectedVersion: message.version, ...(!isOwn ? { reason } : {}) })} />
      {!isOwn ? <label className={styles.label}>Причина модерации<input autoFocus value={reason} minLength={3} maxLength={500}
        required readOnly={pending || state.status === "unavailable"} onChange={(event) => setReason(event.target.value)} /></label> : null}
      <div className={styles.messageActions}>
        <button type="submit" className={styles.primary} disabled={pending}>{pending ? "Удаляем…" : "Подтвердить удаление"}</button>
        <button type="button" className={styles.secondary} disabled={pending} onClick={cancel}>Отмена</button>
      </div>
      {state.status !== "saved" && state.status !== "idle" ? <p role="alert" className={styles.error}>{TEAM_CHAT_FAILURE_COPY[state.status]}</p> : null}
    </form>
  );
}
