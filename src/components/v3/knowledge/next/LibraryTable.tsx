"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { DataTable, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { KnowledgeItem } from "@/lib/knowledge-library-contract";

import type { KnowledgeData } from "./useKnowledgeData";
import { itemHref, libraryColumns } from "./LibraryColumns";

/**
 * Список материалов папки, поиска или состояния (корзина, архив…): `DataTable` над теми же 100 строками сервера. Поиск ведёт
 * сервер (поле над таблицей), сортировка по заголовку — по показанным строкам; «Показать ещё» читает следующую страницу курсором.
 */
export function LibraryTable({ data, toggle, toggleAll, title }: Readonly<{
  data: KnowledgeData;
  toggle: (id: string, on: boolean) => void;
  toggleAll: (on: boolean) => void;
  title: string;
}>) {
  const router = useRouter();
  const { rows, shown, error, loading, page, folders, selected, view, search, loadedAt, href, searchAll } = data;
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder] as const)), [folders]);
  const columns = useMemo(() => libraryColumns({
    selected, onToggle: toggle, onToggleAll: toggleAll, shownIds: rows.map((item) => item.id), href, folderById,
    // В корзине, архиве и поиске строка без пути не отличает две одноимённые папки: путь — второй строкой.
    showPath: view !== "list" || Boolean(search.trim()), searchAll, loadedAt,
  }), [selected, toggle, toggleAll, rows, href, folderById, view, search, searchAll, loadedAt]);
  if (error && rows.length === 0) return null;
  return (
    <div className="grid gap-2" aria-busy={loading}>
      <DataTable<KnowledgeItem>
        label={`Материалы: ${title}`}
        data={rows}
        columns={columns}
        getRowId={(item) => item.id}
        getRowLabel={(item) => item.title}
        onRowClick={(item) => router.push(itemHref(item, href))}
        searchPlaceholder={null}
        paginate={false}
        columnMenu={false}
        loading={!shown && !error}
        partial={Boolean(page?.hasMore)}
        empty={<EmptyState title={search ? "В материалах библиотеки ничего не найдено" : view === "trash" ? "Корзина пуста" : "Материалов пока нет"} />}
      />
      {shown && page?.hasMore ? <div><Button variant="ghost" disabled={loading} onClick={() => void data.more()}>{loading ? "Загружаем…" : "Показать ещё"}</Button></div> : null}
    </div>
  );
}
