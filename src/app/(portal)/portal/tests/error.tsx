"use client";

import Link from "next/link";

/**
 * Границы ошибок рендерятся без серверного locale-прохода, поэтому текст —
 * RU-статика: то же осознанное ограничение, что у portal/error.tsx.
 */
export default function TestsError({ reset }: { reset: () => void }) {
  return (
    <main className="pt-page">
      <section role="alert" className="pt-run-card">
        <h1 className="pt-run-heading">Не удалось открыть тест</h1>
        <p className="pt-run-text">
          Проверьте соединение и повторите загрузку. Уже сохранённые ответы остаются в вашем кабинете.
          Чужая или недоступная попытка здесь не открывается.
        </p>
        <div className="pt-run-nav">
          <button type="button" className="pt-btn" onClick={reset}>Повторить загрузку</button>
          <Link className="pt-btn-ghost" href="/portal/tests">К списку тестов</Link>
        </div>
      </section>
    </main>
  );
}
