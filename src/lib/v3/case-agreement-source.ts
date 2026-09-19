import "server-only";
import type { PlatformActor } from "../platform-auth";
import {
  parseCaseAgreement,
  type CaseAgreement,
  type CaseAgreementState,
} from "../platform-case-agreement-contract";
import { parseSalesUuid } from "../platform-sales-register-contract";
import { createSupabaseServerClient } from "../supabase/server";

// FIX 6 (adversarial review): the read used to collapse every failure —
// 42501 (no access), a real outage, and a malformed payload — into the same
// `null`, so CaseAgreementBlock.tsx silently rendered nothing for an actual
// error the same way it does for a legitimate access refusal. Only a genuine
// 42501 (PostgREST/pg error code) means "render nothing"; anything else is
// "unavailable" and must say so.
export type CaseAgreementReadResult =
  | Readonly<{ status: "ok"; agreement: CaseAgreement }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "unavailable" }>;

/**
 * Reads platform.staff_case_agreement_v1 (188). "forbidden" (42501) means
 * callers must fall back to rendering nothing, never a fake empty state
 * (plan requirement: visibility follows existing card access) — "unavailable"
 * means something actually broke and must be surfaced, not hidden.
 */
export async function readCaseAgreement(
  actor: PlatformActor,
  studentCaseId: string,
): Promise<CaseAgreementReadResult> {
  const normalizedCaseId = parseSalesUuid(studentCaseId);
  if (!normalizedCaseId) return { status: "unavailable" };
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc(
    "staff_case_agreement_v1",
    { p_student_case_id: normalizedCaseId },
  );
  if (error) {
    return { status: error.code === "42501" ? "forbidden" : "unavailable" };
  }
  try {
    return {
      status: "ok",
      agreement: parseCaseAgreement(data, actor.organizationId, normalizedCaseId),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function saveCaseTranche(
  actor: PlatformActor,
  requestId: string,
  args: Record<string, unknown>,
): Promise<CaseAgreementState> {
  const outcome = (
    status: CaseAgreementState["status"],
    resourceId: string | null = null,
  ): CaseAgreementState => ({ status, resourceId, requestId });
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc(
    "save_case_tranche_v1",
    { ...args, p_organization_id: actor.organizationId, p_request_id: requestId },
  );
  if (error) {
    return outcome(
      error.code === "42501"
        ? "forbidden"
        // FIX 7 (adversarial review): save_case_tranche_v1 raises the
        // distinct 'case_agreement_tranche_paid' message (22023) when an
        // edit would change amount/currency on an already-paid tranche —
        // surfaced as its own status instead of the generic "invalid" so
        // CaseAgreementForms can explain why, instead of just "проверьте
        // поля". Every other 22023/23505 keeps the existing mapping.
        : error.code === "22023" && /tranche_paid/i.test(error.message)
        ? "tranche_paid"
        : error.code === "22023" || error.code === "23505"
        ? /request|replay|idempot/i.test(error.message)
          ? "request_conflict"
          : "invalid"
        : "unavailable",
    );
  }
  if (
    !data || typeof data !== "object" || Array.isArray(data) ||
    data.organization_id !== actor.organizationId
  ) {
    return outcome("unavailable");
  }
  const resourceId = parseSalesUuid(data.payment_obligation_id);
  return resourceId ? outcome("saved", resourceId) : outcome("unavailable");
}

export async function recordCasePayment(
  actor: PlatformActor,
  requestId: string,
  args: Record<string, unknown>,
): Promise<CaseAgreementState> {
  const outcome = (
    status: CaseAgreementState["status"],
    resourceId: string | null = null,
  ): CaseAgreementState => ({ status, resourceId, requestId });
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc(
    "record_case_payment_v1",
    { ...args, p_organization_id: actor.organizationId, p_request_id: requestId },
  );
  if (error) {
    return outcome(
      error.code === "42501"
        ? "forbidden"
        : error.code === "22023" || error.code === "23505"
        ? /request|replay|idempot/i.test(error.message)
          ? "request_conflict"
          : "invalid"
        : "unavailable",
    );
  }
  if (
    !data || typeof data !== "object" || Array.isArray(data) ||
    data.organization_id !== actor.organizationId
  ) {
    return outcome("unavailable");
  }
  const resourceId = parseSalesUuid(data.payment_event_id);
  return resourceId ? outcome("saved", resourceId) : outcome("unavailable");
}
