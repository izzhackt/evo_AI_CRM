import "server-only";

import { requireStudentPortalPreviewAuthority } from "./student-portal-preview";
import { projectAssessmentPreviewContent } from "./student-portal-assessment-preview-content";

export async function readStudentPortalAssessmentPreview(kind: "english" | "career") {
  await requireStudentPortalPreviewAuthority();
  const { default: content } = kind === "english"
    ? await import("../../../supabase/assessment-content/english-v1.json")
    : await import("../../../supabase/assessment-content/orvis-v1.json");
  return projectAssessmentPreviewContent(content);
}
