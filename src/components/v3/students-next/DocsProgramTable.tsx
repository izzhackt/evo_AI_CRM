"use client";

import { useMemo, useState } from "react";

import { DataTable, StatusBadge, type DataTableColumn } from "@/components/kit";
import type { ApplicationDocumentOwner, ApplicationDocumentQueueItem } from "@/lib/portal/application-documents";
import { getPortalStrings } from "@/lib/portal/i18n";

import { docsWaiting } from "../students/students-queue-view";
import { WaitingWord } from "./DocsCells";
import { ProgramDocSheet } from "./ProgramDocSheet";
import { deadlineText, programOf } from "./docs-program-model";

function columns(today: string): DataTableColumn<ApplicationDocumentQueueItem>[] {
  const strings = getPortalStrings("programDocuments", "ru");
  return [
    { id: "document", header: "Документ", accessorFn: (item) => `${item.studentDisplayName} ${item.requirementLabel}`, sortFn: "text", enableHiding: false, meta: { label: "Документ", mobile: "title" },
      cell: ({ row }) => {
        const item = row.original;
        const deadline = item.deadline ? deadlineText(item.deadline, today) : null;
        return (
          <span className="block min-w-0 text-start">
            <span className="block break-words t-item text-fg">{item.studentDisplayName}<span className="font-normal text-fg-3"> · </span>{item.requirementLabel}</span>
            <span className="block break-words t-meta text-fg-2">{programOf(item)}{deadline ? <> · срок <time dateTime={item.deadline!.date} title={deadline.full} className="font-mono tabular-nums">{deadline.short}</time></> : null}</span>
            {/* Документ отправлен по прежней редакции требований — это надо увидеть до решения. */}
            {!item.isCurrentRequirement ? <StatusBadge label={strings.olderRequirement} tone="warn" /> : null}
          </span>
        );
      } },
    { id: "file", header: "Файл", accessorFn: (item) => item.submission.file.originalFilename, sortFn: "text", meta: { label: "Файл" },
      cell: ({ row }) => <span className="block break-all t-body-compact text-fg">{row.original.submission.file.originalFilename}</span> },
    { id: "sent", header: "Отправлен", accessorFn: (item) => item.submission.submittedAt, sortFn: "text", meta: { label: "Отправлен" },
      cell: ({ row }) => {
        const sent = docsWaiting(row.original.submission.submittedAt, today);
        return sent ? <span className="whitespace-nowrap t-body-compact"><time dateTime={sent.dateTime} className="font-mono tabular-nums text-fg">{sent.day}</time> <span className="text-fg-3">·</span> <WaitingWord waiting={sent} /></span> : null;
      } },
  ];
}

/** Вкладка «Документы программ»: строка открывает панель с файлом и решением. Открытый документ остаётся в панели, пока её не закроют, — подтверждённое решение видно. */
export function DocsProgramTable({ items, owner, canReview, today, returnTo, empty, onOpenId }: Readonly<{
  items: readonly ApplicationDocumentQueueItem[];
  owner: ApplicationDocumentOwner;
  canReview: boolean;
  today: string;
  returnTo: string;
  empty: React.ReactNode;
  /** Какой документ открыт в панели: незавершённые решения остальных повторяет `ProgramDocsRecovery`. */
  onOpenId: (submissionId: string | null) => void;
}>) {
  const defs = useMemo(() => columns(today), [today]);
  const [kept, setKept] = useState<ApplicationDocumentQueueItem | null>(null);
  const [open, setOpen] = useState(false);
  const show = (item: ApplicationDocumentQueueItem | null) => { if (item) setKept(item); setOpen(item !== null); onOpenId(item ? item.submission.submissionId : null); };
  return (
    <>
      <DataTable
        label="Документы программ на проверку"
        data={items}
        columns={defs}
        getRowId={(item) => item.submission.submissionId}
        onRowClick={show}
        getRowLabel={(item) => `${item.studentDisplayName} · ${item.requirementLabel}`}
        searchable={false}
        paginate={false}
        columnMenu={false}
        empty={empty}
      />
      {kept ? <ProgramDocSheet key={kept.submission.submissionId} item={kept} owner={owner} canReview={canReview} today={today} returnTo={returnTo} open={open} onOpenChange={(next) => { if (!next) show(null); }} /> : null}
    </>
  );
}
