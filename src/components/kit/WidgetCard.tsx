import { HelpTip } from "@/components/kit/HelpTip";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Базовый виджет страницы: заголовок, до одной группы действий справа, «?» с пояснением, тело и (если надо)
 * подвал. Шапка переносится: заголовок занимает ровно столько места, сколько ему нужно (запасной ширины у него нет), и действие уходит под
 * заголовок справа, только когда рядом с ним не хватает места (длинная кнопка на телефоне); короткое действие и бейдж остаются рядом.
 * Всё, что длиннее четырёх данных в строке или второстепенно, уезжает в `DetailSheet` или вкладку.
 * Страница собирается из таких карточек; своей рамки и теней у страницы нет.
 */
export function WidgetCard({
  title,
  help,
  helpLabel,
  actions,
  footer,
  size,
  headingLevel = 2,
  id,
  className,
  bodyClassName,
  children,
}: Readonly<{
  title?: string;
  help?: React.ReactNode;
  helpLabel?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "default" | "sm";
  /** Уровень заголовка карточки под `h1` страницы (2) или под заголовком раздела (3). */
  headingLevel?: 2 | 3;
  /** Якорь для перехода на раздел (`#applications`). */
  id?: string;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}>) {
  const hasHeader = Boolean(title || actions);
  return (
    <Card id={id} size={size} className={cn("scroll-mt-4", className)}>
      {hasHeader ? (
        <CardHeader className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-[1_1_auto] items-center gap-1.5">
            {title ? <CardTitle as={`h${headingLevel}`}>{title}</CardTitle> : null}
            {help ? <HelpTip label={helpLabel ?? (title ? `Пояснение: ${title}` : undefined)}>{help}</HelpTip> : null}
          </div>
          {actions ? <CardAction className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</CardAction> : null}
        </CardHeader>
      ) : null}
      {children !== undefined ? <CardContent className={bodyClassName}>{children}</CardContent> : null}
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}
