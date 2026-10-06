import "server-only";
import { createHash } from "node:crypto";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor, PlatformActor } from "../platform-auth.ts";
import {
  isLeadChannel, parseLeadChannelRead,
  type LeadChannel, type LeadChannelRead, type LeadChannelState,
} from "../lead-channel-contract.ts";
import { parseSalesUuid } from "../platform-sales-register-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

export type LeadTouchKind = "staff_manual" | "staff_correction";
export type LeadTouchResult =
  | Readonly<{ status: "saved"; read: LeadChannelRead }>
  | Readonly<{ status: "forbidden" | "invalid" | "request_conflict" | "unavailable" }>;

/**
 * «Откуда узнал» лида (`read_lead_channel_v1`, миграция 264): канал, основание и
 * время решающего касания; сырых меток здесь нет. Сбой или чужая форма ответа —
 * `unavailable`, не «не известно».
 */
export async function readLeadChannel(actor: PlatformActor, leadId: string): Promise<LeadChannelState> {
  if (!parseSalesUuid(leadId) || !staffHasPermission(actor, "lead.read")) return { status: "unavailable" };
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform").rpc("read_lead_channel_v1", { p_lead_id: leadId });
    if (error) return { status: "unavailable" };
    const read = parseLeadChannelRead(data);
    return read ? { status: "available", read } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Детерминированный id касания из id формы: повтор той же отправки пишет то же
 * касание (`(kind, request_id)` идемпотентны в 264), а не второе.
 */
export function leadTouchRequestId(formRequestId: string, kind: LeadTouchKind): string {
  const hex = createHash("sha256").update(`evo:lead-touch:${kind}:${formRequestId.toLowerCase()}`).digest("hex");
  const variant = "89ab"[Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Запись выбора сотрудника (`record_lead_touch`, миграция 264): `staff_manual` — при
 * создании лида, `staff_correction` — исправление в Lead 360. Права проверяет база
 * (`lead.sales.workflow.manage` на этом лиде); отказ «нет лида» и «нет доступа» там не различается.
 */
export async function recordLeadTouch(
  actor: ActivePlatformActor,
  input: Readonly<{ leadId: string; channel: LeadChannel; kind: LeadTouchKind; requestId: string }>,
): Promise<LeadTouchResult> {
  // Режим просмотра роли для базы неотличим от admin: отказ — здесь, чтобы будущий вызов не обошёл действие.
  if (isStaffPreview(actor) || !staffHasPermission(actor, "lead.sales.workflow.manage")) return { status: "forbidden" };
  const leadId = parseSalesUuid(input.leadId), requestId = parseSalesUuid(input.requestId);
  if (!leadId || !requestId || !isLeadChannel(input.channel)) return { status: "invalid" };
  try {
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc("record_lead_touch", {
      p_lead_id: leadId, p_channel: input.channel, p_kind: input.kind, p_request_id: requestId,
    });
    if (error) {
      return { status: error.code === "42501" ? "forbidden" : error.code === "22023"
        ? error.message.includes("request_conflict") ? "request_conflict" : "invalid" : "unavailable" };
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || data.status !== "saved"
      || data.lead_id !== leadId || data.kind !== input.kind || data.request_id !== requestId
      || data.channel !== input.channel) return { status: "unavailable" };
    const read = parseLeadChannelRead(data.resolved);
    return read ? { status: "saved", read } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
