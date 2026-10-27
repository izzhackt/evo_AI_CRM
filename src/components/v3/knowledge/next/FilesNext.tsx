"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DataTable, DetailSheet, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { sheetEscape } from "@/components/v3/panel/sheet-escape";

import type { KnowledgeFile, KnowledgeFolder } from "../../FileManager";
import { KnowledgeExport } from "../KnowledgeExport";
import { FilesBreadcrumb } from "./FilesBreadcrumb";
import { focusAfterOpen } from "./focus-after-open";
import { FilesToolbar } from "./FilesToolbar";
import { FileSheetBody } from "./FileSheetBody";
import { fileColumns } from "./files-columns";
import { filesModel, folderExportOf, selectedExportOf, type FileEntry } from "./files-model";
import { PhoneSelectAll } from "./PhoneSelectAll";

/**
 * «Документы» в новом виде: путь, поиск и таблица (подпапки и файлы папки; поиск — по названиям файлов во всех папках, как раньше).
 * Подпапка открывается нажатием на строку, файл — панелью с управлением (заменить, переименовать, переместить, удалить) и «Скачать».
 * Данные, права, действия и request_id приходят с сервера теми же, что у `FileManager`; выгрузка — прежнее окно `KnowledgeExport`.
 */
export function FilesNext({ folders, files, canManage, canUpload, createFolderRequestId, createFileRequestId, rootLabel = "Документы" }: Readonly<{
  folders: readonly KnowledgeFolder[];
  files: readonly KnowledgeFile[];
  canManage: boolean;
  canUpload: boolean;
  createFolderRequestId: string;
  createFileRequestId: string;
  rootLabel?: string;
}>) {
  const params = useSearchParams();
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const requested = params.get("documentFolder");
    return requested && folders.some((folder) => folder.id === requested) ? requested : null;
  });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"folder" | "selected" | null>(null);
  const model = useMemo(() => filesModel(folders, files, currentId, query), [folders, files, currentId, query]);
  const openFile = files.find((file) => file.id === openFileId) ?? null;
  const exportable = useMemo(() => model.exportable.map((file) => file.currentVersionId!), [model.exportable]);
  const frame = useRef<HTMLDivElement>(null);
  const currentCrumb = useRef<HTMLSpanElement>(null);
  const refocus = useRef(false);
  // Нажатая строка или звено пути пропадает из разметки: после открытия фокус ставится на название папки, а не падает на страницу.
  const openFolder = (id: string | null) => { refocus.current = true; setSelected(new Set()); setCurrentId(id); setQuery(""); };
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    focusAfterOpen(frame.current, currentCrumb.current);
  }, [currentId]);
  const toggleAll = useCallback((on: boolean) => setSelected((old) => { const next = new Set(old); for (const version of exportable) { if (on) next.add(version); else next.delete(version); } return next; }), [exportable]);
  const allChosen = exportable.length > 0 && exportable.every((version) => selected.has(version));
  const columns = useMemo(() => fileColumns({
    // Выбирать и скачивать нечего (корень из одних папок) — этих колонок нет, а не пустые.
    selectable: exportable.length > 0, downloadable: model.entries.some((entry) => entry.kind === "file" && entry.file.downloadHref), selected, allChosen,
    onToggle: (version, on) => setSelected((old) => { const next = new Set(old); if (on) next.add(version); else next.delete(version); return next; }),
    onToggleAll: toggleAll,
  }), [selected, exportable, allChosen, model.entries, toggleAll]);
  const open = (entry: FileEntry) => (entry.kind === "folder" ? openFolder(entry.folder.id) : setOpenFileId(entry.file.id));
  return (
    <div ref={frame} className="grid min-w-0 gap-3" data-testid="v3-documents-next">
      <FilesBreadcrumb rootLabel={rootLabel} path={model.path} onOpen={openFolder} currentRef={currentCrumb} />
      {exportable.length > 0 ? <PhoneSelectAll label="Выбрать документы на экране" text="Выбрать документы" checked={allChosen} onChange={toggleAll} /> : null}
      <DataTable
        label="Таблица документов"
        data={model.entries}
        columns={columns}
        getRowId={(entry) => entry.key}
        getRowLabel={(entry) => entry.name}
        onRowClick={open}
        searchPlaceholder={null}
        paginate={false}
        columnMenu={false}
        toolbar={(
          <FilesToolbar
            query={query} onQuery={setQuery} exportLabel={model.current ? "Выгрузить папку" : "Выгрузить все документы"} onExport={() => setExporting("folder")}
            selectedCount={selected.size} onExportSelected={() => setExporting("selected")} onClearSelection={() => setSelected(new Set())}
            canManage={canManage} current={model.current} destinations={model.destinations} hasChildren={model.current ? model.count(model.current.id) > 0 : false}
            createFolderRequestId={createFolderRequestId} createFileRequestId={createFileRequestId}
          />
        )}
        empty={<EmptyState title={model.needle ? "Документы не найдены." : "В этой папке документов нет."} />}
      />
      <DetailSheet
        open={openFile !== null}
        onOpenChange={(next) => { if (!next) setOpenFileId(null); }}
        onEscapeKeyDown={sheetEscape}
        title={openFile?.name ?? "Документ"}
        description={openFile?.size ?? undefined}
        footer={openFile?.downloadHref ? <Button variant="outline" asChild><a href={openFile.downloadHref}>Скачать</a></Button> : undefined}
      >
        {openFile ? <FileSheetBody key={`${openFile.id}:${openFile.version ?? "unversioned"}`} file={openFile} destinations={model.companyDestinations} canManage={canManage} canUpload={canUpload} /> : null}
      </DetailSheet>
      <KnowledgeExport open={exporting === "folder"} onOpenChange={(next) => { if (!next) setExporting(null); }} canonical={folderExportOf(model.current)} label={model.current ? "Выгрузить папку" : "Выгрузить все документы"} />
      <KnowledgeExport open={exporting === "selected"} onOpenChange={(next) => { if (!next) setExporting(null); }} canonical={selectedExportOf(files, selected)} label="Выгрузить выбранные документы" />
    </div>
  );
}
