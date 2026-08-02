export const PLATFORM_STUDENT_PROFILE_FIELDS = [
  "preferred_display_name",
  "legal_display_name",
  "communication_language",
  "date_of_birth",
  "citizenship_country",
  "residency_country",
  "current_education_summary",
  "academic_summary",
  "language_summary",
  "budget_band",
  "decision_participant_labels",
  "consent_status",
  "consent_evidence_ref",
  "next_step",
] as const;

export type PlatformStudentProfileField =
  (typeof PLATFORM_STUDENT_PROFILE_FIELDS)[number];
