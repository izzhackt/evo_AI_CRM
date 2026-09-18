import { staffHomeRoute } from "@/lib/platform-access";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { resolvePlatformActor } from "@/lib/platform-auth";
import { createStudentInviteSessionRuntime } from "@/lib/server/student-invite-session-runtime";
import { readVerifiedStudentInviteSession } from "@/lib/server/student-invite-session";
import { resolveStudentPortalActor } from "@/lib/student-portal-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readOwnStudentApplication } from "@/lib/v3/student-application-source";
import { platformAudienceForHost, platformAudienceHomeRoute } from "@/lib/platform-public-origin";

async function resolveEvoHomeRoute(): Promise<string> {
  const host = (await headers()).get("host");
  const staff = await resolvePlatformActor();
  if (staff.status === "authenticated") {
    const actor = staff.actor;
    return platformAudienceHomeRoute(host, "staff", staffHomeRoute(actor));
  }
  if (
    staff.status === "invalid" &&
    staff.reason === "staff_authority_unavailable"
  ) {
    return "/login?error=auth_unavailable";
  }

  const student = await resolveStudentPortalActor();
  if (student.status === "authenticated") return platformAudienceHomeRoute(host, "student", "/portal");
  if (
    student.status === "invalid" &&
    student.reason === "student_authority_unavailable"
  ) {
    return "/login?error=auth_unavailable";
  }
  if (staff.status === "anonymous" && student.status === "anonymous") {
    return platformAudienceForHost(host) === "student" ? "/apply" : "/login";
  }

  try {
    const { sessionClient, receiptStore } =
      await createStudentInviteSessionRuntime();
    const invite = await readVerifiedStudentInviteSession(
      sessionClient,
      receiptStore,
    );
    if (invite.status === "unavailable") {
      return "/login?error=auth_unavailable";
    }
    if (invite.status === "authenticated" && invite.receipt.accountPending) {
      return platformAudienceHomeRoute(host, "student", "/auth/account-pending");
    }
  } catch {
    return "/login?error=auth_unavailable";
  }
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.getUser();
    if (!error && data.user?.email_confirmed_at) {
      const application = await readOwnStudentApplication(client);
      return platformAudienceHomeRoute(host, "student", application ? "/apply/status" : "/apply");
    }
  } catch { return "/login?error=auth_unavailable"; }
  return "/login?error=session_invalid";
}

/** Dispatch one verified identity to exactly one EVO product surface. */
export default async function Home() {
  redirect(await resolveEvoHomeRoute());
}
