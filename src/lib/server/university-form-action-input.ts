import "server-only";
import { universityUuid } from "../platform-university-catalog.ts";
import type { UniversityFormRegistryRpcContract } from "../university-form-registry.ts";
import { exactActionStringFields } from "./action-form-fields.ts";

type CreateArgs = UniversityFormRegistryRpcContract["create_university_form_template"]["args"];

/** Parses a user intent; live authority and command outcome remain SQL's job. */
export function parseUniversityFormCreate(form: FormData): Omit<CreateArgs, "p_organization_id"> | null {
  const fields = exactActionStringFields(form, [
    "operation", "catalog_id", "template_id", "expected_revision", "request_id", "reason", "title",
  ]);
  if (!fields || fields.get("operation") !== "create" || fields.get("expected_revision") !== "0") return null;
  const catalogId = universityUuid(fields.get("catalog_id"));
  const templateId = universityUuid(fields.get("template_id"));
  const requestId = universityUuid(fields.get("request_id"));
  const title = fields.get("title")!.trim(), reason = fields.get("reason")!.trim();
  if (!catalogId || !templateId || !requestId || !title || !reason
    || [...title].length > 200 || [...reason].length > 500
    || /[\u0000-\u001f\u007f-\u009f]/u.test(title + reason)) return null;
  return {
    p_catalog_institution_id: catalogId, p_template_id: templateId, p_request_id: requestId,
    p_expected_revision: 0, p_title: title, p_reason: reason,
  };
}
