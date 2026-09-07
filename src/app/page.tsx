import { redirect } from "next/navigation";

import { fixedRoleHomeRoute } from "@/lib/fixed-role-policy";
import { resolvePlatformActor } from "@/lib/platform-auth";
import { createStudentInviteSessionRuntime } from "@/lib/server/student-invite-session-runtime";
import { readVerifiedStudentInviteSession } from "@/lib/server/student-invite-session";
import { resolveStudentPortalActor } from "@/lib/student-portal-auth";

async function resolveEvoHomeRoute(): Promise<string> {
  const staff = await resolvePlatformActor();
  if (staff.status === "authenticated") {
    const actor = staff.actor;
    return fixedRoleHomeRoute(actor.presentationRole);
  }
  if (
    staff.status === "invalid" &&
    staff.reason === "staff_authority_unavailable"
  ) {
    return "/login?error=auth_unavailable";
  }

  const student = await resolveStudentPortalActor();
  if (student.status === "authenticated") return "/portal";
  if (
    student.status === "invalid" &&
    student.reason === "student_authority_unavailable"
  ) {
    return "/login?error=auth_unavailable";
  }
  if (staff.status === "anonymous" && student.status === "anonymous") {
    return "/login";
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
      return "/auth/account-pending";
    }
  } catch {
    return "/login?error=auth_unavailable";
  }
  return "/login?error=session_invalid";
}

/** Dispatch one verified identity to exactly one EVO product surface. */
export default async function Home() {
  redirect(await resolveEvoHomeRoute());
}
