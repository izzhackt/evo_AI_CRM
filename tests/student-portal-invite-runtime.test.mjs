import assert from "node:assert/strict";
import test from "node:test";

import {
  readStudentInviteOtpExpirySeconds,
  StudentPortalInviteRuntimeConfigurationError,
} from "../src/lib/server/student-portal-invite-runtime.ts";

test("invite expiry has one explicit bounded runtime value and no fallback", () => {
  assert.equal(
    readStudentInviteOtpExpirySeconds({
      EVO_STUDENT_INVITE_OTP_EXPIRY_SECONDS: "3600",
    }),
    3600,
  );
  for (const value of [undefined, "", "59", "604801", "3600 ", "1e3"]) {
    assert.throws(
      () =>
        readStudentInviteOtpExpirySeconds(
          value === undefined
            ? {}
            : { EVO_STUDENT_INVITE_OTP_EXPIRY_SECONDS: value },
        ),
      StudentPortalInviteRuntimeConfigurationError,
    );
  }
});
