import assert from "node:assert/strict";
import test from "node:test";

const { createStudentPortalProvisioningAdminStore } = await import(
  "../src/lib/server/student-portal-provisioning-admin-store.ts"
);

const ORG_ID = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000002";
const RECEIPT_ID = "30000000-0000-4000-8000-000000000003";
const REQUEST_ID = "40000000-0000-4000-8000-000000000004";
const REISSUE_ID = "50000000-0000-4000-8000-000000000005";

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      schema(name) {
        assert.equal(name, "platform");
        return {
          async rpc(fn, args) {
            calls.push([fn, args]);
            return responses.shift();
          },
        };
      },
    },
  };
}

const SNAPSHOT = {
  receipt_id: RECEIPT_ID,
  request_id: REQUEST_ID,
  student_case_id: CASE_ID,
  case_shape: "normal_u6",
  provisioning_state: "prepared",
  receipt_version: 0,
  invite_generation: 0,
  authority_activated: false,
  replayed: false,
};

test("Admin prepare binds the exact authenticated m126 signature", async () => {
  const fake = fakeClient([{ data: SNAPSHOT, error: null }]);
  const store = createStudentPortalProvisioningAdminStore(fake.client);
  const input = {
    organizationId: ORG_ID,
    studentCaseId: CASE_ID,
    email: "student@example.com",
    displayName: "Student Name",
    caseShape: "normal_u6",
    legacyCuratorMembershipId: null,
    reason: "Admin grants portal access",
    requestId: REQUEST_ID,
  };

  assert.deepEqual(await store.prepare(input), {
    status: "prepared",
    receipt: {
      receiptId: RECEIPT_ID,
      requestId: REQUEST_ID,
      studentCaseId: CASE_ID,
      caseShape: "normal_u6",
      provisioningState: "prepared",
      inviteDeliveryStatus: null,
      receiptVersion: "0",
      inviteGeneration: "0",
      activeAttemptId: null,
      authUserId: null,
      inviteExpiresAt: null,
      authorityActivated: false,
      replayed: false,
    },
  });
  assert.deepEqual(fake.calls, [
    [
      "prepare_student_portal_provisioning",
      {
        p_organization_id: ORG_ID,
        p_student_case_id: CASE_ID,
        p_email: "student@example.com",
        p_student_display_name: "Student Name",
        p_case_shape: "normal_u6",
        p_legacy_curator_membership_id: null,
        p_reason: "Admin grants portal access",
        p_request_id: REQUEST_ID,
      },
    ],
  ]);
});

test("Admin reissue authorization is separate and exactly fenced", async () => {
  const fake = fakeClient([
    {
      data: {
        ...SNAPSHOT,
        provisioning_state: "invite_succeeded",
        invite_delivery_status: "expired",
        receipt_version: 8,
        invite_generation: 2,
        auth_user_id: "60000000-0000-4000-8000-000000000006",
      },
      error: null,
    },
  ]);
  const store = createStudentPortalProvisioningAdminStore(fake.client);
  assert.equal(
    (
      await store.authorizeReissue({
        receiptId: RECEIPT_ID,
        expectedReceiptVersion: "7",
        expectedInviteGeneration: "2",
        reissueRequestId: REISSUE_ID,
        reason: "Expired invite requested again",
      })
    ).status,
    "prepared",
  );
  assert.deepEqual(fake.calls, [
    [
      "authorize_student_portal_invite_reissue",
      {
        p_receipt_id: RECEIPT_ID,
        p_expected_receipt_version: "7",
        p_expected_invite_generation: "2",
        p_reissue_request_id: REISSUE_ID,
        p_reason: "Expired invite requested again",
      },
    ],
  ]);
});

test("Admin store exposes only bounded conflicts and rejects malformed JSON", async () => {
  const fake = fakeClient([
    { data: null, error: { code: "40001", message: "portal_invite_not_expired" } },
    { data: { receipt_id: "bad" }, error: null },
  ]);
  const store = createStudentPortalProvisioningAdminStore(fake.client);
  assert.deepEqual(
    await store.authorizeReissue({
      receiptId: RECEIPT_ID,
      expectedReceiptVersion: "7",
      expectedInviteGeneration: "2",
      reissueRequestId: REISSUE_ID,
      reason: "Retry",
    }),
    { status: "blocked", code: "portal_invite_not_expired" },
  );
  assert.deepEqual(
    await store.prepare({
      organizationId: ORG_ID,
      studentCaseId: CASE_ID,
      email: "student@example.com",
      displayName: "Student",
      caseShape: "normal_u6",
      legacyCuratorMembershipId: null,
      reason: "Prepare",
      requestId: REQUEST_ID,
    }),
    { status: "unavailable" },
  );
});
