"use client";

import { useId, useState, type ReactNode } from "react";

const TOGGLE = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * Строка состояния с раскрытием справа («Доступ к порталу» → «Настроить»):
 * заголовок и состояние остаются заголовком и текстом для читалки, а кнопка
 * называет, что раскрывает (`aria-expanded`). Содержимое смонтировано сразу и
 * только скрыто — набранное в формах не теряется при сворачивании.
 */
export function CaseDisclosure({ header, openLabel, closeLabel, children }: Readonly<{
  header: ReactNode;
  openLabel: string;
  closeLabel: string;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3">
        {header}
        <button type="button" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((value) => !value)} className={`ms-auto ${TOGGLE}`}>
          {open ? closeLabel : openLabel}
        </button>
      </div>
      <div id={regionId} hidden={!open} data-case-disclosure="">{children}</div>
    </>
  );
}
