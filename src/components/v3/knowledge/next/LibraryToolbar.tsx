"use client";

import { ChevronDownIcon, DownloadIcon, FileTextIcon, FolderIcon, FolderOpenIcon, LockIcon, RefreshCwIcon, SearchIcon, UploadIcon, EllipsisIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { KnowledgeArea } from "@/lib/knowledge-library-contract";

import type { KnowledgeView } from "../KnowledgeTree";

/**
 * Строка инструментов «Базы знаний»: поиск по базе (ищет сервер), «Папки» на узком экране, «Создать» — единственная красная кнопка
 * (в корзине, архиве и «На уточнении» её нет: она создавала бы запись в корне раздела, мимо открытого) и «⋯» с выгрузкой и переносом.
 */
export function LibraryToolbar({ search, onSearch, area, view, hasParent, busy, importRunning, onFolders, onCreate, onPickFiles, onPickFolder, onExport, onImport }: Readonly<{
  search: string;
  onSearch: (value: string) => void;
  area: KnowledgeArea;
  view: KnowledgeView;
  hasParent: boolean;
  busy: boolean;
  importRunning: boolean;
  onFolders: () => void;
  onCreate: (kind: "folder" | "page" | "secret") => void;
  onPickFiles: () => void;
  onPickFolder: () => void;
  onExport: (scope: "scope" | "all") => void;
  onImport: () => void;
}>) {
  const secrets = area === "secrets";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="knowledge-toolbar">
      <div className="relative min-w-0 flex-1 basis-full @md/kbl:basis-56">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden="true" />
        <Input type="search" maxLength={240} aria-label="Поиск по базе знаний" placeholder="Найти материал" value={search} onChange={(event) => onSearch(event.target.value)} className="pl-9" />
      </div>
      <Button variant="outline" aria-haspopup="dialog" onClick={onFolders} data-testid="knowledge-tree-open" className="@3xl/kb:hidden"><FolderOpenIcon aria-hidden="true" />Папки</Button>
      {view === "list" ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><Button data-testid="knowledge-create-menu">Создать<ChevronDownIcon aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem onSelect={() => onCreate("folder")}><FolderIcon aria-hidden="true" />Папку</DropdownMenuItem>
            {secrets
              ? <DropdownMenuItem onSelect={() => onCreate("secret")}><LockIcon aria-hidden="true" />Доступ</DropdownMenuItem>
              : <DropdownMenuItem onSelect={() => onCreate("page")}><FileTextIcon aria-hidden="true" />Страницу</DropdownMenuItem>}
            {secrets ? null : <DropdownMenuItem disabled={busy} onSelect={onPickFiles}><UploadIcon aria-hidden="true" />Загрузить файлы</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Ещё действия с базой знаний" data-testid="knowledge-more-menu"><EllipsisIcon aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          {secrets || view !== "list" ? null : <DropdownMenuItem disabled={busy} onSelect={onPickFolder}><UploadIcon aria-hidden="true" />Загрузить папку</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => onExport("scope")}><DownloadIcon aria-hidden="true" />{hasParent ? "Выгрузить папку" : "Выгрузить раздел"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onExport("all")}><DownloadIcon aria-hidden="true" />Выгрузить всю базу</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onImport}><RefreshCwIcon aria-hidden="true" />Перенос локальной базы{importRunning ? " · идёт" : ""}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
