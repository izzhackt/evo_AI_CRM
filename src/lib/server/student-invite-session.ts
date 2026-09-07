import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type StudentPortalInviteIdentityMatch,
  type StudentPortalInviteStoreWithIdentity,
} from "./student-portal-invite-store.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VerifiedStudentInviteIdentity = Readonly<{
  authUserId: string;
  normalizedEmail: string;
}>;

export type VerifiedStudentInviteSessionResult =
  | Readonly<{
      status: "authenticated";
      identity: VerifiedStudentInviteIdentity;
      receipt: StudentPortalInviteIdentityMatch;
    }>
  | Readonly<{
      status: "anonymous" | "invalid" | "unavailable";
      identity: null;
      receipt: null;
    }>;

type ClaimsClient = Pick<SupabaseClient, "auth">;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeStudentInviteIdentity(
  value: unknown,
): VerifiedStudentInviteIdentity | null {
  const claims = record(value);
  if (typeof claims?.sub !== "string" || typeof claims.email !== "string") {
    return null;
  }
  const normalizedEmail = claims.email.trim().toLocaleLowerCase("en-US");
  const at = normalizedEmail.indexOf("@");
  if (
    !UUID_PATTERN.test(claims.sub) ||
    normalizedEmail.length < 3 ||
    normalizedEmail.length > 320 ||
    at <= 0 ||
    at !== normalizedEmail.lastIndexOf("@") ||
    at === normalizedEmail.length - 1 ||
    /\s/.test(normalizedEmail)
  ) {
    return null;
  }
  return { authUserId: claims.sub, normalizedEmail };
}

function rejectedClaimsError(error: unknown): boolean {
  const value = record(error);
  return (
    value?.name === "AuthSessionMissingError" ||
    value?.status === 401 ||
    value?.status === 403
  );
}

export async function resolveStudentInviteReceiptIdentity(
  identity: VerifiedStudentInviteIdentity,
  receiptStore: StudentPortalInviteStoreWithIdentity,
  markAccepted = false,
): Promise<VerifiedStudentInviteSessionResult> {
  try {
    const receipt = await receiptStore.resolveIdentity({
      ...identity,
      markAccepted,
    });
    if (receipt.status === "unavailable") {
      return { status: "unavailable", identity: null, receipt: null };
    }
    if (
      receipt.status !== "matched" ||
      receipt.inviteDeliveryStatus !== "accepted"
    ) {
      return { status: "invalid", identity: null, receipt: null };
    }
    return { status: "authenticated", identity, receipt };
  } catch {
    return { status: "unavailable", identity: null, receipt: null };
  }
}

/** Resolve only a verified Auth session bound to one accepted private receipt. */
export async function readVerifiedStudentInviteSession(
  sessionClient: ClaimsClient,
  receiptStore: StudentPortalInviteStoreWithIdentity,
): Promise<VerifiedStudentInviteSessionResult> {
  try {
    const { data, error } = await sessionClient.auth.getClaims();
    if (error) {
      return {
        status:
          record(error)?.name === "AuthSessionMissingError"
            ? "anonymous"
            : rejectedClaimsError(error)
              ? "invalid"
              : "unavailable",
        identity: null,
        receipt: null,
      };
    }
    const identity = normalizeStudentInviteIdentity(data?.claims);
    if (!identity) {
      return { status: "invalid", identity: null, receipt: null };
    }
    return resolveStudentInviteReceiptIdentity(identity, receiptStore);
  } catch {
    return { status: "unavailable", identity: null, receipt: null };
  }
}
