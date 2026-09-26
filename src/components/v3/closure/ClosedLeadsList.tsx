import Link from "next/link";

import type { ClosedLeadsPage } from "@/lib/platform-closure-contract";
import { closureWords, leadStage } from "@/lib/v3/wording";

import { ClosedLine, DotRun } from "./Closure";

const QUIET_LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * «Закрытые лиды» доски продаж (`/v3/pipeline?view=closed`): новые закрытия
 * сверху, у каждого — имя, «причина · дата», факты и «Вернуть в работу». Чтение
 * 246 отдаёт только лиды, которые сотрудник читает; «Вернуть в работу» —
 * только тем, кому сервер подсказал право. Сбой чтения — не пустой список.
 */
export function ClosedLeadsList({
  page,
  readOnly,
  retryHref,
  firstHref,
  nextHref,
  paged,
  leadHref,
}: Readonly<{
  page: ClosedLeadsPage | null;
  /** Просмотр роли: строки без «Вернуть в работу». */
  readOnly: boolean;
  retryHref: string;
  firstHref: string;
  nextHref: string | null;
  /** Это не первая страница. */
  paged: boolean;
  leadHref: (leadId: string) => string;
}>) {
  if (page === null) {
    return (
      <div role="alert" className="flex flex-col items-start gap-1 border-y border-border py-6" data-testid="v3-closed-leads-error">
        <p className="t-item text-danger">{closureWords.lead.unavailable}</p>
        <Link href={retryHref} className={QUIET_LINK}>Повторить</Link>
      </div>
    );
  }
  return (
    <section aria-label={closureWords.lead.closedListTitle} data-testid="v3-closed-leads">
      {page.rows.length === 0 ? (
        <p className="border-y border-border py-6 t-body-compact text-fg-2">{closureWords.lead.empty}</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {page.rows.map((row) => {
            const word = leadStage(row.stageKey);
            const stage = word ? word.charAt(0).toUpperCase() + word.slice(1) : null;
            const facts = [stage ? `Этап: ${stage}` : null, row.ownerName ? `Ответственный: ${row.ownerName}` : null,
              row.closedByName ? `Закрыл: ${row.closedByName}` : null].filter((fact): fact is string => fact !== null);
            return (
              <li key={row.leadId} className="py-2" data-lead-id={row.leadId}>
                <Link href={leadHref(row.leadId)} className="t-item inline-flex min-h-11 items-center break-words text-fg underline-offset-4 hover:underline">
                  {row.name ?? "Лид без имени"}
                </Link>
                {/* Заголовок уже говорит «Закрытые»: сразу причина и дата, ниже — факты, затем возврат. */}
                <ClosedLine
                  kind="lead"
                  subjectId={row.leadId}
                  expectedVersion={row.workflowVersion}
                  reasonKey={row.reason}
                  note={row.note}
                  closedAt={row.closedAt}
                  canReopen={row.canManage && !readOnly}
                  showState={false}
                  details={facts.length ? <DotRun parts={facts} className="t-meta text-fg-2" /> : null}
                />
              </li>
            );
          })}
        </ul>
      )}
      {paged || nextHref ? (
        <p className="flex flex-wrap gap-x-4">
          {paged ? <Link href={firstHref} className={QUIET_LINK}>К началу</Link> : null}
          {nextHref ? <Link href={nextHref} rel="next" className={QUIET_LINK}>Следующие</Link> : null}
        </p>
      ) : null}
    </section>
  );
}
