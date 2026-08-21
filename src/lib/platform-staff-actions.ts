"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformStaffAdminActor } from "./platform-staff-directory";
import {
  isPlatformMembershipStatus,
  isPlatformStaffRole,
} from "./platform-staff-roles";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * Admin-only staff lifecycle actions.
 *
 * Every mutation goes through the audited RPCs in migration 041. Those refuse a
 * caller whose `auth.uid()` is absent and re-check permission and scope, so the
 * acting Admin is recorded in the immutable audit rather than an impersonal
 * process. No service key is used on this path.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const CONTROL_CHARACTERS = /\p{Cc}/u;
const MAX_REASON_LENGTH = 500;
const MIN_REASON_LENGTH = 3;

export type StaffActionOutcome =
  | "provisioned"
  | "role_changed"
  | "status_changed"
  | "invalid_user"
  | "invalid_role"
  | "invalid_status"
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

/**
 * The reason is not decoration: it is written to the append-only audit and is
 * the only record of why a person received or lost access. An empty or
 * control-character reason is refused rather than stored.
 */
function parseReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim().replace(/\s+/gu, " ");
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    return null;
  }
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
  // A rejection is reported as such and never retried automatically: the RPCs
  // are audited and a blind repeat would duplicate audit entries.
  if (response.error) outcomeRedirect("rejected");
  revalidatePath("/settings");
  outcomeRedirect(success);
}

export async function provisionPlatformStaffMemberAction(
  formData: FormData,
): Promise<void> {
  const actor = await requirePlatformStaffAdminActor();

  const memberAuthUserId = parseUuid(formData.get("member_auth_user_id"));
  if (!memberAuthUserId) outcomeRedirect("invalid_user");

  const roleInput = formData.get("role");
  if (typeof roleInput !== "string" || !isPlatformStaffRole(roleInput)) {
    outcomeRedirect("invalid_role");
  }

  // Granting `admin` hands over secret management, integration configuration
  // and audit export. The owner decided this stays possible but must be a
  // deliberate act, so an unchecked confirmation refuses the grant.
  if (roleInput === "admin" && formData.get("confirm_admin") !== "yes") {
    outcomeRedirect("admin_not_confirmed");
  }

  const displayName = parseDisplayName(formData.get("display_name"));
  if (!displayName) outcomeRedirect("invalid_user");

  const reason = parseReason(formData.get("reason"));
  if (!reason) outcomeRedirect("invalid_reason");

  await callStaffRpc(
    "provision_member",
    {
      p_organization_id: actor.organizationId,
      p_member_auth_user_id: memberAuthUserId,
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
    "change_membership_role",
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

  // The database refuses to remove the last live Admin. The screen does not
  // duplicate that rule in weaker form; it surfaces the rejection instead.
  await callStaffRpc(
    "change_membership_status",
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
