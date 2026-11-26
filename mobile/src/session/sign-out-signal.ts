// Выход из кабинета: сигнал тем, кто пишет на сервер сам (сессии теста, теста на время и урока: повтор по таймеру, досылка при
// закрытии экрана). Выход отзывает токен, а кабинет закрывается чуть позже (после ответа сервера и очистки телефона): без сигнала
// закрытие экрана досылало остаток уже без действующего токена, и сервер отвечал 401 (QA 23: `save_learning_test_v1` сразу после
// `/auth/v1/logout`). Сигнал идёт ПЕРВЫМ делом при выходе, до запроса на отзыв, и сессии отказываются от всего, что не ушло.
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

/** Сессия записи (`abandon()`) отказывается от всего неотправленного, как только начался выход из кабинета. */
export function useAbandonOnSignOut(target: { abandon(): void }): void {
  useEffect(() => onSignOut(() => target.abandon()), [target]);
}
