/**
 * Отказ ленивого куска «Нового вида» (`lazy`, `next/dynamic`): `.catch(onLazyFailed(заглушка))`. Заглушка нужна, только когда код
 * куска не пришёл (обрыв связи): Turbopack и webpack отклоняют такую загрузку ошибкой с именем `ChunkLoadError`. Нарисованную
 * страницу тогда не снимаем, оставляем заглушку, а ошибку пишем в `console.error`. Всё остальное — бросок при загрузке модуля, то
 * есть ошибка в коде куска, — уходит выше как есть, как на `main`: заглушка «проверьте связь» скрыла бы её. На сервере `import()`
 * отклоняется только из-за ошибки в коде, поэтому там выше уходит любая ошибка. Дальше путь такой: у маршрутов нового вида есть
 * `loading.tsx` (граница `Suspense`), сервер слышит ошибку (`onError`, журнал), отвечает 200 и отдаёт границу браузеру, а браузер
 * показывает `(v3)/error.tsx`; оболочку (ответ 500) ошибка роняет только на маршруте без `Suspense` над входом.
 * Файл без импортов: его берёт `HelpTip`, который должен оставаться лёгким. Обычная функция, а не стрелка с `<T>`: стенды на Node
 * грузят `.ts` как TSX, где `<T>(…) =>` читается как JSX.
 */
export function onLazyFailed<T>(fallback: T): (error: unknown) => T {
  return (error) => {
    if (typeof window === "undefined" || !isChunkLoadError(error)) throw error;
    console.error("[Новый вид] не загрузился ленивый кусок экрана:", error);
    return fallback;
  };
}

/** Код куска не пришёл: так называют ошибку загрузки чанка Turbopack и webpack (проверка по имени, а не по `instanceof`). */
function isChunkLoadError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "ChunkLoadError";
}
