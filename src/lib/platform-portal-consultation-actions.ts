"use server";

import { revalidatePath } from "next/cache";

import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * «Обработано» для запроса консультации (PORT-5b, миграция 197). Реальная
 * граница — RPC handle_portal_consultation_request_v1 (разрешение очереди
 * «Заявки» lead.read, admin included); здесь — транспорт и честные исходы:
 * PT409 — конфликт состояния (кто-то уже обработал), не тихий успех.
 */
export type HandleConsultationResult = Readonly<{
  status: "handled" | "conflict" | "forbidden" | "invalid" | "unavailable";
}>;

export async function handlePortalConsultationAction(
  rowId: unknown,
  expectedStatus: unknown,
): Promise<HandleConsultationResult> {
  const actor = await requirePlatformStaffActor();
  const id = parseSalesUuid(rowId);
  if (!id || (expectedStatus !== "requested" && expectedStatus !== "handled")) {
    return { status: "invalid" };
  }
  if (isStaffPreview(actor) || !staffHasPermission(actor, "lead.read")) {
    return { status: "forbidden" };
  }
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .schema("platform")
      .rpc("handle_portal_consultation_request_v1", {
        p_row_id: id,
        p_expected_status: expectedStatus,
      });
    if (error) {
      if (error.code === "PT409") return { status: "conflict" };
      if (error.code === "42501") return { status: "forbidden" };
      if (error.code === "22023") return { status: "invalid" };
      return { status: "unavailable" };
    }
    const receipt = data as Record<string, unknown> | null;
    if (receipt === null || typeof receipt !== "object" || receipt.status !== "handled") {
      return { status: "unavailable" };
    }
    revalidatePath("/v3/requests");
    return { status: "handled" };
  } catch {
    return { status: "unavailable" };
  }
}
