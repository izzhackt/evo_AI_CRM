"use client";

import { useEffect } from "react";

import { isStaleDeploymentError, markStaleDeployment, reloadForNewDeployment } from "@/lib/stale-deployment";
import { useInlineStalePrompt } from "@/lib/use-stale-deployment";

/**
 * Вкладка пережила выпуск (action прошлой сборки сервер не знает): `reset()`
 * повторил бы тот же мёртвый запрос, поэтому кнопка перезагружает страницу,
 * опросы оболочки останавливаются, а её карточка молчит — подсказка здесь.
 */
export default function StudentPortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const stale = isStaleDeploymentError(error);
  useEffect(() => { if (stale) markStaleDeployment(); }, [stale]);
  useInlineStalePrompt(stale);
  return (
    <main className="pt-boundary mx-auto w-full max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
      <section role="alert" className="pt-card p-5">
        <p className="pt-boundary-muted text-xs font-semibold uppercase tracking-[0.1em]">
          {stale ? "Вышла новая версия" : "Данные недоступны"}
        </p>
        <h1 className="mt-2 text-xl font-semibold">
          {stale ? "Обновите страницу" : "Не удалось открыть кабинет"}
        </h1>
        <p className="pt-boundary-muted mt-2 text-sm leading-6">
          {stale ? (
            "Эта вкладка открыта на прошлой версии кабинета. После обновления раздел откроется заново."
          ) : (
            <>
              Попробуйте ещё раз или откройте другой раздел через меню.
              Если ошибка повторится, сообщите куратору.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={stale ? reloadForNewDeployment : reset}
          className="pt-btn mt-5 text-sm"
        >
          {stale ? "Обновить страницу" : "Попробовать снова"}
        </button>
      </section>
    </main>
  );
}
