"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { KnowledgeCanonicalPage } from "@/lib/knowledge-canonical-search-contract";
import { knowledgeFetch } from "./client";
import styles from "./KnowledgeLibrary.module.css";

export function KnowledgeCanonicalSearch({ search }: { search: string }) {
  const [page, setPage] = useState<KnowledgeCanonicalPage | null>(null);
  const [busy, setBusy] = useState(true); const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true); setError("");
      void knowledgeFetch<KnowledgeCanonicalPage>(`search-canonical?${new URLSearchParams({ search })}`, { signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) setPage(result); })
        .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, retry]);
  async function more() {
    if (!page?.nextCursor || busy) return;
    setBusy(true); setError("");
    try {
      const before = page.nextCursor;
      const next = await knowledgeFetch<KnowledgeCanonicalPage>(`search-canonical?${new URLSearchParams({ search, afterTitle: before.title, afterKind: before.kind, afterId: before.id })}`);
      if (next.hasMore && (!next.nextCursor || JSON.stringify(next.nextCursor) === JSON.stringify(before))) throw new Error("Не удалось загрузить продолжение.");
      setPage({ ...next, items: [...page.items, ...next.items] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить продолжение."); }
    finally { setBusy(false); }
  }
  return <section className={styles.dossiers} aria-label="Материалы CRM" aria-busy={busy}>
    <h2>Материалы CRM</h2>
    {error && <p role="alert" className={styles.error}>{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Повторить поиск</button></p>}
    <ul className={styles.clientList}>{page?.items.map((item) => <li key={`${item.kind}:${item.id}`}>
      <Link href={item.href}>{item.title}</Link>
      <span>{item.context}</span>
      {item.downloadHref && <a href={item.downloadHref}>Скачать исходник</a>}
    </li>)}</ul>
    {busy && <p role="status">Поиск…</p>}
    {!busy && !error && page?.items.length === 0 && <p>В материалах CRM ничего не найдено.</p>}
    {page?.hasMore && <button type="button" disabled={busy} onClick={() => void more()}>Показать ещё материалы CRM</button>}
  </section>;
}
