"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformSalesActor } from "./platform-guards";
import {
  mutatePlatformSalesLeadWorkflow,
  parsePlatformSalesStage,
  parsePlatformSalesUuid,
  PlatformSalesWorkflowMutationError,
  type PlatformSalesStage,
  type PlatformSalesWorkflowMutationInput,
} from "./platform-sales";
import { exactActionStringFields } from "./server/action-form-fields";

const REQUEST_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const WORKFLOW_FORM_FIELDS = [
  "lead_id",
  "expected_version",
  "request_id",
  "stage_key",
  "current_owner_membership_id",
  "next_action_text",
  "next_action_due_date",
  "clear_next_action",
  "reason",
] as const;

export type PlatformSalesWorkflowActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "unavailable";

export type PlatformSalesWorkflowActionState = Readonly<{
  status: PlatformSalesWorkflowActionStatus;
  requestId: string;
  version: string | null;
  changedAt: string | null;
}>;

function boundedOptionalText(
  value: string | undefined,
  maximumLength: number,
): string | null | undefined {
  if (value === undefined) return undefined;
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

function validDate(value: string): string | null {
  if (!DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function validVersion(value: string | undefined): string | null {
  if (
    value === undefined ||
    !/^[1-9]\d*$/.test(value) ||
    value.length > POSTGRES_BIGINT_MAX.length ||
    (value.length === POSTGRES_BIGINT_MAX.length &&
      value > POSTGRES_BIGINT_MAX)
  ) {
    return null;
  }
  return value;
}

function parseInput(form: FormData): PlatformSalesWorkflowMutationInput | null {
  const fields = exactActionStringFields(form, WORKFLOW_FORM_FIELDS);
  if (!fields) return null;

  const leadId = parsePlatformSalesUuid(fields.get("lead_id"));
  const expectedWorkflowVersion = validVersion(fields.get("expected_version"));
  const requestIdValue = fields.get("request_id");
  const requestId =
    requestIdValue && REQUEST_UUID_PATTERN.test(requestIdValue)
      ? requestIdValue.toLowerCase()
      : null;
  const stageKey = parsePlatformSalesStage(fields.get("stage_key"));
  const ownerValue = fields.get("current_owner_membership_id")?.trim();
  const ownerMembershipId = ownerValue
    ? parsePlatformSalesUuid(ownerValue)
    : null;
  const nextActionText = boundedOptionalText(
    fields.get("next_action_text"),
    500,
  );
  const nextActionDateValue = fields.get("next_action_due_date")?.trim();
  const nextActionDueDate = nextActionDateValue
    ? validDate(nextActionDateValue)
    : null;
  const clearValue = fields.get("clear_next_action");
  const clearNextAction = clearValue === "true"
    ? true
    : clearValue === "false"
      ? false
      : null;
  const reason = boundedOptionalText(fields.get("reason"), 500);

  if (
    !leadId ||
    !expectedWorkflowVersion ||
    !requestId ||
    !stageKey ||
    (ownerValue !== "" && !ownerMembershipId) ||
    nextActionText === undefined ||
    (nextActionDateValue !== "" && !nextActionDueDate) ||
    clearNextAction === null ||
    reason === undefined ||
    (clearNextAction &&
      (nextActionText !== null || nextActionDueDate !== null)) ||
    (!clearNextAction &&
      (nextActionText === null || nextActionDueDate === null))
  ) {
    return null;
  }

  return Object.freeze({
    leadId,
    expectedWorkflowVersion,
    requestId,
    stageKey: stageKey as PlatformSalesStage,
    ownerMembershipId,
    nextActionText,
    nextActionDueDate,
    clearNextAction,
    reason,
  });
}

function submittedRequestId(form: FormData): string | null {
  const directValues = form.getAll("request_id");
  const envelopeValues = form.getAll("_1_request_id");
  const values = directValues.length > 0 ? directValues : envelopeValues;
  const value = values.length === 1 ? values[0] : null;
  return typeof value === "string" && REQUEST_UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function failureState(
  form: FormData,
  status: Exclude<PlatformSalesWorkflowActionStatus, "idle" | "saved">,
  verifiedRequestId?: string,
): PlatformSalesWorkflowActionState {
  const requestId = verifiedRequestId ?? submittedRequestId(form);
  return Object.freeze({
    status,
    requestId:
      status === "request_conflict" ? randomUUID() : (requestId ?? randomUUID()),
    version: null,
    changedAt: null,
  });
}

export async function updatePlatformSalesWorkflowAction(
  _previous: PlatformSalesWorkflowActionState,
  form: FormData,
): Promise<PlatformSalesWorkflowActionState> {
  const actor = await requirePlatformSalesActor();
  const input = parseInput(form);
  if (!input) return failureState(form, "invalid");

  try {
    const receipt = await mutatePlatformSalesLeadWorkflow(actor, input);
    revalidatePath("/sales");
    revalidatePath("/v3/pipeline");
    revalidatePath(`/v3/profile?id=${receipt.leadId}`);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      version: receipt.workflowVersion,
      changedAt: receipt.changedAt,
    });
  } catch (error) {
    if (error instanceof PlatformSalesWorkflowMutationError) {
      return failureState(form, error.reason, input.requestId);
    }
    return failureState(form, "unavailable", input.requestId);
  }
}
