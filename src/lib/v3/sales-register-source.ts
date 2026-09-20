import "server-only";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor, PlatformActor } from "../platform-auth";
import { createSupabaseServerClient } from "../supabase/server";
import { parseSalesInteger, parseSalesUuid, parseSalesRegisterIntakeOptions, type SalesRegisterWorkspace, type SalesRegisterIntakeOptions } from "../platform-sales-register-contract";
import { parseSalesRegisterSearchQuery, parseSalesRegisterSearchWorkspace } from "../sales-register-search";

/** Database authority deliberately has no implicit system-Admin grant. */
export async function readSalesRegisterWriteAccess(actor: ActivePlatformActor): Promise<"allowed" | "denied" | "unavailable"> {
  if (isStaffPreview(actor) || !staffHasPermission(actor, "sales.register.manage")) return "denied";
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("sales_register_write_access", {
      p_organization_id: actor.organizationId,
    });
    if (error || typeof data !== "boolean") return "unavailable";
    return data ? "allowed" : "denied";
  } catch { return "unavailable"; }
}

export async function readSalesRegisterIntakeOptions(actor: ActivePlatformActor, query = ""): Promise<SalesRegisterIntakeOptions> {
  if (!staffHasPermission(actor, "sales.register.manage") || !staffHasPermission(actor, "lead.sales.workflow.manage")
    || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) throw new Error("Sales intake unavailable.");
  if (await readSalesRegisterWriteAccess(actor) !== "allowed") throw new Error("Sales intake unavailable.");
  const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("sales_register_intake_options", {
    p_organization_id: actor.organizationId, p_query: query.trim(),
  });
  if (error) throw new Error("Sales intake unavailable.");
  return parseSalesRegisterIntakeOptions(data, actor.organizationId);
}

export async function readSalesRegisterWorkspace(actor: PlatformActor, selection: Readonly<{
  year: number; month?: number | null; offset?: number; recordId?: string; archived?: boolean;
  manager?: string | null; direction?: string | null; needsReview?: boolean | null; query?: string | null;
}>): Promise<SalesRegisterWorkspace> {
  const unavailable = () => new Error("Sales register is unavailable.");
  if (!staffHasPermission(actor, "sales.register.read")) throw unavailable();
  const year = parseSalesInteger(selection.year, 2100);
  const month = selection.month == null ? null : parseSalesInteger(selection.month, 12);
  const offset = parseSalesInteger(selection.offset ?? 0, 1000000);
  const recordId = selection.recordId === undefined ? null : parseSalesUuid(selection.recordId);
  const manager = selection.manager || null, direction = selection.direction || null;
  const query = parseSalesRegisterSearchQuery(selection.query);
  if (query === null || !year || year < 1900 || offset === null || month === 0 || (selection.month != null && month === null)
    || (selection.recordId !== undefined && !recordId) || (manager !== null && (manager.length > 300 || /[\u0000-\u001f\u007f]/.test(manager)))
    || (direction !== null && (direction.length > 500 || /[\u0000-\u001f\u007f]/.test(direction)))) throw unavailable();
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("read_sales_register_v2", {
    p_organization_id: actor.organizationId, p_year: year, p_month: month, p_offset: offset,
    p_record_id: recordId, p_archived: selection.archived ?? false,
    p_manager_label: manager, p_direction: direction, p_needs_review: selection.needsReview ?? null,
    p_query: query || null,
  });
  if (error) throw unavailable();
  const result = parseSalesRegisterSearchWorkspace(data, actor.organizationId);
  if (result.query !== (query || null) || result.year !== year || result.month !== month || result.offset !== offset || (result.selected?.id ?? null) !== recordId
    || result.rows.some(row => row.archived !== (selection.archived ?? false)
      || !row.reportMonth.startsWith(`${year}-`) || (month !== null && Number(row.reportMonth.slice(5, 7)) !== month)
      || (manager !== null && row.managerLabel !== manager) || (direction !== null && row.direction !== direction)
      || (selection.needsReview != null && row.needsReview !== selection.needsReview))) throw unavailable();
  return result;
}
