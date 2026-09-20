"use client";
import { useEffect, useRef, useState } from "react";
import type { KnowledgeItem } from "@/lib/knowledge-library-contract";
import type { PlatformStudentCaseQueueRow } from "@/lib/platform-admissions";
import { command, knowledgeFetch } from "./client";
import styles from "./KnowledgeLibrary.module.css";

type Directory = { items: PlatformStudentCaseQueueRow[]; hasMore: boolean; nextCursor: { sortAt: string; id: string } | null };
export function KnowledgeAssignCase({ items, folders, onClose, onSaved }: { items: KnowledgeItem[]; folders: KnowledgeItem[]; onClose: () => void; onSaved: () => void }) {
  const modal = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState(""); const [directory, setDirectory] = useState<Directory | null>(null);
  const [selected, setSelected] = useState<PlatformStudentCaseQueueRow | null>(null);
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [done, setDone] = useState(new Set<string>());
  const chosenIds = new Set(items.map((item) => item.id));
  const parents = new Map([...folders, ...items].map((item) => [item.id, item.parent_id]));
  const roots = items.filter((item) => {
    const seen = new Set<string>();
    for (let parent = item.parent_id; parent && !seen.has(parent); parent = parents.get(parent) ?? null) {
      if (chosenIds.has(parent)) return false;
      seen.add(parent);
    }
    return true;
  });
  useEffect(() => { modal.current?.showModal(); }, []);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void knowledgeFetch<Directory>(`clients?${new URLSearchParams({ search })}`, { signal: abort.signal })
        .then(setDirectory).catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [search]);
  async function more() {
    if (!directory?.nextCursor) return;
    setBusy(true); setError("");
    try {
      const next = await knowledgeFetch<Directory>(`clients?${new URLSearchParams({ search, afterAt: directory.nextCursor.sortAt, afterId: directory.nextCursor.id })}`);
      if (next.hasMore && next.nextCursor?.id === directory.nextCursor.id) throw new Error("Список не продолжился. Повторите поиск.");
      setDirectory({ ...next, items: [...directory.items, ...next.items] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Список дел недоступен."); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!selected || !confirmed) return;
    setBusy(true); setError("");
    try {
      const folder = await command({ op: "create", area: "clients", kind: "folder", title: selected.studentDisplayName,
        caseId: selected.studentCaseId, sourceKey: `case:${selected.studentCaseId}`, source: { canonicalCaseId: selected.studentCaseId } });
      for (const item of roots) if (!done.has(item.id)) {
        await command({ op: "assign_case", id: item.id, expectedVersion: item.version, parentId: folder.id, caseId: selected.studentCaseId, confirmed: true });
        setDone((previous) => new Set([...previous, item.id]));
      }
      onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось привязать материал."); }
    finally { setBusy(false); }
  }
  return <dialog ref={modal} className={styles.dialog} onCancel={(event) => { if (busy) event.preventDefault(); else { if (done.size) onSaved(); onClose(); } }}>
    <form onSubmit={save}><h2>Привязать к делу</h2>
      <p>Выбрано материалов: {items.length}. Вложенные материалы папок перейдут в то же дело.</p>
      <label>Найти клиента<input type="search" value={search} disabled={busy || done.size > 0} onChange={(event) => { setSearch(event.target.value); setSelected(null); setConfirmed(false); }} /></label>
      <ul className={styles.clientList}>{directory?.items.map((item) => <li key={item.studentCaseId}>
        <label><input type="radio" name="case" checked={selected?.studentCaseId === item.studentCaseId} disabled={busy || done.size > 0}
          onChange={() => { setSelected(item); setConfirmed(false); }} />{item.studentDisplayName} · {item.targetCountry ?? "Страна не указана"} · {item.intake ?? "Набор не указан"}</label>
        <small>Дело {item.studentCaseId} · создано {new Date(item.createdAt).toLocaleDateString("ru-RU")}</small>
      </li>)}</ul>
      {directory?.hasMore && <button type="button" disabled={busy} onClick={() => void more()}>Показать ещё дела</button>}
      {directory && !directory.items.length && <p>Дела не найдены.</p>}
      {selected && <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />Принадлежность материалов этому делу проверена.</label>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.editorBar}><button type="button" disabled={busy} onClick={() => { if (done.size) onSaved(); onClose(); }}>Отмена</button><button type="submit" disabled={busy || !selected || !confirmed}>{busy ? "Сохраняется…" : "Привязать"}</button></div>
    </form>
  </dialog>;
}
