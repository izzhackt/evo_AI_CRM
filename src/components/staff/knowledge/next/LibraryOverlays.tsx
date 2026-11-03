"use client";

import { DetailSheet } from "@/components/kit";

import { KnowledgeAssignCase } from "../KnowledgeAssignCase";
import { KnowledgeExport } from "../KnowledgeExport";
import { KnowledgeImport } from "../KnowledgeImport";
import { KnowledgeTree } from "../KnowledgeTree";
import { LibraryDialogs } from "./LibraryDialogs";
import type { KnowledgeActions } from "./useKnowledgeActions";
import type { KnowledgeData } from "./useKnowledgeData";

export type ExportState = "scope" | "all" | "selected" | null;

/**
 * Окна «Базы знаний», которые живут в корне: перенос локальной базы смонтирован всё время (закрытое окно не останавливает идущий
 * перенос), три выгрузки (раздел или папка, вся база, выбранное), «Привязать к делу», «Папки» узкого экрана и окно названия или
 * переноса. Окна выгрузки, переноса и привязки — прежние (`KnowledgeExport`, `KnowledgeImport`, `KnowledgeAssignCase`).
 */
export function LibraryOverlays({ data, actions, fileRef, directoryRef, exportOpen, setExportOpen, exportIds, importOpen, setImportOpen, setImportRunning, assignCase, setAssignCase, treeOpen, setTreeOpen }: Readonly<{
  data: KnowledgeData;
  actions: KnowledgeActions;
  fileRef: React.RefObject<HTMLInputElement | null>;
  directoryRef: React.RefObject<HTMLInputElement | null>;
  exportOpen: ExportState;
  setExportOpen: (value: ExportState) => void;
  exportIds: string[];
  importOpen: boolean;
  setImportOpen: (value: boolean) => void;
  setImportRunning: (value: boolean) => void;
  assignCase: boolean;
  setAssignCase: (value: boolean) => void;
  treeOpen: boolean;
  setTreeOpen: (value: boolean) => void;
}>) {
  const { area, parentId, folders, folderRevision, refresh, reload } = data;
  // Окно, открытое из «⋯», закрылось: фокус — обратно на «⋯» (пункт меню уже скрыт).
  const returnFocus = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="knowledge-more-menu"]')?.focus());
  const close = (which: ExportState) => (open: boolean) => { if (!open && exportOpen === which) { setExportOpen(null); returnFocus(); } };
  return (
    <>
      <input ref={fileRef} type="file" multiple hidden onChange={(event) => { void actions.upload(event.target.files); event.target.value = ""; }} />
      <input ref={directoryRef} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={(event) => { void actions.upload(event.target.files); event.target.value = ""; }} />
      <KnowledgeImport open={importOpen} onClose={() => { setImportOpen(false); returnFocus(); }} onChanged={reload} onRunningChange={setImportRunning} />
      <KnowledgeExport open={exportOpen === "scope"} onOpenChange={close("scope")} ids={parentId ? [parentId] : undefined} area={area} label={parentId ? "Выгрузить папку" : "Выгрузить раздел"} />
      <KnowledgeExport open={exportOpen === "all"} onOpenChange={close("all")} label="Выгрузить всю базу" />
      <KnowledgeExport open={exportOpen === "selected"} onOpenChange={close("selected")} ids={exportIds} label="Выгрузить выбранное" />
      {assignCase && folderRevision === refresh ? <KnowledgeAssignCase items={[...actions.chosen]} folders={folders} onClose={() => setAssignCase(false)} onSaved={reload} /> : null}
      <DetailSheet title="Папки" open={treeOpen} onOpenChange={setTreeOpen}>
        <KnowledgeTree folders={data.folderRevision === null ? null : folders} folderError={data.folderError} onRetryFolders={data.retryFolders} area={area} parentId={parentId} view={data.view}
          section={null} href={data.href} sections={false} onNavigate={() => setTreeOpen(false)} />
      </DetailSheet>
      <LibraryDialogs dialog={actions.dialog} onClose={() => actions.setDialog(null)} onSubmit={actions.submitDialog} busy={actions.busy} error={data.error}
        name={actions.name} onName={actions.setName} targetFolder={actions.targetFolder} onTarget={actions.setTargetFolder} area={area} folders={folders} selected={data.selected} />
    </>
  );
}
