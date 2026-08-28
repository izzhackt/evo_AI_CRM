"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformSalesActor } from "@/lib/platform-guards";

import {
  CanonicalCrmRepositoryError,
  getCanonicalLeadGateSnapshot,
  recordCanonicalSalesGateEvidence,
  type CanonicalLeadGateSnapshot,
} from "./canonical-crm-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const TIMESTAMP_WITH_ZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const GATE_FORM_KEYS = [
  "amount_minor",
  "currency",
  "decision",
  "evidence_reference",
  "evidence_type",
  "lead_id",
  "occurred_at",
  "reason",
  "request_id",
] as const;

export type CanonicalSalesGateActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "unavailable";

export type CanonicalSalesGateActionState = Readonly<{
  status: CanonicalSalesGateActionStatus;
  requestId: string;
  gate: CanonicalLeadGateSnapshot | null;
  changedAt: string | null;
}>;

type GateForm = Readonly<{
  amountMinor: number | null;
  currency: string | null;
  decision: "confirmed" | "rejected";
  evidenceReference: string;
  evidenceType: "contract" | "first_payment";
  leadId: string;
  occurredAt: string;
  reason: string | null;
  requestId: string;
}>;

function exactStringFields(form: FormData): Map<string, string> | null {
  const expected = new Set<string>(GATE_FORM_KEYS);
  const fields = new Map<string, string>();
  for (const [key, value] of form.entries()) {
    if (!expected.has(key) || typeof value !== "string" || fields.has(key)) {
      return null;
    }
    fields.set(key, value);
  }
  return fields.size === GATE_FORM_KEYS.length ? fields : null;
}

function normalizedText(
  value: string | undefined,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function parseGateForm(form: FormData): GateForm | null {
  const fields = exactStringFields(form);
  if (!fields) return null;

  const leadId = fields.get("lead_id")?.toLowerCase();
  const requestId = fields.get("request_id")?.toLowerCase();
  const evidenceType = fields.get("evidence_type");
  const decision = fields.get("decision");
  const evidenceReference = normalizedText(
    fields.get("evidence_reference"),
    255,
  );
  const occurredAt = fields.get("occurred_at")?.trim();
  const reason = normalizedText(fields.get("reason"), 2_000);
  const amountValue = fields.get("amount_minor")?.trim();
  const currencyValue = fields.get("currency")?.trim().toUpperCase();

  if (
    !leadId ||
    !UUID_PATTERN.test(leadId) ||
    !requestId ||
    !UUID_PATTERN.test(requestId) ||
    (evidenceType !== "contract" && evidenceType !== "first_payment") ||
    (decision !== "confirmed" && decision !== "rejected") ||
    !evidenceReference ||
    reason === undefined ||
    (decision === "rejected" && reason === null) ||
    !occurredAt ||
    occurredAt.length > 40 ||
    !TIMESTAMP_WITH_ZONE_PATTERN.test(occurredAt) ||
    !Number.isFinite(new Date(occurredAt).getTime())
  ) {
    return null;
  }

  let amountMinor: number | null = null;
  let currency: string | null = null;
  if (evidenceType === "first_payment") {
    if (
      !amountValue ||
      !/^\d+$/.test(amountValue) ||
      !Number.isSafeInteger(Number(amountValue)) ||
      Number(amountValue) <= 0 ||
      !currencyValue ||
      !CURRENCY_PATTERN.test(currencyValue)
    ) {
      return null;
    }
    amountMinor = Number(amountValue);
    currency = currencyValue;
  } else if (amountValue !== "" || currencyValue !== "") {
    return null;
  }

  return {
    amountMinor,
    currency,
    decision,
    evidenceReference,
    evidenceType,
    leadId,
    occurredAt,
    reason,
    requestId,
  };
}

function failureState(
  form: FormData,
  status: Exclude<CanonicalSalesGateActionStatus, "idle" | "saved">,
): CanonicalSalesGateActionState {
  const submittedRequestId = form.get("request_id");
  const requestId =
    typeof submittedRequestId === "string" &&
    UUID_PATTERN.test(submittedRequestId)
      ? submittedRequestId.toLowerCase()
      : randomUUID();
  return Object.freeze({
    status,
    requestId: status === "request_conflict" ? randomUUID() : requestId,
    gate: null,
    changedAt: null,
  });
}

export async function recordCanonicalSalesGateEvidenceAction(
  _previous: CanonicalSalesGateActionState,
  form: FormData,
): Promise<CanonicalSalesGateActionState> {
  const actor = await requirePlatformSalesActor();
  const input = parseGateForm(form);
  if (!input) return failureState(form, "invalid");

  try {
    await recordCanonicalSalesGateEvidence({
      actorRole: actor.platformRole,
      idempotencyKey: input.requestId,
      correlationId: input.requestId,
      leadId: input.leadId,
      evidenceType: input.evidenceType,
      decision: input.decision,
      evidenceReference: input.evidenceReference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      occurredAt: input.occurredAt,
      reason: input.reason,
    });
    const gate = await getCanonicalLeadGateSnapshot({
      actorRole: actor.platformRole,
      leadId: input.leadId,
    });

    revalidatePath("/sales");
    revalidatePath(`/sales/${input.leadId}`);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      gate,
      changedAt: gate.updatedAt,
    });
  } catch (error: unknown) {
    if (!(error instanceof CanonicalCrmRepositoryError)) {
      return failureState(form, "unavailable");
    }
    const status: Exclude<CanonicalSalesGateActionStatus, "idle" | "saved"> = {
      invalid_input: "invalid",
      forbidden: "forbidden",
      not_found: "unavailable",
      conflict: "stale",
      idempotency_conflict: "request_conflict",
      gate_unsatisfied: "invalid",
      unavailable: "unavailable",
    }[error.code] as Exclude<CanonicalSalesGateActionStatus, "idle" | "saved">;
    return failureState(form, status);
  }
}
