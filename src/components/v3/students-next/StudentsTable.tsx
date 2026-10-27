"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { DataTable, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { StudentCaseQueueCounts, StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";

import { LinkFilters } from "../list-next/LinkFilters";
import { ListSearch } from "../list-next/ListSearch";
import type { LinkFilterBarData } from "../list-next/link-filters-model";
import { useBulkSelection } from "../queue/Bulk";
import { useQueueKeyboard } from "../queue/useQueueKeyboard";
import { curatorAssignable, stepDueEditable, StudentsBulkActions, type StudentsBulkAccess } from "../students/StudentsBulkActions";
import { studentsEmptyState } from "../students/StudentsQueueBody";
import { studentsCaseHref, studentsEffectiveSort, studentsQueueHref, type StudentsQueueParams } from "../students/students-queue-view";
import { StudentsTableProvider } from "./StudentsTableContext";
import { studentColumns } from "./student-columns";
import { studentRows, studentsSearchHidden } from "./students-next-model";

/** Клавиши очереди (j/k, «x», «/») живут, пока панель дела закрыта: открытая панель держит фокус внутри себя. */
function QueueKeys() {
  useQueueKeyboard({ openKey: null });
  return null;
}

/**
 * Очередь «Студентов» в «Новом виде»: `DataTable` с прежними фильтрами и поиском по всей очереди (адрес), массовым выбором
 * (те же «Назначить куратора» и «Изменить срок шага»), страницами сервера. Панель дела — рядом (`StudentSheetHost`).
 */
export function StudentsTable({ params, rows, counts, today, now, nextCursor, filters, access, onOpen }: Readonly<{
  params: StudentsQueueParams;
  rows: readonly StudentCaseQueueRow[];
  counts: StudentCaseQueueCounts | null;
  today: string;
  now: Date;
  nextCursor: string | null;
  filters: LinkFilterBarData;
  /** Права массовых действий: кураторы (null — назначать нельзя), права редактора шага, области `record`. */
  access: StudentsBulkAccess;
  /** Нажата строка: панель открывается адресом, а «закрыта» снимается. */
  onOpen: () => void;
}>) {
  const router = useRouter();
  const items = useMemo(() => studentRows(rows), [rows]);
  const curatorColumn = params.view !== "mine";
  const columns = useMemo(() => studentColumns(curatorColumn), [curatorColumn]);
  const selectable = new Map(rows.filter((row) => curatorAssignable(access, row) || stepDueEditable(access, row)).map((row) => [row.studentCaseId, row] as const));
  // Что таблица показывает сейчас: от этого зависят «все на странице» и выбор.
  const [visible, setVisible] = useState<readonly string[]>(() => rows.map((row) => row.studentCaseId));
  const keys = [...selectable.keys()].filter((key) => visible.includes(key));
  const selection = useBulkSelection(keys);
  const openHref = (row: StudentCaseQueueRow) => studentsQueueHref(params, { open: row.studentCaseId });
  const empty = studentsEmptyState(params, counts);

  return (
    <StudentsTableProvider value={{
      today, now, sort: studentsEffectiveSort(params.view, params.sort), curatorColumn, openKey: params.open, openHref,
      caseHref: (row) => studentsCaseHref(row.studentCaseId, { returnTo: openHref(row) }),
      selection: selectable.size > 0 ? selection : null, selectable: new Set(selectable.keys()),
    }}>
      <div className="grid min-w-0 gap-3" data-testid="v3-student-case-directory-next">
        {params.open === null ? <QueueKeys /> : null}
        <DataTable
          label="Студенты"
          data={items}
          columns={columns}
          getRowId={(item) => item.id}
          onRowClick={(item) => { onOpen(); router.push(openHref(item.row), { scroll: false }); }}
          getRowLabel={(item) => item.name}
          searchable={false}
          paginate={false}
          columnMenu={false}
          onVisibleIdsChange={setVisible}
          empty={<EmptyState title={empty.title} action={empty.action ? <Button variant="outline" asChild><Link href={empty.action.href} scroll={false}>{empty.action.label}</Link></Button> : undefined} />}
          toolbar={<>
            <ListSearch action="/v3/profile" value={params.query ?? ""} placeholder="Студент или страна" label="Найти студента" hidden={studentsSearchHidden(params)} maxLength={200} />
            <LinkFilters bar={filters} />
            {selectable.size > 0 ? (
              <Button variant="ghost" data-testid="queue-bulk-pick" onClick={() => (selection.revealed ? selection.clear() : selection.pick())}>
                {selection.revealed ? "Отмена" : "Выбрать"}
              </Button>
            ) : null}
          </>}
        />
        {selectable.size > 0 ? <StudentsBulkActions selection={selection} rows={selectable} allKeys={keys} today={today} access={access} /> : null}
        {params.cursor || nextCursor ? (
          <nav aria-label="Страницы списка студентов" className="flex flex-wrap gap-2">
            {params.cursor ? <Button variant="outline" asChild><Link href={studentsQueueHref(params, { cursor: null, open: null })} scroll={false}>К началу</Link></Button> : null}
            {nextCursor ? <Button variant="outline" asChild><Link href={studentsQueueHref(params, { cursor: nextCursor, open: null })} rel="next">Следующая страница</Link></Button> : null}
          </nav>
        ) : null}
      </div>
    </StudentsTableProvider>
  );
}
