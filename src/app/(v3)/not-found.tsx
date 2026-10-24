import Link from "next/link";

import { staffHomeRoute } from "@/lib/platform-access";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { chromeWords } from "@/lib/v3/wording";

export const metadata = { title: "Страница не найдена" };

/**
 * Тупик внутри оболочки V3: срабатывает только на `notFound()`, брошенный
 * внутри этой группы маршрутов (например, неизвестный фильтр или параметр в
 * адресе) — рендерится внутри `(v3)/layout.tsx`, то есть внутри `AppShell`
 * с боковой навигацией, а не голым экраном фреймворка без выхода.
 */
export default async function V3NotFound() {
  const actor = await requirePlatformStaffActor();
  const home = staffHomeRoute(actor);
  const words = chromeWords.notFound;

  return (
    <main
      className="mx-auto flex min-h-[70dvh] w-full max-w-[640px] items-center px-4 py-10 sm:px-6"
      data-testid="v3-not-found"
    >
      <section className="w-full border-y border-border py-10 sm:py-14">
        <h1 className="t-page-title text-fg">{words.staffTitle}</h1>
        <p className="mt-3 max-w-2xl t-body-compact text-fg-2">{words.staffText}</p>
        <Link
          href={home}
          className="mt-8 inline-flex min-h-11 items-center rounded-ctl bg-accent px-4 t-item text-on-accent hover:bg-accent-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {words.staffAction}
        </Link>
      </section>
    </main>
  );
}
