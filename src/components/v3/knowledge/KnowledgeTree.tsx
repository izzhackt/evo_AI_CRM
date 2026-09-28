"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { KNOWLEDGE_AREAS, KNOWLEDGE_AREA_NAMES, type KnowledgeArea, type KnowledgeItem } from "@/lib/knowledge-library-contract";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";
import { KnowledgeTreeSkeleton } from "./KnowledgeSkeleton";

export type KnowledgeView = "list" | "trash" | "review" | "archive" | "inbox";
type Href = (next: { area?: KnowledgeArea; folder?: string | null; view?: KnowledgeView; item?: string | null }) => string;

/** Строка дерева: ссылка 44 px, выбранная — нейтральная подложка `.v3-choice` по `aria-current`. */
const ROW = "v3-choice flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-nav px-2 hover:bg-surface-2 hover:text-fg";
const ROW_LINK = `${ROW} t-body-compact text-fg-2`;
const AREA_LINK = `${ROW} t-item text-fg`;
const VIEW_LINK = `${ROW_LINK} ps-13`;
const TOGGLE = "grid size-11 shrink-0 place-items-center rounded-nav text-fg-3 hover:bg-surface-2 hover:text-fg";
const VIEWS: readonly (readonly [Exclude<KnowledgeView, "list">, string])[] = [
  ["inbox", "Входящие"], ["review", "На уточнении"], ["archive", "Архив"], ["trash", "Корзина"],
];

/**
 * Дерево «Базы знаний» — только навигация (Э8.10). Ветка рисует детей, только
 * когда раскрыта: закрытая ветка не держит в документе своё поддерево (в
 * базе сотни папок, глубина до 9). Строка — кнопка «Раскрыть» 44 px и ссылка
 * 44 px; ссылки не вложены в другие элементы управления.
 *
 * Раскрыто по умолчанию: текущий раздел и путь к открытой папке. Человек может
 * раскрыть и свернуть любую ветку сам — его выбор главнее. «Секреты и доступы»
 * — последний раздел, отделён линией и сам не раскрывается никогда: только
 * по нажатию.
 *
 * Четыре раздела видны всегда: их ссылкам папки не нужны. Пока папки читаются,
 * скелет стоит только внутри раскрытой ветки; чтение не удалось — честная
 * ошибка с «Повторить», а не вечный скелет.
 */
export function KnowledgeTree({ folders, folderError = false, onRetryFolders, area, parentId, view, section, href, onNavigate }: Readonly<{
  /** null — папки ещё не прочитаны (или чтение не удалось: тогда `folderError`). */
  folders: readonly KnowledgeItem[] | null;
  /** Последнее чтение папок не удалось. */
  folderError?: boolean;
  onRetryFolders?: () => void;
  area: KnowledgeArea;
  parentId: string | null;
  view: KnowledgeView;
  section: "documents" | "snippets" | null;
  href: Href;
  onNavigate?: () => void;
}>) {
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const children = useMemo(() => {
    const map = new Map<string, KnowledgeItem[]>();
    for (const folder of folders ?? []) {
      const key = `${folder.area}:${folder.parent_id ?? ""}`;
      const list = map.get(key);
      if (list) list.push(folder); else map.set(key, [folder]);
    }
    return map;
  }, [folders]);
  // Путь к открытой папке (без неё самой: её вложенные папки — в таблице).
  const path = useMemo(() => {
    const ids = new Set<string>();
    if (!parentId || area === "secrets" || section) return ids;
    const byId = new Map((folders ?? []).map((folder) => [folder.id, folder]));
    for (let current = byId.get(parentId)?.parent_id ?? null; current && !ids.has(current); current = byId.get(current)?.parent_id ?? null) ids.add(current);
    return ids;
  }, [area, folders, parentId, section]);
  // Папки ещё читаются: у любого раздела могут быть папки — стрелка есть, в раскрытой ветке скелет.
  const loading = folders === null && !folderError;
  const isOpen = (key: string, auto: boolean) => toggled.get(key) ?? auto;
  const toggle = (key: string, open: boolean) => setToggled((old) => new Map(old).set(key, !open));

  function branch(nodeArea: KnowledgeArea, treeParentId: string | null, depth: number): React.ReactNode {
    const list = children.get(`${nodeArea}:${treeParentId ?? ""}`) ?? [];
    if (!list.length) return null;
    if (depth > 40) return <li><Link href={href({ area: nodeArea, folder: treeParentId })} onClick={onNavigate} className={ROW_LINK}>Открыть вложенные папки</Link></li>;
    return list.map((folder) => {
      const hasChildren = children.has(`${nodeArea}:${folder.id}`);
      const open = hasChildren && isOpen(folder.id, path.has(folder.id));
      const current = !section && view === "list" && folder.id === parentId;
      return <li key={folder.id}>
        <div className="flex items-start">
          {hasChildren
            ? <button type="button" aria-expanded={open} aria-label={`${open ? "Свернуть" : "Раскрыть"}: ${folder.title}`} onClick={() => toggle(folder.id, open)} className={TOGGLE}>
              <Icon name="chevron-right" size={16} className={`transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
            </button>
            : <span aria-hidden="true" className="size-11 shrink-0" />}
          <Link href={href({ area: nodeArea, folder: folder.id, view: "list" })} aria-current={current ? "page" : undefined} onClick={onNavigate} className={ROW_LINK} title={folder.title}>
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{folder.title}</span>
          </Link>
        </div>
        {open ? <ul className="ps-3">{branch(nodeArea, folder.id, depth + 1)}</ul> : null}
      </li>;
    });
  }

  return <div className="space-y-3" aria-busy={loading} data-testid="knowledge-tree">
    <ul className="space-y-0.5">
      {KNOWLEDGE_AREAS.map((nodeArea) => {
        const secrets = nodeArea === "secrets";
        const hasChildren = loading || children.has(`${nodeArea}:`);
        // Секреты не раскрываются сами: ни по разделу, ни по пути.
        const open = hasChildren && isOpen(`area:${nodeArea}`, !secrets && !section && nodeArea === area);
        const current = !section && view === "list" && area === nodeArea && !parentId;
        return <li key={nodeArea} className={secrets ? "mt-3 border-t border-border pt-3" : undefined} data-knowledge-area={nodeArea}>
          <div className="flex items-start">
            {hasChildren
              ? <button type="button" aria-expanded={open} aria-label={`${open ? "Свернуть" : "Раскрыть"}: ${KNOWLEDGE_AREA_NAMES[nodeArea]}`} onClick={() => toggle(`area:${nodeArea}`, open)} className={TOGGLE}>
                <Icon name="chevron-right" size={16} className={`transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
              </button>
              : <span aria-hidden="true" className="size-11 shrink-0" />}
            <Link href={href({ area: nodeArea, folder: null, view: "list" })} aria-current={current ? "page" : undefined} onClick={onNavigate} className={AREA_LINK}>
              {secrets ? <Icon name="lock" size={16} className="shrink-0 text-fg-3" /> : null}
              <span className="min-w-0 [overflow-wrap:anywhere]">{KNOWLEDGE_AREA_NAMES[nodeArea]}</span>
            </Link>
          </div>
          {open ? loading
            ? <div className="ps-3"><p role="status" className="sr-only">Загружаем папки…</p><KnowledgeTreeSkeleton rows={4} /></div>
            : <ul className="ps-3">{branch(nodeArea, null, 1)}</ul> : null}
        </li>;
      })}
    </ul>
    {folderError ? <div role="alert" className="flex flex-col items-start gap-2 ps-13 pe-2" data-testid="knowledge-tree-error">
      <p className="t-body-compact text-danger">Папки не загрузились.</p>
      <button type="button" onClick={onRetryFolders} className={QUEUE_SECONDARY}>Повторить</button>
    </div> : null}
    <nav aria-label="Разделы базы знаний" className="border-t border-border pt-3">
      <ul className="space-y-0.5">
        <li><Link href="/v3/knowledge?section=documents" aria-current={section === "documents" ? "page" : undefined} onClick={onNavigate} className={VIEW_LINK}>Документы</Link></li>
        <li><Link href="/v3/knowledge?section=snippets" aria-current={section === "snippets" ? "page" : undefined} onClick={onNavigate} className={VIEW_LINK}>Шаблоны ответов</Link></li>
        {VIEWS.map(([key, label]) => <li key={key}>
          <Link href={href({ folder: null, view: key })} aria-current={!section && view === key ? "page" : undefined} onClick={onNavigate} className={VIEW_LINK}>{label}</Link>
        </li>)}
      </ul>
    </nav>
  </div>;
}
