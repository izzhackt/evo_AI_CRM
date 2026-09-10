import "server-only";

import { redirect } from "next/navigation";

import type { ActivePlatformActor } from "../platform-auth";
import { requirePlatformActor } from "../platform-guards";

/** Checks live authority on every preview page/read, independently of role preview. */
export async function requireStudentPortalPreviewAuthority(): Promise<ActivePlatformActor> {
  const actor = await requirePlatformActor();
  if (actor.authorityRole !== "admin") {
    redirect("/access-denied?from=%2Fpreview%2Fstudent");
  }
  return actor;
}
