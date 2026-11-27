import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AI_AGENTS_HUB_HREF } from "@/lib/v3/ai-agents-view";

/**
 * «Все ИИ-агенты» над заголовком страницы агента: слот `back` рамки `PageShell`. `phone="arrow"` — на телефоне строки над
 * заголовком нет, возврат стрелкой перед маскотом (`NextBackArrow`): шапка агента на 393 px ниже на целую строку.
 */
export function NextBackLink({ phone = "line" }: Readonly<{ phone?: "line" | "arrow" }>) {
  return <Button variant="ghost" asChild className={`-ms-3 mb-2${phone === "arrow" ? " max-sm:hidden" : ""}`}><Link href={AI_AGENTS_HUB_HREF}><ArrowLeftIcon aria-hidden="true" /> Все ИИ-агенты</Link></Button>;
}

/** Телефонный возврат к списку агентов: стрелка 44 px перед маскотом в ряду заголовка; на компьютере её нет. */
export function NextBackArrow() {
  return (
    <Link href={AI_AGENTS_HUB_HREF} aria-label="Все ИИ-агенты" className="-ms-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg sm:hidden">
      <ArrowLeftIcon aria-hidden="true" className="size-5" />
    </Link>
  );
}
