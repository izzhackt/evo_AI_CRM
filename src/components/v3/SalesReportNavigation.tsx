import Link from "next/link";

export function SalesReportNavigation({ sales }: { sales: boolean }) {
  return <nav aria-label="Раздел главной" className="mb-6 flex flex-wrap gap-x-6 border-b border-border text-sm">
    {[{ title: "Обзор", href: "/v3/main", active: !sales },
      { title: "Отчёт продаж", href: "/v3/main?view=sales", active: sales }].map(item =>
      <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}
        className={`inline-flex min-h-11 items-center border-b-2 py-3 transition-colors motion-reduce:transition-none ${item.active ? "border-accent font-semibold text-fg" : "border-transparent text-fg-2 hover:border-border hover:text-fg"}`}>
        {item.title}
      </Link>)}
  </nav>;
}
