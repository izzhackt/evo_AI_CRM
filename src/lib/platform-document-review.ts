import type { PlatformStudentCaseDocument } from "./platform-student-profile";

/**
 * Prevents the staff action from treating a document version from another case
 * as the version named by the current Student 360 page. The database repeats
 * this check under locks to close the race after this read-only preflight.
 */
export function isCurrentSubmittedPlatformDocumentVersion(
  documents: readonly PlatformStudentCaseDocument[],
  expectedStudentCaseId: string,
  expectedDocumentVersionId: string,
): boolean {
  return documents.filter(
    (document) =>
      document.studentCaseId === expectedStudentCaseId &&
      document.slotStatus === "submitted" &&
      document.documentVersionId === expectedDocumentVersionId &&
      document.versionNumber !== null,
  ).length === 1;
}
