import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { STUDENT_APPLICATION_METADATA_KEY, validateStudentApplicationDraft } from "../student-application-contract";
import { readOwnStudentApplication, submitStudentApplication } from "../v3/student-application-source";

/** The staff provisioner writes this protected marker; users cannot set it. */
export function isPasswordProvisionedStaff(user: Pick<User, "app_metadata">): boolean {
  return typeof user.app_metadata?.evo_staff_password_request_id === "string"
    && user.app_metadata.evo_staff_password_request_id.length > 0;
}

/** Only a live verified Auth identity can claim its own questionnaire. */
export async function resumeStudentApplication(client: SupabaseClient): Promise<"saved" | "needs_draft" | "unverified"> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email_confirmed_at || !data.user.email || isPasswordProvisionedStaff(data.user)) return "unverified";
  const existing = await readOwnStudentApplication(client);
  if (existing) return "saved";
  const draft = validateStudentApplicationDraft(data.user.user_metadata?.[STUDENT_APPLICATION_METADATA_KEY]);
  if (!draft) return "needs_draft";
  await submitStudentApplication(client, draft);
  // The committed business row wins even if metadata cleanup is interrupted.
  await client.auth.updateUser({ data: { [STUDENT_APPLICATION_METADATA_KEY]: null } });
  return "saved";
}
