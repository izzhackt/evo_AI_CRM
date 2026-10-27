import { DownloadIcon, FolderIcon } from "lucide-react";

import type { DataTableColumn } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { plural } from "@/components/v3/queue/bulk-run";

import type { FileEntry } from "./files-model";

const RECORDS = { one: "запись", few: "записи", many: "записей" } as const;

/**
 * Колонки «Документов»: выбор для выгрузки (если есть что выбрать), название (под папкой — число записей, под найденным файлом — папка, на телефоне
 * под файлом — размер), размер файла, «Скачать» (если есть что скачать). Колонки выбора и скачивания узкие (`meta.fit`).
 */
export function fileColumns({ selectable, downloadable, selected, allChosen, onToggle, onToggleAll }: Readonly<{
  selectable: boolean;
  downloadable: boolean;
  selected: ReadonlySet<string>;
  allChosen: boolean;
  onToggle: (version: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
}>): DataTableColumn<FileEntry>[] {
  return [
    ...(selectable ? [{
      id: "select", enableSorting: false, enableHiding: false, enableGlobalFilter: false, meta: { label: "Выбрать", mobile: "hide", fit: true },
      header: () => <Checkbox aria-label="Выбрать документы на экране" checked={allChosen} onCheckedChange={(on) => onToggleAll(on === true)} />,
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
              {entry.kind === "folder" ? <span className="block t-meta text-fg-3">{entry.count} {plural(entry.count, RECORDS)}</span> : null}
              {entry.kind === "file" && entry.file.size ? <span className="block t-meta text-fg-3 md:hidden">{entry.file.size}</span> : null}
            </span>
          </span>
        );
      },
    },
    {
      // Размер есть только у файла (null не рисуется); у папки число записей стоит под названием. На телефоне размер — под названием файла.
      id: "size", header: "Размер", enableGlobalFilter: false, enableSorting: false, meta: { label: "Размер", mobile: "hide" },
      accessorFn: (entry) => (entry.kind === "file" ? entry.file.size : null),
      cell: ({ row }) => { const size = row.getValue("size"); return typeof size === "string" ? <span className="t-meta text-fg-3 tabular-nums">{size}</span> : null; },
    },
    ...(downloadable ? [{
      id: "download", header: () => <span className="sr-only">Скачать</span>, enableSorting: false, enableHiding: false, enableGlobalFilter: false,
      meta: { label: "Скачать", mobile: "hide", align: "end", fit: true },
      cell: ({ row }) => {
        const entry = row.original;
        return entry.kind === "file" && entry.file.downloadHref ? (
          <a href={entry.file.downloadHref} aria-label={`Скачать: ${entry.name}`} className="inline-flex size-11 items-center justify-center rounded-ctl text-fg-2 hover:bg-surface-2 hover:text-fg"><DownloadIcon className="size-[18px]" aria-hidden="true" /></a>
        ) : null;
      },
    } satisfies DataTableColumn<FileEntry>] : []),
  ];
}
