"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformStaffAdminActor } from "./platform-staff-directory";
import {
  isPlatformMembershipStatus,
  isPlatformSensitivePermission,
  isPlatformStaffRole,
} from "./platform-staff-roles";
import { createSupabaseServerClient } from "./supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const CONTROL_CHARACTERS = /\p{Cc}/u;

export type StaffActionOutcome =
  | "provisioned"
  | "role_changed"
  | "status_changed"
  | "permission_changed"
  | "invalid_user"
  | "invalid_role"
  | "invalid_status"
  | "invalid_permission"
  | "invalid_reason"
  | "admin_not_confirmed"
  | "rejected"
  | "unavailable";

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return UUID_PATTERN.test(candidate) && candidate !== NIL_UUID
    ? candidate
    : null;
}

function parseReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim().replace(/\s+/gu, " ");
  if (reason.length < 3 || reason.length > 500) return null;
  return CONTROL_CHARACTERS.test(reason) ? null : reason;
}

function parseDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/gu, " ");
  if (name.length < 1 || name.length > 200) return null;
  return CONTROL_CHARACTERS.test(name) ? null : name;
}

function outcomeRedirect(outcome: StaffActionOutcome): never {
  const params = new URLSearchParams({ tab: "staff", staff_result: outcome });
  redirect(`/settings?${params.toString()}`);
}

async function callStaffRpc(
  name: string,
  args: Record<string, unknown>,
  success: StaffActionOutcome,
): Promise<never> {
  let response: { error: unknown };
  try {
    const client = await createSupabaseServerClient();
    response = await client.schema("platform").rpc(name, args);
  } catch {
    outcomeRedirect("unavailable");
  }
  if (response.error) outcomeRedirect("rejected");
  revalidatePath("/settings");
  outcomeRedirect(success);
}

export async function provisionPlatformStaffMemberAction(
  formData: FormData,
): Promise<void> {
  const actor = await requirePlatformStaffAdminActor();
  const authUserId = parseUuid(formData.get("auth_user_id"));
  const displayName = parseDisplayName(formData.get("display_name"));
  if (!authUserId || !displayName) outcomeRedirect("invalid_user");

  const roleInput = formData.get("role");
  if (typeof roleInput !== "string" || !isPlatformStaffRole(roleInput)) {
    outcomeRedirect("invalid_role");
  }
  if (roleInput === "admin" && formData.get("confirm_admin") !== "yes") {
    outcomeRedirect("admin_not_confirmed");
  }
  const reason = parseReason(formData.get("reason"));
  if (!reason) outcomeRedirect("invalid_reason");

  await callStaffRpc(
    "provision_pilot_staff_member",
    {
      p_organization_id: actor.organizationId,
      p_member_auth_user_id: authUserId,
      p_member_display_name: displayName,
      p_role: roleInput,
      p_reason: reason,
      p_request_id: randomUUID(),
    },
    "provisioned",
  );
}

export async function changePlatformStaffRoleAction(
  formData: FormData,
): Promise<void> {
  const actor = await requirePlatformStaffAdminActor();
  const membershipId = parseUuid(formData.get("membership_id"));
  if (!membershipId) outcomeRedirect("invalid_user");
  const roleInput = formData.get("role");
  if (typeof roleInput !== "string" || !isPlatformStaffRole(roleInput)) {
    outcomeRedirect("invalid_role");
  }
  if (roleInput === "admin" && formData.get("confirm_admin") !== "yes") {
    outcomeRedirect("admin_not_confirmed");
  }
  const reason = parseReason(formData.get("reason"));
  if (!reason) outcomeRedirect("invalid_reason");

  await callStaffRpc(
    "change_pilot_staff_role",
    {
      p_organization_id: actor.organizationId,
      p_membership_id: membershipId,
      p_new_role: roleInput,
      p_reason: reason,
      p_request_id: randomUUID(),
    },
    "role_changed",
  );
}

export async function changePlatformStaffStatusAction(
  formData: FormData,
): Promise<void> {
  const actor = await requirePlatformStaffAdminActor();
  const membershipId = parseUuid(formData.get("membership_id"));
  if (!membershipId) outcomeRedirect("invalid_user");
  const statusInput = formData.get("status");
  if (
    typeof statusInput !== "string" ||
    !isPlatformMembershipStatus(statusInput)
  ) {
    outcomeRedirect("invalid_status");
  }
  const reason = parseReason(formData.get("reason"));
  if (!reason) outcomeRedirect("invalid_reason");

  await callStaffRpc(
    "change_pilot_staff_status",
    {
      p_organization_id: actor.organizationId,
      p_membership_id: membershipId,
      p_new_status: statusInput,
      p_reason: reason,
      p_request_id: randomUUID(),
    },
    "status_changed",
  );
}

export async function changePlatformStaffPermissionAction(
  formData: FormData,
): Promise<void> {
  const actor = await requirePlatformStaffAdminActor();
  const membershipId = parseUuid(formData.get("membership_id"));
  if (!membershipId) outcomeRedirect("invalid_user");
  const permission = formData.get("permission_key");
  if (
    typeof permission !== "string" ||
    !isPlatformSensitivePermission(permission)
  ) {
    outcomeRedirect("invalid_permission");
  }
  const grantedInput = formData.get("granted");
  if (grantedInput !== "true" && grantedInput !== "false") {
    outcomeRedirect("invalid_permission");
  }
  const reason = parseReason(formData.get("reason"));
  if (!reason) outcomeRedirect("invalid_reason");

  await callStaffRpc(
    "change_membership_permission",
    {
      p_organization_id: actor.organizationId,
      p_membership_id: membershipId,
      p_permission_key: permission,
      p_granted: grantedInput === "true",
      p_reason: reason,
      p_request_id: randomUUID(),
    },
    "permission_changed",
  );
}
