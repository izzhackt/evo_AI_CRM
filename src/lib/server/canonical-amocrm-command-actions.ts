"use server";

import { revalidatePath } from "next/cache";

import {
  requirePlatformAdmissionsActor,
  requirePlatformSalesActor,
} from "@/lib/platform-guards";

import {
  parsePlatformAmoCrmAdmissionsSyncForm,
  parsePlatformAmoCrmReconcileForm,
  parsePlatformAmoCrmSalesSyncForm,
} from "../platform-amocrm-command-action-contract.ts";
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
  const parsed = parsePlatformAmoCrmSalesSyncForm(form);
  if (parsed === null) return invalidState();
  const { leadId, requestId: baseRequestId, noteText, taskText, taskCompleteTill } =
    parsed;

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
  const parsed = parsePlatformAmoCrmAdmissionsSyncForm(form);
  if (parsed === null) return invalidState();
  const {
    studentCaseId,
    requestId: baseRequestId,
    noteText,
    taskText,
    taskCompleteTill,
  } = parsed;

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
  const parsed = parsePlatformAmoCrmReconcileForm(form);
  if (parsed === null) return invalidState();
  const { workflowScope, leadId, attemptId, studentCaseId } = parsed;

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
