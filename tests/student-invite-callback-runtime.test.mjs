import assert from "node:assert/strict";
import test from "node:test";

import { createStudentInviteCallbackRuntime } from "../src/lib/server/student-invite-callback-runtime.ts";

function runtime(error) {
  return createStudentInviteCallbackRuntime(
    {
      auth: {
        verifyOtp: async () => ({ data: { user: null }, error }),
        getClaims: async () => ({ data: null, error: null }),
      },
    },
    {},
  );
}

test("only known terminal OTP codes are classified as expired or invalid", async () => {
  for (const code of ["otp_expired", "otp_disabled"]) {
    assert.deepEqual(
      await runtime({ status: 422, code }).verifyInviteOtp({ tokenHash: "a".repeat(56) }),
      { status: "rejected", identity: null },
    );
  }
});

test("rate limits and ambiguous 4xx failures stay retryable-unavailable", async () => {
  for (const error of [
    { status: 429, code: "over_request_rate_limit" },
    { status: 422, code: "validation_failed" },
    { status: 408 },
  ]) {
    assert.deepEqual(
      await runtime(error).verifyInviteOtp({ tokenHash: "a".repeat(56) }),
      { status: "unavailable", identity: null },
    );
  }
});
