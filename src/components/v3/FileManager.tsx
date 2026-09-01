"use client";

import { useMemo, useState } from "react";

/**
 * База знаний: дерево папок слева, содержимое справа.
 *
 * Из первого референса взято дерево со счётчиками и таблица файлов с автором;
 * из второго — выбор строк галочками. Плитки папок оставлены, но без
 * превью-картинок: миниатюра PDF ничего не сообщает, а вот из каких типов
 * состоит папка — сообщает, поэтому на плитке стоят типы, а не картинка.
 *
 * ДАННЫЕ. Компонент ничего не грузит и ничего не хранит — рисует то, что
 * передали. Дерево при подключении выведется из `source_path` у чанков знаний:
 * поиск по базе уже работает с путями вида `onboarding/guide.md`, так что
 * папки не придётся заводить отдельной сущностью.
 */

export type KnowledgeFolder = Readonly<{
  id: string;
  name: string;
  /** Сколько файлов внутри, включая вложенные папки. */
  count: number;
  /** Расширения, встречающиеся внутри. Показывают, из чего папка состоит. */
  kinds: readonly string[];
  /** Вложенность в дереве: 0 — корень. */
  depth: number;
}>;

export type KnowledgeFile = Readonly<{
  id: string;
  name: string;
  kind: string;
  addedBy: string;
  addedAt: string;
  size: string;
}>;

const KIND_TONE: Record<string, string> = {
  pdf: "bg-danger-weak text-danger",
  docx: "bg-info-weak text-info",
  xlsx: "bg-ok-weak text-ok",
  md: "bg-surface-3 text-fg-2",
};

function KindBadge({ kind }: { kind: string }) {
  return (
    <span
      className={`inline-flex min-w-8 justify-center rounded-[4px] px-1 py-0.5 font-mono text-2xs font-semibold uppercase ${
        KIND_TONE[kind] ?? "bg-surface-3 text-fg-2"
      }`}
    >
      {kind}
    </span>
  );
}

export function FileManager({
  folders,
  files,
  currentFolder,
}: {
  folders: readonly KnowledgeFolder[];
  files: readonly KnowledgeFile[];
  currentFolder: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);

  // Поиск фильтрует и дерево, и файлы: искать отдельно в папках и отдельно в
  // файлах — значит заставлять человека помнить, где он ищет.
  const needle = query.trim().toLowerCase();
  const shownFolders = useMemo(
    () => (needle ? folders.filter((f) => f.name.toLowerCase().includes(needle)) : folders),
    [folders, needle],
  );
  const shownFiles = useMemo(
    () => (needle ? files.filter((f) => f.name.toLowerCase().includes(needle)) : files),
    [files, needle],
  );

  const allShownSelected =
    shownFiles.length > 0 && shownFiles.every((f) => selected.includes(f.id));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <label className="flex h-10 items-center gap-2 rounded-ctl border border-control-edge bg-surface px-3">
          <span className="sr-only">Поиск по базе знаний</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск…"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
          />
        </label>

        <nav aria-label="Папки">
          <ul className="flex flex-col">
            {shownFolders.map((folder) => {
              const active = folder.name === currentFolder;
              return (
                <li key={folder.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    style={{ paddingInlineStart: `${0.6 + folder.depth * 0.85}rem` }}
                    className={`flex min-h-10 w-full items-center gap-2 rounded-nav pe-2.5 text-start text-sm ${
                      active ? "bg-accent-weak font-semibold text-fg" : "text-fg-2 hover:bg-surface-2"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <span className="shrink-0 font-mono text-2xs text-fg-3">
                      {folder.count}
                    </span>
                  </button>
                </li>
              );
            })}
            {shownFolders.length === 0 ? (
              <li className="px-2.5 py-3 text-sm text-fg-3">Папок не найдено</li>
            ) : null}
          </ul>
        </nav>
      </aside>

      <section className="flex min-w-0 flex-col gap-5">
        <div>
          <h3 className="text-md font-bold text-fg">Папки</h3>
          <ul className="mt-2.5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shownFolders
              .filter((folder) => folder.depth === 0)
              .map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-2 rounded-card border border-border bg-surface p-3.5 text-start hover:border-control-edge"
                  >
                    <span className="flex flex-wrap gap-1">
                      {folder.kinds.map((kind) => (
                        <KindBadge key={kind} kind={kind} />
                      ))}
                    </span>
                    <span className="text-sm font-semibold text-fg">{folder.name}</span>
                    <span className="font-mono text-2xs text-fg-3">
                      {folder.count} файлов
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-md font-bold text-fg">Файлы</h3>
            {selected.length > 0 ? (
              <span className="font-mono text-2xs text-fg-3">
                выбрано {selected.length}
              </span>
            ) : null}
          </div>

          <div className="mt-2.5 max-w-full overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-[560px] border-collapse bg-surface text-sm">
              <caption className="sr-only">
                Файлы в папке {currentFolder}
              </caption>
              <thead>
                <tr className="border-b border-border text-start">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <label className="flex items-center justify-center">
                      <span className="sr-only">Выбрать все показанные файлы</span>
                      <input
                        type="checkbox"
                        checked={allShownSelected}
                        onChange={(event) =>
                          setSelected(event.target.checked ? shownFiles.map((f) => f.id) : [])
                        }
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </label>
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start text-2xs font-semibold uppercase tracking-wide text-fg-3">
                    Название
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start text-2xs font-semibold uppercase tracking-wide text-fg-3">
                    Добавил
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start text-2xs font-semibold uppercase tracking-wide text-fg-3">
                    Размер
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start text-2xs font-semibold uppercase tracking-wide text-fg-3">
                    Добавлен
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownFiles.map((file) => (
                  <tr key={file.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="px-3 py-2.5">
                      <label className="flex items-center justify-center">
                        <span className="sr-only">Выбрать {file.name}</span>
                        <input
                          type="checkbox"
                          checked={selected.includes(file.id)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, file.id]
                                : current.filter((id) => id !== file.id),
                            )
                          }
                          className="h-4 w-4 accent-[var(--accent)]"
                        />
                      </label>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <KindBadge kind={file.kind} />
                        <span className="min-w-0 truncate font-medium text-fg">{file.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-fg-2">{file.addedBy}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-fg-3">{file.size}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-fg-3">{file.addedAt}</td>
                  </tr>
                ))}
                {shownFiles.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-fg-3">
                      {needle ? `По запросу «${query}» ничего не найдено` : "Папка пуста"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
