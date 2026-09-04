"use client";

import { useMemo, useState } from "react";

import { Icon } from "@/components/icons";

export type KnowledgeFolderKind = "company" | "students" | "student";

export type KnowledgeFolder = Readonly<{
  id: string;
  name: string;
  parentId: string | null;
  kind: KnowledgeFolderKind;
}>;

export type KnowledgeFile = Readonly<{
  id: string;
  folderId: string | null;
  name: string;
  addedBy: string | null;
  addedAt: string;
  size: string | null;
}>;

/**
 * Read-only document navigator over canonical private Storage metadata.
 *
 * Upload, rename, move, delete and download return only when their real
 * server-backed routes are wired in #597/#598. This component must not create
 * a second browser-only document authority.
 */
export function FileManager({
  folders,
  files,
}: {
  folders: readonly KnowledgeFolder[];
  files: readonly KnowledgeFile[];
}) {
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
    .filter((file) =>
      normalizedQuery
        ? file.name.toLocaleLowerCase("ru").includes(normalizedQuery)
        : file.folderId === currentId,
    )
    .toSorted((left, right) => left.name.localeCompare(right.name, "ru"));

  const folderCount = (folderId: string) =>
    folders.filter((folder) => folder.parentId === folderId).length
    + files.filter((file) => file.folderId === folderId).length;

  const openFolder = (folderId: string | null) => {
    setCurrentId(folderId);
    setQuery("");
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
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => openFolder(folder.id)}
                    aria-current={currentId === folder.id ? "page" : undefined}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-nav px-3 text-start text-sm ${
                      currentId === folder.id
                        ? "bg-surface font-semibold text-fg"
                        : "text-fg-2 hover:bg-surface"
                    }`}
                  >
                    <Icon name="folder" size={16} />
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <span className="font-mono text-2xs text-fg-3">{folderCount(folder.id)}</span>
                  </button>

                  {folder.kind === "students" ? (
                    <ul className="ms-4 mt-1 flex flex-col gap-1 border-s border-border ps-2">
                      {folders
                        .filter((child) => child.parentId === folder.id)
                        .toSorted((left, right) => left.name.localeCompare(right.name, "ru"))
                        .map((child) => (
                          <li key={child.id}>
                            <button
                              type="button"
                              onClick={() => openFolder(child.id)}
                              aria-current={currentId === child.id ? "page" : undefined}
                              className={`flex min-h-10 w-full items-center gap-2 rounded-nav px-2 text-start text-xs ${
                                currentId === child.id
                                  ? "bg-surface font-semibold text-fg"
                                  : "text-fg-2 hover:bg-surface"
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 font-semibold text-fg-2"
                              >
                                {child.name.slice(0, 1).toUpperCase()}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{child.name}</span>
                              <span className="font-mono text-2xs text-fg-3">
                                {folderCount(child.id)}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </li>
              ))}
          </ul>
        </nav>

        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
            <nav aria-label="Путь к папке" className="min-w-0 flex-1">
              <ol className="flex min-w-0 items-center gap-1 text-sm text-fg-2">
                <li>
                  <button type="button" onClick={() => openFolder(null)} className="min-h-8 rounded-nav px-1 hover:text-fg">
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
                  <th className="border-b border-border px-3 py-2 text-start font-medium">Добавлен</th>
                  <th className="border-b border-border px-3 py-2 text-start font-medium">Размер</th>
                </tr>
              </thead>
              <tbody>
                {visibleFiles.map((file) => (
                  <tr key={file.id} className="text-sm text-fg">
                    <td className="border-b border-border px-3 py-3">
                      <span className="font-medium">{file.name}</span>
                      {normalizedQuery && file.folderId ? (
                        <span className="mt-0.5 block text-2xs text-fg-3">
                          {byId.get(file.folderId)?.name ?? "Закрытая папка"}
                        </span>
                      ) : null}
                      {file.addedBy ? (
                        <span className="mt-0.5 block text-2xs text-fg-3">{file.addedBy}</span>
                      ) : null}
                    </td>
                    <td className="border-b border-border px-3 py-3 font-mono text-2xs text-fg-3">
                      {file.addedAt}
                    </td>
                    <td className="border-b border-border px-3 py-3 font-mono text-2xs text-fg-3">
                      {file.size ?? "—"}
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
