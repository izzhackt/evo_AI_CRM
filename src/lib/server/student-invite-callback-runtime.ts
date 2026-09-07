import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { StudentInviteCallbackVerificationDependencies } from "./student-invite-callback-verification.ts";
import type { StudentPortalInviteStoreWithIdentity } from "./student-portal-invite-store.ts";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isDefiniteOtpRejection(error: unknown): boolean {
  const code = record(error)?.code;
  return code === "otp_expired" || code === "otp_disabled";
}

/** Bind the callback core to one cookie-writing SSR client and one private store. */
export function createStudentInviteCallbackRuntime(
  sessionClient: Pick<SupabaseClient, "auth">,
  receiptStore: StudentPortalInviteStoreWithIdentity,
): StudentInviteCallbackVerificationDependencies {
  return Object.freeze({
    async verifyInviteOtp(input) {
      try {
        const { data, error } = await sessionClient.auth.verifyOtp({
          token_hash: input.tokenHash,
          type: "invite",
        });
        if (error) {
          return isDefiniteOtpRejection(error)
            ? { status: "rejected", identity: null }
            : { status: "unavailable", identity: null };
        }
        const user = record(data.user);
        return typeof user?.id === "string" && typeof user.email === "string"
          ? {
              status: "verified",
              identity: { authUserId: user.id, email: user.email },
            }
          : { status: "unavailable", identity: null };
      } catch {
        return { status: "unavailable", identity: null };
      }
    },

    async readVerifiedIdentity() {
      try {
        const { data, error } = await sessionClient.auth.getClaims();
        if (error) {
          return error.name === "AuthSessionMissingError"
            ? { status: "anonymous", identity: null }
            : { status: "invalid", identity: null };
        }
        const claims = data?.claims;
        return typeof claims?.sub === "string" && typeof claims.email === "string"
          ? {
              status: "authenticated",
              identity: { authUserId: claims.sub, email: claims.email },
            }
          : { status: "anonymous", identity: null };
      } catch {
        return { status: "unavailable", identity: null };
      }
    },

    async acceptReceiptIdentity(identity) {
      const result = await receiptStore.resolveIdentity({
        ...identity,
        markAccepted: true,
      });
      if (result.status === "mismatch") return { status: "mismatch" };
      if (
        result.status !== "matched" ||
        result.inviteDeliveryStatus !== "accepted"
      ) {
        return { status: "unavailable" };
      }
      return { status: "accepted" };
    },

    async clearLocalSession() {
      await sessionClient.auth.signOut({ scope: "local" });
    },
  });
}
