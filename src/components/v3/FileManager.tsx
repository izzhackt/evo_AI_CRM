"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/icons";

/**
 * База знаний: дерево папок слева, содержимое справа.
 *
 * Собрано по референсам: дерево с иконками и счётчиками, хлебные крошки над
 * содержимым, плитки папок с настоящей фигурой папки и типами файлов на ней,
 * таблица с автором и его аватаром, выбор строк галочками.
 *
 * ЧТО ЗДЕСЬ РАБОТАЕТ. Папки и файлы заводятся, переименовываются, переносятся
 * и удаляются; настоящий файл загружается через `input type=file` и скачивается
 * обратно объектным URL. Всё это живёт в состоянии страницы: действия работают
 * в браузере и никуда не сохраняются, пока не подключён бэкенд. Интерфейс об
 * этом молчит — он просто работает.
 *
 * ПАПКИ СТУДЕНТОВ. Отдельный корневой узел «Студенты», внутри — по папке на
 * студента. Они заводятся вместе со студентом, поэтому у них нет ни кнопки
 * действий, ни возможности создать рядом такую же. Отличаются не подписью, а
 * местом в дереве и знаком: у папки компании — фигура папки, у студента — круг
 * с инициалами, у корня «Студенты» — инициалы тех, кто внутри.
 *
 * ДАННЫЕ. Компонент ничего не грузит — рисует переданное и дальше меняет свою
 * копию. Дерево при подключении выведется из `source_path` у чанков знаний:
 * поиск по базе уже работает с путями вида `onboarding/guide.md`, так что
 * отдельную сущность «папка» заводить не придётся.
 */

/* ------------------------------------------------------------------ Типы */

export type KnowledgeFolderKind = "company" | "students" | "student";

export type KnowledgeFolder = Readonly<{
  id: string;
  name: string;
  /** null — корень базы. */
  parentId: string | null;
  /**
   * Папка компании заводится руками; «students» — единственный корень
   * студентов; «student» — папка одного студента, она приходит вместе с ним.
   */
  kind: KnowledgeFolderKind;
}>;

export type KnowledgeFile = Readonly<{
  id: string;
  /** Где лежит. null — в корне базы. */
  folderId: string | null;
  name: string;
  /** Кто добавил. null — модель этого не знает, и тогда ничего не рисуется. */
  addedBy: string | null;
  addedAt: string;
  /** Размер готовой строкой. null — размер неизвестен. */
  size: string | null;
}>;

type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  kind: KnowledgeFolderKind;
};

type Doc = {
  id: string;
  folderId: string | null;
  name: string;
  addedBy: string | null;
  addedAt: string;
  size: string | null;
  /**
   * Есть ли настоящее содержимое — то, что можно скачать.
   *
   * Признак держится в состоянии, а не проверкой по хранилищу содержимого:
   * само содержимое рисовать нечем, оно лежит в ref, а читать ref во время
   * отрисовки нельзя — компонент не перерисуется, когда оно появится.
   */
  hasContent: boolean;
};

/** Что сейчас делают. Одно действие за раз: два открытых поля путают. */
type Editing =
  | { kind: "create"; what: "folder" | "file" }
  | { kind: "menu"; what: "folder" | "file"; id: string }
  | { kind: "rename"; what: "folder" | "file"; id: string }
  | { kind: "move"; what: "folder" | "file"; id: string }
  | { kind: "delete"; what: "folder" | "file"; id: string }
  | { kind: "bulk-move" }
  | { kind: "bulk-delete" }
  | null;

/** Строка, к которой относится открытая панель действий. */
type Target = {
  what: "folder" | "file";
  id: string;
  name: string;
  /** Переименовать и удалить. У папок студентов — нельзя. */
  canEdit: boolean;
  canMove: boolean;
  canDownload: boolean;
  /** Что внутри — словами, для вопроса при удалении. null — пусто. */
  inside: string | null;
  /** Спрашивать ли перед удалением. Пустую папку спрашивать не о чем. */
  confirm: boolean;
};

const ROOT_NAME = "База знаний";

/* -------------------------------------------------------------- Мелочёвка */

/** Заливка значка файла. Свои цвета, а не чужие фирменные марки. */
const KIND_FILL: Record<string, string> = {
  pdf: "var(--danger)",
  docx: "var(--info)",
  xlsx: "var(--ok)",
  md: "var(--text-2)",
};

/** Тип берётся из имени: переименовали в .pdf — значок сменился сам. */
function kindOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  const ext = name.slice(dot + 1).toLowerCase();
  return ext.length <= 4 ? ext : "";
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} КБ`;
  return `${(kb / 1024).toFixed(1).replace(".", ",")} МБ`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Расширение файла. Тон один на все типы: цвет в этом мире означает состояние
 * записи, и «pdf» — не состояние.
 */
function KindBadge({ kind }: { kind: string }) {
  if (!kind) return null;
  return (
    <span className="inline-flex min-w-8 shrink-0 justify-center rounded-nav bg-surface-3 px-1 py-0.5 font-mono text-2xs font-semibold uppercase text-fg-2">
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
  const letter =
    kind === "xlsx" ? "X" : kind === "docx" ? "W" : kind === "pdf" ? "P" : kind === "md" ? "M" : kind[0]?.toUpperCase() ?? "?";
  return (
    <span
      className="relative grid h-8 w-8 place-items-center rounded-ctl border border-border bg-surface"
      style={{ marginInlineStart: index === 0 ? 0 : -8, zIndex: 10 - index }}
      title={kind.toUpperCase()}
    >
      <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
        <path
          d="M4.5 1.6h6.4l4.6 4.6V17a1.4 1.4 0 0 1-1.4 1.4H4.5A1.4 1.4 0 0 1 3.1 17V3A1.4 1.4 0 0 1 4.5 1.6Z"
          fill={KIND_FILL[kind] ?? "var(--text-2)"}
        />
        <path d="M10.9 1.6 15.5 6.2h-3.2a1.4 1.4 0 0 1-1.4-1.4V1.6Z" fill="var(--surface)" fillOpacity="0.42" />
        <text
          x="9.3"
          y="14.6"
          textAnchor="middle"
          fontSize="7.6"
          fontWeight="700"
          fill="var(--surface)"
          fontFamily="var(--font-golos), system-ui, sans-serif"
        >
          {letter}
        </text>
      </svg>
    </span>
  );
}

/**
 * Инициалы вместо фотографии: снимков людей в системе нет.
 *
 * Размер «md» — стопка на плитке «Студенты»: она стоит там же, где у папки
 * компании лежат значки типов файлов, и по той же причине сделана такой же по
 * размеру. Мельче — и круги читались бы серыми точками.
 */
const INITIALS_SIZE: Record<string, string> = {
  sm: "h-6 w-6 bg-surface-3 text-2xs",
  md: "h-8 w-8 border border-border bg-surface text-2xs",
  lg: "h-12 w-12 border border-border bg-surface text-sm",
};

function Initials({
  name,
  size = "sm",
  index = 0,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  index?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-mono font-semibold text-fg-2 ${INITIALS_SIZE[size]}`}
      style={index === 0 ? undefined : { marginInlineStart: -8, zIndex: 10 - index }}
    >
      {initialsOf(name)}
    </span>
  );
}

/* ---------------------------------------------------------- Общие кусочки */

const FIELD =
  "min-h-11 min-w-0 flex-1 rounded-ctl border border-control-edge bg-surface px-2.5 text-sm text-fg outline-none placeholder:text-fg-3";
const PRIMARY = "min-h-11 shrink-0 rounded-ctl bg-accent px-3 text-sm font-semibold text-on-accent";
const SECONDARY = "min-h-11 shrink-0 rounded-ctl border border-control-edge px-3 text-sm font-medium text-fg-2 hover:bg-surface-2";
const MENU_ITEM = "min-h-11 w-full rounded-nav px-2 text-start text-sm text-fg-2 hover:bg-surface-2";

/** Одно поле с именем: заводит папку, файл или переименовывает. */
function NameForm({
  label,
  initial,
  submit,
  placeholder,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial: string;
  submit: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const fieldId = useId();
  const [value, setValue] = useState(initial);
  const clean = value.trim();

  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (clean) onSubmit(clean);
      }}
    >
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      <input
        id={fieldId}
        // Поле открылось по нажатию: курсор должен быть уже в нём.
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className={FIELD}
      />
      <button type="submit" disabled={!clean} className={`${PRIMARY} disabled:opacity-50`}>
        {submit}
      </button>
      <button type="button" onClick={onCancel} className={SECONDARY}>
        Отмена
      </button>
    </form>
  );
}

/** Список папок-назначений. Всплывающего меню нет: оно резалось бы краем. */
function MoveList({
  rows,
  onPick,
  onCancel,
}: {
  rows: readonly { id: string | null; name: string; depth: number }[];
  onPick: (id: string | null) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label="Куда перенести" tabIndex={0} className="flex max-h-56 flex-col overflow-y-auto">
        {rows.map((row) => (
          <li key={row.id ?? "root"}>
            <button
              type="button"
              onClick={() => onPick(row.id)}
              style={{ paddingInlineStart: `${0.5 + row.depth * 0.9}rem` }}
              className={`${MENU_ITEM} flex items-center gap-2`}
            >
              <Icon name="folder" size={15} className="shrink-0 text-fg-3" />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCancel} className={`${SECONDARY} self-start`}>
        Отмена
      </button>
    </div>
  );
}

function Confirm({
  question,
  onConfirm,
  onCancel,
}: {
  question: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1 text-sm text-fg">{question}</p>
      <button type="button" onClick={onConfirm} className={PRIMARY}>
        Удалить
      </button>
      <button type="button" onClick={onCancel} className={SECONDARY}>
        Отмена
      </button>
    </div>
  );
}

/* ---------------------------------------------------------- Плитка папки */

function FolderTile({
  folder,
  count,
  kinds,
  people,
  onOpen,
  menu,
  panel,
}: {
  folder: Folder;
  count: number;
  kinds: readonly string[];
  /** Кто внутри корня студентов. Ключ — по папке, тёзки не редкость. */
  people: readonly { id: string; name: string }[];
  onOpen: () => void;
  menu: React.ReactNode;
  panel: React.ReactNode;
}) {
  return (
    <div className="relative flex h-full w-full flex-col gap-2.5 rounded-card border border-border bg-surface p-3 focus-within:border-control-edge hover:border-control-edge">
      <span className="relative block w-full overflow-hidden rounded-nav bg-surface-3 pb-[54%]">
        {folder.kind === "student" ? (
          <span className="absolute inset-0 grid place-items-center">
            <Initials name={folder.name} size="lg" />
          </span>
        ) : (
          <>
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
              {folder.kind === "students"
                ? people.map((person, index) => (
                    <Initials key={person.id} name={person.name} size="md" index={index} />
                  ))
                : kinds.map((kind, index) => <KindGlyph key={kind} kind={kind} index={index} />)}
            </span>
          </>
        )}
      </span>

      <div className="flex items-start gap-1.5">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-start after:absolute after:inset-0 after:content-['']">
          <span className="block truncate text-sm font-semibold text-fg">{folder.name}</span>
          <span className="mt-0.5 block font-mono text-2xs text-fg-3">
            {count} {plural(count, "файл", "файла", "файлов")}
          </span>
        </button>
        {menu}
      </div>

      {panel}
    </div>
  );
}

/* ------------------------------------------------------------ Сам менеджер */

export function FileManager({
  folders: initialFolders,
  files: initialFiles,
  today,
}: {
  folders: readonly KnowledgeFolder[];
  files: readonly KnowledgeFile[];
  /** Сегодняшняя дата строкой — считает сервер, у него один часовой пояс. */
  today: string;
}) {
  const [folders, setFolders] = useState<Folder[]>(() => initialFolders.map((f) => ({ ...f })));
  const [docs, setDocs] = useState<Doc[]>(() => initialFiles.map((f) => ({ ...f, hasContent: false })));
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [editing, setEditing] = useState<Editing>(null);

  /** Настоящее содержимое загруженных файлов. Живёт вне состояния: рисовать
      его нечем, а перерисовку оно бы вызывало зря. */
  const contents = useRef(new Map<string, Blob>());
  const counter = useRef(0);
  const nextId = () => `k${(counter.current += 1)}`;

  const uploadId = useId();
  const filesHeadingId = useId();

  /**
   * Кнопка, с которой открыли панель. Панель закрывается — фокус возвращается
   * на неё: иначе клавиатура остаётся посреди пустого места.
   */
  const trigger = useRef<HTMLButtonElement | null>(null);

  const openPanel = (next: Editing, event: React.MouseEvent<HTMLButtonElement>) => {
    trigger.current = event.currentTarget;
    setEditing(next);
  };

  const closePanel = () => {
    const button = trigger.current;
    trigger.current = null;
    setEditing(null);
    // Кнопки может уже не быть — например, строку удалили.
    if (button?.isConnected) button.focus();
  };

  /** Escape закрывает открытое, где бы ни стоял фокус — на кнопке или в панели. */
  useEffect(() => {
    if (editing === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const button = trigger.current;
      trigger.current = null;
      setEditing(null);
      if (button?.isConnected) button.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing]);

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    for (const folder of folders) {
      const list = map.get(folder.parentId) ?? [];
      list.push(folder);
      map.set(folder.parentId, list);
    }
    for (const list of map.values()) {
      // Порядок предсказуемый: заведённая папка встаёт на своё место по
      // алфавиту, а не в конец. «Студенты» — последними: это не рабочая папка,
      // а корень другого рода.
      list.sort((a, b) => {
        if (a.kind !== b.kind && (a.kind === "students" || b.kind === "students")) {
          return a.kind === "students" ? 1 : -1;
        }
        return a.name.localeCompare(b.name, "ru");
      });
    }
    return map;
  }, [folders]);

  const docsIn = useMemo(() => {
    const map = new Map<string | null, Doc[]>();
    for (const doc of docs) {
      const list = map.get(doc.folderId) ?? [];
      list.push(doc);
      map.set(doc.folderId, list);
    }
    return map;
  }, [docs]);

  /** Сколько файлов внутри вместе с вложенными папками — счётчик из референса. */
  const totals = useMemo(() => {
    const map = new Map<string | null, number>();
    const walk = (id: string | null): number => {
      let sum = (docsIn.get(id) ?? []).length;
      for (const child of childrenOf.get(id) ?? []) sum += walk(child.id);
      map.set(id, sum);
      return sum;
    };
    walk(null);
    return map;
  }, [childrenOf, docsIn]);

  const kindsIn = useMemo(() => {
    const map = new Map<string | null, string[]>();
    const walk = (id: string | null): string[] => {
      const found: string[] = [];
      for (const doc of docsIn.get(id) ?? []) {
        const kind = kindOf(doc.name);
        if (kind && !found.includes(kind)) found.push(kind);
      }
      for (const child of childrenOf.get(id) ?? []) {
        for (const kind of walk(child.id)) if (!found.includes(kind)) found.push(kind);
      }
      map.set(id, found);
      return found;
    };
    walk(null);
    return map;
  }, [childrenOf, docsIn]);

  const current = currentId ? byId.get(currentId) ?? null : null;
  const path = useMemo(() => {
    const chain: Folder[] = [];
    let cursor = current;
    while (cursor) {
      chain.unshift(cursor);
      cursor = cursor.parentId ? byId.get(cursor.parentId) ?? null : null;
    }
    return chain;
  }, [byId, current]);

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  // Один поиск на дерево и на файлы: искать отдельно в папках и отдельно в
  // файлах значит заставлять человека помнить, где он ищет. Ищем по всей базе —
  // иначе пришлось бы сначала угадать папку.
  const foundFolders = useMemo(
    () => (searching ? folders.filter((f) => f.name.toLowerCase().includes(needle)) : []),
    [folders, needle, searching],
  );
  const foundDocs = useMemo(
    () => (searching ? docs.filter((d) => d.name.toLowerCase().includes(needle)) : []),
    [docs, needle, searching],
  );

  const shownFolders = searching ? foundFolders : childrenOf.get(currentId) ?? [];
  const shownDocs = searching ? foundDocs : docsIn.get(currentId) ?? [];

  const treeRows = useMemo(() => {
    if (searching) return foundFolders.map((folder) => ({ folder, depth: 0 }));
    // Внутри корня студентов — по папке на человека, и их столько, сколько
    // студентов. Развёрнутый всегда, он закрыл бы собой дерево компании,
    // поэтому раскрывается, только когда в него вошли.
    const open = new Set(path.map((folder) => folder.id));
    const rows: { folder: Folder; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of childrenOf.get(parentId) ?? []) {
        rows.push({ folder, depth });
        if (folder.kind === "students" && !open.has(folder.id)) continue;
        walk(folder.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  }, [childrenOf, foundFolders, path, searching]);

  /** Кто внутри — считается от самой папки, а не от заранее известного имени. */
  const peopleOf = (folder: Folder) =>
    folder.kind === "students"
      ? (childrenOf.get(folder.id) ?? []).slice(0, 3).map((child) => ({ id: child.id, name: child.name }))
      : [];

  /* ------------------------------------------------------------- Действия */

  const go = (id: string | null) => {
    setCurrentId(id);
    setQuery("");
    setSelected([]);
    trigger.current = null;
    setEditing(null);
  };

  const canCreateFolder = current === null || current.kind === "company";
  const canAddFiles = current === null || current.kind === "company" || current.kind === "student";

  const createFolder = (name: string) => {
    setFolders((prev) => [...prev, { id: nextId(), name, parentId: currentId, kind: "company" }]);
    closePanel();
  };

  const createFile = (name: string) => {
    const id = nextId();
    // Файл заводится пустым — и скачивается пустым. Придумывать ему содержимое
    // было бы враньём, а отнимать скачивание у одного файла из списка — путать.
    contents.current.set(id, new Blob([], { type: "text/plain" }));
    setDocs((prev) => [
      ...prev,
      { id, folderId: currentId, name, addedBy: null, addedAt: today, size: humanSize(0), hasContent: true },
    ]);
    closePanel();
  };

  const upload = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const added: Doc[] = [];
    for (const file of Array.from(list)) {
      const id = nextId();
      contents.current.set(id, file);
      added.push({
        id,
        folderId: currentId,
        name: file.name,
        addedBy: null,
        addedAt: today,
        size: humanSize(file.size),
        hasContent: true,
      });
    }
    setDocs((prev) => [...prev, ...added]);
  };

  /**
   * Скачать один файл. `delay` — для пачки: несколько click() подряд в одном
   * жесте браузер считает попыткой закидать человека файлами и оставляет
   * первый. Между ними нужна пауза.
   */
  const download = (doc: Doc, delay = 0) => {
    const blob = contents.current.get(doc.id);
    if (!blob) return;
    window.setTimeout(() => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Объектный URL держит файл в памяти вкладки, пока его не отпустят.
      // В том же тике его отпускать нельзя: браузер ещё не начал читать.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, delay);
  };

  const rename = (what: "folder" | "file", id: string, name: string) => {
    if (what === "folder") setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    else setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
    closePanel();
  };

  const subtreeOf = (id: string): Set<string> => {
    const ids = new Set<string>([id]);
    const walk = (parentId: string) => {
      for (const child of childrenOf.get(parentId) ?? []) {
        ids.add(child.id);
        walk(child.id);
      }
    };
    walk(id);
    return ids;
  };

  const move = (what: "folder" | "file", id: string, to: string | null) => {
    if (what === "folder") setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, parentId: to } : f)));
    else setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, folderId: to } : d)));
    closePanel();
  };

  const removeFolder = (id: string) => {
    const ids = subtreeOf(id);
    const gone = new Set(
      docs.filter((doc) => doc.folderId !== null && ids.has(doc.folderId)).map((doc) => doc.id),
    );
    for (const docId of gone) contents.current.delete(docId);
    setDocs((prev) => prev.filter((doc) => !gone.has(doc.id)));
    setFolders((prev) => prev.filter((folder) => !ids.has(folder.id)));
    // Выбор не переживает выбранное: иначе панель предложит удалить то, чего
    // уже нет, и посчитает это в «выбрано».
    setSelected((prev) => prev.filter((docId) => !gone.has(docId)));
    if (currentId && ids.has(currentId)) setCurrentId(byId.get(id)?.parentId ?? null);
    // Кнопки, с которой открыли, больше нет — возвращать фокус некуда.
    trigger.current = null;
    setEditing(null);
  };

  const removeDocs = (ids: readonly string[]) => {
    const set = new Set(ids);
    for (const id of ids) contents.current.delete(id);
    setDocs((prev) => prev.filter((doc) => !set.has(doc.id)));
    setSelected((prev) => prev.filter((id) => !set.has(id)));
    trigger.current = null;
    setEditing(null);
  };

  /* --------------------------------------------------------- Куда перенести */

  /**
   * `from` — откуда переезжают: эта папка и корень, если файл уже в нём, из
   * списка убираются. `undefined` — источник не один (пачка лежит по разным
   * папкам), и тогда убирать нечего: корень остаётся доступным.
   */
  const destinations = (exclude: Set<string>, from: string | null | undefined) => {
    const rows: { id: string | null; name: string; depth: number }[] = [];
    if (from !== null) rows.push({ id: null, name: ROOT_NAME, depth: 0 });
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of childrenOf.get(parentId) ?? []) {
        if (folder.kind !== "company" || exclude.has(folder.id)) continue;
        if (folder.id !== from) rows.push({ id: folder.id, name: folder.name, depth });
        walk(folder.id, depth + 1);
      }
    };
    walk(null, 1);
    return rows;
  };

  /* -------------------------------------------------------------- Панели */

  const targetOfFolder = (folder: Folder): Target => {
    const count = totals.get(folder.id) ?? 0;
    const nested = (childrenOf.get(folder.id) ?? []).length;
    const parts: string[] = [];
    if (count > 0) parts.push(`${count} ${plural(count, "файл", "файла", "файлов")}`);
    if (nested > 0) parts.push(`${nested} ${plural(nested, "папка", "папки", "папок")}`);
    return {
      what: "folder",
      id: folder.id,
      name: folder.name,
      canEdit: folder.kind === "company",
      canMove: folder.kind === "company",
      canDownload: false,
      inside: parts.length > 0 ? parts.join(", ") : null,
      confirm: parts.length > 0,
    };
  };

  const targetOfDoc = (doc: Doc): Target => {
    const parent = doc.folderId ? byId.get(doc.folderId) ?? null : null;
    return {
      what: "file",
      id: doc.id,
      name: doc.name,
      canEdit: true,
      // Документ студента принадлежит студенту: перенести его в папку компании
      // значило бы тихо отобрать чей-то паспорт у его дела.
      canMove: parent?.kind !== "student",
      canDownload: doc.hasContent,
      inside: null,
      // У файла всегда есть что терять: спрашиваем всегда.
      confirm: true,
    };
  };

  function panelFor(target: Target) {
    if (!editing || editing.kind === "bulk-move" || editing.kind === "bulk-delete" || editing.kind === "create") return null;
    if (editing.what !== target.what || editing.id !== target.id) return null;

    const wrap = (children: React.ReactNode) => (
      <div className="relative z-10 border-t border-border pt-2">{children}</div>
    );

    if (editing.kind === "rename") {
      return wrap(
        <NameForm
          label="Новое название"
          initial={target.name}
          submit="Сохранить"
          onSubmit={(value) => rename(target.what, target.id, value)}
          onCancel={closePanel}
        />,
      );
    }

    if (editing.kind === "move") {
      const doc = target.what === "file" ? docs.find((d) => d.id === target.id) ?? null : null;
      const from = target.what === "file" ? doc?.folderId ?? null : byId.get(target.id)?.parentId ?? null;
      const exclude = target.what === "folder" ? subtreeOf(target.id) : new Set<string>();
      return wrap(
        <MoveList
          rows={destinations(exclude, from)}
          onPick={(to) => move(target.what, target.id, to)}
          onCancel={closePanel}
        />,
      );
    }

    if (editing.kind === "delete") {
      return wrap(
        <Confirm
          question={`Удалить «${target.name}»?${target.inside ? ` Внутри ${target.inside}.` : ""}`}
          onConfirm={() => (target.what === "folder" ? removeFolder(target.id) : removeDocs([target.id]))}
          onCancel={closePanel}
        />,
      );
    }

    return wrap(
      <ul className="flex flex-col">
        {target.canDownload ? (
          <li>
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                const doc = docs.find((d) => d.id === target.id);
                if (doc) download(doc);
                setEditing(null);
              }}
            >
              Скачать
            </button>
          </li>
        ) : null}
        {target.canEdit ? (
          <li>
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => setEditing({ kind: "rename", what: target.what, id: target.id })}
            >
              Переименовать
            </button>
          </li>
        ) : null}
        {target.canMove ? (
          <li>
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => setEditing({ kind: "move", what: target.what, id: target.id })}
            >
              Переместить
            </button>
          </li>
        ) : null}
        {target.canEdit ? (
          <li>
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                // Пустое уходит сразу: спрашивать про то, чего не жаль, — шум.
                if (target.confirm) setEditing({ kind: "delete", what: target.what, id: target.id });
                else if (target.what === "folder") removeFolder(target.id);
                else removeDocs([target.id]);
              }}
            >
              Удалить
            </button>
          </li>
        ) : null}
      </ul>,
    );
  }

  const menuButton = (target: Target) => {
    if (!target.canEdit && !target.canMove && !target.canDownload) return null;
    const open =
      editing !== null &&
      editing.kind !== "create" &&
      editing.kind !== "bulk-move" &&
      editing.kind !== "bulk-delete" &&
      editing.what === target.what &&
      editing.id === target.id;
    return (
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) =>
          open ? closePanel() : openPanel({ kind: "menu", what: target.what, id: target.id }, event)
        }
        className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-nav text-fg-3 hover:bg-surface-2 hover:text-fg-2"
      >
        <span className="sr-only">Действия с «{target.name}»</span>
        <Icon name={open ? "x" : "menu"} size={15} />
      </button>
    );
  };

  /* -------------------------------------------------------------- Выбор */

  const allShownSelected = shownDocs.length > 0 && shownDocs.every((d) => selected.includes(d.id));
  const selectedDocs = docs.filter((d) => selected.includes(d.id));
  const selectedMovable =
    selectedDocs.length > 0 &&
    selectedDocs.every((doc) => {
      const parent = doc.folderId ? byId.get(doc.folderId) ?? null : null;
      return parent?.kind !== "student";
    });
  const selectedDownloadable = selectedDocs.filter((doc) => doc.hasContent);

  const columns = searching ? 7 : 6;

  // Одна колонка на телефоне задана явно: неявная колонка сетки шириной `auto`
  // растянулась бы под таблицу с `min-w-[600px]`, и страница поехала бы вбок
  // вместо того, чтобы таблица прокручивалась внутри себя.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 @4xl:grid-cols-[minmax(0,272px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <label className="flex h-11 items-center gap-2 rounded-ctl border border-control-edge bg-surface px-3">
          <Icon name="search" size={15} className="shrink-0 text-fg-3" />
          <span className="sr-only">Поиск по базе знаний</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // Показанное меняется целиком — выбранное вместе с ним.
              setSelected([]);
              trigger.current = null;
              setEditing(null);
            }}
            placeholder="Поиск…"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
          />
        </label>

        {/* Своя прокрутка — только когда дерево стоит колонкой рядом с содержимым.
            На телефоне оно идёт над содержимым, и прокрутка внутри прокрутки
            там мешала бы: страница листается, а список — нет. */}
        <nav
          aria-label="Папки"
          tabIndex={0}
          className="@4xl:max-h-[60vh] @4xl:overflow-y-auto"
        >
          <ul className="flex flex-col">
            <li>
              <button
                type="button"
                aria-current={currentId === null && !searching ? "true" : undefined}
                onClick={() => go(null)}
                className={`flex min-h-11 w-full items-center gap-2 rounded-nav px-2.5 text-start text-sm ${
                  currentId === null && !searching ? "bg-surface-2 font-semibold text-fg" : "text-fg-2 hover:bg-surface-2"
                }`}
              >
                <Icon name="grid" size={15} className="shrink-0 text-fg-3" />
                <span className="min-w-0 flex-1 truncate">{ROOT_NAME}</span>
                <span className="shrink-0 font-mono text-2xs text-fg-3">{totals.get(null) ?? 0}</span>
              </button>
            </li>

            {treeRows.map(({ folder, depth }) => {
              const active = folder.id === currentId;
              return (
                <li key={folder.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => go(folder.id)}
                    style={{ paddingInlineStart: `${0.55 + depth * 0.9}rem` }}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-nav pe-2.5 text-start text-sm ${
                      active ? "bg-surface-2 font-semibold text-fg" : "text-fg-2 hover:bg-surface-2"
                    }`}
                  >
                    {folder.kind === "student" ? (
                      <Initials name={folder.name} />
                    ) : (
                      <Icon
                        name={folder.kind === "students" ? "users" : "folder"}
                        size={15}
                        className={`shrink-0 ${active ? "text-fg" : "text-fg-3"}`}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <span className="shrink-0 font-mono text-2xs text-fg-3">{totals.get(folder.id) ?? 0}</span>
                  </button>
                </li>
              );
            })}

            {treeRows.length === 0 && searching ? (
              <li className="px-2.5 py-3 text-sm text-fg-3">Папок не найдено</li>
            ) : null}
          </ul>
        </nav>
      </aside>

      <section className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {searching ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSelected([]);
                trigger.current = null;
                setEditing(null);
              }}
              className="flex min-h-11 items-center gap-2 rounded-ctl border border-control-edge px-3 text-sm text-fg hover:bg-surface-2"
            >
              <span className="min-w-0 truncate font-semibold">{query}</span>
              <Icon name="x" size={15} className="shrink-0 text-fg-3" />
              <span className="sr-only">Очистить поиск</span>
            </button>
          ) : (
            <nav aria-label="Путь" className="min-w-0">
              <ol className="flex flex-wrap items-center gap-0.5">
                <li>
                  <button
                    type="button"
                    onClick={() => go(null)}
                    aria-current={path.length === 0 ? "location" : undefined}
                    className={`min-h-11 rounded-nav px-1.5 text-md ${
                      path.length === 0 ? "font-bold text-fg" : "font-medium text-fg-3 hover:bg-surface-2"
                    }`}
                  >
                    {ROOT_NAME}
                  </button>
                </li>
                {path.map((folder, index) => (
                  <li key={folder.id} className="flex items-center gap-0.5">
                    <Icon name="chevron-right" size={14} className="shrink-0 text-fg-3" />
                    <button
                      type="button"
                      onClick={() => go(folder.id)}
                      aria-current={index === path.length - 1 ? "location" : undefined}
                      className={`min-h-11 max-w-[16rem] truncate rounded-nav px-1.5 text-md ${
                        index === path.length - 1 ? "font-bold text-fg" : "font-medium text-fg-3 hover:bg-surface-2"
                      }`}
                    >
                      {folder.name}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          {!searching && (canCreateFolder || canAddFiles) ? (
            <div className="flex flex-wrap items-center gap-2">
              {canCreateFolder ? (
                <button
                  type="button"
                  onClick={(event) => openPanel({ kind: "create", what: "folder" }, event)}
                  className={SECONDARY}
                >
                  Новая папка
                </button>
              ) : null}
              {canAddFiles ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => openPanel({ kind: "create", what: "file" }, event)}
                    className={SECONDARY}
                  >
                    Новый файл
                  </button>
                  <div className="relative">
                    <input
                      id={uploadId}
                      type="file"
                      multiple
                      className="peer sr-only"
                      onChange={(event) => {
                        upload(event.target.files);
                        // Иначе тот же файл второй раз не выберется: значение
                        // не меняется, и change не приходит.
                        event.target.value = "";
                      }}
                    />
                    <label
                      htmlFor={uploadId}
                      className={`${PRIMARY} inline-flex cursor-pointer items-center gap-1.5 py-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent`}
                    >
                      <Icon name="upload" size={15} />
                      Загрузить
                    </label>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {editing?.kind === "create" ? (
          <div className="rounded-card border border-border bg-surface p-3">
            <NameForm
              label={editing.what === "folder" ? "Название папки" : "Имя файла"}
              initial=""
              placeholder={editing.what === "folder" ? "Название папки" : "имя-файла.md"}
              submit="Создать"
              onSubmit={editing.what === "folder" ? createFolder : createFile}
              onCancel={closePanel}
            />
          </div>
        ) : null}

        {shownFolders.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-fg-2">Папки</h3>
            <ul className="mt-2.5 grid gap-3 @lg:grid-cols-2 @6xl:grid-cols-3">
              {shownFolders.map((folder) => {
                const target = targetOfFolder(folder);
                return (
                  <li key={folder.id}>
                    <FolderTile
                      folder={folder}
                      count={totals.get(folder.id) ?? 0}
                      kinds={(kindsIn.get(folder.id) ?? []).slice(0, 3)}
                      people={peopleOf(folder)}
                      onOpen={() => go(folder.id)}
                      menu={menuButton(target)}
                      panel={panelFor(target)}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id={filesHeadingId} className="text-sm font-semibold text-fg-2">
              Файлы
            </h3>
          </div>

          {selected.length > 0 ? (
            <div className="mt-2.5 flex flex-col gap-2 rounded-card border border-border bg-surface p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-2xs text-fg-3">
                  выбрано {selected.length}
                </span>
                {selectedDownloadable.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      selectedDownloadable.forEach((doc, index) => download(doc, index * 300));
                    }}
                    className={SECONDARY}
                  >
                    Скачать
                  </button>
                ) : null}
                {selectedMovable ? (
                  <button
                    type="button"
                    onClick={(event) => openPanel({ kind: "bulk-move" }, event)}
                    className={SECONDARY}
                  >
                    Переместить
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={(event) => openPanel({ kind: "bulk-delete" }, event)}
                  className={SECONDARY}
                >
                  Удалить
                </button>
              </div>

              {editing?.kind === "bulk-move" ? (
                <div className="border-t border-border pt-2">
                  <MoveList
                    rows={destinations(new Set<string>(), undefined)}
                    onPick={(to) => {
                      const set = new Set(selected);
                      setDocs((prev) => prev.map((doc) => (set.has(doc.id) ? { ...doc, folderId: to } : doc)));
                      setSelected([]);
                      closePanel();
                    }}
                    onCancel={closePanel}
                  />
                </div>
              ) : null}

              {editing?.kind === "bulk-delete" ? (
                <div className="border-t border-border pt-2">
                  <Confirm
                    question={`Удалить ${selected.length} ${plural(selected.length, "файл", "файла", "файлов")}?`}
                    onConfirm={() => removeDocs(selected)}
                    onCancel={closePanel}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div
            role="region"
            aria-labelledby={filesHeadingId}
            tabIndex={0}
            className="mt-2.5 max-w-full overflow-x-auto rounded-card border border-border"
          >
            <table className="w-full min-w-[600px] border-collapse bg-surface text-sm">
              <caption className="sr-only">
                Файлы {searching ? "по запросу" : "в папке"} {searching ? query : path.at(-1)?.name ?? ROOT_NAME}
              </caption>
              <thead>
                <tr className="border-b border-border">
                  {/* Отступы ячейки лежат на метке: вид тот же, нажать можно
                      по всей ячейке, а не по шестнадцати точкам галочки. */}
                  <th scope="col" className="w-10 p-0">
                    <label className="flex cursor-pointer items-center justify-center px-3 py-2.5">
                      <span className="sr-only">Выбрать все показанные файлы</span>
                      <input
                        type="checkbox"
                        checked={allShownSelected}
                        onChange={(event) => setSelected(event.target.checked ? shownDocs.map((d) => d.id) : [])}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </label>
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start text-2xs font-semibold uppercase tracking-wide text-fg-3">
                    Название
                  </th>
                  {searching ? (
                    <th scope="col" className="px-3 py-2.5 text-start text-2xs font-semibold uppercase tracking-wide text-fg-3">
                      Папка
                    </th>
                  ) : null}
                  <th scope="col" className="px-3 py-2.5 text-start text-2xs font-semibold uppercase tracking-wide text-fg-3">
                    Добавил
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start text-2xs font-semibold uppercase tracking-wide text-fg-3">
                    Размер
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start text-2xs font-semibold uppercase tracking-wide text-fg-3">
                    Добавлен
                  </th>
                  <th scope="col" className="w-12 px-3 py-2.5">
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownDocs.map((doc) => {
                  const target = targetOfDoc(doc);
                  const panel = panelFor(target);
                  const parent = doc.folderId ? byId.get(doc.folderId) ?? null : null;
                  return (
                    <Fragment key={doc.id}>
                      <tr className={`border-b border-border ${panel ? "" : "last:border-0"} hover:bg-surface-2`}>
                        <td className="p-0">
                          <label className="flex cursor-pointer items-center justify-center px-3 py-2.5">
                            <span className="sr-only">Выбрать {doc.name}</span>
                            <input
                              type="checkbox"
                              checked={selected.includes(doc.id)}
                              onChange={(event) =>
                                setSelected((current2) =>
                                  event.target.checked
                                    ? [...current2, doc.id]
                                    : current2.filter((id) => id !== doc.id),
                                )
                              }
                              className="h-4 w-4 accent-[var(--accent)]"
                            />
                          </label>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            <KindBadge kind={kindOf(doc.name)} />
                            {/* truncate без предела ширины не работает: ячейка
                                растянулась бы под самое длинное имя. */}
                            <span className="block max-w-[18rem] truncate font-medium text-fg">{doc.name}</span>
                          </span>
                        </td>
                        {searching ? (
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => go(doc.folderId)}
                              className="min-h-11 max-w-[12rem] truncate rounded-nav px-1 text-start text-fg-2 hover:bg-surface-2"
                            >
                              {parent?.name ?? ROOT_NAME}
                            </button>
                          </td>
                        ) : null}
                        <td className="px-3 py-2.5">
                          {doc.addedBy ? (
                            <span className="flex items-center gap-2 text-fg-2">
                              <Initials name={doc.addedBy} />
                              <span className="truncate">{doc.addedBy}</span>
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-fg-3">{doc.size}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-fg-3">{doc.addedAt}</td>
                        <td className="px-3 py-2.5">
                          <span className="flex justify-end">{menuButton(target)}</span>
                        </td>
                      </tr>
                      {panel ? (
                        <tr className="border-b border-border last:border-0">
                          <td colSpan={columns} className="px-3 pb-3">
                            {panel}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {shownDocs.length === 0 ? (
                  <tr>
                    <td colSpan={columns} className="px-3 py-6 text-center text-sm text-fg-3">
                      {searching ? `По запросу «${query}» ничего не найдено` : "Папка пуста"}
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
