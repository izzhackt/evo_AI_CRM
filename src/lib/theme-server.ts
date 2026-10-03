import "server-only";

import { cookies, headers } from "next/headers";

import { platformAudienceForHost } from "./platform-public-origin.ts";
import { parseTheme, THEME_COOKIE, type Theme } from "./theme.ts";

/**
 * Тема запроса: cookie `theme`, без неё — светлая; тема ОС не читается
 * (решение владельца 02.10). Хост сотрудников всегда светлый — staff CRM
 * только светлая, и кнопки темы там нет.
 */
export async function readRequestTheme(): Promise<Theme> {
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  if (isStaffHost(requestHeaders.get("host"))) return "light";
  return parseTheme(cookieStore.get(THEME_COOKIE)?.value);
}

/** Кнопку темы показывают везде, кроме хоста сотрудников. */
export async function themeToggleAllowed(): Promise<boolean> {
  return !isStaffHost((await headers()).get("host"));
}

function isStaffHost(host: string | null): boolean {
  return platformAudienceForHost(host) === "staff";
}
