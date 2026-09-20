// Client-safe parsing/formatting for the «Договор и оплата» block
// (189_platform_case_agreement). Deliberately mirrors the shape/style of
// platform-finance-entry-contract.ts (same feature area, same
// useActionState + requestId + frozen-retry pattern is reused by the forms
// in CaseAgreementForms.tsx) rather than duplicating a second normalization
// style.
import { parseSalesDate, parseSalesUuid } from "./platform-sales-register-contract.ts";
export {
  decimalToMinor,
  financeDateTime,
  financeMoney,
} from "./platform-finance-entry-contract.ts";

export type CaseAgreementStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "request_conflict"
  | "unavailable"
  // FIX 7 (adversarial review): save_case_tranche_v1 raises
  // 'case_agreement_tranche_paid' (22023) when an edit would change the
  // amount/currency of an already-paid tranche — previously mapped to the
  // generic "invalid", indistinguishable from an ordinary validation error.
  | "tranche_paid";
export type CaseAgreementState = Readonly<{
  status: CaseAgreementStatus;
  requestId: string;
  resourceId: string | null;
}>;

export type CaseAgreementContractFile = Readonly<{
  id: string;
  originalFilename: string;
  uploadedAt: string;
  uploadedByDisplayName: string | null;
}>;

export type CaseAgreementTranche = Readonly<{
  id: string;
  label: string;
  amountMinor: string;
  currency: string;
  dueOn: string | null;
  totalPaidMinor: string;
  outstandingMinor: string;
}>;

export type CaseAgreementReceipt = Readonly<{
  id: string;
  originalFilename: string;
  uploadedAt: string;
}>;

export type CaseAgreementPaymentEventType = "payment" | "refund";

export type CaseAgreementPayment = Readonly<{
  id: string;
  obligationId: string;
  amountMinor: string;
  currency: string;
  occurredOn: string;
  actorDisplayName: string | null;
  // FIX 4 (adversarial review): staff_case_agreement_v1 now projects
  // payment_events.event_type — a refund (043's admin ledger tool) was
  // previously indistinguishable from a payment in this list.
  eventType: CaseAgreementPaymentEventType;
  receipts: readonly CaseAgreementReceipt[];
}>;

export type CaseAgreement = Readonly<{
  organizationId: string;
  studentCaseId: string;
  costMinor: string | null;
  costCurrency: string | null;
  contractCurrent: CaseAgreementContractFile | null;
  contractHistory: readonly CaseAgreementContractFile[];
  tranches: readonly CaseAgreementTranche[];
  trancheSumMinor: string;
  costMismatch: boolean;
  payments: readonly CaseAgreementPayment[];
  paidMinor: string;
  remainingMinor: string | null;
  currencyMismatch: boolean;
  canWrite: boolean;
}>;

function fail(): never {
  throw new Error("Case agreement is unavailable.");
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
}
function text(value: unknown, max = 1000): string {
  return typeof value === "string" && value.length <= max ? value : fail();
}
function optionalTextField(value: unknown, max = 1000): string | null {
  return value === null ? null : text(value, max);
}
function id(value: unknown): string {
  return parseSalesUuid(value) ?? fail();
}
function bool(value: unknown): boolean {
  return typeof value === "boolean" ? value : fail();
}
function integer(value: unknown): string {
  const result = text(value, 40);
  return /^\d+$/.test(result) ? result : fail();
}
function optionalInteger(value: unknown): string | null {
  return value === null ? null : integer(value);
}
// remaining_minor = cost_minor − paid_minor can legitimately go negative
// (cost edited down after tranches were already fully paid — an overpayment
// signal, not an error), so it needs its own signed variant.
function optionalSignedInteger(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value, 40);
  return /^-?\d+$/.test(result) ? result : fail();
}
function currencyField(value: unknown): string {
  const result = text(value, 3);
  return /^[A-Z]{3}$/.test(result) ? result : fail();
}
function optionalCurrencyField(value: unknown): string | null {
  return value === null ? null : currencyField(value);
}
function timeField(value: unknown): string {
  const result = text(value, 40);
  return Number.isFinite(Date.parse(result)) ? result : fail();
}
function dateField(value: unknown): string {
  const result = text(value, 10);
  return parseSalesDate(result) ? result : fail();
}
function optionalDateField(value: unknown): string | null {
  return value === null ? null : dateField(value);
}
function list(value: unknown, max: number): unknown[] {
  return Array.isArray(value) && value.length <= max ? value : fail();
}
function paymentEventType(value: unknown): CaseAgreementPaymentEventType {
  return value === "payment" || value === "refund" ? value : fail();
}

function parseContractFile(value: unknown): CaseAgreementContractFile {
  const r = record(value);
  return {
    id: id(r.case_contract_file_id),
    originalFilename: text(r.original_filename, 512),
    uploadedAt: timeField(r.uploaded_at),
    uploadedByDisplayName: optionalTextField(r.uploaded_by_display_name, 200),
  };
}

export function parseCaseAgreement(
  value: unknown,
  organizationId: string,
  studentCaseId: string,
): CaseAgreement {
  const r = record(value);
  if (
    r.organization_id !== organizationId ||
    r.student_case_id !== studentCaseId
  ) {
    fail();
  }

  const tranches = list(r.tranches, 500).map((raw) => {
    const t = record(raw);
    return {
      id: id(t.payment_obligation_id),
      label: text(t.label, 500),
      amountMinor: integer(t.amount_minor),
      currency: currencyField(t.currency),
      dueOn: optionalDateField(t.due_on),
      totalPaidMinor: integer(t.total_paid_minor),
      outstandingMinor: integer(t.outstanding_minor),
    };
  });
  const trancheIds = new Set(tranches.map((t) => t.id));
  if (trancheIds.size !== tranches.length) fail();

  const payments = list(r.payments, 1000).map((raw) => {
    const p = record(raw);
    const obligationId = id(p.payment_obligation_id);
    const receipts = list(p.receipts, 50).map((rawReceipt) => {
      const rec = record(rawReceipt);
      return {
        id: id(rec.payment_receipt_file_id),
        originalFilename: text(rec.original_filename, 512),
        uploadedAt: timeField(rec.uploaded_at),
      };
    });
    return {
      id: id(p.payment_event_id),
      obligationId,
      amountMinor: integer(p.amount_minor),
      currency: currencyField(p.currency),
      occurredOn: dateField(p.occurred_on),
      actorDisplayName: optionalTextField(p.actor_display_name, 200),
      eventType: paymentEventType(p.event_type),
      receipts,
    };
  });
  if (new Set(payments.map((p) => p.id)).size !== payments.length) fail();

  return {
    organizationId,
    studentCaseId,
    costMinor: optionalInteger(r.cost_minor),
    costCurrency: optionalCurrencyField(r.cost_currency),
    contractCurrent: r.contract_current === null
      ? null
      : parseContractFile(r.contract_current),
    contractHistory: list(r.contract_history, 200).map(parseContractFile),
    tranches,
    trancheSumMinor: integer(r.tranche_sum_minor),
    costMismatch: bool(r.cost_mismatch),
    payments,
    paidMinor: integer(r.paid_minor),
    remainingMinor: optionalSignedInteger(r.remaining_minor),
    currencyMismatch: bool(r.currency_mismatch),
    canWrite: bool(r.can_write),
  };
}
