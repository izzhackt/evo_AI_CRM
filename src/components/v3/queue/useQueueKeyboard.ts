"use client";

import { useEffect, useRef } from "react";

import { nextQueueIndex } from "./queue-navigation";
import { QUEUE_HELP_ID } from "./QueueKeyboardHelp";
import { QUEUE_SEARCH_SELECTOR } from "./QueueToolbar";

/** Строка очереди: `data-queue-row="<ключ>"`, внутри — ссылка `data-queue-open`. */
export const QUEUE_ROW_SELECTOR = "[data-queue-row]";
export const QUEUE_OPEN_SELECTOR = "[data-queue-open]";

export function typingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function openPopover(): boolean {
  try { return document.querySelector(":popover-open") !== null; } catch { return false; }
}

/** Модальное окно поверх очереди (диалог создания задачи, панель на узком экране). */
export function modalOpen(): boolean {
  try { return document.querySelector("dialog:modal") !== null; } catch { return false; }
}

function rowLinks(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`${QUEUE_ROW_SELECTOR} ${QUEUE_OPEN_SELECTOR}`)];
}

/**
 * Клавиатура очереди: «/» — поиск, ↑/↓ и j/k — строка, Enter — открыть
 * (обычная ссылка строки), «?» — подсказка с клавишами; Esc закрывает панель
 * (`QueueDetailPanel`). Пока пользователь печатает, открыто всплывающее окно
 * или модальный диалог, клавиши не перехватываются. После закрытия панели
 * фокус возвращается на строку, которая была открыта.
 */
export function useQueueKeyboard({ openKey }: Readonly<{ openKey: string | null }>) {
  const previousOpenKey = useRef(openKey);

  useEffect(() => {
    const previous = previousOpenKey.current;
    previousOpenKey.current = openKey;
    if (!previous || openKey !== null) return;
    const row = document.querySelector(`${QUEUE_ROW_SELECTOR}[data-queue-row="${CSS.escape(previous)}"] ${QUEUE_OPEN_SELECTOR}`);
    if (row instanceof HTMLElement) row.focus();
  }, [openKey]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typingTarget(event.target)) return;
      if (openPopover() || modalOpen()) return;
      if (event.key === "/") {
        const search = document.querySelector<HTMLInputElement>(QUEUE_SEARCH_SELECTOR);
        if (!search || search.offsetParent === null) return;
        event.preventDefault();
        search.focus();
        search.select();
        return;
      }
      if (event.key === "?") {
        const help = document.getElementById(QUEUE_HELP_ID);
        if (!help) return;
        event.preventDefault();
        help.togglePopover();
        return;
      }
      const arrow = event.key === "ArrowDown" || event.key === "ArrowUp";
      const letter = event.key === "j" || event.key === "k";
      if (!arrow && !letter) return;
      // Стрелки перехватываются только в списке: в панели и в меню они свои.
      const target = event.target instanceof Element ? event.target : null;
      if (arrow && target && target !== document.body && !target.closest("[data-queue-list]")) return;
      const links = rowLinks();
      const current = links.findIndex((link) => link.closest(QUEUE_ROW_SELECTOR)?.contains(document.activeElement));
      const selected = links.findIndex((link) => link.getAttribute("aria-current") === "true");
      const next = nextQueueIndex(links.length, current, selected, event.key === "ArrowDown" || event.key === "j" ? 1 : -1);
      if (next < 0) return;
      event.preventDefault();
      links[next].focus();
      links[next].scrollIntoView({ block: "nearest" });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
