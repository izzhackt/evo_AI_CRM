import Link from "next/link";

import { Icon } from "@/components/icons";
import type { V3ProfileCaseDirectory, V3ProfileCaseDirectoryParams, V3ProfileCaseDirectoryRow } from "@/lib/v3/profile-source";

import { admissionsDirectoryHref, DIRECTION_LABELS, withDocsSection } from "../profile/admissions-view";
import { FilterMenu } from "../queue/FilterMenu";
import { QueueEmpty, QUEUE_QUIET_LINK } from "../queue/QueueStates";
import { QueueKeyboard } from "../queue/QueueKeyboard";
import { QueueToolbar } from "../queue/QueueToolbar";
import { StudentsFilterRejected } from "./StudentsQueueHead";

const COLUMNS = "@min-[40rem]/directory:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)] @min-[40rem]/directory:[grid-template-areas:'student_curator_state']";
const ROW_GRID = `grid grid-cols-[minmax(0,1fr)] [grid-template-areas:'student'_'curator'_'state'] ${COLUMNS}`;
const CELL = "min-w-0 px-3 @min-[40rem]/directory:px-2 @min-[40rem]/directory:py-2";
const HEAD = "flex h-9 items-center px-2 text-start t-caption text-fg-2 first:ps-3";
const STATE: Readonly<Record<V3ProfileCaseDirectoryRow["state"], string>> = { active: "В работе", pending: "Ожидает начала", closed: "Закрыто" };

function rowHref(row: V3ProfileCaseDirectoryRow, docsMode: boolean): string | null {
  // Итог передачи (Sales) ведёт в карточку лида; полное дело — в «Обзор» дела.
  if (row.access === "full") return withDocsSection(`/v3/profile?case=${row.studentCaseId}&tab=${docsMode ? "documents" : "overview"}`, docsMode);
  return row.leadId ? `/v3/profile?id=${row.leadId}` : null;
}

/**
 * «Студенты» для ролей без чтения очереди 241 (Sales и просмотр роли
 * «Продажи»): прежнее чтение `staff_student_case_page` и прежние параметры
 * адреса в табличной грамматике очереди. Итог передачи показывается
 * ограниченно: имя (→ карточка лида), куратор и состояние; шагов, сроков,
 * документов и сигналов нет.
 */
export function StudentsDirectoryFallback({
  directory,
  params,
  docsMode,
}: Readonly<{
  directory: V3ProfileCaseDirectory;
  params: V3ProfileCaseDirectoryParams;
  docsMode: boolean;
}>) {
  const rows = docsMode ? directory.rows.filter((row) => row.access === "full") : directory.rows;
  const baseHref = withDocsSection("/v3/profile", docsMode);
  const stateHref = (state: V3ProfileCaseDirectoryParams["state"]) => admissionsDirectoryHref({ ...params, state, cursor: null }, undefined, docsMode);
  const active = [params.query, params.state].filter(Boolean).length;
  return (
    <div className="min-w-0 space-y-3" data-testid="v3-student-case-directory">
      <QueueKeyboard />
      <QueueToolbar
        search={{
          action: "/v3/profile", name: "case_q", defaultValue: params.query ?? "", placeholder: "Студент или страна",
          label: "Найти студента", hidden: { section: docsMode ? "docs" : null, case_status: params.state ?? null },
        }}
        filters={<FilterMenu
          label="Состояние"
          valueLabel={params.state ? STATE[params.state] : null}
          clearHref={stateHref(undefined)}
          options={[
            { key: "all", label: "Все", href: stateHref(undefined), selected: !params.state },
            { key: "active", label: STATE.active, href: stateHref("active"), selected: params.state === "active" },
            { key: "closed", label: STATE.closed, href: stateHref("closed"), selected: params.state === "closed" },
          ]}
        />}
        activeCount={active}
        resetHref={active ? baseHref : null}
      />
      {params.invalid ? <StudentsFilterRejected resetHref={baseHref} /> : rows.length === 0 ? (
        <QueueEmpty title={params.active ? "Ничего не найдено" : "Переданных дел пока нет"} action={params.active ? <Link href={baseHref} className={QUEUE_QUIET_LINK}>Сбросить фильтры</Link> : null} />
      ) : (
        <div className="@container/directory min-w-0" data-queue-list="">
          <table role="table" className="block w-full" data-testid="v3-student-case-table">
            <caption className="sr-only">Дела студентов: {rows.length} на этой странице</caption>
            <thead role="rowgroup" className="sr-only @min-[40rem]/directory:not-sr-only @min-[40rem]/directory:block">
              <tr role="row" className={`grid ${COLUMNS} shadow-[inset_0_-1px_0_var(--border)]`}>
                {(["Студент", "Куратор", "Состояние"] as const).map((label) => <th key={label} role="columnheader" scope="col" className={HEAD}>{label}</th>)}
              </tr>
            </thead>
            <tbody role="rowgroup" className="block">
              {rows.map((row) => {
                const href = rowHref(row, docsMode);
                const meta = [row.admissionsDirection ? DIRECTION_LABELS[row.admissionsDirection] : row.targetCountry ?? "Страна не указана", row.targetDegree].filter(Boolean).join(" · ");
                return (
                  <tr key={row.studentCaseId} role="row" data-queue-row={row.studentCaseId} data-testid="v3-student-case-row" data-access={row.access}
                    data-student-case-id={row.studentCaseId} className={`relative ${ROW_GRID} border-b border-border py-2 hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface @min-[40rem]/directory:py-0`}>
                    <th role="rowheader" scope="row" className={`${CELL} [grid-area:student] text-start font-normal @min-[40rem]/directory:ps-3`}>
                      {href ? (
                        <Link href={href} data-queue-open="" title={row.studentDisplayName} className="block truncate t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline">{row.studentDisplayName}</Link>
                      ) : <span className="block truncate t-item text-fg" title={row.studentDisplayName}>{row.studentDisplayName}</span>}
                      <span className="block truncate t-meta text-fg-2" title={meta}>{meta}{row.access === "sales_summary" ? " · итог передачи" : ""}</span>
                    </th>
                    <td role="cell" className={`${CELL} [grid-area:curator] t-body-compact text-fg`}>
                      <span className="@min-[40rem]/directory:hidden text-fg-2">Куратор: </span>
                      {row.admissionsDisplayName ?? <span className="text-fg-3">не назначен</span>}
                    </td>
                    <td role="cell" className={`${CELL} [grid-area:state] t-body-compact text-fg-2`}>{STATE[row.state]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {params.cursor || (directory.hasNext && directory.nextCursor) ? (
        <nav aria-label="Страницы списка студентов" className="flex flex-wrap items-center gap-x-6">
          {params.cursor ? <Link className={QUEUE_QUIET_LINK} href={admissionsDirectoryHref(params, undefined, docsMode)}><Icon name="arrow-left" size={16} />К началу</Link> : null}
          {directory.hasNext && directory.nextCursor ? <Link className={QUEUE_QUIET_LINK} rel="next" href={admissionsDirectoryHref(params, directory.nextCursor, docsMode)}>Следующие записи<Icon name="arrow-right" size={16} /></Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
