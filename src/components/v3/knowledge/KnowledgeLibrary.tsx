"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KNOWLEDGE_AREAS, KNOWLEDGE_AREA_NAMES, type KnowledgeArea, type KnowledgeItem, type KnowledgePage, type KnowledgeQuery } from "@/lib/knowledge-library-contract";
import { command, configureKnowledgeCommands, knowledgeFetch, knowledgeSourceKey, uploadKnowledgeFile } from "./client";
import { KnowledgeImport } from "./KnowledgeImport";
import { KnowledgeSecret } from "./KnowledgeSecret";
import { KnowledgeDossiers } from "./KnowledgeDossiers";
import { KnowledgeAssignCase } from "./KnowledgeAssignCase";
import { KnowledgeExport } from "./KnowledgeExport";
import { KnowledgeEditor } from "./KnowledgeEditor";
import styles from "./KnowledgeLibrary.module.css";

type View = "list" | "trash" | "review" | "archive" | "inbox";
const kindNames = { folder: "Папка", page: "Страница", file: "Файл", secret: "Доступ" };
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
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(""); const [searchScope, setSearchScope] = useState("all");
  const [refresh, setRefresh] = useState(0); const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [status, setStatus] = useState("");
  const [newSecret, setNewSecret] = useState(false);
  const [assignCase, setAssignCase] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [dialog, setDialog] = useState<"folder" | "page" | "rename" | "move" | null>(null);
  const [name, setName] = useState(""); const [targetFolder, setTargetFolder] = useState("");
  const fileRef = useRef<HTMLInputElement>(null); const directoryRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
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
      if (searchScope === "all") delete value.area;
      else if (parentId) value.scopeParentId = parentId;
    }
    return Object.fromEntries(Object.entries(value).filter(([, val]) => val !== null && val !== undefined).map(([key, val]) => [key, String(val)]));
  }, [area, parentId, search, searchScope, view]);
  useEffect(() => {
    if (section) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError(""); setSelected(new Set());
      void knowledgeFetch<KnowledgePage>(`list?${new URLSearchParams(query())}`, { signal: abort.signal }).then((result) => {
        setItems(result.items); setPage(result);
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
  const chosen = items.filter((item) => selected.has(item.id));
  const parent = folders.find((folder) => folder.id === parentId);
  const breadcrumb: KnowledgeItem[] = [];
  for (let current = parent; current && !breadcrumb.some((item) => item.id === current?.id); current = folders.find((folder) => folder.id === current?.parent_id)) breadcrumb.unshift(current);
  function reload() { setRefresh((value) => value + 1); }
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
  function tree(treeParentId: string | null, nodeArea: KnowledgeArea, depth = 0): React.ReactNode {
    if (depth > 40) return <Link href={href({ area: nodeArea, folder: treeParentId })}>Открыть вложенные папки</Link>;
    return folders.filter((folder) => folder.area === nodeArea && folder.parent_id === treeParentId).map((folder) => <details key={folder.id} open={breadcrumb.some((item) => item.id === folder.id)}>
      <summary><Link href={href({ area: nodeArea, folder: folder.id })} aria-current={folder.id === parentId ? "page" : undefined} onClick={() => setTreeOpen(false)}>{folder.title}</Link></summary>
      <div className={styles.branch}>{tree(folder.id, nodeArea, depth + 1)}</div>
    </details>);
  }
  const onSaved = useCallback((saved: KnowledgeItem) => {
    setSelectedItem(saved);
    setItems((old) => old.map((item) => item.id === saved.id ? saved : item));
    setRefresh((value) => value + 1);
  }, []);
  if (newSecret || (itemId && selectedItem?.id === itemId && selectedItem.kind === "secret")) return <div className={styles.library}><KnowledgeSecret item={newSecret ? undefined : selectedItem!} parentId={parentId} onClose={() => { setNewSecret(false); router.push(href({ area: "secrets", folder: selectedItem?.parent_id ?? parentId, item: null })); }} onSaved={onSaved} /></div>;
  if (itemId && selectedItem?.id === itemId) return <div className={styles.library}><KnowledgeEditor key={itemId} item={selectedItem} onClose={() => router.push(href({ area: selectedItem.area, folder: selectedItem.parent_id, item: null }))} onSaved={onSaved} /></div>;
  return <div className={styles.library}>
    <div className={styles.layout}>
      <aside className={`${styles.tree} ${treeOpen ? styles.treeOpen : ""}`} aria-label="Папки базы знаний">
        <div className={styles.treeHeading}>Папки<button type="button" className={styles.mobileOnly} onClick={() => setTreeOpen(false)}>Закрыть</button></div>
        {KNOWLEDGE_AREAS.map((nodeArea) => <section key={nodeArea}><Link className={!section && area === nodeArea && !parentId && view === "list" ? styles.active : ""} href={href({ area: nodeArea, folder: null })}>{KNOWLEDGE_AREA_NAMES[nodeArea]}</Link><div className={styles.branch}>{tree(null, nodeArea)}</div></section>)}
        <nav className={styles.special} aria-label="Разделы базы знаний">
          <Link href="/v3/knowledge?section=documents" className={section === "documents" ? styles.active : ""} aria-current={section === "documents" ? "page" : undefined} onClick={() => setTreeOpen(false)}>Документы</Link>
          <Link href="/v3/knowledge?section=snippets" className={section === "snippets" ? styles.active : ""} aria-current={section === "snippets" ? "page" : undefined} onClick={() => setTreeOpen(false)}>Шаблоны ответов</Link>
          <Link href={href({ folder: null, view: "inbox" })}>Входящие</Link>
          <Link href={href({ folder: null, view: "review" })}>На уточнении</Link>
          <Link href={href({ folder: null, view: "archive" })}>Архив</Link>
          <Link href={href({ folder: null, view: "trash" })}>Корзина</Link>
        </nav>
      </aside>
      <section className={styles.contents} aria-label="Материалы">
        {section ? <>
          <div className={styles.toolbar}>
            <button type="button" className={styles.mobileOnly} onClick={() => setTreeOpen(true)}>Папки</button>
            {section === "documents" && <h2 className={styles.sectionHeading}>Документы</h2>}
          </div>
          {children}
        </> : <>
        <KnowledgeImport onChanged={reload} />
        <div className={styles.toolbar}>
          <button type="button" className={styles.mobileOnly} onClick={() => setTreeOpen(true)}>Папки</button>
          <nav className={styles.breadcrumb} aria-label="Путь"><Link href={href({ folder: null })}>{KNOWLEDGE_AREA_NAMES[area]}</Link>{breadcrumb.map((item) => <span key={item.id}> / <Link href={href({ folder: item.id })}>{item.title}</Link></span>)}</nav>
          <details className={styles.menu}><summary>Создать</summary><div><button type="button" onClick={() => { setName(""); setDialog("folder"); }}>Папку</button>{area !== "secrets" && <button type="button" onClick={() => { setName(""); setDialog("page"); }}>Страницу</button>}</div></details>
          {area !== "secrets" && <details className={styles.menu}><summary>Загрузить</summary><div><button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>Файлы</button><button type="button" disabled={busy} onClick={() => directoryRef.current?.click()}>Папку</button></div></details>}
          <input ref={fileRef} type="file" multiple hidden onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
          <input ref={directoryRef} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
        </div>
        <div className={styles.actions}>{area === "secrets" && <button type="button" onClick={() => setNewSecret(true)}>Добавить доступ</button>}<KnowledgeExport ids={parentId ? [parentId] : undefined} area={area} label="Выгрузить папку" /><KnowledgeExport label="Выгрузить всю базу" /></div>
        <div className={styles.search}><input type="search" aria-label="Поиск по базе знаний" placeholder="Найти материал" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Область поиска" value={searchScope} onChange={(event) => setSearchScope(event.target.value)}><option value="all">Вся база</option><option value="folder">Текущая папка</option></select></div>
        {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={reload}>Повторить</button></div>}
        {status && <p role="status" aria-live="polite" className={styles.status}>{status}</p>}
        {area === "clients" && !parentId && view === "list" && <KnowledgeDossiers key={params.get("case") ?? "directory"} caseId={params.get("case")} search={search} />}
        {selected.size > 0 && <div className={styles.selection}>
          <span>Выбрано: {selected.size}</span><KnowledgeExport ids={[...selected]} label="Выгрузить выбранное" />
          {view === "trash" ? <button type="button" disabled={busy} onClick={() => void mutate("restore")}>Восстановить</button> : <>
            {selected.size === 1 && <button type="button" onClick={() => { if (chosen[0]?.kind === "secret") { router.push(href({ area: "secrets", item: chosen[0].id })); return; } setName(chosen[0]?.title ?? ""); setDialog("rename"); }}>Переименовать</button>}
            <button type="button" onClick={() => { setTargetFolder(""); setDialog("move"); }}>Переместить</button>
            {chosen.every((item) => item.area === "clients" && !item.client_case_id && !item.archived_at) && <button type="button" disabled={busy || folderRevision !== refresh} onClick={() => setAssignCase(true)}>Привязать к делу</button>}
            <button type="button" disabled={busy} onClick={() => void mutate(view === "archive" ? "unarchive" : "archive")}>{view === "archive" ? "Вернуть из архива" : "Архивировать"}</button>
            <button type="button" disabled={busy} onClick={() => void mutate("trash")}>В корзину</button>
          </>}
          <button type="button" onClick={() => setSelected(new Set())}>Снять выбор</button>
        </div>}
        <div className={styles.tableWrap} aria-busy={loading}><table className={styles.table}>
          <thead><tr><th><input type="checkbox" aria-label="Выбрать показанные материалы" checked={items.length > 0 && items.every((item) => selected.has(item.id))} onChange={(event) => setSelected(event.target.checked ? new Set(items.map((item) => item.id)) : new Set())} /></th><th>Название</th><th>Тип</th><th>Изменено</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id} className={selected.has(item.id) ? styles.selected : ""}>
            <td><input type="checkbox" aria-label={`Выбрать ${item.title}`} checked={selected.has(item.id)} onChange={(event) => setSelected((old) => { const next = new Set(old); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /></td>
            <td><Link href={item.kind === "folder" ? href({ area: item.area, folder: item.id }) : href({ area: item.area, folder: item.parent_id, item: item.id })}>{item.title}</Link>{item.review_question && <span className={styles.reviewLabel}>На уточнении</span>}</td>
            <td>{kindNames[item.kind]}</td><td>{new Date(item.updated_at).toLocaleDateString("ru")}</td>
          </tr>)}</tbody>
        </table>
        {!loading && !error && !items.length && <div className={styles.empty}><p>{search ? "Ничего не найдено" : view === "trash" ? "Корзина пуста" : "Материалов пока нет"}</p>{view === "list" && !search && area !== "secrets" && <button type="button" onClick={() => { setName(""); setDialog("page"); }}>Создать страницу</button>}</div>}
        {loading && <p className={styles.status} role="status">Загрузка…</p>}
        {page?.hasMore && <button type="button" disabled={loading} onClick={() => void more()}>Показать ещё</button>}
        </div>
        </>}
      </section>
    </div>
    {assignCase && folderRevision === refresh && <KnowledgeAssignCase items={chosen} folders={folders} onClose={() => setAssignCase(false)} onSaved={reload} />}
    <dialog ref={dialogRef} className={styles.dialog} onCancel={() => setDialog(null)}>
      <form onSubmit={submitDialog}><h2>{dialog === "move" ? "Переместить" : dialog === "rename" ? "Переименовать" : dialog === "folder" ? "Новая папка" : "Новая страница"}</h2>
        {dialog === "move" ? <label>Папка<select value={targetFolder} onChange={(event) => setTargetFolder(event.target.value)}><option value="">Входящие</option>{folders.filter((folder) => folder.area === area && !selected.has(folder.id)).map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}</select></label> : <label>Название<input autoFocus required maxLength={240} value={name} onChange={(event) => setName(event.target.value)} /></label>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.editorBar}><button type="button" onClick={() => setDialog(null)}>Отмена</button><button type="submit" className={styles.primary} disabled={busy}>{busy ? "Сохраняется…" : "Сохранить"}</button></div>
      </form>
    </dialog>
  </div>;
}
