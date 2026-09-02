import type { PlatformActor } from "./platform-auth";
import {
  PLATFORM_OBLIGATION_CATEGORIES,
  PLATFORM_OBLIGATION_STATUSES,
  PLATFORM_VISA_STATUSES,
  type PlatformCaseFinanceRow,
  type PlatformCaseVisa,
} from "./platform-case-operations-contract.ts";

export {
  PLATFORM_OBLIGATION_CATEGORIES,
  PLATFORM_OBLIGATION_STATUSES,
  PLATFORM_VISA_STATUSES,
} from "./platform-case-operations-contract.ts";
export type {
  PlatformCaseFinanceRow,
  PlatformCaseVisa,
  PlatformObligationCategory,
  PlatformObligationStatus,
  PlatformVisaStatus,
} from "./platform-case-operations-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SAFE_REPOSITORY_ERROR_MESSAGE =
  "Platform case operations data is unavailable.";

export class PlatformCaseOperationsRepositoryError extends Error {
  constructor() {
    super(SAFE_REPOSITORY_ERROR_MESSAGE);
    this.name = "PlatformCaseOperationsRepositoryError";
  }
}

export function hasExactPlatformCaseOperationFormKeys(
  form: FormData,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = [...form.keys()]
    .filter((key) => !key.startsWith("$ACTION_"))
    .sort();
  const expected = [...expectedKeys].sort();
  return actualKeys.length === expected.length
    && actualKeys.every((key, index) => key === expected[index])
    && expectedKeys.every((key) => form.getAll(key).length === 1);
}

export async function resolvePlatformFinanceStopFactorWithReconciliation<T>(
  invoke: () => PromiseLike<T>,
  isResolved: (response: T) => boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await invoke();
      if (isResolved(response)) return true;
    } catch {
      // A committed mutation can lose its transport response. One exact retry
      // lets the request-id replay contract reconcile that uncertain outcome.
    }
  }
  return false;
}

function invalidShape(): never {
  throw new PlatformCaseOperationsRepositoryError();
}

function failClosed(error: unknown): never {
  if (error instanceof PlatformCaseOperationsRepositoryError) throw error;
  return invalidShape();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidShape();
  }
  return value.toLowerCase();
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string"
    || !TIMESTAMPTZ_PATTERN.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    return invalidShape();
  }
  return value;
}

function requiredText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidShape();
  }
  return value;
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  return requiredText(value, maximum);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return invalidShape();
  }
  return value as T[number];
}

function nonNegativeSafeInteger(value: unknown): number {
  const candidate = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (
    typeof candidate !== "number"
    || !Number.isSafeInteger(candidate)
    || candidate < 0
  ) {
    return invalidShape();
  }
  return candidate;
}

function requireStaffCaseActor(actor: PlatformActor): void {
  if (
    actor.platformRole !== "admin"
    && actor.platformRole !== "sales"
    && actor.platformRole !== "admissions"
  ) {
    return invalidShape();
  }
  requiredUuid(actor.organizationId);
}

async function getPlatformClient() {
  if (typeof window !== "undefined") return invalidShape();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export function normalizePlatformCaseVisa(
  value: unknown,
  expectedStudentCaseId: string,
): PlatformCaseVisa {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "visa_case_id",
      "case_id",
      "visa_status",
      "note",
      "updated_at",
    ])
  ) {
    return invalidShape();
  }
  const studentCaseId = requiredUuid(value.case_id);
  if (studentCaseId !== requiredUuid(expectedStudentCaseId)) {
    return invalidShape();
  }
  return {
    visaCaseId: requiredUuid(value.visa_case_id),
    studentCaseId,
    status: oneOf(value.visa_status, PLATFORM_VISA_STATUSES),
    note: optionalText(value.note, 4000),
    updatedAt: requiredTimestamp(value.updated_at),
  };
}

export function normalizePlatformCaseFinanceRow(
  value: unknown,
  expectedStudentCaseId: string,
): PlatformCaseFinanceRow {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "case_id",
      "payment_obligation_id",
      "obligation_label",
      "category",
      "amount_minor",
      "currency",
      "due_at",
      "derived_status",
      "overdue",
      "outstanding_minor",
      "next_action",
    ])
  ) {
    return invalidShape();
  }
  const studentCaseId = requiredUuid(value.case_id);
  if (studentCaseId !== requiredUuid(expectedStudentCaseId)) {
    return invalidShape();
  }
  const amountMinor = nonNegativeSafeInteger(value.amount_minor);
  const outstandingMinor = nonNegativeSafeInteger(value.outstanding_minor);
  const status = oneOf(value.derived_status, PLATFORM_OBLIGATION_STATUSES);
  if (
    outstandingMinor > amountMinor
    || typeof value.currency !== "string"
    || !CURRENCY_PATTERN.test(value.currency)
    || typeof value.overdue !== "boolean"
    || (value.overdue !== (status === "overdue"))
    || (status === "paid" && outstandingMinor !== 0)
    || (status !== "paid" && outstandingMinor === 0)
  ) {
    return invalidShape();
  }
  return {
    studentCaseId,
    paymentObligationId: requiredUuid(value.payment_obligation_id),
    label: requiredText(value.obligation_label, 500),
    category: oneOf(value.category, PLATFORM_OBLIGATION_CATEGORIES),
    amountMinor,
    currency: value.currency,
    dueAt: requiredTimestamp(value.due_at),
    status,
    overdue: value.overdue,
    outstandingMinor,
    nextAction: requiredText(value.next_action, 1000),
  };
}

export async function getPlatformCaseVisa(
  actor: PlatformActor,
  studentCaseId: string,
): Promise<PlatformCaseVisa | null> {
  try {
    requireStaffCaseActor(actor);
    const normalizedCaseId = requiredUuid(studentCaseId);
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_case_visa",
      { p_student_case_id: normalizedCaseId },
      { get: true },
    );
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    if (response.data.length === 0) return null;
    if (response.data.length !== 1) return invalidShape();
    return normalizePlatformCaseVisa(response.data[0], normalizedCaseId);
  } catch (error) {
    return failClosed(error);
  }
}

export async function listPlatformCaseFinance(
  actor: PlatformActor,
  studentCaseId: string,
): Promise<readonly PlatformCaseFinanceRow[]> {
  try {
    requireStaffCaseActor(actor);
    const normalizedCaseId = requiredUuid(studentCaseId);
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc(
      "staff_case_finance",
      { p_student_case_id: normalizedCaseId },
      { get: true },
    );
    if (response.error || !Array.isArray(response.data)) return invalidShape();
    const seen = new Set<string>();
    return response.data.map((value) => {
      const row = normalizePlatformCaseFinanceRow(value, normalizedCaseId);
      if (seen.has(row.paymentObligationId)) return invalidShape();
      seen.add(row.paymentObligationId);
      return row;
    });
  } catch (error) {
    return failClosed(error);
  }
}
