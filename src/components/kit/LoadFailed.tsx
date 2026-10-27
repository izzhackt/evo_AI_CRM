"use client";

import { OUTLINE_BUTTON } from "@/components/kit/outline-button";

/**
 * Код ленивого экрана («Новый вид») не пришёл: обрыв связи, два раза подряд (Turbopack повторяет загрузку один раз).
 * Без этого ошибка загрузки уходит в границу ошибок `(v3)/error.tsx`, а её «Попробовать снова» (`reset()`) новой загрузки не
 * делает: `next/dynamic` помнит отклонённое обещание до перезагрузки страницы. Здесь кнопка перезагружает страницу. Файл подключают
 * входы всех экранов, поэтому он не тянет `Button` (`cva`, `tailwind-merge`): кнопка — тот же вид классами (`OUTLINE_BUTTON`).
 */
export function LoadFailed() {
  return (
    <div role="alert" data-testid="v3-load-failed" className="grid justify-items-start gap-3 rounded-card border border-border bg-surface p-6">
      <p className="t-body-compact text-fg">Не удалось загрузить экран. Проверьте связь и обновите страницу.</p>
      <button type="button" className={OUTLINE_BUTTON} onClick={() => window.location.reload()}>Обновить страницу</button>
    </div>
  );
}

/** `.catch(onScreenLoadFailed)` у ленивого входа экрана: вместо ошибки загрузки — `LoadFailed`. */
export const onScreenLoadFailed = () => LoadFailed;
