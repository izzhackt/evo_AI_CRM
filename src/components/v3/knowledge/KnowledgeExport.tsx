"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeCanonicalSelection } from "@/lib/knowledge-canonical-export-contract";
import type { KnowledgeArea } from "@/lib/knowledge-library-contract";
import { knowledgeMessage } from "@/lib/knowledge-library-contract";
import { knowledgeFetch } from "./client";
import styles from "./KnowledgeLibrary.module.css";

type ExportJob = {
  id: string; state: "queued" | "running" | "ready" | "failed" | "expired";
  entry_count: number; completed_entries: number; written_bytes: number;
  created_at: string; expires_at: string; lease_until: string | null; error_code: string | null; error_title?: string | null;
};
export function KnowledgeExport({ ids, area, caseIds, canonical, buttonClassName, label = "Выгрузить" }: { ids?: string[]; area?: KnowledgeArea; caseIds?: string[]; canonical?: KnowledgeCanonicalSelection; buttonClassName?: string; label?: string }) {
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false); const [jobs, setJobs] = useState<ExportJob[]>([]);
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
    <button type="button" className={buttonClassName} onClick={() => setOpen(true)}>{label}</button>
    <dialog ref={modal} className={styles.modal} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <h2 className="t-section">{label}</h2>
      <div className={styles.exportOptions}>
        <label><input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} /> Архивные материалы</label>
        <label><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> История версий</label>
        <label><input type="checkbox" checked={trash} onChange={(e) => setTrash(e.target.checked)} /> Корзина</label>
      </div>
      <p>ZIP с файлами и страницами Markdown. Готовая выгрузка доступна вам в течение 24 часов.</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void start()}>Подготовить ZIP</button><button type="button" onClick={() => setOpen(false)}>Закрыть</button></div>
      {jobs.length > 0 && <h3 className="t-item">Мои выгрузки</h3>}
      <ul className={styles.exportJobs}>{jobs.map((job) => {
        const expired = Date.parse(job.expires_at) <= now;
        const interrupted = job.state === "running" && job.lease_until && Date.parse(job.lease_until) < now;
        return <li key={job.id}>
          <span>{new Date(job.created_at).toLocaleString("ru-RU")}</span>
          {expired ? <span>Срок хранения истёк</span> : job.state === "ready"
            ? <a href={`/api/v3/knowledge/exports/${job.id}/download`}>Скачать ZIP · {(job.written_bytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ</a>
            : job.state === "failed" || interrupted || (job.state === "queued" && now - Date.parse(job.created_at) > 30_000) ? <><span role="status">{job.error_title ? `Не удалось выгрузить «${job.error_title}». ` : ""}{job.error_code ? knowledgeMessage(job.error_code) : "Подготовка прервана."} Архив не готов.</span><button disabled={busy} type="button" onClick={() => void retry(job.id)}>Повторить</button></>
              : <span role="status">{job.state === "queued" ? "Ожидает подготовки" : `Подготовка · ${job.completed_entries} из ${job.entry_count} материалов · записано ${(job.written_bytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`}</span>}
        </li>;
      })}</ul>
    </dialog>
  </>;
}
