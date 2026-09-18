"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exactActionStringFields } from "./server/action-form-fields";
import { logStudentSignupFailure, resumeStudentApplication, studentApplicationEntryRedirect } from "./server/student-signup-runtime";
import { createPublicStudentAccount } from "./server/student-public-registration";
import { STUDENT_APPLICATION_METADATA_KEY, validateStudentApplicationDraft } from "./student-application-contract";
import { studentInviteCallbackUrl } from "./student-invite-callback-contract";
import { createSupabaseServerClient } from "./supabase/server";
import { readVerifiedStudentPortalAuthority } from "./supabase/student-portal-authority";
import { readOwnStudentApplication, submitStudentApplication } from "./v3/student-application-source";

export type StudentSignupState = { status: "idle" | "invalid" | "password" | "password_too_long" | "unavailable" | "rate_limit" | "conflict" };

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
  let destination: string | null = null;
  let stage = "identity";
  try {
    const client = await createSupabaseServerClient();
    const { data: identity, error: identityError } = await client.auth.getUser();
    if (identityError && identityError.name !== "AuthSessionMissingError") {
      logStudentSignupFailure(stage, identityError);
      return { status: "unavailable" };
    }
    if (identity.user) {
      if (!identity.user.email_confirmed_at) return { status: "conflict" };
      stage = "entry_authority";
      destination = await studentApplicationEntryRedirect(client, identity.user);
      if (!destination) {
        if (identity.user.email?.toLowerCase() !== email) return { status: "conflict" };
        stage = "submit_application";
        await submitStudentApplication(client, draft, revision);
        try {
          const cleanup = await client.auth.updateUser({ data: { [STUDENT_APPLICATION_METADATA_KEY]: null } });
          if (cleanup.error) logStudentSignupFailure("metadata_cleanup", cleanup.error);
        } catch (cleanupError) { logStudentSignupFailure("metadata_cleanup", cleanupError); }
        saved = true;
      }
    } else {
      const created = await createPublicStudentAccount(email, password, draft);
      if (created.status !== "created") return { status: created.status };
      stage = "sign_in";
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        logStudentSignupFailure(stage, error);
        if (error.status === 429) return { status: "rate_limit" };
        return { status: "unavailable" };
      }
      if (!data.session || data.user?.id !== created.authUserId) {
        logStudentSignupFailure("sign_in_identity");
        return { status: "unavailable" };
      }
      stage = "resume_application";
      saved = await resumeStudentApplication(client, created.authUserId) === "saved";
    }
  } catch (error) { logStudentSignupFailure(stage, error); return { status: "unavailable" }; }
  if (destination) redirect(destination);
  if (saved) redirect("/apply/status");
  return { status: "unavailable" };
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
