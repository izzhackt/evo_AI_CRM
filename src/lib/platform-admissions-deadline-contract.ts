/** Human labels only: these dates are recorded facts, not inferred visa rules. */
export const ADMISSIONS_DEADLINE_LABELS = {
  application: "Подача заявления", partner_reply: "Ответ партнёра", correction: "Исправления",
  offer: "Условия / ответ на предложение", passport_expiry: "Срок паспорта",
  visa_expiry: "Срок визы", eval_expiry: "Срок eVAL", entry_visa_expiry: "Срок въездной визы",
} as const;
export type AdmissionsDeadlineKind = keyof typeof ADMISSIONS_DEADLINE_LABELS;
