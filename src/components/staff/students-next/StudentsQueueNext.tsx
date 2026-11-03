"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { EmptyState, SectionTabs } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";

import { useDismissedSheet } from "../list-next/useDismissedSheet";
import { bishkekNoon, studentsQueueHref, studentsQueueTabs } from "../students/students-queue-view";
import type { StudentsQueueScreenInput } from "../students/StudentsQueueScreen";
import { StudentSheetHost } from "./StudentSheetHost";
import { StudentTiles } from "./StudentTiles";
import { StudentsTable } from "./StudentsTable";
import { studentTiles, studentsFilterBar } from "./students-next-model";
import { useStudentRows } from "./useStudentRows";

const NO_ROWS: readonly StudentCaseQueueRow[] = [];

/**
 * Вид очереди «Студентов»: вкладки видов с числами, плитки сроков, таблица и панель дела. Все чтения и права приходят с
 * сервера готовыми (`StudentsQueueScreenInput`, как у прежнего вида); здесь они только раскладываются.
 */
export function StudentsQueueNext({ input }: Readonly<{ input: StudentsQueueScreenInput }>) {
  const router = useRouter();
  const { params, read } = input;
  const here = studentsQueueHref(params);
  const now = useMemo(() => bishkekNoon(read.page?.today ?? input.today), [read.page?.today, input.today]);
  const rows = useStudentRows(read.page?.rows ?? NO_ROWS, params.open, now);
  const sheet = useDismissedSheet(params.open);
  const tabs = studentsQueueTabs(params, read.counts, input.actor).map(({ key, label, href, count }) => ({ key, label, href, count }));
  const returnTo = params.open ? studentsQueueHref(params, { open: params.open }) : "";
  const access = { curators: input.editor.preview || !input.actor.coverage ? null : input.curatorNames, editor: input.editor, recordScopes: input.recordScopes };

  return (
    <>
      <div id="admissions-summary" className="min-w-0"><SectionTabs label="Виды списка студентов" tabs={tabs} value={params.view} /></div>
      {read.counts || read.page === null ? null : (
        <div role="status" data-testid="queue-counts-unavailable" className="flex flex-wrap items-center gap-x-2 t-body-compact text-fg-2">
          Счётчики недоступны, список работает.
          <Button variant="link" asChild><Link href={here}>Повторить</Link></Button>
        </div>
      )}
      {read.page === null ? (
        <div role="alert" className="rounded-card border border-border bg-surface" data-testid="queue-error">
          <EmptyState tone="danger" title="Не удалось загрузить список студентов." action={<Button variant="outline" asChild><Link href={here}>Повторить</Link></Button>} />
        </div>
      ) : (
        <>
          <StudentTiles tiles={rows.pendingRefresh ? [] : studentTiles(params, read.counts)} />
          <StudentsTable
            params={params}
            rows={rows.shown}
            counts={read.counts}
            today={read.page.today}
            now={now}
            nextCursor={read.page.nextCursor}
            filters={studentsFilterBar(params, read.counts, input.curatorNames, input.actor.coverage)}
            access={access}
            onOpen={sheet.reset}
          />
          <StudentSheetHost
            openKey={params.open}
            row={rows.open}
            dismissed={sheet.closed}
            onDismiss={() => { sheet.dismiss(); router.push(studentsQueueHref(params, { open: null }), { scroll: false }); }}
            returnTo={returnTo}
            today={read.page.today}
            now={now}
            editor={input.editor}
            recordScopes={input.recordScopes}
            tasks={input.openTasks}
            handoff={input.handoff ?? null}
            closure={input.closure ?? null}
            createTask={input.createTask}
            requestId={input.requestIds.nextStep}
            onSaved={rows.onSaved}
            onClosureChanged={rows.onClosureChanged}
          />
        </>
      )}
    </>
  );
}
