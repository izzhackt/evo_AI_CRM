"use client";

import { useSyncExternalStore } from "react";

import { Icon } from "@/components/icons";
import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, readDocumentTheme, type Theme } from "@/lib/theme";

/**
 * Одна кнопка «солнце/луна» для студента (решение владельца 02.10): кабинет,
 * анкета, вход и ожидание. Имя постоянное («Тёмная тема»), состояние —
 * aria-pressed; значок — текущая тема (CSS-переключение по <html data-theme>
 * в globals.css, поэтому до гидратации значок уже верный). Выбор живёт в
 * cookie `theme` этого устройства; корневой layout ставит data-theme на
 * сервере, поэтому вспышки при загрузке нет.
 */

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

const SWITCHING_MS = 200;
const EN_LABEL = "Dark theme";

export function applyTheme(next: Theme): void {
  const root = document.documentElement;
  const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (animate) root.setAttribute("data-theme-switching", "");
  root.setAttribute("data-theme", next);
  root.style.colorScheme = next;
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  if (animate) {
    window.setTimeout(() => root.removeAttribute("data-theme-switching"), SWITCHING_MS);
  }
}

export function ThemeToggle({
  locale,
  initialTheme,
}: {
  locale: Locale;
  initialTheme: Theme;
}) {
  const theme = useSyncExternalStore(subscribe, readDocumentTheme, () => initialTheme);
  // Словарь кабинета — RU/KY; /login предлагает и EN, поэтому EN — здесь.
  const label = locale === "en" ? EN_LABEL : getPortalStrings("shell", locale)["theme.dark"];
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => applyTheme(dark ? "light" : "dark")}
      aria-label={label}
      aria-pressed={dark}
      title={label}
      className="theme-toggle"
    >
      <Icon name="sun" size={20} className="i-sun" />
      <Icon name="moon" size={20} className="i-moon" />
    </button>
  );
}
