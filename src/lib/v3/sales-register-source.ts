import "server-only";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor, PlatformActor } from "../platform-auth";
import { createSupabaseServerClient } from "../supabase/server";
import { parseSalesDate, parseSalesInteger, parseSalesUuid, parseSalesRegisterIntakeOptions, type SalesRegisterWorkspace, type SalesRegisterIntakeOptions } from "../platform-sales-register-contract";
import { parseSalesRegisterSearchQuery, parseSalesRegisterSearchWorkspace } from "../sales-register-search";
import { parseSalesRegisterDirection, parseSalesRegisterDirections } from "../sales-register-directions";
import { parseSalesRegisterManagement, type SalesRegisterManagementRead } from "../sales-register-management";
import type { SalesSaleSlice } from "../sales-register-navigation";

/** Authority and the selected department target come from the same snapshot. */
export async function readSalesRegisterManagement(actor: ActivePlatformActor, reportMonth: string | null): Promise<SalesRegisterManagementRead> {
  if (isStaffPreview(actor) || !staffHasPermission(actor, "sales.register.read")) return { status: "denied" };
  if (reportMonth !== null && (parseSalesDate(reportMonth) !== reportMonth || !reportMonth.endsWith("-01"))) return { status: "unavailable" };
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("read_sales_register_management_v1", {
      p_organization_id: actor.organizationId, p_report_month: reportMonth,
    });
    if (error) return { status: error.code === "42501" ? "denied" : "unavailable" };
    return { status: "ready", data: parseSalesRegisterManagement(data, actor.organizationId, reportMonth) };
  } catch { return { status: "unavailable" }; }
}

export async function readSalesRegisterDirections(actor: PlatformActor): Promise<readonly string[]> {
  const unavailable = () => new Error("Sales directions are unavailable.");
  if (!staffHasPermission(actor, "sales.register.read")) throw unavailable();
  const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("read_sales_register_directions_v1", {
    p_organization_id: actor.organizationId,
  });
  if (error) throw unavailable();
  return parseSalesRegisterDirections(data, actor.organizationId);
}

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
  /** Э2: записи, названные рядом с «Продажами» (`read_sales_register_v3`, миграция 247). */
  saleSlice?: SalesSaleSlice | null;
}>): Promise<SalesRegisterWorkspace> {
  const unavailable = () => new Error("Sales register is unavailable.");
  if (!staffHasPermission(actor, "sales.register.read")) throw unavailable();
  const year = parseSalesInteger(selection.year, 2100);
  const month = selection.month == null ? null : parseSalesInteger(selection.month, 12);
  const offset = parseSalesInteger(selection.offset ?? 0, 1000000);
  const recordId = selection.recordId === undefined ? null : parseSalesUuid(selection.recordId);
  const manager = selection.manager || null, direction = parseSalesRegisterDirection(selection.direction);
  const query = parseSalesRegisterSearchQuery(selection.query);
  const slice = selection.saleSlice ?? null;
  if (query === null || !year || year < 1900 || offset === null || month === 0 || (selection.month != null && month === null)
    || (selection.recordId !== undefined && !recordId) || (manager !== null && (manager.length > 300 || /[\u0000-\u001f\u007f]/.test(manager)))
    || direction === null || (slice !== null && selection.archived)) throw unavailable();
  const client = await createSupabaseServerClient();
  const filters = {
    p_organization_id: actor.organizationId, p_year: year, p_month: month, p_offset: offset,
    p_record_id: recordId, p_archived: selection.archived ?? false,
    p_manager_label: manager, p_direction: direction || null, p_needs_review: selection.needsReview ?? null,
    p_query: query || null,
  };
  // Без среза — прежнее чтение v2; срез — v3 с тем же ответом и одним фильтром больше.
  const { data, error } = slice === null
    ? await client.schema("platform").rpc("read_sales_register_v2", filters)
    : await client.schema("platform").rpc("read_sales_register_v3", { ...filters, p_sale_slice: slice });
  if (error) throw unavailable();
  const result = parseSalesRegisterSearchWorkspace(data, actor.organizationId);
  // Период по «Дате продажи»: месяц или год выбора.
  const periodFrom = `${year}-${String(month ?? 1).padStart(2, "0")}-01`;
  const periodTo = `${year}-${String(month ?? 12).padStart(2, "0")}-31`;
  const inPeriod = (day: string | null) => day !== null && day >= periodFrom && day <= periodTo;
  const filedInPeriod = (reportMonth: string) => reportMonth.startsWith(`${year}-`) && (month === null || Number(reportMonth.slice(5, 7)) === month);
  if (result.query !== (query || null) || result.year !== year || result.month !== month || result.offset !== offset || (result.selected?.id ?? null) !== recordId
    || result.rows.some(row => row.archived !== (selection.archived ?? false)
      // Срез «из другого месяца отчёта» — продажи периода, записанные вне его месяцев.
      || (slice === "filed_elsewhere" ? filedInPeriod(row.reportMonth) || !inPeriod(row.signingDate) : !filedInPeriod(row.reportMonth))
      || (slice === "undated" && row.signingDate !== null)
      || (slice === "other_sale_date" && (row.signingDate === null || inPeriod(row.signingDate)))
      || (manager !== null && row.managerLabel !== manager) || (direction !== "" && row.direction !== direction)
      || (selection.needsReview != null && row.needsReview !== selection.needsReview))) throw unavailable();
  return result;
}
