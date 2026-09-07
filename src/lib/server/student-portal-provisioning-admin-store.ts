import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BIGINT_MAX = "9223372036854775807";
const SAFE_CODES = new Set([
  "portal_case_already_reserved",
  "portal_case_already_bound",
  "portal_case_invalid_shape",
  "portal_curator_required",
  "portal_email_already_reserved",
  "portal_identity_conflict",
  "portal_invite_already_accepted",
  "portal_invite_not_expired",
  "portal_reconciliation_required",
  "request_replay_conflict",
  "stale_invite_generation",
  "stale_receipt_version",
]);

export type StudentPortalProvisioningReceipt = Readonly<{
  receiptId: string;
  requestId: string;
  studentCaseId: string;
  caseShape: "normal_u6" | "legacy_pending";
  provisioningState:
    | "prepared"
    | "dispatching"
    | "invite_succeeded"
    | "invite_failed"
    | "invite_outcome_unknown"
    | "authority_activated";
  inviteDeliveryStatus:
    | "issued"
    | "expired"
    | "reissue_dispatching"
    | "reissue_failed"
    | "reissue_unknown"
    | "accepted"
    | null;
  receiptVersion: string;
  inviteGeneration: string;
  activeAttemptId: string | null;
  authUserId: string | null;
  inviteExpiresAt: string | null;
  authorityActivated: boolean;
  replayed: boolean;
}>;

export type StudentPortalAdminStoreResult =
  | Readonly<{ status: "prepared"; receipt: StudentPortalProvisioningReceipt }>
  | Readonly<{ status: "blocked"; code: string }>
  | Readonly<{ status: "unavailable" }>;

export type PrepareStudentPortalProvisioningInput = Readonly<{
  organizationId: string;
  studentCaseId: string;
  email: string;
  displayName: string;
  caseShape: "normal_u6" | "legacy_pending";
  legacyCuratorMembershipId: string | null;
  reason: string;
  requestId: string;
}>;

export type AuthorizeStudentPortalReissueInput = Readonly<{
  receiptId: string;
  expectedReceiptVersion: string;
  expectedInviteGeneration: string;
  reissueRequestId: string;
  reason: string;
}>;

type RpcClient = Pick<SupabaseClient, "schema">;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function version(value: unknown): string | null {
  const candidate =
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  if (!/^(?:0|[1-9][0-9]{0,18})$/.test(candidate)) return null;
  return candidate.length < 19 ||
    (candidate.length === 19 && candidate <= BIGINT_MAX)
    ? candidate
    : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function safeConflict(error: unknown): string | null {
  const value = record(error);
  if (value?.code !== "40001" || typeof value.message !== "string") return null;
  return SAFE_CODES.has(value.message) ? value.message : "provisioning_conflict";
}

function decodeReceipt(value: unknown): StudentPortalProvisioningReceipt | null {
  const data = record(value);
  const receiptId = uuid(data?.receipt_id);
  const requestId = uuid(data?.request_id);
  const studentCaseId = uuid(data?.student_case_id);
  const receiptVersion = version(data?.receipt_version);
  const inviteGeneration = version(data?.invite_generation);
  const caseShapes = new Set(["normal_u6", "legacy_pending"]);
  const states = new Set([
    "prepared",
    "dispatching",
    "invite_succeeded",
    "invite_failed",
    "invite_outcome_unknown",
    "authority_activated",
  ]);
  const deliveryStates = new Set([
    "issued",
    "expired",
    "reissue_dispatching",
    "reissue_failed",
    "reissue_unknown",
    "accepted",
  ]);
  const activeAttemptId =
    data?.active_attempt_id === undefined || data.active_attempt_id === null
      ? null
      : uuid(data.active_attempt_id);
  const authUserId =
    data?.auth_user_id === undefined || data.auth_user_id === null
      ? null
      : uuid(data.auth_user_id);
  const inviteExpiresAt =
    data?.invite_expires_at === undefined || data.invite_expires_at === null
      ? null
      : timestamp(data.invite_expires_at);
  if (
    !data ||
    !receiptId ||
    !requestId ||
    !studentCaseId ||
    !receiptVersion ||
    !inviteGeneration ||
    typeof data.case_shape !== "string" ||
    !caseShapes.has(data.case_shape) ||
    typeof data.provisioning_state !== "string" ||
    !states.has(data.provisioning_state) ||
    (data.invite_delivery_status !== undefined &&
      data.invite_delivery_status !== null &&
      (typeof data.invite_delivery_status !== "string" ||
        !deliveryStates.has(data.invite_delivery_status))) ||
    (data.active_attempt_id !== undefined &&
      data.active_attempt_id !== null &&
      activeAttemptId === null) ||
    (data.auth_user_id !== undefined &&
      data.auth_user_id !== null &&
      authUserId === null) ||
    (data.invite_expires_at !== undefined &&
      data.invite_expires_at !== null &&
      inviteExpiresAt === null) ||
    typeof data.authority_activated !== "boolean" ||
    typeof data.replayed !== "boolean"
  ) {
    return null;
  }
  return {
    receiptId,
    requestId,
    studentCaseId,
    caseShape: data.case_shape as StudentPortalProvisioningReceipt["caseShape"],
    provisioningState:
      data.provisioning_state as StudentPortalProvisioningReceipt["provisioningState"],
    inviteDeliveryStatus:
      (data.invite_delivery_status as StudentPortalProvisioningReceipt["inviteDeliveryStatus"]) ??
      null,
    receiptVersion,
    inviteGeneration,
    activeAttemptId,
    authUserId,
    inviteExpiresAt,
    authorityActivated: data.authority_activated,
    replayed: data.replayed,
  };
}

async function rpc(
  client: RpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<StudentPortalAdminStoreResult> {
  try {
    const response = await client.schema("platform").rpc(name, args);
    if (response.error) {
      const code = safeConflict(response.error);
      return code ? { status: "blocked", code } : { status: "unavailable" };
    }
    const receipt = decodeReceipt(response.data);
    return receipt
      ? { status: "prepared", receipt }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export function createStudentPortalProvisioningAdminStore(client: RpcClient) {
  return Object.freeze({
    prepare(input: PrepareStudentPortalProvisioningInput) {
      return rpc(client, "prepare_student_portal_provisioning", {
        p_organization_id: input.organizationId,
        p_student_case_id: input.studentCaseId,
        p_email: input.email,
        p_student_display_name: input.displayName,
        p_case_shape: input.caseShape,
        p_legacy_curator_membership_id: input.legacyCuratorMembershipId,
        p_reason: input.reason,
        p_request_id: input.requestId,
      });
    },
    authorizeReissue(input: AuthorizeStudentPortalReissueInput) {
      return rpc(client, "authorize_student_portal_invite_reissue", {
        p_receipt_id: input.receiptId,
        p_expected_receipt_version: input.expectedReceiptVersion,
        p_expected_invite_generation: input.expectedInviteGeneration,
        p_reissue_request_id: input.reissueRequestId,
        p_reason: input.reason,
      });
    },
  });
}
