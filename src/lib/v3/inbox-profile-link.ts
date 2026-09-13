import type { ActivePlatformActor } from "../platform-auth.ts";
import { staffPresentationCan } from "../platform-access.ts";

export type V3InboxCanonicalContext = Readonly<{
  leadId: string | null;
  studentCaseId: string | null;
}>;

export function v3InboxProfileHref(
  actor: ActivePlatformActor,
  context: V3InboxCanonicalContext,
): string | null {
  if (
    staffPresentationCan(actor, "sales.read") &&
    context.leadId
  ) {
    return `/v3/profile?id=${context.leadId}`;
  }
  if (staffPresentationCan(actor, "admissions.read") && context.studentCaseId) {
    return `/v3/profile?case=${context.studentCaseId}`;
  }
  return null;
}
