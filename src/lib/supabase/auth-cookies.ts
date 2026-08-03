type CookieName = Readonly<{ name: string }>;

/**
 * Mirrors the default storage key used by @supabase/supabase-js for the
 * configured project URL.
 */
export function supabaseAuthCookieBaseName(supabaseUrl: string): string {
  const projectReference = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${projectReference}-auth-token`;
}

export function isSupabaseAuthCookieName(name: string): boolean {
  return /^sb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?$/.test(name);
}

/**
 * Matches only this configured Supabase project's unchunked auth cookie and
 * numeric `.0`, `.1`, ... chunks. PKCE verifier cookies and cookies belonging
 * to any other Supabase project are intentionally excluded.
 */
export function isProjectSupabaseAuthCookieName(
  name: string,
  supabaseUrl: string,
): boolean {
  const baseName = supabaseAuthCookieBaseName(supabaseUrl);
  if (name === baseName) return true;
  if (!name.startsWith(`${baseName}.`)) return false;
  return /^\d+$/.test(name.slice(baseName.length + 1));
}

/**
 * Detects the unchunked auth cookie and the `.0`, `.1`, ... chunks emitted by
 * @supabase/ssr. PKCE verifier cookies do not count as authenticated state.
 */
export function hasSupabaseAuthCookie(
  requestCookies: readonly CookieName[],
  supabaseUrl: string,
): boolean {
  return requestCookies.some(({ name }) =>
    isProjectSupabaseAuthCookieName(name, supabaseUrl),
  );
}
