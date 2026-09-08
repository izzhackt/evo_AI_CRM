import "server-only";
import type { PlatformActor } from "../platform-auth";
import { createSupabaseServerClient } from "../supabase/server";
import { parseSalesInteger, parseSalesUuid, parseSalesRegisterWorkspace, type SalesRegisterWorkspace } from "../platform-sales-register-contract";

export async function readSalesRegisterWorkspace(actor: PlatformActor, selection: Readonly<{
  year: number; month?: number | null; offset?: number; recordId?: string; archived?: boolean;
}>): Promise<SalesRegisterWorkspace> {
  const unavailable = () => new Error("Sales register is unavailable.");
  if (actor.authorityRole !== "admin" && actor.authorityRole !== "sales") throw unavailable();
  const year = parseSalesInteger(selection.year, 2100);
  const month = selection.month == null ? null : parseSalesInteger(selection.month, 12);
  const offset = parseSalesInteger(selection.offset ?? 0, 1000000);
  const recordId = selection.recordId === undefined ? null : parseSalesUuid(selection.recordId);
  if (!year || year < 1900 || offset === null || month === 0 || (selection.month != null && month === null)
    || (selection.recordId !== undefined && !recordId)) throw unavailable();
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("read_sales_register_v1", {
    p_organization_id: actor.organizationId, p_year: year, p_month: month, p_offset: offset,
    p_record_id: recordId, p_archived: selection.archived ?? false,
  });
  if (error) throw unavailable();
  const result = parseSalesRegisterWorkspace(data, actor.organizationId);
  if (result.year !== year || result.month !== month || result.offset !== offset || (result.selected?.id ?? null) !== recordId
    || result.rows.some(row => row.archived !== (selection.archived ?? false)
      || !row.reportMonth.startsWith(`${year}-`) || (month !== null && Number(row.reportMonth.slice(5, 7)) !== month)
      || (actor.authorityRole === "sales" && row.ownerMembershipId !== actor.membershipId))
    || (actor.authorityRole === "sales" && result.selected && result.selected.ownerMembershipId !== actor.membershipId)
    || (actor.authorityRole === "sales" && (result.targets.length !== 0 || result.ownerOptions.some(owner => owner.id !== actor.membershipId)))) throw unavailable();
  return result;
}
