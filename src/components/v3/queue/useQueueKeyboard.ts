"use client";

import { useEffect, useRef } from "react";

import { nextQueueIndex, popoverBlocksQueueKeys, rowNeedsReveal } from "./queue-navigation";
import { QUEUE_HELP_ID } from "./QueueKeyboardHelp";
import { QUEUE_SEARCH_SELECTOR } from "./QueueToolbar";

/** Строка очереди: `data-queue-row="<ключ>"`, внутри — ссылка `data-queue-open`. */
export const QUEUE_ROW_SELECTOR = "[data-queue-row]";
export const QUEUE_OPEN_SELECTOR = "[data-queue-open]";
/** Необязательная вторая ссылка строки — запись целиком (Shift+Enter). */
export const QUEUE_FULL_SELECTOR = "[data-queue-full]";

/** Отметка строки (`data-queue-select`, Э7): «x» в строке ставит и снимает её. */
export const QUEUE_SELECT_SELECTOR = "[data-queue-select]";

/**
 * Человек печатает: клавиши очереди молчат. Отметка строки и кнопки ввода не
 * считаются — после щелчка по отметке j/k и «x» работают дальше.
 */
export function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement && ["checkbox", "radio", "button", "submit", "reset"].includes(target.type)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Открыто всплывающее окно, в котором человек работает (меню, «Результат»,
 * подсказка «?»): клавиши очереди молчат. Строка «Отменить» нового облика
 * (`data-queue-passive`) их не выключает — `popoverBlocksQueueKeys`.
 */
export function openPopover(): boolean {
  try { return popoverBlocksQueueKeys(document.querySelectorAll(":popover-open")); } catch { return false; }
}

/**
 * Строка, от которой идут j/k: с фокусом внутри, иначе — строка, чью
 * «Отменить» (UndoToast, `data-undo-row`) держит фокус: после завершения
 * j/k продолжают от завершённой задачи, а не с начала списка.
 */
function focusedRowIndex(links: readonly HTMLElement[]): number {
  const active = document.activeElement;
  const inRow = links.findIndex((link) => link.closest(QUEUE_ROW_SELECTOR)?.contains(active));
  if (inRow >= 0 || !(active instanceof HTMLElement)) return inRow;
  const undoKey = active.closest<HTMLElement>("[data-undo-row]")?.dataset.undoRow;
  return undoKey === undefined ? -1 : links.findIndex((link) => link.closest<HTMLElement>(QUEUE_ROW_SELECTOR)?.dataset.queueRow === undoKey);
}

/** Модальное окно поверх очереди (диалог создания задачи, панель на узком экране). */
export function modalOpen(): boolean {
  try { return document.querySelector("dialog:modal") !== null; } catch { return false; }
}

function rowLinks(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`${QUEUE_ROW_SELECTOR} ${QUEUE_OPEN_SELECTOR}`)];
}

/**
 * Выбранная строка должна быть видна рядом с панелью. После перехода по
 * ссылке с открытой записью или обновления страницы строка может оказаться
 * ниже первого экрана — тогда страница прокручивается к ней (в середину окна).
 * Видимую строку не трогает (`rowNeedsReveal`).
 */
export function revealQueueRow(key: string): boolean {
  const row = document.querySelector<HTMLElement>(`${QUEUE_ROW_SELECTOR}[data-queue-row="${CSS.escape(key)}"]`);
  if (!row || !rowNeedsReveal(row.getBoundingClientRect(), window.innerHeight)) return false;
  row.scrollIntoView({ block: "center" });
  return true;
}

/**
 * Клавиатура очереди: «/» — поиск, ↑/↓ и j/k — строка, Enter — открыть
 * (обычная ссылка строки), Shift+Enter — вторая ссылка строки
 * (`data-queue-full`), «x» — отметить строку для массовых действий (Э7),
 * «?» — подсказка с клавишами; Esc закрывает панель
 * (`QueueDetailPanel`). Пока пользователь печатает, открыто всплывающее окно
 * (кроме строки «Отменить» — `openPopover`) или модальный диалог, клавиши не
 * перехватываются. Открытая запись видна в
 * списке (`revealQueueRow`) — и при переходе по ссылке, и после обновления;
 * после закрытия панели фокус возвращается на строку, которая была открыта.
 */
export function useQueueKeyboard({ openKey }: Readonly<{ openKey: string | null }>) {
  const previousOpenKey = useRef(openKey);

  useEffect(() => {
    const previous = previousOpenKey.current;
    previousOpenKey.current = openKey;
    if (openKey !== null) {
      revealQueueRow(openKey);
      return;
    }
    if (!previous) return;
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
      if (event.key === "Enter" && event.shiftKey) {
        // Shift+Enter на строке открывает запись целиком (у «Студентов» — дело), а не новое окно.
        const row = event.target instanceof Element ? event.target.closest(QUEUE_ROW_SELECTOR) : null;
        const full = row?.querySelector<HTMLElement>(QUEUE_FULL_SELECTOR);
        if (!full) return;
        event.preventDefault();
        full.click();
        return;
      }
      if (event.key === "?") {
        const help = document.getElementById(QUEUE_HELP_ID);
        if (!help) return;
        event.preventDefault();
        help.togglePopover();
        return;
      }
      // «x» (на русской раскладке — «ч», та же клавиша): отметить строку с фокусом для массовых действий.
      if (!event.shiftKey && (event.key === "x" || event.code === "KeyX")) {
        const target = event.target instanceof Element ? event.target : null;
        const row = target?.closest(QUEUE_ROW_SELECTOR)
          ?? document.querySelector(`${QUEUE_ROW_SELECTOR}:has(${QUEUE_OPEN_SELECTOR}[aria-current="true"])`);
        const box = row?.querySelector<HTMLInputElement>(QUEUE_SELECT_SELECTOR);
        if (!box || box.disabled) return;
        event.preventDefault();
        box.click();
        return;
      }
      const arrow = event.key === "ArrowDown" || event.key === "ArrowUp";
      const letter = event.key === "j" || event.key === "k";
      if (!arrow && !letter) return;
      // Стрелки перехватываются только в списке: в панели и в меню они свои.
      const target = event.target instanceof Element ? event.target : null;
      if (arrow && target && target !== document.body && !target.closest("[data-queue-list]")) return;
      const links = rowLinks();
      const current = focusedRowIndex(links);
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
