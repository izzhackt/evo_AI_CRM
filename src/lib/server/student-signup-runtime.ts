import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { PRODUCTION_STAFF_ORIGIN } from "../platform-public-origin";
import { readVerifiedPlatformAuthority } from "../supabase/platform-authority";
import { readVerifiedStudentPortalAuthority } from "../supabase/student-portal-authority";
import { STUDENT_APPLICATION_METADATA_KEY, validateStudentApplicationDraft } from "../student-application-contract";
import { readOwnStudentApplication, submitStudentApplication } from "../v3/student-application-source";

/** The staff provisioner writes this protected marker; users cannot set it. */
export function isPasswordProvisionedStaff(user: Pick<User, "app_metadata">): boolean {
  return typeof user.app_metadata?.evo_staff_password_request_id === "string"
    && user.app_metadata.evo_staff_password_request_id.length > 0;
}

/** Route existing access using current Auth claims and database authority. */
export async function studentApplicationEntryRedirect(client: SupabaseClient, user: User): Promise<string | null> {
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims || data.claims.sub !== user.id) throw new Error("Student registration is unavailable.");
  const staff = await readVerifiedPlatformAuthority(client, data.claims);
  if (staff.status === "authenticated") return `${PRODUCTION_STAFF_ORIGIN}/`;
  if (staff.status === "unavailable") throw new Error("Student registration is unavailable.");
  if (isPasswordProvisionedStaff(user)) return `${PRODUCTION_STAFF_ORIGIN}/login?error=staffAccessDenied`;
  const portal = await readVerifiedStudentPortalAuthority(client, data.claims);
  if (portal.status === "unavailable") throw new Error("Student registration is unavailable.");
  return portal.status === "authenticated" ? "/portal" : null;
}

export function logStudentSignupFailure(stage: string, error?: unknown): void {
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof details.code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(details.code) ? details.code : null;
  const name = typeof details.name === "string" && /^[A-Za-z0-9_]{1,64}$/.test(details.name) ? details.name : null;
  const status = typeof details.status === "number" && Number.isInteger(details.status) ? details.status : null;
  console.warn(JSON.stringify({ event: "student_signup_rejected", stage, code, name, status }));
}

/**
 * Only a live Auth identity can claim its own questionnaire. Server-created
 * accounts have an Auth confirmation timestamp, not proof of mailbox ownership.
 */
export async function resumeStudentApplication(client: SupabaseClient, expectedAuthUserId?: string): Promise<"saved" | "needs_draft" | "unverified"> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email_confirmed_at || !data.user.email || isPasswordProvisionedStaff(data.user)
    || (expectedAuthUserId !== undefined && data.user.id !== expectedAuthUserId)) {
    logStudentSignupFailure("identity", error);
    return "unverified";
  }
  let existing;
  try { existing = await readOwnStudentApplication(client); }
  catch (readError) { logStudentSignupFailure("read_application", readError); throw readError; }
  if (existing) return "saved";
  const draft = validateStudentApplicationDraft(data.user.user_metadata?.[STUDENT_APPLICATION_METADATA_KEY]);
  if (!draft) return "needs_draft";
  try { await submitStudentApplication(client, draft); }
  catch (submitError) { logStudentSignupFailure("submit_application", submitError); throw submitError; }
  // The committed business row wins even if metadata cleanup is interrupted.
  try {
    const cleanup = await client.auth.updateUser({ data: { [STUDENT_APPLICATION_METADATA_KEY]: null } });
    if (cleanup.error) logStudentSignupFailure("metadata_cleanup", cleanup.error);
  } catch (cleanupError) { logStudentSignupFailure("metadata_cleanup", cleanupError); }
  return "saved";
}
