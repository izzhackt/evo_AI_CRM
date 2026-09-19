"use client";
import { useRef, useState } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { KNOWLEDGE_SHA256, KNOWLEDGE_UUID, type KnowledgeItem } from "@/lib/knowledge-library-contract";
import { command, knowledgeFetch, knowledgeSourceKey } from "./client";
import styles from "./KnowledgeLibrary.module.css";
type Entry = { id: string; kind: "file" | "record"; file: string; folders: string[]; cipherSha256: string; cipherBytes: number };
type Plan = { version: 1; format: "evo-protected-import-v1"; entries: Entry[] };
export function KnowledgeProtectedImport({ onChanged }: { onChanged: () => void }) {
  const [files, setFiles] = useState<Map<string, File>>(new Map()); const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const stop = useRef(false); const folders = useRef(new Map<string, string>());
  async function choose(selected: File[]) {
    setError(""); setPlan(null); setStatus("");
    try {
      const map = new Map(selected.map((file) => [file.webkitRelativePath.split("/").slice(1).join("/"), file]));
      const manifest = map.get("План защищённого переноса.json");
      if (!manifest || manifest.size > 2 * 1024 * 1024) throw new Error("В папке нет плана защищённого переноса.");
      const value = JSON.parse(await manifest.text()) as Plan;
      if (value.version !== 1 || value.format !== "evo-protected-import-v1" || !Array.isArray(value.entries)
        || value.entries.some((e) => !KNOWLEDGE_UUID.test(e.id) || !KNOWLEDGE_SHA256.test(e.cipherSha256) || !["file", "record"].includes(e.kind)
          || !e.file.endsWith(".enc.json") || e.file.includes("/") || !Array.isArray(e.folders))) throw new Error("План защищённого переноса не распознан.");
      setFiles(map); setPlan(value); folders.current.clear();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось прочитать план."); }
  }
  async function run() {
    if (!plan) return;
    setBusy(true); setError(""); stop.current = false; let done = 0;
    try {
      for (const entry of plan.entries) {
        if (stop.current) break;
        const file = files.get(entry.file);
        if (!file || file.size !== entry.cipherBytes || file.size > 40 * 1024 * 1024) throw new Error("Зашифрованный исходник отсутствует или изменён.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytesToHex(sha256(bytes)) !== entry.cipherSha256) throw new Error("Контрольная сумма зашифрованного исходника не совпала.");
        let parentId: string | null = null;
        for (const name of entry.folders) {
          const key = knowledgeSourceKey(["protected-folder", parentId, name]);
          if (!folders.current.has(key)) {
            const item: KnowledgeItem = await command({ op: "create", area: "secrets", kind: "folder", title: name, parentId, sourceKey: key });
            if (item.archived_at || item.deleted_at) throw new Error("Папка доступа находится в архиве или корзине.");
            folders.current.set(key, item.id);
          }
          parentId = folders.current.get(key)!;
        }
        await knowledgeFetch("secrets/import", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: entry.id, parentId, ciphertext: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }) });
        done++; setStatus(`Проверено ${done} из ${plan.entries.length}`);
      }
      setStatus(`${stop.current ? "Остановлено" : "Защищённый перенос завершён"}: ${done} из ${plan.entries.length}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Защищённый перенос не выполнен."); }
    finally { setBusy(false); onChanged(); }
  }
  return <details className={styles.importPanel}><summary>Защищённые источники и доступы</summary><div className={styles.importBody}>
    <p>Выберите подготовленную папку с зашифрованными источниками. Ключ в CRM не загружается.</p>
    <label>Папка защищённого переноса<input type="file" multiple {...{ webkitdirectory: "" }} disabled={busy} onChange={(event) => void choose(Array.from(event.target.files ?? []))} /></label>
    {plan && <p>Источников: {plan.entries.filter((e) => e.kind === "file").length}. Записей доступа: {plan.entries.filter((e) => e.kind === "record").length}.</p>}
    <div className={styles.actions}><button type="button" disabled={busy || !plan} onClick={() => void run()}>Начать / продолжить</button>{busy && <button type="button" onClick={() => { stop.current = true; }}>Остановить после записи</button>}</div>
    {status && <p role="status">{status}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
  </div></details>;
}
