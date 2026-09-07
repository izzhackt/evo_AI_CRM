import "server-only";

import type { StudentInviteCallbackInput } from "../student-invite-callback-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StudentInviteAuthIdentity = Readonly<{
  authUserId: string;
  email: string;
}>;

export type StudentInviteReceiptIdentity = Readonly<{
  authUserId: string;
  normalizedEmail: string;
}>;

export type StudentInviteOtpResult =
  | Readonly<{ status: "verified"; identity: StudentInviteAuthIdentity }>
  | Readonly<{ status: "rejected" | "unavailable"; identity: null }>;

export type StudentInviteSessionResult =
  | Readonly<{
      status: "authenticated";
      identity: StudentInviteAuthIdentity;
    }>
  | Readonly<{
      status: "anonymous" | "invalid" | "unavailable";
      identity: null;
    }>;

export type StudentInviteReceiptAcceptanceResult = Readonly<{
  status: "accepted" | "mismatch" | "unavailable";
}>;

export type StudentInviteCallbackVerificationResult = Readonly<{
  status:
    | "set_password"
    | "expired_or_used"
    | "invalid_identity"
    | "auth_unavailable";
}>;

export type StudentInviteCallbackVerificationDependencies = Readonly<{
  verifyInviteOtp: (
    input: StudentInviteCallbackInput,
  ) => Promise<StudentInviteOtpResult>;
  readVerifiedIdentity: () => Promise<StudentInviteSessionResult>;
  acceptReceiptIdentity: (
    identity: StudentInviteReceiptIdentity,
  ) => Promise<StudentInviteReceiptAcceptanceResult>;
  clearLocalSession: () => Promise<void>;
}>;

function normalizeIdentity(
  identity: StudentInviteAuthIdentity,
): StudentInviteReceiptIdentity | null {
  const email = identity.email.trim().toLocaleLowerCase("en-US");
  const at = email.indexOf("@");
  if (
    !UUID_PATTERN.test(identity.authUserId) ||
    email.length === 0 ||
    email.length > 320 ||
    at <= 0 ||
    at !== email.lastIndexOf("@") ||
    at === email.length - 1 ||
    /\s/.test(email)
  ) {
    return null;
  }
  return { authUserId: identity.authUserId, normalizedEmail: email };
}

async function clearRejectedSession(
  dependencies: StudentInviteCallbackVerificationDependencies,
): Promise<void> {
  try {
    await dependencies.clearLocalSession();
  } catch {
    // A failed local clear never turns a rejected identity into authority.
  }
}

/**
 * Verifies a human-confirmed invite without any reissue path. A rejected
 * one-time token may reuse only an already verified, receipt-matching session.
 * The receipt operation both validates exact Auth user/email and records the
 * accepted generation through the service-role-only m126 RPC.
 */
export async function verifyStudentInviteCallback(
  input: StudentInviteCallbackInput,
  dependencies: StudentInviteCallbackVerificationDependencies,
): Promise<StudentInviteCallbackVerificationResult> {
  let otp: StudentInviteOtpResult;
  try {
    otp = await dependencies.verifyInviteOtp(input);
  } catch {
    return { status: "auth_unavailable" };
  }
  if (otp.status === "unavailable") return { status: "auth_unavailable" };

  let identity: StudentInviteAuthIdentity | null =
    otp.status === "verified" ? otp.identity : null;
  if (otp.status === "rejected") {
    let session: StudentInviteSessionResult;
    try {
      session = await dependencies.readVerifiedIdentity();
    } catch {
      return { status: "auth_unavailable" };
    }
    if (session.status === "unavailable") {
      return { status: "auth_unavailable" };
    }
    if (session.status !== "authenticated") {
      if (session.status === "invalid") await clearRejectedSession(dependencies);
      return { status: "expired_or_used" };
    }
    identity = session.identity;
  }

  const normalizedIdentity = identity ? normalizeIdentity(identity) : null;
  if (!normalizedIdentity) {
    await clearRejectedSession(dependencies);
    return { status: "invalid_identity" };
  }

  let receipt: StudentInviteReceiptAcceptanceResult;
  try {
    receipt = await dependencies.acceptReceiptIdentity(normalizedIdentity);
  } catch {
    return { status: "auth_unavailable" };
  }
  if (receipt.status === "unavailable") return { status: "auth_unavailable" };
  if (receipt.status === "mismatch") {
    await clearRejectedSession(dependencies);
    return { status: "invalid_identity" };
  }
  return { status: "set_password" };
}
