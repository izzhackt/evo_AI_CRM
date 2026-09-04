"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformSalesActor } from "./platform-guards";
import {
  handoffPlatformLeadToAdmissions,
  mutatePlatformLeadAdmissionsGate,
  parsePlatformStudentHandoffUuid,
  PlatformStudentHandoffRepositoryError,
  type PlatformLeadAdmissionsGateAction,
  type PlatformLeadAdmissionsGateMutationInput,
  type PlatformLeadAdmissionsHandoffInput,
  type PlatformStudentHandoffMode,
} from "./platform-student-handoff";
import { exactActionStringFields } from "./server/action-form-fields";

const REQUEST_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const GATE_FORM_FIELDS = [
  "lead_id",
  "expected_gate_version",
  "request_id",
  "action",
  "amount",
  "currency",
  "due_date",
  "received_date",
  "evidence_reference",
  "reason",
] as const;
const HANDOFF_FORM_FIELDS = [
  "lead_id",
  "expected_gate_version",
  "request_id",
  "admissions_owner_membership_id",
  "handoff_mode",
  "reason",
] as const;

export type PlatformStudentHandoffActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "gate_blocked"
  | "stale"
  | "request_conflict"
  | "unavailable";

export type PlatformLeadAdmissionsGateActionState = Readonly<{
  status: PlatformStudentHandoffActionStatus;
  requestId: string;
  leadId: string | null;
  gateVersion: string | null;
  changedAt: string | null;
}>;

export type PlatformLeadAdmissionsHandoffActionState = Readonly<{
  status: PlatformStudentHandoffActionStatus;
  requestId: string;
  leadId: string | null;
  gateVersion: string | null;
  studentCaseId: string | null;
  changedAt: string | null;
}>;

type StringFields = ReadonlyMap<string, string>;

function field(fields: StringFields, key: string): string {
  return fields.get(key)?.trim() ?? "";
}

function version(value: string): string | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  if (
    value.length > POSTGRES_BIGINT_MAX.length ||
    (value.length === POSTGRES_BIGINT_MAX.length &&
      value > POSTGRES_BIGINT_MAX)
  ) {
    return null;
  }
  return value;
}

function requestId(value: string): string | null {
  return REQUEST_UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function date(value: string): string | null {
  if (!DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function optionalDate(value: string): string | null | undefined {
  return value.length === 0 ? null : date(value) ?? undefined;
}

function optionalText(
  value: string,
  maximumLength: number,
): string | null | undefined {
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function amount(value: string): number | null | undefined {
  if (value.length === 0) return null;
  if (
    !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value) ||
    Number(value) <= 0 ||
    Number(value) > 999999999999.99
  ) {
    return undefined;
  }
  return Number(value);
}

function gateAction(value: string): PlatformLeadAdmissionsGateAction | null {
  return value === "confirm_contract" ||
      value === "confirm_first_payment" ||
      value === "override_gate"
    ? value
    : null;
}

function studentHandoffMode(value: string): PlatformStudentHandoffMode | null {
  return value === "normal" || value === "exceptional_override"
    ? value
    : null;
}

function parseGateInput(
  form: FormData,
): PlatformLeadAdmissionsGateMutationInput | null {
  const fields = exactActionStringFields(form, GATE_FORM_FIELDS);
  if (!fields) return null;
  const leadId = parsePlatformStudentHandoffUuid(field(fields, "lead_id"));
  const expectedGateVersion = version(field(fields, "expected_gate_version"));
  const parsedRequestId = requestId(field(fields, "request_id"));
  const action = gateAction(field(fields, "action"));
  const parsedAmount = amount(field(fields, "amount"));
  const rawCurrency = field(fields, "currency");
  const currency = rawCurrency.length === 0
    ? null
    : /^[A-Za-z]{3}$/.test(rawCurrency)
      ? rawCurrency.toUpperCase()
      : undefined;
  const dueDate = optionalDate(field(fields, "due_date"));
  const receivedDate = optionalDate(field(fields, "received_date"));
  const evidenceReference = optionalText(
    field(fields, "evidence_reference"),
    2048,
  );
  const reason = optionalText(field(fields, "reason"), 1000);
  if (
    !leadId ||
    !expectedGateVersion ||
    !parsedRequestId ||
    !action ||
    parsedAmount === undefined ||
    currency === undefined ||
    dueDate === undefined ||
    receivedDate === undefined ||
    evidenceReference === undefined ||
    reason === undefined ||
    (action === "confirm_contract" &&
      (parsedAmount === null ||
        currency === null ||
        dueDate === null ||
        receivedDate !== null ||
        evidenceReference === null)) ||
    (action === "confirm_first_payment" &&
      (parsedAmount !== null ||
        currency !== null ||
        dueDate !== null ||
        receivedDate === null ||
        evidenceReference === null)) ||
    (action === "override_gate" &&
      (parsedAmount !== null ||
        currency !== null ||
        dueDate !== null ||
        receivedDate !== null ||
        evidenceReference !== null ||
        reason === null))
  ) {
    return null;
  }
  return Object.freeze({
    leadId,
    expectedGateVersion,
    requestId: parsedRequestId,
    action,
    amount: parsedAmount,
    currency,
    dueDate,
    receivedDate,
    evidenceReference,
    reason,
  });
}

function parseHandoffInput(
  form: FormData,
): PlatformLeadAdmissionsHandoffInput | null {
  const fields = exactActionStringFields(form, HANDOFF_FORM_FIELDS);
  if (!fields) return null;
  const leadId = parsePlatformStudentHandoffUuid(field(fields, "lead_id"));
  const expectedGateVersion = version(field(fields, "expected_gate_version"));
  const parsedRequestId = requestId(field(fields, "request_id"));
  const admissionsOwnerMembershipId = parsePlatformStudentHandoffUuid(
    field(fields, "admissions_owner_membership_id"),
  );
  const handoffMode = studentHandoffMode(field(fields, "handoff_mode"));
  const reason = optionalText(field(fields, "reason"), 1000);
  if (
    !leadId ||
    !expectedGateVersion ||
    !parsedRequestId ||
    !admissionsOwnerMembershipId ||
    !handoffMode ||
    !reason
  ) {
    return null;
  }
  return Object.freeze({
    leadId,
    expectedGateVersion,
    requestId: parsedRequestId,
    admissionsOwnerMembershipId,
    handoffMode,
    reason,
  });
}

function submittedRequestId(form: FormData): string | null {
  for (const key of ["request_id", "_1_request_id"]) {
    const values = form.getAll(key);
    if (values.length === 1 && typeof values[0] === "string") {
      const parsed = requestId(values[0].trim());
      if (parsed) return parsed;
    }
  }
  return null;
}

function submittedLeadId(form: FormData): string | null {
  for (const key of ["lead_id", "_1_lead_id"]) {
    const values = form.getAll(key);
    if (values.length === 1 && typeof values[0] === "string") {
      const parsed = parsePlatformStudentHandoffUuid(values[0].trim());
      if (parsed) return parsed;
    }
  }
  return null;
}

function nextRequestId(
  status: PlatformStudentHandoffActionStatus,
  verifiedRequestId: string | null,
): string {
  return status === "request_conflict"
    ? randomUUID()
    : verifiedRequestId ?? randomUUID();
}

function gateFailureState(
  form: FormData,
  status: Exclude<PlatformStudentHandoffActionStatus, "idle" | "saved">,
  verified?: PlatformLeadAdmissionsGateMutationInput,
): PlatformLeadAdmissionsGateActionState {
  return Object.freeze({
    status,
    requestId: nextRequestId(
      status,
      verified?.requestId ?? submittedRequestId(form),
    ),
    leadId: verified?.leadId ?? submittedLeadId(form),
    gateVersion: null,
    changedAt: null,
  });
}

function handoffFailureState(
  form: FormData,
  status: Exclude<PlatformStudentHandoffActionStatus, "idle" | "saved">,
  verified?: PlatformLeadAdmissionsHandoffInput,
): PlatformLeadAdmissionsHandoffActionState {
  return Object.freeze({
    status,
    requestId: nextRequestId(
      status,
      verified?.requestId ?? submittedRequestId(form),
    ),
    leadId: verified?.leadId ?? submittedLeadId(form),
    gateVersion: null,
    studentCaseId: null,
    changedAt: null,
  });
}

export async function createInitialPlatformLeadAdmissionsGateActionState(): Promise<PlatformLeadAdmissionsGateActionState> {
  return Object.freeze({
    status: "idle" as const,
    requestId: randomUUID(),
    leadId: null,
    gateVersion: null,
    changedAt: null,
  });
}

export async function createInitialPlatformLeadAdmissionsHandoffActionState(): Promise<PlatformLeadAdmissionsHandoffActionState> {
  return Object.freeze({
    status: "idle" as const,
    requestId: randomUUID(),
    leadId: null,
    gateVersion: null,
    studentCaseId: null,
    changedAt: null,
  });
}

export async function mutatePlatformLeadAdmissionsGateAction(
  _previous: PlatformLeadAdmissionsGateActionState,
  form: FormData,
): Promise<PlatformLeadAdmissionsGateActionState> {
  const actor = await requirePlatformSalesActor();
  const input = parseGateInput(form);
  if (!input) return gateFailureState(form, "invalid");

  try {
    const receipt = await mutatePlatformLeadAdmissionsGate(actor, input);
    revalidatePath("/v3/pipeline");
    revalidatePath(`/v3/profile?id=${receipt.leadId}`);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      leadId: receipt.leadId,
      gateVersion: receipt.gateVersion,
      changedAt: receipt.changedAt,
    });
  } catch (error) {
    if (error instanceof PlatformStudentHandoffRepositoryError) {
      return gateFailureState(form, error.reason, input);
    }
    return gateFailureState(form, "unavailable", input);
  }
}

export async function handoffPlatformLeadToAdmissionsAction(
  _previous: PlatformLeadAdmissionsHandoffActionState,
  form: FormData,
): Promise<PlatformLeadAdmissionsHandoffActionState> {
  const actor = await requirePlatformSalesActor();
  const input = parseHandoffInput(form);
  if (!input) return handoffFailureState(form, "invalid");

  try {
    const receipt = await handoffPlatformLeadToAdmissions(actor, input);
    revalidatePath("/v3/pipeline");
    revalidatePath(`/v3/profile?id=${receipt.leadId}`);
    if (receipt.caseId) {
      revalidatePath(`/v3/profile?case=${receipt.caseId}`);
    }
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      leadId: receipt.leadId,
      gateVersion: receipt.gateVersion,
      studentCaseId: receipt.caseId,
      changedAt: receipt.changedAt,
    });
  } catch (error) {
    if (error instanceof PlatformStudentHandoffRepositoryError) {
      return handoffFailureState(form, error.reason, input);
    }
    return handoffFailureState(form, "unavailable", input);
  }
}
