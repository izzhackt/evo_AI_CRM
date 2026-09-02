"use client";

import { useMemo, useState } from "react";

import { Icon } from "@/components/icons";

/**
 * База знаний: дерево папок слева, содержимое справа.
 *
 * Собрано по референсам: вкладки над деревом, дерево с иконками и счётчиками,
 * хлебные крошки над содержимым, плитки папок с настоящей фигурой папки и
 * типами файлов на ней, таблица с автором и его аватаром, выбор строк
 * галочками.
 *
 * ДАННЫЕ. Компонент ничего не грузит — рисует переданное. Дерево при
 * подключении выведется из `source_path` у чанков знаний: поиск по базе уже
 * работает с путями вида `onboarding/guide.md`, так что отдельную сущность
 * «папка» заводить не придётся.
 */

export type KnowledgeFolder = Readonly<{
  id: string;
  name: string;
  count: number;
  /** Расширения внутри — ложатся на фигуру папки, как в референсе. */
  kinds: readonly string[];
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

/** Заливка значка файла. Свои цвета, а не чужие фирменные марки. */
const KIND_FILL: Record<string, string> = {
  pdf: "var(--danger)",
  docx: "var(--info)",
  xlsx: "var(--ok)",
  md: "var(--text-2)",
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

/**
 * Значок типа файла: лист с загнутым углом, залитый цветом типа.
 *
 * В референсе на папке лежат разноцветные иконки приложений. Чужие фирменные
 * марки сюда тащить нельзя, поэтому форма своя — но роль та же: по цвету и
 * силуэту видно, из чего папка, не читая подписей.
 */
function KindGlyph({ kind, index }: { kind: string; index: number }) {
  const letter = kind === "xlsx" ? "X" : kind === "docx" ? "W" : kind === "pdf" ? "P" : "M";
  return (
    <span
      className="relative grid h-8 w-8 place-items-center rounded-[8px] border border-border bg-surface shadow-evo"
      style={{ marginInlineStart: index === 0 ? 0 : -8, zIndex: 10 - index }}
      title={kind.toUpperCase()}
    >
      <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
        <path
          d="M4.5 1.6h6.4l4.6 4.6V17a1.4 1.4 0 0 1-1.4 1.4H4.5A1.4 1.4 0 0 1 3.1 17V3A1.4 1.4 0 0 1 4.5 1.6Z"
          fill={KIND_FILL[kind] ?? "var(--text-2)"}
        />
        <path d="M10.9 1.6 15.5 6.2h-3.2a1.4 1.4 0 0 1-1.4-1.4V1.6Z" fill="#fff" fillOpacity="0.42" />
        <text
          x="9.3"
          y="14.6"
          textAnchor="middle"
          fontSize="7.6"
          fontWeight="700"
          fill="#fff"
          fontFamily="var(--font-golos), system-ui, sans-serif"
        >
          {letter}
        </text>
      </svg>
    </span>
  );
}

/** Инициалы вместо фотографии: снимков сотрудников в системе нет. */
function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden="true"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-2xs font-semibold text-fg-2"
    >
      {initials}
    </span>
  );
}

/**
 * Плитка папки: залитая фигура со значками типов на ней — как в референсе.
 *
 * Плитка темнее самой папки: в референсе папка читается за счёт того, что она
 * светлее подложки. Без этой разницы фигура превращается в серое пятно, что и
 * случилось в первой попытке, когда обе стенки были почти одного тона.
 */
function FolderTile({ folder }: { folder: KnowledgeFolder }) {
  return (
    <button
      type="button"
      className="flex w-full flex-col gap-2.5 rounded-card border border-border bg-surface p-3 text-start hover:border-control-edge"
    >
      <span className="relative block w-full overflow-hidden rounded-nav bg-surface-3 pb-[54%]">
        <svg viewBox="0 0 200 108" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <path
            d="M26 20h40a8 8 0 0 1 5.7 2.4l7.6 7.6H174a10 10 0 0 1 10 10v48a10 10 0 0 1-10 10H26a10 10 0 0 1-10-10V30a10 10 0 0 1 10-10Z"
            fill="var(--surface-2)"
            stroke="var(--border-strong)"
            strokeWidth="1.5"
          />
          <path
            d="M16 44h168v44a10 10 0 0 1-10 10H26a10 10 0 0 1-10-10V44Z"
            fill="var(--surface)"
            stroke="var(--border-strong)"
            strokeWidth="1.5"
          />
        </svg>

        <span className="absolute bottom-3 left-3.5 flex items-end">
          {folder.kinds.map((kind, index) => (
            <KindGlyph key={kind} kind={kind} index={index} />
          ))}
        </span>
      </span>

      <span className="block text-sm font-semibold text-fg">{folder.name}</span>
      <span className="block font-mono text-2xs text-fg-3">{folder.count} файлов</span>
    </button>
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
  const [tab, setTab] = useState<"folders" | "tags">("folders");

  // Один поиск на дерево и на файлы: искать отдельно в папках и отдельно в
  // файлах значит заставлять человека помнить, где он ищет.
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
    <div className="grid gap-5 @4xl:grid-cols-[minmax(0,272px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-md font-bold text-fg">База знаний</h2>
          <button
            type="button"
            aria-label="Добавить папку"
            className="grid h-8 w-8 place-items-center rounded-nav border border-border text-fg-2 hover:bg-surface-2"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>

        <label className="flex h-10 items-center gap-2 rounded-ctl border border-control-edge bg-surface px-3">
          <Icon name="search" size={15} className="shrink-0 text-fg-3" />
          <span className="sr-only">Поиск по базе знаний</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск…"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
          />
        </label>

        {/* Вкладки из референса. Теги в модели ещё не заведены, и вкладка
            говорит об этом прямо, а не притворяется пустой папкой. */}
        <div role="tablist" aria-label="Разделы базы" className="flex gap-1 rounded-ctl bg-surface-2 p-1">
          {(["folders", "tags"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`min-h-9 flex-1 rounded-nav text-sm font-semibold ${
                tab === key ? "border border-control-edge bg-surface text-fg" : "border border-transparent text-fg-3"
              }`}
            >
              {key === "folders" ? "Папки" : "Теги"}
            </button>
          ))}
        </div>

        {tab === "folders" ? (
          <nav aria-label="Папки">
            <ul className="flex flex-col">
              {shownFolders.map((folder) => {
                const active = folder.name === currentFolder;
                return (
                  <li key={folder.id}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      style={{ paddingInlineStart: `${0.55 + folder.depth * 0.9}rem` }}
                      className={`flex min-h-10 w-full items-center gap-2 rounded-nav pe-2.5 text-start text-sm ${
                        active ? "bg-surface-2 font-semibold text-fg" : "text-fg-2 hover:bg-surface-2"
                      }`}
                    >
                      <Icon
                        name="folder"
                        size={15}
                        className={`shrink-0 ${active ? "text-fg" : "text-fg-3"}`}
                      />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                      <span className="shrink-0 font-mono text-2xs text-fg-3">{folder.count}</span>
                    </button>
                  </li>
                );
              })}
              {shownFolders.length === 0 ? (
                <li className="px-2.5 py-3 text-sm text-fg-3">Папок не найдено</li>
              ) : null}
            </ul>
          </nav>
        ) : (
          <p className="rounded-card border border-border bg-surface px-3 py-4 text-sm leading-5 text-fg-3">
            Тегов пока нет: в модели знаний их не заводили. Появятся — встанут сюда.
          </p>
        )}
      </aside>

      <section className="flex min-w-0 flex-col gap-5">
        {/* Хлебные крошки над содержимым — из первого референса. */}
        <button
          type="button"
          className="flex min-h-9 w-fit items-center gap-1.5 rounded-nav px-1 text-md font-bold text-fg hover:bg-surface-2"
        >
          {currentFolder}
          <Icon name="chevron-right" size={16} className="rotate-90 text-fg-3" />
        </button>

        <div>
          <h3 className="text-sm font-semibold text-fg-2">Папки</h3>
          <ul className="mt-2.5 grid gap-3 @lg:grid-cols-2 @6xl:grid-cols-3">
            {shownFolders
              .filter((folder) => folder.depth === 0)
              .map((folder) => (
                <li key={folder.id}>
                  <FolderTile folder={folder} />
                </li>
              ))}
          </ul>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg-2">Файлы</h3>
            {selected.length > 0 ? (
              <span className="font-mono text-2xs text-fg-3">выбрано {selected.length}</span>
            ) : null}
          </div>

          <div className="mt-2.5 max-w-full overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-[600px] border-collapse bg-surface text-sm">
              <caption className="sr-only">Файлы в папке {currentFolder}</caption>
              <thead>
                <tr className="border-b border-border">
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
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2 text-fg-2">
                        <Avatar name={file.addedBy} />
                        <span className="truncate">{file.addedBy}</span>
                      </span>
                    </td>
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
