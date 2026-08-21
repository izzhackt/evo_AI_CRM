import "server-only";

import { redirect } from "next/navigation";

import { requirePlatformStaffActor } from "./platform-guards";
import type { PlatformActor } from "./platform-auth";
import {
  isPlatformMembershipStatus,
  isPlatformStaffRole,
  type PlatformMembershipStatus,
  type PlatformStaffRole,
} from "./platform-staff-roles";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * Staff directory read model for the Admin-only staff management surface.
 *
 * Reads go through row level security rather than a service key: the existing
 * `organization_memberships_read` and profile policies already narrow the rows
 * to what the acting Admin may see, so no additional privilege is introduced.
 */

export type PlatformStaffMember = Readonly<{
  membershipId: string;
  displayName: string;
  role: PlatformStaffRole | "student";
  status: PlatformMembershipStatus;
  isActingAdmin: boolean;
}>;

/**
 * FR-006 reserves staff administration for Admin. A non-Admin staff member is
 * sent to the pending surface rather than shown an empty screen, so the denial
 * is explicit and leaks no directory content.
 */
export async function requirePlatformStaffAdminActor(): Promise<PlatformActor> {
  const actor = await requirePlatformStaffActor();
  if (actor.platformRole !== "admin") {
    redirect("/platform-pending?from=%2Fsettings%3Ftab%3Dstaff");
  }
  return actor;
}

type MembershipRow = {
  id: unknown;
  business_role: unknown;
  status: unknown;
  profiles: { display_name: unknown } | { display_name: unknown }[] | null;
};

function readDisplayName(row: MembershipRow): string {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const value = profile?.display_name;
  return typeof value === "string" && value.trim() !== "" ? value : "—";
}

export async function listPlatformStaffMembers(
  actor: PlatformActor,
): Promise<readonly PlatformStaffMember[] | null> {
  let response: { data: unknown; error: unknown };
  try {
    const client = await createSupabaseServerClient();
    response = await client
      .schema("platform")
      .from("organization_memberships")
      .select("id, business_role, status, profiles(display_name)")
      .eq("organization_id", actor.organizationId)
      .order("business_role", { ascending: true })
      .order("id", { ascending: true });
  } catch {
    return null;
  }
  if (response.error || !Array.isArray(response.data)) return null;

  const members: PlatformStaffMember[] = [];
  for (const raw of response.data as MembershipRow[]) {
    const id = raw.id;
    const role = raw.business_role;
    const status = raw.status;
    if (
      typeof id !== "string" ||
      typeof role !== "string" ||
      typeof status !== "string" ||
      !isPlatformMembershipStatus(status)
    ) {
      // A row the contract does not recognise is dropped rather than rendered
      // with a guessed role or status.
      continue;
    }
    members.push({
      membershipId: id,
      displayName: readDisplayName(raw),
      role: isPlatformStaffRole(role) ? role : "student",
      status,
      isActingAdmin: id === actor.membershipId,
    });
  }
  return members;
}

export {
  PLATFORM_MEMBERSHIP_STATUSES,
  PLATFORM_STAFF_ROLES,
  isPlatformMembershipStatus,
  isPlatformStaffRole,
} from "./platform-staff-roles";
