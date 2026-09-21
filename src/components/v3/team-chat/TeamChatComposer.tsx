"use client";

import { useActionState, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type Ref, type RefObject } from "react";
import { Icon } from "@/components/icons";
import { teamChatCommandAction } from "@/lib/platform-team-chat-actions";
import { postTeamChatV2Action } from "@/lib/platform-team-chat-v2-actions";
import { TEAM_CHAT_FAILURE_COPY, TEAM_CHAT_INITIAL_ACTION, type TeamChatActionState, type TeamChatChannelKey, type TeamChatFailure, type TeamChatMessage, type TeamChatParticipant } from "@/lib/platform-team-chat";
import type { TeamChatQuote } from "@/lib/platform-team-chat-timeline";
import { decodeTeamChatDraft, newTeamChatDraft, teamChatDraftHasContent, teamChatDraftInput, teamChatDraftLabel, teamChatDraftPrefix, type TeamChatDraft } from "@/lib/team-chat-drafts";
import styles from "./team-chat.module.css";

export type TeamChatComposerHandle = { reply: (message: TeamChatMessage) => void; edit: (message: TeamChatMessage) => void; focus: () => void };
type ComposerProps = {
  channel: TeamChatChannelKey; participants: readonly TeamChatParticipant[]; storageScope: string;
  quotes: Readonly<Record<string, TeamChatQuote>>; ref?: Ref<TeamChatComposerHandle>;
  onSaved: (messageId: string | null) => void; onFailure: (failure: TeamChatFailure) => void;
  onResumeEdit: (id: string) => Promise<TeamChatMessage | null>;
};
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function TeamChatComposer(props: ComposerProps) {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return mounted ? <MountedComposer {...props} /> : <div className={styles.composer} role="status">Загружаем черновик…</div>;
}

function MountedComposer({ channel, storageScope, ref, quotes, onSaved, onResumeEdit, ...props }: ComposerProps) {
  const defaultKey = `${teamChatDraftPrefix(storageScope, channel, 2)}post`;
  const [initial] = useState(() => {
    const drafts = new Map<string, TeamChatDraft | null>();
    let error = false;
    try {
      const prefixes = [1, 2].map((v) => teamChatDraftPrefix(storageScope, channel, v as 1 | 2));
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
          const raw = sessionStorage.getItem(key);
          if (raw !== null) drafts.set(key, decodeTeamChatDraft(raw, key, storageScope, channel));
        }
      }
    } catch { error = true; }
    if (!drafts.has(defaultKey)) drafts.set(defaultKey, newTeamChatDraft(crypto.randomUUID()));
    return { drafts, error };
  });
  const drafts = useRef(initial.drafts);
  const [session, setSession] = useState<{ key: string; draft: TeamChatDraft | null; serial: number; focus: boolean }>({ key: defaultKey, draft: initial.drafts.get(defaultKey) ?? null, serial: 0, focus: false });
  const [storageError, setStorageError] = useState(initial.error);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftList, setDraftList] = useState(() => Array.from(initial.drafts.entries()));
  const recoveryMenu = useRef<HTMLDetailsElement>(null);
  const [resuming, setResuming] = useState(false);
  const [resume, setResume] = useState<{ key: string; message: TeamChatMessage } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  function persist(key: string, draft: TeamChatDraft) {
    drafts.current.set(key, draft);
    setDraftList(Array.from(drafts.current.entries()));
    try { sessionStorage.setItem(key, JSON.stringify(draft)); } catch { setStorageError(true); }
  }
  function select(key: string, draft: TeamChatDraft | null, focus = true) {
    if (pending.current) return;
    setResume(null);
    setSession((previous) => ({ key, draft, serial: previous.serial + 1, focus }));
    if (recoveryMenu.current) recoveryMenu.current.open = false;
    setDraftList(Array.from(drafts.current.entries()));
  }
  function openDefault() {
    select(defaultKey, drafts.current.get(defaultKey) ?? null, false);
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    else requestAnimationFrame(() => field.current?.focus());
  }
  async function loadCurrentEdit() {
    const draft = drafts.current.get(session.key);
    if (!draft || draft.retryInput || draft.target.kind !== "edit" || pending.current) return;
    pending.current = true; setResuming(true);
    try {
      const message = await onResumeEdit(draft.target.messageId);
      if (!message || message.deletedAt) { setNotice("Сообщение недоступно для правки. Черновик сохранён."); return; }
      setResume({ key: session.key, message });
    } finally { pending.current = false; setResuming(false); }
  }
  useImperativeHandle(ref, () => ({
    focus: () => field.current?.focus(),
    reply(message) {
      if (pending.current) return;
      const draft = drafts.current.get(defaultKey);
      if (!draft) { setNotice("Сохранённый черновик не удалось прочитать. Он оставлен в браузере без изменений."); return; }
      if (draft.retryInput) {
        setNotice("Сначала получите подтверждение предыдущей отправки. Её текст и адресат сохранены.");
        select(defaultKey, draft); return;
      }
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-chat-row]") ?? document.activeElement : null;
      const next: TeamChatDraft = { ...draft, requestId: crypto.randomUUID(), target: { kind: "post-v2", quoteMessageId: message.id } };
      persist(defaultKey, next); select(defaultKey, next); setNotice(null);
    },
    edit(message) {
      if (pending.current) return;
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-chat-row]") ?? document.activeElement : null;
      const key = `${teamChatDraftPrefix(storageScope, channel, 2)}edit:${message.id}`;
      const draft = drafts.current.has(key) ? drafts.current.get(key)! : newTeamChatDraft(crypto.randomUUID(), message);
      drafts.current.set(key, draft); select(key, draft); setNotice(null);
    },
  }));

  const recoverable = draftList.filter(([key, draft]) => key !== session.key && (draft === null || teamChatDraftHasContent(draft)));
  return <div className={styles.composer}>
    {recoverable.length ? <details ref={recoveryMenu} className={styles.drafts}>
      <summary>Сохранённые черновики · {recoverable.length}</summary>
      {recoverable.map(([key, draft]) => <div key={key}>
        <button className={styles.textButton} type="button" onClick={() => { select(key, draft); setNotice(null); }}>
          {draft ? teamChatDraftLabel(draft) : "Черновик не удалось прочитать"}
          {draft?.body ? ` — ${Array.from(draft.body).slice(0, 60).join("")}` : ""}
        </button>
      </div>)}
    </details> : null}
    {notice ? <p className={styles.muted} role="status">{notice}</p> : null}
    {resume ? <div data-chat-overlay="true">
      <p className={styles.muted}>Сейчас в переписке:</p><p className={styles.draftPreview}>{resume.message.body}</p>
      <p className={styles.muted}>Продолжить правку с вашим сохранённым текстом?</p>
      <button type="button" className={styles.secondary} onClick={() => {
        const draft = drafts.current.get(resume.key);
        if (!draft || draft.retryInput || draft.target.kind !== "edit") return;
        const next: TeamChatDraft = { ...draft, requestId: crypto.randomUUID(), target: { kind: "edit", messageId: resume.message.id, expectedVersion: resume.message.version } };
        persist(resume.key, next); select(resume.key, next);
      }}>Продолжить правку</button>
      <button type="button" className={styles.textButton} onClick={() => setResume(null)}>Назад к черновику</button>
    </div> : session.draft === null ? <p role="alert" className={styles.error}>Сохранённый черновик повреждён. Исходная запись оставлена в браузере; отправка отключена.</p>
      : session.draft.target.kind === "edit" && session.draft.target.expectedVersion === null ? <div>
        <p className={styles.muted}>У прежней правки нет версии исходного сообщения. Загрузите актуальный текст и подтвердите продолжение.</p>
        <p className={styles.draftPreview}>{session.draft.body}</p>
        <button type="button" className={styles.secondary} disabled={resuming} onClick={() => { void loadCurrentEdit(); }}>{resuming ? "Загружаем…" : "Показать актуальное сообщение"}</button>
      </div> : <DraftForm key={`${session.key}:${session.serial}`} initial={session.draft} fieldRef={field} focus={session.focus} channel={channel}
        participants={props.participants} quotes={quotes} onFailure={props.onFailure}
        disabled={resuming} onResume={() => { void loadCurrentEdit(); }}
        onPending={(value) => { pending.current = value; }} onChange={(draft) => persist(session.key, draft)}
        onSaved={(id) => {
          pending.current = false;
          if (session.key === defaultKey) drafts.current.set(defaultKey, newTeamChatDraft(crypto.randomUUID()));
          else drafts.current.delete(session.key);
          try { sessionStorage.removeItem(session.key); } catch { setStorageError(true); }
          select(defaultKey, drafts.current.get(defaultKey) ?? null, session.draft?.target.kind !== "edit");
          setNotice("Сообщение сохранено.");
          onSaved(id); // Read failures are reported by the feed, never as failed sending.
          if (session.draft?.target.kind === "edit") {
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
            else requestAnimationFrame(() => field.current?.focus());
          }
        }} />}
    {session.key !== defaultKey ? <button type="button" className={styles.textButton} disabled={resuming} onClick={openDefault}>Вернуться к новому сообщению</button> : null}
    {storageError ? <p role="alert" className={styles.error}>Браузер не сохраняет черновики. Они остаются в этой открытой вкладке; не закрывайте её до подтверждения отправки.</p> : null}
  </div>;
}

function DraftForm({ initial, fieldRef, focus, channel, participants, quotes, onChange, onSaved, onFailure, onPending, disabled, onResume }: {
  initial: TeamChatDraft; fieldRef: RefObject<HTMLTextAreaElement | null>; focus: boolean; channel: TeamChatChannelKey;
  participants: readonly TeamChatParticipant[]; quotes: Readonly<Record<string, TeamChatQuote>>;
  onChange: (draft: TeamChatDraft) => void; onSaved: (id: string | null) => void;
  onFailure: (failure: TeamChatFailure) => void; onPending: (pending: boolean) => void;
  disabled: boolean; onResume: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const form = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const edit = draft.target.kind === "edit";
  const quoteId = draft.target.kind === "post-v2" ? draft.target.quoteMessageId : draft.target.kind === "post-v1" ? draft.target.parentMessageId : null;
  const quote = quoteId ? quotes[quoteId.toLowerCase()] : null;
  function update(next: TeamChatDraft) { setDraft(next); onChange(next); }
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field || field.getBoundingClientRect().width === 0) return;
    field.style.overflowY = "hidden"; field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`; field.style.overflowY = "auto";
  }, [draft.body, fieldRef]);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    if (focus) field.focus();
    let width = field.getBoundingClientRect().width;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const next = field.getBoundingClientRect().width;
      if (next === width) return;
      width = next; cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        field.style.height = "auto"; field.style.height = `${field.scrollHeight}px`;
      });
    });
    observer.observe(field);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [fieldRef, focus]);
  const [state, action, actionPending] = useActionState<TeamChatActionState, FormData>(async () : Promise<TeamChatActionState> => {
    if (!mounted.current) return { status: "unavailable", requestId: draft.requestId, messageId: null };
    const input = teamChatDraftInput(draft);
    if (!input) return { status: "invalid", requestId: draft.requestId, messageId: null };
    const frozen = { ...draft, retryInput: input };
    update(frozen); onPending(true);
    let result: TeamChatActionState;
    try {
      if (draft.target.kind === "post-v2") {
        const response = await postTeamChatV2Action({ channel, requestId: draft.requestId, input: JSON.parse(input) });
        result = { status: response.status, requestId: draft.requestId, messageId: response.status === "saved" ? response.receipt.messageId : null };
      } else {
        const submitted = new FormData();
        submitted.set("channel", channel); submitted.set("request_id", draft.requestId); submitted.set("input", input);
        result = await teamChatCommandAction(TEAM_CHAT_INITIAL_ACTION, submitted);
      }
    } catch { result = { status: "unavailable", requestId: draft.requestId, messageId: null }; }
    if (!mounted.current) return result;
    onPending(false);
    if (result.status === "saved") onSaved(result.messageId);
    else if (result.status === "forbidden") {
      update({ ...draft, requestId: crypto.randomUUID(), retryInput: undefined }); onFailure("forbidden");
    }
    else if (result.status !== "unavailable") update({ ...draft, requestId: crypto.randomUUID(), retryInput: undefined });
    return result;
  }, initial.retryInput ? { status: "unavailable", requestId: initial.requestId, messageId: null } : TEAM_CHAT_INITIAL_ACTION);
  const pending = actionPending || disabled;
  const uncertain = Boolean(draft.retryInput);
  const bodyTooLong = Array.from(draft.body).length > 8000;
  const fieldId = `team-composer-${initial.requestId}`;
  return <form ref={form} action={action} aria-label={teamChatDraftLabel(draft)}>
    {edit ? <p className={styles.muted}>Изменение сообщения</p> : quoteId ? <div className={styles.composerQuote}>
      <div><strong>{quote?.authorName ?? "Ответ на сообщение"}</strong><p>{quote?.deletedAt ? "Сообщение удалено" : quote?.bodyPreview ?? "Исходное сообщение вне загруженного участка"}</p></div>
      {draft.target.kind === "post-v2" ? <button type="button" className={styles.iconButton} disabled={pending || uncertain} aria-label="Убрать цитату" onClick={() => update({ ...draft, target: { kind: "post-v2", quoteMessageId: null } })}><Icon name="x" size={18} /></button> : null}
    </div> : null}
    <label className={styles.srOnly} htmlFor={fieldId}>{edit ? "Правка сообщения" : "Сообщение в канал"}</label>
    <div className={styles.composerInput}>
      <textarea ref={fieldRef} id={fieldId} value={draft.body} rows={1} readOnly={pending || uncertain} maxLength={16000}
        placeholder="Напишите коллегам…" aria-invalid={bodyTooLong || undefined} aria-describedby={bodyTooLong ? `${fieldId}-limit` : undefined}
        onChange={(event) => update({ ...draft, body: event.target.value })}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) {
            event.preventDefault();
            if (!pending && teamChatDraftInput(draft)) form.current?.requestSubmit();
          }
        }} />
      <details className={styles.mentions}>
        <summary aria-label="Упомянуть коллегу"><span aria-hidden="true">@{draft.mentions.length ? <small>{draft.mentions.length}</small> : null}</span></summary>
        <div className={styles.mentionOptions}>
          {participants.map((person) => <label key={person.membershipId}><input type="checkbox" checked={draft.mentions.includes(person.membershipId)} disabled={pending || uncertain}
            onChange={(event) => update({ ...draft, mentions: event.target.checked ? [...draft.mentions, person.membershipId].slice(0, 20) : draft.mentions.filter((id) => id !== person.membershipId) })} />{person.displayName}</label>)}
          {draft.mentions.filter((id) => !participants.some((person) => person.membershipId === id)).map((id) => <label key={id}><input type="checkbox" checked disabled={pending || uncertain}
            onChange={() => update({ ...draft, mentions: draft.mentions.filter((value) => value !== id) })} />Недоступный участник — снимите упоминание перед отправкой</label>)}
          {!participants.length ? <p>Нет доступных участников.</p> : null}
        </div>
      </details>
      <button className={styles.sendButton} type="submit" disabled={pending || !teamChatDraftInput(draft)} aria-label={pending ? "Отправляется…" : uncertain ? "Повторить тот же запрос" : edit ? "Сохранить" : "Отправить"}>
        <Icon name={pending ? "clock" : edit ? "check" : "send"} size={22} />
      </button>
    </div>
    {bodyTooLong ? <p id={`${fieldId}-limit`} role="alert" className={styles.error}>Сократите сообщение до 8000 символов.</p> : null}
    <div aria-live="polite" className={styles.muted}>{pending ? "Ожидаем подтверждения сервера…" : null}</div>
    {state.status !== "idle" && state.status !== "saved" ? <p role="alert" className={styles.error}>{TEAM_CHAT_FAILURE_COPY[state.status]}</p> : null}
    {state.status === "conflict" && edit ? <p className={styles.muted}>Исходное сообщение изменилось. Черновик сохранён; откройте актуальное сообщение перед новой правкой.</p> : null}
    {edit && !uncertain ? <button type="button" className={styles.textButton} disabled={pending} onClick={onResume}>Сверить исходное сообщение</button> : null}
    {uncertain ? <p className={styles.muted}>Текст и адресат зафиксированы: сервер мог уже принять сообщение. Повтор проверит тот же запрос.</p> : null}
  </form>;
}
