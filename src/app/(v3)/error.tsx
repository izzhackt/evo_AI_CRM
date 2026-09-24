"use client";

import Link from "next/link";

import { chromeWords } from "@/lib/v3/wording";

/**
 * Граница ошибок V3: Next.js вкладывает её внутрь `(v3)/layout.tsx` того же
 * сегмента, поэтому `AppShell` с боковой навигацией остаётся на экране, а
 * этот блок заменяет только упавшее содержимое страницы.
 *
 * Ссылка ведёт на `/v3` (не на конкретный раздел): клиентский компонент не
 * может безопасно узнать домашний раздел актёра, а корень `/v3` уже делает
 * ровно это на сервере через `staffHomeRoute`.
 */
export default function V3Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const words = chromeWords.error;

  return (
    <main
      className="mx-auto flex min-h-[70dvh] w-full max-w-[640px] items-center px-4 py-10 sm:px-6"
      data-testid="v3-error"
    >
      <section role="alert" className="w-full border-y border-border py-10 sm:py-14">
        <p className="t-caption text-fg-3">{words.eyebrow}</p>
        <h1 className="t-page-title mt-2 text-fg">{words.title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-fg-3">{words.staffText}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {words.retry}
          </button>
          <Link
            href="/v3"
            className="inline-flex min-h-11 items-center rounded-ctl border border-control-edge px-4 text-sm font-medium text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {words.staffAction}
          </Link>
        </div>
      </section>
    </main>
  );
}
