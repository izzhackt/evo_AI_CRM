"use client";

import { useRouter } from "next/navigation";
import {
  Fragment,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Icon } from "@/components/icons";
import {
  createPlatformCompanyKnowledgeFolderAction,
  movePlatformCompanyKnowledgeFileAction,
  movePlatformCompanyKnowledgeFolderAction,
  removePlatformCompanyKnowledgeFileAction,
  removePlatformCompanyKnowledgeFolderAction,
  renamePlatformCompanyKnowledgeFileAction,
  renamePlatformCompanyKnowledgeFolderAction,
  type PlatformCompanyKnowledgeActionState,
} from "@/lib/platform-company-knowledge-actions";

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
  companyFolderId: string | null;
  version: number | null;
}>;

export type KnowledgeFile = Readonly<{
  id: string;
  folderId: string;
  kind: "company" | "student";
  companyFileId: string | null;
  fileVersionId: string;
  version: number | null;
  name: string;
  addedAt: string;
  size: string;
}>;

export type KnowledgeMutationRequestIds = Readonly<{
  createFolder: string;
  uploadFile: string;
  folders: Readonly<
    Record<string, Readonly<{ rename: string; move: string; remove: string }>>
  >;
  files: Readonly<
    Record<string, Readonly<{ rename: string; move: string; remove: string }>>
  >;
}>;

type CompanyDestination = Readonly<{ id: string; label: string }>;
type KnowledgeServerAction = (
  previous: PlatformCompanyKnowledgeActionState,
  form: FormData,
) => Promise<PlatformCompanyKnowledgeActionState>;

const ACCEPTED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FIELD_CLASS =
  "min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:bg-surface-2 disabled:text-fg-3";
const PRIMARY_BUTTON =
  "min-h-11 rounded-ctl bg-accent px-3 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50";
const DANGER_BUTTON =
  "min-h-11 rounded-ctl border border-danger/35 px-3 text-sm font-medium text-danger hover:bg-danger-weak disabled:cursor-not-allowed disabled:opacity-50";

const ACTION_MESSAGES: Record<
  Exclude<PlatformCompanyKnowledgeActionState["status"], "idle">,
  string
> = {
  saved: "Изменение сохранено.",
  invalid: "Проверьте название, папку назначения и что удаляемая папка пуста.",
  forbidden: "У этой роли нет права изменять файлы компании.",
  stale: "Запись уже изменилась. Данные обновлены — повторите действие.",
  request_conflict: "Команда уже использована. Подготовлен новый безопасный повтор.",
  unavailable: "Supabase не подтвердил изменение. Ничего не отмечено как сохранённое.",
};

function MutationFeedback({
  state,
  testId,
}: Readonly<{
  state: PlatformCompanyKnowledgeActionState;
  testId?: string;
}>) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "saved" ? "status" : "alert"}
      className={`text-xs ${state.status === "saved" ? "text-ok" : "text-danger"}`}
      data-testid={testId}
    >
      {ACTION_MESSAGES[state.status]}
    </p>
  );
}

function MutationForm({
  action,
  requestId,
  itemId,
  version,
  submitLabel,
  pendingLabel,
  testId,
  statusTestId,
  danger = false,
  resetOnSave = false,
  children,
}: Readonly<{
  action: KnowledgeServerAction;
  requestId: string;
  itemId: string | null;
  version: number | null;
  submitLabel: string;
  pendingLabel: string;
  testId: string;
  statusTestId?: string;
  danger?: boolean;
  resetOnSave?: boolean;
  children: ReactNode;
}>) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const initialState: PlatformCompanyKnowledgeActionState = {
    status: "idle",
    requestId,
    itemId,
    version: version === null ? null : String(version),
  };
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status !== "saved" && state.status !== "stale") return;
    if (state.status === "saved" && resetOnSave) formRef.current?.reset();
    const refreshTimer = window.setTimeout(() => {
      router.refresh();
    }, 250);
    return () => window.clearTimeout(refreshTimer);
  }, [resetOnSave, router, state.status]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={pending}
      className="space-y-2"
      data-testid={testId}
    >
      <input type="hidden" name="request_id" value={state.requestId || requestId} />
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={danger ? DANGER_BUTTON : PRIMARY_BUTTON}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        <MutationFeedback state={state} testId={statusTestId ?? `${testId}-status`} />
      </div>
    </form>
  );
}

function CreateFolderForm({
  parentFolderId,
  requestId,
}: Readonly<{ parentFolderId: string; requestId: string }>) {
  return (
    <MutationForm
      action={createPlatformCompanyKnowledgeFolderAction}
      requestId={requestId}
      itemId={null}
      version={null}
      submitLabel="Создать папку"
      pendingLabel="Создаём…"
      testId="v3-knowledge-create-folder-form"
      statusTestId="v3-knowledge-create-folder-status"
      resetOnSave
    >
      <input type="hidden" name="parent_folder_id" value={parentFolderId} />
      <label className="block text-xs font-medium text-fg-2">
        Название папки
        <input
          type="text"
          name="name"
          required
          maxLength={160}
          autoComplete="off"
          className={`${FIELD_CLASS} mt-1`}
        />
      </label>
    </MutationForm>
  );
}

type UploadOutcome =
  | "idle"
  | "sending"
  | "saved"
  | "invalid"
  | "conflict"
  | "forbidden"
  | "unavailable";

const UPLOAD_MESSAGES: Record<Exclude<UploadOutcome, "idle" | "sending">, string> = {
  saved: "Файл сохранён в приватном хранилище.",
  invalid: "Выберите PDF, JPEG или PNG размером до 25 MiB.",
  conflict: "Состояние изменилось. Список обновлён — проверьте его перед повтором.",
  forbidden: "У этой роли нет права загружать файлы компании.",
  unavailable: "Хранилище не подтвердило загрузку. Файл не отмечен как сохранённый.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uploadWasConfirmed(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.file)) return false;
  const file = value.file;
  return typeof file.fileId === "string"
    && file.fileId.length > 0
    && typeof file.fileVersionId === "string"
    && file.fileVersionId.length > 0
    && typeof file.fileVersionNumber === "number"
    && Number.isInteger(file.fileVersionNumber)
    && file.fileVersionNumber > 0;
}

function UploadFileForm({
  folderId,
  initialRequestId,
}: Readonly<{ folderId: string; initialRequestId: string }>) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [requestId, setRequestId] = useState(initialRequestId);
  const [outcome, setOutcome] = useState<UploadOutcome>("idle");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (outcome === "sending") return;
    const form = event.currentTarget;
    const body = new FormData(form);
    const file = body.get("file");
    if (
      !(file instanceof File)
      || file.size < 1
      || file.size > MAX_FILE_BYTES
      || !ACCEPTED_FILE_TYPES.some((type) => type === file.type)
    ) {
      setOutcome("invalid");
      return;
    }

    setOutcome("sending");
    try {
      const response = await fetch("/api/v3/knowledge/files", {
        method: "POST",
        body,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 201 && uploadWasConfirmed(payload)) {
        setOutcome("saved");
        formRef.current?.reset();
        setRequestId(crypto.randomUUID());
        window.setTimeout(() => {
          router.refresh();
        }, 250);
        return;
      }
      if ([400, 413, 415].includes(response.status)) {
        setOutcome("invalid");
      } else if (response.status === 409) {
        setOutcome("conflict");
        setRequestId(crypto.randomUUID());
        window.setTimeout(() => {
          router.refresh();
        }, 250);
      } else if (response.status === 401 || response.status === 403) {
        setOutcome("forbidden");
      } else {
        setOutcome("unavailable");
      }
    } catch {
      setOutcome("unavailable");
      router.refresh();
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      aria-busy={outcome === "sending"}
      className="space-y-2"
      data-testid="v3-knowledge-upload-form"
    >
      <input type="hidden" name="folder_id" value={folderId} />
      <input type="hidden" name="file_id" value="" />
      <input type="hidden" name="expected_version" value="" />
      <input type="hidden" name="request_id" value={requestId} />
      <label className="block text-xs font-medium text-fg-2">
        PDF, JPEG или PNG · до 25 MiB
        <input
          type="file"
          name="file"
          accept={ACCEPTED_FILE_TYPES.join(",")}
          required
          className={`${FIELD_CLASS} mt-1 cursor-pointer py-2 file:me-3 file:rounded-nav file:border-0 file:bg-surface-3 file:px-2 file:py-1 file:text-xs file:font-medium file:text-fg`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={outcome === "sending"}
          className={PRIMARY_BUTTON}
        >
          {outcome === "sending" ? "Загружаем…" : "Загрузить файл"}
        </button>
        {outcome !== "idle" && outcome !== "sending" ? (
          <p
            role={outcome === "saved" ? "status" : "alert"}
            className={`text-xs ${outcome === "saved" ? "text-ok" : "text-danger"}`}
            data-testid="v3-knowledge-upload-status"
          >
            {UPLOAD_MESSAGES[outcome]}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function DestinationSelect({
  name,
  destinations,
  defaultValue,
}: Readonly<{
  name: "parent_folder_id" | "folder_id";
  destinations: readonly CompanyDestination[];
  defaultValue: string;
}>) {
  return (
    <label className="block text-xs font-medium text-fg-2">
      Папка назначения
      <select name={name} defaultValue={defaultValue} className={`${FIELD_CLASS} mt-1`}>
        {destinations.map((destination) => (
          <option key={destination.id || "company-root"} value={destination.id}>
            {destination.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompanyFolderControls({
  folder,
  requests,
  destinations,
  currentParentFolderId,
}: Readonly<{
  folder: KnowledgeFolder;
  requests: Readonly<{ rename: string; move: string; remove: string }>;
  destinations: readonly CompanyDestination[];
  currentParentFolderId: string;
}>) {
  if (
    folder.kind !== "company"
    || folder.companyFolderId === null
    || folder.version === null
  ) return null;
  return (
    <div className="grid gap-4 border-t border-border pt-3 lg:grid-cols-3">
      <MutationForm
        action={renamePlatformCompanyKnowledgeFolderAction}
        requestId={requests.rename}
        itemId={folder.companyFolderId}
        version={folder.version}
        submitLabel="Переименовать"
        pendingLabel="Сохраняем…"
        testId="v3-knowledge-folder-rename"
      >
        <input type="hidden" name="folder_id" value={folder.companyFolderId} />
        <input type="hidden" name="expected_version" value={folder.version} />
        <label className="block text-xs font-medium text-fg-2">
          Новое название
          <input
            type="text"
            name="name"
            required
            maxLength={160}
            defaultValue={folder.name}
            className={`${FIELD_CLASS} mt-1`}
          />
        </label>
      </MutationForm>

      <MutationForm
        action={movePlatformCompanyKnowledgeFolderAction}
        requestId={requests.move}
        itemId={folder.companyFolderId}
        version={folder.version}
        submitLabel="Переместить"
        pendingLabel="Перемещаем…"
        testId="v3-knowledge-folder-move"
      >
        <input type="hidden" name="folder_id" value={folder.companyFolderId} />
        <input type="hidden" name="expected_version" value={folder.version} />
        <DestinationSelect
          name="parent_folder_id"
          destinations={destinations}
          defaultValue={currentParentFolderId}
        />
      </MutationForm>

      <MutationForm
        action={removePlatformCompanyKnowledgeFolderAction}
        requestId={requests.remove}
        itemId={folder.companyFolderId}
        version={folder.version}
        submitLabel="Удалить пустую папку"
        pendingLabel="Удаляем…"
        testId="v3-knowledge-folder-delete"
        danger
      >
        <input type="hidden" name="folder_id" value={folder.companyFolderId} />
        <input type="hidden" name="expected_version" value={folder.version} />
        <p className="text-xs text-fg-3">Непустую папку Supabase не удалит.</p>
      </MutationForm>
    </div>
  );
}

function CompanyFileControls({
  file,
  requests,
  destinations,
  currentFolderId,
}: Readonly<{
  file: KnowledgeFile;
  requests: Readonly<{ rename: string; move: string; remove: string }>;
  destinations: readonly CompanyDestination[];
  currentFolderId: string;
}>) {
  if (
    file.kind !== "company"
    || file.companyFileId === null
    || file.version === null
  ) return null;
  return (
    <div className="grid gap-4 border-t border-border bg-surface-2 px-3 py-4 lg:grid-cols-3">
      <MutationForm
        action={renamePlatformCompanyKnowledgeFileAction}
        requestId={requests.rename}
        itemId={file.companyFileId}
        version={file.version}
        submitLabel="Переименовать"
        pendingLabel="Сохраняем…"
        testId="v3-knowledge-file-rename"
      >
        <input type="hidden" name="file_id" value={file.companyFileId} />
        <input type="hidden" name="expected_version" value={file.version} />
        <label className="block text-xs font-medium text-fg-2">
          Новое название
          <input
            type="text"
            name="name"
            required
            maxLength={255}
            defaultValue={file.name}
            className={`${FIELD_CLASS} mt-1`}
          />
        </label>
      </MutationForm>

      <MutationForm
        action={movePlatformCompanyKnowledgeFileAction}
        requestId={requests.move}
        itemId={file.companyFileId}
        version={file.version}
        submitLabel="Переместить"
        pendingLabel="Перемещаем…"
        testId="v3-knowledge-file-move"
      >
        <input type="hidden" name="file_id" value={file.companyFileId} />
        <input type="hidden" name="expected_version" value={file.version} />
        <DestinationSelect
          name="folder_id"
          destinations={destinations}
          defaultValue={currentFolderId}
        />
      </MutationForm>

      <MutationForm
        action={removePlatformCompanyKnowledgeFileAction}
        requestId={requests.remove}
        itemId={file.companyFileId}
        version={file.version}
        submitLabel="Удалить файл"
        pendingLabel="Удаляем…"
        testId="v3-knowledge-file-delete"
        danger
      >
        <input type="hidden" name="file_id" value={file.companyFileId} />
        <input type="hidden" name="expected_version" value={file.version} />
        <p className="text-xs text-fg-3">Файл исчезнет из рабочего пространства.</p>
      </MutationForm>
    </div>
  );
}

function folderInitial(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase("ru");
}

export function FileManager({
  folders,
  files,
  canManageCompany,
  requestIds,
}: Readonly<{
  folders: readonly KnowledgeFolder[];
  files: readonly KnowledgeFile[];
  canManageCompany: boolean;
  requestIds: KnowledgeMutationRequestIds;
}>) {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const byId = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder] as const)),
    [folders],
  );
  const current = currentId === null ? null : byId.get(currentId) ?? null;
  const resolvedCurrentId = currentId !== null && current === null ? null : currentId;
  const selectedFolder = selectedFolderId === null
    ? null
    : byId.get(selectedFolderId) ?? null;

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

  const companyFolders = useMemo(
    () => folders.filter(
      (folder): folder is KnowledgeFolder & Readonly<{ kind: "company" }> =>
        folder.kind === "company",
    ),
    [folders],
  );
  const companyRoot = folders.find((folder) => folder.kind === "company-root") ?? null;

  const companyDestinations = useMemo<readonly CompanyDestination[]>(() => {
    const pathLabel = (folder: KnowledgeFolder): string => {
      const names = [folder.name];
      let parentId = folder.parentId;
      const visited = new Set([folder.id]);
      while (parentId !== null) {
        const parent = byId.get(parentId);
        if (!parent || parent.kind === "company-root" || visited.has(parent.id)) break;
        visited.add(parent.id);
        names.unshift(parent.name);
        parentId = parent.parentId;
      }
      return `Компания / ${names.join(" / ")}`;
    };
    return [
      { id: "", label: "Компания" },
      ...companyFolders.map((folder) => ({
        id: folder.companyFolderId ?? "",
        label: pathLabel(folder),
      })),
    ];
  }, [byId, companyFolders]);

  const children = folders
    .filter((folder) => folder.parentId === resolvedCurrentId)
    .toSorted((left, right) => left.name.localeCompare(right.name, "ru"));
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleFiles = files
    .filter((file) =>
      normalizedQuery
        ? file.name.toLocaleLowerCase("ru").includes(normalizedQuery)
        : file.folderId === resolvedCurrentId,
    )
    .toSorted((left, right) => left.name.localeCompare(right.name, "ru"));

  const folderCount = (folderId: string) =>
    folders.filter((folder) => folder.parentId === folderId).length
    + files.filter((file) => file.folderId === folderId).length;

  const openFolder = (folderId: string | null) => {
    setCurrentId(folderId);
    setSelectedFolderId(null);
    setSelectedFileId(null);
    setQuery("");
  };

  const folderDestinations = (folder: KnowledgeFolder): readonly CompanyDestination[] => {
    const blockedUiIds = new Set([folder.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of companyFolders) {
        if (
          candidate.parentId !== null
          && blockedUiIds.has(candidate.parentId)
          && !blockedUiIds.has(candidate.id)
        ) {
          blockedUiIds.add(candidate.id);
          changed = true;
        }
      }
    }
    const blockedServerIds = new Set(
      companyFolders
        .filter((candidate) => blockedUiIds.has(candidate.id))
        .flatMap((candidate) => candidate.companyFolderId ? [candidate.companyFolderId] : []),
    );
    return companyDestinations.filter(
      (destination) => !blockedServerIds.has(destination.id),
    );
  };

  const companyParentId = (folder: KnowledgeFolder): string => {
    if (folder.parentId === null || folder.parentId === companyRoot?.id) return "";
    return byId.get(folder.parentId)?.companyFolderId ?? "";
  };

  const canCreateHere = canManageCompany
    && (current?.kind === "company-root" || current?.kind === "company");
  const uploadFolderId = current?.kind === "company"
    ? (current.companyFolderId ?? "")
    : "";

  const renderTree = (parentId: string, depth = 0): ReactNode => {
    const rows = folders
      .filter((folder) => folder.parentId === parentId)
      .toSorted((left, right) => left.name.localeCompare(right.name, "ru"));
    if (rows.length === 0) return null;
    return (
      <ul className={depth === 0 ? "mt-1 flex flex-col gap-1" : "ms-4 border-s border-border ps-2"}>
        {rows.map((folder) => (
          <li key={folder.id}>
            <button
              type="button"
              onClick={() => openFolder(folder.id)}
              aria-current={resolvedCurrentId === folder.id ? "page" : undefined}
              className={`flex min-h-10 w-full items-center gap-2 rounded-nav px-2 text-start text-xs ${
                resolvedCurrentId === folder.id
                  ? "bg-surface font-semibold text-fg"
                  : "text-fg-2 hover:bg-surface"
              }`}
            >
              {folder.kind === "student" ? (
                <span
                  aria-hidden="true"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 font-semibold text-fg-2"
                >
                  {folderInitial(folder.name)}
                </span>
              ) : (
                <Icon name="folder" size={15} className="shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <span className="font-mono text-2xs text-fg-3">{folderCount(folder.id)}</span>
            </button>
            {folder.kind === "company" ? renderTree(folder.id, depth + 1) : null}
          </li>
        ))}
      </ul>
    );
  };

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
            aria-current={resolvedCurrentId === null ? "page" : undefined}
            className={`flex min-h-11 w-full items-center gap-2 rounded-nav px-3 text-start text-sm ${
              resolvedCurrentId === null
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
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => openFolder(folder.id)}
                    aria-current={resolvedCurrentId === folder.id ? "page" : undefined}
                    data-testid={folder.kind === "company-root" ? "v3-knowledge-company-root" : undefined}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-nav px-3 text-start text-sm ${
                      resolvedCurrentId === folder.id
                        ? "bg-surface font-semibold text-fg"
                        : "text-fg-2 hover:bg-surface"
                    }`}
                  >
                    <Icon name="folder" size={16} />
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <span className="font-mono text-2xs text-fg-3">{folderCount(folder.id)}</span>
                  </button>
                  {folder.kind === "company-root" || folder.kind === "students"
                    ? renderTree(folder.id)
                    : null}
                </li>
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
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedFolderId(null);
                  setSelectedFileId(null);
                }}
                placeholder="Поиск документов"
                className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
              />
            </label>
          </div>

          {canCreateHere ? (
            <div className="grid gap-3 border-b border-border py-4 md:grid-cols-2">
              <details className="rounded-ctl border border-control-edge bg-surface-2 px-3 py-2">
                <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-fg">
                  <Icon name="plus" size={16} />
                  Новая папка
                </summary>
                <div className="pt-3">
                  <CreateFolderForm
                    key={requestIds.createFolder}
                    parentFolderId={uploadFolderId}
                    requestId={requestIds.createFolder}
                  />
                </div>
              </details>
              <details className="rounded-ctl border border-control-edge bg-surface-2 px-3 py-2">
                <summary
                  className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-fg"
                  data-testid="v3-knowledge-upload-toggle"
                >
                  <Icon name="upload" size={16} />
                  Загрузить файл
                </summary>
                <div className="pt-3">
                  <UploadFileForm
                    key={requestIds.uploadFile}
                    folderId={uploadFolderId}
                    initialRequestId={requestIds.uploadFile}
                  />
                </div>
              </details>
            </div>
          ) : null}

          {!normalizedQuery && children.length > 0 ? (
            <ul className="grid gap-3 py-4 sm:grid-cols-2 xl:grid-cols-3">
              {children.map((folder) => {
                const requests = folder.kind === "company"
                  ? requestIds.folders[folder.companyFolderId ?? ""]
                  : undefined;
                return (
                  <li
                    key={folder.id}
                    className="min-w-0"
                    data-testid={folder.kind === "company" ? "v3-knowledge-company-folder-row" : undefined}
                  >
                    <div className="flex min-h-20 items-center gap-2 rounded-card border border-control-edge bg-surface-2 p-2 hover:border-accent">
                      <button
                        type="button"
                        onClick={() => openFolder(folder.id)}
                        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-nav p-1 text-start"
                      >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-surface-3 text-fg-2">
                          {folder.kind === "student" ? folderInitial(folder.name) : <Icon name="folder" size={19} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-fg">{folder.name}</span>
                          <span className="mt-0.5 block text-2xs text-fg-3">
                            {folderCount(folder.id)} записей
                          </span>
                        </span>
                      </button>
                      {canManageCompany && folder.kind === "company" && requests ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFolderId((selected) =>
                              selected === folder.id ? null : folder.id);
                            setSelectedFileId(null);
                          }}
                          aria-expanded={selectedFolderId === folder.id}
                          aria-label={`Изменить папку ${folder.name}`}
                          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-nav text-fg-2 hover:bg-surface-3"
                          data-testid="v3-knowledge-company-folder-actions"
                        >
                          <Icon name="menu" size={17} />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {canManageCompany
            && selectedFolder?.kind === "company"
            && selectedFolder.companyFolderId
            && requestIds.folders[selectedFolder.companyFolderId] ? (
              <section
                aria-label={`Изменение папки ${selectedFolder.name}`}
                className="mb-4 rounded-ctl border border-control-edge bg-surface px-4 py-3"
                data-testid="v3-knowledge-folder-editor"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-fg">
                    Папка · {selectedFolder.name}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(null)}
                    aria-label="Закрыть изменение папки"
                    className="grid min-h-11 min-w-11 place-items-center rounded-nav text-fg-2 hover:bg-surface-2"
                  >
                    <Icon name="x" size={17} />
                  </button>
                </div>
                <CompanyFolderControls
                  key={`${selectedFolder.companyFolderId}:${selectedFolder.version}`}
                  folder={selectedFolder}
                  requests={requestIds.folders[selectedFolder.companyFolderId]}
                  destinations={folderDestinations(selectedFolder)}
                  currentParentFolderId={companyParentId(selectedFolder)}
                />
              </section>
            ) : null}

          <div
            role="region"
            aria-label="Таблица документов"
            tabIndex={0}
            className="overflow-x-auto rounded-ctl"
          >
            <table className="w-full min-w-[680px] border-separate border-spacing-0 text-start">
              <thead>
                <tr className="text-start text-2xs uppercase tracking-wide text-fg-3">
                  <th className="border-b border-border px-3 py-2 text-start font-medium">Документ</th>
                  <th className="border-b border-border px-3 py-2 text-start font-medium">Добавлен</th>
                  <th className="border-b border-border px-3 py-2 text-start font-medium">Размер</th>
                  <th className="border-b border-border px-3 py-2 text-end font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {visibleFiles.map((file) => {
                  const currentFolder = byId.get(file.folderId);
                  const requests = file.kind === "company" && file.companyFileId
                    ? requestIds.files[file.companyFileId]
                    : undefined;
                  const currentServerFolderId = currentFolder?.kind === "company"
                    ? (currentFolder.companyFolderId ?? "")
                    : "";
                  return (
                    <Fragment key={file.id}>
                      <tr
                        className="text-sm text-fg"
                        data-testid={file.kind === "company" ? "v3-knowledge-company-file-row" : "v3-knowledge-student-file-row"}
                      >
                        <td className="border-b border-border px-3 py-3">
                          <span className="flex min-w-0 items-center gap-2 font-medium">
                            <Icon name="file-check" size={16} className="shrink-0 text-fg-3" />
                            <span className="truncate">{file.name}</span>
                          </span>
                          {normalizedQuery ? (
                            <span className="mt-0.5 block text-2xs text-fg-3">
                              {currentFolder?.name ?? "Закрытая папка"}
                            </span>
                          ) : null}
                        </td>
                        <td className="border-b border-border px-3 py-3 font-mono text-2xs text-fg-3">
                          {file.addedAt}
                        </td>
                        <td className="border-b border-border px-3 py-3 font-mono text-2xs text-fg-3">
                          {file.size}
                        </td>
                        <td className="border-b border-border px-3 py-3">
                          <span className="flex justify-end gap-2">
                            <a
                              href={file.kind === "company"
                                ? `/api/v3/knowledge/files/${file.fileVersionId}/download`
                                : `/api/v2/document-versions/${file.fileVersionId}/download`}
                              className="inline-flex min-h-11 items-center gap-2 rounded-ctl border border-control-edge px-3 text-xs font-medium text-fg-2 hover:bg-surface-2"
                              data-testid={file.kind === "company" ? "v3-knowledge-company-download" : "v3-knowledge-student-download"}
                            >
                              <Icon name="download" size={15} />
                              Скачать
                            </a>
                            {canManageCompany && file.kind === "company" && requests ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedFileId((selected) =>
                                    selected === file.id ? null : file.id);
                                  setSelectedFolderId(null);
                                }}
                                aria-expanded={selectedFileId === file.id}
                                aria-label={`Изменить файл ${file.name}`}
                                className="grid min-h-11 min-w-11 place-items-center rounded-ctl border border-control-edge text-fg-2 hover:bg-surface-2"
                                data-testid="v3-knowledge-company-file-actions"
                              >
                                <Icon name="menu" size={16} />
                              </button>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                      {canManageCompany
                        && file.kind === "company"
                        && selectedFileId === file.id
                        && requests ? (
                          <tr data-testid="v3-knowledge-file-editor">
                            <td colSpan={4} className="border-b border-border bg-surface-2 px-4 py-3">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="text-sm font-semibold text-fg">
                                  Файл · {file.name}
                                </h2>
                                <button
                                  type="button"
                                  onClick={() => setSelectedFileId(null)}
                                  aria-label="Закрыть изменение файла"
                                  className="grid min-h-11 min-w-11 place-items-center rounded-nav text-fg-2 hover:bg-surface"
                                >
                                  <Icon name="x" size={17} />
                                </button>
                              </div>
                              <CompanyFileControls
                                key={`${file.companyFileId}:${file.version}`}
                                file={file}
                                requests={requests}
                                destinations={companyDestinations}
                                currentFolderId={currentServerFolderId}
                              />
                            </td>
                          </tr>
                        ) : null}
                    </Fragment>
                  );
                })}
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
