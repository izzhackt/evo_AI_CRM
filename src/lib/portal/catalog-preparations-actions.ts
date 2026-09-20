"use server";

import { revalidatePath } from "next/cache";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import { requirePlatformStaffActor } from "../platform-guards";
import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import {
  catalogPreparationFailure,
  catalogPreparationRpcArgs,
  parseCatalogPreparationIntent,
  parseCatalogPreparationReceipt,
  type CatalogPreparationActionResult,
  type CatalogPreparationIntent,
} from "./catalog-preparations.ts";

async function selectPreparation(
  intent: CatalogPreparationIntent,
  organizationId?: string,
): Promise<CatalogPreparationActionResult> {
  try {
    const client = await createSupabaseServerClient();
    const response = organizationId === undefined
      ? await client.schema("platform").rpc("student_select_catalog_intake_v1", catalogPreparationRpcArgs(intent))
      : await client.schema("platform").rpc("staff_select_catalog_intake_v1", {
        p_organization_id: organizationId,
        ...catalogPreparationRpcArgs(intent),
      });
    if (response.error) return { ok: false, reason: catalogPreparationFailure(response.error) };
    const receipt = parseCatalogPreparationReceipt(response.data, intent);
    if (!receipt) return { ok: false, reason: "unavailable" };
    revalidatePath("/portal");
    revalidatePath("/v3/profile");
    return { ok: true, receipt };
  } catch {
    // Do not replace the request ID or invent a successful selection after a lost response.
    return { ok: false, reason: "unavailable" };
  }
}

export async function selectStudentCatalogIntakeAction(value: unknown): Promise<CatalogPreparationActionResult> {
  await requireStudentPortalActor();
  const intent = parseCatalogPreparationIntent(value);
  if (!intent) return { ok: false, reason: "invalid" };
  return selectPreparation(intent);
}

export async function selectStaffCatalogIntakeAction(value: unknown): Promise<CatalogPreparationActionResult> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "application.manage")) {
    return { ok: false, reason: "forbidden" };
  }
  const intent = parseCatalogPreparationIntent(value);
  if (!intent) return { ok: false, reason: "invalid" };
  return selectPreparation(intent, actor.organizationId);
}
