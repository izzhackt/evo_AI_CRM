"use server";
import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { LEAD_DIRECTIONS, MANUAL_LEAD_SOURCES, type ManualLeadInput, type ManualLeadState } from "./platform-manual-lead-contract";
import { parseSalesDate, parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { isLeadChannel, type LeadChannel } from "./lead-channel-contract";
import { recordLeadTouch, leadTouchRequestId } from "./v3/lead-channel-source";
import { createManualLead } from "./v3/manual-lead-source";

export async function createManualLeadAction(previous: ManualLeadState, form: FormData): Promise<ManualLeadState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "name", "phone", "email", "source", "channel", "owner_id", "direction", "next_action", "due_date"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const fail = (status: ManualLeadState["status"]): ManualLeadState => ({ status, requestId: requestId ?? previous.requestId, leadId: null });
  if (!fields || !requestId) return fail("invalid");
  if (isStaffPreview(actor) || !staffHasPermission(actor, "lead.sales.workflow.manage")) return fail("forbidden");
  const text = (key: string) => fields.get(key)!.trim();
  const name = text("name"), phone = text("phone") || null, email = text("email") || null;
  const source = text("source"), direction = text("direction") || null, channel = text("channel");
  const ownerId = parseSalesUuid(text("owner_id")), nextAction = text("next_action") || null;
  const rawDue = text("due_date"), dueDate = rawDue ? parseSalesDate(rawDue) : null;
  // «Не выбрано» (Э8.11): отдельный ответ «Выберите источник», а не общий «Проверьте…».
  if (!source) return fail("source_required");
  // «Откуда узнал» обязательно, без значения по умолчанию: «Не известно» выбирают явно.
  if (!channel) return fail("channel_required");
  if (!name || name.length > 300 || (!phone && !email) || (phone && (phone.length > 50 || !/^\+?[\d\s().-]{7,40}$/.test(phone)))
    || (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    || !Object.hasOwn(MANUAL_LEAD_SOURCES, source) || !isLeadChannel(channel) || (direction && !Object.hasOwn(LEAD_DIRECTIONS, direction))
    || !ownerId || (nextAction?.length ?? 0) > 500 || Boolean(nextAction) !== Boolean(dueDate) || (rawDue && !dueDate)
    || [...fields.values()].some(value => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) return fail("invalid");
  try {
    const state = await createManualLead(actor, { requestId, name, phone, email, source, ownerId, direction, nextAction, dueDate } as ManualLeadInput);
    // «Заявки» (Э3) открывают ту же форму: лид с сайта сразу встаёт в очередь.
    if (state.status === "saved") { revalidatePath("/v3/pipeline"); revalidatePath("/v3/requests"); }
    // Отдельный вызов после создания: payload `create_manual_sales_lead` не меняется, повтор старой формы
    // не конфликтует. Касание ставится и на существующего лида при `duplicate`, если сервер его вернул.
    if ((state.status === "saved" || state.status === "duplicate") && state.leadId) {
      const touch = await recordLeadTouch(actor, {
        leadId: state.leadId, channel: channel as LeadChannel, kind: "staff_manual",
        requestId: leadTouchRequestId(requestId, "staff_manual", state.leadId),
      });
      return { ...state, touch: touch.status === "saved" ? "saved" : touch.status === "forbidden" ? "forbidden" : "failed" };
    }
    return state;
  } catch { return fail("unavailable"); }
}
