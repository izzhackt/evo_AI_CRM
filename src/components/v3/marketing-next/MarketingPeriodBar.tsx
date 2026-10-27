import { BoardSegments } from "@/components/v3/board/Board";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { MarketingNextProps } from "./marketing-next-types";

/**
 * Период «Обзора» и «Заявок»: ссылки (период живёт в адресе — экран можно переслать и вернуться назад), а у «Периода» — форма
 * из двух обязательных дат методом GET: диапазон с одним концом сервер молча заменил бы месяцем. Фильтры заявок форма несёт
 * скрытыми полями (`hidden`), как раньше.
 */
export function MarketingPeriodBar({ period }: Readonly<{ period: NonNullable<MarketingNextProps["period"]> }>) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <BoardSegments label="Период" items={period.choices.map((choice) => ({ ...choice, count: null }))} />
      {period.range ? (
        <form method="get" action="/v3/marketing" className="flex flex-wrap items-end gap-2" aria-label="Свой период">
          {Object.entries(period.hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <input type="hidden" name="period" value="custom" />
          <div className="grid gap-1"><Label htmlFor="mk-from">Начало</Label><Input id="mk-from" type="date" name="from" required defaultValue={period.range.from} max={period.range.max} className="w-40" /></div>
          <div className="grid gap-1"><Label htmlFor="mk-to">Конец</Label><Input id="mk-to" type="date" name="to" required defaultValue={period.range.to} max={period.range.max} className="w-40" /></div>
          <Button type="submit" variant="outline">Показать</Button>
        </form>
      ) : null}
    </div>
  );
}
