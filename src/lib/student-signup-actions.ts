"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exactActionStringFields } from "./server/action-form-fields";
import { resumeStudentApplication } from "./server/student-signup-runtime";
import { STUDENT_APPLICATION_METADATA_KEY, validateStudentApplicationDraft } from "./student-application-contract";
import { isStudentInviteCsrfToken, STUDENT_INVITE_CSRF_COOKIE, studentInviteCallbackUrl } from "./student-invite-callback-contract";
import { createSupabaseServerClient } from "./supabase/server";
import { readVerifiedStudentPortalAuthority } from "./supabase/student-portal-authority";
import { readOwnStudentApplication, submitStudentApplication } from "./v3/student-application-source";

export type StudentSignupState = { status: "idle" | "check_email" | "invalid" | "password" | "unavailable" | "rate_limit" | "conflict" };
export type StudentConfirmationState = { status: "idle" | "expired" | "invalid" | "unavailable" };

async function validStudentOrigin(): Promise<boolean> {
  const h = await headers();
  const expected = new URL(studentInviteCallbackUrl(process.env.NODE_ENV, process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN));
  const forwardedHost = h.get("x-forwarded-host");
  const forwardedProto = h.get("x-forwarded-proto");
  return h.get("origin") === expected.origin
    && h.get("host") !== null
    && (forwardedHost === null && forwardedProto === null
      ? h.get("host") === expected.host
      : forwardedHost === expected.host && forwardedProto === expected.protocol.slice(0, -1));
}

export async function registerStudentAction(_previous: StudentSignupState, form: FormData): Promise<StudentSignupState> {
  if (!await validStudentOrigin()) return { status: "invalid" };
  const fields = exactActionStringFields(form, ["questionnaire", "email", "password", "expected_revision"]);
  if (!fields || (fields.get("questionnaire")?.length ?? 0) > 12000) return { status: "invalid" };
  let draft;
  try { draft = validateStudentApplicationDraft(JSON.parse(fields.get("questionnaire")!)); } catch { return { status: "invalid" }; }
  const email = fields.get("email")!.trim().toLowerCase();
  const password = fields.get("password")!;
  const revision = Number(fields.get("expected_revision"));
  if (!draft || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
    || !Number.isSafeInteger(revision) || revision < 0) return { status: "invalid" };
  let saved = false;
  try {
    const client = await createSupabaseServerClient();
    const { data: identity, error: identityError } = await client.auth.getUser();
    if (identityError && identityError.name !== "AuthSessionMissingError") return { status: "unavailable" };
    if (identity.user) {
      if (!identity.user.email_confirmed_at || identity.user.email?.toLowerCase() !== email) return { status: "conflict" };
      await submitStudentApplication(client, draft, revision);
      await client.auth.updateUser({ data: { [STUDENT_APPLICATION_METADATA_KEY]: null } });
      saved = true;
    } else {
      if (password.length < 12 || password.length > 128) return { status: "password" };
      const { data, error } = await client.auth.signUp({
        email, password,
        options: {
          emailRedirectTo: `${studentInviteCallbackUrl(process.env.NODE_ENV, process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN)}?flow=signup`,
          data: { [STUDENT_APPLICATION_METADATA_KEY]: draft },
        },
      });
      if (error) {
        if (error.status === 429) return { status: "rate_limit" };
        if (error.code === "weak_password") return { status: "password" };
        return { status: "unavailable" };
      }
      // signUp may return an obfuscated user for an existing email. Never bind
      // application ownership to that response or claim an email was delivered.
      if (data.session) saved = await resumeStudentApplication(client) === "saved";
    }
  } catch { return { status: "unavailable" }; }
  if (saved) redirect("/apply/status");
  return { status: "check_email" };
}

export async function confirmStudentSignupAction(_previous: StudentConfirmationState, form: FormData): Promise<StudentConfirmationState> {
  if (!await validStudentOrigin()) return { status: "invalid" };
  const fields = exactActionStringFields(form, ["csrf_token", "code", "token_hash"]);
  const store = await cookies();
  const csrf = store.get(STUDENT_INVITE_CSRF_COOKIE)?.value;
  if (!fields || !isStudentInviteCsrfToken(csrf) || csrf !== fields.get("csrf_token")) return { status: "invalid" };
  const code = fields.get("code")!;
  const hash = fields.get("token_hash")!;
  if ((!code && !hash) || (code && hash) || (code && !/^[a-zA-Z0-9_-]{20,512}$/.test(code))
    || (hash && !/^[a-f0-9]{56,64}$/.test(hash))) return { status: "invalid" };
  let destination = "/apply";
  try {
    const client = await createSupabaseServerClient();
    const { error } = code
      ? await client.auth.exchangeCodeForSession(code)
      : await client.auth.verifyOtp({ token_hash: hash, type: "signup" });
    if (error) return { status: "expired" };
    const status = await resumeStudentApplication(client);
    if (status === "unverified") return { status: "invalid" };
    if (status === "saved") destination = "/apply/status";
    store.delete(STUDENT_INVITE_CSRF_COOKIE);
  } catch { return { status: "unavailable" }; }
  redirect(destination);
}

export async function refreshStudentApplicationAction(): Promise<StudentSignupState> {
  if (!await validStudentOrigin()) return { status: "invalid" };
  let approved = false;
  try {
    const client = await createSupabaseServerClient();
    const application = await readOwnStudentApplication(client);
    if (!application) return { status: "unavailable" };
    if (application.status === "approved") {
      const { error } = await client.auth.refreshSession();
      if (error) return { status: "unavailable" };
      const { data, error: claimError } = await client.auth.getClaims();
      if (claimError || !data?.claims) return { status: "unavailable" };
      const authority = await readVerifiedStudentPortalAuthority(client, data.claims);
      if (authority.status !== "authenticated") return { status: "unavailable" };
      approved = true;
    }
  } catch { return { status: "unavailable" }; }
  if (approved) redirect("/portal");
  revalidatePath("/apply/status");
  return { status: "idle" };
}
