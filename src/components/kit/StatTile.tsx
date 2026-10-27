import Link from "next/link";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const VALUE_TONE = { neutral: "text-fg", ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;

/**
 * Одно число с подписью. Нет значения (`null`) — «—», без выдуманного роста и процентов: сравнивать не с чем,
 * так и пишем. Цвет только у самого числа и только по смыслу (красный — проблема). `href` делает плитку
 * ссылкой на то, что за числом стоит.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  href,
  className,
}: Readonly<{
  label: string;
  value: string | number | null;
  /** Одна короткая строка под числом: период или уточнение; без пояснений «на всякий случай». */
  hint?: string;
  tone?: keyof typeof VALUE_TONE;
  href?: string;
  className?: string;
}>) {
  const empty = value === null || value === "";
  const tile = (
    <Card size="sm" className={cn("h-full data-[size=sm]:gap-1", href && "group-hover:bg-surface-2", className)}>
      <p className="t-caption px-4 text-fg-3">{label}</p>
      <p className={cn("t-figure px-4", empty ? "text-fg-3" : VALUE_TONE[tone])}>
        {empty ? <><span aria-hidden="true">—</span><span className="sr-only">нет данных</span></> : value}
      </p>
      {hint ? <p className="t-meta px-4 text-fg-3">{hint}</p> : null}
    </Card>
  );
  return href ? (
    <Link href={href} className="group block h-full rounded-card" data-slot="stat-tile">
      {tile}
    </Link>
  ) : (
    <div data-slot="stat-tile" className="h-full">
      {tile}
    </div>
  );
}
