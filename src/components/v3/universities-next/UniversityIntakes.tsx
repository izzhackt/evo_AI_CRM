"use client";

import { ExternalLinkIcon } from "lucide-react";

import { DataTable, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { DueWord } from "../blocks/DueWord";
import type { IntakeRow } from "./university-detail-types";

const COLUMNS: DataTableColumn<IntakeRow>[] = [
  { id: "label", header: "Набор", accessorFn: (row) => row.label, enableSorting: false, enableHiding: false, meta: { label: "Набор", mobile: "title" },
    cell: ({ row }) => (
      <span className="block min-w-0 text-start">
        <span className="block break-words t-body-compact font-medium text-fg">{row.original.label}</span>
        {row.original.start ? <span className="block t-meta text-fg-2">начало <time dateTime={row.original.start.dateTime} className={row.original.start.mono ? "font-mono tabular-nums" : undefined}>{row.original.start.text}</time></span> : null}
      </span>
    ) },
  { id: "deadline", header: "Срок подачи", accessorFn: (row) => row.deadline?.dateTime ?? "9999", enableSorting: false, meta: { label: "Срок подачи" },
    cell: ({ row }) => row.original.deadline ? (
      <span className="block text-start" data-cell="deadline">
        <span className="flex flex-wrap items-baseline gap-x-1.5 t-body-compact">
          <time dateTime={row.original.deadline.dateTime} className="font-mono tabular-nums text-fg">{row.original.deadline.text}</time>
          <DueWord view={row.original.deadline.word} className="text-fg-2" />
        </span>
        {row.original.deadline.zone ? <span className="block t-meta text-fg-3">{row.original.deadline.zone}</span> : null}
      </span>
    ) : <><span aria-hidden="true" className="text-fg-3">—</span><span className="sr-only">не указан</span></> },
  { id: "state", header: "Состояние", accessorFn: (row) => row.state ?? "", enableSorting: false, meta: { label: "Состояние" },
    cell: ({ row }) => (
      <span className="block text-start t-body-compact text-fg-2">
        {row.original.state}
        <span className="block t-meta text-fg-3">проверено <time dateTime={row.original.verified.dateTime} className="font-mono tabular-nums">{row.original.verified.text}</time></span>
      </span>
    ) },
  { id: "source", header: () => <span className="sr-only">Источник</span>, enableSorting: false, meta: { label: "Источник", align: "end" }, accessorFn: () => "",
    cell: ({ row }) => (
      <Button variant="ghost" asChild>
        <a href={row.original.sourceUrl} target="_blank" rel="noopener noreferrer">Источник<ExternalLinkIcon aria-hidden="true" /><span className="sr-only">: {row.original.label} (в новой вкладке)</span></a>
      </Button>
    ) },
];

/** Наборы программы: срок подачи в поясе набора, начало, состояние и ссылка на источник каждого. На телефоне — карточки. */
export function UniversityIntakes({ title, intakes }: Readonly<{ title: string; intakes: readonly IntakeRow[] }>) {
  return <DataTable label={`Наборы: ${title}`} data={intakes} columns={COLUMNS} getRowId={(row) => row.key} searchable={false} paginate={false} columnMenu={false} />;
}
