"use client";

import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readTeamChatAction } from "@/lib/platform-team-chat-actions";
import { readTeamChatTimelineV2Action } from "@/lib/platform-team-chat-v2-actions";
import { TEAM_CHAT_LABELS, teamChatMergeMessages, type TeamChatChannelKey, type TeamChatFailure, type TeamChatPage } from "@/lib/platform-team-chat";
import { emptyTeamChatReadErrors, reduceTeamChatReadErrors, teamChatReadFailureCopy, visibleTeamChatReadFailure, type TeamChatReadAttempt, type TeamChatReadEvent, type TeamChatReadOwner } from "@/lib/team-chat-read-errors";
import type { TeamChatTimelineQuery } from "@/lib/platform-team-chat-timeline";
import type { TeamChatTimelineV2Page } from "@/lib/platform-team-chat-timeline-v2";
import { emptyTeamChatFeed, extendTeamChatFeedRange, mergeTeamChatFeedChanges, mergeTeamChatFeedPage, mergeTeamChatSearchChanges, teamChatFeedMessage, teamChatFeedQuote, teamChatFeedRange, teamChatFeedRows, type TeamChatFeedSnapshot, type TeamChatFeedStore, type TeamChatFeedRange, type TeamChatScrollAnchor } from "@/lib/team-chat-feed";
import type { SupabasePublicConfig } from "@/lib/supabase/config";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import { Icon } from "@/components/icons";
import { TeamChatComposer, type TeamChatComposerHandle } from "./TeamChatComposer";
import { TeamChatDeleteConfirmation, TeamChatMessageRow, type TeamChatDeletionAttempt } from "./TeamChatMessageRow";
import { useTeamChatSeen } from "./useTeamChatSeen";
import styles from "./team-chat.module.css";

type Feed = { store: TeamChatFeedStore; range: TeamChatFeedRange };
type ReturnPoint = { range: TeamChatFeedRange; view: "feed" | "search"; anchor: TeamChatScrollAnchor | null; focusId: string | null };
type ScrollRequest = { kind: "anchor"; anchor: TeamChatScrollAnchor | null; focusId?: string | null } | { kind: "bottom" | "top" } | { kind: "message"; id: string };

function captureAnchor(root: HTMLElement | null): TeamChatScrollAnchor | null {
  if (!root) return null;
  const top = root.getBoundingClientRect().top;
  for (const row of root.querySelectorAll<HTMLElement>("[data-chat-row]")) {
    if (row.getBoundingClientRect().bottom > top) return { messageId: row.dataset.chatRow!, offset: row.getBoundingClientRect().top - top };
  }
  return null;
}
function restoreAnchor(root: HTMLElement, anchor: TeamChatScrollAnchor | null) {
  if (!anchor) return;
  const row = Array.from(root.querySelectorAll<HTMLElement>("[data-chat-row]")).find((element) => element.dataset.chatRow === anchor.messageId);
  if (row) root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset;
}
const nearBottom = (root: HTMLElement | null) => Boolean(root && root.scrollHeight - root.scrollTop - root.clientHeight < 48);

export function TeamChat({ initial, channel, organizationId, membershipId, canModerate, realtimeConfig, initialMessageId = null, showChannelsInitially = false }: {
  initial: TeamChatFeedSnapshot; channel: TeamChatChannelKey; organizationId: string;
  realtimeConfig: SupabasePublicConfig; membershipId: string; canModerate: boolean;
  initialMessageId?: string | null; showChannelsInitially?: boolean;
}) {
  const [feed, setFeed] = useState<Feed>(() => ({ store: mergeTeamChatFeedPage(emptyTeamChatFeed(), initial.page), range: teamChatFeedRange(initial.page) }));
  const current = useRef(feed);
  const [channels, setChannels] = useState(initial.channels);
  const [participants, setParticipants] = useState(initial.participants);
  const [panel, setPanel] = useState<"channels" | "messages">(showChannelsInitially ? "channels" : "messages");
  const [view, setView] = useState<"feed" | "search">("feed");
  const viewRef = useRef(view);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState<{ term: string; page: TeamChatPage } | null>(null);
  const [returns, setReturns] = useState<ReturnPoint[]>([]);
  const returnsRef = useRef(returns);
  const searchOrigin = useRef<ReturnPoint | null>(null);
  const [readErrors, setReadErrors] = useState(emptyTeamChatReadErrors);
  const readErrorsRef = useRef(readErrors);
  const backgroundRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [transport, setTransport] = useState<"connecting" | "live" | "error">("connecting");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [newMessages, setNewMessages] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(initialMessageId);
  const [deletion, setDeletion] = useState<TeamChatDeletionAttempt | null>(null);
  const [deletionVisible, setDeletionVisible] = useState(false);
  const deletionFocus = useRef<HTMLElement | null>(null);
  const composer = useRef<TeamChatComposerHandle>(null);
  const watermark = useRef(initial.page.watermark);
  const latestId = useRef(initial.page.latestMessageId);
  const [latestMessageId, setLatestMessageId] = useState(initial.page.latestMessageId);
  const catchupRunning = useRef(false);
  const catchupAgain = useRef(false);
  const alive = useRef(true);
  const revoked = useRef(false);
  const contextRequest = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const scroll = useRef<ScrollRequest | null>(initialMessageId ? { kind: "message", id: initialMessageId } : { kind: "bottom" });
  const stableAnchor = useRef<TeamChatScrollAnchor | null>(null);
  const wasAtBottom = useRef(false);
  const forbidden = readErrors.forbidden;
  useLayoutEffect(() => { viewRef.current = view; returnsRef.current = returns; }, [view, returns]);

  const preserveScroll = useCallback(() => {
    if (!scroll.current) scroll.current = { kind: "anchor", anchor: captureAnchor(viewport.current) };
  }, []);
  const commit = useCallback((next: Feed) => {
    if (!alive.current || revoked.current) return;
    preserveScroll(); current.current = next; setFeed(next);
  }, [preserveScroll]);
  const updateReadErrors = useCallback((event: TeamChatReadEvent) => {
    const next = reduceTeamChatReadErrors(readErrorsRef.current, event);
    if (next === readErrorsRef.current) return;
    readErrorsRef.current = next; setReadErrors(next);
  }, []);
  const reportFailure = useCallback((status: TeamChatFailure) => {
    // Revocation is terminal for this actor/channel instance, including late failures.
    if (!alive.current || revoked.current || status !== "forbidden") return;
    updateReadErrors({ type: "forbidden" });
    if (status === "forbidden") {
      revoked.current = true; contextRequest.current += 1;
      const cleared = { store: emptyTeamChatFeed(), range: { ids: [], beforeCursor: "0", afterCursor: "0", hasBefore: false, hasAfter: false } };
      current.current = cleared; setFeed(cleared);
      setChannels([]); setParticipants([]); setSearch(null); setQuery(""); setReturns([]); searchOrigin.current = null; setDeletion(null);
    }
  }, [updateReadErrors]);
  const finishRead = useCallback((owner: TeamChatReadOwner, id: number, failure: TeamChatFailure | null) => {
    if (!alive.current || revoked.current) return;
    updateReadErrors({ type: "settle", owner, id, failure });
    if (failure === "forbidden") reportFailure(failure);
  }, [updateReadErrors, reportFailure]);

  const readPage = useCallback(async (input: TeamChatTimelineQuery, owner: TeamChatReadOwner, id: number): Promise<TeamChatTimelineV2Page | null> => {
    if (!alive.current || revoked.current) return null;
    try {
      const result = await readTeamChatTimelineV2Action(input);
      if (!alive.current || revoked.current) return null;
      if (result.status !== "loaded") { finishRead(owner, id, result.status); return null; }
      return result.page;
    } catch { finishRead(owner, id, "unavailable"); return null; }
  }, [finishRead]);

  const refresh = useCallback(async (retry?: Extract<TeamChatReadAttempt, { kind: "refresh" }>) => {
    if (!alive.current || revoked.current) return;
    if (catchupRunning.current) { catchupAgain.current = true; return; }
    catchupRunning.current = true;
    let request = 0;
    let retryCursor = retry?.cursor;
    try {
      do {
        catchupAgain.current = false;
        const cursor = retryCursor ?? watermark.current; retryCursor = undefined;
        request = ++backgroundRequest.current;
        updateReadErrors({ type: "begin", owner: "background", id: request, attempt: { kind: "refresh", channel, cursor } });
        const result = await readTeamChatAction({ channel, mode: "changes", cursor });
        if (!alive.current || revoked.current) return;
        if (result.status !== "ready") { finishRead("background", request, result.status); return; }
        const snapshot = result.snapshot;
        setChannels(snapshot.channels); setParticipants(snapshot.participants);
        if (snapshot.page.messages.length) {
          const merged = mergeTeamChatFeedChanges(current.current.store, snapshot.page.messages);
          commit({ ...current.current, store: merged.store });
          setSearch((previous) => previous ? { ...previous, page: { ...previous.page, messages: mergeTeamChatSearchChanges(previous.page.messages, snapshot.page.messages) } } : null);
          // A V1 changes response has no direct quote identity. Hydrate unknown rows with V2.
          const latest = await readPage({ channel, mode: "latest" }, "background", request);
          if (!latest) return;
          commit({ ...current.current, store: mergeTeamChatFeedPage(current.current.store, latest) });
          const tailChanged = latest.latestMessageId !== latestId.current;
          latestId.current = latest.latestMessageId; setLatestMessageId(latest.latestMessageId);
          for (const id of merged.unknownIds) {
            if (teamChatFeedMessage(current.current.store, id)) continue;
            const context = await readPage({ channel, mode: "context", messageId: id }, "background", request);
            if (!context) return;
            commit({ ...current.current, store: mergeTeamChatFeedPage(current.current.store, context) });
          }
          if (tailChanged) {
            setNewMessages(true);
            const range = current.current.range;
            const epoch = contextRequest.current;
            if (!range.hasAfter && !returnsRef.current.length && viewRef.current === "feed") {
              const follow = nearBottom(viewport.current);
              const after = range.afterCursor === "0" ? latest : await readPage({ channel, mode: "after", cursor: range.afterCursor }, "background", request);
              if (!after) return;
              if (epoch === contextRequest.current) {
                const nextRange = range.afterCursor === "0" ? teamChatFeedRange(after) : extendTeamChatFeedRange(current.current.range, after, "after", range.afterCursor);
                if (follow) scroll.current = { kind: "bottom" };
                commit({ store: mergeTeamChatFeedPage(current.current.store, after), range: nextRange });
                if (follow && !nextRange.hasAfter) setNewMessages(false);
              }
            }
          }
        }
        watermark.current = snapshot.page.cursor;
        finishRead("background", request, null);
        if (snapshot.page.hasMore) catchupAgain.current = true;
      } while (catchupAgain.current && alive.current && !revoked.current);
    } catch { finishRead("background", request, "unavailable"); }
    finally { catchupRunning.current = false; }
  }, [channel, commit, readPage, finishRead, updateReadErrors]);
  const isRevoked = useCallback(() => revoked.current, []);
  const onSeenForbidden = useCallback(() => reportFailure("forbidden"), [reportFailure]);
  const onSeen = useCallback(() => { void refresh(); }, [refresh]);
  const seen = useTeamChatSeen({ viewport, workspace, channel, isRevoked, revoked: forbidden, enabled: !forbidden && !busy && view === "feed", revision: feed,
    onAcknowledged: onSeen, onForbidden: onSeenForbidden });

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
      timer = setTimeout(() => { if (!cancelled) void refresh(); }, 120);
    };
    const reconnect = () => { if (document.visibilityState === "visible") requestRefresh(); };
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
          .on("broadcast", { event: "invalidate" }, requestRefresh).subscribe((status) => {
            if (cancelled) return;
            if (status === "SUBSCRIBED") { setTransport("live"); requestRefresh(); }
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setTransport("error");
          });
      } catch { if (!cancelled) setTransport("error"); }
    }
    void connect();
    const authorityCheck = setInterval(reconnect, 30000);
    document.addEventListener("visibilitychange", reconnect); window.addEventListener("online", requestRefresh);
    return () => {
      cancelled = true; if (timer) clearTimeout(timer); clearInterval(authorityCheck);
      document.removeEventListener("visibilitychange", reconnect); window.removeEventListener("online", requestRefresh);
      if (subscription && client) void client.removeChannel(subscription);
    };
  }, [channel, organizationId, connectionAttempt, refresh, reportFailure, forbidden, realtimeConfig.url, realtimeConfig.publishableKey]);

  useLayoutEffect(() => {
    const root = viewport.current;
    if (!root || !root.getBoundingClientRect().height) return;
    const requested = scroll.current; scroll.current = null;
    if (requested?.kind === "bottom") root.scrollTop = root.scrollHeight;
    else if (requested?.kind === "top") root.scrollTop = 0;
    else if (requested?.kind === "anchor") {
      restoreAnchor(root, requested.anchor);
      if (requested.focusId) document.getElementById(requested.focusId)?.focus({ preventScroll: true });
    } else if (requested?.kind === "message") {
      const row = document.getElementById(`team-message-channel-${requested.id}`);
      if (row) { root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientHeight / 3; row.focus({ preventScroll: true }); }
    }
    stableAnchor.current = captureAnchor(root); wasAtBottom.current = nearBottom(root);
  }, [feed, view, search, panel]);
  useLayoutEffect(() => {
    const root = viewport.current;
    if (!root) return;
    let width = root.clientWidth, height = root.clientHeight;
    const observer = new ResizeObserver(() => {
      if (root.clientWidth === width && root.clientHeight === height) return;
      width = root.clientWidth; height = root.clientHeight;
      if (wasAtBottom.current && !current.current.range.hasAfter && viewRef.current === "feed") root.scrollTop = root.scrollHeight;
      else restoreAnchor(root, stableAnchor.current);
      stableAnchor.current = captureAnchor(root);
    });
    observer.observe(root); return () => observer.disconnect();
  }, []);

  async function navigate(input: TeamChatTimelineQuery, returnPoint = false) {
    const epoch = ++contextRequest.current;
    const saved: ReturnPoint = { range: current.current.range, view: viewRef.current, anchor: captureAnchor(viewport.current),
      focusId: document.activeElement instanceof HTMLElement ? document.activeElement.id || null : null };
    setBusy(true);
    updateReadErrors({ type: "begin", owner: "foreground", id: epoch, attempt: { kind: "navigate", input, returnPoint } });
    const page = await readPage(input, "foreground", epoch);
    if (!alive.current || revoked.current || epoch !== contextRequest.current) return;
    setBusy(false);
    if (!page) return;
    if (returnPoint) setReturns((previous) => [...previous, saved].slice(-10));
    else setReturns([]);
    setView("feed"); setPanel("messages"); finishRead("foreground", epoch, null);
    setHighlighted(input.mode === "context" ? input.messageId : null);
    scroll.current = input.mode === "context" ? { kind: "message", id: input.messageId } : { kind: "bottom" };
    commit({ store: mergeTeamChatFeedPage(current.current.store, page), range: teamChatFeedRange(page) });
    if (input.mode === "latest") {
      latestId.current = page.latestMessageId; setLatestMessageId(page.latestMessageId); setNewMessages(false);
      searchOrigin.current = null; setSearchOpen(false); setSearch(null);
    }
  }
  async function loadMore(direction: "before" | "after", retryCursor?: string) {
    const epoch = ++contextRequest.current;
    const cursor = retryCursor ?? current.current.range[direction === "before" ? "beforeCursor" : "afterCursor"];
    const input = { channel, mode: direction, cursor };
    setBusy(true);
    updateReadErrors({ type: "begin", owner: "foreground", id: epoch, attempt: { kind: "extend", input } });
    const page = await readPage(input, "foreground", epoch);
    if (!alive.current || revoked.current || epoch !== contextRequest.current) return;
    setBusy(false);
    if (page) {
      finishRead("foreground", epoch, null);
      commit({ store: mergeTeamChatFeedPage(current.current.store, page), range: extendTeamChatFeedRange(current.current.range, page, direction, cursor) });
    }
  }
  function back() {
    const saved = returns.at(-1);
    if (!saved) return;
    contextRequest.current += 1; setBusy(false); setReturns((previous) => previous.slice(0, -1));
    updateReadErrors({ type: "cancel", owner: "foreground" });
    setView(saved.view); setHighlighted(null);
    scroll.current = { kind: "anchor", anchor: saved.anchor, focusId: saved.focusId };
    commit({ ...current.current, range: saved.range });
  }
  async function runSearch(more = false, retry?: Extract<TeamChatReadAttempt, { kind: "search" }>) {
    const attempt: Extract<TeamChatReadAttempt, { kind: "search" }> = retry ?? {
      kind: "search", channel, term: more && search ? search.term : query.trim(), append: more,
      ...(more && search ? { cursor: search.page.cursor } : {}),
    };
    const { term, append } = attempt;
    if (term.length < 2) return;
    const origin: ReturnPoint = { range: current.current.range, view: "feed", anchor: captureAnchor(viewport.current), focusId: null };
    const epoch = ++contextRequest.current; setBusy(true);
    updateReadErrors({ type: "begin", owner: "foreground", id: epoch, attempt });
    try {
      const result = await readTeamChatAction({ channel: attempt.channel, mode: "search", query: term, ...(attempt.cursor !== undefined ? { cursor: attempt.cursor } : {}) });
      if (!alive.current || revoked.current) return;
      if (result.status === "forbidden") { reportFailure("forbidden"); return; }
      if (epoch !== contextRequest.current) return;
      if (result.status !== "ready") { finishRead("foreground", epoch, result.status); return; }
      setChannels(result.snapshot.channels); setParticipants(result.snapshot.participants); finishRead("foreground", epoch, null);
      if (!searchOrigin.current && viewRef.current === "feed") searchOrigin.current = origin;
      if (!append) scroll.current = { kind: "top" }; else preserveScroll();
      setSearch((previous) => ({ term, page: { ...result.snapshot.page, messages: append && previous?.term === term ? teamChatMergeMessages(previous.page.messages, result.snapshot.page.messages) : result.snapshot.page.messages } }));
      setReturns([]); setView("search");
    } catch { finishRead("foreground", epoch, "unavailable"); }
    finally { if (alive.current && epoch === contextRequest.current) setBusy(false); }
  }
  async function resumeEdit(id: string) {
    const epoch = ++contextRequest.current; setBusy(true);
    updateReadErrors({ type: "begin", owner: "foreground", id: epoch, attempt: { kind: "resume-edit", channel, messageId: id } });
    const page = await readPage({ channel, mode: "context", messageId: id }, "foreground", epoch);
    if (!alive.current || revoked.current || epoch !== contextRequest.current) return null;
    setBusy(false);
    if (!page) return null;
    finishRead("foreground", epoch, null);
    commit({ ...current.current, store: mergeTeamChatFeedPage(current.current.store, page) });
    const row = teamChatFeedMessage(current.current.store, id);
    return row?.authorMembershipId === membershipId ? row : null;
  }
  function retryRead(owner: TeamChatReadOwner, id: number) {
    const ticket = readErrorsRef.current[owner];
    if (!alive.current || revoked.current || !ticket?.failure || ticket.pending || ticket.id !== id || !teamChatReadFailureCopy(ticket).retryLabel) return;
    const attempt = ticket.attempt;
    if (attempt.kind === "search") void runSearch(attempt.append, attempt);
    else if (attempt.kind === "navigate") void navigate(attempt.input, attempt.returnPoint);
    else if (attempt.kind === "extend") void loadMore(attempt.input.mode, attempt.input.cursor);
    else if (attempt.kind === "refresh") void refresh(attempt);
  }
  const readFailure = visibleTeamChatReadFailure(readErrors);
  const readFailureCopy = readFailure ? teamChatReadFailureCopy(readFailure.ticket) : null;
  const rows = teamChatFeedRows(feed.store, feed.range);
  const latestMessage = latestMessageId ? teamChatFeedMessage(feed.store, latestMessageId) : null;
  const currentChannel = channels.find((item) => item.key === channel);
  const transportLabel = forbidden ? "Доступ к каналу закрыт" : transport === "live" ? null : transport === "connecting" ? "Подключаем обновления…" : "Живые обновления недоступны";
  const afterSave = () => { void refresh(); };

  return <div ref={workspace} className={styles.workspace} data-panel={panel} aria-busy={busy}>
    <nav className={styles.channels} aria-label="Каналы команды">
      <h1 className={styles.channelTitle}>Командный чат</h1>
      {channels.map((item) => <Link key={item.key} href={`/v3/team-chat?channel=${item.key}`} className={`${styles.channel} ${item.key === channel ? styles.selected : ""}`} aria-current={item.key === channel ? "page" : undefined}
        onClick={(event) => { if (item.key === channel) { event.preventDefault(); setPanel("messages"); } }}>
        <span className={styles.channelAvatar} data-channel={item.key} aria-hidden="true">{TEAM_CHAT_LABELS[item.key][0]}</span>
        <span className={styles.channelCopy}><span className={styles.channelName}>{TEAM_CHAT_LABELS[item.key]}</span>
          {item.key === channel && latestMessage ? <span className={styles.channelPreview}>{latestMessage.deletedAt ? "Сообщение удалено" : `${latestMessage.authorMembershipId === membershipId ? "Вы" : latestMessage.authorName}: ${latestMessage.body}`}</span> : null}
        </span>{item.unreadCount ? <span className={styles.unread} aria-label={`${item.unreadCount} непрочитанных`}>{item.unreadCount}</span> : null}
      </Link>)}
    </nav>
    <section className={styles.conversation} aria-label={`Канал ${TEAM_CHAT_LABELS[channel]}`}>
      <div className={styles.conversationHeader}>
        <button type="button" className={`${styles.secondary} ${styles.mobileBack}`} onClick={() => setPanel("channels")}><Icon name="arrow-left" size={18} />Каналы</button>
        <span className={styles.channelAvatar} data-channel={channel} aria-hidden="true">{TEAM_CHAT_LABELS[channel][0]}</span><h2>{TEAM_CHAT_LABELS[channel]}</h2>
        <button type="button" className={styles.iconButton} disabled={forbidden} aria-label={searchOpen ? "Закрыть поиск" : "Поиск в этом канале"} aria-expanded={searchOpen} aria-controls="team-chat-search-form" onClick={() => {
          setSearchOpen((value) => !value);
          if (searchOpen) {
            contextRequest.current += 1; setBusy(false); setView("feed"); setSearch(null); setReturns([]);
            updateReadErrors({ type: "cancel", owner: "foreground" });
            const origin = searchOrigin.current; searchOrigin.current = null;
            if (origin) { scroll.current = { kind: "anchor", anchor: origin.anchor }; commit({ ...current.current, range: origin.range }); }
          }
          else requestAnimationFrame(() => searchField.current?.focus());
        }}><Icon name={searchOpen ? "x" : "search"} size={22} /></button>
      </div>
      {transportLabel ? <div className={styles.transport} role="status">{transportLabel}
        {!forbidden && transport === "error" ? <button className={styles.textButton} type="button" disabled={busy} onClick={afterSave}>Обновить историю</button> : null}
        {transport === "error" && !forbidden ? <button className={styles.textButton} type="button" onClick={() => setConnectionAttempt((value) => value + 1)}>Подключить снова</button> : null}
      </div> : null}
      {readFailure && readFailureCopy ? <div role="alert" className={styles.error}>
        <p>{readFailureCopy.message}</p>
        {readFailureCopy.retryLabel ? <button className={styles.textButton} type="button" disabled={busy || readFailure.ticket.pending}
          onClick={() => retryRead(readFailure.owner, readFailure.ticket.id)}>{readFailure.ticket.pending ? "Повторяем…" : readFailureCopy.retryLabel}</button> : null}
      </div> : null}
      {forbidden ? <a className={styles.secondary} href="/login">Войти снова</a> : <>
        {searchOpen ? <form id="team-chat-search-form" className={styles.search} onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
          <label className={styles.srOnly} htmlFor="team-chat-search">Поиск в этом канале</label>
          <input ref={searchField} id="team-chat-search" type="search" placeholder="В этом канале" value={query} minLength={2} maxLength={200} onChange={(event) => setQuery(event.target.value)} />
          <button className={styles.secondary} disabled={busy || query.trim().length < 2}>Найти</button>
        </form> : null}
        {returns.length ? <div className={styles.readActions}><button type="button" className={styles.textButton} onClick={back}><Icon name="arrow-left" size={18} />{returns.at(-1)?.view === "search" ? "К результатам поиска" : "Назад к сообщениям"}</button></div> : null}
        <div className={styles.history} ref={viewport} tabIndex={0} aria-label={view === "search" ? "Результаты поиска" : "История сообщений"}
          onScroll={() => {
            stableAnchor.current = captureAnchor(viewport.current); wasAtBottom.current = nearBottom(viewport.current);
            if (wasAtBottom.current && !feed.range.hasAfter && view === "feed" && !returns.length) setNewMessages(false);
          }}>
          {view === "search" && search ? <>
            <p className={styles.muted}>Результаты: «{search.term}»</p>
            {search.page.messages.map((message) => <div key={message.id} data-chat-row={message.id} className={styles.searchResult}>
              <strong>{message.authorName}</strong><p className={styles.body}><SearchText text={message.body} term={search.term} /></p>
              <button id={`team-search-${message.id}`} type="button" className={styles.textButton} disabled={busy} onClick={() => { void navigate({ channel, mode: "context", messageId: message.id }, true); }}>Показать в переписке</button>
            </div>)}
            {!search.page.messages.length ? <p className={styles.empty}>Сообщения не найдены.</p> : null}
            {search.page.hasMore ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => { void runSearch(true); }}>Ещё результаты</button> : null}
          </> : <>
            {feed.range.hasBefore ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => { void loadMore("before"); }}>Предыдущие сообщения</button> : null}
            {rows.map((message, index) => {
              const date = new Date(message.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });
              const priorDate = index ? new Date(rows[index - 1].createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: PLATFORM_ORGANIZATION_TIMEZONE }) : null;
              return <div key={message.id}>{date !== priorDate ? <div className={styles.dateDivider}><span>{date}</span></div> : null}
                <TeamChatMessageRow message={message} quote={message.quoteMessageId ? teamChatFeedQuote(feed.store, message.quoteMessageId) : null}
                  ownMembershipId={membershipId} canModerate={canModerate} participants={participants} highlighted={highlighted === message.id}
                  onReply={(row) => composer.current?.reply(row)} onEdit={(row) => composer.current?.edit(row)}
                  onQuote={(id) => { void navigate({ channel, mode: "context", messageId: id }, true); }}
                  onDelete={(row) => { if (!deletion) { deletionFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-chat-row]") ?? document.activeElement : null; setDeletion({ message: row, requestId: crypto.randomUUID(), isOwn: row.authorMembershipId === membershipId }); } setDeletionVisible(true); }} />
              </div>;
            })}
            {!rows.length ? <p className={styles.empty}>В канале пока нет сообщений. Напишите коллегам.</p> : null}
            {feed.range.hasAfter ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => { void loadMore("after"); }}>Следующие сообщения</button> : null}
          </>}
        </div>
        <div className={styles.readActions}>
          {newMessages || feed.range.hasAfter ? <button type="button" className={styles.textButton} disabled={busy} onClick={() => { void navigate({ channel, mode: "latest" }); }}>К новым сообщениям</button> : null}
          {currentChannel?.firstUnreadId ? <button type="button" className={styles.textButton} disabled={busy} onClick={() => { void navigate({ channel, mode: "context", messageId: currentChannel.firstUnreadId! }, true); }}>К непрочитанным · {currentChannel.unreadCount}</button> : null}
          {deletion && !deletionVisible ? <button type="button" className={styles.textButton} onClick={() => setDeletionVisible(true)}>Проверить удаление сообщения</button> : null}
        </div>
        {seen.error ? <div role="alert" className={styles.error}>Не удалось сохранить просмотр {seen.queued} сообщений. <button className={styles.textButton} type="button" onClick={seen.retry}>Повторить</button></div> : null}
        {deletion ? <TeamChatDeleteConfirmation key={deletion.requestId} attempt={deletion} visible={deletionVisible} onFailure={reportFailure}
          onCancel={(uncertain) => { setDeletionVisible(false); if (!uncertain) setDeletion(null); deletionFocus.current?.focus(); }}
          onSaved={() => { setDeletionVisible(false); setDeletion(null); afterSave(); deletionFocus.current?.focus(); }} /> : null}
        <TeamChatComposer ref={composer} channel={channel} participants={participants} storageScope={`${organizationId}:${membershipId}`} quotes={feed.store.quotes}
          onSaved={afterSave} onFailure={reportFailure} onResumeEdit={resumeEdit} />
      </>}
    </section>
  </div>;
}

function SearchText({ text, term }: { text: string; term: string }) {
  const parts: React.ReactNode[] = [];
  const lower = text.toLocaleLowerCase("ru-RU"), needle = term.toLocaleLowerCase("ru-RU");
  let offset = 0, found = lower.indexOf(needle);
  while (found >= 0) {
    parts.push(text.slice(offset, found), <mark key={found}>{text.slice(found, found + term.length)}</mark>);
    offset = found + term.length; found = lower.indexOf(needle, offset);
  }
  parts.push(text.slice(offset));
  return parts;
}
