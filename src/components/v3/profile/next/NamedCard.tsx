import { HelpTip } from "@/components/kit/HelpTip";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Карточка страницы лида и дела «Нового вида»: как `WidgetCard`, но заголовок может нести `id` и принимать фокус.
 * На него возвращается фокус после ответа на передачу (`#case-tasks-title`) и после «Повторить» у звонков
 * (`#lead-feed-title`) - прежние экраны делают то же. Число в заголовке - только прочитанное; «?» хранит пояснение.
 */
export function NamedCard({
  title,
  titleId,
  id,
  count,
  help,
  actions,
  testId,
  className,
  bodyClassName,
  children,
}: Readonly<{
  title: string;
  /** `id` заголовка: он принимает фокус программно (`tabIndex=-1`). */
  titleId?: string;
  /** Якорь карточки: адреса событий ленты (`#case-facts`) и групп (`#lead-edit`). */
  id?: string;
  count?: number | null;
  help?: React.ReactNode;
  actions?: React.ReactNode;
  testId?: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}>) {
  return (
    <Card id={id} data-testid={testId} className={cn("scroll-mt-4", className)}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-1.5">
          <CardTitle
            as="h2"
            id={titleId}
            tabIndex={titleId ? -1 : undefined}
            data-queue-heading={titleId ? "" : undefined}
          >
            {title}
            {typeof count === "number" ? <span className="ml-2 font-normal tabular-nums text-fg-3">{count}</span> : null}
          </CardTitle>
          {help ? <HelpTip label={`Пояснение: ${title}`}>{help}</HelpTip> : null}
        </div>
        {actions ? <CardAction className="flex flex-wrap items-center justify-end gap-2">{actions}</CardAction> : null}
      </CardHeader>
      <CardContent className={bodyClassName}>{children}</CardContent>
    </Card>
  );
}
