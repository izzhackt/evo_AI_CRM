// Состояние чата: последняя страница (запрос), всё уже загруженное (последние страницы по мере опроса и более ранние), очередь
// отправки, опрос раз в 30 с на видимом экране и «прочитано» только на видимом.
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

/** Постраничное чтение «Показать более ранние»: курсор и признак «есть ещё» (`null` - берутся у последней страницы); `epoch` меняется, когда окно ушло далеко. */
type EarlierPaging = Readonly<{ epoch: number; cursor: string | null; more: boolean | null }>;

/**
 * Сколько сообщений страницы уже загружено: все (слияние и лишняя перерисовка не нужны), часть (окно сдвинулось, но осталось рядом)
 * или ни одного (между двумя чтениями пришло больше окна: между загруженным и новым окном пропуск).
 */
function overlap(loaded: readonly PortalCaseMessage[], incoming: readonly PortalCaseMessage[]): "all" | "some" | "none" {
  const known = new Set(loaded.map((message) => message.sequenceId));
  const hits = incoming.filter((message) => known.has(message.sequenceId)).length;
  return hits === incoming.length ? "all" : hits === 0 ? "none" : "some";
}

export function useChatThread() {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const poke = usePokePoll();
  const visible = useScreenVisible();
  const queryKey = useMemo(() => ["portal", userKey, "chat"] as const, [userKey]);
  const latest = useChatLatest();
  // Открыли с устаревшим кэшем: пока не пришло свежее чтение, показанное не итог (объявления нового сообщения ждут, useIncomingNotice).
  const [staleAtMount] = useState(() => latest.data !== undefined && latest.isStale);
  const awaitingFresh = staleAtMount && !latest.isFetchedAfterMount;

  // Всё, что студент уже загрузил: более ранние страницы и каждая последняя страница опроса. Последняя страница сервера - окно в 30
  // сообщений, которое обновление заменяет целиком и которое уезжает вперёд: сообщение, выпавшее из окна после «Показать более ранние»,
  // остаётся здесь, иначе в ленте дыра (веб копит ленту: `MessagesThread.tsx`, слияние по номеру).
  const [loaded, setLoaded] = useState<readonly PortalCaseMessage[]>([]);
  const [paging, setPaging] = useState<EarlierPaging>({ epoch: 0, cursor: null, more: null });
  const [earlierBusy, setEarlierBusy] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const [outbox, setOutbox] = useState<readonly OutboxItem[]>([]);
  const [sendErrorKey, setSendErrorKey] = useState<ReturnType<typeof rpcErrorKey> | null>(null);
  // «Сообщение отправлено.» (веб sentStatus): после подтверждённой отправки, до следующей попытки.
  const [justSent, setJustSent] = useState(false);
  const writes = useRef(new Map<string, FrozenWrite>());

  const page = latest.data;
  // Каждая новая последняя страница сразу вливается в загруженное (состояние выравнивается при отрисовке, без лишнего кадра с дырой).
  const [foldedPage, setFoldedPage] = useState<typeof page>(undefined);
  if (page !== foldedPage) {
    setFoldedPage(page);
    const seen = page ? overlap(loaded, page.messages) : "all";
    if (page && seen !== "all") {
      setLoaded(mergePortalCaseMessages(loaded, page.messages));
      // Окно не пересекается ни с чем загруженным: между ними пропуск, и «Показать более ранние» должно начаться от нового окна, а не
      // от старого курсора (иначе пропуск не закрыть никогда). `epoch` отбрасывает ответ запроса, начатого ещё от старого курсора.
      if (seen === "none" && loaded.length > 0) setPaging((current) => ({ epoch: current.epoch + 1, cursor: null, more: null }));
    }
  }
  // Показывается ровно загруженное: страница уже влита выше (повтор слияния здесь скрыл бы дубли, накопленные во вливании).
  const messages = loaded;
  const hasEarlier = paging.more ?? page?.hasMore ?? false;
  const cursor = paging.cursor ?? page?.cursor ?? null;

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
      setJustSent(false);
      try {
        await postChatMessage(transport, write);
        await client.refetchQueries({ queryKey });
        writes.current.delete(requestId);
        setOutbox((current) => dropSent(current, requestId));
        setJustSent(true);
      } catch (error) {
        setOutbox((current) => markOutbox(current, requestId, "failed"));
        setSendErrorKey(error instanceof RpcError ? rpcErrorKey(error) : "error.generic");
        // Две отправки подряд: подтверждение одной не должно пережить сбой другой.
        setJustSent(false);
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
    // Убрали неотправленное: подтверждение другой отправки, скрытое, пока оно стояло в ленте, не должно появиться и прозвучать теперь.
    setJustSent(false);
  }, []);

  const loadEarlier = useCallback(async () => {
    if (!cursor || earlierBusy) return;
    const epoch = paging.epoch;
    setEarlierBusy(true);
    setEarlierFailed(false);
    try {
      const older = await readChatPage(transport, cursor);
      setLoaded((current) => mergePortalCaseMessages(current, older.messages));
      // Окно ушло далеко, пока шёл этот запрос: курсор остаётся у нового окна, ответ на старый не возвращает «ранние» назад.
      setPaging((current) => (current.epoch === epoch ? { epoch, cursor: older.cursor, more: older.hasMore } : current));
    } catch {
      setEarlierFailed(true);
    } finally {
      setEarlierBusy(false);
    }
  }, [cursor, earlierBusy, paging.epoch, transport]);

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
    justSent,
    visible,
    awaitingFresh,
    send,
    retry,
    discard,
  };
}
