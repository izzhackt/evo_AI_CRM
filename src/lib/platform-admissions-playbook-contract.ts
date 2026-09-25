/** The shared public contract. Editorial playbooks never confer immigration eligibility. */
export const ADMISSIONS_DIRECTIONS = ['CN', 'MY', 'EUROPE', 'AE', 'TR'] as const;
export type AdmissionsDirection = typeof ADMISSIONS_DIRECTIONS[number];
export const ADMISSIONS_ATTENTION = ['overdue', 'awaiting_partner', 'submitted', 'decisions', 'visas', 'arrivals', 'awaiting_ack', 'needs_curator'] as const;
export type AdmissionsAttention = typeof ADMISSIONS_ATTENTION[number];
