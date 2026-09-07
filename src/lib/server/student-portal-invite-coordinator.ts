import "server-only";

import { studentInviteCallbackUrl } from "../student-invite-callback-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/;
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const POSTGRES_BIGINT_MAX = "9223372036854775807";

export type StudentPortalInviteCommand =
  | Readonly<{
      kind: "initial";
      receiptId: string;
      attemptId: string;
      expectedReceiptVersion: string;
      expectedInviteGeneration: string;
    }>
  | Readonly<{
      kind: "reissue";
      receiptId: string;
      attemptId: string;
      reissueRequestId: string;
      expectedReceiptVersion: string;
      expectedInviteGeneration: string;
    }>;

export type StudentPortalInviteOutcomeBinding = Readonly<{
  receiptId: string;
  attemptId: string;
  receiptVersion: string;
  inviteGeneration: string;
}>;

export type StudentPortalInviteOutcome =
  | (Readonly<{ status: "portal_activated" }> &
      StudentPortalInviteOutcomeBinding)
  | (Readonly<{ status: "invite_issued" }> &
      StudentPortalInviteOutcomeBinding)
  | (Readonly<{
      status: "invite_failed" | "invite_outcome_unknown";
      code: string;
    }> &
      StudentPortalInviteOutcomeBinding)
  | Readonly<{ status: "blocked"; code: string }>
  | Readonly<{ status: "unavailable"; code: string }>;

export type StudentPortalInviteClaim = Readonly<{
  receiptId: string;
  attemptId: string;
  receiptVersion: string;
  inviteGeneration: string;
  normalizedEmail: string;
  authUserId: string | null;
  preAttemptConfirmationSentAt: string | null;
}>;

export type StudentPortalInviteClaimResult =
  | Readonly<{ status: "claimed"; claim: StudentPortalInviteClaim }>
  | Readonly<{ status: "replay"; outcome: StudentPortalInviteOutcome }>
  | Readonly<{ status: "blocked"; code: string }>
  | Readonly<{ status: "unavailable" }>;

export type StudentPortalInviteRecordInput = Readonly<{
  receiptId: string;
  attemptId: string;
  expectedReceiptVersion: string;
  expectedInviteGeneration: string;
}>;

export type StudentPortalInviteTerminalRecordInput =
  StudentPortalInviteRecordInput & Readonly<{ code: string }>;

export type StudentPortalInviteSuccessRecordInput =
  StudentPortalInviteRecordInput &
    Readonly<{ authUserId: string; otpExpirySeconds: number }>;

export type StudentPortalInviteMutationResult =
  | Readonly<{
      status: "recorded";
      receiptVersion?: string;
      inviteGeneration?: string;
    }>
  | Readonly<{ status: "conflict"; code: string }>
  | Readonly<{ status: "unavailable" }>;

export type StudentPortalAuthorityFinalizeResult = Readonly<{
  status: "activated" | "pending" | "conflict" | "unavailable";
  code?: string;
  receiptVersion?: string;
  inviteGeneration?: string;
}>;

export type StudentPortalInviteStore = Readonly<{
  claimInitial: (
    command: Extract<StudentPortalInviteCommand, { kind: "initial" }>,
  ) => Promise<StudentPortalInviteClaimResult>;
  claimReissue: (
    command: Extract<StudentPortalInviteCommand, { kind: "reissue" }>,
  ) => Promise<StudentPortalInviteClaimResult>;
  recordSuccess: (
    input: StudentPortalInviteSuccessRecordInput,
  ) => Promise<StudentPortalInviteMutationResult>;
  recordFailure: (
    input: StudentPortalInviteTerminalRecordInput,
  ) => Promise<StudentPortalInviteMutationResult>;
  recordUnknown: (
    input: StudentPortalInviteTerminalRecordInput,
  ) => Promise<StudentPortalInviteMutationResult>;
  finalizeAuthority: (
    input: Readonly<{
      receiptId: string;
      expectedReceiptVersion: string;
      expectedInviteGeneration: string;
    }>,
  ) => Promise<StudentPortalAuthorityFinalizeResult>;
}>;

export type StudentPortalAuthUser = Readonly<{
  authUserId: string;
  email: string;
  confirmedAt: string | null;
  confirmationSentAt: string | null;
}>;

export type StudentPortalAuthUserResult =
  | Readonly<{ status: "found"; user: StudentPortalAuthUser }>
  | Readonly<{ status: "missing" | "unavailable"; user: null }>;

export type StudentPortalProviderInviteResult =
  | Readonly<{ status: "success"; authUserId: string }>
  | Readonly<{ status: "definite_failure"; code: string }>
  | Readonly<{ status: "unknown"; code: string }>;

export type StudentPortalInviteAuthProvider = Readonly<{
  readUserById: (authUserId: string) => Promise<StudentPortalAuthUserResult>;
  findUserByExactEmail: (
    normalizedEmail: string,
  ) => Promise<StudentPortalAuthUserResult>;
  inviteUserByEmail: (input: Readonly<{
    email: string;
    redirectTo: string;
  }>) => Promise<StudentPortalProviderInviteResult>;
}>;

export type StudentPortalInviteCoordinatorDependencies = Readonly<{
  store: StudentPortalInviteStore;
  auth: StudentPortalInviteAuthProvider;
  otpExpirySeconds: number;
  nodeEnv: string | undefined;
}>;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isVersion(value: unknown): value is string {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) return false;
  return (
    value.length < POSTGRES_BIGINT_MAX.length ||
    (value.length === POSTGRES_BIGINT_MAX.length &&
      value <= POSTGRES_BIGINT_MAX)
  );
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === "string" && SAFE_CODE_PATTERN.test(value)
    ? value
    : fallback;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (
    normalized.length === 0 ||
    normalized.length > 320 ||
    at <= 0 ||
    at !== normalized.lastIndexOf("@") ||
    at === normalized.length - 1 ||
    /\s/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function validCommand(command: StudentPortalInviteCommand): boolean {
  return (
    isUuid(command.receiptId) &&
    isUuid(command.attemptId) &&
    isVersion(command.expectedReceiptVersion) &&
    isVersion(command.expectedInviteGeneration) &&
    (command.kind === "initial" || isUuid(command.reissueRequestId))
  );
}

function validClaim(
  command: StudentPortalInviteCommand,
  claim: StudentPortalInviteClaim,
): boolean {
  const normalizedEmail = normalizeEmail(claim.normalizedEmail);
  if (
    claim.receiptId !== command.receiptId ||
    claim.attemptId !== command.attemptId ||
    !isVersion(claim.receiptVersion) ||
    !isVersion(claim.inviteGeneration) ||
    normalizedEmail === null ||
    normalizedEmail !== claim.normalizedEmail
  ) {
    return false;
  }

  return command.kind === "initial"
    ? claim.authUserId === null &&
        (claim.preAttemptConfirmationSentAt === null ||
          isTimestamp(claim.preAttemptConfirmationSentAt))
    : isUuid(claim.authUserId) &&
        isTimestamp(claim.preAttemptConfirmationSentAt);
}

function recordInput(claim: StudentPortalInviteClaim) {
  return {
    receiptId: claim.receiptId,
    attemptId: claim.attemptId,
    expectedReceiptVersion: claim.receiptVersion,
    expectedInviteGeneration: claim.inviteGeneration,
  };
}

function outcomeBinding(
  claim: StudentPortalInviteClaim,
  mutation?: StudentPortalInviteMutationResult | StudentPortalAuthorityFinalizeResult,
): StudentPortalInviteOutcomeBinding {
  const receiptVersion =
    mutation &&
    "receiptVersion" in mutation &&
    isVersion(mutation.receiptVersion)
      ? mutation.receiptVersion
      : claim.receiptVersion;
  const inviteGeneration =
    mutation &&
    "inviteGeneration" in mutation &&
    isVersion(mutation.inviteGeneration)
      ? mutation.inviteGeneration
      : claim.inviteGeneration;
  return {
    receiptId: claim.receiptId,
    attemptId: claim.attemptId,
    receiptVersion,
    inviteGeneration,
  };
}

function exactProviderUser(
  result: StudentPortalAuthUserResult,
  authUserId: string,
  normalizedEmail: string,
): StudentPortalAuthUser | null {
  if (result.status !== "found") return null;
  return result.user.authUserId === authUserId &&
    normalizeEmail(result.user.email) === normalizedEmail
    ? result.user
    : null;
}

async function recordFailure(
  claim: StudentPortalInviteClaim,
  code: string,
  store: StudentPortalInviteStore,
): Promise<StudentPortalInviteOutcome> {
  const boundedCode = safeCode(code, "provider_rejected");
  let result: StudentPortalInviteMutationResult;
  try {
    result = await store.recordFailure({
      ...recordInput(claim),
      code: boundedCode,
    });
    if (result.status === "conflict") {
      return {
        status: "blocked",
        code: safeCode(result.code, "stale_invite_attempt"),
      };
    }
    if (result.status === "unavailable") {
      return { status: "unavailable", code: "receipt_store_unavailable" };
    }
  } catch {
    return { status: "unavailable", code: "receipt_store_unavailable" };
  }
  return {
    status: "invite_failed",
    ...outcomeBinding(claim, result),
    code: boundedCode,
  };
}

async function recordUnknown(
  claim: StudentPortalInviteClaim,
  code: string,
  store: StudentPortalInviteStore,
): Promise<StudentPortalInviteOutcome> {
  const boundedCode = safeCode(code, "provider_outcome_unknown");
  let result: StudentPortalInviteMutationResult;
  try {
    result = await store.recordUnknown({
      ...recordInput(claim),
      code: boundedCode,
    });
  } catch {
    return { status: "unavailable", code: "receipt_store_unavailable" };
  }
  if (result.status === "conflict") {
    return {
      status: "blocked",
      code: safeCode(result.code, "stale_invite_attempt"),
    };
  }
  if (result.status === "unavailable") {
    return { status: "unavailable", code: "receipt_store_unavailable" };
  }
  return {
    status: "invite_outcome_unknown",
    ...outcomeBinding(claim, result),
    code: boundedCode,
  };
}

async function readProviderUser(
  auth: StudentPortalInviteAuthProvider,
  authUserId: string,
): Promise<StudentPortalAuthUserResult> {
  try {
    return await auth.readUserById(authUserId);
  } catch {
    return { status: "unavailable", user: null };
  }
}

async function preflightReissue(
  claim: StudentPortalInviteClaim,
  dependencies: StudentPortalInviteCoordinatorDependencies,
): Promise<StudentPortalInviteOutcome | null> {
  if (!claim.authUserId || !claim.preAttemptConfirmationSentAt) {
    return { status: "blocked", code: "invalid_claim" };
  }
  const result = await readProviderUser(dependencies.auth, claim.authUserId);
  if (result.status === "unavailable") {
    return recordFailure(claim, "provider_read_unavailable", dependencies.store);
  }
  const user = exactProviderUser(
    result,
    claim.authUserId,
    claim.normalizedEmail,
  );
  if (!user) {
    return recordFailure(claim, "portal_identity_conflict", dependencies.store);
  }
  if (user.confirmedAt !== null) {
    return recordFailure(
      claim,
      "portal_invite_already_accepted",
      dependencies.store,
    );
  }
  if (user.confirmationSentAt !== claim.preAttemptConfirmationSentAt) {
    return recordUnknown(claim, "provider_state_changed", dependencies.store);
  }
  return null;
}

async function claimDispatch(
  command: StudentPortalInviteCommand,
  store: StudentPortalInviteStore,
): Promise<StudentPortalInviteClaimResult> {
  try {
    return command.kind === "initial"
      ? await store.claimInitial(command)
      : await store.claimReissue(command);
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Trusted coordinator for the only external invite side effect. The service
 * client represented by `store` cannot call Admin-authorized prepare/reissue
 * authorization RPCs, and the Auth provider receives no JWT or user metadata.
 */
export async function coordinateStudentPortalInvite(
  command: StudentPortalInviteCommand,
  dependencies: StudentPortalInviteCoordinatorDependencies,
): Promise<StudentPortalInviteOutcome> {
  if (
    !validCommand(command) ||
    !Number.isSafeInteger(dependencies.otpExpirySeconds) ||
    dependencies.otpExpirySeconds <= 0
  ) {
    return { status: "blocked", code: "invalid_arguments" };
  }

  const claimResult = await claimDispatch(command, dependencies.store);
  if (claimResult.status === "unavailable") {
    return { status: "unavailable", code: "receipt_store_unavailable" };
  }
  if (claimResult.status === "replay") {
    const replay = claimResult.outcome;
    if (command.kind !== "initial" || replay.status !== "invite_issued") {
      return replay;
    }
    try {
      const finalized = await dependencies.store.finalizeAuthority({
        receiptId: replay.receiptId,
        expectedReceiptVersion: replay.receiptVersion,
        expectedInviteGeneration: replay.inviteGeneration,
      });
      return finalized.status === "activated"
        ? {
            status: "portal_activated",
            receiptId: replay.receiptId,
            attemptId: replay.attemptId,
            receiptVersion: finalized.receiptVersion ?? replay.receiptVersion,
            inviteGeneration:
              finalized.inviteGeneration ?? replay.inviteGeneration,
          }
        : replay;
    } catch {
      return replay;
    }
  }
  if (claimResult.status === "blocked") {
    return {
      status: "blocked",
      code: safeCode(claimResult.code, "receipt_conflict"),
    };
  }

  const claim = claimResult.claim;
  if (!validClaim(command, claim)) {
    return { status: "blocked", code: "invalid_claim" };
  }

  if (command.kind === "reissue") {
    const blocked = await preflightReissue(claim, dependencies);
    if (blocked) return blocked;
  }

  let providerResult: StudentPortalProviderInviteResult;
  try {
    providerResult = await dependencies.auth.inviteUserByEmail({
      email: claim.normalizedEmail,
      redirectTo: studentInviteCallbackUrl(dependencies.nodeEnv),
    });
  } catch {
    return recordUnknown(
      claim,
      "provider_outcome_unknown",
      dependencies.store,
    );
  }
  if (providerResult.status === "definite_failure") {
    return recordFailure(claim, providerResult.code, dependencies.store);
  }
  if (providerResult.status === "unknown") {
    return recordUnknown(claim, providerResult.code, dependencies.store);
  }

  const expectedAuthUserId =
    command.kind === "reissue" ? claim.authUserId : providerResult.authUserId;
  if (
    !isUuid(providerResult.authUserId) ||
    !isUuid(expectedAuthUserId) ||
    providerResult.authUserId !== expectedAuthUserId
  ) {
    return recordUnknown(claim, "provider_identity_mismatch", dependencies.store);
  }

  const userResult = await readProviderUser(
    dependencies.auth,
    providerResult.authUserId,
  );
  const user = exactProviderUser(
    userResult,
    providerResult.authUserId,
    claim.normalizedEmail,
  );
  if (!user || !isTimestamp(user.confirmationSentAt)) {
    return recordUnknown(claim, "provider_readback_unknown", dependencies.store);
  }
  if (
    (command.kind === "reissue" && claim.preAttemptConfirmationSentAt === null) ||
    (claim.preAttemptConfirmationSentAt !== null &&
      Date.parse(user.confirmationSentAt) <=
        Date.parse(claim.preAttemptConfirmationSentAt))
  ) {
    return recordUnknown(
      claim,
      "provider_issuance_unobserved",
      dependencies.store,
    );
  }

  let recorded: StudentPortalInviteMutationResult;
  try {
    recorded = await dependencies.store.recordSuccess({
      ...recordInput(claim),
      authUserId: providerResult.authUserId,
      otpExpirySeconds: dependencies.otpExpirySeconds,
    });
  } catch {
    return recordUnknown(
      claim,
      "receipt_success_unknown",
      dependencies.store,
    );
  }
  if (recorded.status !== "recorded") {
    return recordUnknown(
      claim,
      recorded.status === "conflict"
        ? safeCode(recorded.code, "stale_invite_attempt")
        : "receipt_success_unknown",
      dependencies.store,
    );
  }

  if (command.kind === "reissue") {
    return { status: "invite_issued", ...outcomeBinding(claim, recorded) };
  }
  if (
    !isVersion(recorded.receiptVersion) ||
    !isVersion(recorded.inviteGeneration)
  ) {
    return { status: "invite_issued", ...outcomeBinding(claim, recorded) };
  }

  let finalization: StudentPortalAuthorityFinalizeResult;
  try {
    finalization = await dependencies.store.finalizeAuthority({
      receiptId: claim.receiptId,
      expectedReceiptVersion: recorded.receiptVersion,
      expectedInviteGeneration: recorded.inviteGeneration,
    });
  } catch {
    return { status: "invite_issued", ...outcomeBinding(claim, recorded) };
  }
  return finalization.status === "activated"
    ? { status: "portal_activated", ...outcomeBinding(claim, finalization) }
    : { status: "invite_issued", ...outcomeBinding(claim, finalization) };
}
