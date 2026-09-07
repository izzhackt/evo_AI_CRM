import type { StudentPortalActorResult } from "./student-portal-auth.ts";

export function studentPortalGuardDestination(
  result: StudentPortalActorResult,
): "/login" | "/login?error=session_invalid" | "/login?error=auth_unavailable" | null {
  if (result.status === "anonymous") return "/login";
  if (result.status === "authenticated") return null;
  return result.reason === "student_authority_unavailable"
    ? "/login?error=auth_unavailable"
    : "/login?error=session_invalid";
}
