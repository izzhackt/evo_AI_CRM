"use client";

export default function StudentPortalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
      <section
        role="alert"
        className="rounded-card border border-border bg-surface p-5 shadow-card"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-fg-3">
          Данные недоступны
        </p>
        <h1 className="mt-2 text-xl font-semibold text-fg">
          Не удалось открыть кабинет
        </h1>
        <p className="mt-2 text-sm leading-6 text-fg-2">
          Обновите данные ещё раз. Если ошибка повторится, сообщите куратору —
          кабинет не будет подменять недоступные сведения.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-nav bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-2"
        >
          Попробовать снова
        </button>
      </section>
    </main>
  );
}
