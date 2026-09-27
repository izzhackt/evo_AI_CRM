"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * «Показать ещё N» ленты (Э4, review 27.09): остальные строки уже в разметке
 * (скрыты `hidden`); кнопка открывает их и уходит, а фокус переходит на первую
 * открытую строку (`FeedRow` с `focusTarget`, `tabindex="-1"`) — не падает на
 * страницу, как было у `<summary>`, который прятал сам себя.
 */
export function FeedMore({ count, start, testId, children }: Readonly<{
  count: number;
  /** Номер первой скрытой строки в общем списке (`<ol start>`). */
  start: number;
  testId: string;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    listRef.current?.querySelector<HTMLElement>(':scope > [tabindex="-1"]')?.focus();
  }, [open]);
  return (
    <div data-testid={testId}>
      <ol ref={listRef} start={start} hidden={!open} className="divide-y divide-border border-b border-border">
        {children}
      </ol>
      {open ? null : (
        <button type="button" className={LINK} onClick={() => { moveFocus.current = true; setOpen(true); }}>
          Показать ещё {count}
        </button>
      )}
    </div>
  );
}
