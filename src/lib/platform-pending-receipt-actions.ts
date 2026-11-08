"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { isStaffPreview } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import type { AllocateReceiptOutcome } from "./platform-pending-receipts-contract";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

/** «Привязать к оплате»: чек из разбора документов (349) получает оплату дела. Права и проверки - в команде базы (те же, что у внесения оплаты). */
export async function allocatePendingReceiptAction(form: FormData): Promise<{ outcome: AllocateReceiptOutcome }> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor)) return { outcome: "forbidden" };
  const fields = exactActionStringFields(form, ["pending_receipt_id", "payment_event_id"]);
  if (!fields) return { outcome: "invalid" };
  const pendingId = parseSalesUuid(fields.get("pending_receipt_id")?.trim() ?? "");
  const eventId = parseSalesUuid(fields.get("payment_event_id")?.trim() ?? "");
  if (!pendingId || !eventId) return { outcome: "invalid" };
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.schema("platform").rpc("allocate_pending_receipt_v1", {
      p_organization_id: actor.organizationId, p_pending_receipt_id: pendingId, p_payment_event_id: eventId, p_request_id: randomUUID(),
    });
    if (error) {
      if (error.code === "42501") return { outcome: "forbidden" };
      if (error.code === "22023") return { outcome: /already_allocated/.test(error.message) ? "already_allocated" : "invalid" };
      return { outcome: "unavailable" };
    }
    revalidatePath("/profile");
    return { outcome: "saved" };
  } catch {
    return { outcome: "unavailable" };
  }
}
