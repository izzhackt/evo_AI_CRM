"use server";

import { requirePlatformMutationCapability } from "./platform-guards";
import { parsePlatformSalesUuid } from "./platform-sales";
import { exactActionStringFields } from "./server/action-form-fields";
import { newRegistrationToken, registrationLinkUrl } from "./server/student-registration-link";
import { createSupabaseServerClient } from "./supabase/server";

export type RegistrationLinkActionState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "created"; link: string; expiresAt: string }>
  | Readonly<{ status: "invalid" | "forbidden" | "case_exists" | "unavailable" }>;

/**
 * «Ссылка для регистрации» у лида (341, решение 07.11.2026). Ссылку делает сервер; в базу уходит только её sha256,
 * сотрудник видит ссылку один раз. Права решает база: доступ к лиду (lead.sales.workflow.manage).
 */
export async function createRegistrationLinkAction(
  _previous: RegistrationLinkActionState,
  form: FormData,
): Promise<RegistrationLinkActionState> {
  const actor = await requirePlatformMutationCapability("sales.write", "/profile");
  const fields = exactActionStringFields(form, ["lead_id"]);
  const leadId = parsePlatformSalesUuid(fields?.get("lead_id"));
  if (!leadId) return { status: "invalid" };
  const { token, hash } = newRegistrationToken();
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("create_student_registration_link_v1", {
      p_organization_id: actor.organizationId,
      p_lead_id: leadId,
      p_token_hash: hash,
    });
    if (error) {
      if (error.code === "42501") return { status: "forbidden" };
      if (error.code === "PT409") return { status: "case_exists" };
      return { status: error.code === "22023" ? "invalid" : "unavailable" };
    }
    const expiresAt = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).expires_at : null;
    if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) return { status: "unavailable" };
    return { status: "created", link: registrationLinkUrl(token), expiresAt };
  } catch {
    return { status: "unavailable" };
  }
}
