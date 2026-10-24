"use client";

import { Fragment, useState, type ReactNode } from "react";

/**
 * Список материалов с поиском по названию: строки — разметка сервера, здесь
 * только отбор уже прочитанных (до 100) по набранному. Поле появляется, когда
 * строк больше восьми: в коротком списке оно только занимало бы место.
 */
export function AiDocumentFilter({
  entries,
}: Readonly<{ entries: readonly Readonly<{ id: string; title: string; row: ReactNode }>[] }>) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  const shown = needle ? entries.filter((entry) => entry.title.toLocaleLowerCase("ru-RU").includes(needle)) : entries;
  return (
    <>
      {entries.length > 8 ? (
        <div role="search">
          <label className="sr-only" htmlFor="ai-documents-search">Найти материал</label>
          <input
            id="ai-documents-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Название материала"
            className="min-h-11 w-full max-w-md rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg placeholder:text-fg-3"
          />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p role="status" className="rounded-card border border-border bg-surface px-4 py-6 text-center t-body-compact text-fg-3">Среди показанных материалов такого нет.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {shown.map((entry) => <Fragment key={entry.id}>{entry.row}</Fragment>)}
        </ul>
      )}
    </>
  );
}
