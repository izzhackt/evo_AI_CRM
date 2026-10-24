import Link from "next/link";

/**
 * Плитка «Ждут решения»: у `MetricCard` ссылки нет (общий блок), поэтому здесь та же карточка,
 * но растянутой ссылкой на очередь черновиков. Нулевую плитку рисует обычный `MetricCard` — её не прячут.
 */
export function PendingTile({ value, href }: Readonly<{ value: number; href: string }>) {
  return (
    <li className="relative flex flex-col gap-1 rounded-card border border-border bg-surface px-4 py-3.5 transition-colors hover:border-border-strong motion-reduce:transition-none">
      <span className="t-caption text-fg-3">Ждут решения</span>
      <span className="t-figure text-fg">
        <Link href={href} className="rounded-nav after:absolute after:inset-0 after:rounded-card" aria-label={`Ждут решения: ${value}. Открыть черновики`}>{value}</Link>
      </span>
    </li>
  );
}
