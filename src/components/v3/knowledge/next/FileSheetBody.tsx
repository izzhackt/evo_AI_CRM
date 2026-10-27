"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  archivePlatformCompanyFileAction, movePlatformCompanyFileAction, renamePlatformCompanyFileAction,
} from "@/lib/platform-company-file-actions";

import { COMPANY_ROOT_ID, folderValue, type KnowledgeFile, type KnowledgeFolder } from "../../FileManager";
import { FileActionForm } from "./FileActionForm";
import { FileUploadForm } from "./FileUploadForm";

/** Поле «Переместить в»: пункты — папки компании (корень — пустое значение, как в прежних формах). */
export function DestinationSelect({ id, name, value, folders, label = "Переместить в" }: Readonly<{ id: string; name: string; value: string | null; folders: readonly KnowledgeFolder[]; label?: string }>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} name={name} defaultValue={value === COMPANY_ROOT_ID ? "" : value ?? ""}>
        {folders.map((folder) => <option key={folder.id} value={folderValue(folder)}>{folder.name}</option>)}
      </NativeSelect>
    </div>
  );
}

/**
 * Панель файла: управление файлом компании (заменить файл, переименовать, переместить, удалить) теми же действиями и полями, что
 * у прежнего `FileControls`; файл студента и роль без права управления — только «Скачать» в подвале панели.
 */
export function FileSheetBody({ file, destinations, canManage, canUpload }: Readonly<{ file: KnowledgeFile; destinations: readonly KnowledgeFolder[]; canManage: boolean; canUpload: boolean }>) {
  const company = file.kind === "company";
  const ids = file.renameRequestId && file.moveRequestId && file.archiveRequestId && file.uploadRequestId && file.version;
  if (!company || !ids || !file.version) {
    return canUpload && company && file.version && file.uploadRequestId ? <FileUploadForm file={file} /> : <p className="t-body-compact text-fg-2">Размер: {file.size ?? "—"}</p>;
  }
  const hidden = { company_file_id: file.id, expected_version: file.version };
  return (
    <div className="grid gap-6" data-testid="v3-company-file-controls" data-file-id={file.id}>
      {canUpload ? <FileUploadForm file={file} /> : null}
      {canManage ? (
        <>
          <FileActionForm action={renamePlatformCompanyFileAction} requestId={file.renameRequestId!} itemKind="file" itemId={file.id} hidden={hidden} submit="Переименовать" pending="Сохраняем…">
            <div className="grid gap-1.5"><Label htmlFor={`rename-${file.id}`}>Название</Label><Input id={`rename-${file.id}`} required name="display_name" maxLength={255} defaultValue={file.name} /></div>
          </FileActionForm>
          <FileActionForm action={movePlatformCompanyFileAction} requestId={file.moveRequestId!} itemKind="file" itemId={file.id} hidden={hidden} submit="Переместить" pending="Перемещаем…">
            <DestinationSelect id={`move-${file.id}`} name="folder_id" value={file.folderId} folders={destinations} />
          </FileActionForm>
          <div className="border-t border-border pt-4">
            <FileActionForm action={archivePlatformCompanyFileAction} requestId={file.archiveRequestId!} itemKind="file" itemId={file.id} hidden={hidden} submit="Удалить файл" pending="Удаляем…" confirm={`Удалить «${file.name}»? Запись пропадёт из списка.`} />
          </div>
        </>
      ) : null}
    </div>
  );
}
