import type { KnowledgeCanonicalSelection } from "@/lib/knowledge-canonical-export-contract";

import { COMPANY_ROOT_ID, isDescendant, type KnowledgeFile, type KnowledgeFolder } from "../../FileManager";

/** Строка таблицы «Документов»: подпапка текущей папки или файл. Сортировка по названию — по-русски, как в прежнем списке. */
export type FileEntry =
  | Readonly<{ key: string; kind: "folder"; name: string; folder: KnowledgeFolder; count: number }>
  | Readonly<{ key: string; kind: "file"; name: string; file: KnowledgeFile; place: string | null }>;

const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name, "ru");

/**
 * Что показывает «Документы» для текущей папки и запроса: без запроса — подпапки и файлы папки; с запросом — файлы всех
 * папок, в названии которых есть слово (под названием — папка), без подпапок. Всё это считал и прежний `FileManager`.
 */
export function filesModel(folders: readonly KnowledgeFolder[], files: readonly KnowledgeFile[], currentId: string | null, query: string) {
  const byId = new Map(folders.map((folder) => [folder.id, folder] as const));
  const current = currentId === null ? null : byId.get(currentId) ?? null;
  const path: KnowledgeFolder[] = [];
  const visited = new Set<string>();
  for (let cursor = current; cursor && !visited.has(cursor.id); cursor = cursor.parentId === null ? null : byId.get(cursor.parentId) ?? null) {
    path.unshift(cursor);
    visited.add(cursor.id);
  }
  const needle = query.trim().toLocaleLowerCase("ru");
  const count = (folderId: string) => folders.filter((folder) => folder.parentId === folderId).length + files.filter((file) => file.folderId === folderId).length;
  const subfolders = needle ? [] : folders.filter((folder) => folder.parentId === currentId).toSorted(byName);
  const shownFiles = files.filter((file) => (needle ? file.name.toLocaleLowerCase("ru").includes(needle) : file.folderId === currentId)).toSorted(byName);
  const entries: FileEntry[] = [
    ...subfolders.map((folder) => ({ key: `folder:${folder.id}`, kind: "folder" as const, name: folder.name, folder, count: count(folder.id) })),
    ...shownFiles.map((file) => ({ key: `file:${file.id}`, kind: "file" as const, name: file.name, file, place: needle && file.folderId ? byId.get(file.folderId)?.name ?? "Закрытая папка" : null })),
  ];
  const company = folders.filter((folder) => folder.kind === "company-root" || folder.kind === "company");
  const destinations = current?.kind === "company" ? company.filter((candidate) => candidate.id !== current.id && !isDescendant(candidate, current.id, byId)) : company;
  return {
    current, path, entries, needle, destinations, companyDestinations: company, count,
    currentIsCompany: current?.kind === "company-root" || current?.kind === "company",
    exportable: shownFiles.filter((file) => file.currentVersionId && file.downloadHref),
    rootId: COMPANY_ROOT_ID,
  };
}

/** Что выгружает «Выгрузить папку» / «Выгрузить все документы» для открытой папки (те же выборки, что у прежнего `FileManager`). */
export function folderExportOf(current: KnowledgeFolder | null): KnowledgeCanonicalSelection {
  if (!current) return { allDocuments: true, companyRoot: true };
  if (current.kind === "students") return { allDocuments: true };
  if (current.kind === "student") return { documentCaseIds: [current.id.replace(/^student-/, "")] };
  return current.kind === "company-root" ? { companyRoot: true } : { companyFolderIds: [current.id] };
}

/** Выбранные версии документов для «Выгрузить выбранные документы»: документы студентов и файлы компании — раздельно. */
export function selectedExportOf(files: readonly KnowledgeFile[], selectedVersions: ReadonlySet<string>): KnowledgeCanonicalSelection {
  const picked = files.filter((file) => file.currentVersionId && selectedVersions.has(file.currentVersionId));
  return {
    documentVersionIds: picked.filter((file) => file.kind === "student").map((file) => file.currentVersionId!),
    companyVersionIds: picked.filter((file) => file.kind === "company").map((file) => file.currentVersionId!),
  };
}
