import type { CookieOptions } from "@supabase/ssr";

/**
 * «Это моё устройство» снята при входе (06.11.2026, образец akylman.org.kg/login): вход живёт до закрытия
 * браузера. Признак — отдельная cookie без срока; пока она есть, cookie входа Supabase тоже пишутся без
 * срока, и при обновлении токена в proxy тоже.
 */
export const SESSION_ONLY_COOKIE = "evo_session_only";

/** Без maxAge и expires cookie живёт до закрытия браузера. Удаление (пустое значение, maxAge 0) не трогаем. */
export function sessionAwareCookieOptions(
  value: string,
  options: CookieOptions,
  sessionOnly: boolean,
): CookieOptions {
  if (!sessionOnly || value === "" || options.maxAge === 0) return options;
  const rest: CookieOptions = { ...options };
  delete rest.maxAge;
  delete rest.expires;
  return rest;
}
