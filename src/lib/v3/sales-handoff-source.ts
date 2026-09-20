import "server-only";

import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { PlatformSalesRepositoryError } from "@/lib/platform-sales";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One complete lead-scoped read; no report access, case data or zero fallback. */
export async function readCompletedSalesHandoffs(
  actor: ActivePlatformActor,
  leadIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const expected = new Set(leadIds);
  if (isStaffPreview(actor) || !staffHasPermission(actor, "lead.read")
    || expected.size !== leadIds.length || leadIds.length > 4000) {
    throw new PlatformSalesRepositoryError();
  }
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform").rpc("staff_sales_handoff_facts", {
        p_organization_id: actor.organizationId,
        p_lead_ids: leadIds,
      });
    if (error || !record(data) || data.organization_id !== actor.organizationId
      || !Array.isArray(data.leads) || data.leads.length !== leadIds.length) {
      throw new PlatformSalesRepositoryError();
    }
    const completed = new Set<string>();
    for (const row of data.leads as unknown[]) {
      if (!record(row) || typeof row.lead_id !== "string" || !expected.delete(row.lead_id)
        || typeof row.completed !== "boolean"
        || (row.completed
          ? typeof row.completed_at !== "string" || !TIMESTAMP.test(row.completed_at)
            || !Number.isFinite(Date.parse(row.completed_at))
          : row.completed_at !== null)) {
        throw new PlatformSalesRepositoryError();
      }
      if (row.completed) completed.add(row.lead_id);
    }
    if (expected.size > 0) throw new PlatformSalesRepositoryError();
    return completed;
  } catch {
    // The existing route boundary offers retry; a failed read is never a board
    // full of actionable leads whose completed handoffs were merely unavailable.
    throw new PlatformSalesRepositoryError();
  }
}
