"use server";

import { revalidatePath } from "next/cache";

import {
  requirePlatformAdmissionsActor,
  requirePlatformSalesActor,
} from "@/lib/platform-guards";

import { exactActionStringFields } from "./action-form-fields";
import {
  loadCanonicalAmoCrmCommandConfig,
} from "./canonical-amocrm-command-config";
import {
  executePlatformAmoCrmAdmissionsSync,
  executePlatformAmoCrmSalesSync,
  reconcilePlatformAmoCrmSyncAttempt,
  type PlatformAmoCrmSyncResult as CanonicalAmoCrmSyncResult,
} from "./platform-amocrm-command-service";
import {
  loadCanonicalAmoCrmProviderConfig,
  readCanonicalAmoCrmProviderAvailability,
  type CanonicalAmoCrmBlockedReason,
} from "./canonical-amocrm-provider-config";
import { readCanonicalAmoCrmTokenFile } from "./canonical-amocrm-token-store";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_NOTE_BYTES = 1_000;
const MAX_TASK_BYTES = 1_000;

const SALES_FIELDS = [
  "lead_id",
  "note_text",
  "request_id",
  "task_complete_till",
  "task_text",
] as const;
const ADMISSIONS_FIELDS = [
  "note_text",
  "request_id",
  "student_case_id",
  "task_complete_till",
  "task_text",
] as const;
const RECONCILE_FIELDS = [
  "attempt_id",
  "lead_id",
  "student_case_id",
  "workflow_scope",
] as const;

export type CanonicalAmoCrmCommandActionState =
  | Readonly<{
      status: "idle";
      reason: "idle";
      attemptId: null;
      steps: readonly never[];
    }>
  | CanonicalAmoCrmSyncResult;

export type CanonicalAmoCrmCommandAvailability =
  | Readonly<{ status: "ready" }>
  | Readonly<{
      status: "blocked";
      reason:
        | CanonicalAmoCrmBlockedReason
        | "routing_configuration_invalid"
        | "token_unavailable";
    }>;

function invalidState(): CanonicalAmoCrmSyncResult {
  return Object.freeze({
    status: "error",
    reason: "invalid_request",
    attemptId: null,
    steps: Object.freeze([]),
  });
}

function normalizedUuid(value: string | undefined): string | null {
  if (value === undefined || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function normalizedNote(value: string | undefined): string | null {
  if (value === undefined) return null;
  const noteText = value.trim();
  const byteLength = new TextEncoder().encode(noteText).byteLength;
  if (byteLength < 1 || byteLength > MAX_NOTE_BYTES) return null;
  return noteText;
}

function normalizedTask(value: string | undefined): string | null {
  if (value === undefined) return null;
  const taskText = value.trim();
  const byteLength = new TextEncoder().encode(taskText).byteLength;
  if (byteLength < 1 || byteLength > MAX_TASK_BYTES) return null;
  return taskText;
}

function normalizedFutureUnix(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9][0-9]{0,15}$/u.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function readCanonicalAmoCrmCommandAvailability(): Promise<CanonicalAmoCrmCommandAvailability> {
  const providerAvailability = readCanonicalAmoCrmProviderAvailability();
  if (providerAvailability.status === "blocked") {
    return Object.freeze({
      status: "blocked",
      reason: providerAvailability.reason,
    });
  }

  try {
    loadCanonicalAmoCrmCommandConfig();
  } catch {
    return Object.freeze({
      status: "blocked",
      reason: "routing_configuration_invalid",
    });
  }

  try {
    const providerConfig = loadCanonicalAmoCrmProviderConfig();
    if (providerConfig.status !== "ready") {
      return Object.freeze({
        status: "blocked",
        reason: providerConfig.reason,
      });
    }
    await readCanonicalAmoCrmTokenFile(providerConfig.tokenFilePath);
  } catch {
    return Object.freeze({ status: "blocked", reason: "token_unavailable" });
  }

  return Object.freeze({ status: "ready" });
}

export async function syncCanonicalAmoCrmSalesAction(
  _previous: CanonicalAmoCrmCommandActionState,
  form: FormData,
): Promise<CanonicalAmoCrmSyncResult> {
  const fields = exactActionStringFields(form, SALES_FIELDS);
  const leadId = normalizedUuid(fields?.get("lead_id"));
  const baseRequestId = normalizedUuid(fields?.get("request_id"));
  const noteText = normalizedNote(fields?.get("note_text"));
  const taskText = normalizedTask(fields?.get("task_text"));
  const taskCompleteTill = normalizedFutureUnix(
    fields?.get("task_complete_till"),
  );
  if (
    leadId === null ||
    baseRequestId === null ||
    noteText === null ||
    taskText === null ||
    taskCompleteTill === null
  ) {
    return invalidState();
  }

  const actor = await requirePlatformSalesActor();
  if (actor.platformRole !== "admin" && actor.platformRole !== "sales") {
    return invalidState();
  }
  const result = await executePlatformAmoCrmSalesSync({
    actor,
    actorRole: actor.platformRole,
    leadId,
    baseRequestId,
    noteText,
    taskText,
    taskCompleteTill,
  });
  revalidatePath(`/sales/${leadId}`);
  return result;
}

export async function syncCanonicalAmoCrmAdmissionsAction(
  _previous: CanonicalAmoCrmCommandActionState,
  form: FormData,
): Promise<CanonicalAmoCrmSyncResult> {
  const fields = exactActionStringFields(form, ADMISSIONS_FIELDS);
  const studentCaseId = normalizedUuid(fields?.get("student_case_id"));
  const baseRequestId = normalizedUuid(fields?.get("request_id"));
  const noteText = normalizedNote(fields?.get("note_text"));
  const taskText = normalizedTask(fields?.get("task_text"));
  const taskCompleteTill = normalizedFutureUnix(
    fields?.get("task_complete_till"),
  );
  if (
    studentCaseId === null ||
    baseRequestId === null ||
    noteText === null ||
    taskText === null ||
    taskCompleteTill === null
  ) {
    return invalidState();
  }

  const actor = await requirePlatformAdmissionsActor("/clients");
  if (actor.platformRole !== "admin" && actor.platformRole !== "admissions") {
    return invalidState();
  }
  const result = await executePlatformAmoCrmAdmissionsSync({
    actor,
    actorRole: actor.platformRole,
    studentCaseId,
    baseRequestId,
    noteText,
    taskText,
    taskCompleteTill,
  });
  revalidatePath(`/clients/${studentCaseId}`);
  return result;
}

export async function reconcileCanonicalAmoCrmCommandAction(
  _previous: CanonicalAmoCrmCommandActionState,
  form: FormData,
): Promise<CanonicalAmoCrmSyncResult> {
  const fields = exactActionStringFields(form, RECONCILE_FIELDS);
  const workflowScope = fields?.get("workflow_scope");
  const leadId = normalizedUuid(fields?.get("lead_id"));
  const attemptId = normalizedUuid(fields?.get("attempt_id"));
  const rawStudentCaseId = fields?.get("student_case_id");
  const studentCaseId =
    rawStudentCaseId === "" ? null : normalizedUuid(rawStudentCaseId);
  if (
    leadId === null ||
    attemptId === null ||
    (workflowScope !== "sales_pre_handoff" &&
      workflowScope !== "admissions_post_handoff") ||
    (workflowScope === "sales_pre_handoff" && studentCaseId !== null) ||
    (workflowScope === "admissions_post_handoff" && studentCaseId === null)
  ) {
    return invalidState();
  }

  const actor =
    workflowScope === "sales_pre_handoff"
      ? await requirePlatformSalesActor()
      : await requirePlatformAdmissionsActor("/clients");
  if (
    actor.platformRole !== "admin" &&
    actor.platformRole !==
      (workflowScope === "sales_pre_handoff" ? "sales" : "admissions")
  ) {
    return invalidState();
  }

  const result = await reconcilePlatformAmoCrmSyncAttempt({
    actor,
    actorRole: actor.platformRole,
    workflowScope,
    leadId,
    studentCaseId,
    attemptId,
  });
  if (studentCaseId === null) {
    revalidatePath(`/sales/${leadId}`);
  } else {
    revalidatePath(`/clients/${studentCaseId}`);
  }
  return result;
}
