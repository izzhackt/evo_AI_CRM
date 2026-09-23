import Link from "next/link";

export function SalesReportNavigation({ sales }: { sales: boolean }) {
  return <nav aria-label="Раздел главной" className="mb-6 flex flex-wrap gap-2 border-b border-border pb-2 text-sm">
    {[{ title: "Главная", href: "/v3/main", active: !sales },
      { title: "Отчёт продаж", href: "/v3/main?view=sales", active: sales }].map(item =>
      <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}
        className="v3-choice inline-flex min-h-11 items-center rounded-nav px-3 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg motion-reduce:transition-none">
        {item.title}
      </Link>)}
  </nav>;
}
