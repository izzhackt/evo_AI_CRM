"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { KnowledgeCanonicalSearch } from "../KnowledgeCanonicalSearch";
import { KnowledgeDossiers } from "../KnowledgeDossiers";
import { KnowledgeEditor } from "../KnowledgeEditor";
import { KnowledgeSecret } from "../KnowledgeSecret";
import { KnowledgeTree } from "../KnowledgeTree";
import { buildCrumbs } from "./library-model";
import { LibraryCrumbs } from "./LibraryCrumbs";
import { LibraryMessages } from "./LibraryMessages";
import { LibraryOverlays, type ExportState } from "./LibraryOverlays";
import { LibrarySelectionBar } from "./LibrarySelectionBar";
import { LibraryTable } from "./LibraryTable";
import { LibraryToolbar } from "./LibraryToolbar";
import { useKnowledgeActions } from "./useKnowledgeActions";
import { useKnowledgeData } from "./useKnowledgeData";

const CHOICE = "v3-choice inline-flex min-h-11 items-center rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

/**
 * «Материалы» базы знаний в новом виде: слева дерево папок (на узком экране — панель «Папки»), справа путь, инструменты, список и выбор.
 * Чтения и команды — те же, что у прежней `KnowledgeLibrary` (`/api/v3/knowledge/*`, `expectedVersion`, `requestId`); редактор страницы,
 * доступы, досье, выгрузка и перенос — прежние части внутри новой рамки.
 */
export function KnowledgeNextLibrary({ commandScope }: Readonly<{ commandScope: string }>) {
  const router = useRouter();
  const data = useKnowledgeData();
  const actions = useKnowledgeActions(data, commandScope);
  const fileRef = useRef<HTMLInputElement>(null);
  const directoryRef = useRef<HTMLInputElement>(null);
  const [newSecret, setNewSecret] = useState(false);
  const [assignCase, setAssignCase] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState<ExportState>(null);
  const [exportIds, setExportIds] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importRunning, setImportRunning] = useState(false);
  const { area, parentId, itemId, view, params, href, search, scope, selectedItem, error, selected, setSelected } = data;
  const crumbs = buildCrumbs(area, parentId, view, data.folders, href);
  const secretOpen = Boolean(itemId && selectedItem?.id === itemId && selectedItem.kind === "secret");
  const itemOpen = Boolean(itemId && selectedItem?.id === itemId);
  const toggle = (id: string, on: boolean) => setSelected((old) => { const next = new Set(old); if (on) next.add(id); else next.delete(id); return next; });
  const tree = (
    <KnowledgeTree folders={data.folderRevision === null ? null : data.folders} folderError={data.folderError} onRetryFolders={data.retryFolders} area={area} parentId={parentId}
      view={view} section={null} href={href} sections={false} />
  );
  const sheet = "min-w-0 rounded-card border border-border bg-surface text-fg";
  let main: React.ReactNode;
  if (newSecret || secretOpen) main = <div className={sheet}><KnowledgeSecret item={newSecret ? undefined : selectedItem!} parentId={parentId} onSaved={data.onSaved} onClose={() => { setNewSecret(false); router.push(href({ area: "secrets", folder: selectedItem?.parent_id ?? parentId, item: null })); }} /></div>;
  else if (itemOpen) main = <div className={sheet}><KnowledgeEditor key={itemId} item={selectedItem!} onSaved={data.onSaved} onClose={() => router.push(href({ area: selectedItem!.area, folder: selectedItem!.parent_id, item: null }))} /></div>;
  else if (itemId && !error) main = <div aria-busy="true" className={`${sheet} space-y-4 p-4`} data-testid="knowledge-item-loading"><p role="status" className="sr-only">Открываем материал…</p><Skeleton className="h-11 w-32" /><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-full" /></div>;
  else main = (
    <div className="grid min-w-0 gap-3">
      <LibraryCrumbs crumbs={crumbs} />
      <LibraryToolbar search={search} onSearch={data.setSearch} area={area} view={view} hasParent={Boolean(parentId)} busy={actions.busy} importRunning={importRunning}
        onFolders={() => setTreeOpen(true)} onCreate={(kind) => (kind === "secret" ? setNewSecret(true) : actions.openDialog(kind))}
        onPickFiles={() => fileRef.current?.click()} onPickFolder={() => directoryRef.current?.click()} onExport={setExportOpen} onImport={() => setImportOpen(true)} />
      {parentId && search.trim() ? (
        <div role="group" aria-label="Где искать" className="flex flex-wrap gap-2">
          <button type="button" className={CHOICE} aria-pressed={data.searchScope === "all"} onClick={() => data.setSearchScope("all")}>Вся база</button>
          <button type="button" className={CHOICE} aria-pressed={data.searchScope === "folder"} onClick={() => data.setSearchScope("folder")}>Текущая папка</button>
        </div>
      ) : null}
      <LibraryMessages error={error} onRetry={data.reload} status={actions.status} canUndo={Boolean(actions.undo && actions.status === actions.undo.message)} busy={actions.busy} onUndo={() => void actions.undoLast()} />
      {search.trim() && scope === "all" ? <KnowledgeCanonicalSearch key={search.trim()} search={search.trim()} onOpen={() => data.setSearch("")} /> : null}
      {area === "clients" && !parentId && view === "list" && !(search.trim() && scope === "all") ? <KnowledgeDossiers key={params.get("case") ?? "directory"} caseId={params.get("case")} tab={params.get("tab")} search={search} /> : null}
      <LibrarySelectionBar chosen={actions.chosen} count={selected.size} view={view} busy={actions.busy} assignReady={data.folderRevision === data.refresh}
        onMutate={(op) => void actions.mutate(op)} onMove={() => { actions.setTargetFolder(""); actions.setDialog("move"); }} onClear={() => setSelected(new Set())}
        onRename={(item) => { if (item.kind === "secret") { router.push(href({ area: "secrets", item: item.id })); return; } actions.setName(item.title); actions.setDialog("rename"); }}
        onAssign={() => setAssignCase(true)} onExport={() => { setExportIds([...selected]); setExportOpen("selected"); }} />
      {/* Над таблицей уже стоит группа со своим заголовком («Материалы CRM» при поиске по всей базе, «Клиенты» в клиентской базе): у основного списка заголовок тоже есть. */}
      {(search.trim() && scope === "all") || (area === "clients" && !parentId && view === "list") ? <h2 className="t-section text-fg">Папки и материалы</h2> : null}
      <LibraryTable data={data} toggle={toggle} toggleAll={(on) => setSelected(on ? new Set(data.rows.map((item) => item.id)) : new Set())} title={crumbs.map((crumb) => crumb.label).join(" / ")} />
    </div>
  );
  return (
    <div className="@container/kb min-w-0" data-testid="knowledge-library">
      {itemId || newSecret ? main : (
        <div className="grid min-w-0 items-start gap-4 @3xl/kb:grid-cols-[16rem_minmax(0,1fr)] @5xl/kb:grid-cols-[18rem_minmax(0,1fr)]">
          <aside aria-label="Папки базы знаний" className="hidden min-w-0 rounded-card border border-border bg-surface p-2 @3xl/kb:block">{tree}</aside>
          <section aria-label="Материалы" className="@container/kbl min-w-0">{main}</section>
        </div>
      )}
      <LibraryOverlays data={data} actions={actions} fileRef={fileRef} directoryRef={directoryRef} exportOpen={exportOpen} setExportOpen={setExportOpen} exportIds={exportIds} importOpen={importOpen} setImportOpen={setImportOpen}
        setImportRunning={setImportRunning} assignCase={assignCase} setAssignCase={setAssignCase} treeOpen={treeOpen} setTreeOpen={setTreeOpen} />
    </div>
  );
}
