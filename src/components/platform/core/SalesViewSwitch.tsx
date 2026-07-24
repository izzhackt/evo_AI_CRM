import Link from "next/link";

import { cn } from "@/components/ui";
import type { SalesCopy, SalesView } from "./SalesCopy";

export function SalesViewSwitch({
  current,
  boardHref,
  listHref,
  copy,
}: {
  current: SalesView;
  boardHref: string;
  listHref: string;
  copy: SalesCopy;
}) {
  const linkClass =
    "inline-flex min-h-9 items-center justify-center rounded-nav px-3 text-[12.5px] font-semibold transition-[background-color,color,box-shadow] duration-150 motion-reduce:transition-none";

  return (
    <nav
      aria-label={copy.viewLabel}
      className="inline-flex rounded-ctl bg-surface-2 p-1"
    >
      <Link
        href={boardHref}
        aria-current={current === "board" ? "page" : undefined}
        className={cn(
          linkClass,
          current === "board"
            ? "bg-surface text-fg shadow-evo"
            : "text-fg-3 hover:text-fg",
        )}
      >
        {copy.kanban}
      </Link>
      <Link
        href={listHref}
        aria-current={current === "list" ? "page" : undefined}
        className={cn(
          linkClass,
          current === "list"
            ? "bg-surface text-fg shadow-evo"
            : "text-fg-3 hover:text-fg",
        )}
      >
        {copy.list}
      </Link>
    </nav>
  );
}
