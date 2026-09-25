import Link from "next/link";
import type { ReactNode } from "react";

import type { StudentCaseQueueCounts, StudentCaseQueuePage } from "@/lib/platform-student-case-queue-contract";

import type { StudentsCoverage } from "../profile/students-coverage-view";
import { QueueEmpty, QueueError, QUEUE_QUIET_LINK } from "../queue/QueueStates";
import { QueueKeyboard } from "../queue/QueueKeyboard";
import { CuratorWorkloadView } from "./CuratorWorkloadView";
import { StudentsDocsTable } from "./StudentsDocsTable";
import { StudentsQueueBody } from "./StudentsQueueBody";
import { StudentsCountsUnavailable, StudentsFilterRejected, StudentsTabs, StudentsToolbar, type CuratorName } from "./StudentsQueueHead";
import {
  STUDENTS_DOCS_PAGE_SIZE,
  STUDENTS_DOCS_VIEW_LABELS,
  docsRowMatches,
  docsTabCounts,
  studentsDocsTabs,
  studentsQueueHref,
  studentsQueueTabs,
  type NextStepAccessInput,
  type StudentsDocsView,
  type StudentsOpenTasks,
  type StudentsQueueParams,
} from "./students-queue-view";

export type StudentsQueueScreenInput = Readonly<{
  params: StudentsQueueParams;
  /** Адрес не разобран: только вкладки и «Не удалось применить фильтры». */
  invalid: boolean;
  read: Readonly<{ page: StudentCaseQueuePage | null; counts: StudentCaseQueueCounts | null }>;
  openTasks: StudentsOpenTasks | null;
  coverage: StudentsCoverage | null;
  /** Сегодня в Бишкеке (часы приложения) — для дат нагрузки кураторов. */
  today: string;
  curatorNames: readonly CuratorName[];
  editor: NextStepAccessInput;
  recordScopes: readonly string[];
  createTask: boolean;
  requestIds: Readonly<{ nextStep: string; coverage: string }>;
}>;

const DIRECTORY = "min-w-0 space-y-2";

/**
 * Шапка очереди — вкладки, строка инструментов и заметка о числах — во всю
 * ширину над списком и панелью: открытая панель не переносит ни вкладки, ни
 * фильтры, и первая строка списка не прыгает. Между вкладками и строкой
 * инструментов — половина прежнего воздуха.
 */
function QueueHead({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="space-y-1.5" data-testid="v3-students-queue-head">{children}</div>;
}

function docsEmptyTitle(view: StudentsDocsView, filtered: boolean): string {
  if (view === "review") return "Документов на проверку нет";
  if (view === "fix") return "Документов на исправление нет";
  return filtered ? "Ничего не найдено" : "Дел в работе нет";
}

/**
 * Экран «Студентов» и EVO Docs из уже прочитанных данных: вкладки видов,
 * строка инструментов, тело и панель. Чистая сборка без запросов — её
 * вызывает страница после чтений и статический рендер с синтетикой.
 * Возвращает число для заголовка (только при прочитанных числах) и тело.
 */
export function buildStudentsQueueScreen(input: StudentsQueueScreenInput): Readonly<{ count: number | null; content: ReactNode }> {
  const { params, read } = input;
  const admin = { admin: input.editor.admin };
  const docs = params.mode === "docs";
  if (input.invalid) {
    const tabs = docs ? studentsDocsTabs(params, { review: null, fix: null, all: null }) : studentsQueueTabs(params, null, admin);
    return {
      count: null,
      content: <div className={DIRECTORY} data-testid="v3-student-case-directory">
        <QueueHead><StudentsTabs tabs={tabs} /></QueueHead>
        <StudentsFilterRejected resetHref={studentsQueueHref(params)} />
      </div>,
    };
  }
  const here = studentsQueueHref(params);
  const toolbar = <StudentsToolbar params={params} counts={read.counts} curatorFilter={input.editor.admin} curatorNames={input.curatorNames} />;
  const countsNotice = read.counts ? null : <StudentsCountsUnavailable retryHref={here} />;

  if (docs) {
    const page = read.page;
    const rows = page?.rows ?? [];
    const complete = page !== null && params.cursor === null && page.nextCursor === null;
    const tabCounts = docsTabCounts(rows, complete, read.counts);
    const view = params.view as StudentsDocsView;
    const shown = rows.filter((row) => docsRowMatches(view, row));
    const filtered = Boolean(params.query || params.direction || params.curator);
    return {
      count: tabCounts[view],
      content: <div className={DIRECTORY} data-testid="v3-student-case-directory">
        <QueueKeyboard />
        <QueueHead>
          <StudentsTabs tabs={studentsDocsTabs(params, tabCounts)} />
          {toolbar}
          {countsNotice}
        </QueueHead>
        {page === null ? <QueueError text="Не удалось загрузить дела для EVO Docs." retryHref={here} />
          : shown.length === 0 ? <QueueEmpty title={docsEmptyTitle(view, filtered)} />
          : <StudentsDocsTable rows={shown} view={view} caption={`${STUDENTS_DOCS_VIEW_LABELS[view]}: ${shown.length} из прочитанных дел`} returnTo={here} />}
        {page && (params.cursor || page.nextCursor) ? (
          <p role="status" className="flex flex-wrap items-center gap-x-4 t-body-compact text-fg-2">
            {/* У 241 нет отбора по документам: вкладка проверки отбирает строки внутри чтения по 100 дел. */}
            {view === "all" ? null : <span>Проверены {params.cursor ? "следующие" : "первые"} {rows.length} дел в работе; числа вкладок — после полного чтения.</span>}
            {params.cursor ? <Link href={studentsQueueHref(params, { cursor: null })} className={QUEUE_QUIET_LINK}>К началу</Link> : null}
            {page.nextCursor ? (
              <Link href={studentsQueueHref(params, { cursor: page.nextCursor })} rel="next" className={QUEUE_QUIET_LINK}>
                {view === "all" ? `Следующие ${STUDENTS_DOCS_PAGE_SIZE}` : `Проверить следующие ${STUDENTS_DOCS_PAGE_SIZE}`}
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>,
    };
  }

  const curators = params.view === "curators";
  const head = <QueueHead>
    <StudentsTabs tabs={studentsQueueTabs(params, read.counts, admin)} />
    {curators ? null : toolbar}
    {curators ? null : countsNotice}
  </QueueHead>;
  if (curators) {
    return {
      count: null,
      content: <CuratorWorkloadView head={head} coverage={input.coverage ?? { kind: "hidden" }} today={input.today} requestId={input.requestIds.coverage} />,
    };
  }
  if (read.page === null) {
    return {
      count: read.counts?.total ?? null,
      content: <div className={DIRECTORY} data-testid="v3-student-case-directory">
        {head}
        <QueueError text="Не удалось загрузить список студентов." retryHref={here} />
      </div>,
    };
  }
  return {
    count: read.counts?.total ?? null,
    content: <StudentsQueueBody
      head={head}
      params={params}
      rows={read.page.rows}
      counts={read.counts}
      today={read.page.today}
      nextCursor={read.page.nextCursor}
      editor={input.editor}
      recordScopes={input.recordScopes}
      openTasks={input.openTasks}
      createTask={input.createTask}
      requestId={input.requestIds.nextStep}
    />,
  };
}
