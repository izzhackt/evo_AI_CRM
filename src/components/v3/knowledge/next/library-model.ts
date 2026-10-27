import { KNOWLEDGE_AREA_NAMES, type KnowledgeArea, type KnowledgeItem } from "@/lib/knowledge-library-contract";

import type { KnowledgeView } from "../KnowledgeTree";

export const KIND_NAMES = { folder: "Папка", page: "Страница", file: "Файл", secret: "Доступ" } as const;
export const VIEW_NAMES: Record<Exclude<KnowledgeView, "list">, string> = { inbox: "Неразобранное", review: "На уточнении", archive: "Архив", trash: "Корзина" };

export type KnowledgeHref = (next: { area?: KnowledgeArea; folder?: string | null; view?: KnowledgeView; item?: string | null }) => string;
export type Crumb = Readonly<{ key: string; label: string; href: string | null }>;

/** «Страны и направления / Китай / Пекин» — путь папки в её разделе (список выбора «Куда» и строки корзины). */
export function folderPathLabel(folder: KnowledgeItem, byId: ReadonlyMap<string, KnowledgeItem>): string {
  const parts = [folder.title];
  const seen = new Set([folder.id]);
  for (let id = folder.parent_id; id && !seen.has(id);) {
    const up = byId.get(id);
    if (!up) break;
    seen.add(id);
    parts.unshift(up.title);
    id = up.parent_id;
  }
  return parts.join(" / ");
}

/**
 * Где лежит материал: папки над ним; раздел — только в поиске по всей базе. «…» там, где папка уже не читается (например, лежит в
 * корзине). Корень раздела без папок — пустая строка: показывать нечего.
 */
export function itemPathLabel(item: KnowledgeItem, byId: ReadonlyMap<string, KnowledgeItem>, withArea: boolean): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let broken = false;
  for (let id = item.parent_id; id && !seen.has(id);) {
    seen.add(id);
    const up = byId.get(id);
    if (!up) { broken = true; break; }
    parts.unshift(up.title);
    id = up.parent_id;
  }
  return [...(withArea ? [KNOWLEDGE_AREA_NAMES[item.area]] : []), ...(broken ? ["…"] : []), ...parts].join(" / ");
}

/** Путь над таблицей: раздел, цепочка папок, название состояния («Корзина»). Последний пункт — текущее место, не ссылка. */
export function buildCrumbs(area: KnowledgeArea, parentId: string | null, view: KnowledgeView, folders: readonly KnowledgeItem[], href: KnowledgeHref): Crumb[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder] as const));
  const chain: KnowledgeItem[] = [];
  for (let current = parentId ? byId.get(parentId) : undefined; current && !chain.some((item) => item.id === current?.id); current = current.parent_id ? byId.get(current.parent_id) : undefined) chain.unshift(current);
  return [
    { key: "area", label: KNOWLEDGE_AREA_NAMES[area], href: parentId || view !== "list" ? href({ folder: null }) : null },
    ...chain.map((item, index) => ({ key: item.id, label: item.title, href: index < chain.length - 1 ? href({ folder: item.id }) : null })),
    ...(view !== "list" ? [{ key: "view", label: VIEW_NAMES[view], href: null }] : []),
  ];
}
