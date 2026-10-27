"use client";

import { FilePlusIcon, FolderCogIcon, FolderPlusIcon } from "lucide-react";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sheetEscape } from "@/components/v3/panel/sheet-escape";
import {
  archivePlatformCompanyFileFolderAction, createPlatformCompanyFileAction, createPlatformCompanyFileFolderAction,
  movePlatformCompanyFileFolderAction, renamePlatformCompanyFileFolderAction,
} from "@/lib/platform-company-file-actions";

import { folderValue, type KnowledgeFolder } from "../../FileManager";
import { FileActionForm } from "./FileActionForm";
import { DestinationSelect } from "./FileSheetBody";

/** «Новая папка» в текущей папке компании: то же действие и поля (`parent_folder_id`, `name`), что у прежней формы. */
export function CreateFolderSheet({ parent, requestId }: Readonly<{ parent: KnowledgeFolder; requestId: string }>) {
  return (
    <DetailSheet title="Новая папка" onEscapeKeyDown={sheetEscape} trigger={<Button variant="outline"><FolderPlusIcon aria-hidden="true" /><span className="sr-only md:not-sr-only">Новая папка</span></Button>}>
      <div data-testid="v3-company-create-folder-form">
        <FileActionForm key={requestId} action={createPlatformCompanyFileFolderAction} requestId={requestId} itemKind="folder" itemId={null}
          hidden={{ parent_folder_id: folderValue(parent) }} submit="Создать" pending="Создаём…">
          <div className="grid gap-1.5"><Label htmlFor="folder-name">Название папки</Label><Input id="folder-name" required name="name" maxLength={255} data-testid="v3-company-folder-name" /></div>
        </FileActionForm>
      </div>
    </DetailSheet>
  );
}

/** «Новый файл» — главное действие раздела, пока открыта папка компании и есть право: единственная красная кнопка. */
export function CreateFileSheet({ parent, requestId }: Readonly<{ parent: KnowledgeFolder; requestId: string }>) {
  return (
    <DetailSheet title="Новый файл" onEscapeKeyDown={sheetEscape} trigger={<Button><FilePlusIcon aria-hidden="true" />Новый файл</Button>}>
      <div data-testid="v3-company-create-file-form">
        <FileActionForm key={requestId} action={createPlatformCompanyFileAction} requestId={requestId} itemKind="file" itemId={null}
          hidden={{ folder_id: folderValue(parent) }} submit="Создать" pending="Создаём…">
          <div className="grid gap-1.5"><Label htmlFor="file-name">Название файла</Label><Input id="file-name" required name="display_name" maxLength={255} data-testid="v3-company-file-name" /></div>
        </FileActionForm>
      </div>
    </DetailSheet>
  );
}

/** Управление открытой папкой компании: переименовать, переместить, удалить пустую. Папка студентов и корень компании не меняются. */
export function ManageFolderSheet({ folder, destinations, hasChildren }: Readonly<{ folder: KnowledgeFolder; destinations: readonly KnowledgeFolder[]; hasChildren: boolean }>) {
  const { renameRequestId, moveRequestId, archiveRequestId, version } = folder;
  if (folder.kind !== "company" || !version || !renameRequestId || !moveRequestId || !archiveRequestId) return null;
  const hidden = { folder_id: folder.id, expected_version: version };
  return (
    <DetailSheet title="Управление папкой" description={folder.name} onEscapeKeyDown={sheetEscape} trigger={<Button variant="outline"><FolderCogIcon aria-hidden="true" /><span className="sr-only md:not-sr-only">Управление папкой</span></Button>}>
      <div className="grid gap-6" data-testid="v3-company-folder-controls" data-folder-id={folder.id}>
        <FileActionForm action={renamePlatformCompanyFileFolderAction} requestId={renameRequestId} itemKind="folder" itemId={folder.id} hidden={hidden} submit="Переименовать" pending="Сохраняем…">
          <div className="grid gap-1.5"><Label htmlFor="folder-rename">Новое название</Label><Input id="folder-rename" required name="name" maxLength={255} defaultValue={folder.name} /></div>
        </FileActionForm>
        <FileActionForm action={movePlatformCompanyFileFolderAction} requestId={moveRequestId} itemKind="folder" itemId={folder.id} hidden={hidden} submit="Переместить" pending="Перемещаем…">
          <DestinationSelect id="folder-move" name="new_parent_folder_id" value={folder.parentId} folders={destinations} />
        </FileActionForm>
        <div className="grid gap-2 border-t border-border pt-4">
          <FileActionForm action={archivePlatformCompanyFileFolderAction} requestId={archiveRequestId} itemKind="folder" itemId={folder.id} hidden={hidden}
            submit="Удалить пустую папку" pending="Удаляем…" confirm={`Удалить «${folder.name}»? Запись пропадёт из списка.`} disabled={hasChildren} />
          {hasChildren ? <p className="t-body-compact text-fg-2">Сначала переместите или удалите содержимое.</p> : null}
        </div>
      </div>
    </DetailSheet>
  );
}
