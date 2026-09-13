import "server-only";
import { universityUuid } from "../platform-university-catalog.ts";
import { normalizeUniversityFormRegistryMappings, UNIVERSITY_TEMPLATE_MIME,
  type UniversityFormRegistryRpcContract, type UniversityTemplateMime } from "../university-form-registry.ts";
import { exactActionStringFields } from "./action-form-fields.ts";

type Args<K extends keyof UniversityFormRegistryRpcContract> = Omit<UniversityFormRegistryRpcContract[K]["args"], "p_organization_id">;
export type UniversityFormManagementIntent =
  | { operation: "save_mapping"; mimeType: UniversityTemplateMime; args: Args<"save_university_form_mapping"> }
  | { operation: "review_mapping"; args: Args<"review_university_form_mapping"> }
  | { operation: "publish"; args: Args<"publish_university_form_template"> }
  | { operation: "archive"; args: Args<"archive_university_form_template"> };

const COMMON = ["operation", "template_id", "request_id", "expected_revision", "reason"];
const FIELDS = {
  save_mapping: ["mapping_id", "template_version_id", "template_sha256", "mime_type", "mappings"],
  review_mapping: ["mapping_id", "mapping_sha256", "decision", "confirmed"],
  publish: ["mapping_id", "mapping_sha256", "review_id", "confirmed"],
  archive: ["confirmed"],
} as const;
const HASH = /^[a-f0-9]{64}$/u;

/** Browser intent only. No receipt, scan, actor or source manifest is accepted. */
export function parseUniversityFormManagement(form: FormData): UniversityFormManagementIntent | null {
  for (const operation of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
    const fields = exactActionStringFields(form, [...COMMON, ...FIELDS[operation]]);
    if (!fields || fields.get("operation") !== operation) continue;
    const templateId = universityUuid(fields.get("template_id")), requestId = universityUuid(fields.get("request_id"));
    const rawRevision = fields.get("expected_revision")!, revision = Number(rawRevision);
    const reason = fields.get("reason")!.trim();
    if (!templateId || !requestId || !/^[1-9]\d{0,15}$/u.test(rawRevision)
      || !Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER
      || !reason || [...reason].length > 500 || /[\u0000-\u001f\u007f-\u009f]/u.test(reason)) return null;
    const common = { p_template_id: templateId, p_request_id: requestId, p_expected_revision: revision, p_reason: reason };
    if (operation === "archive") return fields.get("confirmed") === "yes" ? { operation, args: common } : null;
    const mappingId = universityUuid(fields.get("mapping_id"));
    if (!mappingId) return null;
    if (operation === "save_mapping") {
      const versionId = universityUuid(fields.get("template_version_id")), sha256 = fields.get("template_sha256")!;
      const mimeType = fields.get("mime_type") as UniversityTemplateMime, raw = fields.get("mappings")!;
      if (!versionId || !HASH.test(sha256) || !UNIVERSITY_TEMPLATE_MIME.includes(mimeType)
        || new TextEncoder().encode(raw).byteLength > 1048576) return null;
      try {
        return { operation, mimeType, args: { ...common, p_mapping_id: mappingId, p_template_version_id: versionId,
          p_template_sha256: sha256, p_mappings: normalizeUniversityFormRegistryMappings(JSON.parse(raw), mimeType) } };
      } catch { return null; }
    }
    const sha256 = fields.get("mapping_sha256")!;
    if (!HASH.test(sha256) || fields.get("confirmed") !== "yes") return null;
    if (operation === "review_mapping") {
      const decision = fields.get("decision");
      return decision === "approved" || decision === "rejected"
        ? { operation, args: { ...common, p_mapping_id: mappingId, p_mapping_sha256: sha256, p_decision: decision } } : null;
    }
    const reviewId = universityUuid(fields.get("review_id"));
    return reviewId ? { operation, args: { ...common, p_mapping_id: mappingId, p_mapping_sha256: sha256, p_review_id: reviewId } } : null;
  }
  return null;
}
