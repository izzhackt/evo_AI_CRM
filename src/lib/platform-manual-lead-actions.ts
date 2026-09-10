"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { LEAD_DIRECTIONS, MANUAL_LEAD_SOURCES, type ManualLeadInput, type ManualLeadState } from "./platform-manual-lead-contract";
import { parseSalesDate, parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { createManualLead } from "./v3/manual-lead-source";

export async function createManualLeadAction(previous: ManualLeadState, form: FormData): Promise<ManualLeadState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "name", "phone", "email", "source", "owner_id", "direction", "next_action", "due_date"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const fail = (status: ManualLeadState["status"]): ManualLeadState => ({ status, requestId: requestId ?? previous.requestId, leadId: null });
  if (!fields || !requestId) return fail("invalid");
  if (actor.presentationRole !== actor.authorityRole || (actor.authorityRole !== "admin" && actor.authorityRole !== "sales")) return fail("forbidden");
  const text = (key: string) => fields.get(key)!.trim();
  const name = text("name"), phone = text("phone") || null, email = text("email") || null;
  const source = text("source"), direction = text("direction") || null;
  const ownerId = parseSalesUuid(text("owner_id")), nextAction = text("next_action") || null;
  const rawDue = text("due_date"), dueDate = rawDue ? parseSalesDate(rawDue) : null;
  if (!name || name.length > 300 || (!phone && !email) || (phone && (phone.length > 50 || !/^\+?[\d\s().-]{7,40}$/.test(phone)))
    || (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    || !Object.hasOwn(MANUAL_LEAD_SOURCES, source) || (direction && !Object.hasOwn(LEAD_DIRECTIONS, direction))
    || !ownerId || (nextAction?.length ?? 0) > 500 || Boolean(nextAction) !== Boolean(dueDate) || (rawDue && !dueDate)
    || [...fields.values()].some(value => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) return fail("invalid");
  try {
    const state = await createManualLead(actor, { requestId, name, phone, email, source, ownerId, direction, nextAction, dueDate } as ManualLeadInput);
    if (state.status === "saved") revalidatePath("/v3/pipeline");
    return state;
  } catch { return fail("unavailable"); }
}
