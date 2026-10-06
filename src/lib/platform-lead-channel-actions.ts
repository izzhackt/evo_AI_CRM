"use server";
import { revalidatePath } from "next/cache";
import { isLeadChannel, type LeadChannelCorrectionState } from "./lead-channel-contract";
import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { recordLeadTouch } from "./v3/lead-channel-source";

/**
 * Исправление «Откуда узнал» в Lead 360 (`staff_correction`): сильнее первого касания, история
 * сохраняется. Просмотр роли ничего не пишет; права на лиде проверяет база.
 */
export async function correctLeadChannelAction(previous: LeadChannelCorrectionState, form: FormData): Promise<LeadChannelCorrectionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "lead_id", "channel"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const fail = (status: LeadChannelCorrectionState["status"]): LeadChannelCorrectionState => ({ status, requestId: requestId ?? previous.requestId, read: null });
  const leadId = fields && parseSalesUuid(fields.get("lead_id"));
  const channel = fields?.get("channel") ?? "";
  if (!fields || !requestId || !leadId || !isLeadChannel(channel)) return fail("invalid");
  if (isStaffPreview(actor) || !staffHasPermission(actor, "lead.sales.workflow.manage")) return fail("forbidden");
  const touch = await recordLeadTouch(actor, { leadId, channel, kind: "staff_correction", requestId });
  if (touch.status !== "saved") return fail(touch.status);
  revalidatePath("/v3/profile");
  return { status: "saved", requestId, read: touch.read };
}
