import "server-only";
import type { ActivePlatformActor } from "../platform-auth";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import { universityUuid } from "../platform-university-catalog.ts";
import { createSupabaseServerClient } from "../supabase/server";
import {
  getPlatformUniversityFormManagerTemplates, getPlatformUniversityFormWorkspace,
  getPlatformUniversityTemplateInspection, PlatformUniversityFormError,
} from "../platform-university-forms.ts";

export interface UniversityFormSelection {
  templateId?: string | null; versionId?: string | null; afterId?: string | null;
  beforeVersion?: number | null; beforeMapping?: number | null;
}

/** Staff-only source; each RPC also rechecks current DB membership and grants. */
export async function readUniversityFormWorkspace(actor: ActivePlatformActor, catalogId: string, selection: UniversityFormSelection = {}) {
  if (isStaffPreview(actor) || !staffHasPermission(actor, "catalog.import.manage")) throw new PlatformUniversityFormError("forbidden");
  if (!universityUuid(catalogId) || [selection.templateId, selection.versionId, selection.afterId].some(id => id != null && !universityUuid(id))
    || (selection.versionId && !selection.templateId)
    || [selection.beforeVersion, selection.beforeMapping].some(value => value != null && (!Number.isSafeInteger(value) || value < 1)))
    throw new PlatformUniversityFormError("invalid_request");
  const client = await createSupabaseServerClient();
  const templates = await getPlatformUniversityFormManagerTemplates(client, { p_catalog_institution_id: catalogId, p_after_id: selection.afterId });
  if (!selection.templateId) return { templates, workspace: null, inspection: null };
  const workspace = await getPlatformUniversityFormWorkspace(client, {
    p_template_id: selection.templateId, p_version_id: selection.versionId,
    p_before_version: selection.beforeVersion, p_before_mapping: selection.beforeMapping,
  });
  // A valid foreign template ID must never attach another university's draft to
  // the selected catalogue screen, even if the actor can manage both.
  if (!workspace.can_manage || workspace.template.organization_id !== actor.organizationId
    || workspace.template.catalog_institution_id !== catalogId) throw new PlatformUniversityFormError("forbidden");
  const version = workspace.selected_version;
  const inspection = version ? await getPlatformUniversityTemplateInspection(client, {
    p_template_id: workspace.template.id, p_template_version_id: version.id,
  }) : null;
  if (inspection && (inspection.template_sha256 !== version!.sha256 || inspection.mime_type !== version!.mime_type
    || inspection.template_revision !== workspace.template.revision)) throw new PlatformUniversityFormError("unavailable");
  return { templates, workspace, inspection };
}
