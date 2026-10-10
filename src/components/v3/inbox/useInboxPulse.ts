"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { V3InboxSort } from "@/lib/v3/inbox-href";

/**
 * Новые сообщения без ручного обновления (решение владельца 06.10.2026).
 * Лёгкий опрос `/api/v3/inbox/pulse`: сервер отвечает только подписями
 * списка и открытого чата — без текста и имён. Изменилась подпись —
 * страница перечитывается (`router.refresh()`), но никогда посреди отправки:
 * тогда перечитывание откладывается до её конца.
 *
 * Чаще, пока вкладка в фокусе (5 с), реже, когда она видна без фокуса
 * (20 с), и никак, пока скрыта. Три сбоя подряд — опрос стоит до фокуса или
 * восстановления сети и честно говорит об этом.
 */
const FOCUSED_MS = 5_000;
const VISIBLE_MS = 20_000;
const FAILURES_BEFORE_STALL = 3;

export function useInboxPulse({
  conversationId,
  listPulse,
  chatPulse,
  query,
  sort,
  busy,
}: Readonly<{
  conversationId: string | null;
  /** null — список не на первой странице: его не опрашиваем. */
  listPulse: string | null;
  chatPulse: string | null;
  query: string | null;
  /** «Неотвеченные» — первая страница в этом порядке, иначе подпись не совпадёт. */
  sort: V3InboxSort;
  busy: boolean;
}>): Readonly<{ stalled: boolean; resume: () => void }> {
  const router = useRouter();
  const [stalled, setStalled] = useState(false);
  const known = useRef({ list: listPulse, chat: chatPulse });
  const busyRef = useRef(busy);
  const owed = useRef(false);
  const failures = useRef(0);
  const wake = useRef<() => void>(() => {});

  const refresh = useCallback(() => {
    if (busyRef.current) { owed.current = true; return; }
    owed.current = false;
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    known.current = { list: listPulse, chat: chatPulse };
  }, [listPulse, chatPulse]);

  useEffect(() => {
    busyRef.current = busy;
    if (!busy && owed.current) refresh();
  }, [busy, refresh]);

  const watchList = listPulse !== null;
  useEffect(() => {
    if (!watchList && conversationId === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let controller: AbortController | null = null;
    const params = new URLSearchParams();
    if (conversationId) params.set("conversation", conversationId);
    if (watchList) params.set("list", "1");
    if (query) params.set("q", query);
    if (sort === "unanswered") params.set("sort", "unanswered");

    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(tick, document.hasFocus() ? FOCUSED_MS : VISIBLE_MS);
    };
    const fail = (fatal: boolean) => {
      failures.current += 1;
      if (fatal || failures.current >= FAILURES_BEFORE_STALL) {
        stopped = true;
        setStalled(true);
        return;
      }
      schedule();
    };
    async function tick() {
      if (stopped || document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/api/v3/inbox/pulse?${params.toString()}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403 || response.status === 404) { fail(true); return; }
        if (!response.ok) { fail(false); return; }
        const body = await response.json() as { list?: unknown; chat?: unknown };
        failures.current = 0;
        const listChanged = known.current.list !== null && typeof body.list === "string" && body.list !== known.current.list;
        const chatChanged = known.current.chat !== null && typeof body.chat === "string" && body.chat !== known.current.chat;
        if (listChanged || chatChanged) {
          known.current = {
            list: typeof body.list === "string" ? body.list : known.current.list,
            chat: typeof body.chat === "string" ? body.chat : known.current.chat,
          };
          refresh();
        }
        schedule();
      } catch (error) {
        if ((error as { name?: string } | null)?.name === "AbortError") return;
        fail(false);
      }
    }
    const restart = () => {
      if (stopped) return;
      schedule();
    };
    wake.current = () => {
      failures.current = 0;
      stopped = false;
      setStalled(false);
      void tick();
    };
    const onOnline = () => wake.current();
    const onFocus = () => { if (stopped) wake.current(); else restart(); };
    document.addEventListener("visibilitychange", restart);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", restart);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [conversationId, watchList, query, sort, refresh]);

  const resume = useCallback(() => {
    wake.current();
    refresh();
  }, [refresh]);

  return { stalled, resume };
}
