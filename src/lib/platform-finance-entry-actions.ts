"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { decimalToMinor, financeDateTime, type FinanceEntryState } from "./platform-finance-entry-contract";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { readFinanceEntryWorkspace, saveFinanceEntry } from "./v3/finance-entry-source";

export async function saveFinanceEntryAction(previous: FinanceEntryState, form: FormData): Promise<FinanceEntryState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "case_id", "operation", "obligation_id", "payment_id", "amount", "currency", "at", "label", "category", "next_action", "source", "evidence", "reason"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const fail = (status: FinanceEntryState["status"]): FinanceEntryState => ({ status, requestId: requestId ?? previous.requestId, resourceId: null });
  if (!fields || !requestId) return fail("invalid");
  if (actor.presentationRole !== actor.authorityRole || actor.authorityRole === "sales") return fail("forbidden");
  const text = (key: string) => fields.get(key)!.trim();
  const operation = text("operation"), caseId = parseSalesUuid(text("case_id")), amount = decimalToMinor(text("amount")), at = financeDateTime(text("at"));
  const reason = text("reason"), currency = text("currency").toUpperCase();
  if (!["obligation", "payment", "refund"].includes(operation) || !caseId || !amount || !at || !reason || reason.length > 1000
    || !/^[A-Z]{3}$/.test(currency) || [...fields.values()].some(value => value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) return fail("invalid");
  try {
    const workspace = await readFinanceEntryWorkspace(actor, caseId);
    const args: Record<string, unknown> = { p_amount_minor: amount, p_currency: currency, p_reason: reason };
    if (operation === "obligation") {
      const label = text("label"), category = text("category"), nextAction = text("next_action");
      if (!workspace.canCreate) return fail("forbidden");
      if (!label || label.length > 500 || !["evo_service_fee", "third_party_cost"].includes(category) || !nextAction || nextAction.length > 1000
        || text("obligation_id") || text("payment_id") || text("source") || text("evidence")) return fail("invalid");
      Object.assign(args, { p_student_case_id: caseId, p_label: label, p_category: category, p_due_at: at, p_next_action: nextAction });
    } else {
      if (!workspace.canRecord) return fail("forbidden");
      const obligationId = parseSalesUuid(text("obligation_id"));
      const obligation = workspace.obligations.find(item => item.id === obligationId);
      const paymentId = text("payment_id") ? parseSalesUuid(text("payment_id")) : null;
      if (!obligation || currency !== obligation.currency || text("label") || text("category") || text("next_action")
        || !text("source") || text("source").length > 200 || !text("evidence") || text("evidence").length > 512
        || (operation === "payment" && text("payment_id"))
        || (operation === "refund" && !workspace.events.some(event => event.id === paymentId && event.type === "payment" && event.obligationId === obligationId))) return fail("invalid");
      Object.assign(args, { p_payment_obligation_id: obligationId, p_event_type: operation, p_referenced_payment_event_id: paymentId,
        p_occurred_at: at, p_source_key: text("source"), p_evidence_ref: text("evidence") });
    }
    const result = await saveFinanceEntry(actor, operation as "obligation" | "payment" | "refund", caseId, requestId, args);
    if (result.status === "saved") { revalidatePath("/v3/profile"); revalidatePath("/v3/main"); revalidatePath("/portal"); revalidatePath("/portal/payments"); }
    return result;
  } catch { return fail("unavailable"); }
}
