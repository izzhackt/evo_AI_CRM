import { computePackageRulesHash, computePackageGeneratedInputHash } from "../../src/lib/document-package.ts";
export const id = number => `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const hash = "a".repeat(64);
export async function fixture() {
  const rules = { versionId: id(4), slots: [{ id: id(5), required: true, sourceKind: "document_version", role: "original", documentTypeCode: "passport",
    allowedMimeTypes: ["application/pdf"], maxBytes: 1024, minPages: 1 }] };
  rules.sha256 = await computePackageRulesHash(rules);
  const ref = { kind: "document_version", documentId: id(7), versionId: id(8) };
  return { packageId: id(1), organizationId: id(2), studentCaseId: id(3), applicationId: null, catalogInstitutionId: null, revision: 1, rules,
    currentDocumentVersions: [{ documentId: id(7), versionId: id(8), sha256: hash }],
    items: [{ id: id(6), slotId: id(5), selected: true,
      source: { ref, organizationId: id(2), studentCaseId: id(3), sha256: hash, sizeBytes: 100, mimeType: "application/pdf", role: "original", documentTypeCode: "passport", parent: null, available: true, export: null },
      review: { id: id(9), packageId: id(1), itemId: id(6), ref, sourceSha256: hash, parent: null, rulesVersionId: id(4), rulesSha256: rules.sha256,
        state: "approved", verifiedPages: 1, reviewerMembershipId: id(10), reviewedAt: "2026-09-13T00:00:00.000Z" } }] };
}
export async function generatedFixture(kind = "student_profile_export") {
  const snapshot = await fixture(), item = snapshot.items[0], slot = snapshot.rules.slots[0];
  slot.sourceKind = kind; slot.role = "generated"; slot.documentTypeCode = null;
  snapshot.rules.sha256 = await computePackageRulesHash(snapshot.rules);
  snapshot.currentDocumentVersions = [];
  const input = { kind: kind === "student_profile_export" ? "student_profile" : "university_form", organizationId: snapshot.organizationId,
    studentCaseId: snapshot.studentCaseId, profileId: id(20), profileRevision: 2, fieldReviewsSha256: hash, templateSha256: "b".repeat(64) };
  if (kind === "university_form_export") {
    snapshot.applicationId = id(21); snapshot.catalogInstitutionId = id(22);
    Object.assign(input, { applicationId: id(21), catalogInstitutionId: id(22), templateVersionId: id(23), mappingVersionId: id(24),
      mappingSha256: "c".repeat(64), mappingReviewVersionId: id(25) });
  }
  Object.assign(item.source, { ref: { kind, exportId: id(26) }, role: "generated", documentTypeCode: null,
    export: { generationReceiptId: id(27), exportId: id(26), artifactSha256: hash, mode: "final", outcome: "ready", inputSha256: await computePackageGeneratedInputHash(input), input, currentInput: structuredClone(input) } });
  Object.assign(item.review, { ref: { ...item.source.ref }, rulesSha256: snapshot.rules.sha256 });
  return snapshot;
}
