import "server-only";
import type { PlatformActor } from "../platform-auth";
import { parseFinanceEntryWorkspace, parseMonthlyPaymentSummary, type FinanceEntryState } from "../platform-finance-entry-contract";
import { parseSalesUuid } from "../platform-sales-register-contract";
import { createSupabaseServerClient } from "../supabase/server";

export async function readFinanceEntryWorkspace(actor: PlatformActor, caseId: string) {
  if (!parseSalesUuid(caseId) || actor.authorityRole === "sales") throw new Error("Finance entry is unavailable.");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_finance_entry_workspace", { p_student_case_id: caseId });
  if (error) throw new Error("Finance entry is unavailable.");
  return parseFinanceEntryWorkspace(data, actor.organizationId, caseId);
}
export async function readMonthlyPaymentSummary(actor: PlatformActor, year: number, month: number) {
  if (actor.authorityRole !== "admin" || !Number.isInteger(year) || year < 1900 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Finance summary is unavailable.");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_monthly_payment_summary", { p_organization_id: actor.organizationId, p_year: year, p_month: month });
  if (error) throw new Error("Finance summary is unavailable.");
  return parseMonthlyPaymentSummary(data, actor.organizationId, year, month);
}
export async function saveFinanceEntry(actor: PlatformActor, operation: "obligation" | "payment" | "refund", caseId: string, requestId: string, args: Record<string, unknown>): Promise<FinanceEntryState> {
  const outcome = (status: FinanceEntryState["status"], resourceId: string | null = null): FinanceEntryState => ({ status, resourceId, requestId });
  if (actor.authorityRole === "sales") return outcome("forbidden");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc(operation === "obligation" ? "create_payment_obligation" : "record_payment_event", {
    ...args, p_organization_id: actor.organizationId, p_request_id: requestId,
  });
  if (error) return outcome(error.code === "42501" ? "forbidden" : error.code === "22023" || error.code === "23505"
    ? /request|replay|idempot/i.test(error.message) ? "request_conflict" : "invalid" : "unavailable");
  if (!data || typeof data !== "object" || Array.isArray(data) || data.organization_id !== actor.organizationId || data.student_case_id !== caseId) return outcome("unavailable");
  const resourceId = parseSalesUuid(operation === "obligation" ? data.payment_obligation_id : data.payment_event_id);
  return resourceId ? outcome("saved", resourceId) : outcome("unavailable");
}
