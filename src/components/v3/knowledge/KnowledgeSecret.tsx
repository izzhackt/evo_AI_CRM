"use client";
import { useEffect, useRef, useState } from "react";
import type { KnowledgeItem } from "@/lib/knowledge-library-contract";
import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";
import { knowledgeFetch } from "./client";
import { KnowledgeExport } from "./KnowledgeExport";
import { KB_CHECK, KB_CHECK_ROW, KB_ERROR, KB_FIELD, KB_LABEL, KB_QUIET } from "./knowledge-look";

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
  // Облик Э8.10: значение — только по явному «Показать» и снова скрыто через 30 секунд; запись — прежняя.
  return <section className="p-4 @3xl/kb:p-5" aria-labelledby="knowledge-secret-title" data-testid="knowledge-secret">
    <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
      <button type="button" className={KB_QUIET} onClick={() => { setValue(null); onClose(); }}><Icon name="arrow-left" size={16} />К папке</button>
      <span className="me-auto" />
      {item && <KnowledgeExport ids={[item.id]} label="Выгрузить зашифрованную запись" />}
    </div>
    <div className="mx-auto mt-5 max-w-[45rem] space-y-4">
      <h2 id="knowledge-secret-title" className="flex items-center gap-2 t-record-title [overflow-wrap:anywhere]"><Icon name="lock" size={20} className="shrink-0 text-fg-3" />{item ? item.title : "Новый доступ"}</h2>
      {error && <p className={KB_ERROR} role="alert">{error}</p>}
      {status && <p role="status" className="t-body-compact text-fg-2">{status}</p>}
      <form onSubmit={save} className="grid gap-4" autoComplete="off">
        {(["service", "url", "login", "purpose", "note"] as const).map((key) => <label key={key} className={KB_LABEL}>
          {({ service: "Сервис", url: "Адрес", login: "Логин", purpose: "Назначение", note: "Примечание" })[key]}
          <input name={key} type={key === "url" ? "url" : "text"} required={key === "service"} maxLength={key === "service" ? 240 : 4000} disabled={!ready || busy} className={KB_FIELD}
            value={fields[key]} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} />
        </label>)}
        {version > 0 && <div className="grid gap-2 border-y border-border py-3">
          <span className="t-label text-fg-2">Текущее значение</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={QUEUE_SECONDARY} disabled={!ready || busy} onClick={() => value === null ? void reveal(false) : setValue(null)}>{value === null ? "Показать" : "Скрыть"}</button>
            <button type="button" className={QUEUE_SECONDARY} disabled={!ready || busy} onClick={() => void reveal(true)}>Копировать значение</button>
          </div>
          {value !== null && <output className="block select-all rounded-ctl border border-border bg-bg p-3 t-body-compact [overflow-wrap:anywhere]"><span className="font-mono">{value}</span></output>}
        </div>}
        {version > 0 && <label className={KB_CHECK_ROW}><input type="checkbox" className={KB_CHECK} checked={keepValue} onChange={(e) => setKeepValue(e.target.checked)} />Сохранить текущее значение</label>}
        {!keepValue && <label className={KB_LABEL}>Секретное значение<textarea name="secretValue" autoComplete="off" spellCheck={false} maxLength={65_536} value={fields.value}
          disabled={!ready || busy} className="block min-h-28 w-full resize-y rounded-ctl border border-control-edge bg-surface p-3 t-body text-fg focus-visible:border-accent disabled:bg-surface-2" onChange={(event) => setFields((current) => ({ ...current, value: event.target.value }))} /></label>}
        <div><button type="submit" className={btnCls} disabled={!ready || busy}>{busy ? "Сохранение…" : "Сохранить"}</button></div>
      </form>
    </div>
  </section>;
}
