// Synthetic input builder for narrow native gates; never an application source.
import { PROFILE_FIELD_KEYS } from "../../src/lib/student-profile-fields.ts";
import { computeUniversityFormMappingHash } from "../../src/lib/university-form-fields.ts";
import { computePackageGeneratedInputHash } from "../../src/lib/document-package.ts";

const id = n => `64167000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function formRenderFixture(inspection, { mode = "final", value = "Айлин Synthetic Ө Ү Ң", unconfirmed = false,
  sourceKey = "student_first_name", mappings, fields = {} } = {}) {
  if (inspection.status !== "verified") throw new Error("Synthetic source not inspected");
  const pdf = inspection.manifest.format === "pdf", sha = inspection.sha256;
  const mapping = { versionId: id(8), templateVersionId: id(6), templateSha256: sha, mappings: mappings ?? [
    { slotId: pdf ? "pdf-1" : inspection.manifest.slots.find(slot => slot.editable).id,
      sourceKey, required: true, format: "text", manual: false,
      ...(pdf ? { position: { page: 1, x: 20, y: 40, width: 250, height: 32 } } : {}) },
  ] };
  mapping.sha256 = await computeUniversityFormMappingHash(mapping);
  const formInput = {
    schema_version: 1, kind: "university_form", organization_id: id(1), student_case_id: id(2),
    form: { application_id: id(3), catalog_institution_id: id(4), catalog_source_revision: "catalog-v1",
      template_id: id(5), template_version_id: id(6), inspection_receipt_id: id(7), mapping_id: id(8),
      mapping_sha256: mapping.sha256, review_id: id(9), validation_day: "2026-09-14" },
    template: { versionId: id(6), sha256: sha, manifest: inspection.manifest }, mapping,
    review: { versionId: id(9), templateVersionId: id(6), templateSha256: sha, mappingVersionId: id(8), mappingSha256: mapping.sha256, state: "approved" },
    source_byte_size: inspection.byteLength, source_mime_type: inspection.mimeType,
    manifest_sha256: "c".repeat(64), renderer_version: pdf ? "evo-university-form-pdf-v1" : "evo-university-form-docx-v1",
    font_sha256: pdf ? "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5" : null,
    mode, frozen_profile: { student_case_id: id(2), profile: { id: id(10), revision: 1 },
      can_initialize: false, can_review: false, can_export: true,
      fields: PROFILE_FIELD_KEYS.map(key => ({ field_key: key, value: unconfirmed && key === sourceKey ? null : fields[key] ?? (key === sourceKey ? value : null),
        review_state: unconfirmed && key === sourceKey ? "extracted" : "confirmed", reviewed_at: "2026-09-14T00:00:00Z", source_document_version_id: null,
        source_page: null, proposals: [] })) },
  };
  const binding = { artifactId: id(11), preparationId: id(12), inputSnapshotSha256: "1".repeat(64), fieldReviewsSha256: "3".repeat(64),
    generatedInputSha256: await computePackageGeneratedInputHash({ kind: "university_form", organizationId: id(1), studentCaseId: id(2),
      profileId: id(10), profileRevision: 1, fieldReviewsSha256: "3".repeat(64), templateSha256: sha, applicationId: id(3),
      catalogInstitutionId: id(4), templateVersionId: id(6), mappingVersionId: id(8), mappingSha256: mapping.sha256, mappingReviewVersionId: id(9) }) };
  return { formInput, binding };
}

/** Rebind a changed synthetic approved mapping; never used for invalid-hash controls. */
export async function rebindFormFixture(fixture) {
  const f = fixture.formInput;
  f.mapping.sha256 = await computeUniversityFormMappingHash(f.mapping);
  f.form.mapping_sha256 = f.mapping.sha256; f.review.mappingSha256 = f.mapping.sha256;
  fixture.binding.generatedInputSha256 = await computePackageGeneratedInputHash({ kind: "university_form", organizationId: f.organization_id,
    studentCaseId: f.student_case_id, profileId: f.frozen_profile.profile.id, profileRevision: f.frozen_profile.profile.revision,
    fieldReviewsSha256: fixture.binding.fieldReviewsSha256, templateSha256: f.template.sha256, applicationId: f.form.application_id,
    catalogInstitutionId: f.form.catalog_institution_id, templateVersionId: f.template.versionId, mappingVersionId: f.mapping.versionId,
    mappingSha256: f.mapping.sha256, mappingReviewVersionId: f.review.versionId });
  return fixture;
}
