import type { JwtPayload } from "@supabase/supabase-js";

/**
 * Одна живая проверка доступа на запрос (план A, docs/PLAN_CHANGES.md
 * 16.10.2026).
 *
 * Proxy читает доступ в базе (`staff_access_snapshot`, `current_actor_authority`,
 * `student_portal_cases`) и передаёт рендеру этого же запроса сырые строки
 * ответов во внутреннем заголовке запроса. Рендер (layout, страница, route
 * handler) принимает их вместо повторного RPC только тогда, когда:
 *
 * - подпись HMAC-SHA256 сходится. Ключ — 32 случайных байта, создаётся один
 *   раз на процесс и не покидает его память. Proxy и рендер Next.js 16 —
 *   один процесс Node.js: `next-server` подключает proxy через `require`;
 * - заголовок выпущен не раньше чем {@link ACCESS_HANDOFF_MAX_AGE_MS} назад;
 * - `x-request-id` совпадает с идентификатором этого запроса, который
 *   выставил proxy;
 * - `sub`, `session_id` и `exp` совпадают с JWT, который рендер сам проверил
 *   локально (`getClaims`).
 *
 * Строки разбирают те же функции, что и после живого RPC. Чего-то не хватает
 * или не сходится — рендер делает прежний живой RPC. Proxy всегда удаляет
 * одноимённый входящий заголовок клиента. Выпускает заголовок только для
 * GET/HEAD: команды (server actions, POST API) по-прежнему проверяют доступ
 * сами внутри обработчика.
 */
export const ACCESS_HANDOFF_HEADER = "x-evo-access-handoff";
export const ACCESS_HANDOFF_MAX_AGE_MS = 10_000;

const KEY_SYMBOL = Symbol.for("evo.platform.access-handoff.key.v1");
const MAX_HEADER_LENGTH = 64 * 1024;

/** Ответ одного RPC так, как его вернул PostgREST, без ошибок. */
export type AccessHandoffRows = Readonly<{
  /** Ответ `staff_access_snapshot`; ключа нет — proxy его не вызывал. */
  staff?: unknown;
  /** Ответ `current_actor_authority`; ключа нет — proxy его не вызывал. */
  actor?: unknown;
  /** Ответ `student_portal_cases`; ключа нет — proxy его не вызывал. */
  cases?: unknown;
}>;

type AccessHandoffPayload = AccessHandoffRows & Readonly<{
  v: 1;
  rid: string;
  sub: string;
  sid: string | null;
  exp: number | null;
  iat: number;
}>;

type KeyHolder = { [KEY_SYMBOL]?: Promise<CryptoKey> };

function processKey(): Promise<CryptoKey> {
  const holder = globalThis as unknown as KeyHolder;
  holder[KEY_SYMBOL] ??= crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return holder[KEY_SYMBOL];
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function claimBinding(claims: JwtPayload): Readonly<{ sub: string; sid: string | null; exp: number | null }> | null {
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  const sid = typeof claims.session_id === "string" ? claims.session_id : null;
  const exp = typeof claims.exp === "number" && Number.isFinite(claims.exp) ? claims.exp : null;
  return { sub: claims.sub, sid, exp };
}

/** Proxy: подписанное значение заголовка для рендера этого запроса. */
export async function createAccessHandoff(
  requestId: string,
  claims: JwtPayload,
  rows: AccessHandoffRows,
  now = Date.now(),
): Promise<string | null> {
  const binding = claimBinding(claims);
  if (!binding) return null;
  const payload: AccessHandoffPayload = { v: 1, rid: requestId, ...binding, iat: now, ...rows };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  if (body.length > MAX_HEADER_LENGTH) return null;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await processKey(), new TextEncoder().encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/**
 * Рендер: строки, проверенные proxy в этом же запросе, или null — тогда
 * вызывающий делает прежний живой RPC.
 */
export async function verifyAccessHandoff(
  value: string | null | undefined,
  requestId: string | null | undefined,
  claims: JwtPayload,
  now = Date.now(),
): Promise<AccessHandoffRows | null> {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_HEADER_LENGTH + 100) return null;
  if (typeof requestId !== "string" || requestId.length === 0) return null;
  const binding = claimBinding(claims);
  if (!binding) return null;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes || signatureBytes.length !== 32) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await processKey(), signatureBytes, new TextEncoder().encode(body));
  } catch {
    return null;
  }
  if (!valid) return null;
  const bodyBytes = fromBase64Url(body);
  if (!bodyBytes) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (row.v !== 1 || row.rid !== requestId || row.sub !== binding.sub
    || row.sid !== binding.sid || row.exp !== binding.exp
    || typeof row.iat !== "number" || !Number.isFinite(row.iat)
    || row.iat > now + 1_000 || now - row.iat > ACCESS_HANDOFF_MAX_AGE_MS) return null;
  const rows: { staff?: unknown; actor?: unknown; cases?: unknown } = {};
  if (Object.hasOwn(row, "staff")) rows.staff = row.staff;
  if (Object.hasOwn(row, "actor")) rows.actor = row.actor;
  if (Object.hasOwn(row, "cases")) rows.cases = row.cases;
  return rows;
}
