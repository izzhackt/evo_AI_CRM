"use server";

import { revalidatePath } from "next/cache";
import { isStaffPreview, staffHasPermission } from "../platform-access";
import { requirePlatformStaffActor } from "../platform-guards";
import { createSupabaseServerClient } from "../supabase/server";
import { parseApplicationRequirementsTarget } from "../portal/application-requirements.ts";
import {
  applicationRequirementsEditorFailure, applicationRequirementsEditorRpcArgs,
  parseApplicationRequirementsEditorContext, parseApplicationRequirementsEditorIntent, parseApplicationRequirementsEditorReceipt,
  type RequirementsEditorOwner, type ApplicationRequirementsEditorContext, type ApplicationRequirementsEditorResult,
} from "../portal/application-requirements-editor.ts";

export type StaffRequirementsEditorRead = Readonly<{ status: "ready"; value: ApplicationRequirementsEditorContext }>
  | Readonly<{ status: "invalid" | "forbidden" | "unavailable" | "legacy_configuration_conflict" | "editor_limit" }>;

/** Owner correlation applies to reads too: a retained form never follows an account switch. */
export async function readStaffRequirementsEditorAction(owner: RequirementsEditorOwner, input: unknown): Promise<StaffRequirementsEditorRead> {
  try {
    const actor = await requirePlatformStaffActor();
    if (!owner || owner.organizationId !== actor.organizationId || owner.membershipId !== actor.membershipId || isStaffPreview(actor) || !staffHasPermission(actor, "document.read.full")) return { status: "forbidden" };
    const target = parseApplicationRequirementsTarget(input);
    if (!target) return { status: "invalid" };
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("staff_application_requirements_editor_v1", {
      p_student_case_id: target.studentCaseId, p_application_id: target.applicationId,
    });
    if (error) {
      const reason = applicationRequirementsEditorFailure(error);
      return { status: reason === "forbidden" || reason === "legacy_configuration_conflict" || reason === "editor_limit" ? reason : "unavailable" };
    }
    const value = parseApplicationRequirementsEditorContext(data, target.studentCaseId, target.applicationId);
    return value ? { status: "ready", value } : { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
}

export async function saveStaffRequirementsEditorAction(owner: RequirementsEditorOwner, input: unknown): Promise<ApplicationRequirementsEditorResult> {
  let receipt;
  try {
    const actor = await requirePlatformStaffActor();
    if (!owner || owner.organizationId !== actor.organizationId || owner.membershipId !== actor.membershipId || isStaffPreview(actor) || !staffHasPermission(actor, "document.manage")) return { ok: false, reason: "forbidden", resolution: "retain" };
    const intent = parseApplicationRequirementsEditorIntent(input);
    if (!intent) return { ok: false, reason: "invalid", resolution: "retain" };
    // Ordinary authenticated RPC; organization/actor authority is resolved inside SQL.
    // Do not pre-read lifecycle here: exact authorized replay precedes stale/lifecycle checks.
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("staff_save_application_requirements_v1", applicationRequirementsEditorRpcArgs(intent));
    if (error) {
      const reason = applicationRequirementsEditorFailure(error);
      // These exact SQL failures occur only after replay lookup. Authorization,
      // conflict, invalid intent, limits and unknown errors do not prove no commit.
      const definitive = ["stale_context", "case_ineligible", "application_ineligible", "legacy_configuration_conflict"].includes(reason);
      return { ok: false, reason, resolution: definitive ? "not_written" : "retain" };
    }
    receipt = parseApplicationRequirementsEditorReceipt(data, intent);
    if (!receipt) return { ok: false, reason: "unavailable", resolution: "retain" };
  } catch { return { ok: false, reason: "unavailable", resolution: "retain" }; }
  // Once a correlated immutable receipt exists, refresh failure cannot erase success.
  for (const path of ["/portal", "/v3/profile", "/v3/documents"]) {
    try { revalidatePath(path); } catch { /* The caller can read again; this save is known. */ }
  }
  return { ok: true, receipt };
}
