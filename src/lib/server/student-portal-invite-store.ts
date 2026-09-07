import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  StudentPortalAuthorityFinalizeResult,
  StudentPortalInviteClaim,
  StudentPortalInviteClaimResult,
  StudentPortalInviteCommand,
  StudentPortalInviteMutationResult,
  StudentPortalInviteStore,
  StudentPortalInviteSuccessRecordInput,
  StudentPortalInviteTerminalRecordInput,
} from "./student-portal-invite-coordinator.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CONFLICT_CODES = new Set([
  "request_replay_conflict",
  "portal_case_already_reserved",
  "portal_case_already_bound",
  "portal_email_already_reserved",
  "portal_case_invalid_shape",
  "portal_curator_required",
  "portal_identity_conflict",
  "stale_receipt_version",
  "stale_invite_generation",
  "stale_invite_attempt",
  "invite_reissue_in_progress",
  "portal_invite_not_expired",
  "portal_invite_already_accepted",
  "portal_reconciliation_required",
  "portal_invite_no_issuance_unproven",
  "portal_admin_authority_changed",
  "portal_authority_not_ready",
]);

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Pick<SupabaseClient, "schema">;

export type StudentPortalInviteIdentityInput = Readonly<{
  authUserId: string;
  normalizedEmail: string;
  markAccepted: boolean;
}>;

export type StudentPortalInviteIdentityMatch = Readonly<{
  status: "matched";
  receiptId: string;
  receiptVersion: string;
  inviteGeneration: string;
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
  accountPending: boolean;
  authorityActivated: boolean;
}>;

export type StudentPortalInviteIdentityResult =
  | StudentPortalInviteIdentityMatch
  | Readonly<{ status: "mismatch" | "unavailable" }>;

export type StudentPortalInviteReconciliationClaim = Readonly<{
  kind: "initial" | "reissue";
  lifecycle: "dispatching" | "unknown";
  receiptId: string;
  attemptId: string;
  receiptVersion: string;
  inviteGeneration: string;
  normalizedEmail: string;
  authUserId: string | null;
  reissueRequestId: string | null;
}>;

export type StudentPortalInviteReconciliationClaimResult =
  | Readonly<{
      status: "recovered";
      claim: StudentPortalInviteReconciliationClaim;
    }>
  | Readonly<{ status: "blocked"; code: string }>
  | Readonly<{ status: "unavailable" }>;

export type StudentPortalInviteReconciliationResult =
  | Readonly<{
      status: "recorded";
      receiptVersion: string;
      inviteGeneration: string;
      inviteDeliveryStatus: "issued" | "accepted";
      authorityActivated: boolean;
    }>
  | Readonly<{ status: "conflict"; code: string }>
  | Readonly<{ status: "unavailable" }>;

export type StudentPortalInviteStoreWithIdentity = StudentPortalInviteStore &
  Readonly<{
    resolveIdentity: (
      input: StudentPortalInviteIdentityInput,
    ) => Promise<StudentPortalInviteIdentityResult>;
    recoverReconciliationClaim: (
      command: StudentPortalInviteCommand,
    ) => Promise<StudentPortalInviteReconciliationClaimResult>;
    reconcileObserved: (input: Readonly<{
      receiptId: string;
      attemptId: string;
      expectedReceiptVersion: string;
      expectedInviteGeneration: string;
      authUserId: string;
      otpExpirySeconds: number;
    }>) => Promise<StudentPortalInviteReconciliationResult>;
  }>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function version(value: unknown): string | null {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return String(value);
  }
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,18})$/.test(value)) {
    return null;
  }
  return value.length < 19 ||
    (value.length === 19 && value <= "9223372036854775807")
    ? value
    : null;
}

function errorField(error: unknown, key: "code" | "message"): string | null {
  const value = record(error)?.[key];
  return typeof value === "string" ? value : null;
}

function conflictCode(error: unknown): string | null {
  if (errorField(error, "code") !== "40001") return null;
  const message = errorField(error, "message");
  return message && SAFE_CONFLICT_CODES.has(message)
    ? message
    : "stale_invite_attempt";
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === value &&
    normalized.length >= 3 &&
    normalized.length <= 320 &&
    normalized.includes("@") &&
    !/\s/.test(normalized)
    ? normalized
    : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function replayOutcome(data: Record<string, unknown>): StudentPortalInviteClaimResult {
  const attemptId = isUuid(data.attempt_id) ? data.attempt_id : null;
  const receiptVersion = version(data.receipt_version);
  const inviteGeneration = version(data.invite_generation);
  if (!isUuid(data.receipt_id) || !attemptId || !receiptVersion || !inviteGeneration) {
    return { status: "unavailable" };
  }
  const binding = {
    receiptId: data.receipt_id,
    attemptId,
    receiptVersion,
    inviteGeneration,
  };
  if (
    data.provisioning_state === "invite_outcome_unknown" ||
    data.invite_delivery_status === "reissue_unknown" ||
    data.provisioning_state === "dispatching"
  ) {
    return { status: "blocked", code: "portal_reconciliation_required" };
  }
  if (data.invite_delivery_status === "reissue_dispatching") {
    return { status: "blocked", code: "invite_reissue_in_progress" };
  }
  if (data.invite_delivery_status === "issued") {
    return {
      status: "replay",
      outcome: { status: "invite_issued", ...binding },
    };
  }
  if (
    data.provisioning_state === "authority_activated" &&
    data.invite_delivery_status === "accepted"
  ) {
    return {
      status: "replay",
      outcome: { status: "portal_activated", ...binding },
    };
  }
  if (data.invite_delivery_status === "accepted") {
    return {
      status: "replay",
      outcome: { status: "invite_issued", ...binding },
    };
  }
  if (data.provisioning_state === "authority_activated") {
    return {
      status: "replay",
      outcome: { status: "portal_activated", ...binding },
    };
  }
  return { status: "blocked", code: "portal_authority_not_ready" };
}

function decodeClaim(
  command: StudentPortalInviteCommand,
  response: RpcResponse,
): StudentPortalInviteClaimResult {
  if (response.error) {
    const code = conflictCode(response.error);
    return code ? { status: "blocked", code } : { status: "unavailable" };
  }
  const data = record(response.data);
  if (!data || !isUuid(data.receipt_id) || !isUuid(data.attempt_id)) {
    return { status: "unavailable" };
  }
  if (data.replayed === true) return replayOutcome(data);

  const receiptVersion = version(data.receipt_version);
  const inviteGeneration = version(data.invite_generation);
  const email = normalizedEmail(data.normalized_email);
  const preConfirmationSentAt = data.pre_confirmation_sent_at === null
    ? null
    : timestamp(data.pre_confirmation_sent_at);
  if (
    data.replayed !== false ||
    data.provider_dispatch_allowed !== true ||
    data.receipt_id !== command.receiptId ||
    data.attempt_id !== command.attemptId ||
    receiptVersion === null ||
    inviteGeneration === null ||
    email === null ||
    (data.pre_confirmation_sent_at !== null && preConfirmationSentAt === null)
  ) {
    return { status: "unavailable" };
  }

  let claim: StudentPortalInviteClaim;
  if (command.kind === "initial") {
    claim = {
      receiptId: data.receipt_id,
      attemptId: data.attempt_id,
      receiptVersion,
      inviteGeneration,
      normalizedEmail: email,
      authUserId: null,
      preAttemptConfirmationSentAt: preConfirmationSentAt,
    };
  } else {
    if (!isUuid(data.auth_user_id) || preConfirmationSentAt === null) {
      return { status: "unavailable" };
    }
    claim = {
      receiptId: data.receipt_id,
      attemptId: data.attempt_id,
      receiptVersion,
      inviteGeneration,
      normalizedEmail: email,
      authUserId: data.auth_user_id,
      preAttemptConfirmationSentAt: preConfirmationSentAt,
    };
  }
  return { status: "claimed", claim };
}

function decodeMutation(response: RpcResponse): StudentPortalInviteMutationResult {
  if (response.error) {
    const code = conflictCode(response.error);
    return code ? { status: "conflict", code } : { status: "unavailable" };
  }
  const data = record(response.data);
  const receiptVersion = version(data?.receipt_version);
  const inviteGeneration = version(data?.invite_generation);
  return receiptVersion !== null && inviteGeneration !== null
    ? { status: "recorded", receiptVersion, inviteGeneration }
    : { status: "unavailable" };
}

function decodeReconciliationClaim(
  command: StudentPortalInviteCommand,
  response: RpcResponse,
): StudentPortalInviteReconciliationClaimResult {
  if (response.error) {
    const code = conflictCode(response.error);
    return code ? { status: "blocked", code } : { status: "unavailable" };
  }
  const data = record(response.data);
  const receiptVersion = version(data?.receipt_version);
  const inviteGeneration = version(data?.invite_generation);
  const email = normalizedEmail(data?.normalized_email);
  const authUserId = data?.auth_user_id == null ? null : data.auth_user_id;
  const reissueRequestId =
    data?.reissue_request_id == null ? null : data.reissue_request_id;
  const activeAttemptId =
    data?.active_attempt_id == null ? null : data.active_attempt_id;
  const lifecycle = command.kind === "initial"
    ? data?.provisioning_state === "dispatching"
      ? "dispatching"
      : data?.provisioning_state === "invite_outcome_unknown"
        ? "unknown"
        : null
    : data?.invite_delivery_status === "reissue_dispatching"
      ? "dispatching"
      : data?.invite_delivery_status === "reissue_unknown"
        ? "unknown"
        : null;
  if (
    !data ||
    data.replayed !== true ||
    data.receipt_id !== command.receiptId ||
    data.attempt_id !== command.attemptId ||
    receiptVersion !== command.expectedReceiptVersion ||
    inviteGeneration !== command.expectedInviteGeneration ||
    email === null ||
    lifecycle === null ||
    (activeAttemptId !== null && !isUuid(activeAttemptId)) ||
    (lifecycle === "dispatching" && activeAttemptId !== command.attemptId) ||
    (lifecycle === "unknown" && activeAttemptId !== null) ||
    (authUserId !== null && !isUuid(authUserId)) ||
    (reissueRequestId !== null && !isUuid(reissueRequestId)) ||
    (command.kind === "reissue" &&
      (reissueRequestId !== command.reissueRequestId || authUserId === null))
  ) {
    return { status: "unavailable" };
  }
  return {
    status: "recovered",
    claim: {
      kind: command.kind,
      lifecycle,
      receiptId: command.receiptId,
      attemptId: command.attemptId,
      receiptVersion,
      inviteGeneration,
      normalizedEmail: email,
      authUserId,
      reissueRequestId,
    },
  };
}

function decodeReconciliation(
  attemptId: string,
  response: RpcResponse,
): StudentPortalInviteReconciliationResult {
  if (response.error) {
    const code = conflictCode(response.error);
    return code ? { status: "conflict", code } : { status: "unavailable" };
  }
  const data = record(response.data);
  const receiptVersion = version(data?.receipt_version);
  const inviteGeneration = version(data?.invite_generation);
  if (
    !data ||
    data.reconciled !== true ||
    data.attempt_id !== attemptId ||
    receiptVersion === null ||
    inviteGeneration === null ||
    (data.invite_delivery_status !== "issued" &&
      data.invite_delivery_status !== "accepted") ||
    typeof data.authority_activated !== "boolean"
  ) {
    return { status: "unavailable" };
  }
  return {
    status: "recorded",
    receiptVersion,
    inviteGeneration,
    inviteDeliveryStatus: data.invite_delivery_status,
    authorityActivated: data.authority_activated,
  };
}

async function rpc(
  client: RpcClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<RpcResponse> {
  try {
    return await client.schema("platform").rpc(functionName, args);
  } catch {
    return { data: null, error: { code: "rpc_unavailable" } };
  }
}

function recordArgs(
  input: StudentPortalInviteSuccessRecordInput | StudentPortalInviteTerminalRecordInput,
) {
  return {
    p_receipt_id: input.receiptId,
    p_attempt_id: input.attemptId,
    p_expected_receipt_version: input.expectedReceiptVersion,
    p_expected_invite_generation: input.expectedInviteGeneration,
  };
}

export function createStudentPortalInviteStore(
  client: RpcClient,
): StudentPortalInviteStoreWithIdentity {
  return Object.freeze({
    async claimInitial(command) {
      return decodeClaim(
        command,
        await rpc(client, "claim_student_portal_invite", {
          p_receipt_id: command.receiptId,
          p_attempt_id: command.attemptId,
          p_expected_receipt_version: command.expectedReceiptVersion,
          p_expected_invite_generation: command.expectedInviteGeneration,
        }),
      );
    },

    async claimReissue(command) {
      return decodeClaim(
        command,
        await rpc(client, "claim_student_portal_invite_reissue", {
          p_receipt_id: command.receiptId,
          p_reissue_request_id: command.reissueRequestId,
          p_attempt_id: command.attemptId,
          p_expected_receipt_version: command.expectedReceiptVersion,
          p_expected_invite_generation: command.expectedInviteGeneration,
        }),
      );
    },

    async recordSuccess(input) {
      return decodeMutation(
        await rpc(client, "record_student_portal_invite_success", {
          ...recordArgs(input),
          p_auth_user_id: input.authUserId,
          p_email_otp_expires_in_seconds: input.otpExpirySeconds,
        }),
      );
    },

    async recordFailure(input) {
      return decodeMutation(
        await rpc(client, "record_student_portal_invite_failure", {
          ...recordArgs(input),
          p_safe_error_code: input.code,
        }),
      );
    },

    async recordUnknown(input) {
      return decodeMutation(
        await rpc(client, "record_student_portal_invite_unknown", {
          ...recordArgs(input),
          p_safe_error_code: input.code,
        }),
      );
    },

    async recoverReconciliationClaim(command) {
      const response = command.kind === "initial"
        ? await rpc(client, "claim_student_portal_invite", {
            p_receipt_id: command.receiptId,
            p_attempt_id: command.attemptId,
            p_expected_receipt_version: command.expectedReceiptVersion,
            p_expected_invite_generation: command.expectedInviteGeneration,
          })
        : await rpc(client, "claim_student_portal_invite_reissue", {
            p_receipt_id: command.receiptId,
            p_reissue_request_id: command.reissueRequestId,
            p_attempt_id: command.attemptId,
            p_expected_receipt_version: command.expectedReceiptVersion,
            p_expected_invite_generation: command.expectedInviteGeneration,
          });
      return decodeReconciliationClaim(command, response);
    },

    async reconcileObserved(input) {
      return decodeReconciliation(
        input.attemptId,
        await rpc(client, "reconcile_student_portal_invite", {
          p_receipt_id: input.receiptId,
          p_attempt_id: input.attemptId,
          p_expected_receipt_version: input.expectedReceiptVersion,
          p_expected_invite_generation: input.expectedInviteGeneration,
          p_auth_user_id: input.authUserId,
          p_email_otp_expires_in_seconds: input.otpExpirySeconds,
          p_provider_no_issuance_proven: false,
          p_provider_operation_upper_bound_at: null,
          p_safe_error_code: "provider_issuance_observed",
        }),
      );
    },

    async finalizeAuthority(input): Promise<StudentPortalAuthorityFinalizeResult> {
      const response = await rpc(client, "finalize_student_portal_authority", {
        p_receipt_id: input.receiptId,
        p_expected_receipt_version: input.expectedReceiptVersion,
        p_expected_invite_generation: input.expectedInviteGeneration,
      });
      if (response.error) {
        const code = conflictCode(response.error);
        return code
          ? { status: "conflict", code }
          : { status: "unavailable" };
      }
      const data = record(response.data);
      const receiptVersion = version(data?.receipt_version);
      const inviteGeneration = version(data?.invite_generation);
      if (!data || receiptVersion === null || inviteGeneration === null) {
        return { status: "unavailable" };
      }
      return {
        status: data.authority_activated === true ? "activated" : "pending",
        receiptVersion,
        inviteGeneration,
      };
    },

    async resolveIdentity(input): Promise<StudentPortalInviteIdentityResult> {
      const response = await rpc(
        client,
        "resolve_student_portal_invite_identity",
        {
          p_auth_user_id: input.authUserId,
          p_email: input.normalizedEmail,
          p_mark_accepted: input.markAccepted,
        },
      );
      if (response.error) {
        const code = conflictCode(response.error);
        return code === "portal_identity_conflict" ||
          code === "portal_authority_not_ready"
          ? { status: "mismatch" }
          : { status: "unavailable" };
      }

      const data = record(response.data);
      const receiptVersion = version(data?.receipt_version);
      const inviteGeneration = version(data?.invite_generation);
      const provisioningStates = new Set([
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
      if (
        !data ||
        !isUuid(data.receipt_id) ||
        receiptVersion === null ||
        inviteGeneration === null ||
        typeof data.provisioning_state !== "string" ||
        !provisioningStates.has(data.provisioning_state) ||
        (data.invite_delivery_status !== undefined &&
          data.invite_delivery_status !== null &&
          (typeof data.invite_delivery_status !== "string" ||
            !deliveryStates.has(data.invite_delivery_status))) ||
        typeof data.account_pending !== "boolean" ||
        typeof data.authority_activated !== "boolean"
      ) {
        return { status: "unavailable" };
      }
      return {
        status: "matched",
        receiptId: data.receipt_id,
        receiptVersion,
        inviteGeneration,
        provisioningState:
          data.provisioning_state as StudentPortalInviteIdentityMatch["provisioningState"],
        inviteDeliveryStatus:
          (data.invite_delivery_status as StudentPortalInviteIdentityMatch["inviteDeliveryStatus"]) ??
          null,
        accountPending: data.account_pending,
        authorityActivated: data.authority_activated,
      };
    },
  });
}
