import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pagerNumbers, REQUESTS_MAX_PAGE, requestTabCount, requestsHref, type RequestSelection, type RequestsQueue } from "@/lib/requests-queue-contract";
import { cn } from "@/lib/utils";

const NUMBER = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-ctl px-2 t-label tabular-nums";

/**
 * Страницы «Заявок» (26.11.2026): «Предыдущая», номера 1 2 3 … и «Следующая». Номер открывает страницу смещением (377);
 * «Предыдущая / Следующая» идут курсором от границы показанной страницы — взятая за это время заявка не сдвигает очередь.
 * Номер текущей страницы — из смещения первой строки, которое отдаёт база, и при переходе курсором.
 */
export function RequestsPager({ selection, queue }: Readonly<{ selection: RequestSelection; queue: RequestsQueue }>) {
  const total = requestTabCount(queue.counts, selection.source) ?? 0;
  const last = Math.min(Math.max(1, Math.ceil(total / selection.limit)), REQUESTS_MAX_PAGE);
  const current = Math.min(Math.floor(queue.offset / selection.limit) + 1, last);
  if (last <= 1 && !queue.previousCursor && !queue.nextCursor) return null;
  const pageHref = (page: number) => requestsHref({ ...selection, cursor: null, page });
  return (
    <nav aria-label="Страницы заявок" className="flex flex-wrap items-center gap-1.5" data-testid="v3-requests-pager">
      {queue.previousCursor ? (
        <Button variant="outline" asChild><Link href={requestsHref({ ...selection, cursor: queue.previousCursor })}><ChevronLeftIcon aria-hidden="true" />Предыдущая страница</Link></Button>
      ) : null}
      {last > 1 ? (
        <ol className="flex flex-wrap items-center gap-1" aria-label={`Страница ${current} из ${last}`}>
          {pagerNumbers(current, last).map((page, index) => (
            <li key={page === "gap" ? `gap-${index}` : page}>
              {page === "gap" ? <span aria-hidden="true" className={cn(NUMBER, "min-w-6 text-fg-3")}>…</span>
                : page === current ? <span aria-current="page" className={cn(NUMBER, "v3-choice border border-transparent")}>{page}</span>
                  : <Link href={pageHref(page)} aria-label={`Страница ${page}`} className={cn(NUMBER, "text-fg-2 hover:bg-surface-2 hover:text-fg")}>{page}</Link>}
            </li>
          ))}
        </ol>
      ) : null}
      {queue.nextCursor ? (
        <Button variant="outline" asChild><Link href={requestsHref({ ...selection, cursor: queue.nextCursor })}>Следующая страница<ChevronRightIcon aria-hidden="true" /></Link></Button>
      ) : null}
    </nav>
  );
}
