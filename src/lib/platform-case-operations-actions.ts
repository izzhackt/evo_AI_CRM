"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { PLATFORM_VISA_STATUSES } from "./platform-case-operations-contract.ts";
import { fixedRoleCan } from "./fixed-role-policy";
import { requirePlatformStaffActor } from "./platform-guards";
import type { PlatformAdmissionsActionStatus } from "./platform-admissions-task-actions";
import { exactActionStringFields } from "./server/action-form-fields";
import { createSupabaseServerClient } from "./supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const PLATFORM_FINANCE_BLOCKED_ACTIONS = [
  "application_submission",
  "document_processing",
  "visa_submission",
  "case_progression",
] as const;
const VISA_FIELDS = [
  "student_case_id",
  "visa_case_id",
  "status",
  "evidence_reference",
  "note",
  "request_id",
  "expected_version",
] as const;
const CREATE_STOP_FIELDS = [
  "student_case_id",
  "payment_obligation_id",
  "blocked_action",
  "reason",
  "next_action",
  "evidence_ref",
  "request_id",
  "expected_version",
] as const;
const RESOLVE_STOP_FIELDS = [
  "student_case_id",
  "stop_factor_id",
  "reason",
  "evidence_ref",
  "request_id",
  "expected_version",
] as const;

export type PlatformCaseVisaActionState = Readonly<{
  status: PlatformAdmissionsActionStatus;
  requestId: string;
  visaCaseId: string | null;
  version: string | null;
}>;

export type PlatformFinanceStopFactorActionState = Readonly<{
  status: PlatformAdmissionsActionStatus;
  requestId: string;
  stopFactorId: string | null;
  version: string | null;
}>;

type OperationStringFields = ReadonlyMap<string, string>;

function uuid(value: string): string | null {
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function oneOf<const T extends readonly string[]>(
  value: string,
  allowed: T,
): T[number] | null {
  return allowed.includes(value) ? value as T[number] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function operationField(fields: OperationStringFields, key: string): string {
  return fields.get(key)?.trim() ?? "";
}

function operationText(
  fields: OperationStringFields,
  key: string,
  minimum: number,
  maximum: number,
): string | null {
  const candidate = operationField(fields, key);
  if (
    candidate.length < minimum ||
    candidate.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function optionalOperationText(
  fields: OperationStringFields,
  key: string,
  maximum: number,
): string | null | undefined {
  const candidate = operationField(fields, key);
  if (!candidate) return null;
  if (
    candidate.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

function operationVersion(value: string, allowZero: boolean): string | null {
  if (!/^\d+$/.test(value)) return null;
  const normalized = value.replace(/^0+(?=\d)/, "");
  if (
    (!allowZero && normalized === "0") ||
    normalized.length > POSTGRES_BIGINT_MAX.length ||
    (normalized.length === POSTGRES_BIGINT_MAX.length &&
      normalized > POSTGRES_BIGINT_MAX)
  ) {
    return null;
  }
  return normalized;
}

function submittedOperationRequestId(form: FormData): string | null {
  const direct = form.getAll("request_id");
  const enveloped = form.getAll("_1_request_id");
  const values = direct.length > 0 ? direct : enveloped;
  const candidate = values.length === 1 ? values[0] : null;
  return typeof candidate === "string" ? uuid(candidate.trim()) : null;
}

function operationErrorStatus(
  error: unknown,
  versionConflictMessage: string,
): Exclude<PlatformAdmissionsActionStatus, "idle" | "saved"> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string"
    ? error.message.trim()
    : "";
  if (code === "42501") return "forbidden";
  if (code === "PT409" && message === versionConflictMessage) return "stale";
  if ((code === "22023" || code === "23505") && /request_id/i.test(message)) {
    return "request_conflict";
  }
  if (code === "22023") return "invalid";
  return "unavailable";
}

function visaFailureState(
  form: FormData,
  status: Exclude<PlatformAdmissionsActionStatus, "idle" | "saved">,
  visaCaseId: string | null = null,
  verifiedRequestId?: string | null,
): PlatformCaseVisaActionState {
  const requestId = verifiedRequestId ?? submittedOperationRequestId(form);
  return Object.freeze({
    status,
    requestId: status === "stale" || status === "request_conflict"
      ? randomUUID()
      : (requestId ?? randomUUID()),
    visaCaseId,
    version: null,
  });
}

function stopFailureState(
  form: FormData,
  status: Exclude<PlatformAdmissionsActionStatus, "idle" | "saved">,
  stopFactorId: string | null = null,
  verifiedRequestId?: string | null,
): PlatformFinanceStopFactorActionState {
  const requestId = verifiedRequestId ?? submittedOperationRequestId(form);
  return Object.freeze({
    status,
    requestId: status === "stale" || status === "request_conflict"
      ? randomUUID()
      : (requestId ?? randomUUID()),
    stopFactorId,
    version: null,
  });
}

function revalidateCaseOperations(studentCaseId: string): void {
  void studentCaseId;
  revalidatePath("/v3/calendar");
  revalidatePath("/v3/profile");
}

export async function upsertPlatformCaseVisaAction(
  _previous: PlatformCaseVisaActionState,
  form: FormData,
): Promise<PlatformCaseVisaActionState> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "admissions.write")) {
    return visaFailureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, VISA_FIELDS);
  if (!fields) return visaFailureState(form, "invalid");

  const studentCaseId = uuid(operationField(fields, "student_case_id"));
  const visaCaseIdValue = operationField(fields, "visa_case_id");
  const visaCaseId = visaCaseIdValue ? uuid(visaCaseIdValue) : null;
  const status = oneOf(operationField(fields, "status"), PLATFORM_VISA_STATUSES);
  const evidenceReference = operationText(fields, "evidence_reference", 1, 2000);
  const note = optionalOperationText(fields, "note", 4000);
  const requestId = uuid(operationField(fields, "request_id"));
  const expectedVersion = operationVersion(
    operationField(fields, "expected_version"),
    visaCaseId === null,
  );

  if (
    !studentCaseId || (visaCaseIdValue !== "" && !visaCaseId) || !status ||
    !evidenceReference || note === undefined || !requestId || !expectedVersion ||
    (visaCaseId ? expectedVersion === "0" : expectedVersion !== "0")
  ) {
    return visaFailureState(form, "invalid", visaCaseId, requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = visaCaseId
      ? await client.schema("platform").rpc("change_visa_case", {
          p_organization_id: actor.organizationId,
          p_visa_case_id: visaCaseId,
          p_new_status: status,
          p_evidence_reference: evidenceReference,
          p_note: note,
          p_expected_version: expectedVersion,
          p_request_id: requestId,
        })
      : await client.schema("platform").rpc("create_visa_case", {
          p_organization_id: actor.organizationId,
          p_student_case_id: studentCaseId,
          p_status: status,
          p_evidence_reference: evidenceReference,
          p_note: note,
          p_expected_version: expectedVersion,
          p_request_id: requestId,
        });
    if (response.error) {
      return visaFailureState(
        form,
        operationErrorStatus(response.error, "admissions_version_conflict"),
        visaCaseId,
        requestId,
      );
    }
    const data = response.data;
    const nextVersion = isRecord(data) && typeof data.version === "string"
      ? operationVersion(data.version, false)
      : null;
    if (
      !isRecord(data) ||
      !hasExactKeys(data, [
        "organization_id", "visa_case_id", "student_case_id", "status",
        "evidence_reference", "note", "request_id", "expected_version",
        "version",
      ]) ||
      data.organization_id !== actor.organizationId ||
      data.student_case_id !== studentCaseId ||
      typeof data.visa_case_id !== "string" || !uuid(data.visa_case_id) ||
      (visaCaseId !== null && data.visa_case_id !== visaCaseId) ||
      data.status !== status || data.evidence_reference !== evidenceReference ||
      data.note !== note || data.request_id !== requestId ||
      data.expected_version !== expectedVersion || !nextVersion ||
      BigInt(nextVersion) !== BigInt(expectedVersion) + BigInt(1)
    ) {
      return visaFailureState(form, "unavailable", visaCaseId, requestId);
    }
    revalidateCaseOperations(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      visaCaseId: data.visa_case_id,
      version: nextVersion,
    });
  } catch {
    return visaFailureState(form, "unavailable", visaCaseId, requestId);
  }
}

export async function createPlatformFinanceStopFactorAction(
  _previous: PlatformFinanceStopFactorActionState,
  form: FormData,
): Promise<PlatformFinanceStopFactorActionState> {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "admissions.write")) {
    return stopFailureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, CREATE_STOP_FIELDS);
  if (!fields) return stopFailureState(form, "invalid");

  const studentCaseId = uuid(operationField(fields, "student_case_id"));
  const paymentObligationId = uuid(operationField(fields, "payment_obligation_id"));
  const blockedAction = oneOf(
    operationField(fields, "blocked_action"),
    PLATFORM_FINANCE_BLOCKED_ACTIONS,
  );
  const reason = operationText(fields, "reason", 3, 1000);
  const nextAction = operationText(fields, "next_action", 3, 1000);
  const evidenceRef = operationText(fields, "evidence_ref", 1, 512);
  const requestId = uuid(operationField(fields, "request_id"));
  const expectedVersion = operationVersion(
    operationField(fields, "expected_version"),
    true,
  );

  if (
    !studentCaseId || !paymentObligationId || !blockedAction || !reason ||
    !nextAction || !evidenceRef || !requestId || expectedVersion !== "0"
  ) {
    return stopFailureState(form, "invalid", null, requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "assert_case_finance_stop_factor",
      {
        p_student_case_id: studentCaseId,
        p_payment_obligation_id: paymentObligationId,
        p_reason: reason,
        p_blocked_action: blockedAction,
        p_next_action: nextAction,
        p_evidence_ref: evidenceRef,
        p_expected_version: expectedVersion,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return stopFailureState(
        form,
        operationErrorStatus(response.error, "admissions_version_conflict"),
        null,
        requestId,
      );
    }
    const data = response.data;
    const stopFactorId = uuid(String(isRecord(data) ? data.stop_factor_id ?? "" : ""));
    const nextVersion = isRecord(data) && typeof data.version === "string"
      ? operationVersion(data.version, false)
      : null;
    if (
      !isRecord(data) || !hasExactKeys(data, [
        "organization_id",
        "stop_factor_id",
        "student_case_id",
        "payment_obligation_id",
        "owner_membership_id",
        "reason",
        "blocked_action",
        "next_action",
        "created_evidence_ref",
        "status",
        "request_id",
        "expected_version",
        "version",
      ])
      || data.organization_id !== actor.organizationId
      || data.student_case_id !== studentCaseId
      || data.payment_obligation_id !== paymentObligationId
      || !uuid(String(data.owner_membership_id ?? ""))
      || (actor.authorityRole === "admissions"
        && data.owner_membership_id !== actor.membershipId)
      || !stopFactorId || data.reason !== reason
      || data.blocked_action !== blockedAction
      || data.next_action !== nextAction
      || data.created_evidence_ref !== evidenceRef
      || data.status !== "active"
      || data.request_id !== requestId
      || data.expected_version !== "0"
      || nextVersion !== "1"
    ) {
      return stopFailureState(form, "unavailable", stopFactorId, requestId);
    }
    revalidateCaseOperations(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      stopFactorId,
      version: nextVersion,
    });
  } catch {
    return stopFailureState(form, "unavailable", null, requestId);
  }
}

export async function resolvePlatformFinanceStopFactorAction(
  _previous: PlatformFinanceStopFactorActionState,
  form: FormData,
): Promise<PlatformFinanceStopFactorActionState> {
  const actor = await requirePlatformStaffActor();
  if (actor.authorityRole !== "admin") {
    return stopFailureState(form, "forbidden");
  }
  const fields = exactActionStringFields(form, RESOLVE_STOP_FIELDS);
  if (!fields) return stopFailureState(form, "invalid");

  const studentCaseId = uuid(operationField(fields, "student_case_id"));
  const stopFactorId = uuid(operationField(fields, "stop_factor_id"));
  const reason = operationText(fields, "reason", 3, 1000);
  const evidenceRef = operationText(fields, "evidence_ref", 1, 512);
  const requestId = uuid(operationField(fields, "request_id"));
  const expectedVersion = operationVersion(
    operationField(fields, "expected_version"),
    false,
  );

  if (
    !studentCaseId || !stopFactorId || !reason || !evidenceRef || !requestId ||
    !expectedVersion
  ) {
    return stopFailureState(form, "invalid", stopFactorId, requestId);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "resolve_case_stop_factor",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_stop_factor_id: stopFactorId,
        p_resolution_kind: "admin_override",
        p_payment_event_id: null,
        p_reason: reason,
        p_evidence_ref: evidenceRef,
        p_expected_version: expectedVersion,
        p_request_id: requestId,
      },
    );
    if (response.error) {
      return stopFailureState(
        form,
        operationErrorStatus(response.error, "admissions_version_conflict"),
        stopFactorId,
        requestId,
      );
    }
    const data = response.data;
    const nextVersion = isRecord(data) && typeof data.version === "string"
      ? operationVersion(data.version, false)
      : null;
    if (
      !isRecord(data) || !hasExactKeys(data, [
        "organization_id",
        "stop_factor_id",
        "student_case_id",
        "payment_obligation_id",
        "resolution_kind",
        "payment_event_id",
        "reason",
        "evidence_ref",
        "status",
        "resolved_at",
        "request_id",
        "expected_version",
        "version",
      ]) ||
      data.organization_id !== actor.organizationId ||
      data.stop_factor_id !== stopFactorId ||
      data.student_case_id !== studentCaseId ||
      typeof data.payment_obligation_id !== "string" ||
      uuid(data.payment_obligation_id) === null ||
      data.resolution_kind !== "admin_override" ||
      data.payment_event_id !== null || data.reason !== reason ||
      data.evidence_ref !== evidenceRef || data.status !== "resolved" ||
      !validTimestamp(data.resolved_at) || data.request_id !== requestId ||
      data.expected_version !== expectedVersion || !nextVersion ||
      BigInt(nextVersion) !== BigInt(expectedVersion) + BigInt(1)
    ) {
      return stopFailureState(form, "unavailable", stopFactorId, requestId);
    }
    revalidateCaseOperations(studentCaseId);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      stopFactorId,
      version: nextVersion,
    });
  } catch {
    return stopFailureState(form, "unavailable", stopFactorId, requestId);
  }
}
