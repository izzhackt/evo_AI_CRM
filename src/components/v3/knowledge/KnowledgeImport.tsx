"use client";
import { useRef, useState } from "react";
import type { KnowledgeImportPlan } from "@/lib/knowledge-import-contract";
import { KNOWLEDGE_SHA256 } from "@/lib/knowledge-library-contract";
import { KnowledgeProtectedImport } from "./KnowledgeProtectedImport";
import { reconcileKnowledgeImport } from "./reconcile";
import { prepareKnowledgeStructure } from "./import-structure";
import { importKnowledgeFile } from "./import";
import styles from "./KnowledgeLibrary.module.css";
export function KnowledgeImport({ onChanged }: { onChanged: () => void }) {
  const [plan, setPlan] = useState<KnowledgeImportPlan | null>(null); const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [running, setRunning] = useState(false); const [status, setStatus] = useState("");
  const [error, setError] = useState(""); const [failures, setFailures] = useState<{ path: string; reason: string }[]>([]);
  const stop = useRef(false); const folders = useRef(new Map<string, string>());
  const [limit, setLimit] = useState("1");
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
    setRunning(true); stop.current = false; setFailures([]); setError("");
    try { await prepareKnowledgeStructure(folders.current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось подготовить папки."); setRunning(false); return; }
    let done = 0; let reused = 0; let failed = 0;
    const normal = plan.entries.filter((entry) => entry.action === "import");
    const max = limit === "all" ? normal.length : Math.max(1, Number(limit));
    for (const entry of normal.slice(0, max)) {
      if (stop.current) break;
      try {
        const file = files.get(entry.relativePath);
        if (!file) throw new Error("Исходник отсутствует в выбранной папке.");
        const result = await importKnowledgeFile(file, entry, plan.inventorySha256, folders.current, plan.entries,
          (bytes) => setStatus(`${done} из ${max} · ${entry.title} · ${entry.bytes ? Math.round(bytes / entry.bytes * 100) : 100}%`));
        if (result.reused) reused++;
        done++; setStatus(`Проверено ${done} из ${max}, ранее перенесено ${reused}`);
      } catch (cause) {
        failed++;
        setFailures((current) => [...current, { path: entry.relativePath, reason: cause instanceof Error ? cause.message : "Перенос не выполнен." }]);
        // Connection/auth failures should not repeat thousands of failing requests.
        if (failed >= 3) { stop.current = true; break; }
      }
    }
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
  return <details className={styles.importPanel}><summary>Перенос локальной базы</summary>
    <div className={styles.exportOptions}>
      <label>План размещения<input type="file" accept="application/json,.json" disabled={running} onChange={(event) => void readPlan(event.target.files?.[0])} /></label>
      <label>Исходная папка базы<input type="file" multiple {...{ webkitdirectory: "" }} disabled={running} onChange={(event) => {
        const map = new Map<string, File>();
        for (const file of Array.from(event.target.files ?? [])) map.set(file.webkitRelativePath.split("/").slice(1).join("/"), file);
        setFiles(map);
      }} /></label>
      {plan && <p>В плане {plan.entries.length} записей. Защищённых источников: {plan.entries.filter((e) => e.action === "protected_import").length}. Ключи остаются вне CRM: {plan.entries.filter((e) => e.action === "retain_outside_crm").length}.</p>}
      <label>Объём переноса<select disabled={running} value={limit} onChange={(e) => setLimit(e.target.value)}><option value="1">Первый файл</option><option value="10">Первые 10 файлов</option><option value="all">Все обычные материалы</option></select></label>
      <div className={styles.actions}><button type="button" disabled={running || !plan || !files.size} onClick={() => void run()}>Начать / продолжить</button>{running && <button type="button" onClick={() => { stop.current = true; }}>Остановить после файла</button>}</div>
      {status && <p role="status">{status}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
      <button type="button" disabled={running || !plan} onClick={() => void reconcile()}>Сверить все источники</button>
      <KnowledgeProtectedImport onChanged={onChanged} />
      {failures.length > 0 && <ul className={styles.error}>{failures.map((failure) => <li key={failure.path}>{failure.path}: {failure.reason}</li>)}</ul>}
    </div>
  </details>;
}
