// Состояние чата: последняя страница (запрос), более ранние страницы, очередь отправки,
// опрос раз в 30 с на видимом экране и «прочитано» только на видимом.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { chatPostWrite, markChatRead, postChatMessage, readChatPage } from "@/api/inbox-api";
import { useChatLatest } from "@/api/inbox-queries";
import { usePokePoll } from "@/api/PortalPoll";
import { usePortalApi } from "@/api/PortalApi";
import {
  dropSent,
  markOutbox,
  mergePortalCaseMessages,
  newestSequenceId,
  prepareBody,
  shouldMarkRead,
  type OutboxItem,
  type PortalCaseMessage,
} from "@/domain/inbox-model";
import { useScreenVisible } from "@/features/inbox/visibility";
import { createPoller } from "@/lib/poll";
import { RpcError, rpcErrorKey, type FrozenWrite } from "@/lib/rpc";

export const CHAT_POLL_MS = 30_000;

export function useChatThread() {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const poke = usePokePoll();
  const visible = useScreenVisible();
  const queryKey = useMemo(() => ["portal", userKey, "chat"] as const, [userKey]);
  const latest = useChatLatest();

  const [earlier, setEarlier] = useState<readonly PortalCaseMessage[]>([]);
  const [earlierCursor, setEarlierCursor] = useState<string | null>(null);
  const [earlierMore, setEarlierMore] = useState<boolean | null>(null);
  const [earlierBusy, setEarlierBusy] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const [outbox, setOutbox] = useState<readonly OutboxItem[]>([]);
  const [sendErrorKey, setSendErrorKey] = useState<ReturnType<typeof rpcErrorKey> | null>(null);
  const writes = useRef(new Map<string, FrozenWrite>());

  const page = latest.data;
  const messages = useMemo(() => (page ? mergePortalCaseMessages(earlier, page.messages) : earlier), [earlier, page]);
  const hasEarlier = earlierMore ?? page?.hasMore ?? false;
  const cursor = earlierCursor ?? page?.cursor ?? null;

  // Опрос раз в 30 с, пока чат виден. Идущий запрос не дублируется.
  const refetchRef = useRef(latest.refetch);
  useEffect(() => {
    refetchRef.current = latest.refetch;
  });
  useEffect(() => {
    if (!visible) return undefined;
    const poller = createPoller({ intervalMs: CHAT_POLL_MS, run: () => refetchRef.current() });
    poller.start();
    return () => poller.stop();
  }, [visible]);

  // «Прочитано»: только пока чат виден, один раз на самое новое сообщение.
  const lastSent = useRef<string | null>(null);
  const newest = newestSequenceId(messages);
  useEffect(() => {
    if (!shouldMarkRead({ visible, foreground: true, newest, lastSent: lastSent.current }) || newest === null) return;
    lastSent.current = newest;
    markChatRead(transport, newest)
      .then(() => {
        void client.invalidateQueries({ queryKey: ["portal", userKey, "notifications"] });
        poke();
      })
      .catch(() => {
        lastSent.current = null; // повторится при следующем показе или новом сообщении
      });
  }, [visible, newest, transport, client, userKey, poke]);

  const attempt = useCallback(
    async (requestId: string) => {
      const write = writes.current.get(requestId);
      if (!write) return;
      setOutbox((current) => markOutbox(current, requestId, "sending"));
      setSendErrorKey(null);
      try {
        await postChatMessage(transport, write);
        await client.refetchQueries({ queryKey });
        writes.current.delete(requestId);
        setOutbox((current) => dropSent(current, requestId));
      } catch (error) {
        setOutbox((current) => markOutbox(current, requestId, "failed"));
        setSendErrorKey(error instanceof RpcError ? rpcErrorKey(error) : "error.generic");
      }
    },
    [transport, client, queryKey],
  );

  /** Новая отправка: id и текст замораживаются сейчас, повтор шлёт ровно их. Вернёт `false` при пустом тексте. */
  const send = useCallback(
    (draft: string): boolean => {
      const body = prepareBody(draft);
      if (body === null) return false;
      const write = chatPostWrite(body);
      writes.current.set(write.requestId, write);
      setOutbox((current) => [...current, { requestId: write.requestId, body, status: "sending", createdAt: new Date().toISOString() }]);
      void attempt(write.requestId);
      return true;
    },
    [attempt],
  );

  const retry = useCallback((requestId: string) => void attempt(requestId), [attempt]);
  const discard = useCallback((requestId: string) => {
    writes.current.delete(requestId);
    setOutbox((current) => dropSent(current, requestId));
  }, []);

  const loadEarlier = useCallback(async () => {
    if (!cursor || earlierBusy) return;
    setEarlierBusy(true);
    setEarlierFailed(false);
    try {
      const older = await readChatPage(transport, cursor);
      setEarlier((current) => mergePortalCaseMessages(current, older.messages));
      setEarlierCursor(older.cursor);
      setEarlierMore(older.hasMore);
    } catch {
      setEarlierFailed(true);
    } finally {
      setEarlierBusy(false);
    }
  }, [cursor, earlierBusy, transport]);

  return {
    query: latest,
    messages,
    awaitState: page?.awaitState ?? "none",
    hasEarlier,
    loadEarlier,
    earlierBusy,
    earlierFailed,
    outbox,
    sendErrorKey,
    send,
    retry,
    discard,
  };
}
