"use client";

import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { readTeamChatAction, teamChatCommandAction } from "@/lib/platform-team-chat-actions";
import {
  TEAM_CHAT_FAILURE_COPY, TEAM_CHAT_INITIAL_ACTION, TEAM_CHAT_LABELS, teamChatMergeMessages,
  type TeamChatChannelKey, type TeamChatFailure, type TeamChatMessage, type TeamChatPage,
  type TeamChatQuery, type TeamChatSnapshot,
} from "@/lib/platform-team-chat";
import type { SupabasePublicConfig } from "@/lib/supabase/config";
import { TeamChatComposer } from "./TeamChatComposer";
import { TeamChatMessageRow } from "./TeamChatMessageRow";
import styles from "./team-chat.module.css";

export function TeamChat({ initial, channel, organizationId, membershipId, canModerate, realtimeConfig, initialMessageId = null, showChannelsInitially = false, renderMessageAction }: {
  initial: TeamChatSnapshot; channel: TeamChatChannelKey; organizationId: string;
  realtimeConfig: SupabasePublicConfig;
  membershipId: string; canModerate: boolean; initialMessageId?: string | null;
  showChannelsInitially?: boolean; renderMessageAction?: (message: TeamChatMessage) => ReactNode;
}) {
  const [messages, setMessages] = useState<readonly TeamChatMessage[]>(initial.page.messages.filter((message) => message.parentMessageId === null));
  const [channels, setChannels] = useState(initial.channels);
  const [participants, setParticipants] = useState(initial.participants);
  const [page, setPage] = useState(initial.page);
  const [thread, setThread] = useState<{ root: TeamChatMessage; page: TeamChatPage } | null>(null);
  const [panel, setPanel] = useState<"channels" | "messages" | "thread">(showChannelsInitially ? "channels" : "messages");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ term: string; page: TeamChatPage } | null>(null);
  const [error, setError] = useState<TeamChatFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [transport, setTransport] = useState<"connecting" | "live" | "error">("connecting");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [newMessages, setNewMessages] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(initialMessageId);
  const watermark = useRef(initial.page.watermark);
  const catchupRunning = useRef(false);
  const catchupAgain = useRef(false);
  const alive = useRef(true);
  const revoked = useRef(false);
  const threadRoot = useRef<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const closeThreadButton = useRef<HTMLButtonElement>(null);
  const threadReturnFocus = useRef<HTMLElement | null>(null);
  const contextRequest = useRef(0);
  const storageScope = `${organizationId}:${membershipId}`;
  const forbidden = error === "forbidden";
  const needsHistoryRecovery = !forbidden && (transport === "error" || error !== null);
  const transportLabel = forbidden ? "Доступ к каналу закрыт"
    : transport === "live" ? error ? "Соединение установлено" : "Сообщения появляются автоматически"
    : transport === "connecting" ? "Подключаем обновления…" : "Живые обновления недоступны";

  const accept = useCallback((snapshot: TeamChatSnapshot) => {
    setChannels(snapshot.channels);
    setParticipants(snapshot.participants);
    setError(null);
  }, []);
  const reportFailure = useCallback((status: TeamChatFailure) => {
    setError(status);
    if (status === "forbidden") {
      revoked.current = true;
      setMessages([]); setChannels([]); setParticipants([]); setThread(null); setSearch(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!alive.current || revoked.current) return;
    if (catchupRunning.current) { catchupAgain.current = true; return; }
    catchupRunning.current = true;
    try {
      do {
        catchupAgain.current = false;
        const result = await readTeamChatAction({ channel, mode: "changes", cursor: watermark.current });
        if (!alive.current || revoked.current) return;
        if (result.status !== "ready") { reportFailure(result.status); return; }
        const snapshot = result.snapshot;
        accept(snapshot);
        const roots = snapshot.page.messages.filter((message) => message.parentMessageId === null);
        setMessages((previous) => teamChatMergeMessages(previous, roots));
        setPage((previous) => ({ ...previous, latestMessageId: snapshot.page.latestMessageId }));
        setThread((previous) => previous ? {
          root: roots.find((message) => message.id === previous.root.id) ?? previous.root,
          page: { ...previous.page, messages: teamChatMergeMessages(previous.page.messages,
            snapshot.page.messages.filter((message) => message.parentMessageId === previous.root.id)) },
        } : null);
        setSearch((previous) => previous ? { ...previous, page: { ...previous.page,
          messages: previous.page.messages.map((message) => snapshot.page.messages.find((updated) => updated.id === message.id) ?? message)
            .filter((message) => message.deletedAt === null),
        } } : null);
        if (snapshot.page.messages.length) setNewMessages(true);
        watermark.current = snapshot.page.cursor;
        if (snapshot.page.hasMore) catchupAgain.current = true;
      } while (catchupAgain.current && alive.current && !revoked.current);
    } catch { if (alive.current) reportFailure("unavailable"); }
    finally { catchupRunning.current = false; }
  }, [accept, channel, reportFailure]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; contextRequest.current += 1; };
  }, []);

  useEffect(() => {
    if (forbidden) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let client: SupabaseClient | undefined;
    let subscription: RealtimeChannel | undefined;
    const requestRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (!cancelled) startTransition(() => { void refresh(); }); }, 120);
    };
    const reconnect = () => {
      if (document.visibilityState === "visible") requestRefresh();
    };
    async function connect() {
      try {
        setTransport("connecting");
        client = createBrowserClient(realtimeConfig.url, realtimeConfig.publishableKey);
        const { data, error: authError } = await client.auth.getSession();
        if (cancelled) return;
        if (authError || !data.session) { reportFailure("forbidden"); return; }
        await client.realtime.setAuth(data.session.access_token);
        if (cancelled) return;
        subscription = client.channel(`team-chat:${organizationId}:${channel}`, { config: { private: true } })
          .on("broadcast", { event: "invalidate" }, requestRefresh)
          .subscribe((status) => {
            if (cancelled) return;
            if (status === "SUBSCRIBED") { setTransport("live"); requestRefresh(); }
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setTransport("error");
          });
      } catch { if (!cancelled) setTransport("error"); }
    }
    void connect();
    // Recheck current DB authority even on an idle, already-connected channel.
    // This is also required when there is no message event after a revocation.
    const authorityCheck = setInterval(reconnect, 30000);
    document.addEventListener("visibilitychange", reconnect);
    window.addEventListener("online", requestRefresh);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(authorityCheck);
      document.removeEventListener("visibilitychange", reconnect);
      window.removeEventListener("online", requestRefresh);
      if (subscription && client) void client.removeChannel(subscription);
    };
  }, [channel, organizationId, connectionAttempt, refresh, reportFailure, forbidden, realtimeConfig.url, realtimeConfig.publishableKey]);

  async function load(queryInput: TeamChatQuery, apply: (snapshot: TeamChatSnapshot) => void) {
    const request = ++contextRequest.current;
    setBusy(true);
    try {
      const result = await readTeamChatAction(queryInput);
      if (!alive.current || revoked.current || request !== contextRequest.current) return;
      if (result.status !== "ready") { reportFailure(result.status); return; }
      accept(result.snapshot);
      apply(result.snapshot);
    } catch { if (alive.current && request === contextRequest.current) reportFailure("unavailable"); }
    finally { if (alive.current && request === contextRequest.current) setBusy(false); }
  }

  async function openThread(message: TeamChatMessage) {
    threadReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const rootId = message.parentMessageId ?? message.id;
    await load({ channel, mode: "message", messageId: rootId }, (rootSnapshot) => {
      const root = rootSnapshot.page.messages[0];
      if (!root) return;
      threadRoot.current = root.id;
      setThread({ root, page: { messages: [], cursor: "0", watermark: "0", hasMore: false, latestMessageId: null, rootId: root.id } });
      setPanel("thread");
    });
    if (threadRoot.current !== rootId) return;
    await load({ channel, mode: "thread", messageId: rootId,
      ...(message.parentMessageId ? { cursor: (BigInt(message.sequence) + BigInt(1)).toString() } : {}),
    }, (snapshot) => {
      setThread((previous) => previous?.root.id === rootId ? { ...previous, page: snapshot.page } : previous);
    });
    if (message.parentMessageId) {
      setHighlighted(message.id);
      requestAnimationFrame(() => document.getElementById(`team-message-thread-${message.id}`)?.focus());
    } else closeThreadButton.current?.focus();
  }

  function closeThread() {
    contextRequest.current += 1;
    threadRoot.current = null;
    setThread(null); setPanel("messages"); setBusy(false);
    threadReturnFocus.current?.focus();
  }

  function openMessage(id: string) {
    startTransition(() => {
      void load({ channel, mode: "message", messageId: id }, (snapshot) => {
        setMessages((previous) => teamChatMergeMessages(previous, snapshot.page.messages.filter((message) => message.parentMessageId === null)));
        setSearch(null); setPanel("messages"); setHighlighted(id);
        const root = snapshot.page.messages[0];
        if (root && id !== root.id) void openThread(snapshot.page.messages.find((message) => message.id === id) ?? root);
        else requestAnimationFrame(() => document.getElementById(`team-message-channel-${id}`)?.focus());
      });
    });
  }

  useEffect(() => {
    if (initialMessageId && initial.page.messages[0]?.id !== initialMessageId) {
      const target = initial.page.messages.find((message) => message.id === initialMessageId);
      if (target) startTransition(() => { void openThread(target); });
    } else if (initialMessageId) document.getElementById(`team-message-channel-${initialMessageId}`)?.focus();
    else if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    // Initial deep link is evaluated once. Subsequent selections are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function preference(input: Record<string, unknown>) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("request_id", crypto.randomUUID()); form.set("channel", channel); form.set("input", JSON.stringify(input));
      const result = await teamChatCommandAction(TEAM_CHAT_INITIAL_ACTION, form);
      if (result.status !== "saved") { if (result.status !== "idle") reportFailure(result.status); return; }
      await refresh();
    } catch { reportFailure("unavailable"); }
    finally { setBusy(false); }
  }
  const currentChannel = channels.find((item) => item.key === channel);
  const visibleMessages = search?.page.messages ?? messages;
  const afterSave = () => startTransition(() => { void refresh(); });
  const renderRow = (message: TeamChatMessage, location: "channel" | "thread" = "channel") => <TeamChatMessageRow key={message.id} message={message} location={location}
    ownMembershipId={membershipId} canModerate={canModerate} participants={participants}
    storageScope={storageScope} onReply={(row) => startTransition(() => { void openThread(row); })}
    onSaved={afterSave} renderMessageAction={renderMessageAction} highlighted={highlighted === message.id} />;

  return (
    <div className={styles.workspace} data-panel={panel} aria-busy={busy}>
      <nav className={styles.channels} aria-label="Каналы команды">
        <p className={styles.eyebrow}>Каналы</p>
        {channels.map((item) => <Link key={item.key} href={`/v3/team-chat?channel=${item.key}`}
          className={`${styles.channel} ${item.key === channel ? styles.selected : ""}`} aria-current={item.key === channel ? "page" : undefined}
          onClick={() => { if (item.key === channel) setPanel("messages"); }}>
          <span># {TEAM_CHAT_LABELS[item.key]}{item.muted ? <span className={styles.muted}> · тихо</span> : null}</span>
          {item.unreadCount ? <span className={styles.unread} aria-label={`${item.unreadCount} непрочитанных`}>{item.unreadCount}</span> : null}
        </Link>)}
        <p className={styles.channelHint}>Внутренняя переписка сотрудников EVO</p>
      </nav>
      <section className={styles.conversation} aria-label={`Канал ${TEAM_CHAT_LABELS[channel]}`}>
        <div className={styles.conversationHeader}>
          <button type="button" className={`${styles.secondary} ${styles.mobileBack}`} onClick={() => setPanel("channels")}>← Каналы</button>
          <h2># {TEAM_CHAT_LABELS[channel]}</h2>
          {currentChannel ? <button type="button" className={styles.textButton} disabled={busy} onClick={() => startTransition(() => {
            void preference({ operation: "mute", muted: !currentChannel.muted, expectedVersion: currentChannel.preferenceVersion });
          })}>{currentChannel.muted ? "Включить уведомления" : "Приглушить"}</button> : null}
        </div>
        <div className={styles.transport} role="status">
          {transportLabel}
          {needsHistoryRecovery ? <button type="button" className={styles.textButton} disabled={busy} onClick={() => startTransition(() => { void refresh(); })}>Обновить историю</button> : null}
          {transport === "error" && !forbidden ? <button type="button" className={styles.textButton} onClick={() => setConnectionAttempt((value) => value + 1)}>Подключить снова</button> : null}
        </div>
        {error ? <div role="alert" className={styles.error}>{TEAM_CHAT_FAILURE_COPY[error]}</div> : null}
        {error === "forbidden" ? <a className={styles.secondary} href="/login">Войти снова</a> : <>
          <form className={styles.search} onSubmit={(event) => {
            event.preventDefault();
            startTransition(() => { void load({ channel, mode: "search", query: query.trim() }, (snapshot) => setSearch({ term: query.trim(), page: snapshot.page })); });
          }}>
            <label className={styles.srOnly} htmlFor="team-chat-search">Поиск в канале</label>
            <input id="team-chat-search" type="search" placeholder="Поиск в этом канале" minLength={2} maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} />
            <button className={styles.secondary} disabled={busy || query.trim().length < 2}>Найти</button>
            {search ? <button type="button" className={styles.textButton} onClick={() => { setSearch(null); setQuery(""); }}>Закрыть поиск</button> : null}
          </form>
          <div className={styles.history} ref={viewport} tabIndex={0} aria-label={search ? "Результаты поиска" : "История сообщений"}>
            {search ? <p className={styles.muted}>Результаты: «{search.term}». Новые изменения появятся после повторного поиска.</p> : null}
            {(search ? search.page.hasMore : page.hasMore) ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => startTransition(() => {
              const position = viewport.current?.scrollTop ?? 0;
              const height = viewport.current?.scrollHeight ?? 0;
              void load(search ? { channel, mode: "search", query: search.term, cursor: search.page.cursor } : { channel, mode: "before", cursor: page.cursor }, (snapshot) => {
                if (search) setSearch({ term: search.term, page: { ...snapshot.page, messages: teamChatMergeMessages(search.page.messages, snapshot.page.messages) } });
                else { setMessages((previous) => teamChatMergeMessages(previous, snapshot.page.messages)); setPage(snapshot.page); }
                requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollTop = position + viewport.current.scrollHeight - height; });
              });
            })}>Показать более ранние</button> : null}
            {visibleMessages.length ? visibleMessages.map((message) => renderRow(message)) : <div className={styles.empty}>{search ? "Ничего не найдено в этом канале." : "Пока нет сообщений. Начните обсуждение с коллегами."}</div>}
          </div>
          <div className={styles.readActions}>
            {currentChannel?.firstUnreadId ? <button type="button" className={styles.textButton} onClick={() => openMessage(currentChannel.firstUnreadId!)}>К первому непрочитанному · {currentChannel.unreadCount}</button> : null}
            {page.latestMessageId && currentChannel?.unreadCount ? <button type="button" className={styles.textButton} disabled={busy} onClick={() => startTransition(() => { void preference({ operation: "read", messageId: page.latestMessageId }); })}>Отметить канал прочитанным</button> : null}
            {newMessages || initialMessageId ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => startTransition(() => {
              void load({ channel, mode: "latest" }, (snapshot) => {
                setMessages(snapshot.page.messages); setPage(snapshot.page); setSearch(null); setNewMessages(false);
                requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; });
              });
            })}>{newMessages ? "Новые сообщения ↓" : "К последним сообщениям ↓"}</button> : null}
          </div>
          <TeamChatComposer key={channel} channel={channel} participants={participants} storageScope={storageScope} onSaved={afterSave} />
        </>}
      </section>
      {thread && error !== "forbidden" ? <aside className={styles.thread} aria-label="Обсуждение"
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeThread(); } }}>
        <div className={styles.conversationHeader}><h2>Обсуждение</h2><button ref={closeThreadButton} type="button" className={styles.secondary} onClick={closeThread}>← Назад</button></div>
        <div className={styles.history} tabIndex={0} aria-label="Ответы в обсуждении">
          {renderRow(thread.root, "thread")}
          {thread.page.hasMore ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => startTransition(() => {
            void load({ channel, mode: "thread", messageId: thread.root.id, cursor: thread.page.cursor }, (snapshot) => setThread((previous) => previous ? {
              ...previous, page: { ...snapshot.page, messages: teamChatMergeMessages(previous.page.messages, snapshot.page.messages) },
            } : null));
          })}>Ранние ответы</button> : null}
          <button type="button" className={styles.textButton} disabled={busy} onClick={() => startTransition(() => {
            void load({ channel, mode: "thread", messageId: thread.root.id }, (snapshot) => setThread((previous) => previous ? { ...previous, page: snapshot.page } : null));
          })}>Последние ответы ↓</button>
          {thread.page.messages.map((message) => renderRow(message, "thread"))}
          {!thread.page.messages.length && !busy ? <p className={styles.empty}>Пока нет ответов.</p> : null}
        </div>
        <TeamChatComposer key={`${channel}:${thread.root.id}`} channel={channel} parentId={thread.root.id} participants={participants} storageScope={storageScope} onSaved={afterSave} />
      </aside> : null}
    </div>
  );
}
