import Link from "next/link";

import { Icon } from "@/components/icons";
import type { StudentCaseQueueRow, StudentCaseQueueSort } from "@/lib/platform-student-case-queue-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

import { DIRECTION_LABELS } from "../profile/admissions-view";
import { queueDue } from "../queue/due-bucket";
import { shortPersonName } from "../queue/person-name";
import { studentsRowSignals, studentsUpdatedDay, type StudentsBand, type StudentsSignal } from "./students-queue-view";

/*
 * Три раскладки строки по ширине своего контейнера (`@container/students`):
 * от 60rem — таблица в одну строку (Студент 19 · Шаг 24 · Срок 9 · Этап 13 ·
 * Куратор 13 · Сигналы 22 · ссылка на дело 44 px; в «Мои» колонки «Куратор»
 * нет — её ширина у шага и сигналов); 36–60rem (рядом открыта панель, узкий
 * ноутбук) — имя и «направление · уровень · этап», под ними шаг одной
 * строкой, под шагом — сигналы (и под сроком: он занимает две строки);
 * срок и куратор — колонками справа; уже —
 * стопка телефона: имя, шаг со сроком справа, куратор, сигналы. Роли таблицы
 * заданы явно: смена display иначе стирает её семантику в части браузеров.
 * Этап в узких раскладках продолжает строку «направление · уровень», а его
 * ячейка остаётся для читалки. Сигналы — короткий словарь: не обрезаются
 * никогда, перенос только между сигналами.
 */
const WIDE_COLUMNS = "@min-[60rem]/students:grid-cols-[minmax(0,19fr)_minmax(0,24fr)_minmax(0,9fr)_minmax(0,13fr)_minmax(0,13fr)_minmax(0,22fr)_2.75rem] @min-[60rem]/students:[grid-template-areas:'student_step_due_stage_curator_signals_link']";
const WIDE_COLUMNS_MINE = "@min-[60rem]/students:grid-cols-[minmax(0,20fr)_minmax(0,30fr)_minmax(0,9fr)_minmax(0,14fr)_minmax(0,27fr)_2.75rem] @min-[60rem]/students:[grid-template-areas:'student_step_due_stage_signals_link']";
const MID_COLUMNS = "@min-[36rem]/students:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,11rem)_2.75rem]";
const MID_COLUMNS_MINE = "@min-[36rem]/students:grid-cols-[minmax(0,1fr)_6.5rem_2.75rem]";
const PHONE = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 [grid-template-areas:'student_student'_'step_due'_'curator_curator'_'signals_signals']";
const ROW_GRID = `${PHONE} ${MID_COLUMNS} @min-[36rem]/students:[grid-template-areas:'student_due_curator_link'_'step_due_curator_link'_'signals_signals_curator_link'] ${WIDE_COLUMNS}`;
const ROW_GRID_MINE = `${PHONE} ${MID_COLUMNS_MINE} @min-[36rem]/students:[grid-template-areas:'student_due_link'_'step_due_link'_'signals_signals_link'] ${WIDE_COLUMNS_MINE}`;
/**
 * Шапка колонок — те же дорожки и зазоры, что у строк, и видна от 30rem (и
 * рядом с панелью на 1280): открытая панель не сдвигает первую строку. Уже
 * 60rem шаг, этап и сигналы стоят в колонке студента, уже 36rem — и куратор:
 * их заголовки остаются для читалки. В стопке «Срок» — справа, над сроком.
 */
const HEAD_GRID = `grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 ${MID_COLUMNS} ${WIDE_COLUMNS}`;
const HEAD_GRID_MINE = `grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 ${MID_COLUMNS_MINE} ${WIDE_COLUMNS_MINE}`;
function headClass(label: string): string {
  if (label === "Следующий шаг" || label === "Этап" || label === "Сигналы") return `${HEAD} @max-[60rem]/students:sr-only`;
  if (label === "Срок") return `${HEAD} @max-[36rem]/students:justify-end @max-[36rem]/students:px-3`;
  if (label === "Куратор" || label === "Дело") return `${HEAD} @max-[36rem]/students:sr-only`;
  return HEAD;
}
/** Ячейка: от 60rem у каждой 4 px сверху и снизу — строка с шагом в одну строку занимает 44 px. */
const CELL = "min-w-0 px-3 @min-[36rem]/students:px-2 @min-[60rem]/students:py-1";
const HEAD = "flex h-8 items-center px-2 text-start t-caption text-fg-2 first:ps-3";
/** Даты строки — срок шага и день обновления — JetBrains Mono с табличными цифрами. */
const DATE = "font-mono tabular-nums";
const TONE: Readonly<Record<StudentsSignal["tone"], string>> = {
  danger: "text-danger",
  warn: "text-warn",
  muted: "text-fg-2",
};

export type StudentsRowLinks = Readonly<{
  /** Та же очередь с открытой строкой (`?open=`). */
  open: string;
  /** Student 360 на «Обзоре» с возвратом в эту очередь. */
  case: string;
}>;

export function studentsRowMeta(row: Pick<StudentCaseQueueRow, "admissionsDirection" | "targetCountry" | "targetDegree">): string {
  const direction = row.admissionsDirection ? DIRECTION_LABELS[row.admissionsDirection] : row.targetCountry ?? "не указано";
  return [direction, row.targetDegree].filter(Boolean).join(" · ");
}

/**
 * «Срок»: дата шага и слово. При сортировке по обновлению второе место
 * занимает день изменения дела («обн. 22.09») — строки стоят по нему, и он
 * должен быть виден; просроченный шаг тогда назван в сигналах.
 */
function DueCell({ row, now, today, sort }: Readonly<{ row: StudentCaseQueueRow; now: Date; today: string; sort: StudentCaseQueueSort }>) {
  const due = row.nextAction && row.nextActionDueOn ? queueDue({ dueOn: row.nextActionDueOn, dueAt: null }, now, row.state !== "closed") : null;
  const updated = sort === "updated" ? studentsUpdatedDay(row.updatedAt, today) : null;
  const word = updated ? null : due?.word ?? due?.caption ?? null;
  return (
    <td role="cell" className={`${CELL} [grid-area:due] self-start text-end t-body-compact @min-[36rem]/students:text-start`}>
      {due ? <>
        <time dateTime={due.dateTime} className={`${DATE} @min-[36rem]/students:block @min-[36rem]/students:leading-5 ${due.overdue ? "text-danger" : "text-fg"}`}>{due.text}</time>
        {word ? <span className={`ms-1.5 t-meta @min-[36rem]/students:ms-0 @min-[36rem]/students:block ${due.overdue ? "text-danger" : "text-fg-3"}`}>{word}</span> : null}
      </> : row.nextAction ? <span className="t-meta text-fg-3 @min-[36rem]/students:block @min-[36rem]/students:leading-5">без срока</span>
        : <span className="sr-only">Нет</span>}
      {updated ? (
        <span className="ms-1.5 t-meta text-fg-3 @min-[36rem]/students:ms-0 @min-[36rem]/students:block">
          обн. <time dateTime={updated.dateTime} className={DATE}>{updated.text}</time>
        </span>
      ) : null}
    </td>
  );
}

function CuratorCell({ row }: Readonly<{ row: StudentCaseQueueRow }>) {
  const awaiting = row.attentionFlags.includes("awaiting_ack");
  const needsCurator = row.attentionFlags.includes("needs_curator");
  // Своё дело — «Вы». В узкой колонке — «Имя Ф.», полное имя — в подсказке и в панели.
  const full = row.currentCuratorDisplayName ?? "Куратор без имени";
  const quietOnPhone = row.isMine && !awaiting;
  return (
    <td role="cell" className={`${CELL} [grid-area:curator] self-start t-body-compact ${quietOnPhone ? "@max-[36rem]/students:sr-only" : ""}`}>
      <span className="@min-[36rem]/students:hidden text-fg-2">Куратор: </span>
      {row.currentCuratorMembershipId ? (
        <span className="text-fg @min-[36rem]/students:block @min-[36rem]/students:truncate" title={full}>
          {row.isMine ? "Вы" : <>
            <span aria-hidden="true" className="@max-[36rem]/students:hidden">{shortPersonName(full)}</span>
            <span className="@min-[36rem]/students:sr-only">{full}</span>
          </>}
        </span>
      ) : needsCurator ? <span className="font-medium text-danger">нужен куратор</span>
        : <span className="text-fg-3">не назначен</span>}
      {awaiting ? <>
        <span aria-hidden="true" className="@min-[36rem]/students:hidden"> · </span>
        <span className="font-medium text-warn @min-[36rem]/students:block">ждёт принятия</span>
      </> : null}
    </td>
  );
}

function SignalsCell({ signals }: Readonly<{ signals: readonly StudentsSignal[] }>) {
  return (
    <td role="cell" className={`${CELL} [grid-area:signals] self-start t-body-compact @min-[36rem]/students:ps-3 @min-[60rem]/students:ps-2 ${signals.length ? "" : "@max-[60rem]/students:sr-only"}`}>
      {signals.length ? signals.map((signal, index) => (
        // Сигнал переносится целиком (inline-block): строка рвётся между сигналами, не внутри.
        <span key={signal.key}>
          {index > 0 ? <span className="text-fg-3"> · </span> : null}
          <span className={`inline-block max-w-full font-medium ${TONE[signal.tone]}`}>{signal.text}</span>
        </span>
      )) : <span className="sr-only">Нет</span>}
    </td>
  );
}

export function StudentsQueueRow({
  row,
  now,
  today,
  sort,
  curatorColumn,
  selected,
  links,
}: Readonly<{
  row: StudentCaseQueueRow;
  /** Полдень сегодняшнего дня Бишкека из чтения 241 (`bishkekNoon`). */
  now: Date;
  /** Сегодня в Бишкеке из чтения 241. */
  today: string;
  sort: StudentCaseQueueSort;
  /** false — вид «Мои»: колонки «Куратор» нет, её исключения — в сигналах. */
  curatorColumn: boolean;
  selected: boolean;
  links: StudentsRowLinks;
}>) {
  const meta = studentsRowMeta(row);
  // Неизвестный этап не показывается ключом базы (CLAUDE.md): слова нет — ячейка пустая.
  const stage = admissionsPipelineStage(row.pipelineStage);
  const signals = studentsRowSignals(row, { curatorWords: !curatorColumn, overdueStep: sort === "updated" });
  return (
    <tr
      role="row"
      data-queue-row={row.studentCaseId}
      data-testid="v3-student-case-row"
      data-access="full"
      data-student-case-id={row.studentCaseId}
      data-band={row.dueBand}
      className={`v3-queue-row relative ${curatorColumn ? ROW_GRID : ROW_GRID_MINE} scroll-mt-9 py-2 shadow-[inset_0_-1px_0_var(--border)] @min-[30rem]/students:scroll-mt-[4.25rem] @min-[36rem]/students:py-1.5 @min-[60rem]/students:py-0 ${selected ? "bg-surface-2" : "hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface"}`}
    >
      <th role="rowheader" scope="row" className={`${CELL} [grid-area:student] text-start font-normal @min-[36rem]/students:ps-3`}>
        {/* Вся строка открывает «Быстрый просмотр»: ссылка — имя, её область — строка. */}
        <Link
          href={links.open}
          scroll={false}
          data-queue-open=""
          aria-current={selected ? "true" : undefined}
          title={row.studentDisplayName}
          className="block truncate t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline"
        >
          {row.studentDisplayName}
        </Link>
        <span className="block truncate t-meta text-fg-2" title={meta}>
          {meta}
          {stage ? <span aria-hidden="true" className="@min-[60rem]/students:hidden"> · {stage}</span> : null}
        </span>
      </th>
      <td role="cell" className={`${CELL} [grid-area:step] t-body-compact @min-[36rem]/students:ps-3 @min-[60rem]/students:ps-2`}>
        {row.nextAction
          ? <span className="line-clamp-2 break-words text-fg @min-[36rem]/students:line-clamp-1 @min-[60rem]/students:line-clamp-2" title={row.nextAction}>{row.nextAction}</span>
          : <span className="text-fg-3">Шаг не задан</span>}
      </td>
      <DueCell row={row} now={now} today={today} sort={sort} />
      <td role="cell" className={`${CELL} t-body-compact text-fg sr-only @min-[60rem]/students:not-sr-only @min-[60rem]/students:[grid-area:stage]`}>
        {stage}
      </td>
      {curatorColumn ? <CuratorCell row={row} /> : null}
      <SignalsCell signals={signals} />
      <td role="cell" className="hidden [grid-area:link] @min-[36rem]/students:flex @min-[36rem]/students:items-center @min-[36rem]/students:justify-center">
        <Link
          href={links.case}
          data-queue-full=""
          aria-label={`Открыть дело: ${row.studentDisplayName}`}
          title="Открыть дело"
          className="relative z-10 grid size-11 place-items-center rounded-nav text-fg-3 hover:bg-surface-2 hover:text-fg"
        >
          <Icon name="arrow-right" size={18} />
        </Link>
      </td>
    </tr>
  );
}

/**
 * Тело очереди «Студентов»: одна семантическая таблица, шапка колонок и
 * липкие заголовки групп по сроку на волосяных линиях, без карточек.
 * Заголовок группы непрозрачен во всю высоту, волосяная линия — его
 * собственная граница: строка, уходящая под него, не просвечивает.
 */
export function StudentsQueueTable({
  bands,
  caption,
  hint,
  now,
  today,
  sort,
  curatorColumn,
  selectedKey,
  links,
}: Readonly<{
  bands: readonly StudentsBand<StudentCaseQueueRow>[];
  caption: string;
  /** Подсказка у группы «Без следующего шага» (добавить шаг может редактор). */
  hint: string | null;
  now: Date;
  today: string;
  sort: StudentCaseQueueSort;
  /** false — вид «Мои»: в каждой строке было бы «Вы». */
  curatorColumn: boolean;
  selectedKey: string | null;
  links: (row: StudentCaseQueueRow) => StudentsRowLinks;
}>) {
  const columns = curatorColumn
    ? (["Студент", "Следующий шаг", "Срок", "Этап", "Куратор", "Сигналы"] as const)
    : (["Студент", "Следующий шаг", "Срок", "Этап", "Сигналы"] as const);
  return (
    <table role="table" className="block w-full" data-testid="v3-student-case-table">
      <caption className="sr-only">{caption}</caption>
      <thead role="rowgroup" className="sr-only @min-[30rem]/students:not-sr-only @min-[30rem]/students:sticky @min-[30rem]/students:top-0 @min-[30rem]/students:z-30 @min-[30rem]/students:block @min-[30rem]/students:bg-bg">
        <tr role="row" className={`${curatorColumn ? HEAD_GRID : HEAD_GRID_MINE} shadow-[inset_0_-1px_0_var(--border)]`}>
          {columns.map((label) => (
            <th key={label} role="columnheader" scope="col" className={headClass(label)}>{label}</th>
          ))}
          <th role="columnheader" scope="col" className={headClass("Дело")}><span className="sr-only">Дело</span></th>
        </tr>
      </thead>
      {bands.map((band) => {
        const headingId = `students-band-${band.key}`;
        return (
          <tbody key={band.key} role="rowgroup" aria-labelledby={band.label ? headingId : undefined} className="block">
            {band.label ? (
              <tr role="row" className="v3-sticky-band sticky top-0 z-20 block bg-bg @min-[30rem]/students:top-8">
                <th role="rowheader" scope="rowgroup" colSpan={7} id={headingId} className="flex flex-wrap items-baseline gap-x-1.5 border-b border-border bg-bg py-1.5 ps-3 text-start t-item">
                  <span className={band.tone === "danger" ? "text-danger" : band.tone === "warn" ? "text-warn" : "text-fg"}>{band.label}</span>
                  {band.count !== null ? <span className="font-normal tabular-nums text-fg-3">· {band.count}</span> : null}
                  {band.key === "no_step" && hint ? <span className="t-meta font-normal text-fg-2">— {hint}</span> : null}
                </th>
              </tr>
            ) : null}
            {band.rows.map((row) => (
              <StudentsQueueRow
                key={row.studentCaseId}
                row={row}
                now={now}
                today={today}
                sort={sort}
                curatorColumn={curatorColumn}
                selected={row.studentCaseId === selectedKey}
                links={links(row)}
              />
            ))}
          </tbody>
        );
      })}
    </table>
  );
}
