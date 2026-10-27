import Link from "next/link";
import { FileCheckIcon, FileTextIcon, FolderIcon, LockIcon } from "lucide-react";

import type { DataTableColumn } from "@/components/kit";
import { StatusBadge } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import type { KnowledgeItem } from "@/lib/knowledge-library-contract";

import { knowledgeDay } from "../knowledge-look";
import { KIND_NAMES, itemPathLabel, type KnowledgeHref } from "./library-model";

const ICONS = { folder: FolderIcon, page: FileTextIcon, file: FileCheckIcon, secret: LockIcon } as const;

/** Адрес записи: папка открывает свой список, остальное — материал в папке (`item`). */
export function itemHref(item: KnowledgeItem, href: KnowledgeHref): string {
  return item.kind === "folder" ? href({ area: item.area, folder: item.id }) : href({ area: item.area, folder: item.parent_id, item: item.id });
}

/**
 * Колонки списка материалов: выбор, название (ссылка с значком, путь в корзине, архиве и поиске, «На уточнении»), тип и дата
 * изменения («ДД.ММ» по Бишкеку). Ссылка-название открывает материал и принимает клавиатуру строки (`data-queue-open`).
 */
export function libraryColumns({ selected, onToggle, onToggleAll, shownIds, href, folderById, showPath, searchAll, loadedAt }: Readonly<{
  selected: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  shownIds: readonly string[];
  href: KnowledgeHref;
  folderById: ReadonlyMap<string, KnowledgeItem>;
  showPath: boolean;
  searchAll: boolean;
  loadedAt: Date | null;
}>): DataTableColumn<KnowledgeItem>[] {
  return [
    {
      id: "select", enableSorting: false, enableHiding: false, enableGlobalFilter: false, meta: { label: "Выбрать", mobile: "hide", fit: true },
      header: () => <Checkbox aria-label="Выбрать показанные материалы" checked={shownIds.length > 0 && shownIds.every((id) => selected.has(id))} onCheckedChange={(on) => onToggleAll(on === true)} />,
      cell: ({ row }) => <Checkbox aria-label={`Выбрать: ${row.original.title}`} checked={selected.has(row.original.id)} onCheckedChange={(on) => onToggle(row.original.id, on === true)} />,
    },
    {
      id: "title", header: "Название", accessorFn: (item) => item.title, enableHiding: false, sortFn: "text", meta: { label: "Название", mobile: "title", opensRow: true },
      cell: ({ row }) => {
        const item = row.original;
        const Icon = ICONS[item.kind];
        const path = showPath ? itemPathLabel(item, folderById, searchAll) : "";
        return (
          <span className="block min-w-0">
            <span className="flex min-w-0 items-start gap-2">
              {/* Телефон: выбор стоит в заголовке карточки (колонка «Выбрать» там скрыта). */}
              <Checkbox className="mt-3 md:hidden" aria-label={`Выбрать: ${item.title}`} checked={selected.has(item.id)} onCheckedChange={(on) => onToggle(item.id, on === true)} />
              <Link href={itemHref(item, href)} data-queue-open="" className="flex min-h-11 min-w-0 flex-1 items-start gap-2 py-2 font-medium text-fg underline-offset-4 hover:underline">
                <Icon className="mt-0.5 size-[18px] shrink-0 text-fg-3" aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
              </Link>
            </span>
            {path ? <span className="block ps-[3.375rem] t-meta text-fg-3 md:ps-[1.625rem] [overflow-wrap:anywhere]">{path}</span> : null}
            {item.review_question ? <span className="mt-1 block ps-[3.375rem] md:ps-[1.625rem]"><StatusBadge label="На уточнении" tone="warn" /></span> : null}
          </span>
        );
      },
    },
    { id: "kind", header: "Тип", accessorFn: (item) => KIND_NAMES[item.kind], meta: { label: "Тип", mobile: "hide" } },
    {
      id: "updated", header: "Изменено", accessorFn: (item) => item.updated_at, enableGlobalFilter: false, sortFn: "text", meta: { label: "Изменено", align: "end" },
      cell: ({ row }) => {
        const day = loadedAt ? knowledgeDay(row.original.updated_at, loadedAt) : null;
        return day ? <time dateTime={row.original.updated_at} className="font-mono tabular-nums text-fg-2">{day}</time> : null;
      },
    },
  ];
}
