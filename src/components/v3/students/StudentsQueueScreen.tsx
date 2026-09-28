import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import type { CaseClosure } from "@/lib/platform-closure-contract";
import type { ApplicationDocumentOwner } from "@/lib/portal/application-documents";
import type { StudentCaseQueueCounts, StudentCaseQueuePage } from "@/lib/platform-student-case-queue-contract";

import type { StudentsCoverage } from "../profile/students-coverage-view";
import { QueueEmpty, QueueError, QUEUE_QUIET_LINK } from "../queue/QueueStates";
import { QueueKeyboard } from "../queue/QueueKeyboard";
import { CuratorWorkloadView } from "./CuratorWorkloadView";
import { PackagesRecovery, ProgramDocsRecovery } from "./DocsQueueRecovery";
import { StudentsDocsTable } from "./StudentsDocsTable";
import { StudentsPackagesTable } from "./StudentsPackagesTable";
import { StudentsProgramDocsTable } from "./StudentsProgramDocsTable";
import { StudentsQueueBody } from "./StudentsQueueBody";
import { StudentsCountsUnavailable, StudentsFilterRejected, StudentsTabs, StudentsToolbar, type CuratorName } from "./StudentsQueueHead";
import {
  STUDENTS_DOCS_PAGE_SIZE,
  STUDENTS_DOCS_VIEW_LABELS,
  docsInitialView,
  docsNextNonEmpty,
  docsOldestFirst,
  docsReadable,
  docsRowMatches,
  docsTabCounts,
  type DocsPackagesRead,
  type DocsProgramRead,
  type DocsQueuesShown,
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
  /** EVO Docs: очередь документов программ (вкладка «Документы программ»); без неё — вкладки нет. */
  program?: DocsProgramRead;
  /**
   * EVO Docs: чей это браузер для решений в строке «Документов программ» и
   * восстановления незавершённых решений; `canReview` — `document.review` вне
   * просмотра роли.
   */
  documentReview?: Readonly<{ owner: ApplicationDocumentOwner; canReview: boolean }>;
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

type DocsNext = ReturnType<typeof docsNextNonEmpty>;

/**
 * Пусто в EVO Docs. «Нет» — только при полном чтении: вкладки дел отбирают
 * строки внутри прочитанных 100 дел, поэтому пустое неполное чтение говорит о
 * прочитанной части. Без права читать документы вкладки дел ничего не
 * отберут — это называется словами, а не «документов нет».
 */
function docsEmptyTitle(view: StudentsDocsView, filtered: boolean, complete: boolean, documents: boolean): string {
  if (view !== "all" && !documents) return "Нет доступа к документам дел — откройте «Все»";
  if (view !== "all" && !complete) return "В прочитанной части списка ничего не найдено";
  if (view === "review") return "Проверять нечего.";
  if (view === "fix") return "Исправлять нечего.";
  // Дела без чек-листа сюда не входят: «не хватает» считается только по местам чек-листа.
  if (view === "missing") return "Незагруженных документов по чек-листам нет.";
  return filtered ? "Ничего не найдено" : "Дел в работе нет";
}

/**
 * Пустая вкладка — одна строка: что пусто и, если есть, следующая непустая
 * вкладка ссылкой с её числом («Проверять нечего. Не хватает: 1 →»).
 */
function DocsEmpty({ title, next, href, divider = true }: Readonly<{
  title: string;
  next: DocsNext;
  href: (view: StudentsDocsView) => string;
  /** Вкладки очередей — без строки инструментов: над пустотой уже линия ряда вкладок. */
  divider?: boolean;
}>) {
  return <QueueEmpty inline divider={divider} title={title} action={next ? (
    <Link href={href(next.view)} scroll={false} className={QUEUE_QUIET_LINK}>
      <span>{next.label}: <span className="tabular-nums">{next.count}</span></span>
      <Icon name="arrow-right" size={16} className="shrink-0" />
    </Link>
  ) : null} />;
}

/** Строка под очередью, прочитанной не целиком: очередь длиннее, проверенные уходят — появятся следующие. */
function QueueRest({ shown, words }: Readonly<{ shown: number; words: readonly [string, string, string] }>) {
  return (
    <p role="status" className="t-body-compact text-fg-2">
      Показаны последние {shown} {russianPlural(shown, ...words)}: очередь длиннее. Проверенные уходят из очереди — после них здесь появятся следующие.
    </p>
  );
}

/**
 * Вкладки очередей документов — «Документы программ» и «Комплекты»: до 3
 * страниц по 20. Прочитано всё — число вкладки и «сначала дольше всех
 * ждущие»; осталось продолжение — числа нет, порядок сервера (новые сверху) и
 * строка об этом. Фильтры дел к очередям не относятся, поэтому строки
 * инструментов здесь нет.
 */
function ProgramView({ program, review, returnTo, today, empty }: Readonly<{
  program: DocsProgramRead;
  review: StudentsQueueScreenInput["documentReview"];
  returnTo: string;
  today: string;
  empty: ReactNode;
}>) {
  if (program.kind === "error") return <QueueError text="Не удалось загрузить документы программ на проверку." retryHref={returnTo} />;
  if (program.kind === "denied" || program.kind === "hidden" || !review) {
    return <QueueEmpty title="Очередь документов программ вашей учётной записи недоступна" />;
  }
  const { nextCursor } = program.queue;
  const { items, oldestFirst } = docsOldestFirst(program.queue.items, (item) => item.submission.submittedAt, (item) => item.submission.submissionId, nextCursor === null);
  return <>
    {/* Незавершённые решения по документам программ (прежняя очередь доски) — и при пустой очереди; решения по видимым строкам повторяет сама строка. */}
    <ProgramDocsRecovery owner={review.owner} visibleSubmissions={items.map((item) => item.submission.submissionId)} />
    {items.length === 0 ? empty : <>
      <p className="t-meta text-fg-2">Отправлены на проверку EVO, решения ещё нет. {oldestFirst ? "Порядок: сначала дольше всех ждущие" : "Порядок: сначала недавно отправленные — прочитана не вся очередь"}</p>
      <StudentsProgramDocsTable items={items} owner={review.owner} canReview={review.canReview} returnTo={returnTo} today={today}
        caption={nextCursor ? `Документы программ: последние ${items.length} отправленных` : `Документы программ: ${items.length}`} />
      {nextCursor ? <QueueRest shown={items.length} words={["документ", "документа", "документов"]} /> : null}
    </>}
  </>;
}

function PackagesView({ packages, owner, returnTo, today, empty }: Readonly<{
  packages: DocsPackagesRead;
  owner: ApplicationDocumentOwner | null;
  returnTo: string;
  today: string;
  empty: ReactNode;
}>) {
  if (packages.kind === "error") return <QueueError text="Не удалось загрузить комплекты на проверку." retryHref={returnTo} />;
  if (packages.kind === "denied" || packages.kind === "hidden") {
    return <QueueEmpty title="Очередь комплектов вашей учётной записи недоступна" />;
  }
  const { nextCursor } = packages.queue;
  const { items, oldestFirst } = docsOldestFirst(packages.queue.items, (item) => item.package.submittedAt, (item) => item.package.packageId, nextCursor === null);
  return <>
    {/* Незавершённые решения по комплектам (прежняя очередь доски) — и при пустой очереди. */}
    {owner ? <PackagesRecovery owner={owner} /> : null}
    {items.length === 0 ? empty : <>
      <StudentsPackagesTable items={items} returnTo={returnTo} today={today} oldestFirst={oldestFirst}
        caption={nextCursor ? `Комплекты: последние ${items.length} отправленных` : `Комплекты: ${items.length}`} />
      {nextCursor ? <QueueRest shown={items.length} words={["комплект", "комплекта", "комплектов"]} /> : null}
    </>}
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
 * Возвращает число для заголовка (только при прочитанных числах; у EVO Docs
 * числа у заголовка нет — числа на вкладках) и тело.
 */
export function buildStudentsQueueScreen(input: StudentsQueueScreenInput): Readonly<{ count: number | null; content: ReactNode }> {
  const { read } = input;
  const docs = input.params.mode === "docs";
  const shown: DocsQueuesShown = {
    program: (input.program?.kind ?? "hidden") !== "hidden",
    packages: (input.packages?.kind ?? "hidden") !== "hidden",
  };
  if (input.invalid) {
    const params = input.params;
    const tabs = docs
      ? studentsDocsTabs(params, { review: null, program: null, packages: null, fix: null, missing: null, all: null }, shown)
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
    const params = input.params;
    const coverageHref = !docs && input.actor.coverage ? studentsListHref(params, { view: "curators" }) : null;
    return { count: null, content: <div className={DIRECTORY} data-testid="v3-student-case-directory"><QueueForbidden docs={docs} coverageHref={coverageHref} /></div> };
  }
  // EVO Docs: числа вкладок — из всех чтений сразу; без `view` в адресе и без фильтров открывается первая непустая вкладка.
  const page = read.page;
  const rows = page?.rows ?? [];
  const complete = page !== null && input.params.cursor === null && page.nextCursor === null;
  const packages = input.packages ?? { kind: "hidden" };
  const program = input.program ?? { kind: "hidden" };
  const tabCounts = docs ? docsTabCounts(rows, complete, read.counts, packages, program) : null;
  const params = tabCounts && input.params.autoView
    ? { ...input.params, view: docsInitialView(input.params, tabCounts, shown), autoView: false }
    : input.params;
  const here = studentsQueueHref(params);
  // «x» в окне «?» — у кого есть массовые действия (Э7): назначать кураторов или править шаг.
  const selectKey = !docs && !input.editor.preview && (input.actor.coverage || input.editor.admin || input.editor.routeManage);
  const toolbar = <StudentsToolbar params={params} counts={read.counts} curatorFilter={input.actor.coverage} curatorNames={input.curatorNames} selectKey={selectKey} />;
  // Список не прочитан — заметка «список работает» была бы неправдой.
  const countsNotice = read.counts || read.page === null ? null : <StudentsCountsUnavailable retryHref={here} />;

  if (tabCounts) {
    const documents = docsReadable(rows);
    const view = params.view as StudentsDocsView;
    const tabs = <StudentsTabs tabs={studentsDocsTabs(params, tabCounts, shown)} />;
    const next = docsNextNonEmpty(view, tabCounts, shown);
    const tabHref = (target: StudentsDocsView) => studentsListHref(params, { view: target });
    // Числа — на вкладках; у заголовка страницы числа нет (Э8.5).
    if (view === "program" || view === "packages") {
      const empty = <DocsEmpty title="Проверять нечего." next={next} href={tabHref} divider={false} />;
      return {
        count: null,
        content: <div className={DIRECTORY} data-testid="v3-student-case-directory">
          <QueueKeyboard />
          <QueueHead>{tabs}</QueueHead>
          {view === "program"
            ? <ProgramView program={program} review={input.documentReview} returnTo={here} today={input.today} empty={empty} />
            : <PackagesView packages={packages} owner={input.documentReview?.owner ?? null} returnTo={here} today={input.today} empty={empty} />}
        </div>,
      };
    }
    const matching = rows.filter((row) => docsRowMatches(view, row));
    // «Документы дела»: при полном чтении — сначала дольше всех ждущие проверки (252).
    const ordered = view === "review"
      ? docsOldestFirst(matching, (row) => row.documents?.oldestSubmittedAt, (row) => row.studentCaseId, complete)
      : { items: matching, oldestFirst: false };
    const order = ordered.oldestFirst ? "oldest" as const : view === "review" && !complete ? "partial" as const : "updated" as const;
    const filtered = Boolean(params.query || params.direction || params.curator);
    const emptyTitle = docsEmptyTitle(view, filtered, complete, documents);
    // Ссылка на следующую непустую — только у настоящей пустоты полного чтения;
    // с поиском или фильтром — только вкладки дел: очереди программ и комплектов они не сужают.
    const emptyNext = view !== "all" && documents && complete
      ? filtered ? docsNextNonEmpty(view, tabCounts, { program: false, packages: false }) : next
      : null;
    return {
      count: null,
      content: <div className={DIRECTORY} data-testid="v3-student-case-directory">
        <QueueKeyboard />
        <QueueHead>
          {tabs}
          {toolbar}
          {countsNotice}
        </QueueHead>
        {page === null ? <QueueError text="Не удалось загрузить дела для EVO Docs." retryHref={here} />
          : ordered.items.length === 0 ? <DocsEmpty title={emptyTitle} next={emptyNext} href={tabHref} />
          : <StudentsDocsTable rows={ordered.items} view={view} caption={`${STUDENTS_DOCS_VIEW_LABELS[view]}: ${ordered.items.length} из прочитанных дел`}
            returnTo={here} today={input.today} order={order} />}
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
