"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { KNOWLEDGE_AREAS, type KnowledgeArea, type KnowledgeItem, type KnowledgePage, type KnowledgeQuery } from "@/lib/knowledge-library-contract";

import { knowledgeFetch } from "../client";
import type { KnowledgeView } from "../KnowledgeTree";
import type { KnowledgeHref } from "./library-model";

/**
 * Чтение «Базы знаний» для нового вида: адрес (`area`, `folder`, `item`, `view`) и то же чтение `/api/v3/knowledge/list`, что у
 * прежней `KnowledgeLibrary` (поиск с задержкой 250 мс, «Показать ещё» по курсору, все папки для дерева, открытый материал).
 * Здесь только чтение; команды — `useKnowledgeActions`.
 */
export function useKnowledgeData() {
  const params = useSearchParams();
  const area = (KNOWLEDGE_AREAS.includes(params.get("area") as KnowledgeArea) ? params.get("area") : "internal") as KnowledgeArea;
  const parentId = params.get("folder");
  const itemId = params.get("item");
  const view: KnowledgeView = ["trash", "review", "archive", "inbox"].includes(params.get("view") ?? "") ? params.get("view") as KnowledgeView : "list";
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [folders, setFolders] = useState<KnowledgeItem[]>([]);
  const [folderRevision, setFolderRevision] = useState<number | null>(null);
  const [folderError, setFolderError] = useState(false);
  const [folderAttempt, setFolderAttempt] = useState(0);
  const [page, setPage] = useState<KnowledgePage | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");
  const [searchScope, setSearchScope] = useState<"all" | "folder">("all");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Поиск «в текущей папке» есть только внутри папки; в корне раздела и в видах ищем по всей базе.
  const scope = parentId ? searchScope : "all";
  const href: KnowledgeHref = useCallback((next) => {
    const query = new URLSearchParams();
    query.set("area", next.area ?? area);
    const folder = next.folder === undefined ? parentId : next.folder;
    if (folder) query.set("folder", folder);
    if (next.view && next.view !== "list") query.set("view", next.view);
    if (next.item) query.set("item", next.item);
    return `/v3/knowledge?${query}`;
  }, [area, parentId]);
  const query = useCallback(() => {
    const value: KnowledgeQuery & { scopeParentId?: string } = { mode: search.trim() ? "search" : view, area, parentId, limit: 100 };
    if (search.trim()) {
      value.search = search.trim();
      if (scope === "all") delete value.area;
      else if (parentId) value.scopeParentId = parentId;
    }
    return Object.fromEntries(Object.entries(value).filter(([, val]) => val !== null && val !== undefined).map(([key, val]) => [key, String(val)]));
  }, [area, parentId, search, scope, view]);
  const listKey = JSON.stringify(query());
  useEffect(() => {
    const abort = new AbortController();
    const current = query();
    const key = JSON.stringify(current);
    const timer = setTimeout(() => {
      setLoading(true); setError(""); setSelected(new Set());
      void knowledgeFetch<KnowledgePage>(`list?${new URLSearchParams(current)}`, { signal: abort.signal }).then((result) => {
        setItems(result.items); setPage(result); setLoadedKey(key); setLoadedAt(new Date());
      }).catch((cause) => { if (!abort.signal.aborted) setError(cause.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, search ? 250 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, refresh, search]);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      const result: KnowledgeItem[] = [];
      let cursor: KnowledgePage["nextCursor"] = null;
      do {
        const query = new URLSearchParams({ mode: "folders", limit: "200" });
        if (cursor) { query.set("afterTitle", cursor.title); query.set("afterId", cursor.id); }
        const next = await knowledgeFetch<KnowledgePage>(`list?${query}`);
        result.push(...next.items);
        if (next.hasMore && (!next.nextCursor || next.nextCursor.id === cursor?.id)) throw new Error("Не удалось загрузить все папки.");
        cursor = next.nextCursor;
      } while (cursor && !stopped);
      if (!stopped) { setFolders(result); setFolderRevision(refresh); setFolderError(false); }
    })().catch(() => { if (!stopped) setFolderError(true); });
    return () => { stopped = true; };
  }, [refresh, folderAttempt]);
  useEffect(() => {
    if (!itemId) return;
    const abort = new AbortController();
    void knowledgeFetch<KnowledgeItem>(`item/${itemId}`, { signal: abort.signal }).then(setSelectedItem)
      .catch((cause) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, [itemId]);
  const shown = loadedKey === listKey;
  async function more() {
    if (!page?.nextCursor) return;
    setLoading(true);
    try {
      const result = await knowledgeFetch<KnowledgePage>(`list?${new URLSearchParams({ ...query(), afterTitle: page.nextCursor.title, afterId: page.nextCursor.id })}`);
      setItems((old) => [...old, ...result.items.filter((item) => !old.some((prior) => prior.id === item.id))]); setPage(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить материалы."); }
    finally { setLoading(false); }
  }
  const onSaved = useCallback((saved: KnowledgeItem) => {
    setSelectedItem(saved);
    setItems((old) => old.map((item) => item.id === saved.id ? saved : item));
    setRefresh((value) => value + 1);
  }, []);
  return {
    params, area, parentId, itemId, view, scope, href, items, folders, folderRevision, folderError, page, loadedAt, selectedItem, search, searchScope,
    refresh, loading, error, shown, rows: shown ? items : [], searchAll: Boolean(search.trim()) && scope === "all", selected,
    setSearch, setSearchScope, setError, setSelected, reload: () => setRefresh((value) => value + 1), retryFolders: () => { setFolderError(false); setFolderAttempt((value) => value + 1); },
    more, onSaved,
  };
}

export type KnowledgeData = ReturnType<typeof useKnowledgeData>;
