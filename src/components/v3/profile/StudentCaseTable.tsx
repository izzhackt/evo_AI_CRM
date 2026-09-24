import Link from "next/link";

import { btnGhostCls } from "@/components/ui";
import type { V3ProfileCaseDirectoryRow } from "@/lib/v3/profile-source";
import { studentOperationalStage } from "@/lib/v3/wording";

import { ATTENTION_LABELS, withDocsSection } from "./admissions-view";
import { formatDueOn, nextStepOverdue, rowDirection, rowProblems, rowState } from "./students-facets";

/*
 * Одна таблица для двух ширин. От контейнера @3xl — настоящая таблица с
 * закреплённой шапкой. Уже — каждая строка становится стопкой: имя, следующий
 * шаг со сроком, строка метаданных. Роли заданы явно: смена display у таблицы
 * иначе стирает её семантику в части браузеров.
 */
const TABLE_CELL = "break-words @3xl:table-cell @3xl:px-2.5 @3xl:py-3 @3xl:align-top @3xl:first:ps-3";
const CELL = `block ${TABLE_CELL}`;
/** Данные ячеек (не имена): длинное русское слово переносится с дефисом. */
const DATA_CELL = `${CELL} hyphens-auto`;
/** Кнопки EVO Docs: 44 px целиком помещаются в первую строку ряда. */
const ACTION_CELL = "block break-words @3xl:table-cell @3xl:px-2.5 @3xl:py-1.5 @3xl:align-top";
/** «Направление» средней ширины: в стопке видно, в таблице — только от @6xl. */
const FOLDED_CELL = "block break-words hyphens-auto @3xl:hidden @6xl:table-cell @6xl:px-2.5 @6xl:py-3 @6xl:align-top";
/** Стопка: этап идёт за направлением через точку и переносится внутри себя. */
const META_DOT = "before:me-2 before:text-fg-3 before:content-['·'] @3xl:before:content-none";
const HEAD = "@3xl:sticky @3xl:top-0 @3xl:z-10 @3xl:bg-bg px-2.5 py-2.5 text-start text-xs font-semibold text-fg-2 shadow-[inset_0_-1px_0_var(--border)] first:ps-3";
const SEP = <span aria-hidden="true" className="@3xl:hidden"> · </span>;
const STATE_TONE = { danger: "font-medium text-danger", muted: "text-fg-3", default: "text-fg" } as const;

function caseHref(row: V3ProfileCaseDirectoryRow, docsMode: boolean): string | null {
  if (row.access === "full") {
    return withDocsSection(`/v3/profile?case=${row.studentCaseId}&tab=${docsMode ? "anketa" : "route"}`, docsMode);
  }
  return row.leadId ? `/v3/profile?id=${row.leadId}` : null;
}

function StudentCell({ row, href, fold }: Readonly<{ row: V3ProfileCaseDirectoryRow; href: string | null; fold: boolean }>) {
  return (
    <th scope="row" role="rowheader" className={`${CELL} order-1 basis-full text-start text-base font-semibold [overflow-wrap:anywhere]`}>
      {href ? (
        <Link
          href={href}
          className="relative text-fg underline-offset-4 before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] hover:underline"
        >
          {row.studentDisplayName}
        </Link>
      ) : (
        <span className="text-fg">{row.studentDisplayName}</span>
      )}
      {/* Таблица средней ширины: направление уходит под имя, колонка скрыта. */}
      {fold ? <span className="hidden text-sm font-normal text-fg-2 @3xl:block @6xl:hidden">
        {rowDirection(row)}{row.targetDegree ? ` · ${row.targetDegree}` : ""}
      </span> : null}
    </th>
  );
}

function DirectionCell({ row, fold }: Readonly<{ row: V3ProfileCaseDirectoryRow; fold: boolean }>) {
  return (
    <td role="cell" className={`${fold ? FOLDED_CELL : DATA_CELL} order-3 max-w-full text-sm text-fg-2 @3xl:text-fg`}>
      {rowDirection(row)}
      {row.targetDegree ? <>{SEP}<span className="text-fg-2 @3xl:block">{row.targetDegree}</span></> : null}
    </td>
  );
}

function CuratorCell({ row }: Readonly<{ row: V3ProfileCaseDirectoryRow }>) {
  return (
    <td role="cell" className={`${CELL} order-4 basis-full text-sm text-fg-2 @3xl:text-fg`}>
      <span className="@3xl:hidden">Куратор: </span>
      {row.admissionsDisplayName ?? <span className="text-fg-3">не назначен</span>}
    </td>
  );
}

/** «Этап» и «Следующий шаг»: полная строка дела; у sales_summary — только итог передачи. */
function StageAndNextCells({ row, today }: Readonly<{ row: V3ProfileCaseDirectoryRow; today: string }>) {
  // «В работе» — обычное состояние строки; называем только отличия от него
  // (ожидает начала, закрыто, нужно назначить куратора), этап — всегда.
  const state = row.state === "active" ? null : rowState(row);
  const overdue = nextStepOverdue(row, today);
  const closedWithoutStep = row.access === "full" && row.state === "closed" && !row.nextAction;
  const stageLabel = row.operationalStage ? studentOperationalStage(row.operationalStage)
    : row.state === "active" ? "передано куратору" : null;
  const stage = stageLabel ? `${stageLabel.charAt(0).toUpperCase()}${stageLabel.slice(1)}` : null;
  const parts = [
    state ? <span key="state" className={`@3xl:block ${STATE_TONE[state.tone]}`}>{state.label}</span> : null,
    stage ? <span key="stage" className={`@3xl:block ${state ? "text-fg-2" : "text-fg"}`}>{stage}</span> : null,
    row.attentionFlags.includes("awaiting_ack") ? <span key="ack" className="font-medium text-warn @3xl:block">{ATTENTION_LABELS.awaiting_ack}</span> : null,
  ].filter((part) => part !== null);
  return (
    <>
      <td role="cell" className={`${DATA_CELL} ${META_DOT} order-3 min-w-0 flex-1 text-sm`}>
        {parts.map((part, index) => index === 0 ? part : <span key={part.key} className="contents">{SEP}{part}</span>)}
      </td>
      {/* Закрытому делу без шага строка шага не нужна: пустая ячейка, «Нет» для читалки. */}
      <td role="cell" className={`${closedWithoutStep ? `hidden hyphens-auto ${TABLE_CELL}` : DATA_CELL} order-2 basis-full text-sm`}>
        {closedWithoutStep ? <span className="sr-only">Нет</span>
          : row.access === "full" ? <>
          <span className={`@3xl:block ${row.nextAction ? "text-fg" : "text-fg-2"}`}>{row.nextAction ?? "Следующий шаг не назначен"}</span>
          {row.nextActionDueOn ? <>
            {SEP}
            <span className={overdue ? "font-medium text-danger" : "text-fg-2"}>
              {overdue ? "Срок прошёл " : "до "}
              <time dateTime={row.nextActionDueOn} className="whitespace-nowrap font-mono">{formatDueOn(row.nextActionDueOn)}</time>
            </span>
          </> : null}
        </> : <span className="text-fg-3">Только итог передачи</span>}
      </td>
    </>
  );
}

export function StudentCaseTable({ rows, docsMode, today, caption }: Readonly<{
  rows: readonly V3ProfileCaseDirectoryRow[];
  docsMode: boolean;
  /** Сегодняшний день в Бишкеке, YYYY-MM-DD: то же правило просрочки, что у сервера. */
  today: string;
  caption: string;
}>) {
  // Ширины колонок живут на заголовках (table-fixed берёт первую строку): до
  // @6xl таблица без колонки «Направление» — оно стоит под именем студента.
  const columns = docsMode
    ? [["Студент", "w-[26%]"], ["Направление", "w-[14%]"], ["Куратор", "w-[16%]"], ["Документы", "w-[44%]"]]
    : [["Студент", "w-[23%] @6xl:w-[21%]"], ["Направление", "hidden @6xl:table-cell @6xl:w-[14%]"], ["Этап", "w-[18%] @6xl:w-[15%]"],
      ["Следующий шаг", "w-[26%] @6xl:w-[21%]"], ["Куратор", "w-[15%] @6xl:w-[14%]"], ["Проблемы", "w-[18%] @6xl:w-[15%]"]];
  const fold = !docsMode;
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
          const problems = docsMode ? [] : rowProblems(row);
          return (
            <tr
              key={row.studentCaseId}
              role="row"
              data-testid="v3-student-case-row"
              data-access={row.access}
              data-student-case-id={row.studentCaseId}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border py-3 @3xl:table-row @3xl:py-0 @3xl:hover:bg-surface"
            >
              <StudentCell row={row} href={href} fold={fold} />
              <DirectionCell row={row} fold={fold} />
              {docsMode ? <>
                <CuratorCell row={row} />
                <td role="cell" className={`${ACTION_CELL} order-5 basis-full pt-2`}>
                  <nav aria-label={`Документы: ${row.studentDisplayName}`} className="flex flex-wrap items-center gap-x-1 gap-y-2">
                    <Link href={href!} className={btnGhostCls}>Анкета и формы</Link>
                    <Link href={withDocsSection(`/v3/profile?case=${row.studentCaseId}&tab=documents`, true)} className="inline-flex min-h-11 items-center rounded-nav px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg">Файлы</Link>
                    <Link href={withDocsSection(`/v3/profile?case=${row.studentCaseId}&tab=route&panel=packets#partner-packets`, true)} className="inline-flex min-h-11 items-center rounded-nav px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg">Пакет ZIP</Link>
                  </nav>
                </td>
              </> : <>
                <StageAndNextCells row={row} today={today} />
                <CuratorCell row={row} />
                <td role="cell" className={`${problems.length ? "block" : "hidden"} ${TABLE_CELL} order-5 basis-full text-sm`}>
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
