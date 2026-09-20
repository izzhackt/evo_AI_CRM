import "server-only";

import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { PLATFORM_SALES_STAGES } from "@/lib/platform-sales-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { leadStage } from "@/lib/v3/wording";

export type CurrentSalesFunnel = Readonly<
  | { status: "unavailable" | "preview" }
  | {
      status: "available";
      stages: readonly Readonly<{ key: string; name: string; value: number }>[];
      sales:
        | Readonly<{ status: "available"; count: number }>
        | Readonly<{ status: "denied" | "unavailable" }>;
    }
>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** A report permission or malformed report result never becomes a false zero. */
function report(value: unknown, leadCount: number): Extract<CurrentSalesFunnel, { status: "available" }>["sales"] {
  if (!record(value)) return { status: "unavailable" };
  if (value.status === "denied" && value.count === null) return { status: "denied" };
  const parsed = count(value.count);
  if (value.status !== "available" || parsed === null || parsed > leadCount) return { status: "unavailable" };
  return { status: "available", count: parsed };
}

export async function readCurrentSalesFunnel(actor: ActivePlatformActor): Promise<CurrentSalesFunnel> {
  // Preview must not disclose the real Admin's broader record visibility.
  if (isStaffPreview(actor)) return { status: "preview" };
  if (!staffHasPermission(actor, "lead.read")) {
    return { status: "unavailable" };
  }
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform").rpc("current_sales_funnel", {
        p_organization_id: actor.organizationId,
      }, { get: true });
    if (error || !record(data) || data.organization_id !== actor.organizationId
      || !Array.isArray(data.stages) || data.stages.length !== PLATFORM_SALES_STAGES.length) {
      return { status: "unavailable" };
    }
    const leadCount = count(data.lead_count);
    if (leadCount === null) return { status: "unavailable" };
    const stages = [];
    for (const [index, key] of PLATFORM_SALES_STAGES.entries()) {
      const row: unknown = data.stages[index];
      const name = leadStage(key);
      if (!record(row) || row.key !== key || name === null) return { status: "unavailable" };
      const value = count(row.count);
      if (value === null) return { status: "unavailable" };
      stages.push({ key, name: name.charAt(0).toUpperCase() + name.slice(1), value });
    }
    // Unknown stages or an incomplete projection must not look like exact counts.
    if (stages.reduce((sum, stage) => sum + stage.value, 0) !== leadCount) {
      return { status: "unavailable" };
    }
    return { status: "available", stages, sales: report(data.sales, leadCount) };
  } catch {
    return { status: "unavailable" };
  }
}
