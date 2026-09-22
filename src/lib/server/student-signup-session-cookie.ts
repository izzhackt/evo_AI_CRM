import { combineChunks, stringFromBase64URL } from "@supabase/ssr";

type Cookie = Readonly<{ name: string; value: string }>;
export type SignupSessionToken = { status: "absent" } | { status: "invalid" } | { status: "present"; accessToken: string };

/** Callback-only reader. Never loads a refresh token or trusts cookie user claims. */
export async function readSignupSessionAccessToken(cookies: readonly Cookie[], projectUrl: string): Promise<SignupSessionToken> {
  const key = `sb-${new URL(projectUrl).hostname.split(".")[0]}-auth-token`;
  const parts = cookies.filter(({ name }) => name === key || name.startsWith(`${key}.`));
  if (!parts.length) return { status: "absent" };
  if (parts.length > 16 || new Set(parts.map(({ name }) => name)).size !== parts.length
    || parts.some(({ value }) => !value || value.length > 65536)
    || parts.reduce((size, part) => size + part.value.length, 0) > 65536) return { status: "invalid" };
  const values = new Map(parts.map(({ name, value }) => [name, value]));
  if (values.has(key) ? parts.length !== 1 : parts.some(({ name }) => {
    const suffix = name.slice(key.length + 1);
    return !/^(?:0|[1-9][0-9]*)$/.test(suffix) || Number(suffix) >= parts.length;
  })) return { status: "invalid" };
  try {
    const combined = await combineChunks(key, (name) => values.get(name));
    if (!combined) return { status: "invalid" };
    const encoded = combined.startsWith("base64-") ? combined.slice(7) : null;
    if (encoded !== null && !/^[A-Za-z0-9_-]+$/.test(encoded)) return { status: "invalid" };
    const session: unknown = JSON.parse(encoded === null ? combined : stringFromBase64URL(encoded));
    if (!session || typeof session !== "object" || Array.isArray(session)) return { status: "invalid" };
    const token = (session as Record<string, unknown>).access_token;
    if (typeof token !== "string" || token.length > 32768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return { status: "invalid" };
    return { status: "present", accessToken: token };
  } catch { return { status: "invalid" }; }
}
