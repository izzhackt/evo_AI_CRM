"use client";

import { DownloadIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { KnowledgeFolder } from "../../FileManager";
import { CreateFileSheet, CreateFolderSheet, ManageFolderSheet } from "./FolderSheets";

/**
 * Строка инструментов «Документов»: поиск по названиям, «Выгрузить …» (прежнее окно выгрузки), «Выбрано» со снятием и — в папке
 * компании у того, кто управляет файлами, — «Новая папка», «Новый файл» (красная, главное действие) и «Управление папкой».
 */
export function FilesToolbar({
  query, onQuery, exportLabel, onExport, selectedCount, onExportSelected, onClearSelection,
  canManage, current, destinations, hasChildren, createFolderRequestId, createFileRequestId,
}: Readonly<{
  query: string;
  onQuery: (value: string) => void;
  exportLabel: string;
  onExport: () => void;
  selectedCount: number;
  onExportSelected: () => void;
  onClearSelection: () => void;
  canManage: boolean;
  current: KnowledgeFolder | null;
  destinations: readonly KnowledgeFolder[];
  hasChildren: boolean;
  createFolderRequestId: string;
  createFileRequestId: string;
}>) {
  const manage = canManage && current && (current.kind === "company-root" || current.kind === "company");
  return (
    <>
      <div className="relative min-w-0 flex-1 basis-56">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden="true" />
        <Input type="search" data-company-file-search value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Поиск документов" aria-label="Поиск документов" className="pl-9" />
      </div>
      <Button variant="outline" onClick={onExport} aria-haspopup="dialog"><DownloadIcon aria-hidden="true" /><span className="sr-only md:not-sr-only">{exportLabel}</span></Button>
      {selectedCount > 0 ? (
        <>
          <span className="t-label text-fg-2" role="status">Выбрано: {selectedCount}</span>
          <Button variant="outline" onClick={onExportSelected} aria-haspopup="dialog">Выгрузить выбранные документы</Button>
          <Button variant="ghost" onClick={onClearSelection}>Снять выделение</Button>
        </>
      ) : null}
      {manage && current ? (
        <>
          <ManageFolderSheet key={`${current.id}:${current.version ?? "root"}`} folder={current} destinations={destinations} hasChildren={hasChildren} />
          {/* Ключ — request_id: после сохранения страница приносит новый, панель закрывается и список виден (как «Новый шаблон»). */}
          <CreateFolderSheet key={createFolderRequestId} parent={current} requestId={createFolderRequestId} />
          <CreateFileSheet key={createFileRequestId} parent={current} requestId={createFileRequestId} />
        </>
      ) : null}
    </>
  );
}
