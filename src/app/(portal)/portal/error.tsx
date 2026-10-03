"use client";

export default function StudentPortalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="pt-boundary mx-auto w-full max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
      <section role="alert" className="pt-card p-5">
        <p className="pt-boundary-muted text-xs font-semibold uppercase tracking-[0.1em]">
          Данные недоступны
        </p>
        <h1 className="mt-2 text-xl font-semibold">
          Не удалось открыть кабинет
        </h1>
        <p className="pt-boundary-muted mt-2 text-sm leading-6">
          Попробуйте ещё раз или откройте другой раздел через меню.
          Если ошибка повторится, сообщите куратору.
        </p>
        <button
          type="button"
          onClick={reset}
          className="pt-btn mt-5 text-sm"
        >
          Попробовать снова
        </button>
      </section>
    </main>
  );
}
