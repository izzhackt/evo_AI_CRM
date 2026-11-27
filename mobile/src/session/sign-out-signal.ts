// Выход из кабинета: сигнал тем, кто пишет на сервер сам (сессии теста, теста на время и урока: повтор по таймеру, досылка при
// закрытии экрана). Выход отзывает токен, а кабинет закрывается чуть позже (после ответа сервера и очистки телефона): без сигнала
// закрытие экрана досылало остаток уже без действующего токена, и сервер отвечал 401 (QA 23: `save_learning_test_v1` сразу после
// `/auth/v1/logout`). Сигнал идёт ПЕРВЫМ делом при выходе, до запроса на отзыв, и сессии отказываются от всего, что не ушло.
// Кнопка «Выйти» перед сигналом даёт сессиям теста досылать неотправленное (`flushBeforeSignOut`, до 3 с в сумме, пока токен жив).
import { useEffect } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Выход начался (кнопка «Выйти», `SIGNED_OUT` от Supabase, сессия исчезла): все подписанные сессии прекращают запись. */
export function announceSignOut(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Сбой одной сессии не должен оставить другие писать.
    }
  }
}

/** Подписка на выход; возвращает отписку. */
export function onSignOut(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

type Flusher = () => Promise<unknown>;
const flushers = new Set<Flusher>();

/** Сколько кнопка «Выйти» ждёт досылку: всего, на все сессии вместе, а не на каждую. */
export const SIGN_OUT_FLUSH_MS = 3_000;

/** Подписка на досылку перед выходом (только кнопка «Выйти»); возвращает отписку. */
export function onSignOutFlush(flusher: Flusher): () => void {
  flushers.add(flusher);
  return () => void flushers.delete(flusher);
}

/**
 * Кнопка «Выйти», ещё до сигнала и до отзыва токена: сессии теста досылают неотправленное (все разом, токен пока действует) и выход
 * ждёт их не дольше `SIGN_OUT_FLUSH_MS` в сумме. Не бросает: сбой и опоздание досылки молча теряются, как и раньше (выход не ждёт
 * связи). Нечего слать или никто не подписан: готово сразу, таймера после себя не оставляет. Событие `SIGNED_OUT`, пропавшая сессия
 * и удалённый аккаунт сюда не ходят: токена там уже нет.
 */
export async function flushBeforeSignOut(): Promise<void> {
  if (flushers.size === 0) return;
  const runs = [...flushers].map(async (flush) => {
    try {
      await flush();
    } catch {
      // Сбой досылки одной сессии не мешает ни другим, ни выходу.
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SIGN_OUT_FLUSH_MS);
  });
  try {
    await Promise.race([Promise.all(runs), cap]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Сессия записи (`abandon()`) отказывается от всего неотправленного, как только начался выход из кабинета. Если у неё есть
 * `flushForSignOut()`, кнопка «Выйти» сначала даёт ей досылать (см. `flushBeforeSignOut`).
 */
export function useAbandonOnSignOut(target: { abandon(): void; flushForSignOut?(): Promise<unknown> }): void {
  useEffect(() => {
    const offAbandon = onSignOut(() => target.abandon());
    const flush = target.flushForSignOut?.bind(target);
    const offFlush = flush ? onSignOutFlush(flush) : undefined;
    return () => {
      offAbandon();
      offFlush?.();
    };
  }, [target]);
}
