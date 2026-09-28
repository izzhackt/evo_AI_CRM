"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { KnowledgeCanonicalPage } from "@/lib/knowledge-canonical-search-contract";
import { SkeletonBlock } from "@/components/ui";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";
import { knowledgeFetch } from "./client";
import { KB_ERROR, KB_QUIET } from "./knowledge-look";

export function KnowledgeCanonicalSearch({ search, onOpen }: { search: string; onOpen: () => void }) {
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
  return <section className="space-y-2 pb-2" aria-label="Материалы CRM" aria-busy={busy} data-testid="knowledge-canonical-search">
    <h2 className="t-section">Материалы CRM</h2>
    {error && <p role="alert" className={KB_ERROR}>{error}<button type="button" className={QUEUE_SECONDARY} onClick={() => setRetry((value) => value + 1)}>Повторить поиск</button></p>}
    {page?.items.length ? <ul className="divide-y divide-border border-y border-border">{page.items.map((item) => <li key={`${item.kind}:${item.id}`} className="grid gap-x-3 py-1 @xl/kbl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] @xl/kbl:items-center">
      <Link href={item.href} onClick={onOpen} className="flex min-h-11 items-center t-item text-fg underline-offset-4 hover:underline [overflow-wrap:anywhere]">{item.title}</Link>
      <span className="t-body-compact text-fg-2">{item.context}</span>
      {item.downloadHref ? <a href={item.downloadHref} className={KB_QUIET}>Скачать исходник</a> : <span />}
    </li>)}</ul> : null}
    {busy && !page?.items.length ? <><p role="status" className="sr-only">Ищем в материалах CRM…</p><ul aria-hidden="true" className="divide-y divide-border border-y border-border">{[0, 1, 2].map((index) => <li key={index} className="flex min-h-11 items-center py-2"><SkeletonBlock className={`h-3.5 rounded-nav ${index % 2 ? "w-1/3" : "w-1/2"}`} /></li>)}</ul></> : null}
    {!busy && !error && page?.items.length === 0 && <p className="t-body-compact text-fg-2">В материалах CRM ничего не найдено.</p>}
    {page?.hasMore && <button type="button" className={KB_QUIET} disabled={busy} onClick={() => void more()}>{busy ? "Загружаем…" : "Показать ещё материалы CRM"}</button>}
  </section>;
}
