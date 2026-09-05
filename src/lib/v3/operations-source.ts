import "server-only";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  readPlatformDashboardSnapshot,
  type PlatformDashboardSnapshot,
} from "@/lib/server/platform-dashboard";

/** Expose the existing role-scoped cross-module projection to each V3 home. */
export function readV3OperationalDashboard(
  actor: ActivePlatformActor,
): Promise<PlatformDashboardSnapshot> {
  return readPlatformDashboardSnapshot(actor);
}
