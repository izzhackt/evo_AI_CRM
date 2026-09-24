import Link from "next/link";

import type { V3ProfileCaseDirectoryRow } from "@/lib/v3/profile-source";
import { studentOperationalStage } from "@/lib/v3/wording";

import { ATTENTION_LABELS, withDocsSection } from "./admissions-view";
import { formatDueOn, nextStepOverdue, rowDirection, rowProblems, rowState } from "./students-facets";

/*
 * Одна таблица для двух ширин. От контейнера @3xl — настоящая таблица с
 * закреплённой шапкой и не больше двух строк текста в ряду: имя и
 * «направление · уровень» в одной колонке, следующий шаг — до двух строк,
 * срок — своей колонкой. Уже — каждая строка становится стопкой: имя,
 * «направление · уровень · этап» одной строкой, следующий шаг со сроком справа,
 * куратор, проблемы. Роли заданы явно: смена display у таблицы иначе стирает её
 * семантику в части браузеров. Этапы и статусы — словарь: переносятся только
 * между словами, без дефисов.
 */
const TABLE_CELL = "@3xl:table-cell @3xl:px-2 @3xl:py-2 @3xl:align-top @3xl:first:ps-3";
/** Словарь (этап, срок, проблемы): слово никогда не рвётся посередине. */
const CELL = `block min-w-0 ${TABLE_CELL}`;
/** Данные людей (имя, шаг, куратор) могут содержать длинное слово или адрес. */
const DATA_CELL = `${CELL} break-words`;
/** Пустая ячейка: в стопке её не видно, читалка по-прежнему слышит «Нет». */
const EMPTY_CELL = `${CELL} @max-3xl:sr-only`;
/** Кнопки EVO Docs: 44 px целиком помещаются в первую строку ряда. */
const ACTION_CELL = "block min-w-0 @3xl:table-cell @3xl:px-2 @3xl:py-1 @3xl:align-top";
const ROW_ACTION = "inline-flex min-h-11 items-center rounded-nav px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg";
/** Имя в таблице — одной строкой; полное имя — в тексте ссылки и в подсказке. */
const NAME = "block [overflow-wrap:anywhere] @3xl:truncate";
/*
 * Область нажатия имени — не меньше 44 px и целиком внутри своей ячейки:
 * строка имени (роль t-item, 20 px), 8 px вверх до края ячейки (py-2 в
 * таблице, py-3 в стопке) и 16 px вниз на строку «направление · уровень»
 * (t-meta, 16 px): 20 + 8 + 16 = 44 px и в таблице, и в стопке. Вверх не
 * выходим: над первой строкой липкая шапка перекрыла бы выступ, над
 * остальными он забирал бы нажатия у соседа.
 */
const NAME_LINK = "relative block w-fit max-w-full t-item text-fg underline-offset-4 before:absolute before:-inset-x-1 before:-top-2 before:-bottom-4 before:content-[''] hover:underline";
/** Шапка колонки — подпись данных (t-caption), без заглавных. */
const HEAD = "@3xl:sticky @3xl:top-0 @3xl:z-10 @3xl:bg-bg px-2 py-2.5 text-start t-caption text-fg-2 shadow-[inset_0_-1px_0_var(--border)] first:ps-3";
const TONE = {
  danger: "font-medium text-danger",
  muted: "text-fg-3",
  secondary: "text-fg-2",
  default: "text-fg",
} as const;

type StagePart = Readonly<{ key: string; label: string; tone: keyof typeof TONE }>;

function caseHref(row: V3ProfileCaseDirectoryRow, docsMode: boolean): string | null {
  if (row.access === "full") {
    return withDocsSection(`/v3/profile?case=${row.studentCaseId}&tab=${docsMode ? "anketa" : "route"}`, docsMode);
  }
  return row.leadId ? `/v3/profile?id=${row.leadId}` : null;
}

/** Закрытое дело без шага: «Дело закрыто» стоит в колонке шага, этап — отдельно. */
function closedWithoutStep(row: V3ProfileCaseDirectoryRow): boolean {
  return row.access === "full" && row.state === "closed" && !row.nextAction;
}

/**
 * «Этап»: состояние, если оно отличается от «В работе» (ожидает начала,
 * нужно назначить куратора), и сам этап; у sales_summary — итог передачи.
 */
function stageParts(row: V3ProfileCaseDirectoryRow): readonly StagePart[] {
  const closed = closedWithoutStep(row);
  const state = row.state === "active" || closed ? null : rowState(row);
  // Этап «дело закрыто» уже сказан в колонке шага («Дело закрыто»).
  const stageLabel = closed && row.operationalStage === "closed" ? null
    : row.operationalStage ? studentOperationalStage(row.operationalStage)
    : row.state === "active" ? "передано куратору" : null;
  const parts: StagePart[] = [];
  if (state) parts.push({ key: "state", label: state.label, tone: state.tone });
  if (stageLabel) {
    parts.push({
      key: "stage",
      label: `${stageLabel.charAt(0).toUpperCase()}${stageLabel.slice(1)}`,
      tone: state || closed ? "secondary" : "default",
    });
  }
  return parts;
}

function StudentCell({ row, href, stage }: Readonly<{ row: V3ProfileCaseDirectoryRow; href: string | null; stage: readonly StagePart[] }>) {
  const meta = [rowDirection(row), row.targetDegree].filter(Boolean).join(" · ");
  return (
    <th scope="row" role="rowheader" className={`${DATA_CELL} order-1 basis-full text-start font-normal`}>
      {href ? (
        <Link href={href} className={NAME_LINK}>
          <span className={NAME} title={row.studentDisplayName}>{row.studentDisplayName}</span>
        </Link>
      ) : (
        <span className={`${NAME} t-item text-fg`} title={row.studentDisplayName}>{row.studentDisplayName}</span>
      )}
      {/* В таблице — «направление · уровень»; в стопке та же строка продолжает этапом. */}
      <span className="block t-meta text-fg-2 @3xl:truncate" title={meta}>
        {meta}
        {stage.length ? (
          <span aria-hidden="true" className="@3xl:hidden">
            {stage.map((part) => <span key={part.key}> · <span className={TONE[part.tone]}>{part.label}</span></span>)}
          </span>
        ) : null}
      </span>
    </th>
  );
}

function StageCell({ stage }: Readonly<{ stage: readonly StagePart[] }>) {
  // В стопке этап уже стоит в строке под именем: ячейка остаётся для читалки.
  return (
    <td role="cell" className={`${CELL} order-3 text-sm @max-3xl:sr-only`}>
      {stage.length ? stage.map((part) => <span key={part.key} className={`block ${TONE[part.tone]}`}>{part.label}</span>)
        : <span className="sr-only">Нет</span>}
    </td>
  );
}

function NextStepCell({ row }: Readonly<{ row: V3ProfileCaseDirectoryRow }>) {
  return (
    <td role="cell" className={`${DATA_CELL} order-2 flex-1 text-sm`}>
      {row.access !== "full" ? <span className="text-fg-3">Только итог передачи</span>
        : closedWithoutStep(row) ? <span className="text-fg-3">Дело закрыто</span>
        : row.nextAction ? <span className="block text-fg @3xl:line-clamp-2" title={row.nextAction}>{row.nextAction}</span>
        : <span className="text-fg-2">Следующий шаг не назначен</span>}
    </td>
  );
}

function DueCell({ row, today }: Readonly<{ row: V3ProfileCaseDirectoryRow; today: string }>) {
  const due = row.access === "full" && !closedWithoutStep(row) ? row.nextActionDueOn ?? null : null;
  if (!due) {
    return <td role="cell" className={`${EMPTY_CELL} order-2`}><span className="sr-only">Нет</span></td>;
  }
  const text = formatDueOn(due, today);
  // Просрочка названа словом, а не только цветом: под шапкой «Срок» — «прошёл».
  return (
    <td role="cell" className={`${CELL} order-2 shrink-0 text-end text-sm @3xl:text-start`}>
      {nextStepOverdue(row, today) ? <>
        <time dateTime={due} className="block whitespace-nowrap font-mono font-medium tabular-nums text-danger">{text}</time>
        <span className="block font-medium text-danger"><span className="@3xl:hidden">срок </span>прошёл</span>
      </> : (
        <span className="whitespace-nowrap text-fg-2">
          <span className="@3xl:hidden">до </span>
          <time dateTime={due} className="font-mono tabular-nums">{text}</time>
        </span>
      )}
    </td>
  );
}

function CuratorCell({ row, docsMode }: Readonly<{ row: V3ProfileCaseDirectoryRow; docsMode: boolean }>) {
  // «Ожидает принятия» — дело ждёт принятия куратором: стоит под его именем.
  // EVO Docs статусов работы не показывает — только документы.
  const awaiting = !docsMode && row.attentionFlags.includes("awaiting_ack");
  return (
    <td role="cell" className={`${DATA_CELL} order-4 basis-full text-sm text-fg-2 @3xl:text-fg`}>
      <span className="@3xl:hidden">Куратор: </span>
      {row.admissionsDisplayName
        ? <span className="@3xl:block @3xl:truncate" title={row.admissionsDisplayName}>{row.admissionsDisplayName}</span>
        : <span className="text-fg-3">не назначен</span>}
      {awaiting ? <>
        <span aria-hidden="true" className="@3xl:hidden"> · </span>
        <span className="font-medium text-warn @3xl:block">{ATTENTION_LABELS.awaiting_ack}</span>
      </> : null}
    </td>
  );
}

export function StudentCaseTable({ rows, docsMode, today, caption }: Readonly<{
  rows: readonly V3ProfileCaseDirectoryRow[];
  docsMode: boolean;
  /** Сегодняшний день в Бишкеке, YYYY-MM-DD: то же правило просрочки, что у сервера. */
  today: string;
  caption: string;
}>) {
  // Ширины колонок живут на заголовках (table-fixed берёт первую строку).
  const columns = docsMode
    ? [["Студент", "w-[34%]"], ["Куратор", "w-[22%]"], ["Документы", "w-[44%]"]]
    : [["Студент", "w-[22%]"], ["Этап", "w-[17%]"], ["Следующий шаг", "w-[18%]"], ["Срок", "w-[9.5%]"],
      ["Куратор", "w-[17.5%]"], ["Проблемы", "w-[16%]"]];
  return (
    <table role="table" className="block w-full border-collapse @3xl:table @3xl:table-fixed" data-testid="v3-student-case-table">
      <caption className="sr-only">{caption}</caption>
      <thead role="rowgroup" className="sr-only @3xl:not-sr-only @3xl:table-header-group">
        <tr role="row">
          {columns.map(([label, width]) => <th key={label} scope="col" role="columnheader" className={`${HEAD} ${width}`}>{label}</th>)}
        </tr>
      </thead>
      <tbody role="rowgroup" className="block @3xl:table-row-group">
        {rows.map((row) => {
          const href = caseHref(row, docsMode);
          const stage = docsMode ? [] : stageParts(row);
          const problems = docsMode ? [] : rowProblems(row);
          return (
            <tr
              key={row.studentCaseId}
              role="row"
              data-testid="v3-student-case-row"
              data-access={row.access}
              data-student-case-id={row.studentCaseId}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border py-3 @3xl:table-row @3xl:py-0 @3xl:focus-within:bg-surface @3xl:hover:bg-surface"
            >
              <StudentCell row={row} href={href} stage={stage} />
              {docsMode ? <>
                <CuratorCell row={row} docsMode />
                <td role="cell" className={`${ACTION_CELL} order-5 basis-full pt-1`}>
                  <nav aria-label={`Документы: ${row.studentDisplayName}`} className="-ms-3 flex flex-wrap items-center gap-x-1">
                    <Link href={href!} className={ROW_ACTION}>Анкета и формы</Link>
                    <Link href={withDocsSection(`/v3/profile?case=${row.studentCaseId}&tab=documents`, true)} className={ROW_ACTION}>Файлы</Link>
                    <Link href={withDocsSection(`/v3/profile?case=${row.studentCaseId}&tab=route&panel=packets#partner-packets`, true)} className={ROW_ACTION}>Пакет ZIP</Link>
                  </nav>
                </td>
              </> : <>
                <StageCell stage={stage} />
                <NextStepCell row={row} />
                <DueCell row={row} today={today} />
                <CuratorCell row={row} docsMode={false} />
                <td role="cell" className={`${problems.length ? CELL : EMPTY_CELL} order-5 basis-full text-sm`}>
                  {problems.length
                    ? problems.map((problem) => <span key={problem} className="block font-medium text-danger">{problem}</span>)
                    : <span className="sr-only">Нет</span>}
                </td>
              </>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
