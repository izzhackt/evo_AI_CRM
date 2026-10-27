import { cn } from "@/lib/utils";

export type KeyFact = Readonly<{
  label: string;
  /** Нет значения (`null`, пустая строка) — факт не рисуется: чего нет в данных, того нет и на экране. */
  value: React.ReactNode;
}>;

/**
 * Статичные строки — чтобы Tailwind видел классы. Колонок не больше четырёх: плотность правила 2 (CLAUDE.md).
 * Две колонки — от 28rem блока: на телефоне в боковой панели колонка была бы ~170 px, и почта рвалась бы
 * посреди домена; там значения идут одним столбцом.
 */
const GRID = {
  1: "grid-cols-1",
  2: "grid-cols-1 @md:grid-cols-2",
  3: "grid-cols-2 @xl:grid-cols-3",
  4: "grid-cols-2 @xl:grid-cols-4",
} as const;

/**
 * Ключевые данные карточки: подпись и значение, не больше 4 в одной строке. Считается по ширине самого блока
 * (контейнер), поэтому в боковой панели и на странице раскладка одна. Остальные факты — во вкладку или
 * `DetailSheet`, а не в пятую колонку.
 */
export function KeyFacts({
  facts,
  columns = 4,
  className,
}: Readonly<{
  facts: readonly KeyFact[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}>) {
  const shown = facts.filter((fact) => fact.value !== null && fact.value !== undefined && fact.value !== "");
  if (shown.length === 0) return null;
  const grid = GRID[Math.min(4, Math.max(1, columns)) as 1 | 2 | 3 | 4];
  return (
    <div className="@container" data-slot="key-facts">
      <dl className={cn("grid gap-x-4 gap-y-3", grid, className)}>
        {shown.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="t-caption text-fg-3">{fact.label}</dt>
            <dd className="t-body-compact min-w-0 break-words text-fg">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
