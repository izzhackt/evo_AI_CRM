import { PROFILE_FIELD_KEYS } from "../../src/lib/student-profile-fields.ts";

export function formInput(format = "docx") {
  const id = n => `64167000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const sha = "a".repeat(64), mappingSha = "b".repeat(64);
  return {
    schema_version: 1, kind: "university_form", organization_id: id(1), student_case_id: id(2),
    form: { application_id: id(3), catalog_institution_id: id(4), catalog_source_revision: "catalog-v1",
      template_id: id(5), template_version_id: id(6), inspection_receipt_id: id(7), mapping_id: id(8),
      mapping_sha256: mappingSha, review_id: id(9), validation_day: "2026-09-14" },
    template: { versionId: id(6), sha256: sha, manifest: format === "docx"
      ? { format, slots: [{ id: "p-1", editable: true }], pageSizes: [] }
      : { format, slots: [], pageSizes: [{ width: 612, height: 792 }] } },
    mapping: { versionId: id(8), templateVersionId: id(6), templateSha256: sha, sha256: mappingSha,
      mappings: [{ slotId: format === "docx" ? "p-1" : "pdf-1", sourceKey: "student_first_name", required: true,
        format: "text", manual: false, ...(format === "pdf" ? { position: { page: 1, x: 20, y: 20, width: 200, height: 32 } } : {}) }] },
    review: { versionId: id(9), templateVersionId: id(6), templateSha256: sha, mappingVersionId: id(8), mappingSha256: mappingSha, state: "approved" },
    source_byte_size: 100, source_mime_type: format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
    manifest_sha256: "c".repeat(64), renderer_version: `evo-university-form-${format}-v1`,
    font_sha256: format === "pdf" ? "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5" : null,
    mode: "final", frozen_profile: { student_case_id: id(2), profile: { id: id(10), revision: 1 },
      can_initialize: false, can_review: false, can_export: true,
      fields: PROFILE_FIELD_KEYS.map((key, index) => ({ field_key: key, value: index ? null : "Айлин Synthetic",
        review_state: "confirmed", reviewed_at: "2026-09-14T00:00:00Z", source_document_version_id: null,
        source_page: null, proposals: [] })) },
  };
}
