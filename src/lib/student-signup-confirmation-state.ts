/** Public presentation only: never put Auth tokens, raw email or password here. */
export type SignupDispatch = "accepted" | "failed" | "unknown";
export type SignupPending = Readonly<{
  status: "pending_confirmation";
  maskedEmail: string;
  expiresAt: string;
  retryAfterSeconds: number | null;
  dispatch: SignupDispatch;
}>;
/** Returned only by the cookie-free native API; web keeps this in HttpOnly storage. */
export type NativeSignupPending = SignupPending & Readonly<{ resendCapability: string }>;
export type SignupFailure = Readonly<{
  status: "invalid" | "password" | "password_too_long" | "unavailable" | "rate_limit" | "conflict" | "create_unknown";
}>;
export type SignupResendResult = SignupPending | Readonly<{
  status: "confirmed" | "expired" | "rate_limit" | "account_conflict" | "unavailable";
}>;
export type NativeSignupResendResult = NativeSignupPending | Exclude<SignupResendResult, SignupPending>;
export type SignupConfirmState = Readonly<{
  status: "idle" | "invalid_link" | "expired_or_used" | "account_conflict"
    | "unavailable" | "resume_unknown" | "sign_in_required";
}>;
export const SIGNUP_CONFIRMATION_FLOW_HEADER = "X-EVO-Registration-Flow";
export const SIGNUP_CONFIRMATION_FLOW_VERSION = "email-confirmation-v1";
