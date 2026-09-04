export const PLATFORM_VISA_STATUSES = [
  "not_required",
  "not_started",
  "docs",
  "appointment",
  "submitted",
  "approved",
  "rejected",
  "closed",
] as const;

export const PLATFORM_OBLIGATION_CATEGORIES = [
  "evo_service_fee",
  "third_party_cost",
] as const;

export const PLATFORM_OBLIGATION_STATUSES = [
  "pending",
  "partially_paid",
  "paid",
  "overdue",
] as const;

export type PlatformVisaStatus = (typeof PLATFORM_VISA_STATUSES)[number];
export type PlatformObligationCategory =
  (typeof PLATFORM_OBLIGATION_CATEGORIES)[number];
export type PlatformObligationStatus =
  (typeof PLATFORM_OBLIGATION_STATUSES)[number];

export type PlatformCaseVisa = Readonly<{
  visaCaseId: string;
  version: string;
  studentCaseId: string;
  status: PlatformVisaStatus;
  note: string | null;
  updatedAt: string;
}>;

export type PlatformCaseFinanceRow = Readonly<{
  studentCaseId: string;
  paymentObligationId: string;
  label: string;
  category: PlatformObligationCategory;
  amountMinor: number;
  currency: string;
  dueAt: string;
  status: PlatformObligationStatus;
  overdue: boolean;
  outstandingMinor: number;
  nextAction: string;
}>;
