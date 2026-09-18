"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exactActionStringFields } from "./server/action-form-fields";
import { isPasswordProvisionedStaff, resumeStudentApplication } from "./server/student-signup-runtime";
import { STUDENT_APPLICATION_METADATA_KEY, validateStudentApplicationDraft } from "./student-application-contract";
import { studentInviteCallbackUrl } from "./student-invite-callback-contract";
import { createSupabaseServerClient } from "./supabase/server";
import { readVerifiedStudentPortalAuthority } from "./supabase/student-portal-authority";
import { readOwnStudentApplication, submitStudentApplication } from "./v3/student-application-source";

export type StudentSignupState = { status: "idle" | "invalid" | "password" | "unavailable" | "rate_limit" | "conflict" };

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
      if (!identity.user.email_confirmed_at || identity.user.email?.toLowerCase() !== email
        || isPasswordProvisionedStaff(identity.user)) return { status: "conflict" };
      await submitStudentApplication(client, draft, revision);
      await client.auth.updateUser({ data: { [STUDENT_APPLICATION_METADATA_KEY]: null } });
      saved = true;
    } else {
      if (password.length < 12 || password.length > 128) return { status: "password" };
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { data: { [STUDENT_APPLICATION_METADATA_KEY]: draft } },
      });
      if (error) {
        if (error.status === 429) return { status: "rate_limit" };
        if (error.code === "weak_password") return { status: "password" };
        if (error.code === "user_already_exists" || error.code === "email_exists") return { status: "conflict" };
        return { status: "unavailable" };
      }
      // Autoconfirm must establish a session. A missing session or obfuscated
      // user is not account authority and cannot submit an application.
      if (!data.session) return { status: "unavailable" };
      saved = await resumeStudentApplication(client) === "saved";
    }
  } catch { return { status: "unavailable" }; }
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
