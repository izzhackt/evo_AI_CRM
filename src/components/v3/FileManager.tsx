"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { Icon } from "@/components/icons";
import {
  btnCls,
  btnDangerGhostCls,
  btnGhostCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import {
  archivePlatformCompanyFileAction,
  archivePlatformCompanyFileFolderAction,
  createPlatformCompanyFileAction,
  createPlatformCompanyFileFolderAction,
  movePlatformCompanyFileAction,
  movePlatformCompanyFileFolderAction,
  renamePlatformCompanyFileAction,
  renamePlatformCompanyFileFolderAction,
  type PlatformCompanyFileActionState,
} from "@/lib/platform-company-file-actions";

export const COMPANY_ROOT_ID = "company";

export type KnowledgeFolderKind =
  | "company-root"
  | "company"
  | "students"
  | "student";

export type KnowledgeFolder = Readonly<{
  id: string;
  name: string;
  parentId: string | null;
  kind: KnowledgeFolderKind;
  version: string | null;
  renameRequestId: string | null;
  moveRequestId: string | null;
  archiveRequestId: string | null;
}>;

export type KnowledgeFile = Readonly<{
  id: string;
  folderId: string | null;
  name: string;
  addedAt: string;
  size: string | null;
  kind: "company" | "student";
  version: string | null;
  currentVersionId: string | null;
  downloadHref: string | null;
  renameRequestId: string | null;
  moveRequestId: string | null;
  archiveRequestId: string | null;
  uploadRequestId: string | null;
}>;

const ACTION_MESSAGE: Record<
  Exclude<PlatformCompanyFileActionState["status"], "idle">,
  string
> = {
  saved: "Изменение сохранено.",
  invalid: "Проверьте заполненные поля.",
  forbidden: "У вашей роли нет права на это изменение.",
  stale: "Запись уже изменилась. Обновите страницу и повторите.",
  request_conflict: "Команда изменилась. Подготовлен новый безопасный повтор.",
  unavailable: "Supabase не подтвердил изменение.",
};

type UploadOutcome =
  | "idle"
  | "sending"
  | "saved"
  | "invalid"
  | "forbidden"
  | "unavailable";

type UploadState = Readonly<{
  outcome: UploadOutcome;
  message: string | null;
}>;

const IDLE_UPLOAD: UploadState = Object.freeze({
  outcome: "idle",
  message: null,
});
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FILE_ACCEPT = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".txt",
  ".csv",
  ".doc",
  ".xls",
  ".ppt",
  ".docx",
  ".xlsx",
  ".pptx",
].join(",");

function initialActionState(
  requestId: string,
  itemKind: "folder" | "file" | null,
  itemId: string | null,
): PlatformCompanyFileActionState {
  return {
    status: "idle",
    requestId,
    itemKind,
    itemId,
    version: null,
    archivedAt: null,
  };
}

function useRefreshAfterMutation(status: PlatformCompanyFileActionState["status"]) {
  const router = useRouter();
  useEffect(() => {
    if (status === "saved" || status === "stale") router.refresh();
  }, [router, status]);
}

function ActionFeedback({
  state,
  testId,
}: Readonly<{
  state: PlatformCompanyFileActionState;
  testId: string;
}>) {
  if (state.status === "idle") return null;
  return (
    <p
      className={
        state.status === "saved"
          ? "text-xs text-ok"
          : state.status === "invalid" || state.status === "stale"
            ? "text-xs text-warn"
            : "text-xs text-danger"
      }
      role="status"
      data-testid={testId}
      data-outcome={state.status}
    >
      {ACTION_MESSAGE[state.status]}
    </p>
  );
}

function folderValue(folder: KnowledgeFolder): string {
  return folder.kind === "company-root" ? "" : folder.id;
}

function isDescendant(
  candidate: KnowledgeFolder,
  ancestorId: string,
  byId: ReadonlyMap<string, KnowledgeFolder>,
): boolean {
  let parentId = candidate.parentId;
  const visited = new Set<string>();
  while (parentId !== null && !visited.has(parentId)) {
    if (parentId === ancestorId) return true;
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
}

function CreateFolderForm({
  parentFolderId,
  requestId,
}: Readonly<{
  parentFolderId: string;
  requestId: string;
}>) {
  const [state, action, pending] = useActionState(
    createPlatformCompanyFileFolderAction,
    initialActionState(requestId, "folder", null),
  );
  useRefreshAfterMutation(state.status);
  const locked = pending || state.status === "saved";

  return (
    <form
      action={action}
      className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      aria-busy={pending}
      data-testid="v3-company-create-folder-form"
    >
      <input type="hidden" name="parent_folder_id" value={parentFolderId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <label>
        <span className={labelCls}>Название папки</span>
        <input
          required
          name="name"
          maxLength={255}
          className={inputCls}
          disabled={locked}
          data-testid="v3-company-folder-name"
        />
      </label>
      <button type="submit" className={btnCls} disabled={locked}>
        {pending ? "Создаём…" : "Создать"}
      </button>
      <div className="sm:col-span-2">
        <ActionFeedback state={state} testId="v3-company-create-folder-status" />
      </div>
    </form>
  );
}

function CreateFileForm({
  folderId,
  requestId,
}: Readonly<{
  folderId: string;
  requestId: string;
}>) {
  const [state, action, pending] = useActionState(
    createPlatformCompanyFileAction,
    initialActionState(requestId, "file", null),
  );
  useRefreshAfterMutation(state.status);
  const locked = pending || state.status === "saved";

  return (
    <form
      action={action}
      className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      aria-busy={pending}
      data-testid="v3-company-create-file-form"
    >
      <input type="hidden" name="folder_id" value={folderId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <label>
        <span className={labelCls}>Название файла</span>
        <input
          required
          name="display_name"
          maxLength={255}
          className={inputCls}
          disabled={locked}
          data-testid="v3-company-file-name"
        />
      </label>
      <button type="submit" className={btnCls} disabled={locked}>
        {pending ? "Создаём…" : "Создать"}
      </button>
      <div className="sm:col-span-2">
        <ActionFeedback state={state} testId="v3-company-create-file-status" />
      </div>
    </form>
  );
}

function FolderControls({
  folder,
  destinations,
  hasChildren,
}: Readonly<{
  folder: KnowledgeFolder;
  destinations: readonly KnowledgeFolder[];
  hasChildren: boolean;
}>) {
  const renameRequestId = folder.renameRequestId ?? "";
  const moveRequestId = folder.moveRequestId ?? "";
  const archiveRequestId = folder.archiveRequestId ?? "";
  const [renameState, renameAction, renaming] = useActionState(
    renamePlatformCompanyFileFolderAction,
    initialActionState(renameRequestId, "folder", folder.id),
  );
  const [moveState, moveAction, moving] = useActionState(
    movePlatformCompanyFileFolderAction,
    initialActionState(moveRequestId, "folder", folder.id),
  );
  const [archiveState, archiveAction, archiving] = useActionState(
    archivePlatformCompanyFileFolderAction,
    initialActionState(archiveRequestId, "folder", folder.id),
  );
  useRefreshAfterMutation(renameState.status);
  useRefreshAfterMutation(moveState.status);
  useRefreshAfterMutation(archiveState.status);

  if (
    folder.kind !== "company" || !folder.version || !renameRequestId ||
    !moveRequestId || !archiveRequestId
  ) {
    return null;
  }

  return (
    <details
      className="rounded-card border border-border bg-surface-2 px-4 py-2"
      data-testid="v3-company-folder-controls"
      data-folder-id={folder.id}
    >
      <summary className="flex min-h-10 cursor-pointer items-center text-sm font-semibold text-fg">
        Управление папкой
      </summary>
      <div className="grid gap-4 border-t border-border py-4 lg:grid-cols-2">
        <form action={renameAction} className="grid gap-2" aria-busy={renaming}>
          <input type="hidden" name="folder_id" value={folder.id} />
          <input type="hidden" name="expected_version" value={folder.version} />
          <input type="hidden" name="request_id" value={renameState.requestId} />
          <label>
            <span className={labelCls}>Новое название</span>
            <input
              required
              name="name"
              maxLength={255}
              defaultValue={folder.name}
              className={inputCls}
              disabled={renaming || renameState.status === "saved"}
            />
          </label>
          <button type="submit" className={btnGhostCls} disabled={renaming}>
            {renaming ? "Сохраняем…" : "Переименовать"}
          </button>
          <ActionFeedback state={renameState} testId="v3-company-folder-rename-status" />
        </form>

        <form action={moveAction} className="grid gap-2" aria-busy={moving}>
          <input type="hidden" name="folder_id" value={folder.id} />
          <input type="hidden" name="expected_version" value={folder.version} />
          <input type="hidden" name="request_id" value={moveState.requestId} />
          <label>
            <span className={labelCls}>Переместить в</span>
            <select
              name="new_parent_folder_id"
              className={inputCls}
              defaultValue={folder.parentId === COMPANY_ROOT_ID ? "" : folder.parentId ?? ""}
              disabled={moving || moveState.status === "saved"}
            >
              {destinations.map((destination) => (
                <option key={destination.id} value={folderValue(destination)}>
                  {destination.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={btnGhostCls} disabled={moving}>
            {moving ? "Перемещаем…" : "Переместить"}
          </button>
          <ActionFeedback state={moveState} testId="v3-company-folder-move-status" />
        </form>

        <form action={archiveAction} className="grid gap-2 lg:col-span-2" aria-busy={archiving}>
          <input type="hidden" name="folder_id" value={folder.id} />
          <input type="hidden" name="expected_version" value={folder.version} />
          <input type="hidden" name="request_id" value={archiveState.requestId} />
          <button
            type="submit"
            className={btnDangerGhostCls}
            disabled={archiving || hasChildren || archiveState.status === "saved"}
          >
            {archiving ? "Удаляем…" : "Удалить пустую папку"}
          </button>
          {hasChildren ? (
            <p className="text-xs text-fg-3">Сначала переместите или удалите содержимое.</p>
          ) : null}
          <ActionFeedback state={archiveState} testId="v3-company-folder-archive-status" />
        </form>
      </div>
    </details>
  );
}

function uploadConfirmed(value: unknown, file: KnowledgeFile): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  const result = payload.companyFile;
  if (typeof result !== "object" || result === null || Array.isArray(result)) return false;
  const record = result as Record<string, unknown>;
  return record.companyFileId === file.id
    && typeof record.companyFileVersionId === "string"
    && typeof record.versionNumber === "string"
    && typeof record.fileVersion === "string"
    && typeof record.originalFilename === "string"
    && typeof record.declaredMimeType === "string"
    && typeof record.byteSize === "number"
    && typeof record.sha256Hex === "string";
}

function CompanyFileUploadForm({ file }: Readonly<{ file: KnowledgeFile }>) {
  const router = useRouter();
  const [state, setState] = useState<UploadState>(IDLE_UPLOAD);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file.version || !file.uploadRequestId) {
      setState({ outcome: "unavailable", message: "Загрузка недоступна." });
      return;
    }
    const body = new FormData(event.currentTarget);
    const selected = body.get("file");
    if (!(selected instanceof File) || selected.size < 1 || selected.size > MAX_FILE_BYTES) {
      setState({
        outcome: "invalid",
        message: "Выберите поддерживаемый файл размером до 25 MiB.",
      });
      return;
    }
    setState({ outcome: "sending", message: null });
    try {
      const response = await fetch(
        `/api/v3/company-files/${encodeURIComponent(file.id)}/versions`,
        { method: "POST", body },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (response.ok && uploadConfirmed(payload, file)) {
        setState({ outcome: "saved", message: "Файл сохранён в приватном хранилище." });
        router.refresh();
        return;
      }
      if (response.status === 409) {
        setState({ outcome: "invalid", message: "Запись изменилась. Данные обновлены." });
        router.refresh();
      } else if (response.status === 400 || response.status === 413 || response.status === 415) {
        setState({ outcome: "invalid", message: "Проверьте файл и обновите запись перед повтором." });
      } else if (response.status === 401 || response.status === 403) {
        setState({ outcome: "forbidden", message: "У вашей роли нет права загружать этот файл." });
      } else {
        setState({ outcome: "unavailable", message: "Хранилище не подтвердило загрузку." });
      }
    } catch {
      setState({ outcome: "unavailable", message: "Хранилище не подтвердило загрузку." });
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-2"
      data-testid="v3-company-file-upload-form"
      aria-busy={state.outcome === "sending"}
    >
      <input type="hidden" name="expected_file_version" value={file.version ?? ""} />
      <input type="hidden" name="request_id" value={file.uploadRequestId ?? ""} />
      <label>
        <span className={labelCls}>{file.currentVersionId ? "Заменить файл" : "Загрузить файл"}</span>
        <input
          required
          type="file"
          name="file"
          accept={FILE_ACCEPT}
          className={inputCls}
          disabled={state.outcome === "sending" || state.outcome === "saved"}
          data-testid="v3-company-file-input"
        />
      </label>
      <button
        type="submit"
        className={btnCls}
        disabled={state.outcome === "sending" || state.outcome === "saved"}
      >
        {state.outcome === "sending" ? "Загрузка…" : "Сохранить"}
      </button>
      {state.message ? (
        <p
          className={
            state.outcome === "saved"
              ? "text-xs text-ok"
              : state.outcome === "invalid"
                ? "text-xs text-warn"
                : "text-xs text-danger"
          }
          role="status"
          data-testid="v3-company-file-upload-status"
          data-outcome={state.outcome}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function FileControls({
  file,
  destinations,
}: Readonly<{
  file: KnowledgeFile;
  destinations: readonly KnowledgeFolder[];
}>) {
  const renameRequestId = file.renameRequestId ?? "";
  const moveRequestId = file.moveRequestId ?? "";
  const archiveRequestId = file.archiveRequestId ?? "";
  const [renameState, renameAction, renaming] = useActionState(
    renamePlatformCompanyFileAction,
    initialActionState(renameRequestId, "file", file.id),
  );
  const [moveState, moveAction, moving] = useActionState(
    movePlatformCompanyFileAction,
    initialActionState(moveRequestId, "file", file.id),
  );
  const [archiveState, archiveAction, archiving] = useActionState(
    archivePlatformCompanyFileAction,
    initialActionState(archiveRequestId, "file", file.id),
  );
  useRefreshAfterMutation(renameState.status);
  useRefreshAfterMutation(moveState.status);
  useRefreshAfterMutation(archiveState.status);

  if (
    file.kind !== "company" || !file.version || !renameRequestId ||
    !moveRequestId || !archiveRequestId || !file.uploadRequestId
  ) {
    return null;
  }

  return (
    <details data-testid="v3-company-file-controls" data-file-id={file.id}>
      <summary className="flex min-h-9 cursor-pointer items-center text-xs font-semibold text-fg-2">
        Действия
      </summary>
      <div className="mt-2 grid min-w-[260px] gap-4 rounded-card border border-border bg-surface-2 p-3">
        <CompanyFileUploadForm file={file} />

        <form action={renameAction} className="grid gap-2" aria-busy={renaming}>
          <input type="hidden" name="company_file_id" value={file.id} />
          <input type="hidden" name="expected_version" value={file.version} />
          <input type="hidden" name="request_id" value={renameState.requestId} />
          <label>
            <span className={labelCls}>Название</span>
            <input
              required
              name="display_name"
              maxLength={255}
              defaultValue={file.name}
              className={inputCls}
              disabled={renaming || renameState.status === "saved"}
            />
          </label>
          <button type="submit" className={btnGhostCls} disabled={renaming}>
            {renaming ? "Сохраняем…" : "Переименовать"}
          </button>
          <ActionFeedback state={renameState} testId="v3-company-file-rename-status" />
        </form>

        <form action={moveAction} className="grid gap-2" aria-busy={moving}>
          <input type="hidden" name="company_file_id" value={file.id} />
          <input type="hidden" name="expected_version" value={file.version} />
          <input type="hidden" name="request_id" value={moveState.requestId} />
          <label>
            <span className={labelCls}>Переместить в</span>
            <select
              name="folder_id"
              className={inputCls}
              defaultValue={file.folderId === COMPANY_ROOT_ID ? "" : file.folderId ?? ""}
              disabled={moving || moveState.status === "saved"}
            >
              {destinations.map((destination) => (
                <option key={destination.id} value={folderValue(destination)}>
                  {destination.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={btnGhostCls} disabled={moving}>
            {moving ? "Перемещаем…" : "Переместить"}
          </button>
          <ActionFeedback state={moveState} testId="v3-company-file-move-status" />
        </form>

        <form action={archiveAction} className="grid gap-2" aria-busy={archiving}>
          <input type="hidden" name="company_file_id" value={file.id} />
          <input type="hidden" name="expected_version" value={file.version} />
          <input type="hidden" name="request_id" value={archiveState.requestId} />
          <button
            type="submit"
            className={btnDangerGhostCls}
            disabled={archiving || archiveState.status === "saved"}
          >
            {archiving ? "Удаляем…" : "Удалить файл"}
          </button>
          <ActionFeedback state={archiveState} testId="v3-company-file-archive-status" />
        </form>
      </div>
    </details>
  );
}

function SidebarFolder({
  folder,
  folders,
  currentId,
  folderCount,
  openFolder,
  depth = 0,
}: Readonly<{
  folder: KnowledgeFolder;
  folders: readonly KnowledgeFolder[];
  currentId: string | null;
  folderCount(id: string): number;
  openFolder(id: string): void;
  depth?: number;
}>) {
  const children = folders
    .filter((candidate) => candidate.parentId === folder.id)
    .toSorted((left, right) => left.name.localeCompare(right.name, "ru"));
  return (
    <li>
      <button
        type="button"
        onClick={() => openFolder(folder.id)}
        aria-current={currentId === folder.id ? "page" : undefined}
        data-testid="v3-knowledge-folder-link"
        data-folder-id={folder.id}
        className={`flex min-h-10 w-full items-center gap-2 rounded-nav px-2 text-start text-xs ${
          currentId === folder.id
            ? "bg-surface font-semibold text-fg"
            : "text-fg-2 hover:bg-surface"
        }`}
        style={{ paddingInlineStart: `${8 + depth * 12}px` }}
      >
        {folder.kind === "student" ? (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 font-semibold text-fg-2">
            {folder.name.slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <Icon name="folder" size={15} />
        )}
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <span className="font-mono text-2xs text-fg-3">{folderCount(folder.id)}</span>
      </button>
      {children.length > 0 ? (
        <ul className="ms-3 border-s border-border ps-1">
          {children.map((child) => (
            <SidebarFolder
              key={child.id}
              folder={child}
              folders={folders}
              currentId={currentId}
              folderCount={folderCount}
              openFolder={openFolder}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** One real workspace over company files plus the existing student-document projection. */
export function FileManager({
  folders,
  files,
  canManage,
  createFolderRequestId,
  createFileRequestId,
}: Readonly<{
  folders: readonly KnowledgeFolder[];
  files: readonly KnowledgeFile[];
  canManage: boolean;
  createFolderRequestId: string;
  createFileRequestId: string;
}>) {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const byId = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder] as const)),
    [folders],
  );
  const current = currentId === null ? null : byId.get(currentId) ?? null;

  const breadcrumbs = useMemo(() => {
    const path: KnowledgeFolder[] = [];
    let cursor = current;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor.id)) {
      path.unshift(cursor);
      visited.add(cursor.id);
      cursor = cursor.parentId === null ? null : byId.get(cursor.parentId) ?? null;
    }
    return path;
  }, [byId, current]);

  const children = folders
    .filter((folder) => folder.parentId === currentId)
    .toSorted((left, right) => left.name.localeCompare(right.name, "ru"));
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleFiles = files
    .filter((file) => normalizedQuery
      ? file.name.toLocaleLowerCase("ru").includes(normalizedQuery)
      : file.folderId === currentId)
    .toSorted((left, right) => left.name.localeCompare(right.name, "ru"));

  const folderCount = (folderId: string) =>
    folders.filter((folder) => folder.parentId === folderId).length
    + files.filter((file) => file.folderId === folderId).length;
  const openFolder = (folderId: string | null) => {
    setCurrentId(folderId);
    setQuery("");
  };

  const companyDestinations = folders.filter((folder) =>
    folder.kind === "company-root" || folder.kind === "company");
  const folderDestinations = current?.kind === "company"
    ? companyDestinations.filter((candidate) =>
        candidate.id !== current.id && !isDescendant(candidate, current.id, byId))
    : companyDestinations;
  const currentIsCompany = current?.kind === "company-root" || current?.kind === "company";

  return (
    <section className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="grid min-h-[620px] lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav
          aria-label="Папки базы знаний"
          className="border-b border-border bg-surface-2 p-3 lg:border-b-0 lg:border-e"
        >
          <button
            type="button"
            onClick={() => openFolder(null)}
            aria-current={currentId === null ? "page" : undefined}
            className={`flex min-h-11 w-full items-center gap-2 rounded-nav px-3 text-start text-sm ${
              currentId === null
                ? "bg-surface font-semibold text-fg"
                : "text-fg-2 hover:bg-surface"
            }`}
          >
            <Icon name="grid" size={16} />
            Все разделы
          </button>
          <ul className="mt-2 flex flex-col gap-1">
            {folders
              .filter((folder) => folder.parentId === null)
              .map((folder) => (
                <SidebarFolder
                  key={folder.id}
                  folder={folder}
                  folders={folders}
                  currentId={currentId}
                  folderCount={folderCount}
                  openFolder={(id) => openFolder(id)}
                />
              ))}
          </ul>
        </nav>

        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
            <nav aria-label="Путь к папке" className="min-w-0 flex-1">
              <ol className="flex min-w-0 items-center gap-1 text-sm text-fg-2">
                <li>
                  <button
                    type="button"
                    onClick={() => openFolder(null)}
                    className="min-h-8 rounded-nav px-1 hover:text-fg"
                  >
                    База знаний
                  </button>
                </li>
                {breadcrumbs.map((folder) => (
                  <li key={folder.id} className="flex min-w-0 items-center gap-1">
                    <Icon name="chevron-right" size={13} className="shrink-0 text-fg-3" />
                    <button
                      type="button"
                      onClick={() => openFolder(folder.id)}
                      className="min-h-8 truncate rounded-nav px-1 hover:text-fg"
                    >
                      {folder.name}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <label className="flex min-h-11 min-w-0 basis-60 items-center gap-2 rounded-ctl border border-control-edge bg-surface px-3">
              <Icon name="search" size={15} className="shrink-0 text-fg-3" />
              <span className="sr-only">Поиск документов</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск документов"
                className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
              />
            </label>
          </div>

          {canManage && currentIsCompany && current ? (
            <div className="grid gap-3 border-b border-border py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <details className="rounded-card border border-border bg-surface-2 px-4 py-2">
                  <summary className="flex min-h-10 cursor-pointer items-center text-sm font-semibold text-fg">
                    Новая папка
                  </summary>
                  <CreateFolderForm
                    key={createFolderRequestId}
                    parentFolderId={folderValue(current)}
                    requestId={createFolderRequestId}
                  />
                </details>
                <details className="rounded-card border border-border bg-surface-2 px-4 py-2">
                  <summary className="flex min-h-10 cursor-pointer items-center text-sm font-semibold text-fg">
                    Новый файл
                  </summary>
                  <CreateFileForm
                    key={createFileRequestId}
                    folderId={folderValue(current)}
                    requestId={createFileRequestId}
                  />
                </details>
              </div>
              <FolderControls
                key={`${current.id}:${current.version ?? "root"}`}
                folder={current}
                destinations={folderDestinations}
                hasChildren={folderCount(current.id) > 0}
              />
            </div>
          ) : null}

          {!normalizedQuery && children.length > 0 ? (
            <ul className="grid gap-3 py-4 sm:grid-cols-2 xl:grid-cols-3">
              {children.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => openFolder(folder.id)}
                    className="flex min-h-20 w-full items-center gap-3 rounded-card border border-control-edge bg-surface-2 p-3 text-start hover:border-accent"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-surface-3 text-fg-2">
                      <Icon name="folder" size={19} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg">{folder.name}</span>
                      <span className="mt-0.5 block text-2xs text-fg-3">
                        {folderCount(folder.id)} записей
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div
            role="region"
            aria-label="Таблица документов"
            tabIndex={0}
            className="overflow-x-auto rounded-ctl"
          >
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-start">
              <thead>
                <tr className="text-start text-2xs uppercase tracking-wide text-fg-3">
                  <th className="border-b border-border px-3 py-2 text-start font-medium">Документ</th>
                  <th className="border-b border-border px-3 py-2 text-start font-medium">Размер</th>
                  <th className="border-b border-border px-3 py-2 text-start font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {visibleFiles.map((file) => (
                  <tr
                    key={file.id}
                    className="text-sm text-fg"
                    data-testid={file.kind === "company" ? "v3-company-file-row" : undefined}
                    data-file-id={file.id}
                  >
                    <td className="border-b border-border px-3 py-3">
                      {file.downloadHref ? (
                        <a href={file.downloadHref} className="font-medium underline-offset-4 hover:underline">
                          {file.name}
                        </a>
                      ) : (
                        <span className="font-medium">{file.name}</span>
                      )}
                      {normalizedQuery && file.folderId ? (
                        <span className="mt-0.5 block text-2xs text-fg-3">
                          {byId.get(file.folderId)?.name ?? "Закрытая папка"}
                        </span>
                      ) : null}
                    </td>
                    <td className="border-b border-border px-3 py-3 font-mono text-2xs text-fg-3">
                      {file.size ?? "—"}
                    </td>
                    <td className="border-b border-border px-3 py-3 align-top">
                      {canManage && file.kind === "company" ? (
                        <FileControls
                          key={`${file.id}:${file.version ?? "unversioned"}`}
                          file={file}
                          destinations={companyDestinations}
                        />
                      ) : file.downloadHref ? (
                        <a href={file.downloadHref} className={btnGhostCls}>
                          <Icon name="download" size={15} />
                          Скачать
                        </a>
                      ) : (
                        <span className="text-xs text-fg-3">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visibleFiles.length === 0 ? (
            <p className="py-12 text-center text-sm text-fg-3">
              {normalizedQuery ? "Документы не найдены." : "В этой папке документов нет."}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
