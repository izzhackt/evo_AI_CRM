"use client";

import { createContext, useContext } from "react";

import type { StudentCaseQueueRow, StudentCaseQueueSort } from "@/lib/platform-student-case-queue-contract";

import type { BulkSelection } from "../queue/Bulk";

/**
 * Что нужно ячейкам таблицы «Студентов» от самой таблицы: колонки — одни и те же функции для всех строк, а выбор, адреса и
 * сегодняшний день ячейки читают отсюда (состояние ячейки не теряется, когда меняется выбор или список).
 */
export type StudentsTableValue = Readonly<{
  today: string;
  now: Date;
  sort: StudentCaseQueueSort;
  /** Колонки «Куратор» нет (вид «Мои»): исключения куратора переходят в сигналы. */
  curatorColumn: boolean;
  openKey: string | null;
  /** Адрес очереди с открытой записью (`?open=`) и адрес дела с возвратом в эту очередь. */
  openHref: (row: StudentCaseQueueRow) => string;
  caseHref: (row: StudentCaseQueueRow) => string;
  selection: BulkSelection | null;
  selectable: ReadonlySet<string>;
}>;

const StudentsTableContext = createContext<StudentsTableValue | null>(null);
export const StudentsTableProvider = StudentsTableContext.Provider;

export function useStudentsTable(): StudentsTableValue {
  const value = useContext(StudentsTableContext);
  if (!value) throw new Error("Students table cell rendered outside the table.");
  return value;
}
