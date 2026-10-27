import { DownloadIcon, FolderIcon } from "lucide-react";

import type { DataTableColumn } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { plural } from "@/components/v3/queue/bulk-run";

import type { FileEntry } from "./files-model";

const RECORDS = { one: "запись", few: "записи", many: "записей" } as const;

/** Колонки «Документов»: выбор для выгрузки (если выгрузка есть), название с папкой при поиске, размер или число записей, «Скачать». */
export function fileColumns({ selectable, selected, exportableVersions, onToggle, onToggleAll }: Readonly<{
  selectable: boolean;
  selected: ReadonlySet<string>;
  exportableVersions: readonly string[];
  onToggle: (version: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
}>): DataTableColumn<FileEntry>[] {
  const all = exportableVersions.length > 0 && exportableVersions.every((version) => selected.has(version));
  return [
    ...(selectable ? [{
      id: "select", enableSorting: false, enableHiding: false, enableGlobalFilter: false, meta: { label: "Выбрать", mobile: "hide" },
      header: () => <Checkbox aria-label="Выбрать документы на экране" disabled={exportableVersions.length === 0} checked={all} onCheckedChange={(on) => onToggleAll(on === true)} />,
      cell: ({ row }) => {
        const entry = row.original;
        if (entry.kind !== "file") return null;
        const version = entry.file.currentVersionId && entry.file.downloadHref ? entry.file.currentVersionId : null;
        return <Checkbox aria-label={`Выбрать ${entry.name}`} disabled={!version} checked={version !== null && selected.has(version)} onCheckedChange={(on) => { if (version) onToggle(version, on === true); }} />;
      },
    } satisfies DataTableColumn<FileEntry>] : []),
    {
      id: "name", header: "Документ", accessorFn: (entry) => entry.name, enableHiding: false, sortFn: "text", meta: { label: "Документ", mobile: "title" },
      cell: ({ row }) => {
        const entry = row.original;
        const version = selectable && entry.kind === "file" && entry.file.currentVersionId && entry.file.downloadHref ? entry.file.currentVersionId : null;
        return (
          <span className="flex min-w-0 items-start gap-2">
            {/* Телефон: выбор для выгрузки стоит в заголовке карточки (колонка «Выбрать» там скрыта). */}
            {version ? <Checkbox className="mt-0.5 md:hidden" aria-label={`Выбрать ${entry.name}`} checked={selected.has(version)} onCheckedChange={(on) => onToggle(version, on === true)} /> : null}
            {entry.kind === "folder" ? <FolderIcon className="mt-0.5 size-[18px] shrink-0 text-fg-3" aria-hidden="true" /> : null}
            <span className="min-w-0">
              <span className="block font-medium text-fg [overflow-wrap:anywhere]">{entry.name}</span>
              {entry.kind === "file" && entry.place ? <span className="block t-meta text-fg-3">{entry.place}</span> : null}
            </span>
          </span>
        );
      },
    },
    {
      id: "size", header: "Размер", enableGlobalFilter: false, enableSorting: false, meta: { label: "Размер" },
      accessorFn: (entry) => (entry.kind === "file" ? entry.file.size ?? "—" : `${entry.count} ${plural(entry.count, RECORDS)}`),
      cell: ({ row }) => <span className="t-meta text-fg-3 tabular-nums">{row.getValue("size")}</span>,
    },
    {
      id: "download", header: () => <span className="sr-only">Скачать</span>, enableSorting: false, enableHiding: false, enableGlobalFilter: false,
      meta: { label: "Скачать", mobile: "hide", align: "end" },
      cell: ({ row }) => {
        const entry = row.original;
        return entry.kind === "file" && entry.file.downloadHref ? (
          <a href={entry.file.downloadHref} aria-label={`Скачать: ${entry.name}`} className="inline-flex size-11 items-center justify-center rounded-ctl text-fg-2 hover:bg-surface-2 hover:text-fg"><DownloadIcon className="size-[18px]" aria-hidden="true" /></a>
        ) : null;
      },
    },
  ];
}
