"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformSalesActor } from "@/lib/platform-guards";
import {
  CANONICAL_SALES_STAGES,
  type CanonicalSalesStage,
} from "@/lib/canonical-sales-workflow-contract";

import {
  CanonicalCrmRepositoryError,
  updateCanonicalSalesLeadWorkflow,
} from "./canonical-crm-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type CanonicalSalesWorkflowActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "unavailable";

export type CanonicalSalesWorkflowActionState = Readonly<{
  status: CanonicalSalesWorkflowActionStatus;
  requestId: string;
  version: number | null;
  changedAt: string | null;
}>;

function single(form: FormData, key: string): FormDataEntryValue | undefined {
  const values = form.getAll(key);
  return values.length === 1 ? values[0] : undefined;
}

function uuid(form: FormData, key: string): string | null {
  const value = single(form, key);
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function text(
  form: FormData,
  key: string,
  maxLength: number,
): string | null | undefined {
  const value = single(form, key);
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalized.length <= maxLength ? normalized : undefined;
}

function failureState(
  form: FormData,
  status: Exclude<CanonicalSalesWorkflowActionStatus, "idle" | "saved">,
): CanonicalSalesWorkflowActionState {
  const submittedRequestId = uuid(form, "request_id");
  return Object.freeze({
    status,
    requestId:
      status === "request_conflict"
        ? randomUUID()
        : (submittedRequestId ?? randomUUID()),
    version: null,
    changedAt: null,
  });
}

export async function updateCanonicalSalesLeadWorkflowAction(
  _previous: CanonicalSalesWorkflowActionState,
  form: FormData,
): Promise<CanonicalSalesWorkflowActionState> {
  const actor = await requirePlatformSalesActor();
  const leadId = uuid(form, "lead_id");
  const requestId = uuid(form, "request_id");
  const expectedVersionValue = single(form, "expected_version");
  const expectedVersion =
    typeof expectedVersionValue === "string" && /^\d+$/.test(expectedVersionValue)
      ? Number(expectedVersionValue)
      : Number.NaN;
  const stageValue = single(form, "stage");
  const stage = CANONICAL_SALES_STAGES.find(
    (candidate) => candidate === stageValue,
  ) as CanonicalSalesStage | undefined;
  const qualificationSummary = text(form, "qualification_summary", 2_000);
  const nextAction = text(form, "next_action", 500);
  const nextActionAtValue = text(form, "next_action_at", 10);
  const nextActionAt =
    nextActionAtValue === null || nextActionAtValue === undefined
      ? nextActionAtValue
      : DATE_PATTERN.test(nextActionAtValue)
        ? nextActionAtValue
        : undefined;
  const reason =
    !form.has("reason") && stage !== "disqualified"
      ? null
      : text(form, "reason", 500);

  if (
    leadId === null ||
    requestId === null ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    stage === undefined ||
    stage === "handed_off" ||
    qualificationSummary === undefined ||
    nextAction === undefined ||
    nextActionAt === undefined ||
    reason === undefined
  ) {
    return failureState(form, "invalid");
  }

  try {
    const lead = await updateCanonicalSalesLeadWorkflow(
      {
        actorRole: actor.platformRole,
        idempotencyKey: requestId,
        correlationId: requestId,
      },
      {
        leadId,
        expectedVersion,
        stage,
        qualificationSummary,
        nextAction,
        nextActionAt,
        reason,
      },
    );

    revalidatePath("/sales");
    revalidatePath(`/sales/${leadId}`);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      version: lead.version,
      changedAt: lead.updatedAt,
    });
  } catch (error: unknown) {
    if (!(error instanceof CanonicalCrmRepositoryError)) {
      return failureState(form, "unavailable");
    }

    const status: Exclude<
      CanonicalSalesWorkflowActionStatus,
      "idle" | "saved"
    > = {
      invalid_input: "invalid",
      forbidden: "forbidden",
      conflict: "stale",
      idempotency_conflict: "request_conflict",
      not_found: "unavailable",
      gate_unsatisfied: "invalid",
      unavailable: "unavailable",
    }[error.code] as Exclude<
      CanonicalSalesWorkflowActionStatus,
      "idle" | "saved"
    >;
    return failureState(form, status);
  }
}
