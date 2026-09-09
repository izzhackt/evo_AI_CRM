"use client";

import { useActionState, useRef, useState, useSyncExternalStore } from "react";
import { teamChatCommandAction } from "@/lib/platform-team-chat-actions";
import { TEAM_CHAT_FAILURE_COPY, TEAM_CHAT_INITIAL_ACTION, type TeamChatChannelKey, type TeamChatMessage, type TeamChatParticipant } from "@/lib/platform-team-chat";
import styles from "./team-chat.module.css";

type Draft = { body: string; mentions: string[]; requestId: string; retryInput?: string };
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

type ComposerProps = {
  channel: TeamChatChannelKey; parentId?: string | null; edit?: TeamChatMessage;
  participants: readonly TeamChatParticipant[]; storageScope: string;
  onSaved: (messageId: string | null) => void; onCancel?: () => void;
};

export function TeamChatComposer(props: ComposerProps) {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return mounted ? <MountedTeamChatComposer {...props} /> : <div className={styles.composer} role="status">Загружаем черновик…</div>;
}

function MountedTeamChatComposer({ channel, parentId = null, edit, participants, storageScope, onSaved, onCancel }: ComposerProps) {
  const key = `evo-team-draft-v1:${storageScope}:${channel}:${edit ? `edit:${edit.id}` : parentId ?? "channel"}`;
  const [initial] = useState(() => {
    const value = { draft: { body: edit?.body ?? "", mentions: [...edit?.mentionedMembershipIds ?? []], requestId: crypto.randomUUID() } as Draft, storageError: false };
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Draft>;
        if (typeof saved.body === "string" && Array.isArray(saved.mentions) && saved.mentions.every((id) => typeof id === "string")
          && typeof saved.requestId === "string" && (saved.retryInput === undefined || typeof saved.retryInput === "string")) value.draft = saved as Draft;
      }
    } catch { value.storageError = true; }
    return value;
  });
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [storageError, setStorageError] = useState(initial.storageError);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const [state, action, pending] = useActionState(async (previous: typeof TEAM_CHAT_INITIAL_ACTION, submitted: FormData) => {
    const attempted = { ...draft, retryInput: String(submitted.get("input")) };
    setDraft(attempted);
    try { sessionStorage.setItem(key, JSON.stringify(attempted)); } catch { setStorageError(true); }
    try {
      const result = await teamChatCommandAction(previous, submitted);
      if (result.status === "saved") {
        const empty = { body: "", mentions: [], requestId: crypto.randomUUID() };
        setDraft(empty);
        try { sessionStorage.removeItem(key); } catch { setStorageError(true); }
        onSaved(result.messageId);
        textarea.current?.focus();
      } else if (result.status !== "unavailable") {
        const retryable = { ...draft, requestId: crypto.randomUUID(), retryInput: undefined };
        setDraft(retryable);
        try { sessionStorage.setItem(key, JSON.stringify(retryable)); } catch { setStorageError(true); }
      }
      return result;
    } catch {
      return { status: "unavailable" as const, requestId: draft.requestId, messageId: null };
    }
  }, initial.draft.retryInput ? { status: "unavailable" as const, requestId: initial.draft.requestId, messageId: null } : TEAM_CHAT_INITIAL_ACTION);
  const uncertain = state.status === "unavailable";

  function updateDraft(patch: Partial<Draft>) {
    const next = { ...draft, ...patch,
      requestId: ["invalid", "conflict", "not_found", "forbidden"].includes(state.status) ? crypto.randomUUID() : draft.requestId };
    setDraft(next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { setStorageError(true); }
  }

  const input = edit
    ? { operation: "edit", messageId: edit.id, expectedVersion: edit.version, body: draft.body, mentionedMembershipIds: draft.mentions }
    : { operation: "post", body: draft.body, parentMessageId: parentId, mentionedMembershipIds: draft.mentions };
  return (
    <form ref={form} action={action} className={styles.composer} aria-label={edit ? "Изменить сообщение" : parentId ? "Ответить в обсуждении" : "Новое сообщение"}>
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="request_id" value={draft.requestId} />
      <input type="hidden" name="input" value={draft.retryInput ?? JSON.stringify(input)} />
      <label className={styles.label} htmlFor={`${key}-body`}>{edit ? "Правка сообщения" : parentId ? "Ответ в обсуждении" : "Сообщение в канал"}</label>
      <textarea id={`${key}-body`} ref={textarea} value={draft.body} rows={3}
        readOnly={pending || uncertain} maxLength={16000}
        placeholder="Напишите коллегам…" aria-describedby={`${key}-hint`}
        onChange={(event) => updateDraft({ body: event.target.value })}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel) { event.preventDefault(); onCancel(); }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) {
            event.preventDefault();
            if (!pending && draft.body.trim()) form.current?.requestSubmit();
          }
        }} />
      <details className={styles.mentions}>
        <summary>Упомянуть коллегу{draft.mentions.length ? ` · ${draft.mentions.length}` : ""}</summary>
        <div className={styles.mentionOptions}>
          {participants.map((participant) => (
            <label key={participant.membershipId}>
              <input type="checkbox" checked={draft.mentions.includes(participant.membershipId)} disabled={pending || uncertain}
                onChange={(event) => updateDraft({ mentions: event.target.checked
                  ? [...draft.mentions, participant.membershipId].slice(0, 20)
                  : draft.mentions.filter((id) => id !== participant.membershipId) })} />
              {participant.displayName}
            </label>
          ))}
          {draft.mentions.filter((id) => !participants.some((participant) => participant.membershipId === id)).map((id) => (
            <label key={id}><input type="checkbox" checked disabled={pending || uncertain}
              onChange={() => updateDraft({ mentions: draft.mentions.filter((selected) => selected !== id) })} />
              Недоступный участник — снимите упоминание перед отправкой
            </label>
          ))}
          {participants.length === 0 ? <p>Нет доступных участников.</p> : null}
        </div>
      </details>
      <div className={styles.composerFooter}>
        <span id={`${key}-hint`} className={styles.muted}>Enter — отправить · Shift+Enter — новая строка</span>
        <span className={styles.muted}>{Array.from(draft.body).length}/8000</span>
        {onCancel ? <button type="button" className={styles.secondary} onClick={onCancel} disabled={pending}>Отмена</button> : null}
        <button className={styles.primary} type="submit" disabled={pending || !draft.body.trim() || Array.from(draft.body).length > 8000}>
          {pending ? "Отправляется…" : uncertain ? "Повторить тот же запрос" : edit ? "Сохранить" : "Отправить"}
        </button>
      </div>
      <div aria-live="polite" className={styles.muted}>{pending ? "Ожидаем подтверждения сервера…" : draft.body ? "Черновик в этой вкладке" : state.status === "saved" ? edit ? "Сохранено" : "Отправлено" : null}</div>
      {state.status !== "idle" && state.status !== "saved" ? <p role="alert" className={styles.error}>{TEAM_CHAT_FAILURE_COPY[state.status]}</p> : null}
      {state.status === "conflict" && edit ? <p className={styles.muted}>Отмените правку, обновите историю и откройте изменение снова. Ваш черновик останется.</p> : null}
      {uncertain ? <p className={styles.muted}>Текст зафиксирован для безопасного повтора: сервер мог уже принять сообщение.</p> : null}
      {storageError ? <p className={styles.error}>Браузер не сохраняет черновик. Оставьте вкладку открытой до подтверждения отправки.</p> : null}
    </form>
  );
}
