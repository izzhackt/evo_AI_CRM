import { redirect } from "next/navigation";

import {
  resolveStudentPortalActor,
  type ActiveStudentPortalActor,
} from "./student-portal-auth.ts";
import { studentPortalGuardDestination } from "./student-portal-guard-policy.ts";

/** Defense-in-depth guard for the separate Student layout and Portal routes. */
export async function requireStudentPortalActor(): Promise<ActiveStudentPortalActor> {
  const result = await resolveStudentPortalActor();
  const destination = studentPortalGuardDestination(result);
  if (destination) redirect(destination);
  return result.actor;
}
