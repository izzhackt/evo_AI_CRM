"use server";

import { randomUUID } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import { createSupabaseServerClient } from "./supabase/server";
import { archivePlatformUniversityFormTemplate, getPlatformUniversityFormWorkspace,
  savePlatformUniversityFormMapping, reviewPlatformUniversityFormMapping, publishPlatformUniversityFormTemplate,
  PlatformUniversityFormError } from "./platform-university-forms.ts";
import { parseUniversityFormManagement } from "./server/university-form-management-input.ts";
import type { UniversityFormActionState } from "./university-form-ui.ts";

/** Exact registry command, not a generated form or a layout approval. */
export async function manageUniversityFormAction(_previous: UniversityFormActionState, form: FormData): Promise<UniversityFormActionState> {
  const actor = await requirePlatformStaffActor();
  const intent = parseUniversityFormManagement(form);
  const requestId = intent?.args.p_request_id ?? randomUUID();
  const result = (status: UniversityFormActionState["status"]): UniversityFormActionState => ({ status, requestId, receipt: null });
  if (isStaffPreview(actor) || !staffHasPermission(actor, "catalog.import.manage")) return result("forbidden");
  if (!intent) return result("invalid_request");
  try {
    const client = await createSupabaseServerClient();
    if (intent.operation === "save_mapping") {
      const workspace = await getPlatformUniversityFormWorkspace(client, {
        p_template_id: intent.args.p_template_id, p_version_id: intent.args.p_template_version_id,
      });
      if (workspace.template.organization_id !== actor.organizationId) return result("forbidden");
      if (!workspace.selected_version || workspace.selected_version.sha256 !== intent.args.p_template_sha256
        || workspace.selected_version.mime_type !== intent.mimeType) return result("source_changed");
    }
    // Every RPC locks and rechecks live organization authority before replay.
    // Do not reject an archived/revised read first: an exact lost-reply replay
    // can legitimately target the revision before a successful archive.
    let receipt;
    switch (intent.operation) {
      case "save_mapping": receipt = await savePlatformUniversityFormMapping(client, { ...intent.args, p_organization_id: actor.organizationId }); break;
      case "review_mapping": receipt = await reviewPlatformUniversityFormMapping(client, { ...intent.args, p_organization_id: actor.organizationId }); break;
      case "publish": receipt = await publishPlatformUniversityFormTemplate(client, { ...intent.args, p_organization_id: actor.organizationId }); break;
      case "archive": receipt = await archivePlatformUniversityFormTemplate(client, { ...intent.args, p_organization_id: actor.organizationId }); break;
    }
    // Preserve the exact submitted intent until the UI receives its result.
    // Explicit next navigation reads the dynamic workspace and new revision.
    return { status: "saved", requestId, receipt };
  } catch (error) {
    unstable_rethrow(error);
    return result(error instanceof PlatformUniversityFormError ? error.code : "unavailable");
  }
}
