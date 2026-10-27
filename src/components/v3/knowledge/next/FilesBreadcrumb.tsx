import { ChevronRightIcon } from "lucide-react";

import type { KnowledgeFolder } from "../../FileManager";

const CRUMB = "inline-flex min-h-11 max-w-full items-center truncate rounded-nav px-1 hover:text-fg";

/**
 * Путь к открытой папке: «Документы / Компания / …». На корне путь повторил бы заголовок, поэтому его там нет. Текущее звено принимает
 * фокус программно (`currentRef`, `tabIndex=-1`): после открытия папки фокус встаёт на её название, а не падает на страницу.
 */
export function FilesBreadcrumb({ rootLabel, path, onOpen, currentRef }: Readonly<{ rootLabel: string; path: readonly KnowledgeFolder[]; onOpen: (id: string | null) => void; currentRef: React.Ref<HTMLSpanElement> }>) {
  if (path.length === 0) return null;
  return (
    <nav aria-label="Путь к папке" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 t-body-compact text-fg-2">
        <li><button type="button" className={CRUMB} onClick={() => onOpen(null)}>{rootLabel}</button></li>
        {path.map((folder, index) => (
          <li key={folder.id} className="flex min-w-0 max-w-full items-center gap-1">
            <ChevronRightIcon className="size-3.5 shrink-0 text-fg-3" aria-hidden="true" />
            {index === path.length - 1
              ? <span ref={currentRef} tabIndex={-1} aria-current="page" className="inline-flex min-h-11 items-center truncate rounded-nav px-1 t-item text-fg">{folder.name}</span>
              : <button type="button" className={CRUMB} onClick={() => onOpen(folder.id)}>{folder.name}</button>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
