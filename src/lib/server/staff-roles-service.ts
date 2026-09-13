import "server-only";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { staffAdminContext } from "./staff-workspace-service";
import { STAFF_UUID } from "@/lib/v3/staff-workspace-contract";
import {
  parseStaffRoleAssignmentInputs, parseStaffRoleCommandResult, parseStaffRoleImpact,
  parseStaffRoleWorkspace, parseStaffRoleExpectedBindings, parseStaffRoleImpactFingerprint,
} from "@/lib/v3/staff-roles-contract";

export class StaffRoleOutcomeUnknownError extends Error {
  constructor() { super("staff_role_outcome_unknown"); }
}

function field(form: FormData, name: string, maximum = 160, required = true): string {
  const value = form.get(name);
  if (typeof value !== "string" || form.getAll(name).length !== 1 || value.length > maximum || (required && !value.trim())) {
    throw new Error("staff_workspace_invalid_input");
  }
  return value.trim();
}
function id(form: FormData, name: string): string {
  const value = field(form, name, 36);
  if (!STAFF_UUID.test(value)) throw new Error("staff_workspace_invalid_input");
  return value;
}
function version(form: FormData): number {
  const raw = field(form, "expected_version", 16);
  if (!/^(0|[1-9][0-9]*)$/u.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("staff_workspace_invalid_input");
  return Number(raw);
}

export async function readStaffRoles(actor: ActivePlatformActor) {
  if (actor.systemRole !== "admin" || actor.presentationRole !== null) throw new Error("staff_workspace_forbidden");
  const client = (await createSupabaseServerClient()).schema("platform");
  const result = await client.rpc("staff_role_workspace", { p_organization_id: actor.organizationId });
  if (result.error) throw new Error("staff_roles_unavailable");
  return parseStaffRoleWorkspace(result.data);
}

export async function executeStaffRoleCommand(form: FormData) {
  const { actor, client } = await staffAdminContext();
  const operation = field(form, "operation", 20);
  const expectedVersion = version(form);
  const organization = { p_organization_id: actor.organizationId };
  if (operation === "impact") {
    const roleId = id(form, "role_id");
    const result = await client.rpc("staff_role_impact", { ...organization, p_role_id: roleId, p_expected_version: expectedVersion });
    if (result.error) throw new Error(result.error.message);
    const impact = parseStaffRoleImpact(result.data);
    if (impact.roleId !== roleId || impact.version !== expectedVersion) throw new Error("staff_roles_invalid_contract");
    return { impact };
  }
  const base = { ...organization, p_reason: field(form, "reason", 500), p_request_id: id(form, "request_id") };
  let rpc: string;
  let params: Record<string, unknown>;
  let receiptKind: "role" | "publish" | "assignments" | "admin";
  let targetId: string;
  if (operation === "assignments" || operation === "admin") {
    targetId = id(form, "membership_id");
    params = { ...base, p_membership_id: targetId, p_expected_access_version: expectedVersion };
    receiptKind = operation;
    if (operation === "assignments") {
      rpc = "staff_role_assignments_save";
      const assignments = parseStaffRoleAssignmentInputs(JSON.parse(field(form, "assignments", 64000)));
      params.p_assignments = assignments;
      params.p_expected_role_bindings = parseStaffRoleExpectedBindings(
        JSON.parse(field(form, "expected_role_bindings", 32000)), assignments,
      );
    } else {
      if (field(form, "confirm_admin", 3) !== "yes") throw new Error("staff_role_confirmation_required");
      rpc = "staff_system_admin_command";
      const enabled = field(form, "enabled", 5);
      if (enabled !== "true" && enabled !== "false") throw new Error("staff_workspace_invalid_input");
      params.p_enabled = enabled === "true";
    }
  } else {
    targetId = id(form, "role_id");
    params = { ...base, p_role_id: targetId, p_expected_version: expectedVersion };
    receiptKind = operation === "publish" ? "publish" : "role";
    if (operation === "publish") {
      if (form.get("confirm_impact") !== "yes") throw new Error("staff_role_confirmation_required");
      rpc = "staff_role_publish";
      params.p_expected_impact_fingerprint = parseStaffRoleImpactFingerprint(field(form, "expected_impact_fingerprint", 64));
    } else {
      if (!["create", "copy", "save", "archive", "restore"].includes(operation)) throw new Error("staff_workspace_invalid_input");
      const payload: Record<string, unknown> = {};
      if (["create", "copy", "save"].includes(operation)) {
        payload.label = field(form, "label", 120);
        payload.description = field(form, "description", 500, false);
        const keys = form.getAll("permission_keys");
        if (keys.length > 300 || new Set(keys).size !== keys.length || keys.some((key) => typeof key !== "string" || !key.trim() || key.length > 120)) throw new Error("staff_workspace_invalid_input");
        payload.permissionKeys = keys;
        if (operation === "copy") payload.sourceRoleId = id(form, "source_role_id");
      }
      if (operation === "archive") {
        const replacement = field(form, "replacement_role_id", 36, false);
        if (replacement && !STAFF_UUID.test(replacement)) throw new Error("staff_workspace_invalid_input");
        payload.replacementRoleId = replacement || null;
        payload.revokeAssignments = form.get("revoke_assignments") === "yes";
      }
      rpc = "staff_role_command";
      params.p_operation = operation;
      params.p_payload = payload;
    }
  }
  const result = await client.rpc(rpc, params).then((value) => value, () => { throw new StaffRoleOutcomeUnknownError(); });
  if (result.error) {
    if (["22023", "22001", "23503", "23505", "23514", "40001", "40P01", "42501", "P0001"].includes(result.error.code)) throw new Error(result.error.message);
    throw new StaffRoleOutcomeUnknownError();
  }
  try {
    const receipt = parseStaffRoleCommandResult(result.data, receiptKind);
    const raw = result.data as Record<string, unknown>;
    const actualId = receiptKind === "role" || receiptKind === "publish" ? raw.roleId : raw.membershipId;
    const actualVersion = receiptKind === "role" || receiptKind === "publish" ? raw.version : raw.accessVersion;
    if (actualId !== targetId || actualVersion !== expectedVersion + 1) throw new Error("staff_roles_invalid_contract");
    return receipt;
  } catch { throw new StaffRoleOutcomeUnknownError(); }
}
