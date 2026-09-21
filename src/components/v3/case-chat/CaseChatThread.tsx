"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { startTransition, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { Pill, type PillTone } from "@/components/v3/Pill";
import {
  loadStaffCaseChatThreadsAction, markCaseChatReadAction, postCaseChatMessageAction,
  readCaseChatPageAction, setCaseChatAwaitAction,
} from "@/lib/platform-case-chat-actions";
import {
  CASE_CHAT_AWAIT_STATES, CASE_CHAT_BODY_LIMIT, CASE_CHAT_FAILURE_COPY, CASE_CHAT_INITIAL_ACTION, CASE_CHAT_QUEUES, caseChatHref,
  type CaseChatActionState, type CaseChatAwaitState, type CaseChatFailure, type CaseChatMessage,
  type CaseChatPage, type CaseChatPendingAttachment, type CaseChatQueue, type CaseChatThreadRow, type CaseChatThreadsList,
} from "@/lib/platform-case-chat-contract";
import { caseChatAwaitState } from "@/lib/v3/wording";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import type { SupabasePublicConfig } from "@/lib/supabase/config";

const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });
const ROW_TIME = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });

function awaitTone(state: CaseChatAwaitState): PillTone {
  return state === "needs_reply" ? "danger" : state === "awaiting_student" ? "warn" : "neutral";
}

/**
 * Persisted part of the draft: text + pending attachment only. Which message
 * is being quoted is ephemeral, parent-owned state (`replyTo`) — not
 * restored across a reload, only the text and scroll position are (owner
 * plan: "Сохраняются черновик и положение переписки").
 */
type Draft = Readonly<{
  body: string; attachment: CaseChatPendingAttachment | null; requestId: string;
  retryBody?: string; retryQuotedMessageId?: string; retryAttachmentKind?: string; retryAttachmentId?: string;
}>;

function draftStorageKey(scope: string, caseId: string): string {
  return `evo-case-chat-draft-v1:${scope}:${caseId}`;
}
function scrollStorageKey(scope: string, caseId: string): string {
  return `evo-case-chat-scroll-v1:${scope}:${caseId}`;
}

function readStoredDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed.body !== "string" || typeof parsed.requestId !== "string") return null;
    return {
      body: parsed.body, requestId: parsed.requestId,
      attachment: parsed.attachment && typeof parsed.attachment === "object"
        && "kind" in parsed.attachment && "id" in parsed.attachment
        ? (parsed.attachment as CaseChatPendingAttachment) : null,
      retryBody: typeof parsed.retryBody === "string" ? parsed.retryBody : undefined,
      retryQuotedMessageId: typeof parsed.retryQuotedMessageId === "string" ? parsed.retryQuotedMessageId : undefined,
      retryAttachmentKind: typeof parsed.retryAttachmentKind === "string" ? parsed.retryAttachmentKind : undefined,
      retryAttachmentId: typeof parsed.retryAttachmentId === "string" ? parsed.retryAttachmentId : undefined,
    };
  } catch { return null; }
}

const subscribeNever = () => () => {};
const clientTrue = () => true;
const serverFalse = () => false;

/**
 * Composer: plain textarea + «Отправить». Frozen-retry semantics copy
 * src/lib/platform-finance-entry-actions.ts + FinanceEntryForms /
 * TeamChatComposer.tsx: on "unavailable" the exact submitted field VALUES
 * (not just the request id) are frozen into retryBody/retryQuotedMessageId/
 * retryAttachmentKind/retryAttachmentId and reused verbatim on the next
 * submit, so a retry can never post a second, slightly-different message —
 * the server's fingerprint-checked receipt table only matches an identical
 * replay. The localStorage read happens in a lazy useState initializer
 * (never in an effect), same split as TeamChatComposer.tsx's own
 * mounted/lazy-init pattern, which also avoids a server/client markup
 * mismatch (localStorage does not exist during SSR).
 */
function CaseChatComposer(props: Readonly<{
  caseId: string; storageScope: string; pendingAttachment: CaseChatPendingAttachment | null;
  onAttachmentConsumed: () => void;
  replyTo: CaseChatMessage | null; onClearReply: () => void; onSaved: () => void;
}>) {
  const mounted = useSyncExternalStore(subscribeNever, clientTrue, serverFalse);
  return mounted
    ? <MountedCaseChatComposer {...props} />
    : <div className="border-t border-border p-3 text-sm text-fg-3" role="status">Загружаем черновик…</div>;
}

function MountedCaseChatComposer({
  caseId, storageScope, pendingAttachment, onAttachmentConsumed, replyTo, onClearReply, onSaved,
}: Readonly<{
  caseId: string; storageScope: string; pendingAttachment: CaseChatPendingAttachment | null;
  onAttachmentConsumed: () => void;
  replyTo: CaseChatMessage | null; onClearReply: () => void; onSaved: () => void;
}>) {
  const key = draftStorageKey(storageScope, caseId);
  const [initial] = useState<Draft>(() => {
    const stored = readStoredDraft(key);
    if (!stored) return { body: "", attachment: pendingAttachment, requestId: crypto.randomUUID() };
    // A fresh «Обсудить» link-card overrides whatever the stored draft held —
    // silently dropping it looked like the click did nothing.
    return pendingAttachment ? { ...stored, attachment: pendingAttachment } : stored;
  });
  const [draft, setDraft] = useState<Draft>(initial);
  const [storageError, setStorageError] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const consumedAttachment = useRef(false);

  // Notifies the parent that the one-shot ?attach= link-card has been folded
  // into the local draft above — an external-system notification, not local
  // state, so it belongs in an effect (never a raw setDraft call here).
  useEffect(() => {
    if (!pendingAttachment || consumedAttachment.current) return;
    consumedAttachment.current = true;
    try {
      // Persist the link-card before removing its only reloadable URL reference.
      localStorage.setItem(key, JSON.stringify(initial));
      onAttachmentConsumed();
    } catch { /* Keep ?attach until a later draft save or confirmed send succeeds. */ }
  }, [pendingAttachment, onAttachmentConsumed, key, initial]);

  function persist(next: Draft) {
    setDraft(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      if (pendingAttachment) { consumedAttachment.current = true; onAttachmentConsumed(); }
    } catch { setStorageError(true); }
  }

  const [state, setState] = useState<CaseChatActionState>(CASE_CHAT_INITIAL_ACTION);
  const [pending, setPending] = useState(false);
  const uncertain = state.status === "unavailable";
  const bodyLength = Array.from(draft.body).length;
  const tooLong = bodyLength > CASE_CHAT_BODY_LIMIT;
  const canSend = !pending && (draft.body.trim().length > 0 || draft.attachment !== null) && !tooLong;

  async function submit(form: FormData) {
    setPending(true);
    const attempted: Draft = {
      ...draft,
      retryBody: draft.body, retryQuotedMessageId: replyTo?.id ?? "",
      retryAttachmentKind: draft.attachment?.kind ?? "", retryAttachmentId: draft.attachment?.id ?? "",
    };
    persist(attempted);
    try {
      const result = await postCaseChatMessageAction(CASE_CHAT_INITIAL_ACTION, form);
      if (result.status === "saved") {
        const empty: Draft = { body: "", attachment: null, requestId: crypto.randomUUID() };
        persist(empty);
        try { localStorage.removeItem(key); } catch { setStorageError(true); }
        onAttachmentConsumed();
        onClearReply();
        onSaved();
        textarea.current?.focus();
      } else if (result.status !== "unavailable") {
        persist({ ...draft, requestId: crypto.randomUUID(), retryBody: undefined, retryQuotedMessageId: undefined, retryAttachmentKind: undefined, retryAttachmentId: undefined });
      }
      setState(result);
    } catch {
      setState({ status: "unavailable", requestId: draft.requestId });
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={submit} className="border-t border-border p-3" aria-label="Новое сообщение">
      <input type="hidden" name="case_id" value={caseId} />
      <input type="hidden" name="request_id" value={draft.requestId} />
      <input type="hidden" name="body" value={draft.retryBody ?? draft.body} />
      <input type="hidden" name="quoted_message_id" value={draft.retryQuotedMessageId ?? replyTo?.id ?? ""} />
      <input type="hidden" name="attachment_kind" value={draft.retryAttachmentKind ?? draft.attachment?.kind ?? ""} />
      <input type="hidden" name="attachment_id" value={draft.retryAttachmentId ?? draft.attachment?.id ?? ""} />

      {replyTo ? (
        <div className="mb-2 flex items-start justify-between gap-2 rounded-ctl border border-border bg-surface-2 px-3 py-2 text-sm">
          <p className="min-w-0 truncate text-fg-2">{replyTo.authorName}: {replyTo.body}</p>
          <button type="button" className="shrink-0 text-fg-3 hover:text-fg" aria-label="Убрать цитату" onClick={onClearReply}>×</button>
        </div>
      ) : null}
      {draft.attachment ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-ctl border border-border bg-surface-2 px-3 py-2 text-sm">
          <span className="text-fg-2">{draft.attachment.kind === "document" ? "Документ дела" : "Задача дела"} прикреплён к сообщению</span>
          <button type="button" className="shrink-0 text-fg-3 hover:text-fg" aria-label="Убрать вложение" onClick={() => persist({ ...draft, attachment: null })}>×</button>
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <label className="sr-only" htmlFor={`${key}-body`}>Сообщение в переписке</label>
        <textarea
          id={`${key}-body`} ref={textarea} value={draft.body} rows={1} maxLength={CASE_CHAT_BODY_LIMIT + 200}
          readOnly={pending || uncertain} disabled={pending}
          placeholder="Напишите студенту…" aria-invalid={tooLong || undefined}
          className="min-h-11 flex-1 resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2 text-sm text-fg"
          onChange={(event) => persist({ ...draft, body: event.target.value })}
        />
        <button type="submit" disabled={!canSend} className="inline-flex min-h-11 items-center justify-center rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-55">
          {pending ? "Отправляем…" : uncertain ? "Повторить" : "Отправить"}
        </button>
      </div>
      {tooLong ? <p role="alert" className="mt-1 text-sm text-danger">Сократите сообщение до {CASE_CHAT_BODY_LIMIT} символов.</p> : null}
      {state.status !== "idle" && state.status !== "saved" ? <p role="alert" className="mt-1 text-sm text-danger">{CASE_CHAT_FAILURE_COPY[state.status]}</p> : null}
      {storageError ? <p className="mt-1 text-sm text-fg-3">Браузер не сохраняет черновик в этой вкладке.</p> : null}
    </form>
  );
}

function ThreadHeader({
  row, caseId, listHref, onSetAwait, awaitPending,
}: Readonly<{
  row: Pick<CaseChatThreadRow, "studentDisplayName" | "awaitState"> | null; caseId: string;
  listHref: string;
  onSetAwait: (state: CaseChatAwaitState) => void; awaitPending: boolean;
}>) {
  const state = row?.awaitState ?? "none";
  return (
    <div className="flex items-center gap-3 border-b border-border p-3">
      <Link href={listHref} className="inline-flex min-h-11 items-center text-sm text-fg-2 underline decoration-transparent hover:decoration-inherit @2xl:hidden" scroll={false}>
        ← К списку
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-fg">{row?.studentDisplayName ?? "Переписка"}</p>
      </div>
      {state !== "none" ? <Pill tone={awaitTone(state)}>{caseChatAwaitState(state)}</Pill> : null}
      <Link href={`/v3/profile?case=${caseId}&tab=route`} className="hidden min-h-11 items-center text-sm text-fg-2 underline decoration-transparent hover:decoration-inherit @2xl:inline-flex">
        Открыть дело
      </Link>
      <details className="relative">
        <summary aria-label="Ещё" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">⋯</summary>
        <div className="absolute end-0 z-20 mt-1 w-56 rounded-ctl border border-border bg-surface p-1 shadow-evo-lg">
          {CASE_CHAT_AWAIT_STATES.filter((value) => value !== state).map((value) => (
            <button key={value} type="button" disabled={awaitPending} onClick={() => onSetAwait(value)}
              className="block w-full rounded-nav px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-2 disabled:opacity-55">
              {value === "none" ? "Ответ не требуется" : caseChatAwaitState(value)}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

function AttachmentCard({ message, caseId }: Readonly<{ message: CaseChatMessage; caseId: string }>) {
  if (!message.attachmentKind || !message.attachmentId) return null;
  const href = message.attachmentKind === "document"
    ? `/v3/profile?case=${caseId}&tab=documents`
    : `/v3/tasks?task=${message.attachmentId}&kind=case&case=${caseId}`;
  return (
    <Link href={href} className="mt-1.5 flex min-h-11 items-center gap-2 rounded-ctl border border-border bg-surface px-3 py-2 text-sm text-fg underline decoration-transparent hover:decoration-inherit">
      <Icon name={message.attachmentKind === "document" ? "folder" : "check-square"} size={16} />
      <span className="truncate">{message.attachmentLabel ?? (message.attachmentKind === "document" ? "Документ дела" : "Задача дела")}</span>
    </Link>
  );
}

function MessageRow({
  message, own, caseId, onReply,
}: Readonly<{ message: CaseChatMessage; own: boolean; caseId: string; onReply: (message: CaseChatMessage) => void }>) {
  return (
    <div className={`flex flex-col gap-0.5 py-2 ${own ? "items-end" : "items-start"}`} id={`case-message-${message.id}`}>
      <div className={`max-w-[85%] min-w-0 rounded-ctl px-3 py-2 ${own ? "bg-accent/10" : "bg-surface-2"}`}>
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-fg-3">
          <span className="font-medium text-fg-2">{own ? "Вы" : message.authorName}</span>
          <time dateTime={message.createdAt}>{TIME.format(new Date(message.createdAt))}</time>
        </p>
        {message.quotedPreview ? (
          <p className="mt-1 truncate border-s-2 border-border ps-2 text-xs text-fg-3">
            {message.quotedPreview.authorName}: {message.quotedPreview.bodyPreview}
          </p>
        ) : null}
        {message.body ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{message.body}</p> : null}
        <AttachmentCard message={message} caseId={caseId} />
      </div>
      <details className="relative">
        <summary aria-label="Действия с сообщением" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-nav text-xs text-fg-3 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">⋯</summary>
        <div className="absolute end-0 z-20 mt-1 w-52 rounded-ctl border border-border bg-surface p-1 shadow-evo-lg">
          <button type="button" className="block w-full rounded-nav px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-2" onClick={() => onReply(message)}>
            Ответить с цитатой
          </button>
        </div>
      </details>
    </div>
  );
}

function CaseChatThreadView({
  caseId, initialPage, initialFailure, storageScope, membershipId, pendingAttachment, onAttachmentConsumed,
  organizationId, realtimeConfig, studentDisplayName, listHref, onListChanged,
}: Readonly<{
  caseId: string; initialPage: CaseChatPage | null; initialFailure: CaseChatFailure | null;
  storageScope: string; membershipId: string; pendingAttachment: CaseChatPendingAttachment | null;
  onAttachmentConsumed: () => void; organizationId: string; realtimeConfig: SupabasePublicConfig;
  studentDisplayName: string | null; listHref: string; onListChanged: () => void;
}>) {
  const [page, setPage] = useState<CaseChatPage | null>(initialPage);
  const [error, setError] = useState<CaseChatFailure | null>(initialFailure);
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<CaseChatMessage | null>(null);
  const [awaitPending, setAwaitPending] = useState(false);
  const [awaitState, setAwaitState] = useState<CaseChatAwaitState | null>(initialPage?.thread.awaitState ?? null);
  const viewport = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const pageSequence = useRef(0);
  const markedUpTo = useRef<string>(initialPage?.readSequenceId ?? "0");

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    const sequence = ++pageSequence.current;
    onListChanged();
    try {
      const result = await readCaseChatPageAction(caseId, "latest");
      if (!alive.current || sequence !== pageSequence.current) return;
      if (result.status !== "ready") { setError(result.status); return; }
      setError(null);
      setPage(result.page);
      setAwaitState(result.page.thread.awaitState);
    } catch {
      if (alive.current && sequence === pageSequence.current) setError("unavailable");
    }
  }, [caseId, onListChanged]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let client: SupabaseClient | undefined;
    let subscription: RealtimeChannel | undefined;
    const requestRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (!cancelled) startTransition(() => { void refresh(); }); }, 150);
    };
    async function connect() {
      try {
        client = createBrowserClient(realtimeConfig.url, realtimeConfig.publishableKey);
        const { data, error: authError } = await client.auth.getSession();
        if (cancelled || authError || !data.session) return;
        await client.realtime.setAuth(data.session.access_token);
        if (cancelled) return;
        subscription = client.channel(`case-chat:${organizationId}:${caseId}`, { config: { private: true } })
          .on("broadcast", { event: "invalidate" }, requestRefresh)
          .subscribe();
      } catch { /* the composer/manual refresh remain available without realtime */ }
    }
    void connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (subscription && client) void client.removeChannel(subscription);
    };
  }, [caseId, organizationId, realtimeConfig.url, realtimeConfig.publishableKey, refresh]);

  // Scroll: pinned to bottom on load; position preserved across refresh via
  // a saved scrollTop, restored once per case mount.
  useEffect(() => {
    const key = scrollStorageKey(storageScope, caseId);
    let restored = false;
    try {
      const saved = localStorage.getItem(key);
      if (saved) { const value = Number(saved); if (Number.isFinite(value) && viewport.current) { viewport.current.scrollTop = value; restored = true; } }
    } catch { /* ignore */ }
    if (!restored && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    const node = viewport.current;
    const onScroll = () => { try { if (node) localStorage.setItem(key, String(node.scrollTop)); } catch { /* ignore */ } };
    node?.addEventListener("scroll", onScroll);
    return () => node?.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // Mark-read: fires while the thread is open and new messages render.
  // Reading alone never clears «Нужен ответ» — the RPC only bumps the
  // caller's own cursor.
  useEffect(() => {
    if (!page || !page.messages.length) return;
    const latest = page.messages[0]?.sequenceId ?? "0";
    if (BigInt(latest) <= BigInt(markedUpTo.current)) return;
    markedUpTo.current = latest;
    const form = new FormData();
    form.set("request_id", crypto.randomUUID()); form.set("case_id", caseId); form.set("sequence_id", latest);
    void markCaseChatReadAction(CASE_CHAT_INITIAL_ACTION, form).then((result) => {
      if (alive.current && result.status === "saved") onListChanged();
    }).catch(() => { /* A failed read acknowledgement must not clear work state. */ });
  }, [page, caseId, onListChanged]);

  async function loadOlder() {
    if (!page || !page.hasMore || busy) return;
    setBusy(true);
    const node = viewport.current;
    const position = node?.scrollTop ?? 0;
    const height = node?.scrollHeight ?? 0;
    try {
      const result = await readCaseChatPageAction(caseId, "before", page.cursor);
      if (result.status !== "ready") { setError(result.status); return; }
      setPage((previous) => previous ? {
        ...result.page, messages: [...result.page.messages, ...previous.messages],
      } : result.page);
      requestAnimationFrame(() => { if (node) node.scrollTop = position + node.scrollHeight - height; });
    } finally { setBusy(false); }
  }

  async function changeAwait(state: CaseChatAwaitState) {
    ++pageSequence.current;
    setAwaitPending(true);
    try {
      const form = new FormData();
      form.set("request_id", crypto.randomUUID()); form.set("case_id", caseId); form.set("state", state);
      const result = await setCaseChatAwaitAction(CASE_CHAT_INITIAL_ACTION, form);
      if (!alive.current) return;
      if (result.status === "saved") {
        ++pageSequence.current;
        setAwaitState(state);
        setError(null);
        onListChanged();
      }
      else if (result.status !== "idle") setError(result.status);
    } catch { if (alive.current) setError("unavailable"); }
    finally { if (alive.current) setAwaitPending(false); }
  }

  if (!page) {
    return <div className="flex flex-1 flex-col">
      <ThreadHeader row={studentDisplayName === null ? null : { studentDisplayName, awaitState: "none" }} caseId={caseId} listHref={listHref} onSetAwait={() => {}} awaitPending={false} />
      <p role="alert" className="p-4 text-sm text-danger">{CASE_CHAT_FAILURE_COPY[error ?? "unavailable"]}</p>
    </div>;
  }

  const messages = [...page.messages].reverse();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader
        listHref={listHref}
        row={studentDisplayName === null ? null : { studentDisplayName, awaitState: awaitState ?? page.thread.awaitState }}
        caseId={caseId} onSetAwait={changeAwait} awaitPending={awaitPending} />
      {error ? <p role="alert" className="px-3 pt-2 text-sm text-danger">{CASE_CHAT_FAILURE_COPY[error]}</p> : null}
      <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto px-3" aria-label="История переписки">
        {page.hasMore ? <button type="button" disabled={busy} onClick={() => void loadOlder()} className="my-2 inline-flex min-h-11 items-center rounded-ctl border border-border px-3 text-sm text-fg-2 hover:bg-surface-2">
          Показать более ранние
        </button> : null}
        {messages.length ? messages.map((message) => (
          <MessageRow key={message.id} message={message} own={message.authorMembershipId === membershipId} caseId={caseId}
            onReply={(target) => setReplyTo(target)} />
        )) : <p className="py-10 text-center text-sm text-fg-3">Сообщений пока нет. Куратор может начать разговор.</p>}
      </div>
      <CaseChatComposer caseId={caseId} storageScope={storageScope} pendingAttachment={pendingAttachment}
        onAttachmentConsumed={onAttachmentConsumed} replyTo={replyTo} onClearReply={() => setReplyTo(null)}
        onSaved={() => startTransition(() => { void refresh(); })} />
    </div>
  );
}

function threadRowBadges(row: CaseChatThreadRow) {
  const badges: { tone: PillTone; text: string }[] = [];
  if (row.awaitState === "needs_reply") badges.push({ tone: "danger", text: caseChatAwaitState("needs_reply") ?? "Нужен ответ" });
  else if (row.awaitState === "awaiting_student") badges.push({ tone: "warn", text: caseChatAwaitState("awaiting_student") ?? "Ждём студента" });
  if (row.unread) badges.push({ tone: "info", text: "Непрочитанное" });
  return badges;
}

function CaseChatList({
  threads, selectedCaseId, query, onQuery, queue, onQueue, membershipId, hidden, loading, failure, onRetry,
}: Readonly<{
  threads: CaseChatThreadsList; selectedCaseId: string | null; query: string; onQuery: (value: string) => void;
  queue: CaseChatQueue; onQueue: (value: CaseChatQueue) => void;
  membershipId: string; hidden: boolean; loading: boolean; failure: CaseChatFailure | null; onRetry: () => void;
}>) {
  const router = useRouter();
  return (
    <nav aria-label="Переписки" className={`${hidden ? "hidden @2xl:flex" : "flex"} w-full flex-col border-e border-border @2xl:w-[320px] @2xl:shrink-0`}>
      <div className="border-b border-border p-3">
        <h1 className="mb-2 text-lg font-semibold text-fg">Сообщения</h1>
        <div role="group" aria-label="Очередь переписок" className="mb-2 flex flex-wrap gap-1">
          {CASE_CHAT_QUEUES.map((value) => <button key={value} type="button" aria-pressed={queue === value}
            onClick={() => onQueue(value)}
            className={`min-h-11 rounded-ctl px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${queue === value ? "bg-accent-weak font-semibold text-accent-text" : "text-fg-2 hover:bg-surface-2"}`}>
            {value === "all" ? "Все" : caseChatAwaitState(value)}
          </button>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); }} role="search">
          <label className="sr-only" htmlFor="case-chat-search">Поиск по студенту</label>
          <input id="case-chat-search" type="search" value={query} placeholder="Поиск по студенту"
            onChange={(event) => onQuery(event.target.value)}
            className="min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 text-sm text-fg" />
        </form>
      </div>
      {loading ? <p role="status" className="p-4 text-sm text-fg-3">Ищем переписки…</p> : null}
      {failure ? <div className="p-4">
        <p role="alert" className="text-sm text-danger">{failure === "forbidden"
          ? "Доступ к перепискам изменился. Обновите страницу."
          : "Не удалось загрузить переписки. Повторите поиск."}</p>
        <button type="button" onClick={onRetry} className="mt-2 inline-flex min-h-11 items-center rounded-ctl border border-border px-3 text-sm text-fg hover:bg-surface-2">
          Повторить поиск
        </button>
      </div> : null}
      <div className="flex-1 overflow-y-auto" aria-busy={loading}>
        {!loading && !failure && (threads.rows.length === 0 ? <div className="p-4">
          <p role="status" className="text-sm text-fg-3">{query.trim()
            ? queue === "all" ? "По вашему запросу переписок не найдено." : "В этой очереди нет переписок по вашему запросу."
            : queue === "all" ? "Переписок пока нет." : "В этой очереди переписок нет."}</p>
          {query.trim() ? <button type="button" onClick={() => onQuery("")} className="mt-2 inline-flex min-h-11 items-center rounded-ctl border border-border px-3 text-sm text-fg hover:bg-surface-2">
            Сбросить поиск
          </button> : null}
        </div> : threads.rows.map((row) => {
          const badges = threadRowBadges(row);
          return (
            <button key={row.studentCaseId} type="button"
              onClick={() => router.push(caseChatHref(query, queue, row.studentCaseId))}
              aria-current={row.studentCaseId === selectedCaseId ? "page" : undefined}
              className={`flex w-full flex-col gap-0.5 border-b border-border px-3 py-3 text-start hover:bg-surface-2 ${row.studentCaseId === selectedCaseId ? "bg-surface-2" : ""}`}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-fg">{row.studentDisplayName}</span>
                {row.lastMessageAt ? <time className="shrink-0 text-xs text-fg-3" dateTime={row.lastMessageAt}>{ROW_TIME.format(new Date(row.lastMessageAt))}</time> : null}
              </span>
              {row.lastMessageSnippet ? <span className="truncate text-sm text-fg-2">
                {row.lastMessageAuthorMembershipId === membershipId ? "Вы: " : ""}{row.lastMessageSnippet}
              </span> : <span className="text-sm text-fg-3">Нет сообщений</span>}
              {badges.length ? <span className="mt-0.5 flex flex-wrap gap-1">{badges.map((badge) => <Pill key={badge.text} tone={badge.tone}>{badge.text}</Pill>)}</span> : null}
            </button>
          );
        }))}
        {!loading && !failure && threads.truncated ? <p className="p-3 text-xs text-fg-3">Показаны первые {threads.rows.length}. Уточните поиск.</p> : null}
      </div>
    </nav>
  );
}

export function CaseChatWorkspace({
  organizationId, membershipId, realtimeConfig, initialThreads, initialQuery, initialQueue, initialStudentDisplayName, selectedCaseId, initialPage,
  initialPageFailure, pendingAttachment,
}: Readonly<{
  organizationId: string; membershipId: string; realtimeConfig: SupabasePublicConfig;
  initialThreads: CaseChatThreadsList; initialQuery: string; selectedCaseId: string | null;
  initialQueue: CaseChatQueue; initialStudentDisplayName: string | null;
  initialPage: CaseChatPage | null; initialPageFailure: CaseChatFailure | null;
  pendingAttachment: CaseChatPendingAttachment | null;
}>) {
  const [threads, setThreads] = useState(initialThreads);
  const [query, setQuery] = useState(initialQuery);
  const [queue, setQueue] = useState(initialQueue);
  const scope = useRef({ query: initialQuery, queue: initialQueue });
  const [attachment, setAttachment] = useState(pendingAttachment);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<CaseChatFailure | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchSequence = useRef(0);

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    searchSequence.current += 1;
  }, []);

  const search = useCallback(async (value: string, selectedQueue: CaseChatQueue, sequence: number) => {
    try {
      const result = await loadStaffCaseChatThreadsAction(value, selectedQueue);
      if (sequence !== searchSequence.current) return;
      if (result.status === "ready") setThreads(result.list);
      else setFailure(result.status);
    } catch {
      if (sequence !== searchSequence.current) return;
      setFailure("unavailable");
    } finally {
      if (sequence === searchSequence.current) setLoading(false);
    }
  }, []);

  const refreshList = useCallback(() => {
    clearTimeout(debounceRef.current);
    const sequence = ++searchSequence.current;
    setFailure(null);
    setLoading(true);
    void search(scope.current.query, scope.current.queue, sequence);
  }, [search]);

  useEffect(() => {
    window.history.replaceState(null, "", caseChatHref(query, queue, selectedCaseId, attachment));
  }, [query, queue, selectedCaseId, attachment]);

  function onQuery(value: string) {
    setQuery(value);
    scope.current.query = value;
    clearTimeout(debounceRef.current);
    // Invalidate immediately: an old response may arrive during the debounce.
    const sequence = ++searchSequence.current;
    setFailure(null);
    setLoading(true);
    debounceRef.current = setTimeout(() => { void search(value, scope.current.queue, sequence); }, 250);
  }

  function onQueue(value: CaseChatQueue) {
    if (value === scope.current.queue) return;
    setQueue(value);
    scope.current.queue = value;
    refreshList();
  }

  const row = threads.rows.find((item) => item.studentCaseId === selectedCaseId);

  return (
    <div className="flex min-h-0 flex-1 rounded-card border border-border bg-surface">
      <CaseChatList threads={threads} selectedCaseId={selectedCaseId} query={query} onQuery={onQuery}
        queue={queue} onQueue={onQueue}
        membershipId={membershipId} hidden={selectedCaseId !== null} loading={loading} failure={failure} onRetry={refreshList} />
      {selectedCaseId ? (
        <CaseChatThreadView caseId={selectedCaseId} initialPage={initialPage} initialFailure={initialPageFailure}
          storageScope={`${organizationId}:${membershipId}`} membershipId={membershipId} pendingAttachment={attachment}
          onAttachmentConsumed={() => setAttachment(null)} organizationId={organizationId} realtimeConfig={realtimeConfig}
          studentDisplayName={row?.studentDisplayName ?? initialStudentDisplayName} onListChanged={refreshList}
          listHref={caseChatHref(query, queue)} />
      ) : (
        <div className="hidden flex-1 items-center justify-center p-6 text-center text-sm text-fg-3 @2xl:flex">
          {!loading && !failure && threads.rows.length > 0 ? "Выберите переписку слева." : null}
        </div>
      )}
    </div>
  );
}
