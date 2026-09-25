import Link from "next/link";

import { Icon } from "@/components/icons";
import type { StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";

import { DocsRowMenu } from "./DocsRowMenu";
import { studentsRowMeta } from "./StudentsQueueTable";
import { studentsCaseHref, studentsDocsCell, type StudentsDocsPart, type StudentsDocsView } from "./students-queue-view";

const TONE: Readonly<Record<StudentsDocsPart["tone"], string>> = { default: "text-fg", danger: "text-danger", warn: "text-warn", muted: "text-fg-2" };

function Parts({ parts, strong }: Readonly<{ parts: readonly StudentsDocsPart[]; strong: boolean }>) {
  return parts.map((part, index) => (
    <span key={part.key}>
      {index > 0 ? <span className="text-fg-3"> · </span> : null}
      <span className={`inline-block ${strong || part.tone === "warn" || part.tone === "danger" ? "font-medium" : ""} ${TONE[part.tone]}`}>{part.text}</span>
    </span>
  ));
}
/*
 * EVO Docs — очередь проверки документов: Студент | Документы | Куратор |
 * одно действие «Открыть документы →» и «⋯». От 48rem своей ширины — таблица в
 * одну строку, уже — стопка. Статусов работы (срок, этап, «ждёт принятия»)
 * здесь нет. «Документы» начинаются с числа, которое определяет вкладку
 * (t-item), остальное — строкой ниже. Порядок строк — последнее изменение
 * дела (у чтения 241 нет времени ожидания проверки), и он назван над таблицей.
 */
/**
 * Колонка действия — постоянные 11rem: «Открыть документы →» в одну строку.
 * Каждая строка — своя сетка, поэтому дорожки только фиксированные и доли
 * (`auto` у каждой строки считался бы по-своему), зазоры — как у шапки.
 */
const COLUMNS = "@min-[48rem]/docs:grid-cols-[minmax(0,26fr)_minmax(0,40fr)_minmax(0,18fr)_11rem_2.75rem] @min-[48rem]/docs:[grid-template-areas:'student_documents_curator_open_menu']";
const ROW_GRID = `grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 [grid-template-areas:'student_menu'_'documents_documents'_'open_open'] ${COLUMNS}`;
const CELL = "min-w-0 px-3 @min-[48rem]/docs:px-2 @min-[48rem]/docs:py-2";
const HEAD = "flex h-9 items-center px-2 text-start t-caption text-fg-2 first:ps-3";

export function StudentsDocsTable({
  rows,
  view,
  caption,
  returnTo,
}: Readonly<{
  rows: readonly StudentCaseQueueRow[];
  view: StudentsDocsView;
  caption: string;
  /** Адрес этой очереди EVO Docs: «К списку EVO Docs» возвращает сюда. */
  returnTo: string;
}>) {
  return (
    <div className="@container/docs min-w-0 space-y-1" data-queue-list="">
      <p className="t-meta text-fg-2">Порядок: сначала недавно изменённые дела</p>
      <table role="table" className="block w-full" data-testid="v3-student-case-table">
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup" className="sr-only @min-[48rem]/docs:not-sr-only @min-[48rem]/docs:sticky @min-[48rem]/docs:top-0 @min-[48rem]/docs:z-30 @min-[48rem]/docs:block @min-[48rem]/docs:bg-bg">
          <tr role="row" className={`grid gap-x-3 ${COLUMNS} shadow-[inset_0_-1px_0_var(--border)]`}>
            {(["Студент", "Документы", "Куратор"] as const).map((label) => <th key={label} role="columnheader" scope="col" className={HEAD}>{label}</th>)}
            <th role="columnheader" scope="col" className={HEAD}><span className="sr-only">Действие</span></th>
            <th role="columnheader" scope="col" className={HEAD}><span className="sr-only">Ещё</span></th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="block">
          {rows.map((row) => {
            const documents = studentsDocsCell(view, row.documents);
            const documentsHref = studentsCaseHref(row.studentCaseId, { docs: true, returnTo });
            const meta = studentsRowMeta(row);
            return (
              <tr
                key={row.studentCaseId}
                role="row"
                data-queue-row={row.studentCaseId}
                data-testid="v3-student-case-row"
                data-access="full"
                data-student-case-id={row.studentCaseId}
                className={`v3-queue-row group relative ${ROW_GRID} border-b border-border py-2 hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface @min-[48rem]/docs:py-0`}
              >
                <th role="rowheader" scope="row" className={`${CELL} [grid-area:student] self-center text-start font-normal @min-[48rem]/docs:ps-3`}>
                  <span className="block truncate t-item text-fg" title={row.studentDisplayName}>{row.studentDisplayName}</span>
                  <span className="block truncate t-meta text-fg-2" title={meta}>{meta}</span>
                </th>
                <td role="cell" className={`${CELL} [grid-area:documents] t-body-compact`}>
                  {documents ? <>
                    <span className="block t-item"><Parts parts={documents.lead} strong /></span>
                    {documents.rest.length ? <span className="block"><Parts parts={documents.rest} strong={false} /></span> : null}
                  </> : <span className="text-fg-3">Нет доступа к документам</span>}
                </td>
                <td role="cell" className={`${CELL} t-body-compact text-fg sr-only @min-[48rem]/docs:not-sr-only @min-[48rem]/docs:[grid-area:curator] @min-[48rem]/docs:self-center`}>
                  {row.currentCuratorDisplayName
                    ? <span className="block truncate" title={row.currentCuratorDisplayName}>{row.currentCuratorDisplayName}</span>
                    : <span className="text-fg-3">не назначен</span>}
                </td>
                <td role="cell" className={`${CELL} [grid-area:open] @min-[48rem]/docs:self-center`}>
                  {/* Одно действие строки; его область — вся строка. */}
                  {/* Ссылка выглядит ссылкой: текст и стрелка, подчёркивание при наведении на строку и при фокусе. */}
                  <Link
                    href={documentsHref}
                    data-queue-open=""
                    className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap t-label text-fg underline-offset-4 before:absolute before:inset-0 before:content-[''] group-hover:underline focus-visible:underline"
                  >
                    Открыть документы<span className="sr-only">: {row.studentDisplayName}</span>
                    <Icon name="arrow-right" size={16} className="shrink-0 text-fg-2" />
                  </Link>
                </td>
                <td role="cell" className="[grid-area:menu] flex items-center justify-center">
                  <DocsRowMenu
                    name={row.studentDisplayName}
                    anketaHref={studentsCaseHref(row.studentCaseId, { docs: true, tab: "anketa", returnTo })}
                    packetHref={`${studentsCaseHref(row.studentCaseId, { docs: true, tab: "route", returnTo })}&panel=packets#partner-packets`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
