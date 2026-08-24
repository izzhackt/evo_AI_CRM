export const PLATFORM_SALES_WORKFLOW_MAX_PAGE_SIZE = 50;

export const PLATFORM_SALES_STAGES = [
  "new",
  "contacting",
  "qualified",
  "meeting_scheduled",
  "meeting_completed",
  "potential",
] as const;

export const PLATFORM_SALES_CONNECTION_FILTERS = [
  "all",
  "connected",
  "unconnected",
] as const;

export const PLATFORM_SALES_ASSIGNMENT_FILTERS = [
  "all",
  "mine",
  "unassigned",
] as const;

export const PLATFORM_SALES_DUE_FILTERS = [
  "all",
  "scheduled",
  "unscheduled",
  "due_today",
  "overdue",
] as const;

export type PlatformSalesStage = (typeof PLATFORM_SALES_STAGES)[number];
export type PlatformSalesConnectionFilter =
  (typeof PLATFORM_SALES_CONNECTION_FILTERS)[number];
export type PlatformSalesAssignmentFilter =
  (typeof PLATFORM_SALES_ASSIGNMENT_FILTERS)[number];
export type PlatformSalesDueFilter =
  (typeof PLATFORM_SALES_DUE_FILTERS)[number];

export type PlatformSalesWorkflowCursor = Readonly<{
  updatedAt: string;
  leadId: string;
}>;

export type PlatformSalesOwnerCursor = Readonly<{
  sortLabel: string;
  membershipId: string;
}>;

export type PlatformSalesLeadWorkflow = Readonly<{
  organizationId: string;
  leadId: string;
  clientId: string | null;
  clientDisplayName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  currentOwnerMembershipId: string | null;
  currentOwnerDisplayName: string | null;
  stage: PlatformSalesStage;
  sourceKey: string;
  lifecycleState: "open";
  nextActionText: string | null;
  nextActionDueDate: string | null;
  workflowVersion: number;
  isConnected: boolean;
  openDuplicateCandidateCount: number;
  linkedStudentCaseCount: number;
  linkedConversationCount: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformSalesLeadWorkflowDetail = PlatformSalesLeadWorkflow &
  Readonly<{
    externalIdentifiers: readonly unknown[];
    provenance: readonly unknown[];
    linkedStudentCases: readonly unknown[];
    linkedConversations: readonly unknown[];
  }>;

export type PlatformSalesLeadPage = Readonly<{
  rows: readonly PlatformSalesLeadWorkflow[];
  nextCursor: PlatformSalesWorkflowCursor | null;
  hasNext: boolean;
}>;

export type PlatformSalesOwnerOption = Readonly<{
  sortLabel: string;
  membershipId: string;
  displayLabel: string;
}>;

export type PlatformSalesOwnerPage = Readonly<{
  rows: readonly PlatformSalesOwnerOption[];
  nextCursor: PlatformSalesOwnerCursor | null;
  hasNext: boolean;
}>;

export type PlatformSalesLeadPageOptions = Readonly<{
  cursor?: PlatformSalesWorkflowCursor | null;
  pageSize?: number;
  connection?: PlatformSalesConnectionFilter;
  stage?: PlatformSalesStage | null;
  assignment?: PlatformSalesAssignmentFilter;
  ownerMembershipId?: string | null;
  due?: PlatformSalesDueFilter;
  query?: string | null;
}>;

export type PlatformSalesOwnerPageOptions = Readonly<{
  cursor?: PlatformSalesOwnerCursor | null;
  pageSize?: number;
  query?: string | null;
}>;

export type PlatformSalesWorkflowMutationInput = Readonly<{
  leadId: string;
  expectedWorkflowVersion: number;
  requestId: string;
  stage: PlatformSalesStage;
  ownerMembershipId: string | null;
  nextActionText: string | null;
  nextActionDueDate: string | null;
  clearNextAction: boolean;
  reason: string | null;
}>;

export type PlatformSalesWorkflowMutationReceipt = Readonly<{
  requestId: string;
  organizationId: string;
  leadId: string;
  stage: PlatformSalesStage;
  currentOwnerMembershipId: string | null;
  nextActionText: string | null;
  nextActionDueDate: string | null;
  workflowVersion: number;
  changedAt: string;
}>;
