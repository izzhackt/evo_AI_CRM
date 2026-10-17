"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Выбор зрителя «обзор открыт или свёрнут» в localStorage (как раскрытые шаги
// «Пути поступления»). Только удобство, без данных студента. Хранилище может
// быть недоступно (приватное окно, запрет сайта): тогда выбор живёт в памяти
// вкладки, а без выбора действует умолчание сервера.
// ---------------------------------------------------------------------------

export const CSCA_OVERVIEW_STORAGE_KEY = "evo.portal.csca.overview.v1";
let memory: string | null = null;
const listeners = new Set<() => void>();

function readStored(): string {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(CSCA_OVERVIEW_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStored(value: "open" | "closed"): void {
  memory = value;
  try {
    window.localStorage.setItem(CSCA_OVERVIEW_STORAGE_KEY, value);
  } catch {
    // Остаётся в памяти вкладки.
  }
  for (const listener of listeners) listener();
}

function subscribeStored(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CSCA_OVERVIEW_STORAGE_KEY) {
      memory = null;
      listener();
    }
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Лист «Об экзамене» над занятиями CSCA. Новичок видит обзор целиком;
 * у того, кто уже начал заниматься, он по умолчанию свёрнут в строку с
 * названием и сводкой, полный обзор открывается одной кнопкой. Свой выбор
 * зритель меняет кнопкой «Об экзамене», браузер его помнит. Заголовок
 * страницы и кнопка стоят на одном месте в обоих состояниях.
 */
export function OverviewSheet({
  defaultOpen,
  toggleLabel,
  head,
  summary,
  intro,
  photo,
  thumb,
  body,
}: {
  defaultOpen: boolean;
  toggleLabel: string;
  head: ReactNode;
  summary: ReactNode;
  intro: ReactNode;
  photo: ReactNode;
  thumb: ReactNode;
  body: ReactNode;
}) {
  const stored = useSyncExternalStore(subscribeStored, readStored, () => "");
  const open = stored === "open" ? true : stored === "closed" ? false : defaultOpen;
  const toggle = useCallback(() => writeStored(open ? "closed" : "open"), [open]);

  return (
    <section className="cs-ov" data-open={open ? "" : undefined} aria-labelledby="cs-title">
      <div className="cs-ov-hero">
        <div className="cs-ov-hero-text">
          <div className="cs-ov-titlebar">
            {open ? null : thumb}
            <div className="cs-ov-title-block">
              {head}
              {open ? null : summary}
            </div>
            <button
              type="button"
              className="cs-ov-toggle"
              aria-expanded={open}
              aria-controls="cs-ov-body"
              onClick={toggle}
            >
              <span>{toggleLabel}</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {open ? intro : null}
        </div>
        {open ? photo : null}
      </div>
      <div id="cs-ov-body" className="cs-ov-body" hidden={!open}>
        {body}
      </div>
    </section>
  );
}
