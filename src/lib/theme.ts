/**
 * Тема студенческих экранов (решение владельца 02.10): светлая по умолчанию,
 * тёмная — только по выбору студента кнопкой «солнце/луна». Тема ОС не
 * читается. Выбор живёт в cookie `theme` этого устройства (путь `/`, 1 год,
 * SameSite=Lax); cookie привязана к хосту, поэтому выбор на app.* не
 * доходит до crm.*, а staff CRM всегда светлая.
 */
export type Theme = "light" | "dark";

export const THEME_COOKIE = "theme";
export const THEME_COOKIE_MAX_AGE = 31_536_000;

/** Только точное "dark" включает тёмную; всё остальное — светлая. */
export function parseTheme(value: string | null | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

/** Текущая тема документа: её ставит корневой layout на сервере. */
export function readDocumentTheme(): Theme {
  return parseTheme(document.documentElement.getAttribute("data-theme"));
}
