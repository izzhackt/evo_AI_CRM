import { PRODUCTION_STAFF_ORIGIN, PRODUCTION_STUDENT_ORIGIN } from "./platform-public-origin.ts";

export const LOCAL_STUDENT_INVITE_CALLBACK_URL =
  "http://127.0.0.1:3000/auth/callback" as const;
export const PRODUCTION_STUDENT_INVITE_CALLBACK_URL =
  `${PRODUCTION_STUDENT_ORIGIN}/auth/callback` as const;

export const STUDENT_INVITE_CSRF_COOKIE = "evo_student_invite_csrf" as const;
export const STUDENT_INVITE_CSRF_FIELD = "csrf_token" as const;

const TOKEN_HASH_PATTERN = /^[0-9a-f]{56}$/;
// Recovery may come from the iPhone SDK, which defaults to PKCE; Auth then
// stores and mails the same SHA-224 hash with a fixed `pkce_` prefix.
const RECOVERY_TOKEN_HASH_PATTERN = /^(?:pkce_)?[0-9a-f]{56}$/;
const CSRF_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type CallbackQuery = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export type StudentInviteCallbackInput = Readonly<{
  tokenHash: string;
  type: "invite";
}>;

/** Password recovery from the shared Recovery template on the Student origin. */
export type StudentRecoveryCallbackInput = Readonly<{
  tokenHash: string;
  type: "recovery";
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

function isStudentRecoveryTokenHash(value: unknown): value is string {
  return typeof value === "string" && RECOVERY_TOKEN_HASH_PATTERN.test(value);
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

export function staffInviteCallbackUrl(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  localCallbackOrigin?: string,
): string {
  if (nodeEnv === "production") return `${PRODUCTION_STAFF_ORIGIN}/auth/staff`;
  return new URL("/auth/staff", studentInviteCallbackUrl(nodeEnv, localCallbackOrigin)).toString();
}

function exactCallbackQuery(query: CallbackQuery): boolean {
  const keys = Object.keys(query);
  return keys.length === 2 && keys.includes("token_hash") && keys.includes("type");
}

export function decodeStudentInviteCallbackQuery(
  query: CallbackQuery,
): StudentInviteCallbackInput | null {
  if (
    !exactCallbackQuery(query) ||
    !isStudentInviteTokenHash(query.token_hash) ||
    query.type !== "invite"
  ) {
    return null;
  }

  return { tokenHash: query.token_hash, type: "invite" };
}

/** Exactly the link the Recovery template builds: `?token_hash=…&type=recovery`. */
export function decodeStudentRecoveryCallbackQuery(
  query: CallbackQuery,
): StudentRecoveryCallbackInput | null {
  if (
    !exactCallbackQuery(query) ||
    !isStudentRecoveryTokenHash(query.token_hash) ||
    query.type !== "recovery"
  ) {
    return null;
  }

  return { tokenHash: query.token_hash, type: "recovery" };
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

export type StudentOriginRequest = Pick<
  StudentInviteCallbackPost,
  "nodeEnv" | "localCallbackOrigin" | "origin" | "host" | "forwardedHost" | "forwardedProto"
>;

/**
 * Explicit defense in addition to Next.js' own Server Action Origin versus
 * Host/X-Forwarded-Host comparison. A forwarded pair is accepted only when
 * both values are present and match the one frozen public origin.
 *
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
 */
export function isExpectedStudentOriginRequest(input: StudentOriginRequest): boolean {
  let expected: URL;
  try {
    expected = new URL(studentInviteCallbackUrl(input.nodeEnv, input.localCallbackOrigin));
  } catch {
    return false;
  }
  const origin = exactHeader(input.origin);
  const host = exactHeader(input.host);
  const forwardedHost = exactHeader(input.forwardedHost);
  const forwardedProto = exactHeader(input.forwardedProto);
  const hasForwardedHost = input.forwardedHost !== null;
  const hasForwardedProto = input.forwardedProto !== null;

  return !(
    origin !== expected.origin ||
    host === null ||
    hasForwardedHost !== hasForwardedProto ||
    (hasForwardedHost &&
      (forwardedHost !== expected.host ||
        forwardedProto !== expected.protocol.slice(0, -1))) ||
    (!hasForwardedHost && host !== expected.host)
  );
}

function validateCallbackPost(
  input: StudentInviteCallbackPost,
  type: "invite" | "recovery",
  isTokenHash: (value: unknown) => value is string,
): string | null {
  if (
    !isExpectedStudentOriginRequest(input) ||
    input.form.size !== 3 ||
    !sameCsrfToken(
      input.csrfCookie,
      input.form.get(STUDENT_INVITE_CSRF_FIELD),
    ) ||
    !isTokenHash(input.form.get("token_hash")) ||
    input.form.get("type") !== type
  ) {
    return null;
  }
  return input.form.get("token_hash") as string;
}

export function validateStudentInviteCallbackPost(
  input: StudentInviteCallbackPost,
): StudentInviteCallbackInput | null {
  const tokenHash = validateCallbackPost(input, "invite", isStudentInviteTokenHash);
  return tokenHash === null ? null : { tokenHash, type: "invite" };
}

/** The same CSRF-bound interstitial POST, for a recovery link only. */
export function validateStudentRecoveryCallbackPost(
  input: StudentInviteCallbackPost,
): StudentRecoveryCallbackInput | null {
  const tokenHash = validateCallbackPost(input, "recovery", isStudentRecoveryTokenHash);
  return tokenHash === null ? null : { tokenHash, type: "recovery" };
}
