"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KnowledgeCanonicalSelection } from "@/lib/knowledge-canonical-export-contract";
import type { KnowledgeArea } from "@/lib/knowledge-library-contract";
import { knowledgeMessage } from "@/lib/knowledge-library-contract";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { knowledgeFetch } from "./client";
import { KB_CHECK, KB_CHECK_ROW, KB_DIALOG, KB_DIALOG_BODY, KB_DIALOG_HEAD, KB_ERROR, KB_QUIET, knowledgeMoment } from "./knowledge-look";

type ExportJob = {
  id: string; state: "queued" | "running" | "ready" | "failed" | "expired";
  entry_count: number; completed_entries: number; written_bytes: number;
  created_at: string; expires_at: string; lease_until: string | null; error_code: string | null; error_title?: string | null;
};
/**
 * Выгрузка ZIP. Своя кнопка — как раньше (FileManager, выбор строк, досье);
 * с `open` окно управляется снаружи и кнопки нет (пункты «⋯» «Базы знаний»).
 */
export function KnowledgeExport({ ids, area, caseIds, canonical, buttonClassName, label = "Выгрузить", open: openProp, onOpenChange }: {
  ids?: string[]; area?: KnowledgeArea; caseIds?: string[]; canonical?: KnowledgeCanonicalSelection; buttonClassName?: string; label?: string;
  /** Управляемое окно: без своей кнопки, закрытие — через `onOpenChange(false)`. */
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [now, setNow] = useState(0);
  const controlled = openProp !== undefined;
  const [ownOpen, setOwnOpen] = useState(false); const [jobs, setJobs] = useState<ExportJob[]>([]);
  const open = controlled ? openProp : ownOpen;
  const setOpen = useCallback((next: boolean) => { if (controlled) onOpenChange?.(next); else setOwnOpen(next); }, [controlled, onOpenChange]);
  const titleId = useId();
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [history, setHistory] = useState(false); const [archive, setArchive] = useState(false); const [trash, setTrash] = useState(false);
  const request = useRef<{ id: string; fingerprint: string } | null>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(async () => {
    try { setJobs(await knowledgeFetch<ExportJob[]>("exports")); setNow(Date.now()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось получить выгрузки."); }
  }, []);
  useEffect(() => {
    if (open) {
      modal.current?.showModal();
      void knowledgeFetch<ExportJob[]>("exports").then((data) => { setJobs(data); setNow(Date.now()); }).catch((cause) => setError(cause.message));
    } else modal.current?.close();
  }, [open]);
  useEffect(() => {
    if (!open || !jobs.some((j) => j.state === "queued" || j.state === "running")) return;
    const timer = setInterval(() => void refresh(), 4000); return () => clearInterval(timer);
  }, [open, jobs, refresh]);
  async function start() {
    setBusy(true); setError("");
    const options = { ids, area, caseIds, canonical, includeHistory: history, includeArchive: archive, includeTrash: trash };
    const fingerprint = JSON.stringify(options);
    if (request.current?.fingerprint !== fingerprint) request.current = { id: crypto.randomUUID(), fingerprint };
    try {
      await knowledgeFetch("exports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: request.current.id, options }) });
      request.current = null; await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Выгрузка не запущена."); }
    finally { setBusy(false); }
  }
  async function retry(id: string) {
    setBusy(true); setError("");
    try { await knowledgeFetch(`exports/${id}/retry`, { method: "POST" }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Выгрузка не запущена."); }
    finally { setBusy(false); }
  }
  return <>
    {controlled ? null : <button type="button" aria-haspopup="dialog" className={buttonClassName ?? QUEUE_SECONDARY} onClick={() => setOpen(true)}>{label}</button>}
    <dialog ref={modal} aria-labelledby={titleId} className={KB_DIALOG} onCancel={() => setOpen(false)} onClose={() => { if (open) setOpen(false); }} data-testid="knowledge-export-dialog">
      {open ? <div className="flex max-h-[85dvh] flex-col">
        <div className={KB_DIALOG_HEAD}>
          <h2 id={titleId} className="t-section">{label}</h2>
          <button type="button" className={QUEUE_SECONDARY} onClick={() => setOpen(false)}>Закрыть</button>
        </div>
        <div className={KB_DIALOG_BODY}>
          <fieldset>
            <legend className="t-label text-fg-2">Включить в ZIP</legend>
            <label className={KB_CHECK_ROW}><input type="checkbox" className={KB_CHECK} checked={archive} onChange={(e) => setArchive(e.target.checked)} />Архивные материалы</label>
            <label className={KB_CHECK_ROW}><input type="checkbox" className={KB_CHECK} checked={history} onChange={(e) => setHistory(e.target.checked)} />История версий</label>
            <label className={KB_CHECK_ROW}><input type="checkbox" className={KB_CHECK} checked={trash} onChange={(e) => setTrash(e.target.checked)} />Корзина</label>
          </fieldset>
          <p className="t-body-compact text-fg-2">ZIP с файлами и страницами Markdown. Готовая выгрузка доступна вам в течение 24 часов.</p>
          {error && <p className={KB_ERROR} role="alert">{error}</p>}
          <div><button type="button" className={QUEUE_CONFIRM} disabled={busy} onClick={() => void start()}>Подготовить ZIP</button></div>
          {jobs.length > 0 && <section aria-labelledby={`${titleId}-jobs`} className="space-y-1">
            <h3 id={`${titleId}-jobs`} className="t-item">Мои выгрузки</h3>
            <ul className="divide-y divide-border border-y border-border" data-testid="knowledge-export-jobs">{jobs.map((job) => {
              const expired = Date.parse(job.expires_at) <= now;
              const interrupted = job.state === "running" && job.lease_until && Date.parse(job.lease_until) < now;
              const created = now ? knowledgeMoment(job.created_at, new Date(now)) : null;
              return <li key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 t-body-compact">
                {created ? <time dateTime={job.created_at} className="font-mono tabular-nums text-fg-2">{created}</time> : null}
                {expired ? <span className="text-fg-2">Срок хранения истёк</span> : job.state === "ready"
                  ? <a href={`/api/v3/knowledge/exports/${job.id}/download`} className={KB_QUIET}>Скачать ZIP · {(job.written_bytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ</a>
                  : job.state === "failed" || interrupted || (job.state === "queued" && now - Date.parse(job.created_at) > 30_000) ? <><span role="status" className="min-w-0 flex-1 text-danger">{job.error_title ? `Не удалось выгрузить «${job.error_title}». ` : ""}{job.error_code ? knowledgeMessage(job.error_code) : "Подготовка прервана."} Архив не готов.</span><button className={QUEUE_SECONDARY} disabled={busy} type="button" onClick={() => void retry(job.id)}>Повторить</button></>
                    : <span role="status" className="text-fg-2">{job.state === "queued" ? "Ожидает подготовки" : `Подготовка · ${job.completed_entries} из ${job.entry_count} материалов · записано ${(job.written_bytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`}</span>}
              </li>;
            })}</ul>
          </section>}
        </div>
      </div> : null}
    </dialog>
  </>;
}
