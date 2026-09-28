"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";
import { btnCls, SkeletonBlock } from "@/components/ui";
import { TopLayerMenu } from "@/components/v3/board/TopLayerMenu";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { KNOWLEDGE_AREAS, KNOWLEDGE_AREA_NAMES, type KnowledgeArea, type KnowledgeItem, type KnowledgePage, type KnowledgeQuery } from "@/lib/knowledge-library-contract";
import { RowSelect } from "../queue/Bulk";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { QueueEmpty } from "../queue/QueueStates";
import { command, configureKnowledgeCommands, knowledgeFetch, knowledgeSourceKey, uploadKnowledgeFile } from "./client";
import { KnowledgeImport } from "./KnowledgeImport";
import { KnowledgeSecret } from "./KnowledgeSecret";
import { KnowledgeDossiers } from "./KnowledgeDossiers";
import { KnowledgeCanonicalSearch } from "./KnowledgeCanonicalSearch";
import { KnowledgeAssignCase } from "./KnowledgeAssignCase";
import { KnowledgeExport } from "./KnowledgeExport";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { KnowledgeRowsSkeleton } from "./KnowledgeSkeleton";
import { KnowledgeTree, type KnowledgeView as View } from "./KnowledgeTree";
import { KB_DIALOG, KB_DIALOG_BODY, KB_DIALOG_HEAD, KB_ERROR, KB_FIELD, KB_LABEL, KB_MENU, KB_MENU_ITEM, KB_QUIET, knowledgeDay } from "./knowledge-look";

const kindNames = { folder: "Папка", page: "Страница", file: "Файл", secret: "Доступ" };
const kindIcons = { folder: "folder", page: "file-text", file: "file-check", secret: "lock" } as const;
const viewNames: Record<Exclude<View, "list">, string> = { inbox: "Входящие", review: "На уточнении", archive: "Архив", trash: "Корзина" };
const CHOICE = "v3-choice inline-flex min-h-11 items-center rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

/**
 * «База знаний» (Э8.10, только интерфейс). Лист на тёплом столе: слева дерево
 * (на телефоне — в листе «Папки»), справа путь, одна строка инструментов
 * (поиск · «Создать ▾» · «⋯») и таблица. Адрес (`area`, `folder`, `item`,
 * `view`, `section`, `case`), команды (`expectedVersion`, `requestId`) и
 * проверки доступа — прежние.
 */
export function KnowledgeLibrary({ commandScope, section = null, children }: { commandScope: string; section?: "documents" | "snippets" | null; children?: ReactNode }) {
  useLayoutEffect(() => { configureKnowledgeCommands(commandScope); }, [commandScope]);
  const router = useRouter(); const params = useSearchParams();
  const area = (KNOWLEDGE_AREAS.includes(params.get("area") as KnowledgeArea) ? params.get("area") : "internal") as KnowledgeArea;
  const parentId = section ? null : params.get("folder"); const itemId = section ? null : params.get("item");
  const view: View = ["trash", "review", "archive", "inbox"].includes(params.get("view") ?? "") ? params.get("view") as View : "list";
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [folders, setFolders] = useState<KnowledgeItem[]>([]);
  const [folderRevision, setFolderRevision] = useState<number | null>(null);
  const [page, setPage] = useState<KnowledgePage | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(""); const [searchScope, setSearchScope] = useState<"all" | "folder">("all");
  const [refresh, setRefresh] = useState(0); const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [status, setStatus] = useState("");
  const [newSecret, setNewSecret] = useState(false);
  const [assignCase, setAssignCase] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState<"scope" | "all" | null>(null);
  const [importOpen, setImportOpen] = useState(false); const [importRunning, setImportRunning] = useState(false);
  const [dialog, setDialog] = useState<"folder" | "page" | "rename" | "move" | null>(null);
  const [name, setName] = useState(""); const [targetFolder, setTargetFolder] = useState("");
  const fileRef = useRef<HTMLInputElement>(null); const directoryRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null); const sheetRef = useRef<HTMLDialogElement>(null);
  const moreId = useId(); const dialogTitleId = useId(); const sheetTitleId = useId();
  // Поиск «в текущей папке» есть только внутри папки; в корне раздела и в видах ищем по всей базе.
  const scope = parentId ? searchScope : "all";
  const href = useCallback((next: { area?: KnowledgeArea; folder?: string | null; view?: View; item?: string | null }) => {
    const query = new URLSearchParams(); query.set("area", next.area ?? area);
    const folder = next.folder === undefined ? parentId : next.folder;
    if (folder) query.set("folder", folder);
    if (next.view && next.view !== "list") query.set("view", next.view);
    if (next.item) query.set("item", next.item);
    return `/v3/knowledge?${query}`;
  }, [area, parentId]);
  const query = useCallback(() => {
    const value: KnowledgeQuery & { scopeParentId?: string } = { mode: search.trim() ? "search" : view, area, parentId, limit: 100 };
    if (search.trim()) {
      value.search = search.trim();
      if (scope === "all") delete value.area;
      else if (parentId) value.scopeParentId = parentId;
    }
    return Object.fromEntries(Object.entries(value).filter(([, val]) => val !== null && val !== undefined).map(([key, val]) => [key, String(val)]));
  }, [area, parentId, search, scope, view]);
  const listKey = JSON.stringify(query());
  useEffect(() => {
    if (section) return;
    const abort = new AbortController();
    const current = query(); const key = JSON.stringify(current);
    const timer = setTimeout(() => {
      setLoading(true); setError(""); setSelected(new Set());
      void knowledgeFetch<KnowledgePage>(`list?${new URLSearchParams(current)}`, { signal: abort.signal }).then((result) => {
        setItems(result.items); setPage(result); setLoadedKey(key); setLoadedAt(new Date());
      }).catch((cause) => { if (!abort.signal.aborted) setError(cause.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, search ? 250 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, refresh, search, section]);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      const result: KnowledgeItem[] = []; let cursor: KnowledgePage["nextCursor"] = null;
      do {
        const query = new URLSearchParams({ mode: "folders", limit: "200" });
        if (cursor) { query.set("afterTitle", cursor.title); query.set("afterId", cursor.id); }
        const next = await knowledgeFetch<KnowledgePage>(`list?${query}`);
        result.push(...next.items);
        if (next.hasMore && (!next.nextCursor || next.nextCursor.id === cursor?.id)) throw new Error("Не удалось загрузить все папки.");
        cursor = next.nextCursor;
      } while (cursor && !stopped);
      if (!stopped) { setFolders(result); setFolderRevision(refresh); }
    })().catch((cause) => { if (!stopped) setError(cause.message); });
    return () => { stopped = true; };
  }, [refresh]);
  useEffect(() => {
    if (!itemId) return;
    const abort = new AbortController();
    void knowledgeFetch<KnowledgeItem>(`item/${itemId}`, { signal: abort.signal }).then(setSelectedItem)
      .catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, [itemId]);
  useEffect(() => { if (dialog) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [dialog]);
  useEffect(() => { if (treeOpen) sheetRef.current?.showModal(); else sheetRef.current?.close(); }, [treeOpen]);
  const shown = loadedKey === listKey;
  const rows = shown ? items : [];
  const chosen = rows.filter((item) => selected.has(item.id));
  const parent = folders.find((folder) => folder.id === parentId);
  const breadcrumb: KnowledgeItem[] = [];
  for (let current = parent; current && !breadcrumb.some((item) => item.id === current?.id); current = folders.find((folder) => folder.id === current?.parent_id)) breadcrumb.unshift(current);
  function reload() { setRefresh((value) => value + 1); }
  /** Окно, открытое из «⋯», закрылось: фокус — обратно на «⋯» (пункт меню уже скрыт). */
  function returnFocus() { requestAnimationFrame(() => document.getElementById(moreId)?.focus()); }
  async function more() {
    if (!page?.nextCursor) return;
    setLoading(true);
    try {
      const result = await knowledgeFetch<KnowledgePage>(`list?${new URLSearchParams({ ...query(), afterTitle: page.nextCursor.title, afterId: page.nextCursor.id })}`);
      setItems((old) => [...old, ...result.items.filter((item) => !old.some((prior) => prior.id === item.id))]); setPage(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить материалы."); }
    finally { setLoading(false); }
  }
  async function mutate(op: "trash" | "restore" | "archive" | "unarchive") {
    setBusy(true); setError("");
    try {
      for (const item of chosen) await command({ op, id: item.id, expectedVersion: item.version });
      setStatus(op === "trash" ? "Перемещено в корзину" : op === "restore" ? "Восстановлено" : op === "archive" ? "Архивировано" : "Возвращено из архива"); reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Действие не выполнено."); reload(); }
    finally { setBusy(false); }
  }
  async function submitDialog(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (dialog === "folder" || dialog === "page") {
        const item = await command({ op: "create", area, parentId, kind: dialog, title: name.trim(), caseId: parent?.client_case_id ?? null });
        if (dialog === "page") router.push(href({ item: item.id }));
      } else if (dialog === "rename" && chosen[0]) await command({ op: "edit", id: chosen[0].id, expectedVersion: chosen[0].version, title: name.trim() });
      else if (dialog === "move") for (const item of chosen) await command({ op: "move", id: item.id, expectedVersion: item.version, parentId: targetFolder || null });
      setDialog(null); setName(""); reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Действие не выполнено."); }
    finally { setBusy(false); }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError("");
    const folderCache = new Map<string, string>();
    try {
      for (const file of Array.from(files)) {
        let destination = parentId;
        const parts = (file.webkitRelativePath || file.name).split("/").slice(0, -1);
        let relative = "";
        for (const part of parts) {
          relative += `/${part}`;
          if (!folderCache.has(relative)) {
            const existing = folders.find((item) => item.area === area && item.parent_id === destination && item.title === part);
            const created: KnowledgeItem = existing ?? await command<KnowledgeItem>({ op: "create", kind: "folder", area, parentId: destination, title: part, sourceKey: knowledgeSourceKey(["folder", area, destination, part]), caseId: parent?.client_case_id ?? null });
            folderCache.set(relative, created.id);
          }
          destination = folderCache.get(relative)!;
        }
        await uploadKnowledgeFile(file, area, destination, (done, total) => setStatus(`${file.name} · ${total ? Math.round(done / total * 100) : 100}%`), parent?.client_case_id ?? null);
      }
      setStatus("Файлы загружены"); reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Загрузка не завершена. Выберите файлы повторно, чтобы продолжить."); reload(); }
    finally { setBusy(false); }
  }
  function openDialog(kind: "folder" | "page") { setName(""); setDialog(kind); }
  const onSaved = useCallback((saved: KnowledgeItem) => {
    setSelectedItem(saved);
    setItems((old) => old.map((item) => item.id === saved.id ? saved : item));
    setRefresh((value) => value + 1);
  }, []);
  const toggleRow = (id: string) => setSelected((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const tree = (onNavigate?: () => void) => <KnowledgeTree folders={folderRevision === null ? null : folders} area={area} parentId={parentId} view={view} section={section} href={href} onNavigate={onNavigate} />;
  const foldersButton = <button type="button" aria-haspopup="dialog" onClick={() => setTreeOpen(true)} className={`${QUEUE_SECONDARY} shrink-0 @3xl/kb:hidden`} data-testid="knowledge-tree-open">
    <Icon name="folder" size={18} />Папки
  </button>;
  const crumbs: { key: string; label: string; href: string | null }[] = [
    { key: "area", label: KNOWLEDGE_AREA_NAMES[area], href: parentId || view !== "list" ? href({ folder: null }) : null },
    ...breadcrumb.map((item, index) => ({ key: item.id, label: item.title, href: index < breadcrumb.length - 1 ? href({ folder: item.id }) : null })),
    ...(view !== "list" ? [{ key: "view", label: viewNames[view], href: null }] : []),
  ];

  const secretOpen = Boolean(itemId && selectedItem?.id === itemId && selectedItem.kind === "secret");
  const itemOpen = Boolean(itemId && selectedItem?.id === itemId);
  let main: ReactNode;
  if (newSecret || secretOpen) main = <KnowledgeSecret item={newSecret ? undefined : selectedItem!} parentId={parentId} onClose={() => { setNewSecret(false); router.push(href({ area: "secrets", folder: selectedItem?.parent_id ?? parentId, item: null })); }} onSaved={onSaved} />;
  else if (itemOpen) main = <KnowledgeEditor key={itemId} item={selectedItem!} onClose={() => router.push(href({ area: selectedItem!.area, folder: selectedItem!.parent_id, item: null }))} onSaved={onSaved} />;
  else if (itemId && !error) main = <div aria-busy="true" className="space-y-4 p-4 @3xl/kb:p-5" data-testid="knowledge-item-loading">
    <p role="status" className="sr-only">Открываем материал…</p>
    <SkeletonBlock className="h-11 w-32 rounded-ctl" />
    <div className="mx-auto max-w-[51.25rem] space-y-3"><SkeletonBlock className="h-6 w-2/3 rounded-nav" /><SkeletonBlock className="h-4 w-full rounded-nav" /><SkeletonBlock className="h-4 w-5/6 rounded-nav" /></div>
  </div>;
  else main = <div className="grid @3xl/kb:grid-cols-[16rem_minmax(0,1fr)] @5xl/kb:grid-cols-[18rem_minmax(0,1fr)]">
    <aside aria-label="Папки базы знаний" className="hidden min-w-0 border-e border-border p-2 @3xl/kb:block">{tree()}</aside>
    <section aria-label="Материалы" className="@container/kbl min-w-0 p-4 @3xl/kb:p-5">
      {section ? <>
        <div className="flex items-center gap-2 pb-3">
          {foldersButton}
          {section === "documents" && <h2 className="t-section">Документы</h2>}
        </div>
        {children}
      </> : <>
        <nav aria-label="Путь" className="min-w-0">
          <ol className="flex flex-wrap items-center gap-x-1 t-body-compact text-fg-2" data-testid="knowledge-path">
            {/* Узко (дерево в листе «Папки») путь короткий: «… / родитель / папка»; полный — в дереве. */}
            {crumbs.length > 2 ? <li aria-hidden="true" className="flex min-h-11 items-center text-fg-3 @3xl/kb:hidden">…</li> : null}
            {crumbs.map((crumb, index) => <li key={crumb.key} className={`min-w-0 items-center gap-1 ${index < crumbs.length - 2 ? "hidden @3xl/kb:flex" : "flex"}`}>
              {index > 0 ? <span aria-hidden="true" className="text-fg-3">/</span> : null}
              {crumb.href
                ? <Link href={crumb.href} className="inline-flex min-h-11 min-w-11 items-center underline-offset-4 hover:text-fg hover:underline [overflow-wrap:anywhere]">{crumb.label}</Link>
                : <span aria-current="page" className="inline-flex min-h-11 min-w-0 items-center t-item text-fg [overflow-wrap:anywhere]">{crumb.label}</span>}
            </li>)}
          </ol>
        </nav>
        <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="knowledge-toolbar">
          <div className="relative min-w-0 flex-1 basis-full @md/kbl:basis-40">
            <Icon name="search" size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-3" />
            <input type="search" maxLength={240} aria-label="Поиск по базе знаний" placeholder="Найти материал" value={search} onChange={(event) => setSearch(event.target.value)} className={`${KB_FIELD} ps-10`} />
          </div>
          {foldersButton}
          <TopLayerMenu label="Создать" trigger={<>Создать<Icon name="chevron-down" size={16} /></>} triggerClassName={`${btnCls} ms-auto @md/kbl:ms-0`} menuClassName={KB_MENU} testId="knowledge-create-menu">
            {(close) => <>
              <button type="button" className={KB_MENU_ITEM} onClick={() => { close(); openDialog("folder"); }}><Icon name="folder" size={18} />Папку</button>
              {area === "secrets"
                ? <button type="button" className={KB_MENU_ITEM} onClick={() => { close(); setNewSecret(true); }}><Icon name="lock" size={18} />Доступ</button>
                : <button type="button" className={KB_MENU_ITEM} onClick={() => { close(); openDialog("page"); }}><Icon name="file-text" size={18} />Страницу</button>}
            </>}
          </TopLayerMenu>
          <TopLayerMenu label="Ещё действия с базой знаний" trigger={<Icon name="more-horizontal" size={20} />} triggerClassName={`${QUEUE_SECONDARY} w-11 px-0`} triggerProps={{ id: moreId }} menuClassName={KB_MENU} testId="knowledge-more-menu">
            {(close) => <>
              {area !== "secrets" && <>
                <button type="button" className={KB_MENU_ITEM} disabled={busy} onClick={() => { close(); fileRef.current?.click(); }}><Icon name="upload" size={18} />Загрузить файлы</button>
                <button type="button" className={KB_MENU_ITEM} disabled={busy} onClick={() => { close(); directoryRef.current?.click(); }}><Icon name="upload" size={18} />Загрузить папку</button>
              </>}
              <button type="button" className={KB_MENU_ITEM} onClick={() => { close(); setExportOpen("scope"); }}><Icon name="download" size={18} />{parentId ? "Выгрузить папку" : "Выгрузить раздел"}</button>
              <button type="button" className={KB_MENU_ITEM} onClick={() => { close(); setExportOpen("all"); }}><Icon name="download" size={18} />Выгрузить всю базу</button>
              <div role="separator" className="my-1 h-px bg-border" />
              <button type="button" className={KB_MENU_ITEM} onClick={() => { close(); setImportOpen(true); }}><Icon name="refresh" size={18} />Перенос локальной базы{importRunning ? " · идёт" : ""}</button>
            </>}
          </TopLayerMenu>
        </div>
        {parentId ? <div role="group" aria-label="Где искать" className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={CHOICE} aria-pressed={searchScope === "all"} onClick={() => setSearchScope("all")}>Вся база</button>
          <button type="button" className={CHOICE} aria-pressed={searchScope === "folder"} onClick={() => setSearchScope("folder")}>Текущая папка</button>
        </div> : null}
        <div className="mt-3 space-y-3">
          {error && <div className={KB_ERROR} role="alert">{error}<button type="button" onClick={reload} className={QUEUE_SECONDARY}>Повторить</button></div>}
          {status && <p role="status" aria-live="polite" className="t-body-compact text-fg-2">{status}</p>}
          {search.trim() && scope === "all" && <KnowledgeCanonicalSearch key={search.trim()} search={search.trim()} onOpen={() => setSearch("")} />}
          {area === "clients" && !parentId && view === "list" && !(search.trim() && scope === "all") && <KnowledgeDossiers key={params.get("case") ?? "directory"} caseId={params.get("case")} search={search} />}
          {selected.size > 0 && <div className="flex flex-wrap items-center gap-2 border-y border-border py-2" data-testid="knowledge-selection">
            <span className="me-1 t-item text-fg">Выбрано: <span className="tabular-nums">{selected.size}</span></span>
            <KnowledgeExport ids={[...selected]} label="Выгрузить выбранное" />
            {view === "trash" ? <button type="button" className={QUEUE_SECONDARY} disabled={busy} onClick={() => void mutate("restore")}>Восстановить</button> : <>
              {selected.size === 1 && <button type="button" className={QUEUE_SECONDARY} onClick={() => { if (chosen[0]?.kind === "secret") { router.push(href({ area: "secrets", item: chosen[0].id })); return; } setName(chosen[0]?.title ?? ""); setDialog("rename"); }}>Переименовать</button>}
              <button type="button" className={QUEUE_SECONDARY} onClick={() => { setTargetFolder(""); setDialog("move"); }}>Переместить</button>
              {chosen.every((item) => item.area === "clients" && !item.client_case_id && !item.archived_at) && <button type="button" className={QUEUE_SECONDARY} disabled={busy || folderRevision !== refresh} onClick={() => setAssignCase(true)}>Привязать к делу</button>}
              <button type="button" className={QUEUE_SECONDARY} disabled={busy} onClick={() => void mutate(view === "archive" ? "unarchive" : "archive")}>{view === "archive" ? "Вернуть из архива" : "Архивировать"}</button>
              <button type="button" className={QUEUE_SECONDARY} disabled={busy} onClick={() => void mutate("trash")}>В корзину</button>
            </>}
            <button type="button" className={KB_QUIET} onClick={() => setSelected(new Set())}>Снять выбор</button>
          </div>}
        </div>
        <div aria-busy={loading} className="mt-2">
          <table className="w-full border-collapse t-body-compact" data-testid="knowledge-table">
            <caption className="sr-only">Материалы: {crumbs.map((crumb) => crumb.label).join(" / ")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="w-11 p-0">
                  {rows.length > 0
                    ? <label className="grid size-11 cursor-pointer place-items-center rounded-nav hover:bg-surface-2">
                      <input type="checkbox" aria-label="Выбрать показанные материалы" className="size-[18px] cursor-pointer accent-fg" checked={rows.every((item) => selected.has(item.id))} onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((item) => item.id)) : new Set())} />
                    </label>
                    : <span className="sr-only">Выбор</span>}
                </th>
                <th scope="col" className="py-2 pe-3 text-start t-caption text-fg-3">Название</th>
                <th scope="col" className="hidden py-2 pe-3 text-start t-caption text-fg-3 @xl/kbl:table-cell">Тип</th>
                <th scope="col" className="py-2 ps-3 text-end t-caption text-fg-3">Изменено</th>
              </tr>
            </thead>
            <tbody>
              {!shown && !error ? <KnowledgeRowsSkeleton /> : rows.map((item) => {
                const day = loadedAt ? knowledgeDay(item.updated_at, loadedAt) : null;
                const checked = selected.has(item.id);
                return <tr key={item.id} data-selected={checked ? "" : undefined} className={`border-b border-border ${checked ? "bg-surface-2" : "hover:bg-bg"}`}>
                  <td className="w-11 p-0 align-top"><RowSelect label={item.title} checked={checked} onToggle={() => toggleRow(item.id)} /></td>
                  <td className="py-0 pe-3 align-top">
                    <Link href={item.kind === "folder" ? href({ area: item.area, folder: item.id }) : href({ area: item.area, folder: item.parent_id, item: item.id })} className="flex min-h-11 items-start gap-2 py-3 font-medium text-fg hover:underline underline-offset-4">
                      <Icon name={kindIcons[item.kind]} size={18} className="mt-px shrink-0 text-fg-3" />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{item.title}</span>
                    </Link>
                    {item.review_question ? <span className="-mt-2 block pb-3 ps-[1.625rem]"><StatusChip label="На уточнении" tone="warn" /></span> : null}
                  </td>
                  <td className="hidden py-3 pe-3 align-top text-fg-2 @xl/kbl:table-cell">{kindNames[item.kind]}</td>
                  <td className="whitespace-nowrap py-3 ps-3 text-end align-top text-fg-2">{day ? <time dateTime={item.updated_at} className="font-mono tabular-nums">{day}</time> : null}</td>
                </tr>;
              })}
            </tbody>
          </table>
          {!shown && !error ? <p role="status" className="sr-only">Загружаем материалы…</p> : null}
          {shown && !loading && !error && !rows.length && <QueueEmpty
            title={search ? "В материалах библиотеки ничего не найдено" : view === "trash" ? "Корзина пуста" : "Материалов пока нет"}
            action={view === "list" && !search && area !== "secrets" ? <button type="button" className={QUEUE_SECONDARY} onClick={() => openDialog("page")}>Создать страницу</button> : null} />}
          {shown && page?.hasMore && <div className="pt-2"><button type="button" className={KB_QUIET} disabled={loading} onClick={() => void more()}>{loading ? "Загружаем…" : "Показать ещё"}</button></div>}
        </div>
      </>}
    </section>
  </div>;

  return <div className="@container/kb min-w-0 rounded-card border border-border bg-surface text-fg" data-testid="knowledge-library">
    {main}
    <input ref={fileRef} type="file" multiple hidden onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
    <input ref={directoryRef} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
    {/* Окна «⋯» живут в корне: открытый материал или раздел их не размонтирует — перенос идёт и при закрытом окне. */}
    <KnowledgeImport open={importOpen} onClose={() => { setImportOpen(false); returnFocus(); }} onChanged={reload} onRunningChange={setImportRunning} />
    <KnowledgeExport open={exportOpen === "scope"} onOpenChange={(open) => { if (!open) { setExportOpen(null); returnFocus(); } }} ids={parentId ? [parentId] : undefined} area={area} label={parentId ? "Выгрузить папку" : "Выгрузить раздел"} />
    <KnowledgeExport open={exportOpen === "all"} onOpenChange={(open) => { if (!open) { setExportOpen(null); returnFocus(); } }} label="Выгрузить всю базу" />
    {assignCase && folderRevision === refresh && <KnowledgeAssignCase items={chosen} folders={folders} onClose={() => setAssignCase(false)} onSaved={reload} />}
    <dialog ref={sheetRef} aria-labelledby={sheetTitleId} onClose={() => setTreeOpen(false)} data-testid="knowledge-tree-sheet"
      className="fixed inset-y-0 start-0 end-auto m-0 h-dvh max-h-none w-full max-w-[22rem] overflow-y-auto border-0 border-e border-border bg-surface p-0 text-fg shadow-evo-lg backdrop:bg-black/45">
      {treeOpen ? <>
        <div className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b border-border bg-surface ps-4 pe-2">
          <h2 id={sheetTitleId} className="min-w-0 flex-1 t-section">Папки</h2>
          <button type="button" aria-label="Закрыть" onClick={() => setTreeOpen(false)} className="grid size-11 shrink-0 place-items-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"><Icon name="x" size={20} /></button>
        </div>
        <div className="p-2">{tree(() => setTreeOpen(false))}</div>
      </> : null}
    </dialog>
    <dialog ref={dialogRef} aria-labelledby={dialogTitleId} className={KB_DIALOG} onCancel={() => setDialog(null)} data-testid="knowledge-dialog">
      <form onSubmit={submitDialog} className="flex max-h-[85dvh] flex-col">
        <div className={KB_DIALOG_HEAD}><h2 id={dialogTitleId} className="t-section">{dialog === "move" ? "Переместить" : dialog === "rename" ? "Переименовать" : dialog === "folder" ? "Новая папка" : "Новая страница"}</h2></div>
        <div className={KB_DIALOG_BODY}>
          {dialog === "move"
            ? <label className={KB_LABEL}>Папка<select value={targetFolder} onChange={(event) => setTargetFolder(event.target.value)} className={KB_FIELD}><option value="">Входящие</option>{folders.filter((folder) => folder.area === area && !selected.has(folder.id)).map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}</select></label>
            : <label className={KB_LABEL}>Название<input autoFocus required maxLength={240} value={name} onChange={(event) => setName(event.target.value)} className={KB_FIELD} /></label>}
          {error && dialog && <p role="alert" className={KB_ERROR}>{error}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">
          <button type="button" className={QUEUE_SECONDARY} onClick={() => setDialog(null)}>Отмена</button>
          <button type="submit" className={QUEUE_CONFIRM} disabled={busy}>{busy ? "Сохраняется…" : "Сохранить"}</button>
        </div>
      </form>
    </dialog>
  </div>;
}
