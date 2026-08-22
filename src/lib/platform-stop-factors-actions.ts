"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformFinanceActor } from "./platform-guards";
import {
  PLATFORM_STOP_FACTOR_CREATE_FIELDS,
  PLATFORM_STOP_FACTOR_RESOLVE_FIELDS,
  decidePlatformStopFactorCreate,
  decidePlatformStopFactorResolve,
  hasExactPlatformStopFactorFormKeys,
} from "./platform-stop-factor-forms";
import { listPlatformStopFactorObligations } from "./platform-stop-factors";
import { createSupabaseServerClient } from "./supabase/server";

type StopFactorOperation = "stop-create" | "stop-resolve";
type StopFactorOutcome = "saved" | "invalid" | "unavailable";

function fields(
  form: FormData,
  keys: readonly string[],
): Record<string, string | undefined> {
  const collected: Record<string, string | undefined> = {};
  for (const key of keys) {
    const value = form.get(key);
    collected[key] = typeof value === "string" ? value : undefined;
  }
  return collected;
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

function stopFactorRedirect(
  outcome: StopFactorOutcome,
  operation: StopFactorOperation,
  requestId?: string | null,
): never {
  const params = new URLSearchParams({ p6f_result: outcome });
  if (outcome !== "saved" && requestId) {
    params.set("p6f_retry_request_id", requestId);
    params.set("p6f_retry_operation", operation);
  }
  redirect(`/finance?${params.toString()}#stop-factors`);
}

export async function createPlatformStopFactorAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformFinanceActor();
  const input = hasExactPlatformStopFactorFormKeys(
    form,
    PLATFORM_STOP_FACTOR_CREATE_FIELDS,
  )
    ? decidePlatformStopFactorCreate(
      fields(form, PLATFORM_STOP_FACTOR_CREATE_FIELDS),
    )
    : null;
  if (!input) {
    stopFactorRedirect("invalid", "stop-create", null);
  }

  try {
    // The case a block belongs to is never taken from the submitted form. It
    // is resolved from an authorized read with the operator's own session, so
    // a tampered obligation id cannot attach a block to another case.
    const obligations = await listPlatformStopFactorObligations(actor);
    const obligation = obligations.find(
      (candidate) =>
        candidate.paymentObligationId === input.paymentObligationId,
    );
    if (!obligation) {
      stopFactorRedirect("invalid", "stop-create", input.requestId);
    }

    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc("create_stop_factor", {
      p_organization_id: actor.organizationId,
      p_student_case_id: obligation.studentCaseId,
      p_payment_obligation_id: input.paymentObligationId,
      p_owner_membership_id: input.ownerMembershipId,
      p_reason: input.reason,
      p_blocked_action: input.blockedAction,
      p_next_action: input.nextAction,
      p_created_evidence_ref: input.evidenceRef,
      p_request_id: input.requestId,
    });
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
      || data.student_case_id !== obligation.studentCaseId
      || data.payment_obligation_id !== input.paymentObligationId
      || data.owner_membership_id !== input.ownerMembershipId
      || data.reason !== input.reason
      || data.blocked_action !== input.blockedAction
      || data.next_action !== input.nextAction
      || data.created_evidence_ref !== input.evidenceRef
      || data.status !== "active"
    ) {
      stopFactorRedirect("unavailable", "stop-create", input.requestId);
    }
  } catch (error) {
    if (isRedirectError(error)) throw error;
    stopFactorRedirect("unavailable", "stop-create", input.requestId);
  }

  revalidatePath("/finance");
  revalidatePath("/portal", "layout");
  stopFactorRedirect("saved", "stop-create");
}

export async function resolvePlatformStopFactorAction(
  form: FormData,
): Promise<void> {
  const actor = await requirePlatformFinanceActor();
  const input = hasExactPlatformStopFactorFormKeys(
    form,
    PLATFORM_STOP_FACTOR_RESOLVE_FIELDS,
  )
    ? decidePlatformStopFactorResolve(
      fields(form, PLATFORM_STOP_FACTOR_RESOLVE_FIELDS),
      actor.platformRole,
    )
    : null;
  if (!input) {
    stopFactorRedirect("invalid", "stop-resolve", null);
  }

  try {
    const client = await createSupabaseServerClient();
    const response = await client.schema("platform").rpc(
      "resolve_stop_factor",
      {
        p_organization_id: actor.organizationId,
        p_stop_factor_id: input.stopFactorId,
        p_resolution_kind: input.resolutionKind,
        p_payment_event_id: input.paymentEventId,
        p_reason: input.reason,
        p_evidence_ref: input.evidenceRef,
        p_request_id: input.requestId,
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
        "resolution_kind",
        "payment_event_id",
        "reason",
        "evidence_ref",
        "status",
        "resolved_at",
      ])
      || data.organization_id !== actor.organizationId
      || data.stop_factor_id !== input.stopFactorId
      || data.resolution_kind !== input.resolutionKind
      || data.payment_event_id !== input.paymentEventId
      || data.reason !== input.reason
      || data.evidence_ref !== input.evidenceRef
      || data.status !== "resolved"
    ) {
      stopFactorRedirect("unavailable", "stop-resolve", input.requestId);
    }
  } catch (error) {
    if (isRedirectError(error)) throw error;
    stopFactorRedirect("unavailable", "stop-resolve", input.requestId);
  }

  revalidatePath("/finance");
  revalidatePath("/portal", "layout");
  stopFactorRedirect("saved", "stop-resolve");
}

/**
 * `redirect()` signals by throwing. Without this check the surrounding
 * `catch` would swallow a deliberate redirect and report it as an outage.
 */
function isRedirectError(error: unknown): boolean {
  return isRecord(error)
    && typeof error.digest === "string"
    && error.digest.startsWith("NEXT_REDIRECT");
}
