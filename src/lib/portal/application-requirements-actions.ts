"use server";

import { revalidatePath } from "next/cache";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import { requirePlatformStaffActor } from "../platform-guards";
import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import {
  applicationRequirementsFailure,
  applicationRequirementsRpcArgs,
  parseApplicationRequirementsIntent,
  parseApplicationRequirementsReceipt,
  type ApplicationRequirementsActionResult,
  type ApplicationRequirementsIntent,
} from "./application-requirements.ts";

async function initializeRequirements(
  intent: ApplicationRequirementsIntent,
  organizationId?: string,
): Promise<ApplicationRequirementsActionResult> {
  try {
    const client = await createSupabaseServerClient();
    const response = organizationId === undefined
      ? await client.schema("platform").rpc("student_initialize_application_requirements_v1", applicationRequirementsRpcArgs(intent))
      : await client.schema("platform").rpc("staff_initialize_application_requirements_v1", {
        p_organization_id: organizationId, ...applicationRequirementsRpcArgs(intent),
      });
    if (response.error) return { ok: false, reason: applicationRequirementsFailure(response.error), intent };
    const receipt = parseApplicationRequirementsReceipt(response.data, intent);
    if (!receipt) return { ok: false, reason: "unavailable", intent };
    revalidatePath("/portal");
    revalidatePath("/v3/profile");
    revalidatePath("/v3/documents");
    return { ok: true, receipt };
  } catch {
    // A lost response may follow a committed command. Keep the exact request for replay.
    return { ok: false, reason: "unavailable", intent };
  }
}

export async function initializeStudentApplicationRequirementsAction(value: unknown): Promise<ApplicationRequirementsActionResult> {
  await requireStudentPortalActor();
  const intent = parseApplicationRequirementsIntent(value);
  if (!intent) return { ok: false, reason: "invalid", intent: null };
  return initializeRequirements(intent);
}

export async function initializeStaffApplicationRequirementsAction(value: unknown): Promise<ApplicationRequirementsActionResult> {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "document.manage")) {
    return { ok: false, reason: "forbidden", intent: null };
  }
  const intent = parseApplicationRequirementsIntent(value);
  if (!intent) return { ok: false, reason: "invalid", intent: null };
  return initializeRequirements(intent, actor.organizationId);
}
