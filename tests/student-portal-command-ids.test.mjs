import assert from "node:assert/strict";
import test from "node:test";

const {
  studentPortalAttemptId,
  studentPortalProvisioningRequestId,
  studentPortalReissueRequestId,
} = await import("../src/lib/server/student-portal-command-ids.ts");

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000002";
const RECEIPT = "30000000-0000-4000-8000-000000000003";
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("Student provisioning command IDs are deterministic, namespaced UUIDv5", () => {
  const request = studentPortalProvisioningRequestId(ORG, CASE);
  assert.match(request, UUID_V5);
  assert.equal(request, studentPortalProvisioningRequestId(ORG, CASE));
  assert.notEqual(request, studentPortalProvisioningRequestId(ORG, RECEIPT));

  const attempt = studentPortalAttemptId(RECEIPT, "initial", "1");
  assert.match(attempt, UUID_V5);
  assert.equal(attempt, studentPortalAttemptId(RECEIPT, "initial", "1"));
  assert.notEqual(attempt, studentPortalAttemptId(RECEIPT, "reissue", "1"));
  assert.notEqual(attempt, studentPortalAttemptId(RECEIPT, "initial", "2"));

  const reissue = studentPortalReissueRequestId(RECEIPT, "1");
  assert.match(reissue, UUID_V5);
  assert.notEqual(reissue, studentPortalReissueRequestId(RECEIPT, "2"));
});

test("command IDs reject malformed UUIDs and bigint generations", () => {
  assert.throws(() => studentPortalProvisioningRequestId("bad", CASE));
  assert.throws(() => studentPortalAttemptId(RECEIPT, "initial", "01"));
  assert.throws(() =>
    studentPortalReissueRequestId(RECEIPT, "9223372036854775808"),
  );
});
