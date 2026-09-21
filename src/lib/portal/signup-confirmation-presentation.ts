import type { SignupResendResult } from "../student-signup-confirmation-state.ts";

/** Web-only provenance; restoring the cookie does not observe a mail dispatch. */
export type SignupPendingPresentation = Readonly<{
  result: SignupResendResult;
  restored: boolean;
}>;

export function signupPendingMessageKey({ result, restored }: SignupPendingPresentation) {
  if (result.status !== "pending_confirmation") return result.status;
  return restored ? "restored" : result.dispatch;
}
