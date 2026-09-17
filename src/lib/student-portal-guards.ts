import { redirect } from "next/navigation";
import { cache } from "react";

import {
  resolveStudentPortalActor,
  type ActiveStudentPortalActor,
} from "./student-portal-auth.ts";
import { studentPortalGuardDestination } from "./student-portal-guard-policy.ts";

/**
 * Share live authority only within one React server render (layout + page).
 * React discards this memoization between requests; the resolver stays uncached.
 */
export const requireStudentPortalActor = cache(async (): Promise<ActiveStudentPortalActor> => {
  const result = await resolveStudentPortalActor();
  if (result.status === "authenticated") return result.actor;
  redirect(studentPortalGuardDestination(result) ?? "/login");
});
