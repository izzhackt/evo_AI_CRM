import Link from "next/link";

import type { Crumb } from "./library-model";

/** Путь над таблицей: узко — «… / родитель / папка», полный путь — в дереве папок. Последний пункт — текущее место. */
export function LibraryCrumbs({ crumbs }: Readonly<{ crumbs: readonly Crumb[] }>) {
  return (
    <nav aria-label="Путь" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1 t-body-compact text-fg-2" data-testid="knowledge-path">
        {crumbs.length > 2 ? <li aria-hidden="true" className="flex min-h-11 items-center text-fg-3 @3xl/kb:hidden">…</li> : null}
        {crumbs.map((crumb, index) => (
          <li key={crumb.key} className={`min-w-0 items-center gap-1 ${index < crumbs.length - 2 ? "hidden @3xl/kb:flex" : "flex"}`}>
            {index > 0 ? <span aria-hidden="true" className="text-fg-3">/</span> : null}
            {crumb.href
              ? <Link href={crumb.href} className="inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:text-fg hover:underline [overflow-wrap:anywhere]">{crumb.label}</Link>
              : <span aria-current="page" className="inline-flex min-h-11 min-w-0 items-center t-item text-fg [overflow-wrap:anywhere]">{crumb.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
