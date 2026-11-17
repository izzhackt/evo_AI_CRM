import Link from "next/link";
import type { ReactNode } from "react";

import type { CaseClosure } from "@/lib/platform-closure-contract";
import type { StudentCaseQueueCounts, StudentCaseQueuePage } from "@/lib/platform-student-case-queue-contract";

import type { StudentsCoverage } from "../profile/students-coverage-view";
import { QueueError, QUEUE_QUIET_LINK } from "../queue/QueueStates";
import { CuratorWorkloadView } from "./CuratorWorkloadView";
import { StudentsQueueBody } from "./StudentsQueueBody";
import { StudentsCountsUnavailable, StudentsFilterRejected, StudentsTabs, StudentsToolbar, type CuratorName } from "./StudentsQueueHead";
import {
  studentsListHref,
  studentsQueueHref,
  studentsQueueTabs,
  type NextStepAccessInput,
  type StudentsHandoff,
  type StudentsOpenTasks,
  type StudentsQueueActor,
  type StudentsQueueParams,
} from "./students-queue-view";

export type StudentsQueueScreenInput = Readonly<{
  params: StudentsQueueParams;
  /** Адрес не разобран: только вкладки и «Не удалось применить фильтры». */
  invalid: boolean;
  /** `forbidden` — сервер отказал в чтении очереди: повтор не поможет, «Повторить» нет. */
  read: Readonly<{ page: StudentCaseQueuePage | null; counts: StudentCaseQueueCounts | null; forbidden?: boolean }>;
  actor: StudentsQueueActor;
  openTasks: StudentsOpenTasks | null;
  /** «Приём дела» открытой строки (только куратору, который может ответить). */
  handoff?: StudentsHandoff | null;
  /** Закрытие открытой строки (246): «Завершить дело» и строка закрытого дела. */
  closure?: CaseClosure | null;
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

/**
 * Сервер не пускает к очереди: повтор не поможет, поэтому без «Повторить».
 * Отказ 241 — прежняя грубая роль учётной записи, её не меняют в
 * «Сотрудниках», поэтому туда не отправляем. «Нагрузка кураторов» читается
 * без 241 и остаётся тем, у кого есть право назначать кураторов.
 */
function QueueForbidden({ coverageHref }: Readonly<{ coverageHref: string | null }>) {
  return (
    <div role="alert" data-testid="queue-forbidden" className="flex flex-col items-start gap-1 border-y border-border py-8">
      <p className="t-item text-danger">Список студентов для вашей учётной записи недоступен.</p>
      <p className="t-body-compact text-fg-2">Обратитесь к администратору: повторная попытка не поможет.</p>
      {coverageHref ? <Link href={coverageHref} className={QUEUE_QUIET_LINK}>Открыть «Нагрузку кураторов»</Link> : null}
    </div>
  );
}

/**
 * Экран «Студентов» из уже прочитанных данных: вкладки видов, строка
 * инструментов, тело и панель. Чистая сборка без запросов — её вызывает
 * страница после чтений и статический рендер с синтетикой. Возвращает число
 * для заголовка (у «Студентов» его нет — числа на вкладках) и тело.
 */
export function buildStudentsQueueScreen(input: StudentsQueueScreenInput): Readonly<{ count: number | null; content: ReactNode }> {
  const { read, params } = input;
  if (input.invalid) {
    return {
      count: null,
      content: <div className={DIRECTORY} data-testid="v3-student-case-directory">
        <QueueHead><StudentsTabs tabs={studentsQueueTabs(params, null, input.actor)} /></QueueHead>
        <StudentsFilterRejected resetHref={studentsQueueHref(params)} />
      </div>,
    };
  }
  // Сервер не пускает к очереди: вкладки и фильтры ничего не откроют — только честный отказ.
  if (read.forbidden) {
    const coverageHref = input.actor.coverage ? studentsListHref(params, { view: "curators" }) : null;
    return { count: null, content: <div className={DIRECTORY} data-testid="v3-student-case-directory"><QueueForbidden coverageHref={coverageHref} /></div> };
  }
  const here = studentsQueueHref(params);
  // «x» в окне «?» — у кого есть массовые действия (Э7): назначать кураторов или править шаг.
  const selectKey = !input.editor.preview && (input.actor.coverage || input.editor.admin || input.editor.routeManage);
  const toolbar = <StudentsToolbar params={params} counts={read.counts} curatorFilter={input.actor.coverage} curatorNames={input.curatorNames} selectKey={selectKey} />;
  // Список не прочитан — заметка «список работает» была бы неправдой.
  const countsNotice = read.counts || read.page === null ? null : <StudentsCountsUnavailable retryHref={here} />;

  const curators = params.view === "curators";
  const head = <QueueHead>
    <StudentsTabs tabs={studentsQueueTabs(params, read.counts, input.actor)} />
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
      count: null,
      content: <div className={DIRECTORY} data-testid="v3-student-case-directory">
        {head}
        <QueueError text="Не удалось загрузить список студентов." retryHref={here} />
      </div>,
    };
  }
  return {
    // Число списка стоит на выбранной вкладке: у заголовка оно только повторяло бы его.
    count: null,
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
      handoff={input.handoff ?? null}
      closure={input.closure ?? null}
      createTask={input.createTask}
      requestId={input.requestIds.nextStep}
      // «Назначить куратора» выбранным (Э7) — тому, кто назначает кураторов; список — то же чтение, что у фильтра «Куратор».
      curators={input.actor.coverage ? input.curatorNames : null}
    />,
  };
}
