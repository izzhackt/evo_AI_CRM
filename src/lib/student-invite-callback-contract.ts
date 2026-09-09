export const LOCAL_STUDENT_INVITE_CALLBACK_URL =
  "http://127.0.0.1:3000/auth/callback" as const;
export const PRODUCTION_STUDENT_INVITE_CALLBACK_URL =
  "https://evo-crm.72.62.119.112.sslip.io/auth/callback" as const;

export const STUDENT_INVITE_CSRF_COOKIE = "evo_student_invite_csrf" as const;
export const STUDENT_INVITE_CSRF_FIELD = "csrf_token" as const;

const TOKEN_HASH_PATTERN = /^[0-9a-f]{56}$/;
const CSRF_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type CallbackQuery = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export type StudentInviteCallbackInput = Readonly<{
  tokenHash: string;
  type: "invite";
}>;

export type StudentInviteCallbackPost = Readonly<{
  nodeEnv: string | undefined;
  localCallbackOrigin?: string;
  origin: string | null;
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
  csrfCookie: string | null;
  form: ReadonlyMap<string, string>;
}>;

/**
 * Supabase Auth currently generates TokenHash as lower-case SHA-224 hex.
 * Keep this bounded to the provider's real wire format instead of forwarding
 * arbitrary query material to Auth.
 *
 * @see https://github.com/supabase/auth/blob/master/internal/crypto/crypto.go
 */
function isStudentInviteTokenHash(value: unknown): value is string {
  return typeof value === "string" && TOKEN_HASH_PATTERN.test(value);
}

export function isStudentInviteCsrfToken(value: unknown): value is string {
  return typeof value === "string" && CSRF_TOKEN_PATTERN.test(value);
}

export function studentInviteCallbackUrl(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  localCallbackOrigin?: string,
): string {
  // Production cannot be redirected by a local proof/development setting.
  if (nodeEnv === "production") return PRODUCTION_STUDENT_INVITE_CALLBACK_URL;
  if (localCallbackOrigin === undefined) return LOCAL_STUDENT_INVITE_CALLBACK_URL;
  // Deliberately do not normalize URLs: reject host aliases, paths, credentials,
  // query/fragment material and privileged ports instead of widening authority.
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})$/.exec(localCallbackOrigin);
  const port = match ? Number(match[1]) : 0;
  if (match?.[0] !== localCallbackOrigin || port < 1024 || port > 65535) {
    throw new Error("Invalid local Student invite callback origin.");
  }
  return `${localCallbackOrigin}/auth/callback`;
}

export function decodeStudentInviteCallbackQuery(
  query: CallbackQuery,
): StudentInviteCallbackInput | null {
  const keys = Object.keys(query);
  if (
    keys.length !== 2 ||
    !keys.includes("token_hash") ||
    !keys.includes("type") ||
    !isStudentInviteTokenHash(query.token_hash) ||
    query.type !== "invite"
  ) {
    return null;
  }

  return { tokenHash: query.token_hash, type: "invite" };
}

function exactHeader(value: string | null): string | null {
  if (value === null || value.length === 0 || value !== value.trim()) return null;
  return value.includes(",") ? null : value;
}

function sameCsrfToken(cookieValue: string | null, formValue: string | undefined) {
  if (
    !isStudentInviteCsrfToken(cookieValue) ||
    !isStudentInviteCsrfToken(formValue)
  ) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < cookieValue.length; index += 1) {
    difference |= cookieValue.charCodeAt(index) ^ formValue.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Explicit defense in addition to Next.js' own Server Action Origin versus
 * Host/X-Forwarded-Host comparison. A forwarded pair is accepted only when
 * both values are present and match the one frozen public origin.
 *
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
 */
export function validateStudentInviteCallbackPost(
  input: StudentInviteCallbackPost,
): StudentInviteCallbackInput | null {
  let expected: URL;
  try {
    expected = new URL(studentInviteCallbackUrl(input.nodeEnv, input.localCallbackOrigin));
  } catch {
    return null;
  }
  const origin = exactHeader(input.origin);
  const host = exactHeader(input.host);
  const forwardedHost = exactHeader(input.forwardedHost);
  const forwardedProto = exactHeader(input.forwardedProto);
  const hasForwardedHost = input.forwardedHost !== null;
  const hasForwardedProto = input.forwardedProto !== null;

  if (
    origin !== expected.origin ||
    host === null ||
    hasForwardedHost !== hasForwardedProto ||
    (hasForwardedHost &&
      (forwardedHost !== expected.host ||
        forwardedProto !== expected.protocol.slice(0, -1))) ||
    (!hasForwardedHost && host !== expected.host) ||
    input.form.size !== 3 ||
    !sameCsrfToken(
      input.csrfCookie,
      input.form.get(STUDENT_INVITE_CSRF_FIELD),
    ) ||
    !isStudentInviteTokenHash(input.form.get("token_hash")) ||
    input.form.get("type") !== "invite"
  ) {
    return null;
  }

  return {
    tokenHash: input.form.get("token_hash") as string,
    type: "invite",
  };
}
