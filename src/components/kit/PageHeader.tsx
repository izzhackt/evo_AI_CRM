import { HelpTip } from "@/components/kit/HelpTip";
import { cn } from "@/lib/utils";

/**
 * Шапка страницы «Нового вида»: заголовок, не больше одной группы действий и (если нужно) «?» с пояснением.
 * Разметка повторяет глубину прежней шапки (`h1.t-page-title` — прямой потомок первого потомка корня:
 * корень > div > h1): на неё опираются отступ сверху и телефонные правила оболочки в staff.css
 * (`main:has(> div:first-child > div:first-child > h1.t-page-title)`). Поэтому «?» и вторичная строка стоят в том
 * же блоке рядом с `h1`, а не во вложенном ряду. Главное действие страницы — одна красная кнопка в
 * `actions`; остальное — нейтральное.
 *
 * С картинкой `leading` («Директор / Аналитик» шириной 250 px рядом с маскотом и «?» на телефоне не помещается в одну строку)
 * ряд не переносится: название сужается и переходит на вторую строку само, а «?» и картинка остаются по краям,
 * вместо «?» на отдельной строке и шапки выше на 8–44 px. Со вторичной строкой `meta` ряд переносится, как прежде.
 */
export function PageHeader({
  title,
  leading,
  count,
  meta,
  help,
  helpLabel,
  helpClassName,
  actions,
  className,
}: Readonly<{
  title: string;
  /** Картинка перед заголовком (маскот агента); декоративная — заголовок говорит сам. */
  leading?: React.ReactNode;
  /** Размер того, что показано; null/undefined — считать нечего, число не рисуется. */
  count?: number | null;
  /** Вторичная строка под заголовком (`t-meta`): например, дата. */
  meta?: React.ReactNode;
  /** Пояснение страницы: уходит за «?», на экране его нет. */
  help?: React.ReactNode;
  helpLabel?: string;
  /**
   * Классы кнопки «?». Хозяин, который прячет шапку только от глаз (`sr-only`, обрезка), прячет и «?» через `hidden`
   * (display: none): невидимая кнопка в порядке табуляции — фокус без видимого кольца.
   */
  helpClassName?: string;
  /** Одна группа действий справа; на узком экране переносится под заголовок. */
  actions?: React.ReactNode;
  className?: string;
}>) {
  const inline = Boolean(leading) && !meta;
  return (
    <div data-slot="page-header" className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className={cn("flex min-w-0 items-center gap-x-2 gap-y-1", inline ? "flex-nowrap" : "flex-wrap")}>
        {leading}
        <h1 className={cn("t-page-title text-fg", inline && "min-w-0")}>
          {title}
          {typeof count === "number" ? <span className="ml-2.5 font-normal tabular-nums text-fg-3">{count}</span> : null}
        </h1>
        {help ? <HelpTip label={helpLabel ?? `Пояснение: ${title}`} className={helpClassName}>{help}</HelpTip> : null}
        {meta ? <p className="t-meta basis-full text-fg-3">{meta}</p> : null}
      </div>
      {actions ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
