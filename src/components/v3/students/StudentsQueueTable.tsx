import Link from "next/link";

import { Icon } from "@/components/icons";
import type { StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

import { DIRECTION_LABELS } from "../profile/admissions-view";
import { queueDue } from "../queue/due-bucket";
import { shortPersonName } from "../queue/person-name";
import { studentsRowSignals, type StudentsBand, type StudentsSignal } from "./students-queue-view";

/*
 * Три раскладки строки по ширине своего контейнера (`@container/students`):
 * от 60rem — таблица в одну строку (Студент 19 · Шаг 25 · Срок 9 · Этап 14 ·
 * Куратор 14 · Сигналы 19 · ссылка на дело 44 px); 36–60rem (рядом открыта
 * панель, узкий ноутбук) — имя и «направление · уровень · этап», под ними шаг
 * одной строкой; срок, куратор и сигналы справа — по одной строке; уже —
 * стопка телефона: имя, шаг со сроком справа, куратор, сигналы. Роли таблицы
 * заданы явно: смена display иначе стирает её семантику в части браузеров. Этап в узких раскладках продолжает строку
 * «направление · уровень», а его ячейка остаётся для читалки.
 */
const WIDE_COLUMNS = "@min-[60rem]/students:grid-cols-[minmax(0,19fr)_minmax(0,25fr)_minmax(0,9fr)_minmax(0,14fr)_minmax(0,14fr)_minmax(0,19fr)_2.75rem] @min-[60rem]/students:[grid-template-areas:'student_step_due_stage_curator_signals_link']";
const ROW_GRID = `grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 [grid-template-areas:'student_student'_'step_due'_'curator_curator'_'signals_signals'] @min-[36rem]/students:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,11rem)_2.75rem] @min-[36rem]/students:[grid-template-areas:'student_due_curator_link'_'step_due_signals_link'] ${WIDE_COLUMNS}`;
const CELL = "min-w-0 px-3 @min-[36rem]/students:px-2 @min-[60rem]/students:py-2";
const HEAD = "flex h-9 items-center px-2 text-start t-caption text-fg-2 first:ps-3";
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

function DueCell({ row, now }: Readonly<{ row: StudentCaseQueueRow; now: Date }>) {
  const due = row.nextAction && row.nextActionDueOn ? queueDue({ dueOn: row.nextActionDueOn, dueAt: null }, now, row.state !== "closed") : null;
  return (
    <td role="cell" className={`${CELL} [grid-area:due] self-start text-end t-body-compact @min-[36rem]/students:pt-1.5 @min-[36rem]/students:text-start @min-[60rem]/students:pt-2`}>
      {due ? <>
        <time dateTime={due.dateTime} className={`font-mono tabular-nums @min-[36rem]/students:block ${due.overdue ? "text-danger" : "text-fg"}`}>{due.text}</time>
        {due.word ?? due.caption ? <span className={`ms-1.5 t-meta @min-[36rem]/students:ms-0 @min-[36rem]/students:block ${due.overdue ? "text-danger" : "text-fg-3"}`}>{due.word ?? due.caption}</span> : null}
      </> : row.nextAction ? <span className="t-meta text-fg-3">без срока</span>
        : <span className="sr-only">Нет</span>}
    </td>
  );
}

function CuratorCell({ row }: Readonly<{ row: StudentCaseQueueRow }>) {
  const awaiting = row.attentionFlags.includes("awaiting_ack");
  const needsCurator = row.attentionFlags.includes("needs_curator");
  // В «Мои» имя повторялось бы в каждой строке: своё дело — «Вы». В узкой
  // колонке — «Имя Ф.», полное имя — в подсказке и в панели.
  const full = row.currentCuratorDisplayName ?? "Куратор без имени";
  const quietOnPhone = row.isMine && !awaiting;
  return (
    <td role="cell" className={`${CELL} [grid-area:curator] t-body-compact @min-[36rem]/students:truncate @min-[36rem]/students:pt-1.5 @min-[60rem]/students:whitespace-normal @min-[60rem]/students:pt-2 ${quietOnPhone ? "@max-[36rem]/students:sr-only" : ""}`}>
      <span className="@min-[36rem]/students:hidden text-fg-2">Куратор: </span>
      {row.currentCuratorMembershipId ? (
        <span className="text-fg @min-[60rem]/students:block @min-[60rem]/students:truncate" title={full}>
          {row.isMine ? "Вы" : <>
            <span aria-hidden="true" className="@max-[36rem]/students:hidden">{shortPersonName(full)}</span>
            <span className="@min-[36rem]/students:sr-only">{full}</span>
          </>}
        </span>
      ) : needsCurator ? <span className="font-medium text-danger">нужен куратор</span>
        : <span className="text-fg-3">не назначен</span>}
      {awaiting ? <>
        <span aria-hidden="true" className="@min-[60rem]/students:hidden"> · </span>
        <span className="font-medium text-warn @min-[60rem]/students:block">ждёт принятия</span>
      </> : null}
    </td>
  );
}

function SignalsCell({ row }: Readonly<{ row: StudentCaseQueueRow }>) {
  const signals = studentsRowSignals(row);
  return (
    <td role="cell" className={`${CELL} [grid-area:signals] t-body-compact @min-[60rem]/students:pt-2 ${signals.length ? "" : "@max-[60rem]/students:sr-only"}`}>
      {signals.length ? (
        <span className="line-clamp-2 @min-[36rem]/students:line-clamp-1 @min-[60rem]/students:line-clamp-2" title={signals.map((signal) => signal.text).join(" · ")}>
          {signals.map((signal, index) => (
            <span key={signal.key}>
              {index > 0 ? <span className="text-fg-3"> · </span> : null}
              <span className={`font-medium ${TONE[signal.tone]}`}>{signal.text}</span>
            </span>
          ))}
        </span>
      ) : <span className="sr-only">Нет</span>}
    </td>
  );
}

export function StudentsQueueRow({
  row,
  now,
  selected,
  links,
}: Readonly<{
  row: StudentCaseQueueRow;
  /** Полдень сегодняшнего дня Бишкека из чтения 241 (`bishkekNoon`). */
  now: Date;
  selected: boolean;
  links: StudentsRowLinks;
}>) {
  const meta = studentsRowMeta(row);
  const stage = admissionsPipelineStage(row.pipelineStage) ?? row.pipelineStage;
  return (
    <tr
      role="row"
      data-queue-row={row.studentCaseId}
      data-testid="v3-student-case-row"
      data-access="full"
      data-student-case-id={row.studentCaseId}
      data-band={row.dueBand}
      className={`relative ${ROW_GRID} border-b border-border py-2 @min-[36rem]/students:py-1 @min-[60rem]/students:py-0 ${selected ? "bg-surface-2" : "hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface"}`}
    >
      <th role="rowheader" scope="row" className={`${CELL} [grid-area:student] text-start font-normal @min-[36rem]/students:pt-1.5 @min-[60rem]/students:pt-2 @min-[60rem]/students:ps-3`}>
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
          <span aria-hidden="true" className="@min-[60rem]/students:hidden"> · {stage}</span>
        </span>
      </th>
      <td role="cell" className={`${CELL} [grid-area:step] t-body-compact @min-[60rem]/students:pt-2`}>
        {row.nextAction
          ? <span className="line-clamp-2 break-words text-fg @min-[36rem]/students:line-clamp-1 @min-[60rem]/students:line-clamp-2" title={row.nextAction}>{row.nextAction}</span>
          : <span className="text-fg-3">Шаг не задан</span>}
      </td>
      <DueCell row={row} now={now} />
      <td role="cell" className={`${CELL} t-body-compact text-fg sr-only @min-[60rem]/students:not-sr-only @min-[60rem]/students:[grid-area:stage] @min-[60rem]/students:pt-2`}>
        {stage}
      </td>
      <CuratorCell row={row} />
      <SignalsCell row={row} />
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
 */
export function StudentsQueueTable({
  bands,
  caption,
  hint,
  now,
  selectedKey,
  links,
}: Readonly<{
  bands: readonly StudentsBand<StudentCaseQueueRow>[];
  caption: string;
  /** Подсказка у группы «Без следующего шага» (добавить шаг может редактор). */
  hint: string | null;
  now: Date;
  selectedKey: string | null;
  links: (row: StudentCaseQueueRow) => StudentsRowLinks;
}>) {
  return (
    <table role="table" className="block w-full" data-testid="v3-student-case-table">
      <caption className="sr-only">{caption}</caption>
      <thead role="rowgroup" className="sr-only @min-[60rem]/students:not-sr-only @min-[60rem]/students:sticky @min-[60rem]/students:top-0 @min-[60rem]/students:z-30 @min-[60rem]/students:block @min-[60rem]/students:bg-bg">
        <tr role="row" className={`grid ${WIDE_COLUMNS} shadow-[inset_0_-1px_0_var(--border)]`}>
          {(["Студент", "Следующий шаг", "Срок", "Этап", "Куратор", "Сигналы"] as const).map((label) => (
            <th key={label} role="columnheader" scope="col" className={HEAD}>{label}</th>
          ))}
          <th role="columnheader" scope="col" className={HEAD}><span className="sr-only">Дело</span></th>
        </tr>
      </thead>
      {bands.map((band) => {
        const headingId = `students-band-${band.key}`;
        return (
          <tbody key={band.key} role="rowgroup" aria-labelledby={band.label ? headingId : undefined} className="block">
            {band.label ? (
              <tr role="row" className="sticky top-0 z-20 block bg-bg shadow-[inset_0_-1px_0_var(--border)] @min-[60rem]/students:top-9">
                <th role="rowheader" scope="rowgroup" colSpan={7} id={headingId} className="flex flex-wrap items-baseline gap-x-1.5 py-2 ps-3 text-start t-item">
                  <span className={band.tone === "danger" ? "text-danger" : band.tone === "warn" ? "text-warn" : "text-fg"}>{band.label}</span>
                  {band.count !== null ? <span className="font-normal tabular-nums text-fg-3">· {band.count}</span> : null}
                  {band.key === "no_step" && hint ? <span className="t-meta font-normal text-fg-2">— {hint}</span> : null}
                </th>
              </tr>
            ) : null}
            {band.rows.map((row) => (
              <StudentsQueueRow key={row.studentCaseId} row={row} now={now} selected={row.studentCaseId === selectedKey} links={links(row)} />
            ))}
          </tbody>
        );
      })}
    </table>
  );
}
