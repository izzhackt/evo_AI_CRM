/** The shared public contract. Editorial playbooks never confer immigration eligibility. */
export const ADMISSIONS_DIRECTIONS = ['CN', 'MY', 'EUROPE', 'AE', 'TR'] as const;
export type AdmissionsDirection = typeof ADMISSIONS_DIRECTIONS[number];
export const ADMISSIONS_ATTENTION = ['overdue', 'awaiting_partner', 'submitted', 'decisions', 'visas', 'arrivals', 'awaiting_ack', 'needs_curator'] as const;
export type AdmissionsAttention = typeof ADMISSIONS_ATTENTION[number];

/**
 * Сводка по направлениям (unified workflow S4, plan §12: «показываем только
 * сведения, которые реально ведём»). `stock` keeps only counts the product
 * still tracks — the mandatory route/submission/visa/arrival stage tracker
 * (and its `periodArrivals` metric) is retired; migration 183 narrows
 * `admissions_direction_summary_v1` to match this shape.
 */
export interface AdmissionsSummary {
  stock: { direction: AdmissionsDirection | 'unknown'; active: number; overdue: number; awaiting_ack: number; needs_curator: number }[];
}
