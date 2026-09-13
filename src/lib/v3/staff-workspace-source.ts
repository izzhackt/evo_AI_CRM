import "server-only";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ADMISSIONS_DIRECTIONS, type AdmissionsDirection } from "@/lib/platform-admissions-playbook-contract";
import { isStaffRole, STAFF_UUID, type StaffAuthRequest, type StaffDepartment, type StaffWorkspaceData } from "./staff-workspace-contract";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid staff directory response.");
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid staff directory list.");
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid staff directory text.");
  return value;
}

function uuid(value: unknown): string {
  const result = text(value);
  if (!STAFF_UUID.test(result)) throw new Error("Invalid staff directory identifier.");
  return result;
}

function count(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error("Invalid staff directory version.");
  return value;
}

const unavailable: StaffWorkspaceData = { available: false, members: [], requests: [], departments: [] };

export async function readStaffWorkspace(actor: ActivePlatformActor): Promise<StaffWorkspaceData> {
  if (actor.authorityRole !== "admin" || actor.presentationRole !== "admin") {
    throw new Error("Staff administration unavailable.");
  }
  try {
    const client = (await createSupabaseServerClient()).schema("platform");
    const [directory, history] = await Promise.all([
      client.rpc("staff_workspace_directory", { p_organization_id: actor.organizationId }),
      client.rpc("staff_workspace_auth_history", { p_organization_id: actor.organizationId }),
    ]);
    if (directory.error || history.error) return unavailable;
    const workspace = record(directory.data);
    const departments = list(workspace.departments).map((value): StaffDepartment => {
      const row = record(value);
      if (row.status !== "active" && row.status !== "archived") throw new Error("Unexpected department status.");
      return { id: uuid(row.id), name: text(row.name), description: row.description === null ? null : text(row.description),
        status: row.status, version: count(row.version, 1), memberCount: count(row.member_count) };
    });
    return {
      available: true,
      departments,
      // Auth IDs and email addresses in the Admin RPC never reach client props.
      members: list(workspace.members).map((value) => {
        const row = record(value);
        if (!isStaffRole(row.platform_role)) throw new Error("Unexpected staff role.");
        const directions = list(row.direction_codes).map((direction) => {
          if (!(ADMISSIONS_DIRECTIONS as readonly unknown[]).includes(direction)) throw new Error("Unexpected staff direction.");
          return direction as AdmissionsDirection;
        });
        if (new Set(directions).size !== directions.length) throw new Error("Duplicate staff direction.");
        const departmentId = row.department_id === null ? null : uuid(row.department_id);
        if (departmentId && !departments.some((department) => department.id === departmentId)) throw new Error("Missing staff department.");
        return { membershipId: uuid(row.membership_id), displayName: text(row.display_name),
          role: row.platform_role, status: text(row.membership_status), version: count(row.access_version, 1),
          metadata: { version: count(row.organizational_version), departmentId,
            jobTitle: row.job_title === null ? null : text(row.job_title), directions } };
      }),
      requests: (history.data ?? []).map((row: Record<string, unknown>): StaffAuthRequest => {
        if ((row.operation !== "invite" && row.operation !== "recovery")
          || !["dispatching", "reconciliation_required", "completed", "rejected"].includes(String(row.status))) {
          throw new Error("Unexpected staff request state.");
        }
        return { requestId: String(row.request_id), operation: row.operation,
          displayName: String(row.display_name), status: row.status as StaffAuthRequest["status"],
          createdAt: String(row.created_at), rejectionCode: typeof row.rejection_code === "string" ? row.rejection_code : null };
      }),
    };
  } catch {
    return unavailable;
  }
}
