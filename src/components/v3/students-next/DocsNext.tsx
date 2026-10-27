"use client";

import Link from "next/link";

import { EmptyState, SectionTabs } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { LinkFilters } from "../list-next/LinkFilters";
import { ListSearch } from "../list-next/ListSearch";
import { STUDENTS_DOCS_PAGE_SIZE, russianPlural, studentsListHref, studentsQueueHref, type StudentsDocsView } from "../students/students-queue-view";
import type { StudentsQueueScreenInput } from "../students/StudentsQueueScreen";
import { DocsCasesTable } from "./DocsCasesTable";
import { PackagesQueue, ProgramQueue } from "./DocsQueues";
import { docsPlan } from "./docs-next-model";
import { studentsFilterBar, studentsSearchHidden } from "./students-next-model";

/**
 * EVO Docs в «Новом виде»: вкладки с числами (первая непустая открывается сама), дела вкладки таблицей, очереди «Документы
 * программ» и «Комплекты». Чтения, права, решения и ссылки в дело те же, что у прежнего вида; считает их `docsPlan`.
 */
export function DocsNext({ input }: Readonly<{ input: StudentsQueueScreenInput }>) {
  const plan = docsPlan(input);
  const { params, view } = plan;
  const { read } = input;
  const here = studentsQueueHref(params);
  const today = read.page?.today ?? input.today;
  const tabs = plan.tabs.map(({ key, label, href, count }) => ({ key, label, href, count }));
  const nextLink = (next: typeof plan.next) => next ? (
    <Button variant="outline" asChild>
      <Link href={studentsListHref(params, { view: next.view as StudentsDocsView })} scroll={false}>{next.label}: <span className="tabular-nums">{next.count}</span></Link>
    </Button>
  ) : undefined;
  const queueEmpty = <EmptyState title="Проверять нечего." action={nextLink(plan.next ?? plan.toAll)} />;
  return (
    <>
      <SectionTabs label="Виды списка студентов" tabs={tabs} value={view} />
      {read.counts || read.page === null ? null : (
        <div role="status" data-testid="queue-counts-unavailable" className="flex flex-wrap items-center gap-x-2 t-body-compact text-fg-2">
          Счётчики недоступны, список работает.
          <Button variant="link" asChild><Link href={here}>Повторить</Link></Button>
        </div>
      )}
      {view === "program" ? <ProgramQueue program={input.program ?? { kind: "hidden" }} review={input.documentReview} returnTo={here} today={today} empty={queueEmpty} />
        : view === "packages" ? <PackagesQueue packages={input.packages ?? { kind: "hidden" }} owner={input.documentReview?.owner ?? null} returnTo={here} today={today} empty={queueEmpty} />
        : read.page === null ? (
          <div role="alert" className="rounded-card border border-border bg-surface" data-testid="queue-error">
            <EmptyState tone="danger" title="Не удалось загрузить дела для EVO Docs." action={<Button variant="outline" asChild><Link href={here}>Повторить</Link></Button>} />
          </div>
        ) : (
          <>
            {plan.order === "partial" ? <p className="t-meta text-fg-2">Прочитаны не все дела — порядок не по ожиданию.</p> : null}
            <DocsCasesTable
              rows={plan.rows}
              view={view}
              today={today}
              returnTo={here}
              toolbar={<>
                <ListSearch action="/v3/profile" value={params.query ?? ""} placeholder="Студент или страна" label="Найти студента" hidden={studentsSearchHidden(params)} maxLength={200} />
                <LinkFilters bar={studentsFilterBar(params, read.counts, input.curatorNames, input.actor.coverage)} />
              </>}
              empty={<EmptyState title={plan.emptyTitle} action={nextLink(plan.emptyNext)} />}
            />
            {params.cursor || read.page.nextCursor ? (
              <div role="status" className="flex flex-wrap items-center gap-3 t-body-compact text-fg-2">
                {/* У 241 нет отбора по документам: вкладка проверки отбирает строки внутри чтения по 100 дел. */}
                {view === "all" ? null : <span>Прочитаны {params.cursor ? "следующие" : "первые"} {read.page.rows.length} {russianPlural(read.page.rows.length, "дело", "дела", "дел")}; числа вкладок неполные.</span>}
                {params.cursor ? <Button variant="outline" asChild><Link href={studentsQueueHref(params, { cursor: null })} scroll={false}>К началу</Link></Button> : null}
                {read.page.nextCursor ? (
                  <Button variant="outline" asChild>
                    <Link href={studentsQueueHref(params, { cursor: read.page.nextCursor })} rel="next">{view === "all" ? `Следующие ${STUDENTS_DOCS_PAGE_SIZE}` : `Проверить следующие ${STUDENTS_DOCS_PAGE_SIZE}`}</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
    </>
  );
}
