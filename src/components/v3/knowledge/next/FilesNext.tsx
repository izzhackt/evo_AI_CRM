"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { DataTable, DetailSheet, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";

import type { KnowledgeFile, KnowledgeFolder } from "../../FileManager";
import { KnowledgeExport } from "../KnowledgeExport";
import { FilesBreadcrumb } from "./FilesBreadcrumb";
import { FilesToolbar } from "./FilesToolbar";
import { FileSheetBody } from "./FileSheetBody";
import { fileColumns } from "./files-columns";
import { filesModel, folderExportOf, selectedExportOf, type FileEntry } from "./files-model";

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
  const openFolder = (id: string | null) => { setSelected(new Set()); setCurrentId(id); setQuery(""); };
  const columns = useMemo(() => fileColumns({
    selectable: true, selected, exportableVersions: exportable,
    onToggle: (version, on) => setSelected((old) => { const next = new Set(old); if (on) next.add(version); else next.delete(version); return next; }),
    onToggleAll: (on) => setSelected((old) => { const next = new Set(old); for (const version of exportable) { if (on) next.add(version); else next.delete(version); } return next; }),
  }), [selected, exportable]);
  const open = (entry: FileEntry) => (entry.kind === "folder" ? openFolder(entry.folder.id) : setOpenFileId(entry.file.id));
  return (
    <div className="grid min-w-0 gap-3" data-testid="v3-documents-next">
      <FilesBreadcrumb rootLabel={rootLabel} path={model.path} onOpen={openFolder} />
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
