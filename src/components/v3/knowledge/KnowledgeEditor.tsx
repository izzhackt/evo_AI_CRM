"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { KnowledgeItem, KnowledgeVersion } from "@/lib/knowledge-library-contract";
import { command, knowledgeFetch, KnowledgeClientError, uploadKnowledgeFile } from "./client";
import { KnowledgeExport } from "./KnowledgeExport";
import styles from "./KnowledgeLibrary.module.css";

type Draft = { title: string; body: string; reviewQuestion: string };
export function KnowledgeEditor({ item, onClose, onSaved }: { item: KnowledgeItem; onClose: () => void; onSaved: (item: KnowledgeItem) => void }) {
  const [draft, setDraft] = useState<Draft>({ title: item.title, body: item.body ?? "", reviewQuestion: item.review_question });
  const [state, setState] = useState("Сохранено");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"edit" | "read">("read");
  const [versions, setVersions] = useState<KnowledgeVersion[]>([]);
  const [history, setHistory] = useState(false);
  const [moreHistory, setMoreHistory] = useState(false);
  const [conflict, setConflict] = useState<KnowledgeItem | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
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
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const save = useCallback(async () => {
    if (busyRef.current || !editable) return;
    const current = draftRef.current;
    if (JSON.stringify(current) === savedRef.current && !pendingRef.current) return;
    if (!current.title.trim()) { setError("Укажите название."); return; }
    busyRef.current = true; setState("Сохраняется"); setError("");
    const pending = pendingRef.current ?? { id: crypto.randomUUID(), draft: { ...current } };
    pendingRef.current = pending;
    try {
      const saved = await command({ op: "edit", id: item.id, expectedVersion: versionRef.current, ...pending.draft }, pending.id);
      versionRef.current = saved.version; savedRef.current = JSON.stringify(pending.draft); setSavedDraft(savedRef.current); pendingRef.current = null;
      setState("Сохранено"); setSaveRevision((value) => value + 1); onSaved(saved);
    } catch (cause) {
      setState("Не сохранено"); setError(cause instanceof Error ? cause.message : "Не удалось сохранить.");
      if (cause instanceof KnowledgeClientError && cause.code === "knowledge_version_conflict") {
        try { setConflict(await knowledgeFetch<KnowledgeItem>(`item/${item.id}`)); }
        catch { setError("Не удалось открыть текущую версию. Ваш текст остаётся в редакторе."); }
      }
    } finally { busyRef.current = false; }
  }, [editable, item.id, onSaved]);
  useEffect(() => {
    if (!editable || !dirty || error || conflict) return;
    const timer = setTimeout(() => { void save(); }, 900);
    return () => clearTimeout(timer);
  }, [draft, dirty, editable, error, conflict, saveRevision, save]);
  async function loadHistory(append = false) {
    try {
      const last = append ? versions.at(-1)?.version : undefined;
      const page = await knowledgeFetch<{ items: KnowledgeVersion[]; hasMore: boolean }>(`item/${item.id}/history${last ? `?before=${last}` : ""}`);
      setVersions((old) => append ? [...old, ...page.items] : page.items); setMoreHistory(page.hasMore); setHistory(true);
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
  return <section className={styles.editor} aria-label={item.title}>
    <div className={styles.editorBar}>
      <button type="button" onClick={() => void close()}>← К папке</button>
      <span role="status" aria-live="polite">{state}</span>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(`${location.origin}/v3/knowledge?item=${item.id}`).then(() => setState("Ссылка скопирована"), () => setError("Не удалось скопировать ссылку.")); }}>Копировать ссылку</button>
      {item.kind === "page" ? <KnowledgeExport ids={[item.id]} label="Выгрузить страницу" /> : <a href={`/api/v3/knowledge/download/${item.id}`}>Скачать</a>}
      {editable && <button type="button" onClick={() => void loadHistory()}>История</button>}
    </div>
    {error && <div className={styles.error} role="alert">{error}{!conflict && <button type="button" onClick={() => void save()}>Повторить сохранение</button>}</div>}
    {conflict && <div className={styles.conflict}>
      <h3>Текущая версия</h3><pre>{conflict.body}</pre>
      <button type="button" onClick={() => {
        versionRef.current = conflict.version; pendingRef.current = null; setConflict(null); setError(""); void save();
      }}>Сохранить мой текст</button>
      <button type="button" onClick={() => {
        const next = { title: conflict.title, body: conflict.body ?? "", reviewQuestion: conflict.review_question };
        versionRef.current = conflict.version; savedRef.current = JSON.stringify(next); setSavedDraft(savedRef.current); pendingRef.current = null;
        setDraft(next); setConflict(null); setError(""); setState("Сохранено");
      }}>Принять текущую</button>
    </div>}
    <div className={styles.editorContent}>
      {editable ? <input className={styles.titleInput} aria-label="Название страницы" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={240} /> : <h2>{item.title}</h2>}
      {item.kind === "page" ? <>
        <div className={styles.editorBar}>
          <button type="button" aria-pressed={mode === "read"} onClick={() => setMode("read")}>Читать</button>
          {editable && <button type="button" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>Редактировать</button>}
          {mode === "edit" && <>
            <button type="button" onClick={() => insert("\n## ")}>Заголовок</button>
            <button type="button" onClick={() => insert("\n- ")}>Список</button>
            <button type="button" onClick={() => insert("\n|  |  |\n| --- | --- |\n|  |  |\n")}>Таблица</button>
            <button type="button" onClick={() => insert("[Название](https://)")}>Ссылка</button>
            <button type="button" onClick={() => attachmentRef.current?.click()}>Вложение</button>
            <input ref={attachmentRef} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void attach(file); event.target.value = ""; }} />
          </>}
        </div>
        {mode === "edit" ? <textarea ref={textRef} className={styles.bodyInput} aria-label="Текст страницы" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
          : <div className={styles.markdown}><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: (props) => <a {...props} rel="noreferrer" /> }}>{draft.body}</Markdown></div>}
        {editable && <label className={styles.question}>Вопрос для уточнения<input value={draft.reviewQuestion} onChange={(event) => setDraft({ ...draft, reviewQuestion: event.target.value })} maxLength={4000} /></label>}
        {item.source_blob_id && <a href={`/api/v3/knowledge/download/${item.id}?original=1`}>Скачать исходник</a>}
      </> : <>
        {["application/pdf", "image/png", "image/jpeg"].includes(item.mime_type) && item.area !== "raw" && item.area !== "secrets"
          ? <iframe title={item.title} sandbox="" className={styles.preview} src={`/api/v3/knowledge/download/${item.id}?preview=1`} />
          : <p>Предпросмотр этого формата недоступен. <a href={`/api/v3/knowledge/download/${item.id}`}>Скачать файл</a></p>}
      </>}
    </div>
    {history && <aside className={styles.history} aria-label="История версий">
      <div className={styles.editorBar}><h3>История версий</h3><button type="button" onClick={() => setHistory(false)}>Закрыть</button></div>
      {versions.map((version) => <details key={version.version}>
        <summary>Версия {version.version} · {new Date(version.created_at).toLocaleString("ru")}</summary>
        <pre>{version.snapshot.body}</pre>
        <button type="button" disabled={dirty} onClick={() => {
          const key = `${item.id}:${versionRef.current}:${version.version}`;
          if (restoreRequest.current?.key !== key) restoreRequest.current = { key, id: crypto.randomUUID() };
          void command({ op: "restore_version", id: item.id, expectedVersion: versionRef.current, restoreVersion: version.version }, restoreRequest.current.id).then((restored) => {
            restoreRequest.current = null;
            const next = { title: restored.title, body: restored.body ?? "", reviewQuestion: restored.review_question };
            versionRef.current = restored.version; savedRef.current = JSON.stringify(next); setSavedDraft(savedRef.current); setDraft(next); onSaved(restored); setHistory(false); setState("Версия восстановлена");
          }).catch((cause) => setError(cause.message));
        }}>Восстановить версию</button>
      </details>)}
      {moreHistory && <button type="button" onClick={() => void loadHistory(true)}>Показать ещё</button>}
    </aside>}
  </section>;
}
