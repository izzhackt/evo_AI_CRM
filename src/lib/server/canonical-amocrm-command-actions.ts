"use server";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";

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
  releasePlatformAmoCrmPreparedAttempt,
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

function deniedState(): CanonicalAmoCrmSyncResult {
  return Object.freeze({ status: "blocked", reason: "permission_denied", attemptId: null, steps: Object.freeze([]) });
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
  if (isStaffPreview(actor) || !staffHasPermission(actor, "amocrm.command.manage")) {
    return deniedState();
  }
  const result = await executePlatformAmoCrmSalesSync({
    actor,
    actorRole: actor.systemRole === "admin" ? "admin" : "sales",
    leadId,
    baseRequestId,
    noteText,
    taskText,
    taskCompleteTill,
  });
  revalidatePath("/v3/profile");
  revalidatePath("/v3/inbox");
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

  const actor = await requirePlatformAdmissionsActor("/v3/profile");
  if (isStaffPreview(actor) || !staffHasPermission(actor, "amocrm.command.manage")) {
    return deniedState();
  }
  const result = await executePlatformAmoCrmAdmissionsSync({
    actor,
    actorRole: actor.systemRole === "admin" ? "admin" : "admissions",
    studentCaseId,
    baseRequestId,
    noteText,
    taskText,
    taskCompleteTill,
  });
  revalidatePath("/v3/profile");
  revalidatePath("/v3/inbox");
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
      : await requirePlatformAdmissionsActor("/v3/profile");
  if (isStaffPreview(actor) || !staffHasPermission(actor, "amocrm.command.manage")) {
    return deniedState();
  }

  const result = await reconcilePlatformAmoCrmSyncAttempt({
    actor,
    actorRole: actor.systemRole === "admin" ? "admin" : workflowScope === "sales_pre_handoff" ? "sales" : "admissions",
    workflowScope,
    leadId,
    studentCaseId,
    attemptId,
  });
  revalidatePath("/v3/profile");
  revalidatePath("/v3/inbox");
  return result;
}

export async function releaseCanonicalAmoCrmPreparedCommandAction(
  _previous: CanonicalAmoCrmCommandActionState,
  form: FormData,
): Promise<CanonicalAmoCrmSyncResult> {
  const parsed = parsePlatformAmoCrmReconcileForm(form);
  if (parsed === null) return invalidState();
  const { workflowScope, leadId, attemptId, studentCaseId } = parsed;

  const actor =
    workflowScope === "sales_pre_handoff"
      ? await requirePlatformSalesActor()
      : await requirePlatformAdmissionsActor("/v3/profile");
  if (isStaffPreview(actor) || !staffHasPermission(actor, "amocrm.command.manage")) {
    return deniedState();
  }

  const result = await releasePlatformAmoCrmPreparedAttempt({
    actor,
    actorRole: actor.systemRole === "admin" ? "admin" : workflowScope === "sales_pre_handoff" ? "sales" : "admissions",
    workflowScope,
    leadId,
    studentCaseId,
    attemptId,
  });
  revalidatePath("/v3/profile");
  revalidatePath("/v3/inbox");
  return result;
}
