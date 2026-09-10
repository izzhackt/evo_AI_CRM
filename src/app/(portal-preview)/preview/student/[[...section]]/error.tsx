"use client";

import Link from "next/link";

export default function StudentPortalPreviewError({ reset }: { reset: () => void }) {
  return (
    <div className="v3-world min-h-dvh">
      <main className="mx-auto max-w-[760px] px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold text-fg">Не удалось открыть предпросмотр</h1>
        <p role="alert" className="mt-3 text-sm leading-6 text-fg-2">
          Повторите загрузку. Недоступное содержимое не заменяется вымышленными данными.
          Выбор ответов в этом режиме не сохраняется.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="inline-flex min-h-11 items-center rounded-nav bg-accent px-4 text-sm font-medium text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
            Повторить загрузку
          </button>
          <Link href="/" className="inline-flex min-h-11 items-center rounded-nav border border-control-edge px-4 text-sm font-medium text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
            Вернуться в CRM
          </Link>
        </div>
      </main>
    </div>
  );
}
