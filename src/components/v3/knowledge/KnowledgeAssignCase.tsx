"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { KnowledgeItem } from "@/lib/knowledge-library-contract";
import type { PlatformStudentCaseQueueRow } from "@/lib/platform-admissions";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { command, knowledgeFetch } from "./client";
import { KB_CHECK, KB_CHECK_ROW, KB_DIALOG, KB_DIALOG_BODY, KB_DIALOG_HEAD, KB_ERROR, KB_FIELD, KB_LABEL, KB_QUIET, knowledgeDay } from "./knowledge-look";

type Directory = { items: PlatformStudentCaseQueueRow[]; hasMore: boolean; nextCursor: { sortAt: string; id: string } | null };
export function KnowledgeAssignCase({ items, folders, onClose, onSaved }: { items: KnowledgeItem[]; folders: KnowledgeItem[]; onClose: () => void; onSaved: () => void }) {
  const modal = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState(""); const [directory, setDirectory] = useState<Directory | null>(null);
  const [selected, setSelected] = useState<PlatformStudentCaseQueueRow | null>(null);
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [done, setDone] = useState(new Set<string>());
  const [loadedAt, setLoadedAt] = useState<Date | null>(null); const titleId = useId();
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
        .then((value) => { setDirectory(value); setLoadedAt(new Date()); }).catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
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
  const cancel = () => { if (done.size) onSaved(); onClose(); };
  return <dialog ref={modal} aria-labelledby={titleId} className={KB_DIALOG} data-testid="knowledge-assign-dialog" onCancel={(event) => { if (busy) event.preventDefault(); else cancel(); }}>
    <form onSubmit={save} className="flex max-h-[85dvh] flex-col">
      <div className={KB_DIALOG_HEAD}><h2 id={titleId} className="t-section">Привязать к делу</h2></div>
      <div className={KB_DIALOG_BODY}>
        <p className="t-body-compact text-fg-2">Выбрано материалов: {items.length}. Вложенные материалы папок перейдут в то же дело.</p>
        <label className={KB_LABEL}>Найти клиента<input type="search" value={search} disabled={busy || done.size > 0} className={KB_FIELD} onChange={(event) => { setSearch(event.target.value); setSelected(null); setConfirmed(false); }} /></label>
        {directory?.items.length ? <ul className="divide-y divide-border border-y border-border">{directory.items.map((item) => {
          const created = loadedAt ? knowledgeDay(item.createdAt, loadedAt) : null;
          return <li key={item.studentCaseId}>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 t-body-compact">
              <input type="radio" name="case" className={`${KB_CHECK} mt-0.5`} checked={selected?.studentCaseId === item.studentCaseId} disabled={busy || done.size > 0}
                onChange={() => { setSelected(item); setConfirmed(false); }} />
              <span className="min-w-0">
                <span className="block text-fg [overflow-wrap:anywhere]">{item.studentDisplayName} · {item.targetCountry ?? "Страна не указана"} · {item.intake ?? "Набор не указан"}</span>
                <span className="block t-meta text-fg-3 [overflow-wrap:anywhere]">Дело <span className="font-mono">{item.studentCaseId}</span>{created ? <> · создано <span className="font-mono">{created}</span></> : null}</span>
              </span>
            </label>
          </li>;
        })}</ul> : null}
        {directory?.hasMore && <button type="button" className={KB_QUIET} disabled={busy} onClick={() => void more()}>Показать ещё дела</button>}
        {directory && !directory.items.length && <p className="t-body-compact text-fg-2">Дела не найдены.</p>}
        {selected && <label className={KB_CHECK_ROW}><input type="checkbox" className={KB_CHECK} checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />Принадлежность материалов этому делу проверена.</label>}
        {error && <p role="alert" className={KB_ERROR}>{error}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">
        <button type="button" className={QUEUE_SECONDARY} disabled={busy} onClick={cancel}>Отмена</button>
        <button type="submit" className={QUEUE_CONFIRM} disabled={busy || !selected || !confirmed}>{busy ? "Сохраняется…" : "Привязать"}</button>
      </div>
    </form>
  </dialog>;
}
