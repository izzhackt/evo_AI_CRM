"use server";

import { randomUUID } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import { createSupabaseServerClient } from "./supabase/server";
import {
  createPlatformUniversityFormTemplate, getPlatformUniversityFormWorkspace,
  reservePlatformUniversityFormVersion, PlatformUniversityFormError,
} from "./platform-university-forms.ts";
import { parseUniversityFormCreate, parseUniversityFormVersion } from "./server/university-form-action-input.ts";
import type { UniversityFormActionState } from "./university-form-ui.ts";

export async function createUniversityFormAction(_previous: UniversityFormActionState, form: FormData): Promise<UniversityFormActionState> {
  const actor = await requirePlatformStaffActor();
  const command = parseUniversityFormCreate(form);
  const requestId = command?.p_request_id ?? randomUUID();
  const result = (status: UniversityFormActionState["status"]): UniversityFormActionState => ({ status, requestId, receipt: null });
  if (isStaffPreview(actor) || !staffHasPermission(actor, "catalog.import.manage")) return result("forbidden");
  if (!command) return result("invalid_request");
  try {
    const client = await createSupabaseServerClient();
    const receipt = await createPlatformUniversityFormTemplate(client, { ...command, p_organization_id: actor.organizationId });
    // No immediate route remount: it would discard the exact in-flight intent.
    // The next explicit navigation reads the force-dynamic workspace afresh.
    return { status: "saved", requestId, receipt };
  } catch (error) {
    unstable_rethrow(error);
    return result(error instanceof PlatformUniversityFormError ? error.code : "unavailable");
  }
}

export async function reserveUniversityFormVersionAction(_previous: UniversityFormActionState, form: FormData): Promise<UniversityFormActionState> {
  const actor = await requirePlatformStaffActor();
  const command = parseUniversityFormVersion(form);
  const requestId = command?.p_request_id ?? randomUUID();
  const result = (status: UniversityFormActionState["status"]): UniversityFormActionState => ({ status, requestId, receipt: null });
  if (isStaffPreview(actor) || !staffHasPermission(actor, "catalog.import.manage")) return result("forbidden");
  if (!command) return result("invalid_request");
  try {
    const client = await createSupabaseServerClient();
    const workspace = await getPlatformUniversityFormWorkspace(client, { p_template_id: command.p_template_id });
    if (workspace.template.organization_id !== actor.organizationId || !workspace.can_manage) return result("forbidden");
    // SQL checks expected revision/replay under its lock; do not pre-empt replay
    // by comparing the earlier revision to this read.
    const receipt = await reservePlatformUniversityFormVersion(client, { ...command, p_organization_id: actor.organizationId });
    // This is a reservation, not evidence that bytes were uploaded or inspected.
    return { status: "saved", requestId, receipt };
  } catch (error) {
    unstable_rethrow(error);
    return result(error instanceof PlatformUniversityFormError ? error.code : "unavailable");
  }
}
