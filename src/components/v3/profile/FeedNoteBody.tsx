"use client";

import { useState } from "react";

/** Заметка длиннее этого — свёрнута до пяти строк: импортированные отчёты не растягивают ленту. */
const LONG_CHARACTERS = 360;
const LONG_LINES = 5;

/**
 * Текст заметки ленты: короткая — целиком, длинная — пять строк и «Показать
 * полностью». Разметка короткой заметки та же, что была у `FeedNote`.
 */
export function FeedNoteBody({ body }: Readonly<{ body: string }>) {
  const [open, setOpen] = useState(false);
  const long = body.length > LONG_CHARACTERS || body.split("\n").length > LONG_LINES;
  const className = ["whitespace-pre-wrap break-words t-body text-fg", long && !open ? "line-clamp-5" : null].filter(Boolean).join(" ");
  return (
    <>
      <p className={className}>{body}</p>
      {long ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">
          {open ? "Свернуть" : "Показать полностью"}
        </button>
      ) : null}
    </>
  );
}
