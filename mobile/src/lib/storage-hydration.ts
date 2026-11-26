// Выбор темы и языка живёт в AsyncStorage, а он асинхронный: первая отрисовка всегда идёт со значениями по умолчанию (светлая, RU), и
// выбор студента приходит на тик позже. На обычных экранах это не видно (сначала сессия и сплэш), а на экране «Приложение не
// настроено» и на экране сбоя (`AppErrorBoundary`) студент с тёмной темой или кыргызским языком мог увидеть светлый русский кадр
// (рецензия #1568). Провайдеры сообщают `hydrated`, эти два экрана ждут его и до того ничего не рисуют.
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Дольше этого экран сбоя не ждёт хранилище: лучше экран со значениями по умолчанию, чем пустой экран. */
export const HYDRATION_CAP_MS = 2_000;

/**
 * Читает значение из хранилища один раз и сообщает его `onResult`: сразу, как прочиталось; `null`, если чтение сорвалось или не
 * уложилось в `capMs` (тогда запоздавшее настоящее значение приходит вторым вызовом). Возвращает отмену (уход экрана).
 */
export function hydrateFromStorage(key: string, onResult: (stored: string | null) => void, capMs: number = HYDRATION_CAP_MS): () => void {
  let cancelled = false;
  let reported = false;
  const report = (stored: string | null) => {
    if (cancelled) return;
    // Второй вызов нужен только запоздавшему настоящему значению после предела ожидания.
    if (reported && stored === null) return;
    reported = true;
    onResult(stored);
  };
  const timer = setTimeout(() => report(null), capMs);
  AsyncStorage.getItem(key)
    .then(
      (stored) => {
        clearTimeout(timer);
        report(stored);
      },
      () => {
        clearTimeout(timer);
        report(null);
      },
    )
    .catch(() => undefined);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
