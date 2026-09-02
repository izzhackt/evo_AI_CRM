export const PLATFORM_APPLICATION_STATUSES = [
  "preparation",
  "ready",
  "submitted",
  "under_review",
  "offer",
  "rejected",
  "enrolled",
  "withdrawn",
  "closed",
] as const;

export type PlatformApplicationStatus =
  (typeof PLATFORM_APPLICATION_STATUSES)[number];

export const PLATFORM_APPLICATION_EVIDENCE_STATUSES = new Set<
  PlatformApplicationStatus
>(["submitted", "under_review", "offer", "rejected", "enrolled"]);

export type PlatformApplicationQueueRow = Readonly<{
  organizationId: string;
  universityApplicationId: string;
  studentCaseId: string;
  studentDisplayName: string;
  targetCountry: string | null;
  targetDegree: string | null;
  programDirection: string | null;
  intake: string | null;
  institutionName: string;
  programName: string;
  status: PlatformApplicationStatus;
  latestEvidenceReference: string | null;
  createdAt: string;
  updatedAt: string;
  responsibleSalesDisplayName: string;
  currentCuratorDisplayName: string | null;
  documentCount: number;
  openDocumentCount: number;
  taskCount: number;
  openTaskCount: number;
  paymentObligationCount: number;
  outstandingPaymentObligationCount: number;
}>;
