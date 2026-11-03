"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { StatusBadge } from "@/components/kit";
import { DataTable, type DataTableColumn } from "@/components/kit";
import { packageStrings } from "@/components/portal/applicationPackages/strings";
import type { ApplicationPackageQueueItem } from "@/lib/portal/application-packages";

import { QueueList } from "../list-next/QueueList";
import { docsWaiting, russianPlural, studentsCaseHref } from "../students/students-queue-view";
import { WaitingWord } from "./DocsCells";

const NBSP = " ";
const hrefOf = (item: ApplicationPackageQueueItem, returnTo: string) => `${studentsCaseHref(item.studentCaseId, { docs: true, tab: "route", returnTo })}#preparation-${item.applicationId}`;
const programOf = (item: ApplicationPackageQueueItem) => [item.program.universityTitle, item.program.programTitle].filter(Boolean).join(" · ");

function columns(today: string, returnTo: string): DataTableColumn<ApplicationPackageQueueItem>[] {
  const words = packageStrings("ru");
  return [
    // Название — ссылка к подготовке программы (область — вся ячейка): единственная остановка клавиатуры строки и цель клавиш списка.
    { id: "student", header: "Студент", accessorFn: (item) => item.studentDisplayName, sortFn: "text", enableHiding: false, meta: { label: "Студент", mobile: "title", opensRow: true },
      cell: ({ row }) => (
        <div data-queue-row={row.original.package.packageId} className="relative z-0 min-w-0 py-0.5">
          <Link href={hrefOf(row.original, returnTo)} data-queue-open="" aria-label={`Открыть документы: ${row.original.studentDisplayName}, ${programOf(row.original)}`}
            className="line-clamp-2 break-words py-0.5 t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline">{row.original.studentDisplayName}</Link>
        </div>
      ) },
    { id: "package", header: "Комплект", accessorFn: programOf, sortFn: "text", meta: { label: "Комплект" },
      cell: ({ row }) => {
        const item = row.original;
        const count = item.package.itemCount;
        return (
          <span className="block min-w-0 text-start">
            <span className="line-clamp-2 break-words t-body-compact font-medium text-fg" title={programOf(item)}>{programOf(item)}</span>
            <span className="block t-meta text-fg-2">{count}{NBSP}{russianPlural(count, "документ", "документа", "документов")} · Набор: {item.program.intakeLabel}</span>
            {/* Комплект собран по прежней редакции требований — это надо увидеть до проверки. */}
            {!item.package.isCurrentRequirements ? <StatusBadge label={words.older} tone="warn" wrap /> : null}
          </span>
        );
      } },
    { id: "sent", header: "Отправлен", accessorFn: (item) => item.package.submittedAt ?? "", sortFn: "text", meta: { label: "Отправлен" },
      cell: ({ row }) => {
        const sent = docsWaiting(row.original.package.submittedAt, today);
        return sent ? <span className="whitespace-nowrap t-body-compact"><time dateTime={sent.dateTime} className="font-mono tabular-nums text-fg">{sent.day}</time> <span className="text-fg-3">·</span> <WaitingWord waiting={sent} /></span> : null;
      } },
  ];
}

/** Вкладка «Комплекты»: комплекты, отправленные на проверку EVO и ещё без решения. Строка ведёт к подготовке программы, где комплект проверяется. */
export function DocsPackagesTable({ items, today, returnTo, empty }: Readonly<{ items: readonly ApplicationPackageQueueItem[]; today: string; returnTo: string; empty: React.ReactNode }>) {
  const router = useRouter();
  const defs = useMemo(() => columns(today, returnTo), [today, returnTo]);
  return (
    <QueueList>
      <DataTable
        label="Комплекты на проверку"
        data={items}
        columns={defs}
        getRowId={(item) => item.package.packageId}
        onRowClick={(item) => router.push(hrefOf(item, returnTo))}
        getRowLabel={(item) => `${item.studentDisplayName}, ${programOf(item)}`}
        searchable={false}
        paginate={false}
        columnMenu={false}
        empty={empty}
      />
    </QueueList>
  );
}
