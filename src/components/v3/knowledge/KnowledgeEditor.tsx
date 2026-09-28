"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { TopLayerMenu } from "@/components/v3/board/TopLayerMenu";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { installKnowledgeEditorExitGuard } from "@/lib/knowledge-editor-exit-guard";
import type { KnowledgeItem, KnowledgeVersion } from "@/lib/knowledge-library-contract";
import { command, knowledgeFetch, KnowledgeClientError, uploadKnowledgeFile } from "./client";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { KnowledgeExport } from "./KnowledgeExport";
import { KB_ERROR, KB_FIELD, KB_LABEL, KB_MENU, KB_MENU_ITEM, KB_QUIET, knowledgeMoment } from "./knowledge-look";
import styles from "./KnowledgeLibrary.module.css";

const TOOL = `${QUEUE_SECONDARY} px-2.5`;

type Draft = { title: string; body: string; reviewQuestion: string };
export function KnowledgeEditor({ item, onClose, onSaved }: { item: KnowledgeItem; onClose: () => void; onSaved: (item: KnowledgeItem) => void }) {
  const [draft, setDraft] = useState<Draft>({ title: item.title, body: item.body ?? "", reviewQuestion: item.review_question });
  const [state, setState] = useState("Сохранено");
  const [error, setError] = useState("");
  const [exitWarning, setExitWarning] = useState(false);
  const [mode, setMode] = useState<"edit" | "read">("read");
  const [versions, setVersions] = useState<KnowledgeVersion[]>([]);
  const [history, setHistory] = useState(false);
  const [moreHistory, setMoreHistory] = useState(false);
  const [conflict, setConflict] = useState<KnowledgeItem | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [historyAt, setHistoryAt] = useState<Date | null>(null);
  const moreId = useId();
  const draftRef = useRef(draft);
  const [savedDraft, setSavedDraft] = useState(JSON.stringify(draft));
  const savedRef = useRef(savedDraft);
  const versionRef = useRef(item.version);
  const busyRef = useRef(false);
  const restoreRequest = useRef<{ key: string; id: string } | null>(null);
  const pendingRef = useRef<{ id: string; draft: Draft } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== savedDraft;
  const editable = item.kind === "page" && !item.deleted_at;
  const canEditMetadata = (item.kind === "page" || item.kind === "file") && !item.deleted_at;
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => installKnowledgeEditorExitGuard({
    blocked: () => JSON.stringify(draftRef.current) !== savedRef.current || busyRef.current,
    notify: () => setExitWarning(true),
  }), [item.id]);
  const save = useCallback(async () => {
    if (busyRef.current || !canEditMetadata) return;
    const current = draftRef.current;
    if (JSON.stringify(current) === savedRef.current && !pendingRef.current) return;
    if (!current.title.trim()) { setError("Укажите название."); return; }
    busyRef.current = true; setState("Сохраняется"); setError("");
    const pending = pendingRef.current ?? { id: crypto.randomUUID(), draft: { ...current } };
    pendingRef.current = pending;
    try {
      const saved = await command({ op: "edit", id: item.id, expectedVersion: versionRef.current, title: pending.draft.title, reviewQuestion: pending.draft.reviewQuestion, ...(item.kind === "page" ? { body: pending.draft.body } : {}) }, pending.id);
      versionRef.current = saved.version; savedRef.current = JSON.stringify(pending.draft); setSavedDraft(savedRef.current); pendingRef.current = null;
      setState("Сохранено"); setSaveRevision((value) => value + 1); onSaved(saved);
    } catch (cause) {
      setState("Не сохранено"); setError(cause instanceof Error ? cause.message : "Не удалось сохранить.");
      if (cause instanceof KnowledgeClientError && cause.code === "knowledge_version_conflict") {
        try { setConflict(await knowledgeFetch<KnowledgeItem>(`item/${item.id}`)); }
        catch { setError("Не удалось открыть текущую версию. Ваш текст остаётся в редакторе."); }
      }
    } finally { busyRef.current = false; }
  }, [canEditMetadata, item.id, item.kind, onSaved]);
  useEffect(() => {
    if (!canEditMetadata || !dirty || error || conflict) return;
    const timer = setTimeout(() => { void save(); }, 900);
    return () => clearTimeout(timer);
  }, [draft, dirty, canEditMetadata, error, conflict, saveRevision, save]);
  async function loadHistory(append = false) {
    try {
      const last = append ? versions.at(-1)?.version : undefined;
      const page = await knowledgeFetch<{ items: KnowledgeVersion[]; hasMore: boolean }>(`item/${item.id}/history${last ? `?before=${last}` : ""}`);
      setVersions((old) => append ? [...old, ...page.items] : page.items); setMoreHistory(page.hasMore); setHistory(true); setHistoryAt(new Date());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "История недоступна."); }
  }
  function insert(value: string) {
    const input = textRef.current;
    const start = input?.selectionStart ?? draft.body.length;
    const end = input?.selectionEnd ?? start;
    setDraft((old) => ({ ...old, body: old.body.slice(0, start) + value + old.body.slice(end) }));
    input?.focus();
  }
  async function attach(file: File) {
    try {
      setState("Загрузка вложения");
      const uploaded = await uploadKnowledgeFile(file, item.area, item.parent_id, () => {}, item.client_case_id);
      insert(file.type.startsWith("image/") ? `\n![${file.name}](/api/v3/knowledge/download/${uploaded.id}?preview=1)\n` : `\n[${file.name}](/v3/knowledge?item=${uploaded.id})\n`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Вложение не загружено."); }
  }
  async function close() {
    if (dirty) { await save(); if (JSON.stringify(draftRef.current) !== savedRef.current) return; }
    onClose();
  }
  // Облик Э8.10: автосохранение, защита выхода и конфликт версий — прежние; меняется только вид.
  return <section className="p-4 @3xl/kb:p-5" aria-label={item.title} data-testid="knowledge-editor">
    <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
      <button type="button" className={KB_QUIET} onClick={() => void close()}><Icon name="arrow-left" size={16} />К папке</button>
      <span role="status" aria-live="polite" className="me-auto t-meta text-fg-3">{state}</span>
      {item.kind === "page" ? null : <a href={`/api/v3/knowledge/download/${item.id}`} className={QUEUE_SECONDARY}><Icon name="download" size={18} />Скачать</a>}
      <TopLayerMenu label="Ещё действия с материалом" trigger={<Icon name="more-horizontal" size={20} />} triggerClassName={`${QUEUE_SECONDARY} w-11 px-0`} triggerProps={{ id: moreId }} menuClassName={KB_MENU} testId="knowledge-editor-menu">
        {(closeMenu) => <>
          <button type="button" className={KB_MENU_ITEM} onClick={() => { closeMenu(); void navigator.clipboard.writeText(`${location.origin}/v3/knowledge?item=${item.id}`).then(() => setState("Ссылка скопирована"), () => setError("Не удалось скопировать ссылку.")); }}>Копировать ссылку</button>
          {item.kind === "page" ? <button type="button" className={KB_MENU_ITEM} onClick={() => { closeMenu(); setExportOpen(true); }}>Выгрузить страницу</button> : null}
          {editable && <button type="button" className={KB_MENU_ITEM} onClick={() => { closeMenu(); void loadHistory(); }}>История версий</button>}
        </>}
      </TopLayerMenu>
      {item.kind === "page" ? <KnowledgeExport open={exportOpen} onOpenChange={(open) => { setExportOpen(open); if (!open) requestAnimationFrame(() => document.getElementById(moreId)?.focus()); }} ids={[item.id]} label="Выгрузить страницу" /> : null}
    </div>
    {exitWarning && dirty && <div className={KB_ERROR} role="alert">
      Изменения ещё не сохранены. Сохраните их или закройте материал без сохранения.
      <button type="button" className={QUEUE_CONFIRM} onClick={() => void save()}>Сохранить</button>
      <button type="button" className={QUEUE_SECONDARY} disabled={state === "Сохраняется"} onClick={() => {
        if (busyRef.current) return;
        const previous: Draft = JSON.parse(savedRef.current);
        draftRef.current = previous; pendingRef.current = null; setDraft(previous); onClose();
      }}>Закрыть без сохранения</button>
    </div>}
    {error && <div className={KB_ERROR} role="alert">{error}{!conflict && <button type="button" className={QUEUE_SECONDARY} onClick={() => void save()}>Повторить сохранение</button>}</div>}
    {conflict && <div className="mt-3 space-y-3 rounded-card border border-border p-4" data-testid="knowledge-conflict">
      <h3 className="t-item">Текущая версия</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-ctl bg-bg p-3 t-body-compact">{item.kind === "page" ? conflict.body : conflict.review_question}</pre>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={QUEUE_CONFIRM} onClick={() => {
          versionRef.current = conflict.version; pendingRef.current = null; setConflict(null); setError(""); void save();
        }}>{item.kind === "page" ? "Сохранить мой текст" : "Сохранить мои изменения"}</button>
        <button type="button" className={QUEUE_SECONDARY} onClick={() => {
          const next = { title: conflict.title, body: conflict.body ?? "", reviewQuestion: conflict.review_question };
          versionRef.current = conflict.version; savedRef.current = JSON.stringify(next); setSavedDraft(savedRef.current); pendingRef.current = null;
          setDraft(next); setConflict(null); setError(""); setState("Сохранено");
        }}>Принять текущую</button>
      </div>
    </div>}
    <div className="mx-auto mt-5 max-w-[51.25rem]">
      {editable ? <input className={styles.titleInput} aria-label="Название страницы" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={240} /> : <h2 className="t-record-title [overflow-wrap:anywhere]">{item.title}</h2>}
      {item.kind === "page" ? <>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Режим" className="flex gap-2">
            <button type="button" className={`v3-choice ${TOOL}`} aria-pressed={mode === "read"} onClick={() => setMode("read")}>Читать</button>
            {editable && <button type="button" className={`v3-choice ${TOOL}`} aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>Редактировать</button>}
          </div>
          {mode === "edit" && <div role="group" aria-label="Вставить" className="flex flex-wrap gap-2">
            <button type="button" className={TOOL} onClick={() => insert("\n## ")}>Заголовок</button>
            <button type="button" className={TOOL} onClick={() => insert("\n- ")}>Список</button>
            <button type="button" className={TOOL} onClick={() => insert("\n|  |  |\n| --- | --- |\n|  |  |\n")}>Таблица</button>
            <button type="button" className={TOOL} onClick={() => insert("[Название](https://)")}>Ссылка</button>
            <button type="button" className={TOOL} onClick={() => attachmentRef.current?.click()}>Вложение</button>
            <input ref={attachmentRef} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void attach(file); event.target.value = ""; }} />
          </div>}
        </div>
        {mode === "edit" ? <textarea ref={textRef} className="mt-4 block min-h-[50vh] w-full resize-y rounded-ctl border border-control-edge bg-surface p-3 t-body text-fg focus-visible:border-accent" aria-label="Текст страницы" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
          : <div className={styles.markdown}><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: (props) => <a {...props} rel="noreferrer" /> }}>{draft.body}</Markdown></div>}
        {item.source_blob_id && <a href={`/api/v3/knowledge/download/${item.id}?original=1`} className={KB_QUIET}>Скачать исходник</a>}
      </> : <>
        {["application/pdf", "image/png", "image/jpeg"].includes(item.mime_type) && item.area !== "raw" && item.area !== "secrets"
          ? <iframe title={item.title} sandbox="" className="mt-4 h-[65vh] w-full rounded-ctl border border-border" src={`/api/v3/knowledge/download/${item.id}?preview=1`} />
          : <p className="mt-4 t-body text-fg-2">Предпросмотр этого формата недоступен. <a href={`/api/v3/knowledge/download/${item.id}`} className="underline underline-offset-4 hover:text-fg">Скачать файл</a></p>}
      </>}
      {(canEditMetadata || draft.reviewQuestion) && <label className={`${KB_LABEL} mt-8`}>Вопрос для уточнения
        <input value={draft.reviewQuestion} readOnly={!canEditMetadata} onChange={(event) => setDraft({ ...draft, reviewQuestion: event.target.value })} maxLength={4000} className={KB_FIELD} />
        {canEditMetadata && <span className="t-meta text-fg-3">Очистите поле, когда вопрос решён.</span>}
      </label>}
    </div>
    {history && <aside className="mx-auto mt-6 max-w-[51.25rem] border-t border-border pt-4" aria-label="История версий" data-testid="knowledge-history">
      <div className="flex items-center justify-between gap-2"><h3 className="t-item">История версий</h3><button type="button" className={QUEUE_SECONDARY} onClick={() => setHistory(false)}>Закрыть</button></div>
      <ul className="mt-2 divide-y divide-border border-y border-border">{versions.map((version) => {
        const at = historyAt ? knowledgeMoment(version.created_at, historyAt) : null;
        return <li key={version.version}><details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 t-body-compact text-fg [&::-webkit-details-marker]:hidden">
            <Icon name="chevron-right" size={16} className="shrink-0 text-fg-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            Версия {version.version}{at ? <> · <time dateTime={version.created_at} className="font-mono tabular-nums text-fg-2">{at}</time></> : null}
          </summary>
          <pre className="mb-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-ctl bg-bg p-3 t-body-compact">{version.snapshot.body}</pre>
          <button type="button" className={`${QUEUE_SECONDARY} mb-3`} disabled={dirty} onClick={() => {
            const key = `${item.id}:${versionRef.current}:${version.version}`;
            if (restoreRequest.current?.key !== key) restoreRequest.current = { key, id: crypto.randomUUID() };
            void command({ op: "restore_version", id: item.id, expectedVersion: versionRef.current, restoreVersion: version.version }, restoreRequest.current.id).then((restored) => {
              restoreRequest.current = null;
              const next = { title: restored.title, body: restored.body ?? "", reviewQuestion: restored.review_question };
              versionRef.current = restored.version; savedRef.current = JSON.stringify(next); setSavedDraft(savedRef.current); setDraft(next); onSaved(restored); setHistory(false); setState("Версия восстановлена");
            }).catch((cause) => setError(cause.message));
          }}>Восстановить версию</button>
        </details></li>;
      })}</ul>
      {moreHistory && <button type="button" className={KB_QUIET} onClick={() => void loadHistory(true)}>Показать ещё</button>}
    </aside>}
  </section>;
}
