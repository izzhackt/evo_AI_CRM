import "server-only";
import { universityUuid } from "../platform-university-catalog.ts";
import { UNIVERSITY_TEMPLATE_MAX_BYTES, UNIVERSITY_TEMPLATE_MIME, type UniversityTemplateMime, type UniversityFormRegistryRpcContract } from "../university-form-registry.ts";
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

type ReserveArgs = UniversityFormRegistryRpcContract["reserve_university_form_version"]["args"];
export function parseUniversityFormVersion(form: FormData): Omit<ReserveArgs, "p_organization_id"> | null {
  const fields = exactActionStringFields(form, [
    "operation", "template_id", "expected_revision", "request_id", "reason",
    "sha256", "byte_size", "mime_type", "source_reference", "source_date",
  ]);
  if (!fields || fields.get("operation") !== "reserve_version") return null;
  const templateId = universityUuid(fields.get("template_id")), requestId = universityUuid(fields.get("request_id"));
  const revisionText = fields.get("expected_revision")!, sizeText = fields.get("byte_size")!;
  const revision = Number(revisionText), byteSize = Number(sizeText);
  const sha256 = fields.get("sha256")!, mime = fields.get("mime_type")!;
  const source = fields.get("source_reference")!.trim(), reason = fields.get("reason")!.trim();
  const date = fields.get("source_date")!;
  if (!templateId || !requestId || !/^[1-9]\d{0,15}$/u.test(revisionText)
    || !Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER
    || !/^[1-9]\d{0,8}$/u.test(sizeText) || byteSize > UNIVERSITY_TEMPLATE_MAX_BYTES
    || !/^[a-f0-9]{64}$/u.test(sha256) || !UNIVERSITY_TEMPLATE_MIME.includes(mime as UniversityTemplateMime)
    || !source || !reason || [...source].length > 500 || [...reason].length > 500
    || /[\u0000-\u001f\u007f-\u009f]/u.test(source + reason)
    || !/^(19|20|21)\d{2}-\d{2}-\d{2}$/u.test(date) || date > "2100-12-31"
    || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))
    || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) return null;
  return { p_template_id: templateId, p_request_id: requestId, p_expected_revision: revision,
    p_sha256: sha256, p_byte_size: byteSize, p_mime_type: mime as UniversityTemplateMime,
    p_source_reference: source, p_source_date: date, p_reason: reason };
}
