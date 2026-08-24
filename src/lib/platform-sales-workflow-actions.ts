"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requirePlatformSalesActor } from "./platform-guards";
import {
  PLATFORM_SALES_STAGES,
  PlatformSalesWorkflowRepositoryError,
  classifyPlatformSalesOwnerSearchFailure,
  listPlatformSalesOwnerOptions,
  mutatePlatformSalesLeadWorkflow,
  parsePlatformSalesDate,
  parsePlatformSalesOwnerSearchInput,
  parsePlatformSalesUuid,
  type PlatformSalesOwnerSearchInput,
  type PlatformSalesOwnerCursor,
  type PlatformSalesOwnerOption,
  type PlatformSalesStage,
} from "./platform-sales-workflow";

export type PlatformSalesOwnerSearchResult = Readonly<{
  status: "ok" | "invalid" | "unavailable";
  rows: readonly PlatformSalesOwnerOption[];
  nextCursor: PlatformSalesOwnerCursor | null;
  hasNext: boolean;
}>;

export type PlatformSalesWorkflowActionStatus =
  | "idle"
  | "saved"
  | "invalid"
  | "forbidden"
  | "stale"
  | "request_conflict"
  | "no_change"
  | "unavailable";

export type PlatformSalesWorkflowActionState = Readonly<{
  status: PlatformSalesWorkflowActionStatus;
  requestId: string;
  workflowVersion: number | null;
  changedAt: string | null;
}>;

const EMPTY_OWNER_SEARCH_RESULT = Object.freeze({
  rows: Object.freeze([]) as readonly PlatformSalesOwnerOption[],
  nextCursor: null,
  hasNext: false,
});

function ownerSearchFailure(
  status: "invalid" | "unavailable",
): PlatformSalesOwnerSearchResult {
  return Object.freeze({ status, ...EMPTY_OWNER_SEARCH_RESULT });
}

export async function searchPlatformSalesOwnerOptionsAction(
  input: PlatformSalesOwnerSearchInput,
): Promise<PlatformSalesOwnerSearchResult> {
  const actor = await requirePlatformSalesActor();
  const parsed = parsePlatformSalesOwnerSearchInput(input);
  if (parsed === null) return ownerSearchFailure("invalid");

  try {
    const page = await listPlatformSalesOwnerOptions(actor, {
      cursor: parsed.cursor,
      pageSize: 50,
      query: parsed.query,
    });
    return Object.freeze({
      status: "ok" as const,
      rows: page.rows,
      nextCursor: page.nextCursor,
      hasNext: page.hasNext,
    });
  } catch (error) {
    return ownerSearchFailure(classifyPlatformSalesOwnerSearchFailure(error));
  }
}

function single(form: FormData, key: string): FormDataEntryValue | undefined {
  const values = form.getAll(key);
  return values.length === 1 ? values[0] : undefined;
}

function text(
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

function uuid(form: FormData, key: string): string | null {
  return parsePlatformSalesUuid(single(form, key));
}

function initialOrNewRequestId(form: FormData): string {
  return uuid(form, "request_id") ?? randomUUID();
}

function invalidState(
  form: FormData,
  status: PlatformSalesWorkflowActionStatus = "invalid",
): PlatformSalesWorkflowActionState {
  return Object.freeze({
    status,
    requestId:
      status === "request_conflict"
        ? randomUUID()
        : initialOrNewRequestId(form),
    workflowVersion: null,
    changedAt: null,
  });
}

export async function updatePlatformSalesLeadWorkflowAction(
  _previous: PlatformSalesWorkflowActionState,
  form: FormData,
): Promise<PlatformSalesWorkflowActionState> {
  const actor = await requirePlatformSalesActor();
  const leadId = uuid(form, "lead_id");
  const requestId = uuid(form, "request_id");
  const expectedVersionInput = single(form, "expected_workflow_version");
  const expectedWorkflowVersion =
    typeof expectedVersionInput === "string" &&
    /^\d+$/.test(expectedVersionInput)
      ? Number(expectedVersionInput)
      : Number.NaN;
  const stageInput = single(form, "stage_key");
  const stage = PLATFORM_SALES_STAGES.find(
    (candidate) => candidate === stageInput,
  ) as PlatformSalesStage | undefined;
  const ownerInput = single(form, "owner_membership_id");
  const ownerMembershipId =
    ownerInput === "" ? null : parsePlatformSalesUuid(ownerInput);
  const nextActionText = text(form, "next_action_text", 500);
  const dueInput = text(form, "next_action_due_date", 10);
  const nextActionDueDate =
    dueInput === null ? null : parsePlatformSalesDate(dueInput);
  const clearInput = single(form, "clear_next_action");
  const clearNextAction =
    clearInput === "true" ? true : clearInput === "false" ? false : null;
  const reason = text(form, "reason", 500);

  if (
    leadId === null ||
    requestId === null ||
    !Number.isSafeInteger(expectedWorkflowVersion) ||
    expectedWorkflowVersion < 1 ||
    stage === undefined ||
    ownerInput === undefined ||
    (ownerInput !== "" && ownerMembershipId === null) ||
    nextActionText === undefined ||
    dueInput === undefined ||
    (dueInput !== null && nextActionDueDate === null) ||
    clearNextAction === null ||
    reason === undefined ||
    (clearNextAction &&
      (nextActionText !== null || nextActionDueDate !== null)) ||
    (!clearNextAction &&
      (nextActionText === null || nextActionDueDate === null))
  ) {
    return invalidState(form);
  }

  try {
    const receipt = await mutatePlatformSalesLeadWorkflow(actor, {
      leadId,
      expectedWorkflowVersion,
      requestId,
      stage,
      ownerMembershipId,
      nextActionText,
      nextActionDueDate,
      clearNextAction,
      reason,
    });
    revalidatePath("/sales");
    revalidatePath(`/sales/${leadId}`);
    return Object.freeze({
      status: "saved" as const,
      requestId: randomUUID(),
      workflowVersion: receipt.workflowVersion,
      changedAt: receipt.changedAt,
    });
  } catch (error) {
    if (error instanceof PlatformSalesWorkflowRepositoryError) {
      return invalidState(form, error.kind);
    }
    return invalidState(form, "unavailable");
  }
}
