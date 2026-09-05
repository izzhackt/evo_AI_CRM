import type { FixedRole } from "../fixed-role-policy.ts";

export type V3InboxCanonicalContext = Readonly<{
  leadId: string | null;
  studentCaseId: string | null;
}>;

export function v3InboxProfileHref(
  presentationRole: FixedRole,
  context: V3InboxCanonicalContext,
): string | null {
  if (
    (presentationRole === "admin" || presentationRole === "sales") &&
    context.leadId
  ) {
    return `/v3/profile?id=${context.leadId}`;
  }
  if (presentationRole === "admissions" && context.studentCaseId) {
    return `/v3/profile?case=${context.studentCaseId}`;
  }
  return null;
}
