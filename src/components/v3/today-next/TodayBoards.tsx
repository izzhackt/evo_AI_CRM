import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { Button } from "@/components/ui/button";
import type { TodayLink } from "@/lib/v3/today-queue";

/**
 * Доски роли — одна группа в шапке «Сегодня» (продажам своя доска, поступлению своя). Это переходы, а не действия
 * страницы: кнопки без красного. Две доски на телефоне называются коротко, как у прежнего вида (`TodayBoardLinks`).
 */
export function TodayBoards({ links }: Readonly<{ links: readonly TodayLink[] }>) {
  if (links.length === 0) return null;
  const compact = links.length > 1;
  return (
    <nav aria-label="Доски" className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Button key={link.href} variant="outline" asChild>
          <IntentPrefetchLink href={link.href}>
            {compact && link.short ? <>
              <span className="sm:hidden">{link.short}</span>
              <span className="hidden sm:inline">{link.label}</span>
            </> : link.label}
          </IntentPrefetchLink>
        </Button>
      ))}
    </nav>
  );
}
