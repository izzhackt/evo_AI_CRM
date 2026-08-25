export const PLATFORM_ADMISSIONS_GATE_STATES = [
  "blocked",
  "satisfied",
  "overridden",
] as const;

export const PLATFORM_ADMISSIONS_GATE_ACTIONS = [
  "confirm_contract",
  "confirm_first_payment",
  "override_gate",
] as const;

export type PlatformAdmissionsGateState =
  (typeof PLATFORM_ADMISSIONS_GATE_STATES)[number];
export type PlatformAdmissionsGateAction =
  (typeof PLATFORM_ADMISSIONS_GATE_ACTIONS)[number];

export type PlatformAdmissionsGate = Readonly<{
  organizationId: string;
  leadId: string;
  contractConfirmed: boolean;
  contractConfirmedByMembershipId: string | null;
  contractConfirmedAt: string | null;
  contractEvidenceReference: string | null;
  firstPaymentAmount: number | null;
  firstPaymentCurrency: string | null;
  firstPaymentDueDate: string | null;
  firstPaymentReceivedDate: string | null;
  firstPaymentConfirmed: boolean;
  firstPaymentConfirmedByMembershipId: string | null;
  firstPaymentConfirmedAt: string | null;
  firstPaymentEvidenceReference: string | null;
  overrideReason: string | null;
  overriddenByMembershipId: string | null;
  overriddenAt: string | null;
  gateState: PlatformAdmissionsGateState;
  normalHandoffAllowed: boolean;
  exceptionalHandoffAllowed: boolean;
  canConfirmContract: boolean;
  canConfirmFirstPayment: boolean;
  canOverrideGate: boolean;
  gateVersion: number;
  updatedAt: string;
}>;

export type PlatformAdmissionsGateMutationInput = Readonly<{
  leadId: string;
  expectedGateVersion: number;
  requestId: string;
  action: PlatformAdmissionsGateAction;
  amount: number | null;
  currency: string | null;
  dueDate: string | null;
  receivedDate: string | null;
  evidenceReference: string | null;
  reason: string | null;
}>;

export type PlatformAdmissionsGateMutationReceipt = PlatformAdmissionsGate &
  Readonly<{
    requestId: string;
    changedAt: string;
  }>;
