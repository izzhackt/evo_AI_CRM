"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformSalesActor } from "@/lib/platform-guards";

import {
  CanonicalCrmRepositoryError,
  handoffCanonicalLeadToAdmissions,
} from "./canonical-crm-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDOFF_FORM_KEYS = [
  "expected_version",
  "is_override",
  "lead_id",
  "override_reason",
  "request_id",
] as const;

export type CanonicalSalesHandoffActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "gate_blocked"
  | "stale"
  | "request_conflict"
  | "unavailable";

export type CanonicalSalesHandoffActionState = Readonly<{
  status: CanonicalSalesHandoffActionStatus;
  requestId: string;
  studentCaseId: string | null;
  isOverride: boolean | null;
  changedAt: string | null;
}>;

type HandoffForm = Readonly<{
  expectedVersion: number;
  isOverride: boolean;
  leadId: string;
  overrideReason: string | null;
  requestId: string;
}>;

function parseHandoffForm(form: FormData): HandoffForm | null {
  const expected = new Set<string>(HANDOFF_FORM_KEYS);
  const fields = new Map<string, string>();
  for (const [key, value] of form.entries()) {
    if (!expected.has(key) || typeof value !== "string" || fields.has(key)) {
      return null;
    }
    fields.set(key, value);
  }
  if (fields.size !== HANDOFF_FORM_KEYS.length) return null;

  const leadId = fields.get("lead_id")?.toLowerCase();
  const requestId = fields.get("request_id")?.toLowerCase();
  const expectedVersionValue = fields.get("expected_version");
  const isOverrideValue = fields.get("is_override");
  const rawReason = fields.get("override_reason");
  const overrideReason = rawReason?.trim() ?? "";
  const expectedVersion =
    expectedVersionValue && /^\d+$/.test(expectedVersionValue)
      ? Number(expectedVersionValue)
      : Number.NaN;

  if (
    !leadId ||
    !UUID_PATTERN.test(leadId) ||
    !requestId ||
    !UUID_PATTERN.test(requestId) ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    (isOverrideValue !== "true" && isOverrideValue !== "false") ||
    /[\u0000-\u001f\u007f]/.test(overrideReason) ||
    overrideReason.length > 2_000
  ) {
    return null;
  }

  const isOverride = isOverrideValue === "true";
  if (
    (isOverride && overrideReason.length === 0) ||
    (!isOverride && overrideReason.length > 0)
  ) {
    return null;
  }

  return {
    expectedVersion,
    isOverride,
    leadId,
    overrideReason: isOverride ? overrideReason : null,
    requestId,
  };
}

function failureState(
  form: FormData,
  status: Exclude<CanonicalSalesHandoffActionStatus, "idle" | "saved">,
): CanonicalSalesHandoffActionState {
  const submittedRequestId = form.get("request_id");
  const requestId =
    typeof submittedRequestId === "string" &&
    UUID_PATTERN.test(submittedRequestId)
      ? submittedRequestId.toLowerCase()
      : randomUUID();
  return Object.freeze({
    status,
    requestId: status === "request_conflict" ? randomUUID() : requestId,
    studentCaseId: null,
    isOverride: null,
    changedAt: null,
  });
}

export async function handoffCanonicalLeadToAdmissionsAction(
  _previous: CanonicalSalesHandoffActionState,
  form: FormData,
): Promise<CanonicalSalesHandoffActionState> {
  const actor = await requirePlatformSalesActor();
  const input = parseHandoffForm(form);
  if (!input) return failureState(form, "invalid");
  if (input.isOverride && actor.platformRole !== "admin") {
    return failureState(form, "forbidden");
  }

  try {
    const receipt = await handoffCanonicalLeadToAdmissions({
      actorRole: actor.platformRole,
      idempotencyKey: input.requestId,
      correlationId: input.requestId,
      leadId: input.leadId,
      expectedVersion: input.expectedVersion,
      adminOverride: input.isOverride
        ? { reason: input.overrideReason ?? "" }
        : null,
    });

    revalidatePath("/sales");
    revalidatePath(`/sales/${input.leadId}`);
    revalidatePath("/clients");
    revalidatePath(`/clients/${receipt.studentCaseId}`);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      studentCaseId: receipt.studentCaseId,
      isOverride: receipt.isOverride,
      changedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (!(error instanceof CanonicalCrmRepositoryError)) {
      return failureState(form, "unavailable");
    }
    const status: Exclude<CanonicalSalesHandoffActionStatus, "idle" | "saved"> =
      {
        invalid_input: "invalid",
        forbidden: "forbidden",
        not_found: "unavailable",
        conflict: "stale",
        idempotency_conflict: "request_conflict",
        gate_unsatisfied: "gate_blocked",
        unavailable: "unavailable",
      }[error.code] as Exclude<
        CanonicalSalesHandoffActionStatus,
        "idle" | "saved"
      >;
    return failureState(form, status);
  }
}
