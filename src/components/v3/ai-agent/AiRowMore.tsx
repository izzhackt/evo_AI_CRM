"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon } from "@/components/icons";

/**
 * Строка документа с «⋯» (как «⋯» строки дела, Э8.1/Э8.2): редкие команды —
 * «Новая версия», «Удалить…» — раскрываются под строкой, по одной панели;
 * Esc и «Скрыть» сворачивают и возвращают фокус на «⋯». Слоты — разметка
 * сервера, кнопка и раскрытие — здесь.
 */
export function AiRowMore({
  main,
  aside,
  panel,
  label,
}: Readonly<{ main: ReactNode; aside: ReactNode; panel: ReactNode | null; label: string }>) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };
  return (
    <>
      {/* Телефон: «⋯» стоит в строке названия справа, а метки (если они есть) идут под ним; без видимых меток отдельной
          строки нет — слова только для читалки не занимают высоты. От md метки и «⋯» — колонка справа. */}
      <div className="relative grid gap-x-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className={`min-w-0${panel ? " pe-11 md:pe-0" : ""}`}>{main}</div>
        <div className="flex flex-wrap items-center gap-1.5 has-[>:not(.sr-only):not(.v3-ai-more)]:mt-2 md:mt-0 md:justify-end md:has-[>:not(.sr-only):not(.v3-ai-more)]:mt-0">
          {aside}
          {panel ? (
            <button
              ref={buttonRef}
              type="button"
              className="v3-ai-more absolute end-0 top-0 md:static"
              aria-expanded={open}
              aria-controls={`${ids}-panel`}
              aria-label={`Ещё действия: ${label}`}
              onClick={() => setOpen((value) => !value)}
            >
              <Icon name="more-horizontal" size={18} />
            </button>
          ) : null}
        </div>
      </div>
      {panel && open ? (
        <div id={`${ids}-panel`} className="v3-ai-more-panel" onKeyDown={onKeyDown}>
          {panel}
          <button type="button" onClick={close} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">
            Скрыть
          </button>
        </div>
      ) : null}
    </>
  );
}
