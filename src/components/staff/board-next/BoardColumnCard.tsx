import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Колонка доски нового вида — карточка набора (`Card` size sm) с названием этапа (`t-item`, не больше двух строк: колонка в шестую
 * часть страницы), числом и необязательным значком справа. Карточки дел лежат в `children` списком. Общая у «Воронки продаж» и
 * «Воронки поступления». `headerHidden` скрывает шапку там, где этап уже назван выбором над списком (телефон).
 * Число стоит на первой строке названия (15.11.2026): у названия в две строки оно не опускается на середину, и числа всех колонок
 * ряда стоят на одной линии.
 */
export function BoardColumnCard({ title, count, marker, headerClassName, className, children }: Readonly<{
  title: string;
  count: number;
  marker?: React.ReactNode;
  headerClassName?: string;
  className?: string;
  children: React.ReactNode;
}>) {
  return (
    <Card size="sm" className={cn("h-full", className)}>
      <CardHeader className={cn("items-center group-data-[size=sm]/card:px-3", headerClassName)}>
        <CardTitle as="h2" className="t-item line-clamp-2 break-words">{title}</CardTitle>
        <CardAction className="flex h-(--type-item-leading) items-center gap-1 self-start t-meta tabular-nums text-fg-3">
          {marker}
          {count}
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 group-data-[size=sm]/card:px-2">{children}</CardContent>
    </Card>
  );
}
