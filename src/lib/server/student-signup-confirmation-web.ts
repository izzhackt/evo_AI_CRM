import "server-only";
import { cookies, headers } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type Session } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "../supabase/config.ts";
import { readVerifiedPlatformAuthority } from "../supabase/platform-authority.ts";
import { readVerifiedStudentPortalAuthority } from "../supabase/student-portal-authority.ts";
import type { NativeSignupPending, NativeSignupResendResult, SignupPending, SignupResendResult } from "../student-signup-confirmation-state.ts";
import { studentSignupConfirmationUrl } from "../student-signup-confirmation-contract.ts";
import { inspectStudentSignup } from "./student-signup-confirmation-runtime.ts";
import { readSignupSessionAccessToken } from "./student-signup-session-cookie.ts";
import { isPasswordProvisionedStaff } from "./student-signup-runtime.ts";

export const SIGNUP_PENDING_COOKIE = "evo_student_signup_pending";
const pendingCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/apply" };

export function signupPublicState(result: NativeSignupResendResult): SignupResendResult {
  if (result.status !== "pending_confirmation") return result;
  return { status: result.status, maskedEmail: result.maskedEmail, expiresAt: result.expiresAt,
    retryAfterSeconds: result.retryAfterSeconds, dispatch: result.dispatch };
}
export async function rememberStudentSignup(result: NativeSignupPending): Promise<SignupPending> {
  (await cookies()).set(SIGNUP_PENDING_COOKIE, result.resendCapability, {
    ...pendingCookieOptions, expires: new Date(result.expiresAt),
  });
  return signupPublicState(result) as SignupPending;
}
export async function readPendingStudentSignup(): Promise<SignupResendResult | null> {
  const cap = (await cookies()).get(SIGNUP_PENDING_COOKIE)?.value;
  return cap ? signupPublicState(await inspectStudentSignup(cap)) : null;
}
export async function clearPendingStudentSignup() {
  (await cookies()).set(SIGNUP_PENDING_COOKIE, "", { ...pendingCookieOptions, maxAge: 0 });
}
export async function validSignupOrigin(): Promise<boolean> {
  const h = await headers();
  const expected = new URL(studentSignupConfirmationUrl(process.env.NODE_ENV, process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN));
  const host = h.get("host"), forwardedHost = h.get("x-forwarded-host"), proto = h.get("x-forwarded-proto");
  return h.get("origin") === expected.origin && host !== null
    && (forwardedHost === null && proto === null ? host === expected.host : forwardedHost === expected.host && proto === expected.protocol.slice(0, -1));
}

/** Before OTP, even an expired foreign session must not rotate through SSR refresh. */
export async function readSignupCurrentIdentity() {
  const config = getSupabasePublicConfig();
  const token = await readSignupSessionAccessToken((await cookies()).getAll(), config.url);
  if (token.status === "absent") return { status: "ready" as const, user: null };
  if (token.status === "invalid") return { status: "unavailable" as const };
  const client = createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.getUser(token.accessToken);
  return error || !data.user ? { status: "unavailable" as const } : { status: "ready" as const, user: data.user };
}

/** Stage session cookies until fresh Auth identity AND DB authority accept this account. */
export async function commitStudentSignupSession(session: Session | null, expectedId: string) {
  const config = getSupabasePublicConfig();
  const store = await cookies();
  const staged = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const client = createServerClient(config.url, config.publishableKey, { auth: { autoRefreshToken: false }, cookies: {
    getAll: () => store.getAll(),
    setAll: (items) => { for (const item of items) staged.set(item.name, item); },
  } });
  if (session) {
    const { error } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (error) throw new Error("Signup session unavailable.");
  }
  const identity = await client.auth.getUser();
  if (identity.error || identity.data.user?.id !== expectedId || !identity.data.user.email_confirmed_at
    || identity.data.user.is_anonymous || identity.data.user.invited_at || isPasswordProvisionedStaff(identity.data.user)) throw new Error("Signup identity unavailable.");
  const claims = await client.auth.getClaims();
  if (claims.error || claims.data?.claims.sub !== expectedId) throw new Error("Signup claims unavailable.");
  const staff = await readVerifiedPlatformAuthority(client, claims.data.claims);
  if (staff.status === "authenticated" || staff.status === "unavailable") throw new Error("Signup authority unavailable.");
  const portal = await readVerifiedStudentPortalAuthority(client, claims.data.claims);
  if (portal.status === "unavailable") throw new Error("Signup authority unavailable.");
  for (const { name, value, options } of staged.values()) store.set(name, value, options);
  return { client, destination: portal.status === "authenticated" ? "/portal" : null };
}
