import assert from "node:assert/strict";
import test from "node:test";
import { signupPendingMessageKey } from "../src/lib/portal/signup-confirmation-presentation.ts";

const pending = (dispatch) => ({
  status: "pending_confirmation", maskedEmail: "q***@example.test",
  expiresAt: "2026-09-22T00:00:00Z", retryAfterSeconds: null, dispatch,
});

test("cookie restoration reports waiting without inferring delivery or dispatch failure", () => {
  for (const dispatch of ["accepted", "failed", "unknown"]) {
    assert.equal(signupPendingMessageKey({ result: pending(dispatch), restored: true }), "restored");
  }
});

test("an explicit resend result replaces restored presentation with its actual outcome", () => {
  for (const dispatch of ["accepted", "failed", "unknown"]) {
    assert.equal(signupPendingMessageKey({ result: pending(dispatch), restored: false }), dispatch);
  }
});

test("recovery and terminal states are never hidden by restored presentation", () => {
  for (const status of ["confirmed", "expired", "rate_limit", "account_conflict", "unavailable"]) {
    for (const restored of [true, false]) {
      assert.equal(signupPendingMessageKey({ result: { status }, restored }), status);
    }
  }
});
