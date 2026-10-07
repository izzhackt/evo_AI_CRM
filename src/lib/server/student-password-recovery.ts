import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import {
  createClient,
  type JwtPayload,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getSupabasePublicConfig } from "../supabase/config.ts";
import { readVerifiedPlatformAuthority } from "../supabase/platform-authority.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import {
  classifyStudentRecoveryRequestError,
  hasStaffRecoveryMarker,
  STUDENT_PASSWORD_RESET_PATH,
  STUDENT_RECOVERY_SESSION_COOKIE,
  STUDENT_RECOVERY_SESSION_MAX_AGE_SECONDS,
  type StudentRecoveryPasswordState,
  type StudentRecoveryRequestState,
} from "../student-password-recovery-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CookieStore = Awaited<ReturnType<typeof cookies>>;
type CookieWrite = Readonly<{ name: string; value: string; options: CookieOptions }>;

function recoveryCookieOptions(remove: boolean): CookieOptions {
  return {
    path: STUDENT_PASSWORD_RESET_PATH,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: remove ? 0 : STUDENT_RECOVERY_SESSION_MAX_AGE_SECONDS,
  };
}

function isRecoveryCookieName(name: string): boolean {
  return (
    name === STUDENT_RECOVERY_SESSION_COOKIE ||
    name.startsWith(`${STUDENT_RECOVERY_SESSION_COOKIE}.`) ||
    name.startsWith(`${STUDENT_RECOVERY_SESSION_COOKIE}-`)
  );
}

function errorFields(error: unknown) {
  const value =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  return {
    code:
      typeof value.code === "string" && /^[A-Za-z0-9_]{1,64}$/u.test(value.code)
        ? value.code
        : null,
    name:
      typeof value.name === "string" && /^[A-Za-z0-9_]{1,64}$/u.test(value.name)
        ? value.name
        : null,
    status:
      typeof value.status === "number" && Number.isInteger(value.status)
        ? value.status
        : null,
  };
}

/** Structured, PII-free log line: never the address, token or password. */
export function logStudentRecoveryFailure(stage: string, error?: unknown): void {
  console.warn(
    JSON.stringify({
      event: "student_password_recovery_rejected",
      stage,
      ...errorFields(error),
      service: "evo-crm",
    }),
  );
}

/** No cookie adapter, verifier storage or persisted session. */
function isolatedClient(): SupabaseClient {
  const config = getSupabasePublicConfig();
  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // Implicit: the emailed token hash then works on any device, with no
      // PKCE verifier tied to the browser that asked for the email.
      flowType: "implicit",
    },
  });
}

/**
 * The recovery-only Supabase session. It is stored under its own storage key
 * on the new-password path only; product pages and the proxy never see it.
 */
function recoveryCookieClient(
  store: CookieStore | null,
  write: ((items: readonly CookieWrite[]) => void) | null,
): SupabaseClient {
  const config = getSupabasePublicConfig();
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: { name: STUDENT_RECOVERY_SESSION_COOKIE },
    auth: { autoRefreshToken: false },
    cookies: {
      getAll() {
        return store === null
          ? []
          : store.getAll().filter(({ name }) => isRecoveryCookieName(name));
      },
      setAll(items) {
        write?.(items);
      },
    },
  });
}

function writeRecoveryCookies(store: CookieStore, items: readonly CookieWrite[]): void {
  for (const { name, value } of items) {
    if (!isRecoveryCookieName(name)) continue;
    store.set(name, value, recoveryCookieOptions(value.length === 0));
  }
}

export function clearStudentRecoveryCookies(store: CookieStore): void {
  for (const { name } of store.getAll()) {
    if (isRecoveryCookieName(name)) {
      store.set(name, "", recoveryCookieOptions(true));
    }
  }
}

async function revokeSession(client: SupabaseClient, stage: string): Promise<void> {
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) logStudentRecoveryFailure(stage, error);
  } catch (error) {
    logStudentRecoveryFailure(stage, error);
  }
}

type RecoveryIdentity =
  | Readonly<{ status: "student"; user: User & { email: string }; claims: JwtPayload }>
  | Readonly<{ status: "staff" | "invalid" | "unavailable" }>;

/**
 * Reads the live Auth user behind one access token and refuses staff: the
 * protected provisioning markers, a non-Student `platform_role` claim, or a
 * live staff access snapshot. Unknown answers fail closed.
 */
async function classifyRecoveryIdentity(
  client: SupabaseClient,
  accessToken: string,
  expectedUserId?: string,
): Promise<RecoveryIdentity> {
  const live = await client.auth.getUser(accessToken);
  if (live.error || !live.data.user) {
    const status = live.error?.status;
    return status === 401 || status === 403 || live.error?.name === "AuthSessionMissingError"
      ? { status: "invalid" }
      : { status: "unavailable" };
  }
  const user = live.data.user;
  if (
    !UUID_PATTERN.test(user.id) ||
    typeof user.email !== "string" ||
    user.email.length === 0 ||
    user.is_anonymous ||
    (expectedUserId !== undefined && user.id !== expectedUserId)
  ) {
    return { status: "invalid" };
  }
  const claimsResult = await client.auth.getClaims(accessToken);
  const claims = claimsResult.data?.claims;
  if (claimsResult.error || !claims || claims.sub !== user.id) {
    return { status: "unavailable" };
  }
  if (hasStaffRecoveryMarker(user, claims)) return { status: "staff" };
  const staff = await readVerifiedPlatformAuthority(client, claims);
  if (staff.status === "authenticated") return { status: "staff" };
  if (staff.status === "unavailable") return { status: "unavailable" };
  return { status: "student", user: user as User & { email: string }, claims };
}

/**
 * Asks Auth to email a recovery link. `redirectTo` is built by the caller
 * from the fixed Student origin, never from request input.
 */
export async function requestStudentPasswordRecovery(
  email: string,
  redirectTo: string,
): Promise<StudentRecoveryRequestState["status"]> {
  try {
    const { error } = await isolatedClient().auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) logStudentRecoveryFailure("request", error);
    return classifyStudentRecoveryRequestError(error);
  } catch (error) {
    logStudentRecoveryFailure("request", error);
    return "unavailable";
  }
}

export type StudentRecoveryLinkResult =
  | Readonly<{ status: "verified"; session: Session; authUserId: string }>
  | Readonly<{
      status: "expired_or_used" | "staff_refused" | "invalid_identity" | "unavailable";
    }>;

/** Consumes the one-time token only after the explicit interstitial POST. */
export async function verifyStudentPasswordRecoveryLink(
  tokenHash: string,
): Promise<StudentRecoveryLinkResult> {
  const client = isolatedClient();
  let session: Session;
  try {
    const { data, error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (error || !data.session) {
      logStudentRecoveryFailure("verify", error);
      const { code, status } = errorFields(error);
      if (code === "otp_expired" || code === "otp_disabled") return { status: "expired_or_used" };
      return status !== null && status >= 400 && status < 500 && status !== 429
        ? { status: "expired_or_used" }
        : { status: "unavailable" };
    }
    session = data.session;
  } catch (error) {
    logStudentRecoveryFailure("verify", error);
    return { status: "unavailable" };
  }

  let identity: RecoveryIdentity;
  try {
    identity = await classifyRecoveryIdentity(client, session.access_token);
  } catch (error) {
    logStudentRecoveryFailure("verify_identity", error);
    identity = { status: "unavailable" };
  }
  if (identity.status === "student") {
    return { status: "verified", session, authUserId: identity.user.id };
  }
  // The verified session never leaves this function unless it is a Student's.
  await revokeSession(client, "verify_revoke");
  if (identity.status === "staff") {
    logStudentRecoveryFailure("staff_refused");
    return { status: "staff_refused" };
  }
  return identity.status === "invalid"
    ? { status: "invalid_identity" }
    : { status: "unavailable" };
}

/** Stores the verified recovery session only in the path-scoped cookie. */
export async function commitStudentRecoverySession(
  session: Session,
  expectedUserId: string,
): Promise<void> {
  const store = await cookies();
  const staged = new Map<string, CookieWrite>();
  // Stage first: nothing reaches the browser unless the session is accepted.
  const client = recoveryCookieClient(null, (items) => {
    for (const item of items) staged.set(item.name, item);
  });
  const { data, error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error || data.user?.id !== expectedUserId || staged.size === 0) {
    throw new Error("Recovery session unavailable.");
  }
  clearStudentRecoveryCookies(store);
  writeRecoveryCookies(store, [...staged.values()]);
}

export type StudentRecoverySessionView =
  | Readonly<{ status: "ready"; email: string }>
  | Readonly<{ status: "missing" | "unavailable" }>;

/** Read-only view for the new-password page; it never writes cookies. */
export async function readStudentRecoverySession(): Promise<StudentRecoverySessionView> {
  const store = await cookies();
  if (!store.getAll().some(({ name }) => isRecoveryCookieName(name))) {
    return { status: "missing" };
  }
  try {
    const client = recoveryCookieClient(store, null);
    const { data } = await client.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return { status: "missing" };
    const live = await client.auth.getUser(accessToken);
    if (live.error || !live.data.user?.email) {
      const status = live.error?.status;
      return status === 401 || status === 403 || live.error?.name === "AuthSessionMissingError"
        ? { status: "missing" }
        : { status: "unavailable" };
    }
    return { status: "ready", email: live.data.user.email };
  } catch (error) {
    logStudentRecoveryFailure("read_session", error);
    return { status: "unavailable" };
  }
}

/**
 * Sets the new password with the recovery session, ends that session and
 * signs the Student in with the new password as an ordinary product session.
 */
export async function completeStudentPasswordRecovery(
  password: string,
): Promise<StudentRecoveryPasswordState["status"]> {
  const store = await cookies();
  const client = recoveryCookieClient(store, (items) => writeRecoveryCookies(store, items));
  let email: string;
  try {
    const { data } = await client.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      clearStudentRecoveryCookies(store);
      return "expired";
    }
    const identity = await classifyRecoveryIdentity(client, accessToken);
    if (identity.status !== "student") {
      if (identity.status === "unavailable") return "unavailable";
      if (identity.status === "staff") {
        await revokeSession(client, "complete_revoke_staff");
        logStudentRecoveryFailure("staff_refused");
      }
      clearStudentRecoveryCookies(store);
      return identity.status === "staff" ? "staff_refused" : "expired";
    }
    email = identity.user.email;

    const { error } = await client.auth.updateUser({ password });
    if (error) {
      logStudentRecoveryFailure("update_password", error);
      const { code, status, name } = errorFields(error);
      if (code === "same_password") return "same_password";
      if (code === "weak_password") return "rejected";
      if (
        status === 401 ||
        status === 403 ||
        code === "session_not_found" ||
        name === "AuthSessionMissingError"
      ) {
        clearStudentRecoveryCookies(store);
        return "expired";
      }
      return status !== null && status >= 400 && status < 500 ? "rejected" : "unavailable";
    }
  } catch (error) {
    logStudentRecoveryFailure("complete", error);
    return "unavailable";
  }

  // The recovery session can only set a password: end it before anything else.
  await revokeSession(client, "complete_revoke");
  clearStudentRecoveryCookies(store);

  try {
    const product = await createSupabaseServerClient();
    const signIn = await product.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) {
      logStudentRecoveryFailure("sign_in", signIn.error);
      return "sign_in_required";
    }
    const identity = await classifyRecoveryIdentity(
      product,
      signIn.data.session.access_token,
      signIn.data.user?.id,
    );
    if (identity.status !== "student") {
      await revokeSession(product, "sign_in_revoke");
      return identity.status === "staff" ? "staff_refused" : "sign_in_required";
    }
  } catch (error) {
    logStudentRecoveryFailure("sign_in", error);
    return "sign_in_required";
  }
  return "done";
}
