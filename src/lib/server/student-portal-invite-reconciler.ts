import "server-only";

import type {
  StudentPortalAuthUserResult,
  StudentPortalInviteAuthProvider,
  StudentPortalInviteCommand,
  StudentPortalInviteOutcome,
} from "./student-portal-invite-coordinator.ts";
import type { StudentPortalInviteStoreWithIdentity } from "./student-portal-invite-store.ts";

export type StudentPortalInviteReconcilerDependencies = Readonly<{
  store: StudentPortalInviteStoreWithIdentity;
  auth: StudentPortalInviteAuthProvider;
  otpExpirySeconds: number;
}>;

function binding(
  command: StudentPortalInviteCommand,
  receiptVersion: string,
  inviteGeneration: string,
) {
  return {
    receiptId: command.receiptId,
    attemptId: command.attemptId,
    receiptVersion,
    inviteGeneration,
  };
}

async function readObservedUser(
  auth: StudentPortalInviteAuthProvider,
  authUserId: string | null,
  normalizedEmail: string,
): Promise<StudentPortalAuthUserResult> {
  try {
    return authUserId
      ? await auth.readUserById(authUserId)
      : await auth.findUserByExactEmail(normalizedEmail);
  } catch {
    return { status: "unavailable", user: null };
  }
}

/**
 * Reconciles one already-claimed attempt by provider readback only. It never
 * invokes the provider's invite method and never treats a missing user as
 * proof that no email was sent.
 */
export async function reconcileStudentPortalInvite(
  command: StudentPortalInviteCommand,
  dependencies: StudentPortalInviteReconcilerDependencies,
): Promise<StudentPortalInviteOutcome> {
  let recovered;
  try {
    recovered = await dependencies.store.recoverReconciliationClaim(command);
  } catch {
    return { status: "unavailable", code: "receipt_store_unavailable" };
  }
  if (recovered.status === "blocked") {
    return { status: "blocked", code: recovered.code };
  }
  if (recovered.status === "unavailable") {
    return { status: "unavailable", code: "receipt_store_unavailable" };
  }

  const claim = recovered.claim;
  let receiptVersion = claim.receiptVersion;
  let inviteGeneration = claim.inviteGeneration;
  if (claim.lifecycle === "dispatching") {
    const unknown = await dependencies.store.recordUnknown({
      receiptId: claim.receiptId,
      attemptId: claim.attemptId,
      expectedReceiptVersion: receiptVersion,
      expectedInviteGeneration: inviteGeneration,
      code: "manual_reconciliation_started",
    });
    if (unknown.status === "conflict") {
      return { status: "blocked", code: unknown.code };
    }
    if (
      unknown.status !== "recorded" ||
      !unknown.receiptVersion ||
      !unknown.inviteGeneration
    ) {
      return { status: "unavailable", code: "receipt_store_unavailable" };
    }
    receiptVersion = unknown.receiptVersion;
    inviteGeneration = unknown.inviteGeneration;
  }

  const observed = await readObservedUser(
    dependencies.auth,
    claim.authUserId,
    claim.normalizedEmail,
  );
  if (observed.status !== "found") {
    return observed.status === "unavailable"
      ? { status: "unavailable", code: "provider_read_unavailable" }
      : {
          status: "invite_outcome_unknown",
          code: "provider_issuance_not_observed",
          ...binding(command, receiptVersion, inviteGeneration),
        };
  }
  if (
    observed.user.email.trim().toLocaleLowerCase("en-US") !==
      claim.normalizedEmail ||
    (claim.authUserId !== null &&
      observed.user.authUserId !== claim.authUserId)
  ) {
    return { status: "blocked", code: "portal_identity_conflict" };
  }

  const reconciled = await dependencies.store.reconcileObserved({
    receiptId: claim.receiptId,
    attemptId: claim.attemptId,
    expectedReceiptVersion: receiptVersion,
    expectedInviteGeneration: inviteGeneration,
    authUserId: observed.user.authUserId,
    otpExpirySeconds: dependencies.otpExpirySeconds,
  });
  if (reconciled.status === "unavailable") {
    return { status: "unavailable", code: "receipt_store_unavailable" };
  }
  if (reconciled.status === "conflict") {
    return reconciled.code === "portal_invite_no_issuance_unproven"
      ? {
          status: "invite_outcome_unknown",
          code: reconciled.code,
          ...binding(command, receiptVersion, inviteGeneration),
        }
      : { status: "blocked", code: reconciled.code };
  }

  const reconciledBinding = binding(
    command,
    reconciled.receiptVersion,
    reconciled.inviteGeneration,
  );
  if (command.kind === "reissue") {
    return { status: "invite_issued", ...reconciledBinding };
  }
  if (reconciled.authorityActivated) {
    return { status: "portal_activated", ...reconciledBinding };
  }

  try {
    const finalized = await dependencies.store.finalizeAuthority({
      receiptId: command.receiptId,
      expectedReceiptVersion: reconciled.receiptVersion,
      expectedInviteGeneration: reconciled.inviteGeneration,
    });
    return finalized.status === "activated"
      ? {
          status: "portal_activated",
          ...binding(
            command,
            finalized.receiptVersion ?? reconciled.receiptVersion,
            finalized.inviteGeneration ?? reconciled.inviteGeneration,
          ),
        }
      : { status: "invite_issued", ...reconciledBinding };
  } catch {
    return { status: "invite_issued", ...reconciledBinding };
  }
}
