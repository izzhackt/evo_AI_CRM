"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { KnowledgeImportPlan } from "@/lib/knowledge-import-contract";
import { KNOWLEDGE_SHA256 } from "@/lib/knowledge-library-contract";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { KnowledgeProtectedImport } from "./KnowledgeProtectedImport";
import { reconcileKnowledgeImport } from "./reconcile";
import { prepareKnowledgeStructure } from "./import-structure";
import { importKnowledgeFile } from "./import";
import { KB_DIALOG, KB_DIALOG_BODY, KB_DIALOG_HEAD, KB_ERROR, KB_FIELD, KB_FILE, KB_LABEL } from "./knowledge-look";

/**
 * «Перенос локальной базы» — окно из «⋯» (Э8.10). Поля стоят столбиком (на
 * телефоне поле файла не растягивает страницу). Компонент смонтирован всё
 * время: закрытое окно не останавливает идущий перенос, а открытое снова
 * показывает его ход.
 */
export function KnowledgeImport({ open, onClose, onChanged, onRunningChange }: { open: boolean; onClose: () => void; onChanged: () => void; onRunningChange?: (running: boolean) => void }) {
  const [plan, setPlan] = useState<KnowledgeImportPlan | null>(null); const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [running, setRunningState] = useState(false); const [status, setStatus] = useState("");
  const [error, setError] = useState(""); const [failures, setFailures] = useState<{ path: string; reason: string }[]>([]);
  const stop = useRef(false); const folders = useRef(new Map<string, string>());
  const [limit, setLimit] = useState("1");
  const modal = useRef<HTMLDialogElement>(null); const titleId = useId();
  // «⋯» пишет «· идёт», пока идёт любой из двух переносов — обычный или защищённый.
  // Флаги — в ref: оба переноса async и не должны читать устаревшее состояние соседа.
  const active = useRef({ normal: false, protected: false });
  function report() { onRunningChange?.(active.current.normal || active.current.protected); }
  function setRunning(value: boolean) { setRunningState(value); active.current.normal = value; report(); }
  function setProtectedRunning(value: boolean) { active.current.protected = value; report(); }
  useEffect(() => { if (open) modal.current?.showModal(); else modal.current?.close(); }, [open]);
  async function readPlan(file?: File) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error("План слишком большой.");
      const value = JSON.parse(await file.text()) as KnowledgeImportPlan;
      if (value.version !== 1 || !KNOWLEDGE_SHA256.test(value.inventorySha256) || !Array.isArray(value.entries)
        || value.entries.some((entry) => !entry.relativePath || entry.relativePath.startsWith("/") || entry.relativePath.split("/").includes("..")
          || !["import", "protected_import", "retain_outside_crm"].includes(entry.action))) throw new Error("Формат плана переноса не распознан.");
      setPlan(value); setFailures([]); setStatus(""); folders.current.clear();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "План не прочитан."); }
  }
  async function run() {
    if (!plan) return;
    const importPlan = plan;
    setRunning(true); stop.current = false; setFailures([]); setError("");
    try { await prepareKnowledgeStructure(folders.current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось подготовить папки."); setRunning(false); return; }
    let done = 0; let reused = 0; let failed = 0;
    const normal = plan.entries.filter((entry) => entry.action === "import");
    const max = limit === "all" ? normal.length : Math.max(1, Number(limit));
    const batch = normal.slice(0, max); let cursor = 0;
    // Different files can use the network concurrently; identical blobs take turns.
    const blobTurns = new Map<string, Promise<void>>();
    async function worker() {
      while (!stop.current && cursor < batch.length) {
        const entry = batch[cursor++];
        const key = JSON.stringify([entry.area, entry.sha256, entry.bytes]);
        const previous = blobTurns.get(key) ?? Promise.resolve();
        let release!: () => void;
        const turn = new Promise<void>((resolve) => { release = resolve; });
        const tail = previous.then(() => turn); blobTurns.set(key, tail);
        await previous;
        try {
          if (stop.current) return;
          const file = files.get(entry.relativePath);
          if (!file) throw new Error("Исходник отсутствует в выбранной папке.");
          const result = await importKnowledgeFile(file, entry, importPlan.inventorySha256, folders.current, importPlan.entries,
            (bytes) => setStatus(`${done} из ${max} · ${entry.title} · ${entry.bytes ? Math.round(bytes / entry.bytes * 100) : 100}%`));
          if (result.reused) reused++;
          done++; setStatus(`Проверено ${done} из ${max}, ранее перенесено ${reused}`);
        } catch (cause) {
          failed++;
          setFailures((current) => [...current, { path: entry.relativePath, reason: cause instanceof Error ? cause.message : "Перенос не выполнен." }]);
          if (failed >= 3) stop.current = true;
        } finally {
          release(); if (blobTurns.get(key) === tail) blobTurns.delete(key);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, batch.length) }, () => worker()));
    setStatus(`${stop.current ? "Перенос остановлен" : done === normal.length && !failed ? "Обычные материалы перенесены" : "Контрольная партия завершена"}: ${done}, ошибок: ${failed}. Защищённые источники и ключи учитываются отдельно.`);
    setRunning(false); onChanged();
  }
  async function reconcile() {
    if (!plan) return;
    setRunning(true); setError("");
    try {
      const report = await reconcileKnowledgeImport(plan, (done) => setStatus(`Сверено ${done} источников`));
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "Сверка переноса.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(`Проверено: ${report.verified}. Отсутствуют: ${report.missing}. Не совпали: ${report.mismatched}. Ключи вне CRM: ${report.retainedOutside.length}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Сверка не завершена."); }
    finally { setRunning(false); }
  }
  return <dialog ref={modal} aria-labelledby={titleId} className={KB_DIALOG} onClose={onClose} data-testid="knowledge-import-dialog">
    <div className="flex max-h-[85dvh] flex-col">
      <div className={KB_DIALOG_HEAD}>
        <h2 id={titleId} className="t-section">Перенос локальной базы</h2>
        <button type="button" className={QUEUE_SECONDARY} onClick={onClose}>Закрыть</button>
      </div>
      <div className={KB_DIALOG_BODY}>
        <label className={KB_LABEL}>План размещения<input type="file" accept="application/json,.json" disabled={running} className={KB_FILE} onChange={(event) => void readPlan(event.target.files?.[0])} /></label>
        <label className={KB_LABEL}>Исходная папка базы<input type="file" multiple {...{ webkitdirectory: "" }} disabled={running} className={KB_FILE} onChange={(event) => {
          const map = new Map<string, File>();
          for (const file of Array.from(event.target.files ?? [])) map.set(file.webkitRelativePath.split("/").slice(1).join("/"), file);
          setFiles(map);
        }} /></label>
        {plan && <p className="t-body-compact text-fg-2">В плане {plan.entries.length} записей. Защищённых источников: {plan.entries.filter((e) => e.action === "protected_import").length}. Ключи остаются вне CRM: {plan.entries.filter((e) => e.action === "retain_outside_crm").length}.</p>}
        <label className={KB_LABEL}>Объём переноса<select disabled={running} value={limit} onChange={(e) => setLimit(e.target.value)} className={KB_FIELD}><option value="1">Первый файл</option><option value="10">Первые 10 файлов</option><option value="all">Все обычные материалы</option></select></label>
        <div className="flex flex-wrap gap-2"><button type="button" className={QUEUE_CONFIRM} disabled={running || !plan || !files.size} onClick={() => void run()}>Начать / продолжить</button>{running && <button type="button" className={QUEUE_SECONDARY} onClick={() => { stop.current = true; }}>Остановить после текущих файлов</button>}</div>
        {status && <p role="status" className="t-body-compact text-fg-2">{status}</p>}{error && <p className={KB_ERROR} role="alert">{error}</p>}
        <button type="button" className={QUEUE_SECONDARY} disabled={running || !plan} onClick={() => void reconcile()}>Сверить все источники</button>
        {failures.length > 0 && <ul className="space-y-1 border-y border-border py-2 t-body-compact text-danger" aria-label="Не перенесено">{failures.map((failure) => <li key={failure.path} className="[overflow-wrap:anywhere]">{failure.path}: {failure.reason}</li>)}</ul>}
        <KnowledgeProtectedImport onChanged={onChanged} onRunningChange={setProtectedRunning} />
      </div>
    </div>
  </dialog>;
}
