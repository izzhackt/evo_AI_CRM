import Link from "next/link";
import type { ReactNode } from "react";

import type { CaseClosure } from "@/lib/platform-closure-contract";
import type { StudentCaseQueueCounts, StudentCaseQueuePage } from "@/lib/platform-student-case-queue-contract";

import type { StudentsCoverage } from "../profile/students-coverage-view";
import { QueueEmpty, QueueError, QUEUE_QUIET_LINK } from "../queue/QueueStates";
import { QueueKeyboard } from "../queue/QueueKeyboard";
import { CuratorWorkloadView } from "./CuratorWorkloadView";
import { StudentsDocsTable } from "./StudentsDocsTable";
import { StudentsPackagesTable } from "./StudentsPackagesTable";
import { StudentsQueueBody } from "./StudentsQueueBody";
import { StudentsCountsUnavailable, StudentsFilterRejected, StudentsTabs, StudentsToolbar, type CuratorName } from "./StudentsQueueHead";
import {
  STUDENTS_DOCS_PAGE_SIZE,
  STUDENTS_DOCS_VIEW_LABELS,
  docsReadable,
  docsRowMatches,
  docsTabCounts,
  type DocsPackagesRead,
  russianPlural,
  studentsDocsTabs,
  studentsListHref,
  studentsQueueHref,
  studentsQueueTabs,
  type NextStepAccessInput,
  type StudentsDocsView,
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
  /** EVO Docs: очередь «Комплекты на проверку» (вкладка «Комплекты»); без неё — вкладки нет. */
  packages?: DocsPackagesRead;
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
 * Пусто в EVO Docs. «Нет» — только при полном чтении: вкладки проверки
 * отбирают строки внутри прочитанных 100 дел, поэтому пустое неполное чтение
 * говорит о прочитанной части. Без права читать документы вкладки проверки
 * ничего не отберут — это называется словами, а не «документов нет».
 */
function docsEmptyTitle(view: StudentsDocsView, filtered: boolean, complete: boolean, documents: boolean): string {
  if (view !== "all" && !documents) return "Нет доступа к документам дел — откройте «Все»";
  if (view !== "all" && !complete) return "В прочитанной части списка ничего не найдено";
  if (view === "review") return "Документов на проверку нет";
  if (view === "fix") return "Документов на исправление нет";
  // Дела без чек-листа сюда не входят: «не хватает» считается только по местам чек-листа.
  if (view === "missing") return "Незагруженных документов по чек-листам нет";
  return filtered ? "Ничего не найдено" : "Дел в работе нет";
}

/** Вся очередь «Комплекты на проверку» — на доске поступления (там же «Показать ещё» и проверка). */
const PACKAGES_QUEUE_HREF = "/v3/admissions-pipeline?view=packages";

/**
 * Вкладка «Комплекты»: строки очереди «Комплекты на проверку» — до 3
 * страниц по 20 комплектов. Осталось продолжение — числа нет, и строка
 * называет, где вся очередь. Фильтры дел к комплектам не относятся, поэтому
 * строки инструментов здесь нет.
 */
function PackagesView({ packages, returnTo, today }: Readonly<{ packages: DocsPackagesRead; returnTo: string; today: string }>) {
  if (packages.kind === "error") return <QueueError text="Не удалось загрузить комплекты на проверку." retryHref={returnTo} />;
  if (packages.kind === "denied" || packages.kind === "hidden") {
    return <QueueEmpty title="Очередь комплектов вашей учётной записи недоступна" />;
  }
  const { items, nextCursor } = packages.queue;
  if (items.length === 0) return <QueueEmpty title="Комплектов на проверку нет" />;
  return <>
    <StudentsPackagesTable items={items} returnTo={returnTo} today={today}
      caption={nextCursor ? `Комплекты: последние ${items.length} отправленных` : `Комплекты: ${items.length}`} />
    {nextCursor ? (
      <p role="status" className="flex flex-wrap items-center gap-x-4 t-body-compact text-fg-2">
        <span>Показаны последние {items.length} {russianPlural(items.length, "комплект", "комплекта", "комплектов")}; вся очередь — на доске поступления.</span>
        <Link href={PACKAGES_QUEUE_HREF} className={QUEUE_QUIET_LINK}>Все комплекты на проверку</Link>
      </p>
    ) : null}
  </>;
}

/**
 * Сервер не пускает к очереди: повтор не поможет, поэтому без «Повторить».
 * Отказ 241 — прежняя грубая роль учётной записи, её не меняют в
 * «Сотрудниках», поэтому туда не отправляем. «Нагрузка кураторов» читается
 * без 241 и остаётся тем, у кого есть право назначать кураторов.
 */
function QueueForbidden({ docs, coverageHref }: Readonly<{ docs: boolean; coverageHref: string | null }>) {
  return (
    <div role="alert" data-testid="queue-forbidden" className="flex flex-col items-start gap-1 border-y border-border py-8">
      <p className="t-item text-danger">{docs ? "Очередь EVO Docs для вашей учётной записи недоступна." : "Список студентов для вашей учётной записи недоступен."}</p>
      <p className="t-body-compact text-fg-2">Обратитесь к администратору: повторная попытка не поможет.</p>
      {coverageHref ? <Link href={coverageHref} className={QUEUE_QUIET_LINK}>Открыть «Нагрузку кураторов»</Link> : null}
    </div>
  );
}

/**
 * Экран «Студентов» и EVO Docs из уже прочитанных данных: вкладки видов,
 * строка инструментов, тело и панель. Чистая сборка без запросов — её
 * вызывает страница после чтений и статический рендер с синтетикой.
 * Возвращает число для заголовка (только при прочитанных числах) и тело.
 */
export function buildStudentsQueueScreen(input: StudentsQueueScreenInput): Readonly<{ count: number | null; content: ReactNode }> {
  const { params, read } = input;
  const docs = params.mode === "docs";
  if (input.invalid) {
    const tabs = docs
      ? studentsDocsTabs(params, { review: null, fix: null, missing: null, packages: null, all: null }, { packages: (input.packages?.kind ?? "hidden") !== "hidden" })
      : studentsQueueTabs(params, null, input.actor);
    return {
      count: null,
      content: <div className={DIRECTORY} data-testid="v3-student-case-directory">
        <QueueHead><StudentsTabs tabs={tabs} /></QueueHead>
        <StudentsFilterRejected resetHref={studentsQueueHref(params)} />
      </div>,
    };
  }
  // Сервер не пускает к очереди: вкладки и фильтры ничего не откроют — только честный отказ.
  if (read.forbidden) {
    const coverageHref = !docs && input.actor.coverage ? studentsListHref(params, { view: "curators" }) : null;
    return { count: null, content: <div className={DIRECTORY} data-testid="v3-student-case-directory"><QueueForbidden docs={docs} coverageHref={coverageHref} /></div> };
  }
  const here = studentsQueueHref(params);
  // «x» в окне «?» — у кого есть массовые действия (Э7): назначать кураторов или править шаг.
  const selectKey = !docs && !input.editor.preview && (input.actor.coverage || input.editor.admin || input.editor.routeManage);
  const toolbar = <StudentsToolbar params={params} counts={read.counts} curatorFilter={input.actor.coverage} curatorNames={input.curatorNames} selectKey={selectKey} />;
  // Список не прочитан — заметка «список работает» была бы неправдой.
  const countsNotice = read.counts || read.page === null ? null : <StudentsCountsUnavailable retryHref={here} />;

  if (docs) {
    const page = read.page;
    const rows = page?.rows ?? [];
    const complete = page !== null && params.cursor === null && page.nextCursor === null;
    const documents = docsReadable(rows);
    const packages = input.packages ?? { kind: "hidden" };
    const tabCounts = docsTabCounts(rows, complete, read.counts, packages);
    const view = params.view as StudentsDocsView;
    const tabs = <StudentsTabs tabs={studentsDocsTabs(params, tabCounts, { packages: packages.kind !== "hidden" })} />;
    if (view === "packages") {
      return {
        count: tabCounts.packages,
        content: <div className={DIRECTORY} data-testid="v3-student-case-directory">
          <QueueKeyboard />
          <QueueHead>{tabs}</QueueHead>
          <PackagesView packages={packages} returnTo={here} today={input.today} />
        </div>,
      };
    }
    const shown = rows.filter((row) => docsRowMatches(view, row));
    const filtered = Boolean(params.query || params.direction || params.curator);
    return {
      count: tabCounts[view],
      content: <div className={DIRECTORY} data-testid="v3-student-case-directory">
        <QueueKeyboard />
        <QueueHead>
          {tabs}
          {toolbar}
          {countsNotice}
        </QueueHead>
        {page === null ? <QueueError text="Не удалось загрузить дела для EVO Docs." retryHref={here} />
          : shown.length === 0 ? <QueueEmpty title={docsEmptyTitle(view, filtered, complete, documents)} />
          : <StudentsDocsTable rows={shown} view={view} caption={`${STUDENTS_DOCS_VIEW_LABELS[view]}: ${shown.length} из прочитанных дел`} returnTo={here} />}
        {page && (params.cursor || page.nextCursor) ? (
          <p role="status" className="flex flex-wrap items-center gap-x-4 t-body-compact text-fg-2">
            {/* У 241 нет отбора по документам: вкладка проверки отбирает строки внутри чтения по 100 дел. */}
            {view === "all" ? null : <span>Проверены {params.cursor ? "следующие" : "первые"} {rows.length} {russianPlural(rows.length, "дело", "дела", "дел")} в работе; числа вкладок — после полного чтения.</span>}
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
      handoff={input.handoff ?? null}
      closure={input.closure ?? null}
      createTask={input.createTask}
      requestId={input.requestIds.nextStep}
      // «Назначить куратора» выбранным (Э7) — тому, кто назначает кураторов; список — то же чтение, что у фильтра «Куратор».
      curators={input.actor.coverage ? input.curatorNames : null}
    />,
  };
}
