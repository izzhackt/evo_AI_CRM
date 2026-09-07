"use server";

import { resolvePlatformActor } from "./platform-auth.ts";
import { exactActionStringFields } from "./server/action-form-fields.ts";
import {
  studentPortalAttemptId,
  studentPortalProvisioningRequestId,
  studentPortalReissueRequestId,
} from "./server/student-portal-command-ids.ts";
import { decodeStudentPortalAccessOperation } from "./server/student-portal-provisioning-form.ts";
import {
  createStudentPortalInviteCoordinatorDependencies,
  createStudentPortalInviteReconcilerDependencies,
} from "./server/student-portal-invite-runtime.ts";
import {
  coordinateStudentPortalInvite,
  type StudentPortalInviteCommand,
  type StudentPortalInviteOutcome,
} from "./server/student-portal-invite-coordinator.ts";
import { reconcileStudentPortalInvite } from "./server/student-portal-invite-reconciler.ts";
import {
  createStudentPortalProvisioningAdminStore,
  type StudentPortalProvisioningReceipt,
} from "./server/student-portal-provisioning-admin-store.ts";
import { createSupabaseServerClient } from "./supabase/server.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BIGINT_MAX = "9223372036854775807";

type BoundActionState = Readonly<{
  receiptId: string;
  receiptVersion: string;
  inviteGeneration: string;
  attemptId?: string;
  inviteKind?: "initial" | "reissue";
  reissueRequestId?: string;
}>;

export type StudentPortalAccessActionState =
  | null
  | Readonly<{
      status: "invalid" | "forbidden" | "unavailable" | "blocked";
      code?: string;
    }>
  | (Readonly<{
      status:
        | "portalActivated"
        | "inviteIssued"
        | "inviteFailed"
        | "reconciliationRequired"
        | "reissueAvailable"
        | "accountPending";
      code?: string;
    }> &
      BoundActionState);

function isUuid(value: string | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isVersion(value: string | undefined): value is string {
  if (!value || !/^(?:0|[1-9][0-9]{0,18})$/.test(value)) return false;
  return value.length < 19 || (value.length === 19 && value <= BIGINT_MAX);
}

function nextVersion(value: string): string | null {
  if (!isVersion(value) || value === BIGINT_MAX) return null;
  return (BigInt(value) + BigInt(1)).toString();
}

function boundedText(value: string | undefined, min: number, max: number) {
  if (value === undefined || value !== value.trim()) return null;
  return value.length >= min && value.length <= max ? value : null;
}

function normalizedEmail(value: string | undefined): string | null {
  if (value === undefined || value !== value.trim()) return null;
  const normalized = value.toLocaleLowerCase("en-US");
  const at = normalized.indexOf("@");
  return normalized.length >= 3 &&
    normalized.length <= 320 &&
    at > 0 &&
    at === normalized.lastIndexOf("@") &&
    at < normalized.length - 1 &&
    !/\s/.test(normalized)
    ? normalized
    : null;
}

async function requireAdminOrganization(
  organizationId?: string,
): Promise<"ok" | "forbidden" | "unavailable"> {
  const actor = await resolvePlatformActor();
  if (
    actor.status === "invalid" &&
    actor.reason === "staff_authority_unavailable"
  ) {
    return "unavailable";
  }
  return actor.status === "authenticated" &&
    actor.actor.authorityRole === "admin" &&
    actor.actor.organizationId === organizationId
    ? "ok"
    : "forbidden";
}

function boundReceipt(
  receipt: StudentPortalProvisioningReceipt,
): BoundActionState {
  return {
    receiptId: receipt.receiptId,
    receiptVersion: receipt.receiptVersion,
    inviteGeneration: receipt.inviteGeneration,
  };
}

function outcomeState(
  outcome: StudentPortalInviteOutcome,
  inviteKind: "initial" | "reissue",
  reissueRequestId?: string,
): StudentPortalAccessActionState {
  if (outcome.status === "blocked" || outcome.status === "unavailable") {
    return { status: outcome.status, code: outcome.code };
  }
  const binding = {
    receiptId: outcome.receiptId,
    receiptVersion: outcome.receiptVersion,
    inviteGeneration: outcome.inviteGeneration,
    attemptId: outcome.attemptId,
    inviteKind,
    ...(reissueRequestId ? { reissueRequestId } : {}),
  };
  if (outcome.status === "portal_activated") {
    return { status: "portalActivated", ...binding };
  }
  if (outcome.status === "invite_issued") {
    return { status: "inviteIssued", ...binding };
  }
  if (outcome.status === "invite_failed") {
    return { status: "inviteFailed", code: outcome.code, ...binding };
  }
  return {
    status: "reconciliationRequired",
    code: outcome.code,
    ...binding,
  };
}

async function dispatchInitial(
  receipt: StudentPortalProvisioningReceipt,
): Promise<StudentPortalAccessActionState> {
  const finalizationReplay =
    receipt.provisioningState === "invite_succeeded" &&
    !receipt.authorityActivated;
  const targetGeneration = finalizationReplay
    ? receipt.inviteGeneration
    : nextVersion(receipt.inviteGeneration);
  if (!targetGeneration) return { status: "unavailable" };
  const outcome = await coordinateStudentPortalInvite(
    {
      kind: "initial",
      receiptId: receipt.receiptId,
      attemptId: studentPortalAttemptId(
        receipt.receiptId,
        "initial",
        targetGeneration,
      ),
      expectedReceiptVersion: receipt.receiptVersion,
      expectedInviteGeneration: receipt.inviteGeneration,
    },
    createStudentPortalInviteCoordinatorDependencies(),
  );
  return outcomeState(outcome, "initial");
}

async function dispatchReissue(
  receipt: StudentPortalProvisioningReceipt,
): Promise<StudentPortalAccessActionState> {
  const targetGeneration = nextVersion(receipt.inviteGeneration);
  if (!targetGeneration || !receipt.reissueRequestId) {
    return { status: "unavailable" };
  }
  const outcome = await coordinateStudentPortalInvite(
    {
      kind: "reissue",
      receiptId: receipt.receiptId,
      attemptId: studentPortalAttemptId(
        receipt.receiptId,
        "reissue",
        targetGeneration,
      ),
      reissueRequestId: receipt.reissueRequestId,
      expectedReceiptVersion: receipt.receiptVersion,
      expectedInviteGeneration: receipt.inviteGeneration,
    },
    createStudentPortalInviteCoordinatorDependencies(),
  );
  return outcomeState(outcome, "reissue", receipt.reissueRequestId);
}

function existingReceiptState(
  receipt: StudentPortalProvisioningReceipt,
): StudentPortalAccessActionState | "dispatch_initial" | "dispatch_reissue" {
  const binding = boundReceipt(receipt);
  if (
    receipt.provisioningState === "invite_succeeded" &&
    !receipt.authorityActivated
  ) {
    return "dispatch_initial";
  }
  if (receipt.inviteDeliveryStatus === "accepted") {
    return {
      status: receipt.authorityActivated ? "portalActivated" : "accountPending",
      ...binding,
    };
  }
  if (receipt.provisioningState === "prepared" || receipt.provisioningState === "invite_failed") {
    return "dispatch_initial";
  }
  if (receipt.inviteDeliveryStatus === "reissue_failed") {
    return {
      status: "inviteFailed",
      code: "portal_reissue_failed",
      ...binding,
    };
  }
  if (receipt.inviteDeliveryStatus === "expired") {
    return receipt.reissueRequestId
      ? "dispatch_reissue"
      : { status: "reissueAvailable", ...binding };
  }
  if (receipt.inviteDeliveryStatus === "issued") {
    const expired =
      receipt.inviteExpiresAt !== null &&
      Date.parse(receipt.inviteExpiresAt) <= Date.now();
    return {
      status: expired ? "reissueAvailable" : "inviteIssued",
      ...binding,
    };
  }
  if (
    receipt.provisioningState === "dispatching" ||
    receipt.provisioningState === "invite_outcome_unknown" ||
    receipt.inviteDeliveryStatus === "reissue_dispatching" ||
    receipt.inviteDeliveryStatus === "reissue_unknown"
  ) {
    const inviteKind =
      receipt.inviteDeliveryStatus === "reissue_dispatching" ||
      receipt.inviteDeliveryStatus === "reissue_unknown"
        ? "reissue"
        : "initial";
    if (inviteKind === "reissue" && !receipt.reissueRequestId) {
      return { status: "unavailable" };
    }
    const attemptId =
      receipt.activeAttemptId ??
      studentPortalAttemptId(
        receipt.receiptId,
        inviteKind,
        receipt.inviteGeneration,
      );
    return {
      status: "reconciliationRequired",
      code: "portal_reconciliation_required",
      ...binding,
      attemptId,
      inviteKind,
      ...(receipt.reissueRequestId
        ? { reissueRequestId: receipt.reissueRequestId }
        : {}),
    };
  }
  if (receipt.authorityActivated) {
    return { status: "portalActivated", ...binding };
  }
  return { status: "blocked", code: "portal_authority_not_ready" };
}

async function prepareStudentPortalAccess(
  form: FormData,
): Promise<StudentPortalAccessActionState> {
  const fields = exactActionStringFields(form, [
    "organization_id",
    "student_case_id",
    "email",
    "display_name",
    "case_shape",
    "legacy_curator_membership_id",
    "reason",
    "request_id",
  ]);
  if (!fields) return { status: "invalid" };
  const organizationId = fields.get("organization_id");
  const studentCaseId = fields.get("student_case_id");
  const email = normalizedEmail(fields.get("email"));
  const displayName = boundedText(fields.get("display_name"), 1, 200);
  const reason = boundedText(fields.get("reason"), 1, 1000);
  const requestId = fields.get("request_id");
  const caseShape = fields.get("case_shape");
  const curator = fields.get("legacy_curator_membership_id");
  const legacyCuratorMembershipId = curator === "" ? null : curator;
  if (
    !isUuid(organizationId) ||
    !isUuid(studentCaseId) ||
    !isUuid(requestId) ||
    requestId !== studentPortalProvisioningRequestId(organizationId, studentCaseId) ||
    !email ||
    !displayName ||
    !reason ||
    (caseShape !== "normal_u6" && caseShape !== "legacy_pending") ||
    (caseShape === "normal_u6" && legacyCuratorMembershipId !== null) ||
    (caseShape === "legacy_pending" && !isUuid(legacyCuratorMembershipId ?? undefined))
  ) {
    return { status: "invalid" };
  }
  const access = await requireAdminOrganization(organizationId);
  if (access !== "ok") return { status: access };

  const adminClient = await createSupabaseServerClient();
  const prepared = await createStudentPortalProvisioningAdminStore(
    adminClient,
  ).prepare({
    organizationId,
    studentCaseId,
    email,
    displayName,
    caseShape,
    legacyCuratorMembershipId: legacyCuratorMembershipId ?? null,
    reason,
    requestId,
  });
  if (prepared.status !== "prepared") return prepared;
  const state = existingReceiptState(prepared.receipt);
  if (state === "dispatch_initial") return dispatchInitial(prepared.receipt);
  if (state === "dispatch_reissue") return dispatchReissue(prepared.receipt);
  return state;
}

async function authorizeStudentPortalReissue(
  form: FormData,
): Promise<StudentPortalAccessActionState> {
  const fields = exactActionStringFields(form, [
    "organization_id",
    "receipt_id",
    "receipt_version",
    "invite_generation",
    "reason",
  ]);
  if (!fields) return { status: "invalid" };
  const organizationId = fields.get("organization_id");
  const receiptId = fields.get("receipt_id");
  const receiptVersion = fields.get("receipt_version");
  const inviteGeneration = fields.get("invite_generation");
  const reason = boundedText(fields.get("reason"), 1, 1000);
  if (
    !isUuid(organizationId) ||
    !isUuid(receiptId) ||
    !isVersion(receiptVersion) ||
    !isVersion(inviteGeneration) ||
    !reason
  ) {
    return { status: "invalid" };
  }
  const access = await requireAdminOrganization(organizationId);
  if (access !== "ok") return { status: access };
  const reissueRequestId = studentPortalReissueRequestId(
    receiptId,
    inviteGeneration,
  );
  const adminClient = await createSupabaseServerClient();
  const authorized = await createStudentPortalProvisioningAdminStore(
    adminClient,
  ).authorizeReissue({
    receiptId,
    expectedReceiptVersion: receiptVersion,
    expectedInviteGeneration: inviteGeneration,
    reissueRequestId,
    reason,
  });
  if (authorized.status !== "prepared") return authorized;
  if (authorized.receipt.reissueRequestId !== reissueRequestId) {
    return { status: "unavailable" };
  }
  return dispatchReissue(authorized.receipt);
}

async function reconcileStudentPortalAccess(
  form: FormData,
): Promise<StudentPortalAccessActionState> {
  const fields = exactActionStringFields(form, [
    "organization_id",
    "student_case_id",
    "email",
    "display_name",
    "case_shape",
    "legacy_curator_membership_id",
    "request_id",
    "receipt_id",
    "receipt_version",
    "invite_generation",
    "attempt_id",
    "invite_kind",
    "reissue_request_id",
  ]);
  if (!fields) return { status: "invalid" };
  const organizationId = fields.get("organization_id");
  const studentCaseId = fields.get("student_case_id");
  const email = normalizedEmail(fields.get("email"));
  const displayName = boundedText(fields.get("display_name"), 1, 200);
  const caseShape = fields.get("case_shape");
  const curator = fields.get("legacy_curator_membership_id");
  const legacyCuratorMembershipId = curator === "" ? null : curator;
  const requestId = fields.get("request_id");
  const receiptId = fields.get("receipt_id");
  const receiptVersion = fields.get("receipt_version");
  const inviteGeneration = fields.get("invite_generation");
  const attemptId = fields.get("attempt_id");
  const inviteKind = fields.get("invite_kind");
  const reissueRequestId = fields.get("reissue_request_id");
  if (
    !isUuid(organizationId) ||
    !isUuid(studentCaseId) ||
    !email ||
    !displayName ||
    !isUuid(requestId) ||
    requestId !== studentPortalProvisioningRequestId(organizationId, studentCaseId) ||
    (caseShape !== "normal_u6" && caseShape !== "legacy_pending") ||
    (caseShape === "normal_u6" && legacyCuratorMembershipId !== null) ||
    (caseShape === "legacy_pending" &&
      !isUuid(legacyCuratorMembershipId ?? undefined)) ||
    !isUuid(receiptId) ||
    !isVersion(receiptVersion) ||
    !isVersion(inviteGeneration) ||
    !isUuid(attemptId) ||
    (inviteKind !== "initial" && inviteKind !== "reissue") ||
    (inviteKind === "initial" && reissueRequestId !== "") ||
    (inviteKind === "reissue" && !isUuid(reissueRequestId))
  ) {
    return { status: "invalid" };
  }
  const access = await requireAdminOrganization(organizationId);
  if (access !== "ok") return { status: access };
  const adminClient = await createSupabaseServerClient();
  const adminReplay = await createStudentPortalProvisioningAdminStore(
    adminClient,
  ).prepare({
    organizationId,
    studentCaseId,
    email,
    displayName,
    caseShape,
    legacyCuratorMembershipId: legacyCuratorMembershipId ?? null,
    reason: "Reconcile student portal invitation outcome",
    requestId,
  });
  if (adminReplay.status !== "prepared") return adminReplay;
  const authorizedState = existingReceiptState(adminReplay.receipt);
  if (
    adminReplay.receipt.receiptId !== receiptId ||
    adminReplay.receipt.receiptVersion !== receiptVersion ||
    adminReplay.receipt.inviteGeneration !== inviteGeneration ||
    typeof authorizedState === "string" ||
    authorizedState === null ||
    authorizedState.status !== "reconciliationRequired" ||
    !("attemptId" in authorizedState) ||
    authorizedState.attemptId !== attemptId ||
    authorizedState.inviteKind !== inviteKind ||
    (inviteKind === "reissue" &&
      authorizedState.reissueRequestId !== reissueRequestId)
  ) {
    return { status: "blocked", code: "stale_invite_attempt" };
  }
  const common = {
    receiptId,
    attemptId,
    expectedReceiptVersion: receiptVersion,
    expectedInviteGeneration: inviteGeneration,
  };
  let command: StudentPortalInviteCommand;
  if (inviteKind === "initial") {
    command = { kind: "initial", ...common };
  } else {
    if (!isUuid(reissueRequestId)) return { status: "invalid" };
    command = { kind: "reissue", reissueRequestId, ...common };
  }
  const outcome = await reconcileStudentPortalInvite(
    command,
    createStudentPortalInviteReconcilerDependencies(),
  );
  return outcomeState(
    outcome,
    inviteKind,
    inviteKind === "reissue" ? reissueRequestId : undefined,
  );
}

async function safeAction(
  operation: () => Promise<StudentPortalAccessActionState>,
): Promise<StudentPortalAccessActionState> {
  try {
    return await operation();
  } catch {
    return { status: "unavailable" };
  }
}

export async function prepareStudentPortalAccessAction(
  _previousState: StudentPortalAccessActionState,
  form: FormData,
): Promise<StudentPortalAccessActionState> {
  return safeAction(() => prepareStudentPortalAccess(form));
}

export async function authorizeStudentPortalReissueAction(
  _previousState: StudentPortalAccessActionState,
  form: FormData,
): Promise<StudentPortalAccessActionState> {
  return safeAction(() => authorizeStudentPortalReissue(form));
}

export async function reconcileStudentPortalInviteAction(
  _previousState: StudentPortalAccessActionState,
  form: FormData,
): Promise<StudentPortalAccessActionState> {
  return safeAction(() => reconcileStudentPortalAccess(form));
}

export async function manageStudentPortalAccessAction(
  _previousState: StudentPortalAccessActionState,
  form: FormData,
): Promise<StudentPortalAccessActionState> {
  const decoded = decodeStudentPortalAccessOperation(form);
  if (!decoded) return { status: "invalid" };
  if (decoded.operation === "prepare") {
    return safeAction(() => prepareStudentPortalAccess(decoded.commandForm));
  }
  if (decoded.operation === "reissue") {
    return safeAction(() => authorizeStudentPortalReissue(decoded.commandForm));
  }
  return safeAction(() => reconcileStudentPortalAccess(decoded.commandForm));
}
