import { PageHeader } from "@/components/kit/PageHeader";
import { cn } from "@/lib/utils";

/**
 * Рамка страниц-чатов «Нового вида» («WhatsApp» и «Переписка»): шапка из набора (`PageHeader`: заголовок, число, «?»)
 * и рабочая область чата на высоту окна. Размеры и перехваты оболочки те же, что у прежних рамок, поэтому правила
 * v3.css (`isFillRoute`, `main:has([data-inbox-open])`, `[class*="100dvh"]`) работают без изменений:
 *  - `inbox` — как `PartShell fill`: от 768 px страницу высотой в окно даёт колонка оболочки;
 *  - `messages` — как `ConversationsMain`: `main` сам на высоту окна, на узком экране открытая переписка забирает
 *    экран, а заголовок остаётся для читалки.
 * Шапка, спрятанная от глаз, не оставляет в порядке табуляции невидимого «?» (фокус без видимого кольца, WCAG 2.4.7):
 * «?» прячется `display: none` на той же ширине, что и шапка. Заголовок `h1` для читалки остаётся.
 */
export function ChatPageShell({
  variant,
  title,
  count,
  help,
  testId,
  threadOpen = false,
  children,
}: Readonly<{
  variant: "inbox" | "messages";
  title: string;
  /** Размер того, что показано; null — считать нечего. */
  count?: number | null;
  /** Пояснение страницы — за «?», на экране его нет. */
  help?: React.ReactNode;
  testId?: string;
  /** Открыт чат или переписка: на узком экране они забирают окно, шапку видно только читалке (`inbox` — до 768 px, `messages` — уже `@2xl`). */
  threadOpen?: boolean;
  children: React.ReactNode;
}>) {
  const messages = variant === "messages";
  // Тот же порог, что у скрытия шапки: `inbox` — правило v3.css `@media (width < 48rem)` (= `max-md`), `messages` — контейнер оболочки.
  const helpHidden = threadOpen ? (messages ? "@max-2xl:hidden" : "max-md:hidden") : undefined;
  return (
    <main
      data-testid={testId}
      aria-label={messages ? title : undefined}
      data-conversations-main={messages ? "" : undefined}
      className={cn(
        "mx-auto flex w-full max-w-[1240px] flex-col px-4 sm:px-6",
        messages ? "h-[calc(100dvh-150px)] min-h-0 pb-4 pt-6 md:h-[calc(100dvh-64px)]" : "py-6 md:min-h-0 md:flex-1",
      )}
    >
      <PageHeader title={title} count={count} help={help} helpClassName={helpHidden} className={messages && threadOpen ? "@max-2xl:sr-only" : undefined} />
      <div className={cn("mt-5 flex min-h-0 flex-1 flex-col", messages && threadOpen && "@max-2xl:mt-0")}>{children}</div>
    </main>
  );
}
