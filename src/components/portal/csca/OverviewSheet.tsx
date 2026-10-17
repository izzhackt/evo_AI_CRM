"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

import {
  CSCA_OVERVIEW_COOKIE,
  CSCA_OVERVIEW_COOKIE_MAX_AGE,
  CSCA_OVERVIEW_COOKIE_PATH,
  cscaOverviewOpen,
  parseCscaOverviewChoice,
  type CscaOverviewChoice,
} from "@/lib/portal/csca-overview-choice";

// ---------------------------------------------------------------------------
// Выбор зрителя «обзор открыт или свёрнут» в cookie `csca_overview`, как тема
// и язык: сервер читает её и рисует лист сразу в нужном состоянии, поэтому
// после гидратации ничего не прыгает (review раунда 1, F1). Если cookie
// запрещены, выбор живёт в памяти вкладки, а без выбора действует умолчание.
// ---------------------------------------------------------------------------

let memory: CscaOverviewChoice | null = null;
const listeners = new Set<() => void>();

function readChoice(): CscaOverviewChoice | "" {
  if (memory !== null) return memory;
  const prefix = `${CSCA_OVERVIEW_COOKIE}=`;
  const entry = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return parseCscaOverviewChoice(entry?.slice(prefix.length)) ?? "";
}

function writeChoice(value: CscaOverviewChoice): void {
  memory = value;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${CSCA_OVERVIEW_COOKIE}=${value}; path=${CSCA_OVERVIEW_COOKIE_PATH}; max-age=${CSCA_OVERVIEW_COOKIE_MAX_AGE}; samesite=lax${secure}`;
  for (const listener of listeners) listener();
}

function subscribeChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Лист «Об экзамене» над занятиями CSCA. Новичок видит обзор целиком;
 * у того, кто уже начал заниматься, он по умолчанию свёрнут в строку с
 * названием и сводкой, полный обзор открывается одной кнопкой. Свой выбор
 * зритель меняет кнопкой «Об экзамене», устройство помнит его в cookie.
 * Заголовок страницы и кнопка стоят на одном месте в обоих состояниях.
 */
export function OverviewSheet({
  started,
  initialChoice,
  toggleLabel,
  head,
  summary,
  intro,
  photo,
  thumb,
  body,
}: {
  /** Студент уже занимается: без выбора обзор свёрнут. */
  started: boolean;
  /** Выбор из cookie запроса: с ним сервер и гидратация рисуют одно и то же. */
  initialChoice: CscaOverviewChoice | null;
  toggleLabel: string;
  head: ReactNode;
  summary: ReactNode;
  intro: ReactNode;
  photo: ReactNode;
  thumb: ReactNode;
  body: ReactNode;
}) {
  const stored = useSyncExternalStore(subscribeChoice, readChoice, () => initialChoice ?? "");
  const open = cscaOverviewOpen(stored === "" ? null : stored, started);
  const toggle = useCallback(() => writeChoice(open ? "closed" : "open"), [open]);

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
