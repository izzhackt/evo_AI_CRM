import { HelpTip } from "@/components/kit/HelpTip";
import { cn } from "@/lib/utils";

/**
 * Шапка страницы «Нового вида»: заголовок, не больше одной группы действий и (если нужно) «?» с пояснением.
 * Разметка повторяет прежнюю шапку (`h1.t-page-title` — первый потомок первого потомка корня): на неё опираются
 * отступ сверху и телефонные правила оболочки в v3.css. Главное действие страницы — одна красная кнопка в
 * `actions`; остальное — нейтральное.
 */
export function PageHeader({
  title,
  count,
  meta,
  help,
  helpLabel,
  actions,
  className,
}: Readonly<{
  title: string;
  /** Размер того, что показано; null/undefined — считать нечего, число не рисуется. */
  count?: number | null;
  /** Вторичная строка под заголовком (`t-meta`): например, дата. */
  meta?: React.ReactNode;
  /** Пояснение страницы: уходит за «?», на экране его нет. */
  help?: React.ReactNode;
  helpLabel?: string;
  /** Одна группа действий справа; на узком экране переносится под заголовок. */
  actions?: React.ReactNode;
  className?: string;
}>) {
  return (
    <div data-slot="page-header" className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="t-page-title text-fg">
            {title}
            {typeof count === "number" ? <span className="ml-2.5 font-normal tabular-nums text-fg-3">{count}</span> : null}
          </h1>
          {help ? <HelpTip label={helpLabel}>{help}</HelpTip> : null}
        </div>
        {meta ? <p className="t-meta mt-1 text-fg-3">{meta}</p> : null}
      </div>
      {actions ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
