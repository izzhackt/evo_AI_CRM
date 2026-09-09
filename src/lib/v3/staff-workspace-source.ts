import "server-only";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isStaffRole, type StaffWorkspaceData } from "./staff-workspace-contract";

export async function readStaffWorkspace(actor: ActivePlatformActor): Promise<StaffWorkspaceData> {
  if (actor.authorityRole !== "admin" || actor.presentationRole !== "admin") {
    throw new Error("Staff administration unavailable.");
  }
  try {
    const client = (await createSupabaseServerClient()).schema("platform");
    const [directory, history] = await Promise.all([
      client.rpc("staff_directory", { p_organization_id: actor.organizationId }),
      client.rpc("staff_workspace_auth_history", { p_organization_id: actor.organizationId }),
    ]);
    if (directory.error || history.error) return { available: false, members: [], requests: [] };
    return {
      available: true,
      // Auth IDs and email addresses in the Admin RPC never reach client props.
      members: (directory.data ?? []).map((row: Record<string, unknown>) => {
        if (!isStaffRole(row.platform_role)) throw new Error("Unexpected staff role.");
        return { membershipId: String(row.membership_id), displayName: String(row.display_name),
          role: row.platform_role, status: String(row.membership_status), version: Number(row.access_version) };
      }),
      requests: (history.data ?? []).map((row: Record<string, unknown>) => ({
        requestId: String(row.request_id), operation: row.operation as "invite" | "recovery",
        displayName: String(row.display_name), status: row.status as "dispatching" | "reconciliation_required" | "completed",
        createdAt: String(row.created_at),
      })),
    };
  } catch {
    return { available: false, members: [], requests: [] };
  }
}
