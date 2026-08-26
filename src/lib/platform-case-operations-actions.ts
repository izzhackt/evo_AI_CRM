"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  PLATFORM_OBLIGATION_CATEGORIES,
  PLATFORM_VISA_STATUSES,
  getPlatformCaseVisa,
  hasExactPlatformCaseOperationFormKeys,
  listPlatformCaseFinance,
  resolvePlatformFinanceStopFactorWithReconciliation,
  type PlatformObligationCategory,
  type PlatformVisaStatus,
} from "./platform-case-operations";
import { requirePlatformClientsActor } from "./platform-guards";
import { createSupabaseServerClient } from "./supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CURRENCY_VALUES = new Set(["KGS", "USD", "EUR"]);
const MANUAL_PAYMENT_SOURCE_KEY = "manual_staff_confirmation";
const PLATFORM_FINANCE_BLOCKED_ACTIONS = [
  "application_submission",
  "document_processing",
  "visa_submission",
  "case_progression",
] as const;

type P6dOperation =
  | "visa"
  | "payment-create"
  | "payment-settle";
type U8Operation = "stop-create" | "stop-resolve";
type MutationOutcome = "saved" | "invalid" | "unavailable";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function uuid(value: string): string | null {
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function text(
  form: FormData,
  key: string,
  minimum: number,
  maximum: number,
): string | null {
  const candidate = field(form, key);
  if (
    candidate.length < minimum
    || candidate.length > maximum
    || CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function optionalText(
  form: FormData,
  key: string,
  maximum: number,
): string | null | undefined {
  const candidate = field(form, key);
  if (!candidate) return null;
  if (
    candidate.length > maximum
    || CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

function oneOf<const T extends readonly string[]>(
  value: string,
  allowed: T,
): T[number] | null {
  return allowed.includes(value) ? value as T[number] : null;
}

function amountMinor(value: string): number | null {
  const match = /^(0|[1-9]\d{0,12})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const result = whole * 100 + fraction;
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function endOfUtcDay(value: string): string | null {
  if (!DATE_PATTERN.test(value)) return null;
  const timestamp = `${value}T23:59:59.999Z`;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed)
    && new Date(parsed).toISOString().slice(0, 10) === value
      ? timestamp
      : null;
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

function sameTimestamp(value: unknown, expected: string): boolean {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && Date.parse(value) === Date.parse(expected);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function sameMinor(value: unknown, expected: number): boolean {
  return (typeof value === "number" || typeof value === "string")
    && String(value) === String(expected);
}

function safeMinor(value: unknown): number | null {
  const candidate = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  return typeof candidate === "number"
    && Number.isSafeInteger(candidate)
    && candidate >= 0
      ? candidate
      : null;
}

function operationRedirect(
  studentCaseId: string | null,
  outcome: MutationOutcome,
  operation: P6dOperation,
  requestId?: string | null,
  subjectId?: string | null,
): never {
  const path = studentCaseId ? `/clients/${studentCaseId}` : "/clients";
  const params = new URLSearchParams({ p6d_result: outcome });
  if (outcome !== "saved" && requestId) {
    params.set("p6d_retry_request_id", requestId);
    params.set("p6d_retry_operation", operation);
    if (subjectId) params.set("p6d_subject_id", subjectId);
  }
  const anchor = operation === "visa" ? "visa" : "payments";
  redirect(`${path}?${params.toString()}#${anchor}`);
}

function financeStopRedirect(
  studentCaseId: string | null,
  outcome: MutationOutcome,
  operation: U8Operation,
  requestId?: string | null,
  subjectId?: string | null,
): never {
  if (!studentCaseId) {
    redirect("/clients");
  }
  const path = `/clients/${studentCaseId}`;
  const params = new URLSearchParams({ u8_result: outcome });
  if (outcome !== "saved" && requestId) {
    params.set("u8_retry_request_id", requestId);
    params.set("u8_retry_operation", operation);
    if (subjectId) params.set("u8_subject_id", subjectId);
  }
  redirect(`${path}?${params.toString()}#payments`);
}

function validVisaResult(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    studentCaseId: string;
    visaCaseId?: string | null;
    status: PlatformVisaStatus;
    evidenceReference: string;
    note: string | null;
  }>,
): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      "organization_id",
      "visa_case_id",
      "student_case_id",
      "status",
      "evidence_reference",
      "note",
    ])
    && value.organization_id === expected.organizationId
    && value.student_case_id === expected.studentCaseId
    && typeof value.visa_case_id === "string"
    && uuid(value.visa_case_id) !== null
    && (!expected.visaCaseId || value.visa_case_id === expected.visaCaseId)
    && value.status === expected.status
    && value.evidence_reference === expected.evidenceReference
    && value.note === expected.note;
}

export async function upsertPlatformCaseVisaAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const studentCaseId = uuid(field(form, "student_case_id"));
  const visaCaseIdValue = field(form, "visa_case_id");
  const visaCaseId = visaCaseIdValue ? uuid(visaCaseIdValue) : null;
  const status = oneOf(field(form, "status"), PLATFORM_VISA_STATUSES);
  const evidenceReference = text(form, "evidence_reference", 1, 2000);
  const note = optionalText(form, "note", 4000);
  const requestId = uuid(field(form, "request_id"));
  const subjectId = visaCaseId ?? studentCaseId;

  if (
    !hasExactPlatformCaseOperationFormKeys(form, [
      "student_case_id",
      "visa_case_id",
      "status",
      "evidence_reference",
      "note",
      "request_id",
    ])
    || (actor.platformRole !== "admin" && actor.platformRole !== "curator")
    || !studentCaseId
    || (visaCaseIdValue !== "" && !visaCaseId)
    || !status
    || !evidenceReference
    || note === undefined
    || !requestId
  ) {
    operationRedirect(studentCaseId, "invalid", "visa", requestId, subjectId);
  }

  try {
    if (visaCaseId) {
      const currentVisa = await getPlatformCaseVisa(actor, studentCaseId);
      if (!currentVisa || currentVisa.visaCaseId !== visaCaseId) {
        operationRedirect(
          studentCaseId,
          "unavailable",
          "visa",
          requestId,
          subjectId,
        );
      }
    }
    const client = await createSupabaseServerClient();
    const response = visaCaseId
      ? await client.schema("platform").rpc("change_visa_case", {
          p_organization_id: actor.organizationId,
          p_visa_case_id: visaCaseId,
          p_new_status: status,
          p_evidence_reference: evidenceReference,
          p_note: note,
          p_request_id: requestId,
        })
      : await client.schema("platform").rpc("create_visa_case", {
          p_organization_id: actor.organizationId,
          p_student_case_id: studentCaseId,
          p_status: status,
          p_evidence_reference: evidenceReference,
          p_note: note,
          p_request_id: requestId,
        });
    if (
      response.error
      || !validVisaResult(response.data, {
        organizationId: actor.organizationId,
        studentCaseId,
        visaCaseId,
        status,
        evidenceReference,
        note,
      })
    ) {
      operationRedirect(
        studentCaseId,
        "unavailable",
        "visa",
        requestId,
        subjectId,
      );
    }
  } catch {
    operationRedirect(
      studentCaseId,
      "unavailable",
      "visa",
      requestId,
      subjectId,
    );
  }

  revalidatePath(`/clients/${studentCaseId}`);
  revalidatePath("/portal", "layout");
  operationRedirect(studentCaseId, "saved", "visa");
}

export async function createPlatformPaymentObligationAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const studentCaseId = uuid(field(form, "student_case_id"));
  const label = text(form, "label", 1, 500);
  const category = oneOf(
    field(form, "category"),
    PLATFORM_OBLIGATION_CATEGORIES,
  ) as PlatformObligationCategory | null;
  const minor = amountMinor(field(form, "amount"));
  const currency = field(form, "currency");
  const dueAt = endOfUtcDay(field(form, "due_date"));
  const nextAction = text(form, "next_action", 1, 1000);
  const reason = text(form, "reason", 3, 1000);
  const requestId = uuid(field(form, "request_id"));

  if (
    !hasExactPlatformCaseOperationFormKeys(form, [
      "student_case_id",
      "label",
      "category",
      "amount",
      "currency",
      "due_date",
      "next_action",
      "reason",
      "request_id",
    ])
    || actor.platformRole !== "admin"
    || !studentCaseId
    || !label
    || !category
    || !minor
    || !CURRENCY_VALUES.has(currency)
    || !dueAt
    || !nextAction
    || !reason
    || !requestId
  ) {
    operationRedirect(
      studentCaseId,
      "invalid",
      "payment-create",
      requestId,
      studentCaseId,
    );
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "create_payment_obligation",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_label: label,
        p_category: category,
        p_amount_minor: minor,
        p_currency: currency,
        p_due_at: dueAt,
        p_next_action: nextAction,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    const data = response.data;
    if (
      response.error
      || !isRecord(data)
      || !hasExactKeys(data, [
        "organization_id",
        "payment_obligation_id",
        "student_case_id",
        "label",
        "category",
        "amount_minor",
        "currency",
        "due_at",
        "next_action",
        "total_paid_minor",
        "total_refunded_minor",
      ])
      || data.organization_id !== actor.organizationId
      || data.student_case_id !== studentCaseId
      || typeof data.payment_obligation_id !== "string"
      || !uuid(data.payment_obligation_id)
      || data.label !== label
      || data.category !== category
      || !sameMinor(data.amount_minor, minor)
      || data.currency !== currency
      || !sameTimestamp(data.due_at, dueAt)
      || data.next_action !== nextAction
      || !sameMinor(data.total_paid_minor, 0)
      || !sameMinor(data.total_refunded_minor, 0)
    ) {
      operationRedirect(
        studentCaseId,
        "unavailable",
        "payment-create",
        requestId,
        studentCaseId,
      );
    }
  } catch {
    operationRedirect(
      studentCaseId,
      "unavailable",
      "payment-create",
      requestId,
      studentCaseId,
    );
  }

  revalidatePath(`/clients/${studentCaseId}`);
  revalidatePath("/portal", "layout");
  operationRedirect(studentCaseId, "saved", "payment-create");
}

export async function settlePlatformPaymentObligationAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const studentCaseId = uuid(field(form, "student_case_id"));
  const paymentObligationId = uuid(field(form, "payment_obligation_id"));
  const evidenceRef = text(form, "evidence_ref", 1, 2000);
  const reason = text(form, "reason", 3, 1000);
  const requestId = uuid(field(form, "request_id"));

  if (
    !hasExactPlatformCaseOperationFormKeys(form, [
      "student_case_id",
      "payment_obligation_id",
      "evidence_ref",
      "reason",
      "request_id",
    ])
    || actor.platformRole !== "admin"
    || !studentCaseId
    || !paymentObligationId
    || !evidenceRef
    || !reason
    || !requestId
  ) {
    operationRedirect(
      studentCaseId,
      "invalid",
      "payment-settle",
      requestId,
      paymentObligationId,
    );
  }

  try {
    const currentFinance = await listPlatformCaseFinance(actor, studentCaseId);
    if (
      !currentFinance.some(
        (row) => row.paymentObligationId === paymentObligationId,
      )
    ) {
      operationRedirect(
        studentCaseId,
        "unavailable",
        "payment-settle",
        requestId,
        paymentObligationId,
      );
    }
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "settle_payment_obligation",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_payment_obligation_id: paymentObligationId,
        p_source_key: MANUAL_PAYMENT_SOURCE_KEY,
        p_evidence_ref: evidenceRef,
        p_reason: reason,
        p_request_id: requestId,
      },
    );
    const data = response.data;
    const eventAmountMinor = isRecord(data) ? safeMinor(data.amount_minor) : null;
    const totalPaidMinor = isRecord(data) ? safeMinor(data.total_paid_minor) : null;
    const totalRefundedMinor = isRecord(data)
      ? safeMinor(data.total_refunded_minor)
      : null;
    if (
      response.error
      || !isRecord(data)
      || !hasExactKeys(data, [
        "organization_id",
        "payment_event_id",
        "payment_obligation_id",
        "student_case_id",
        "event_type",
        "amount_minor",
        "currency",
        "total_paid_minor",
        "total_refunded_minor",
      ])
      || data.organization_id !== actor.organizationId
      || data.student_case_id !== studentCaseId
      || data.payment_obligation_id !== paymentObligationId
      || typeof data.payment_event_id !== "string"
      || !uuid(data.payment_event_id)
      || data.event_type !== "payment"
      || (typeof data.currency !== "string" || !CURRENCY_PATTERN.test(data.currency))
      || eventAmountMinor === null
      || eventAmountMinor <= 0
      || totalPaidMinor === null
      || totalPaidMinor < eventAmountMinor
      || totalRefundedMinor === null
      || totalRefundedMinor >= totalPaidMinor
    ) {
      operationRedirect(
        studentCaseId,
        "unavailable",
        "payment-settle",
        requestId,
        paymentObligationId,
      );
    }
  } catch {
    operationRedirect(
      studentCaseId,
      "unavailable",
      "payment-settle",
      requestId,
      paymentObligationId,
    );
  }

  revalidatePath(`/clients/${studentCaseId}`);
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/notifications");
  operationRedirect(studentCaseId, "saved", "payment-settle");
}

export async function createPlatformFinanceStopFactorAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const studentCaseId = uuid(field(form, "student_case_id"));
  const paymentObligationId = uuid(field(form, "payment_obligation_id"));
  const blockedAction = oneOf(
    field(form, "blocked_action"),
    PLATFORM_FINANCE_BLOCKED_ACTIONS,
  );
  const reason = text(form, "reason", 3, 1000);
  const nextAction = text(form, "next_action", 3, 1000);
  const evidenceRef = text(form, "evidence_ref", 1, 512);
  const requestId = uuid(field(form, "request_id"));

  if (
    !hasExactPlatformCaseOperationFormKeys(form, [
      "student_case_id",
      "payment_obligation_id",
      "blocked_action",
      "reason",
      "next_action",
      "evidence_ref",
      "request_id",
    ])
    || actor.platformRole !== "admin"
    || !studentCaseId
    || !paymentObligationId
    || !blockedAction
    || !reason
    || !nextAction
    || !evidenceRef
    || !requestId
  ) {
    financeStopRedirect(
      studentCaseId,
      "invalid",
      "stop-create",
      requestId,
      paymentObligationId,
    );
  }

  try {
    const finance = await listPlatformCaseFinance(actor, studentCaseId);
    const obligation = finance.find(
      (row) => row.paymentObligationId === paymentObligationId,
    );
    if (!obligation || obligation.status === "paid") {
      financeStopRedirect(
        studentCaseId,
        "invalid",
        "stop-create",
        requestId,
        paymentObligationId,
      );
    }

    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "create_stop_factor",
      {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_payment_obligation_id: paymentObligationId,
        p_owner_membership_id: actor.membershipId,
        p_reason: reason,
        p_blocked_action: blockedAction,
        p_next_action: nextAction,
        p_created_evidence_ref: evidenceRef,
        p_request_id: requestId,
      },
    );
    const data = response.data;
    if (
      response.error
      || !isRecord(data)
      || !hasExactKeys(data, [
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
      ])
      || data.organization_id !== actor.organizationId
      || data.student_case_id !== studentCaseId
      || data.payment_obligation_id !== paymentObligationId
      || data.owner_membership_id !== actor.membershipId
      || typeof data.stop_factor_id !== "string"
      || !uuid(data.stop_factor_id)
      || data.reason !== reason
      || data.blocked_action !== blockedAction
      || data.next_action !== nextAction
      || data.created_evidence_ref !== evidenceRef
      || data.status !== "active"
    ) {
      financeStopRedirect(
        studentCaseId,
        "unavailable",
        "stop-create",
        requestId,
        paymentObligationId,
      );
    }
  } catch {
    financeStopRedirect(
      studentCaseId,
      "unavailable",
      "stop-create",
      requestId,
      paymentObligationId,
    );
  }

  revalidatePath(`/clients/${studentCaseId}`);
  revalidatePath("/applications");
  financeStopRedirect(studentCaseId, "saved", "stop-create");
}

export async function resolvePlatformFinanceStopFactorAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformClientsActor();
  const studentCaseId = uuid(field(form, "student_case_id"));
  const stopFactorId = uuid(field(form, "stop_factor_id"));
  const reason = text(form, "reason", 3, 1000);
  const evidenceRef = text(form, "evidence_ref", 1, 512);
  const requestId = uuid(field(form, "request_id"));

  if (
    !hasExactPlatformCaseOperationFormKeys(form, [
      "student_case_id",
      "stop_factor_id",
      "reason",
      "evidence_ref",
      "request_id",
    ])
    || actor.platformRole !== "admin"
    || !studentCaseId
    || !stopFactorId
    || !reason
    || !evidenceRef
    || !requestId
  ) {
    financeStopRedirect(
      studentCaseId,
      "invalid",
      "stop-resolve",
      requestId,
      stopFactorId,
    );
  }

  try {
    const client = await createSupabaseServerClient();
    const rpcArguments = {
        p_organization_id: actor.organizationId,
        p_student_case_id: studentCaseId,
        p_stop_factor_id: stopFactorId,
        p_resolution_kind: "admin_override",
        p_payment_event_id: null,
        p_reason: reason,
        p_evidence_ref: evidenceRef,
        p_request_id: requestId,
      };
    const resolved = await resolvePlatformFinanceStopFactorWithReconciliation(
      () => client.schema("platform").rpc(
        "resolve_case_stop_factor",
        rpcArguments,
      ),
      (response) => {
        const data = response.data;
        return (
          !response.error
          && isRecord(data)
          && hasExactKeys(data, [
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
          ])
          && data.organization_id === actor.organizationId
          && data.stop_factor_id === stopFactorId
          && data.student_case_id === studentCaseId
          && typeof data.payment_obligation_id === "string"
          && uuid(data.payment_obligation_id) !== null
          && data.resolution_kind === "admin_override"
          && data.payment_event_id === null
          && data.reason === reason
          && data.evidence_ref === evidenceRef
          && data.status === "resolved"
          && validTimestamp(data.resolved_at)
        );
      },
    );
    if (!resolved) {
      financeStopRedirect(
        studentCaseId,
        "unavailable",
        "stop-resolve",
        requestId,
        stopFactorId,
      );
    }
  } catch {
    financeStopRedirect(
      studentCaseId,
      "unavailable",
      "stop-resolve",
      requestId,
      stopFactorId,
    );
  }

  revalidatePath(`/clients/${studentCaseId}`);
  revalidatePath("/applications");
  financeStopRedirect(studentCaseId, "saved", "stop-resolve");
}
