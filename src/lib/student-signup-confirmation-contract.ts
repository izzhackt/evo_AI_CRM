import { isStudentInviteCsrfToken, studentInviteCallbackUrl } from "./student-invite-callback-contract.ts";

export const STUDENT_SIGNUP_CONFIRMATION_PATH = "/auth/signup-confirmation" as const;
export const STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE = "evo_student_signup_confirmation_csrf" as const;
export const STUDENT_SIGNUP_CONFIRMATION_CSRF_FIELD = "csrf_token" as const;
export const STUDENT_SIGNUP_CONFIRMATION_MAX_ENVELOPE_LENGTH = 4096;

export type StudentSignupConfirmationInput = Readonly<{ cap: string; otp: string }>;
export type StudentSignupConfirmationPost = Readonly<{
  nodeEnv: string | undefined;
  localCallbackOrigin?: string;
  origin: string | null;
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
  csrfCookie: string | null;
  /** Pass FormData.entries() directly: a Map would erase duplicate fields. */
  form: Iterable<readonly [string, unknown]>;
  expectedOtpLength: number;
}>;

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function canonicalBase64url(value: string): boolean {
  if (!value.length || /[^A-Za-z0-9_-]/u.test(value) || value.length % 4 === 1) return false;
  const last = BASE64URL.indexOf(value.at(-1)!);
  return value.length % 4 === 2 ? (last & 15) === 0 : value.length % 4 === 3 ? (last & 3) === 0 : true;
}

/** Wire shape only. Authentication, purpose, identity and expiry require server AEAD open. */
export function isStudentSignupConfirmationEnvelope(value: unknown): value is string {
  if (typeof value !== "string" || value.length > STUDENT_SIGNUP_CONFIRMATION_MAX_ENVELOPE_LENGTH) return false;
  const parts = value.split(".");
  return parts.length === 4 && parts[0] === "v1" && parts[1].length === 16 && parts[3].length === 22
    && parts.slice(1).every(canonicalBase64url);
}
function boundedOtp(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 32 && !/[^0-9]/u.test(value);
}

/** Raw location.hash only. Canonical alphabets need no percent decoding or '+' conversion. */
export function parseStudentSignupConfirmationFragment(fragment: unknown): StudentSignupConfirmationInput | null {
  if (typeof fragment !== "string" || fragment.length > STUDENT_SIGNUP_CONFIRMATION_MAX_ENVELOPE_LENGTH + 43
    || !fragment.startsWith("#")) return null;
  const fields = fragment.slice(1).split("&");
  if (fields.length !== 2) return null;
  let cap: string | undefined;
  let otp: string | undefined;
  for (const field of fields) {
    const parts = field.split("=");
    if (parts.length !== 2) return null;
    if (parts[0] === "cap" && cap === undefined) cap = parts[1];
    else if (parts[0] === "otp" && otp === undefined) otp = parts[1];
    else return null;
  }
  return isStudentSignupConfirmationEnvelope(cap) && boundedOtp(otp) ? { cap, otp } : null;
}

export function studentSignupConfirmationUrl(nodeEnv: string | undefined = process.env.NODE_ENV, localCallbackOrigin?: string): string {
  return new URL(studentInviteCallbackUrl(nodeEnv, localCallbackOrigin)).origin + STUDENT_SIGNUP_CONFIRMATION_PATH;
}
function exactHeader(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && !/[\s,\u0000-\u001f\u007f]/u.test(value) ? value : null;
}

export function validateStudentSignupConfirmationPost(input: StudentSignupConfirmationPost): StudentSignupConfirmationInput | null {
  if (!Number.isInteger(input.expectedOtpLength) || input.expectedOtpLength < 1 || input.expectedOtpLength > 32) return null;
  let expected: URL;
  try { expected = new URL(studentSignupConfirmationUrl(input.nodeEnv, input.localCallbackOrigin)); }
  catch { return null; }
  const hasForwardedHost = input.forwardedHost !== null;
  const hasForwardedProto = input.forwardedProto !== null;
  if (exactHeader(input.origin) !== expected.origin || exactHeader(input.host) === null
    || hasForwardedHost !== hasForwardedProto
    || (hasForwardedHost && (exactHeader(input.forwardedHost) !== expected.host
      || exactHeader(input.forwardedProto) !== expected.protocol.slice(0, -1)))
    || (!hasForwardedHost && input.host !== expected.host)) return null;
  const fields = new Map<string, string>();
  try {
    for (const entry of input.form) {
      if (!Array.isArray(entry) || entry.length !== 2) return null;
      const [key, value] = entry;
      if (!["cap", "otp", STUDENT_SIGNUP_CONFIRMATION_CSRF_FIELD].includes(key)
        || fields.has(key) || typeof value !== "string") return null;
      fields.set(key, value);
      if (fields.size > 3) return null;
    }
  } catch { return null; }
  const csrf = fields.get(STUDENT_SIGNUP_CONFIRMATION_CSRF_FIELD);
  const cap = fields.get("cap");
  const otp = fields.get("otp");
  if (fields.size !== 3 || !isStudentInviteCsrfToken(input.csrfCookie) || !isStudentInviteCsrfToken(csrf)
    || !isStudentSignupConfirmationEnvelope(cap) || !boundedOtp(otp) || otp.length !== input.expectedOtpLength) return null;
  let difference = 0;
  for (let i = 0; i < csrf.length; i++) difference |= csrf.charCodeAt(i) ^ input.csrfCookie.charCodeAt(i);
  return difference === 0 ? { cap, otp } : null;
}
