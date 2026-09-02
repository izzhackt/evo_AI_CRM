export const PLATFORM_SALES_STAGES = [
  "new",
  "contacting",
  "qualified",
  "meeting_scheduled",
  "meeting_completed",
  "potential",
] as const;

export type PlatformSalesStage = (typeof PLATFORM_SALES_STAGES)[number];

export type PlatformSalesOwnerOption = Readonly<{
  membershipId: string;
  displayLabel: string;
}>;

export type PlatformSalesWorkflowFormLead = Readonly<{
  leadId: string;
  currentOwnerMembershipId: string | null;
  currentOwnerDisplayName: string | null;
  stageKey: PlatformSalesStage;
  nextActionText: string | null;
  nextActionDueDate: string | null;
  workflowVersion: string;
}>;
