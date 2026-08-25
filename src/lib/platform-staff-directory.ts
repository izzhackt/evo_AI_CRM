import "server-only";

import { redirect } from "next/navigation";

import type { PlatformActor } from "./platform-auth";
import { requirePlatformStaffActor } from "./platform-guards";
import {
  isPlatformMembershipStatus,
  isPlatformStaffRole,
  type PlatformMembershipStatus,
  type PlatformStaffRole,
} from "./platform-staff-roles";
import { createSupabaseServerClient } from "./supabase/server";

export type PlatformStaffMember = Readonly<{
  authUserId: string;
  profileId: string;
  membershipId: string;
  displayName: string;
  role: PlatformStaffRole;
  status: PlatformMembershipStatus;
  accessVersion: number;
  contractConfirmationGranted: boolean;
  firstPaymentConfirmationGranted: boolean;
  admissionsGateOverrideGranted: boolean;
  isActingAdmin: boolean;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function requirePlatformStaffAdminActor(): Promise<PlatformActor> {
  const actor = await requirePlatformStaffActor();
  if (actor.platformRole !== "admin") {
    redirect("/platform-pending?from=%2Fsettings%3Ftab%3Dstaff");
  }
  return actor;
}

export async function listPlatformStaffMembers(
  actor: PlatformActor,
): Promise<readonly PlatformStaffMember[] | null> {
  let response: { data: unknown; error: unknown };
  try {
    const client = await createSupabaseServerClient();
    response = await client.schema("platform").rpc("staff_directory", {
      p_organization_id: actor.organizationId,
    });
  } catch {
    return null;
  }
  if (response.error || !Array.isArray(response.data)) return null;

  const members: PlatformStaffMember[] = [];
  for (const value of response.data) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const authUserId = readUuid(row.auth_user_id);
    const profileId = readUuid(row.profile_id);
    const membershipId = readUuid(row.membership_id);
    const role = row.platform_role;
    const status = row.membership_status;
    const accessVersion = readPositiveInteger(row.access_version);
    const displayName =
      typeof row.display_name === "string" ? row.display_name.trim() : "";
    if (
      !authUserId ||
      !profileId ||
      !membershipId ||
      typeof role !== "string" ||
      !isPlatformStaffRole(role) ||
      typeof status !== "string" ||
      !isPlatformMembershipStatus(status) ||
      !accessVersion ||
      displayName.length === 0 ||
      typeof row.contract_confirmation_granted !== "boolean" ||
      typeof row.first_payment_confirmation_granted !== "boolean" ||
      typeof row.admissions_gate_override_granted !== "boolean"
    ) {
      return null;
    }
    members.push({
      authUserId,
      profileId,
      membershipId,
      displayName,
      role,
      status,
      accessVersion,
      contractConfirmationGranted: row.contract_confirmation_granted,
      firstPaymentConfirmationGranted:
        row.first_payment_confirmation_granted,
      admissionsGateOverrideGranted:
        row.admissions_gate_override_granted,
      isActingAdmin: membershipId === actor.membershipId,
    });
  }
  return members;
}

export {
  PLATFORM_MEMBERSHIP_STATUSES,
  PLATFORM_SENSITIVE_PERMISSIONS,
  PLATFORM_STAFF_ROLES,
} from "./platform-staff-roles";
