import type { PlatformActor } from "./platform-auth";
import {
  PLATFORM_ADMISSIONS_GATE_ACTIONS,
  PLATFORM_ADMISSIONS_GATE_STATES,
  type PlatformAdmissionsGate,
  type PlatformAdmissionsGateMutationInput,
  type PlatformAdmissionsGateMutationReceipt,
  type PlatformAdmissionsGateState,
} from "./platform-admissions-gate-contract.ts";

export {
  PLATFORM_ADMISSIONS_GATE_ACTIONS,
  PLATFORM_ADMISSIONS_GATE_STATES,
} from "./platform-admissions-gate-contract.ts";
export type {
  PlatformAdmissionsGate,
  PlatformAdmissionsGateAction,
  PlatformAdmissionsGateMutationInput,
  PlatformAdmissionsGateMutationReceipt,
  PlatformAdmissionsGateState,
} from "./platform-admissions-gate-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_AMOUNT = 999_999_999_999.99;
const MAX_EVIDENCE_REFERENCE_LENGTH = 2_048;
const MAX_OVERRIDE_REASON_LENGTH = 1_000;

export type PlatformAdmissionsGateFailureKind =
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "unavailable";

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  schema: (schema: "platform") => Readonly<{
    rpc: (
      functionName: string,
      args?: Readonly<Record<string, unknown>>,
      options?: Readonly<{ get?: boolean }>,
    ) => PromiseLike<RpcResponse>;
  }>;
}>;

export type PlatformAdmissionsGateDependencies = Readonly<{
  client?: RpcClient;
}>;

export class PlatformAdmissionsGateRepositoryError extends Error {
  readonly kind: PlatformAdmissionsGateFailureKind;

  constructor(kind: PlatformAdmissionsGateFailureKind = "unavailable") {
    super("Platform Admissions gate is unavailable.");
    this.name = "PlatformAdmissionsGateRepositoryError";
    this.kind = kind;
  }
}

function invalid(kind: PlatformAdmissionsGateFailureKind = "invalid"): never {
  throw new PlatformAdmissionsGateRepositoryError(kind);
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformAdmissionsGateRepositoryError) throw error;
  throw new PlatformAdmissionsGateRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlatformAdmissionsGateUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function parseOptionalUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parsePlatformAdmissionsGateUuid(value) ?? undefined;
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = TIMESTAMPTZ_PATTERN.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const daysInMonth =
    year >= 1 && month >= 1 && month <= 12
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : 0;
  if (
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    !Number.isFinite(Date.parse(value))
  ) {
    return null;
  }
  return value;
}

function parseOptionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parseTimestamp(value) ?? undefined;
}

export function parsePlatformAdmissionsGateDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function parseOptionalDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parsePlatformAdmissionsGateDate(value) ?? undefined;
}

export function parsePlatformAdmissionsGateAmount(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_AMOUNT
  ) {
    return null;
  }
  const cents = value * 100;
  return Number.isSafeInteger(Math.round(cents)) &&
    Math.abs(cents - Math.round(cents)) < 1e-7
    ? value
    : null;
}

function parseOptionalAmount(value: unknown): number | null | undefined {
  if (value === null) return null;
  return parsePlatformAdmissionsGateAmount(value) ?? undefined;
}

export function parsePlatformAdmissionsGateCurrency(value: unknown): string | null {
  return typeof value === "string" && CURRENCY_PATTERN.test(value)
    ? value
    : null;
}

function parseOptionalCurrency(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parsePlatformAdmissionsGateCurrency(value) ?? undefined;
}

function parseOptionalText(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
}

function parseState(value: unknown): PlatformAdmissionsGateState | null {
  return PLATFORM_ADMISSIONS_GATE_STATES.find((state) => state === value) ?? null;
}

function hasValidActionPayload(
  action: unknown,
  amount: number | null,
  currency: string | null,
  dueDate: string | null,
  receivedDate: string | null,
  evidenceReference: string | null,
  reason: string | null,
): boolean {
  if (action === "confirm_contract") {
    return (
      amount !== null &&
      currency !== null &&
      dueDate !== null &&
      receivedDate === null &&
      evidenceReference !== null &&
      reason === null
    );
  }
  if (action === "confirm_first_payment") {
    return (
      amount === null &&
      currency === null &&
      dueDate === null &&
      receivedDate !== null &&
      evidenceReference !== null &&
      reason === null
    );
  }
  if (action === "override_gate") {
    return (
      amount === null &&
      currency === null &&
      dueDate === null &&
      receivedDate === null &&
      evidenceReference === null &&
      reason !== null
    );
  }
  return false;
}

function single(form: FormData, key: string): FormDataEntryValue | undefined {
  const values = form.getAll(key);
  return values.length === 1 ? values[0] : undefined;
}

function formText(
  form: FormData,
  key: string,
  maxLength: number,
): string | null | undefined {
  const candidate = single(form, key);
  if (typeof candidate !== "string") return undefined;
  const normalized = candidate.trim();
  if (normalized.length === 0) return null;
  return normalized.length <= maxLength ? normalized : undefined;
}

export function parsePlatformAdmissionsGateFormData(
  form: FormData,
): PlatformAdmissionsGateMutationInput | null {
  const leadId = parsePlatformAdmissionsGateUuid(single(form, "lead_id"));
  const requestId = parsePlatformAdmissionsGateUuid(single(form, "request_id"));
  const versionInput = single(form, "expected_gate_version");
  const expectedGateVersion =
    typeof versionInput === "string" && /^[1-9]\d*$/.test(versionInput)
      ? Number(versionInput)
      : Number.NaN;
  const actionInput = single(form, "action");
  const action = PLATFORM_ADMISSIONS_GATE_ACTIONS.find(
    (candidate) => candidate === actionInput,
  );
  const amountInput = formText(form, "amount", 15);
  const amount =
    amountInput === null
      ? null
      : typeof amountInput === "string" &&
          /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amountInput)
        ? parsePlatformAdmissionsGateAmount(Number(amountInput))
        : undefined;
  const currencyInput = formText(form, "currency", 3);
  const currency =
    currencyInput === null
      ? null
      : parsePlatformAdmissionsGateCurrency(currencyInput) ?? undefined;
  const dueInput = formText(form, "due_date", 10);
  const dueDate =
    dueInput === null
      ? null
      : parsePlatformAdmissionsGateDate(dueInput) ?? undefined;
  const receivedInput = formText(form, "received_date", 10);
  const receivedDate =
    receivedInput === null
      ? null
      : parsePlatformAdmissionsGateDate(receivedInput) ?? undefined;
  const evidenceReference = formText(
    form,
    "evidence_reference",
    MAX_EVIDENCE_REFERENCE_LENGTH,
  );
  const reason = formText(form, "reason", MAX_OVERRIDE_REASON_LENGTH);

  if (
    leadId === null ||
    requestId === null ||
    !Number.isSafeInteger(expectedGateVersion) ||
    expectedGateVersion < 1 ||
    action === undefined ||
    amount === undefined ||
    currency === undefined ||
    dueDate === undefined ||
    receivedDate === undefined ||
    evidenceReference === undefined ||
    reason === undefined ||
    !hasValidActionPayload(
      action,
      amount,
      currency,
      dueDate,
      receivedDate,
      evidenceReference,
      reason,
    )
  ) {
    return null;
  }

  return Object.freeze({
    leadId,
    expectedGateVersion,
    requestId,
    action,
    amount,
    currency,
    dueDate,
    receivedDate,
    evidenceReference,
    reason,
  });
}

function requireActor(actor: PlatformActor): Readonly<{
  organizationId: string;
  membershipId: string;
  role: "admin" | "sales";
}> {
  const organizationId = parsePlatformAdmissionsGateUuid(actor.organizationId);
  const membershipId = parsePlatformAdmissionsGateUuid(actor.membershipId);
  if (
    organizationId === null ||
    membershipId === null ||
    (actor.platformRole !== "admin" && actor.platformRole !== "sales")
  ) {
    return invalid("forbidden");
  }
  return Object.freeze({
    organizationId,
    membershipId,
    role: actor.platformRole,
  });
}

async function getClient(injected?: RpcClient): Promise<RpcClient> {
  if (injected) return injected;
  if (typeof window !== "undefined") return invalid();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient() as unknown as RpcClient;
}

export function normalizePlatformAdmissionsGate(
  value: unknown,
): PlatformAdmissionsGate {
  if (!isRecord(value)) return invalid();

  const organizationId = parsePlatformAdmissionsGateUuid(value.organization_id);
  const leadId = parsePlatformAdmissionsGateUuid(value.lead_id);
  const contractActor = parseOptionalUuid(
    value.contract_confirmed_by_membership_id,
  );
  const contractAt = parseOptionalTimestamp(value.contract_confirmed_at);
  const contractEvidence = parseOptionalText(
    value.contract_evidence_reference,
    MAX_EVIDENCE_REFERENCE_LENGTH,
  );
  const amount = parseOptionalAmount(value.first_payment_amount);
  const currency = parseOptionalCurrency(value.first_payment_currency);
  const dueDate = parseOptionalDate(value.first_payment_due_date);
  const receivedDate = parseOptionalDate(value.first_payment_received_date);
  const paymentActor = parseOptionalUuid(
    value.first_payment_confirmed_by_membership_id,
  );
  const paymentAt = parseOptionalTimestamp(value.first_payment_confirmed_at);
  const paymentEvidence = parseOptionalText(
    value.first_payment_evidence_reference,
    MAX_EVIDENCE_REFERENCE_LENGTH,
  );
  const overrideReason = parseOptionalText(
    value.override_reason,
    MAX_OVERRIDE_REASON_LENGTH,
  );
  const overrideActor = parseOptionalUuid(value.overridden_by_membership_id);
  const overriddenAt = parseOptionalTimestamp(value.overridden_at);
  const gateState = parseState(value.gate_state);
  const gateVersion = parsePositiveInteger(value.gate_version);
  const updatedAt = parseTimestamp(value.updated_at);

  const contractFacts = [contractActor, contractAt, contractEvidence];
  const expectationFacts = [amount, currency, dueDate];
  const paymentFacts = [receivedDate, paymentActor, paymentAt, paymentEvidence];
  const overrideFacts = [overrideReason, overrideActor, overriddenAt];
  const allNull = (facts: readonly unknown[]) => facts.every((fact) => fact === null);
  const allPresent = (facts: readonly unknown[]) =>
    facts.every((fact) => fact !== null && fact !== undefined);
  const firstPaymentConfirmed = allPresent(paymentFacts);
  const overrideExists = allPresent(overrideFacts);
  const expectedState =
    value.contract_confirmed === true && firstPaymentConfirmed
      ? "satisfied"
      : overrideExists
        ? "overridden"
        : "blocked";

  if (
    organizationId === null ||
    leadId === null ||
    typeof value.contract_confirmed !== "boolean" ||
    contractActor === undefined ||
    contractAt === undefined ||
    contractEvidence === undefined ||
    amount === undefined ||
    currency === undefined ||
    dueDate === undefined ||
    receivedDate === undefined ||
    paymentActor === undefined ||
    paymentAt === undefined ||
    paymentEvidence === undefined ||
    overrideReason === undefined ||
    overrideActor === undefined ||
    overriddenAt === undefined ||
    gateState === null ||
    gateVersion === null ||
    updatedAt === null ||
    typeof value.normal_handoff_allowed !== "boolean" ||
    typeof value.exceptional_handoff_allowed !== "boolean" ||
    typeof value.can_confirm_contract !== "boolean" ||
    typeof value.can_confirm_first_payment !== "boolean" ||
    typeof value.can_override_gate !== "boolean" ||
    (value.contract_confirmed
      ? !allPresent(contractFacts) || !allPresent(expectationFacts)
      : !allNull(contractFacts) || !allNull(expectationFacts)) ||
    (!allNull(paymentFacts) && !firstPaymentConfirmed) ||
    (firstPaymentConfirmed && value.contract_confirmed !== true) ||
    (!allNull(overrideFacts) && !overrideExists) ||
    gateState !== expectedState ||
    value.normal_handoff_allowed !== (gateState === "satisfied") ||
    value.exceptional_handoff_allowed !== (gateState === "overridden") ||
    (value.can_confirm_contract && value.contract_confirmed) ||
    (value.can_confirm_first_payment &&
      (!value.contract_confirmed || firstPaymentConfirmed)) ||
    (value.can_override_gate && gateState !== "blocked")
  ) {
    return invalid();
  }

  return Object.freeze({
    organizationId,
    leadId,
    contractConfirmed: value.contract_confirmed,
    contractConfirmedByMembershipId: contractActor,
    contractConfirmedAt: contractAt,
    contractEvidenceReference: contractEvidence,
    firstPaymentAmount: amount,
    firstPaymentCurrency: currency,
    firstPaymentDueDate: dueDate,
    firstPaymentReceivedDate: receivedDate,
    firstPaymentConfirmed,
    firstPaymentConfirmedByMembershipId: paymentActor,
    firstPaymentConfirmedAt: paymentAt,
    firstPaymentEvidenceReference: paymentEvidence,
    overrideReason,
    overriddenByMembershipId: overrideActor,
    overriddenAt,
    gateState,
    normalHandoffAllowed: value.normal_handoff_allowed,
    exceptionalHandoffAllowed: value.exceptional_handoff_allowed,
    canConfirmContract: value.can_confirm_contract,
    canConfirmFirstPayment: value.can_confirm_first_payment,
    canOverrideGate: value.can_override_gate,
    gateVersion,
    updatedAt,
  });
}

export async function getPlatformAdmissionsGate(
  actor: PlatformActor,
  leadIdInput: string,
  dependencies: PlatformAdmissionsGateDependencies = {},
): Promise<PlatformAdmissionsGate | null> {
  try {
    const authority = requireActor(actor);
    const leadId = parsePlatformAdmissionsGateUuid(leadIdInput);
    if (leadId === null) return null;
    const client = await getClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "staff_lead_admissions_gate",
      { p_lead_id: leadId },
      { get: true },
    );
    if (
      response.error ||
      !Array.isArray(response.data) ||
      response.data.length > 1
    ) {
      return invalid("unavailable");
    }
    if (response.data.length === 0) return null;
    const gate = normalizePlatformAdmissionsGate(response.data[0]);
    if (
      gate.organizationId !== authority.organizationId ||
      gate.leadId !== leadId
    ) {
      return invalid();
    }
    return gate;
  } catch (error) {
    return failClosed(error);
  }
}

function rpcFailure(error: unknown): PlatformAdmissionsGateRepositoryError {
  if (!isRecord(error)) return new PlatformAdmissionsGateRepositoryError();
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  if (message.includes("admissions_gate_request_id_conflict")) {
    return new PlatformAdmissionsGateRepositoryError("request_conflict");
  }
  if (
    message.includes("admissions_gate_version_conflict") ||
    message.includes("admissions_gate_contract_required") ||
    message.includes("admissions_gate_contract_locked") ||
    message.includes("admissions_gate_contract_already_confirmed") ||
    message.includes("admissions_gate_first_payment_already_confirmed") ||
    message.includes("admissions_gate_already_satisfied") ||
    code === "PT409"
  ) {
    return new PlatformAdmissionsGateRepositoryError("stale");
  }
  if (
    message.includes("admissions_gate_not_found_or_forbidden") ||
    message.includes("admissions_gate_contract_confirmation_forbidden") ||
    message.includes("admissions_gate_payment_confirmation_forbidden") ||
    message.includes("admissions_gate_override_forbidden") ||
    code === "42501"
  ) {
    return new PlatformAdmissionsGateRepositoryError("forbidden");
  }
  if (
    message.includes("admissions_gate_invalid_") ||
    message.includes("admissions_gate_override_reason_required") ||
    code === "22023" ||
    code === "23514"
  ) {
    return new PlatformAdmissionsGateRepositoryError("invalid");
  }
  return new PlatformAdmissionsGateRepositoryError();
}

function normalizeMutationReceipt(
  value: unknown,
): PlatformAdmissionsGateMutationReceipt {
  if (!isRecord(value)) return invalid();
  const gate = normalizePlatformAdmissionsGate(value);
  const requestId = parsePlatformAdmissionsGateUuid(value.request_id);
  const changedAt = parseTimestamp(value.changed_at);
  if (requestId === null || changedAt === null) return invalid();
  return Object.freeze({ ...gate, requestId, changedAt });
}

export async function mutatePlatformAdmissionsGate(
  actor: PlatformActor,
  input: PlatformAdmissionsGateMutationInput,
  dependencies: PlatformAdmissionsGateDependencies = {},
): Promise<PlatformAdmissionsGateMutationReceipt> {
  try {
    const authority = requireActor(actor);
    const leadId = parsePlatformAdmissionsGateUuid(input.leadId);
    const requestId = parsePlatformAdmissionsGateUuid(input.requestId);
    const amount =
      input.amount === null
        ? null
        : parsePlatformAdmissionsGateAmount(input.amount) ?? undefined;
    const currency =
      input.currency === null
        ? null
        : parsePlatformAdmissionsGateCurrency(input.currency) ?? undefined;
    const dueDate =
      input.dueDate === null
        ? null
        : parsePlatformAdmissionsGateDate(input.dueDate) ?? undefined;
    const receivedDate =
      input.receivedDate === null
        ? null
        : parsePlatformAdmissionsGateDate(input.receivedDate) ?? undefined;
    const evidenceReference =
      input.evidenceReference === null
        ? null
        : parseOptionalText(
            input.evidenceReference,
            MAX_EVIDENCE_REFERENCE_LENGTH,
          );
    const reason =
      input.reason === null
        ? null
        : parseOptionalText(input.reason, MAX_OVERRIDE_REASON_LENGTH);
    if (
      leadId === null ||
      requestId === null ||
      !Number.isSafeInteger(input.expectedGateVersion) ||
      input.expectedGateVersion < 1 ||
      !PLATFORM_ADMISSIONS_GATE_ACTIONS.includes(input.action) ||
      amount === undefined ||
      currency === undefined ||
      dueDate === undefined ||
      receivedDate === undefined ||
      evidenceReference === undefined ||
      reason === undefined ||
      !hasValidActionPayload(
        input.action,
        amount,
        currency,
        dueDate,
        receivedDate,
        evidenceReference,
        reason,
      )
    ) {
      return invalid();
    }

    const client = await getClient(dependencies.client);
    const response = await client.schema("platform").rpc(
      "mutate_lead_admissions_gate",
      {
        p_lead_id: leadId,
        p_expected_gate_version: input.expectedGateVersion,
        p_request_id: requestId,
        p_action: input.action,
        p_amount: amount,
        p_currency: currency,
        p_due_date: dueDate,
        p_received_date: receivedDate,
        p_evidence_reference: evidenceReference,
        p_reason: reason,
      },
    );
    if (response.error) throw rpcFailure(response.error);
    const receipt = normalizeMutationReceipt(response.data);
    if (
      receipt.requestId !== requestId ||
      receipt.organizationId !== authority.organizationId ||
      receipt.leadId !== leadId
    ) {
      return invalid();
    }
    return receipt;
  } catch (error) {
    return failClosed(error);
  }
}
