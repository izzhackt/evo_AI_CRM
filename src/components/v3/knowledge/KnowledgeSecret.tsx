"use client";
import { useEffect, useRef, useState } from "react";
import type { KnowledgeItem } from "@/lib/knowledge-library-contract";
import { knowledgeFetch } from "./client";
import { KnowledgeExport } from "./KnowledgeExport";
import styles from "./KnowledgeLibrary.module.css";

type Fields = { service: string; url: string; login: string; purpose: string; note: string; value: string };
export function KnowledgeSecret({ item, parentId, onClose, onSaved }: {
  item?: KnowledgeItem; parentId: string | null; onClose: () => void; onSaved: (item: KnowledgeItem) => void;
}) {
  const [fields, setFields] = useState<Fields>({ service: item?.title ?? "", url: "", login: "", purpose: "", note: "", value: "" });
  const [value, setValue] = useState<string | null>(null); const [keepValue, setKeepValue] = useState(Boolean(item));
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [status, setStatus] = useState(""); const [version, setVersion] = useState(item?.version ?? 0);
  const id = useRef<string>(item?.id ?? ""); const request = useRef<{ id: string; fingerprint: string } | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await knowledgeFetch<{ available: boolean }>("secrets/status");
        if (!result.available) throw new Error("Хранилище доступов не подключено. Требуется ключ SOPS на сервере.");
        if (item) {
          const metadata = await knowledgeFetch<Omit<Fields, "value"> & { item: KnowledgeItem }>(`secrets/${item.id}`);
          if (active) { setFields({ service: metadata.service, url: metadata.url, login: metadata.login, purpose: metadata.purpose, note: metadata.note, value: "" }); setVersion(metadata.item.version); }
        }
        if (active) setReady(true);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Хранилище доступов недоступно."); }
    })();
    return () => { active = false; };
  }, [item]);
  useEffect(() => {
    if (value === null) return;
    const timer = setTimeout(() => setValue(null), 30_000); return () => clearTimeout(timer);
  }, [value]);
  async function reveal(copy: boolean) {
    setBusy(true); setError("");
    try {
      const result = await knowledgeFetch<{ value: string }>(`secrets/${id.current}/reveal`, { method: "POST" });
      if (copy) { await navigator.clipboard.writeText(result.value); setStatus("Скопировано"); }
      else { setValue(result.value); setStatus(""); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось открыть значение."); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setValue(null);
    if (!id.current) id.current = crypto.randomUUID();
    const fingerprint = JSON.stringify([fields, keepValue, version, parentId]);
    if (request.current?.fingerprint !== fingerprint) request.current = { id: crypto.randomUUID(), fingerprint };
    try {
      const saved = await knowledgeFetch<KnowledgeItem>("secrets", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id.current, parentId, expectedVersion: version, requestId: request.current.id, fields, keepValue }) });
      setVersion(saved.version); setKeepValue(true); setFields((current) => ({ ...current, value: "" })); request.current = null;
      setStatus("Сохранено"); onSaved(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить. Введённые данные остались в форме."); }
    finally { setBusy(false); }
  }
  return <section className={styles.editor}>
    <div className={styles.editorTop}><button type="button" onClick={() => { setValue(null); onClose(); }}>← К папке</button><h2 className="t-record-title">{item ? item.title : "Новый доступ"}</h2>{item && <KnowledgeExport ids={[item.id]} label="Выгрузить зашифрованную запись" />}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    <form onSubmit={save} className={styles.secretForm} autoComplete="off">
      {(["service", "url", "login", "purpose", "note"] as const).map((key) => <label key={key}>
        {({ service: "Сервис", url: "Адрес", login: "Логин", purpose: "Назначение", note: "Примечание" })[key]}
        <input name={key} type={key === "url" ? "url" : "text"} required={key === "service"} maxLength={key === "service" ? 240 : 4000} disabled={!ready || busy}
          value={fields[key]} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} />
      </label>)}
      {version > 0 && <div className={styles.actions}>
        <button type="button" disabled={!ready || busy} onClick={() => value === null ? void reveal(false) : setValue(null)}>{value === null ? "Показать" : "Скрыть"}</button>
        <button type="button" disabled={!ready || busy} onClick={() => void reveal(true)}>Копировать значение</button>
        {value !== null && <output className={styles.revealedValue}>{value}</output>}
      </div>}
      {version > 0 && <label className={styles.keepSecret}><input type="checkbox" checked={keepValue} onChange={(e) => setKeepValue(e.target.checked)} /> Сохранить текущее значение</label>}
      {!keepValue && <label>Секретное значение<textarea name="secretValue" autoComplete="off" spellCheck={false} maxLength={65_536} value={fields.value}
        disabled={!ready || busy} onChange={(event) => setFields((current) => ({ ...current, value: event.target.value }))} /></label>}
      <button type="submit" disabled={!ready || busy}>{busy ? "Сохранение…" : "Сохранить"}</button>
    </form>
  </section>;
}
