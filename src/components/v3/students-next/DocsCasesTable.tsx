"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { DataTable, type DataTableColumn } from "@/components/kit";
import type { StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";

import { studentsCaseHref, type StudentsDocsView } from "../students/students-queue-view";
import { CuratorName, DocumentsCell, DocsRowMenu, DocsStudentCell } from "./DocsCells";

/** Колонки «Документов дела»: студент (ссылка на документы), документы, куратор, «⋯». Строка открывает документы дела. */
function columns(view: StudentsDocsView, today: string, returnTo: string): DataTableColumn<StudentCaseQueueRow>[] {
  const hrefOf = (row: StudentCaseQueueRow) => studentsCaseHref(row.studentCaseId, { docs: true, returnTo });
  return [
    { id: "student", header: "Студент", accessorFn: (row) => row.studentDisplayName, sortFn: "text", enableHiding: false,
      meta: { label: "Студент", mobile: "title", opensRow: true }, cell: ({ row }) => <DocsStudentCell row={row.original} href={hrefOf(row.original)} /> },
    { id: "documents", header: "Документы", enableSorting: false, accessorFn: (row) => row.documents?.approved ?? 0,
      meta: { label: "Документы" }, cell: ({ row }) => <DocumentsCell row={row.original} view={view} today={today} /> },
    { id: "curator", header: "Куратор", accessorFn: (row) => row.currentCuratorDisplayName ?? "", sortFn: "text",
      meta: { label: "Куратор" }, cell: ({ row }) => <CuratorName name={row.original.currentCuratorDisplayName} /> },
    { id: "more", header: () => <span className="sr-only">Ещё</span>, enableSorting: false, enableHiding: false, accessorFn: () => "",
      meta: { label: "Ещё", align: "end" }, cell: ({ row }) => <DocsRowMenu row={row.original} returnTo={returnTo} /> },
  ];
}

/** Дела вкладки EVO Docs. Сервер ограничил чтение (по 100) и отобрал дела вкладки, поэтому своих страниц у таблицы нет. */
export function DocsCasesTable({ rows, view, today, returnTo, toolbar, empty }: Readonly<{
  rows: readonly StudentCaseQueueRow[];
  view: StudentsDocsView;
  today: string;
  /** Адрес этой вкладки: «К списку EVO Docs» из дела возвращает сюда. */
  returnTo: string;
  toolbar: React.ReactNode;
  empty: React.ReactNode;
}>) {
  const router = useRouter();
  const defs = useMemo(() => columns(view, today, returnTo), [view, today, returnTo]);
  return (
    <DataTable
      label="Дела EVO Docs"
      data={rows}
      columns={defs}
      getRowId={(row) => row.studentCaseId}
      onRowClick={(row) => router.push(studentsCaseHref(row.studentCaseId, { docs: true, returnTo }))}
      getRowLabel={(row) => row.studentDisplayName}
      searchable={false}
      paginate={false}
      columnMenu={false}
      toolbar={toolbar}
      empty={empty}
    />
  );
}
