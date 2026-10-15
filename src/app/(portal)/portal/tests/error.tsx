"use client";

import Link from "next/link";
import { useEffect } from "react";

import { isStaleDeploymentError, markStaleDeployment, reloadForNewDeployment } from "@/lib/stale-deployment";
import { useInlineStalePrompt } from "@/lib/use-stale-deployment";

/**
 * Границы ошибок рендерятся без серверного locale-прохода, поэтому текст —
 * RU-статика: то же осознанное ограничение, что у portal/error.tsx. Вкладка
 * на прошлой сборке получает перезагрузку вместо повтора (см. portal/error.tsx).
 */
export default function TestsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleDeploymentError(error);
  useEffect(() => { if (stale) markStaleDeployment(); }, [stale]);
  useInlineStalePrompt(stale);
  return (
    <main className="pt-page">
      <section role="alert" className="pt-run-card">
        <h1 className="pt-run-heading">{stale ? "Вышла новая версия — обновите страницу" : "Не удалось открыть тест"}</h1>
        <p className="pt-run-text">
          {stale ? "Эта вкладка открыта на прошлой версии кабинета. " : "Проверьте соединение и повторите загрузку. "}
          Уже сохранённые ответы остаются в вашем кабинете.
          {stale ? null : " Чужая или недоступная попытка здесь не открывается."}
        </p>
        <div className="pt-run-nav">
          <button type="button" className="pt-btn" onClick={stale ? reloadForNewDeployment : reset}>
            {stale ? "Обновить страницу" : "Повторить загрузку"}
          </button>
          <Link className="pt-btn-ghost" href="/portal/tests">К списку тестов</Link>
        </div>
      </section>
    </main>
  );
}
