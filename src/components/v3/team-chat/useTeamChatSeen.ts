"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { markTeamChatSeenAction } from "@/lib/platform-team-chat-seen-actions";
import { decodeTeamChatSeenReceipt } from "@/lib/platform-team-chat-seen";
import { TEAM_CHAT_SEEN_BATCH_LIMIT, TEAM_CHAT_SEEN_DWELL_MS, teamChatBodyVisible } from "@/lib/team-chat-feed";
import type { TeamChatChannelKey, TeamChatFailure } from "@/lib/platform-team-chat";

/** Only message bodies in the active feed can qualify; quote/search markup has no marker. */
export function useTeamChatSeen({ viewport, workspace, channel, enabled, revision, revoked, isRevoked, onAcknowledged, onForbidden }: {
  viewport: RefObject<HTMLDivElement | null>; workspace: RefObject<HTMLDivElement | null>;
  channel: TeamChatChannelKey; enabled: boolean; revision: unknown; revoked: boolean; isRevoked: () => boolean;
  onAcknowledged: () => void; onForbidden: () => void;
}) {
  const queue = useRef(new Set<string>());
  const confirmed = useRef(new Set<string>());
  const sending = useRef(false);
  const failed = useRef(false);
  const active = useRef(false);
  const generation = useRef(0);
  const rescan = useRef(() => {});
  const flushNext = useRef<() => void>(() => {});
  const [error, setError] = useState<TeamChatFailure | null>(null);
  const [queued, setQueued] = useState(0);

  const flush = useCallback(async (explicit = false) => {
    if (!active.current || isRevoked() || sending.current || (failed.current && !explicit) || !queue.current.size) return;
    const ids = [...queue.current].slice(0, TEAM_CHAT_SEEN_BATCH_LIMIT);
    const epoch = generation.current;
    sending.current = true;
    let status: TeamChatFailure | null = null;
    try {
      const batch = { channel, messageIds: ids };
      const result = await markTeamChatSeenAction(batch);
      if (epoch !== generation.current || !active.current || isRevoked()) return;
      if (result.status !== "saved") status = result.status;
      else if (!decodeTeamChatSeenReceipt(result.receipt, batch)) status = "unavailable";
      else {
        ids.forEach((id) => { confirmed.current.add(id); queue.current.delete(id); });
        failed.current = false; setError(null); setQueued(queue.current.size);
        onAcknowledged();
      }
    } catch { if (epoch === generation.current && active.current) status = "unavailable"; }
    finally { sending.current = false; }
    if (epoch !== generation.current || !active.current || isRevoked()) return;
    if (status) {
      failed.current = true; setError(status); setQueued(queue.current.size);
      if (status === "forbidden") { queue.current.clear(); active.current = false; onForbidden(); }
    } else {
      rescan.current();
      if (queue.current.size) flushNext.current();
    }
  }, [channel, isRevoked, onAcknowledged, onForbidden]);
  useLayoutEffect(() => { flushNext.current = () => { void flush(); }; }, [flush]);

  useLayoutEffect(() => {
    if (revoked) { active.current = false; generation.current += 1; queue.current.clear(); confirmed.current.clear(); }
  }, [revoked]);

  useEffect(() => {
    const queuedIds = queue.current;
    const confirmedIds = confirmed.current;
    active.current = true;
    return () => { active.current = false; generation.current += 1; queuedIds.clear(); confirmedIds.clear(); };
  }, [channel]);

  useEffect(() => {
    const root = viewport.current;
    const outer = workspace.current;
    if (!root || !outer || !enabled) return;
    const candidates = new Set<HTMLElement>();
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    let disposed = false;
    const clear = () => { timers.forEach(clearTimeout); timers.clear(); };
    const usable = () => !disposed && active.current && !isRevoked() && document.visibilityState === "visible" && document.hasFocus()
      && root.getBoundingClientRect().height > 0 && !outer.querySelector("details[open], [data-chat-overlay='true']")
      && !Array.from(document.querySelectorAll("dialog[open], [role='dialog'][aria-modal='true']")).some((dialog) => dialog.getClientRects().length > 0);
    const qualifies = (body: HTMLElement) => {
      if (!usable() || !body.isConnected) return false;
      const rect = body.getBoundingClientRect();
      const bounds = root.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, bounds.bottom, window.innerHeight)
        - Math.max(rect.top, bounds.top, 0));
      const left = Math.max(rect.left, bounds.left, 0), right = Math.min(rect.right, bounds.right, window.innerWidth);
      if (right <= left || !teamChatBodyVisible(rect.height, visibleHeight)) return false;
      const hit = document.elementFromPoint((left + right) / 2, Math.max(rect.top, bounds.top, 0) + visibleHeight / 2);
      return hit !== null && body.contains(hit);
    };
    const restart = () => {
      clear();
      if (!usable() || failed.current) return;
      for (const body of candidates) {
        const id = body.dataset.chatBody;
        if (!id || confirmed.current.has(id) || queue.current.has(id) || !qualifies(body)) continue;
        timers.set(body, setTimeout(() => {
          timers.delete(body);
          if (!qualifies(body) || failed.current || queue.current.size >= TEAM_CHAT_SEEN_BATCH_LIMIT) return;
          queue.current.add(id); setQueued(queue.current.size);
          // All bodies that finish this dwell turn join the same bounded batch.
          setTimeout(() => { void flush(); }, 0);
        }, TEAM_CHAT_SEEN_DWELL_MS));
      }
    };
    rescan.current = restart;
    const intersection = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const body = entry.target as HTMLElement;
        if (entry.isIntersecting) candidates.add(body); else candidates.delete(body);
      }
      restart();
    }, { root, threshold: [0, 0.5, 1] });
    const resize = new ResizeObserver(restart);
    resize.observe(root);
    for (const body of root.querySelectorAll<HTMLElement>("[data-chat-body]")) { intersection.observe(body); resize.observe(body); }
    const mutation = new MutationObserver(restart);
    mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden", "aria-hidden", "aria-modal", "data-state", "data-chat-overlay"] });
    root.addEventListener("scroll", restart, { passive: true });
    window.addEventListener("resize", restart);
    window.addEventListener("focus", restart);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", restart);
    return () => {
      disposed = true; clear(); rescan.current = () => {};
      intersection.disconnect(); resize.disconnect(); mutation.disconnect();
      root.removeEventListener("scroll", restart); window.removeEventListener("resize", restart);
      window.removeEventListener("focus", restart); window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", restart);
    };
  }, [viewport, workspace, enabled, revision, flush, isRevoked]);
  return { error, queued, retry: () => { void flush(true); } };
}
