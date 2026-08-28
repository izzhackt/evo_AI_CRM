export const CANONICAL_SALES_STAGES = [
  "new",
  "qualifying",
  "qualified",
  "disqualified",
  "handoff_ready",
  "handed_off",
] as const;

export type CanonicalSalesStage = (typeof CANONICAL_SALES_STAGES)[number];

export const CANONICAL_SALES_DUE_FILTERS = [
  "all",
  "scheduled",
  "unscheduled",
  "due_today",
  "overdue",
] as const;

export type CanonicalSalesDueFilter =
  (typeof CANONICAL_SALES_DUE_FILTERS)[number];

export type CanonicalSalesWorkflowLead = Readonly<{
  leadId: string;
  stage: CanonicalSalesStage;
  qualificationSummary: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  version: number;
}>;
