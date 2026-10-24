"use client";

import { useEffect } from "react";

const CONFIRM_TEXT = "Есть несохранённые изменения. Перейти без сохранения?";

/**
 * Охрана несохранённых правок (инструкция, настройки, текст черновика): закрытие
 * вкладки браузера и переход по ссылке на другую страницу спрашивают подтверждение,
 * пока `dirty`. Набранное лежит только в памяти — ни в `localStorage`, ни в
 * сессии. Ссылка на тот же адрес, новая вкладка и якорь не прерываются.
 */
export function useDirtyGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const leave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      if (link.getAttribute("href")?.startsWith("#")) return;
      if (link.href.split("#")[0] === window.location.href.split("#")[0]) return;
      if (!window.confirm(CONFIRM_TEXT)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", leave, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", leave, true);
    };
  }, [dirty]);
}
