type CookieName = Readonly<{ name: string }>;

function authCookieBaseName(supabaseUrl: string): string {
  const projectReference = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${projectReference}-auth-token`;
}

export function isSupabaseAuthCookieName(name: string): boolean {
  return /^sb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?$/.test(name);
}

/**
 * Detects the unchunked auth cookie and the `.0`, `.1`, ... chunks emitted by
 * @supabase/ssr. PKCE verifier cookies do not count as authenticated state.
 */
export function hasSupabaseAuthCookie(
  requestCookies: readonly CookieName[],
  supabaseUrl: string,
): boolean {
  const baseName = authCookieBaseName(supabaseUrl);
  return requestCookies.some(
    ({ name }) =>
      name === baseName || new RegExp(`^${baseName}\\.\\d+$`).test(name),
  );
}
