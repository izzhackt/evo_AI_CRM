import assert from "node:assert/strict";
import test from "node:test";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { definiteStaffAuthRejection } from "../src/lib/server/staff-auth-failure.ts";

test("documented Auth rate-limit rejection can be sent to the no-side-effect verifier", () => {
  assert.deepEqual(definiteStaffAuthRejection(new AuthApiError("Rate limited", 429, "over_email_send_rate_limit")),
    { code: "over_email_send_rate_limit", httpStatus: 429 });
  assert.deepEqual(definiteStaffAuthRejection(new AuthApiError("Address not allowed", 403, "email_address_not_authorized")),
    { code: "email_address_not_authorized", httpStatus: 403 });
});

test("network uncertainty, 5xx, unknown codes and untyped objects never allow rejection receipts", () => {
  assert.equal(definiteStaffAuthRejection(new AuthRetryableFetchError("Network timeout", 504)), null);
  assert.equal(definiteStaffAuthRejection(new AuthApiError("Internal failure", 500, "over_email_send_rate_limit")), null);
  assert.equal(definiteStaffAuthRejection(new AuthApiError("Unknown", 429, "unknown_failure")), null);
  assert.equal(definiteStaffAuthRejection(new AuthApiError("No code", 429)), null);
  assert.equal(definiteStaffAuthRejection({ status: 429, code: "over_email_send_rate_limit" }), null);
  assert.equal(definiteStaffAuthRejection(new Error("over_email_send_rate_limit")), null);
  assert.equal(definiteStaffAuthRejection(null), null);
});
