import Link from "next/link";

import { chromeWords } from "@/lib/v3/wording";

export const metadata = { title: "Страница не найдена · EVO" };

/**
 * Тупик внутри Student Portal: срабатывает на `notFound()`, брошенный внутри
 * этой группы маршрутов — рендерится внутри `(portal)/layout.tsx`, то есть
 * внутри портального `Shell`, а не голым экраном фреймворка без выхода.
 * Стиль повторяет `portal/error.tsx`.
 */
export default function StudentPortalNotFound() {
  const words = chromeWords.notFound;

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
      <section className="rounded-card border border-border bg-surface p-5 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-fg-3">
          {words.eyebrow}
        </p>
        <h1 className="mt-2 text-xl font-semibold text-fg">{words.title}</h1>
        <p className="mt-2 text-sm leading-6 text-fg-2">{words.studentText}</p>
        <Link
          href="/portal"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-nav bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-2"
        >
          {words.studentAction}
        </Link>
      </section>
    </main>
  );
}
