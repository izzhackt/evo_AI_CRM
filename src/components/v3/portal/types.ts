import type { PillTone } from "@/components/v3/Pill";

/**
 * Presentation-only contracts for the Student workspace.
 *
 * Database keys are deliberately absent. `src/lib/v3/portal-source.ts` owns
 * the conversion from canonical Supabase rows into these safe labels and
 * values. Portal components never guess a label and never fall back to a raw
 * status key.
 */
export type PortalStatus = Readonly<{
  label: string;
  tone: PillTone;
}>;

export type PortalOverviewView = Readonly<{
  stage: PortalStatus | null;
  nextStep: Readonly<{
    label: string;
    dueLabel: string | null;
  }> | null;
  curator: Readonly<{
    displayName: string;
  }> | null;
}>;

export type PortalDocumentItem = Readonly<{
  documentSlotId: string;
  label: string;
  instructions: string | null;
  status: PortalStatus;
  dueLabel: string | null;
  reworkReason: string | null;
  latestVersion: Readonly<{
    versionId: string;
    filename: string;
    submittedLabel: string | null;
  }> | null;
}>;

export type PortalDocumentsView = Readonly<{
  documents: readonly PortalDocumentItem[];
}>;

export type PortalTimelineItem = Readonly<{
  id: string;
  label: string;
  occurredLabel: string | null;
}>;

export type PortalApplicationItem = Readonly<{
  applicationId: string;
  institutionName: string;
  programName: string;
  status: PortalStatus;
  deadlineLabel: string | null;
  timeline: readonly PortalTimelineItem[];
}>;

export type PortalVisaItem = Readonly<{
  visaCaseId: string;
  title: string;
  status: PortalStatus;
  timeline: readonly PortalTimelineItem[];
}>;

export type PortalApplicationsView = Readonly<{
  applications: readonly PortalApplicationItem[];
  visa: PortalVisaItem | null;
}>;

export type PortalPaymentItem = Readonly<{
  paymentObligationId: string;
  label: string;
  status: PortalStatus;
  amountLabel: string;
  paidLabel: string;
  outstandingLabel: string;
  dueLabel: string | null;
  nextAction: string | null;
}>;

export type PortalPaymentsView = Readonly<{
  payments: readonly PortalPaymentItem[];
}>;

export type PortalNotificationItem = Readonly<{
  notificationId: string;
  subject: string;
  detail: string | null;
  createdLabel: string;
  dueLabel: string | null;
  read: boolean;
}>;

export type PortalNotificationsView = Readonly<{
  notifications: readonly PortalNotificationItem[];
}>;
