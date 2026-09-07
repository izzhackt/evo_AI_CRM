import assert from "node:assert/strict";
import test from "node:test";

import { createStudentPortalInviteStore } from "../src/lib/server/student-portal-invite-store.ts";

const RECEIPT_ID = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000002";
const REISSUE_ID = "30000000-0000-4000-8000-000000000003";
const AUTH_USER_ID = "40000000-0000-4000-8000-000000000004";
const EMAIL = "student@example.com";
const PRE_CONFIRMATION_SENT_AT = "2026-09-07T10:00:00.000Z";

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      schema(name) {
        assert.equal(name, "platform");
        return {
          async rpc(functionName, args) {
            calls.push([functionName, args]);
            const response = responses.shift();
            assert.ok(response, `missing response for ${functionName}`);
            return response;
          },
        };
      },
    },
  };
}

test("store binds initial and reissue claims to exact m126 arguments", async () => {
  const fake = fakeClient([
    {
      data: {
        receipt_id: RECEIPT_ID,
        attempt_id: ATTEMPT_ID,
        receipt_version: 8,
        invite_generation: 1,
        normalized_email: EMAIL,
        provisioning_state: "dispatching",
        provider_dispatch_allowed: true,
        replayed: false,
      },
      error: null,
    },
    {
      data: {
        receipt_id: RECEIPT_ID,
        attempt_id: ATTEMPT_ID,
        receipt_version: 12,
        invite_generation: 2,
        normalized_email: EMAIL,
        auth_user_id: AUTH_USER_ID,
        pre_confirmation_sent_at: PRE_CONFIRMATION_SENT_AT,
        provisioning_state: "authority_activated",
        invite_delivery_status: "reissue_dispatching",
        provider_dispatch_allowed: true,
        replayed: false,
      },
      error: null,
    },
  ]);
  const store = createStudentPortalInviteStore(fake.client);

  assert.deepEqual(
    await store.claimInitial({
      kind: "initial",
      receiptId: RECEIPT_ID,
      attemptId: ATTEMPT_ID,
      expectedReceiptVersion: "7",
      expectedInviteGeneration: "0",
    }),
    {
      status: "claimed",
      claim: {
        receiptId: RECEIPT_ID,
        attemptId: ATTEMPT_ID,
        receiptVersion: "8",
        inviteGeneration: "1",
        normalizedEmail: EMAIL,
        authUserId: null,
        preAttemptConfirmationSentAt: null,
      },
    },
  );
  assert.deepEqual(
    await store.claimReissue({
      kind: "reissue",
      receiptId: RECEIPT_ID,
      reissueRequestId: REISSUE_ID,
      attemptId: ATTEMPT_ID,
      expectedReceiptVersion: "11",
      expectedInviteGeneration: "1",
    }),
    {
      status: "claimed",
      claim: {
        receiptId: RECEIPT_ID,
        attemptId: ATTEMPT_ID,
        receiptVersion: "12",
        inviteGeneration: "2",
        normalizedEmail: EMAIL,
        authUserId: AUTH_USER_ID,
        preAttemptConfirmationSentAt: PRE_CONFIRMATION_SENT_AT,
      },
    },
  );

  assert.deepEqual(fake.calls, [
    [
      "claim_student_portal_invite",
      {
        p_receipt_id: RECEIPT_ID,
        p_attempt_id: ATTEMPT_ID,
        p_expected_receipt_version: "7",
        p_expected_invite_generation: "0",
      },
    ],
    [
      "claim_student_portal_invite_reissue",
      {
        p_receipt_id: RECEIPT_ID,
        p_reissue_request_id: REISSUE_ID,
        p_attempt_id: ATTEMPT_ID,
        p_expected_receipt_version: "11",
        p_expected_invite_generation: "1",
      },
    ],
  ]);
});

test("reissue claim rejects the receipt issuance timestamp as an attempt baseline", async () => {
  const fake = fakeClient([{
    data: {
      receipt_id: RECEIPT_ID,
      attempt_id: ATTEMPT_ID,
      receipt_version: 12,
      invite_generation: 2,
      normalized_email: EMAIL,
      auth_user_id: AUTH_USER_ID,
      invite_issued_at: PRE_CONFIRMATION_SENT_AT,
      provisioning_state: "authority_activated",
      invite_delivery_status: "reissue_dispatching",
      provider_dispatch_allowed: true,
      replayed: false,
    },
    error: null,
  }]);
  const store = createStudentPortalInviteStore(fake.client);

  assert.deepEqual(
    await store.claimReissue({
      kind: "reissue",
      receiptId: RECEIPT_ID,
      reissueRequestId: REISSUE_ID,
      attemptId: ATTEMPT_ID,
      expectedReceiptVersion: "11",
      expectedInviteGeneration: "1",
    }),
    { status: "unavailable" },
  );
});

test("claim replay and database conflicts never become a dispatch claim", async () => {
  const fake = fakeClient([
    {
      data: {
        receipt_id: RECEIPT_ID,
        attempt_id: ATTEMPT_ID,
        receipt_version: 8,
        invite_generation: 1,
        normalized_email: EMAIL,
        provisioning_state: "invite_outcome_unknown",
        provider_dispatch_allowed: true,
        replayed: true,
        safe_error_code: "provider_outcome_unknown",
      },
      error: null,
    },
    {
      data: null,
      error: { code: "40001", message: "stale_invite_generation" },
    },
  ]);
  const store = createStudentPortalInviteStore(fake.client);
  const input = {
    kind: "initial",
    receiptId: RECEIPT_ID,
    attemptId: ATTEMPT_ID,
    expectedReceiptVersion: "7",
    expectedInviteGeneration: "0",
  };

  assert.deepEqual(await store.claimInitial(input), {
    status: "blocked",
    code: "portal_reconciliation_required",
  });
  assert.deepEqual(await store.claimInitial(input), {
    status: "blocked",
    code: "stale_invite_generation",
  });
});

test("store records success/failure/unknown and finalizes with exact fences", async () => {
  const fake = fakeClient([
    {
      data: { receipt_version: 9, invite_generation: 1 },
      error: null,
    },
    { data: { receipt_version: 9, invite_generation: 1 }, error: null },
    { data: { receipt_version: 9, invite_generation: 1 }, error: null },
    {
      data: {
        authority_activated: true,
        receipt_version: 10,
        invite_generation: 1,
      },
      error: null,
    },
  ]);
  const store = createStudentPortalInviteStore(fake.client);
  const fence = {
    receiptId: RECEIPT_ID,
    attemptId: ATTEMPT_ID,
    expectedReceiptVersion: "8",
    expectedInviteGeneration: "1",
  };

  assert.deepEqual(
    await store.recordSuccess({
      ...fence,
      authUserId: AUTH_USER_ID,
      otpExpirySeconds: 3600,
    }),
    {
      status: "recorded",
      receiptVersion: "9",
      inviteGeneration: "1",
    },
  );
  assert.equal(
    (await store.recordFailure({ ...fence, code: "provider_rejected" })).status,
    "recorded",
  );
  assert.equal(
    (
      await store.recordUnknown({
        ...fence,
        code: "provider_outcome_unknown",
      })
    ).status,
    "recorded",
  );
  assert.deepEqual(
    await store.finalizeAuthority({
      receiptId: RECEIPT_ID,
      expectedReceiptVersion: "9",
      expectedInviteGeneration: "1",
    }),
    {
      status: "activated",
      receiptVersion: "10",
      inviteGeneration: "1",
    },
  );

  assert.deepEqual(fake.calls, [
    [
      "record_student_portal_invite_success",
      {
        p_receipt_id: RECEIPT_ID,
        p_attempt_id: ATTEMPT_ID,
        p_expected_receipt_version: "8",
        p_expected_invite_generation: "1",
        p_auth_user_id: AUTH_USER_ID,
        p_email_otp_expires_in_seconds: 3600,
      },
    ],
    [
      "record_student_portal_invite_failure",
      {
        p_receipt_id: RECEIPT_ID,
        p_attempt_id: ATTEMPT_ID,
        p_expected_receipt_version: "8",
        p_expected_invite_generation: "1",
        p_safe_error_code: "provider_rejected",
      },
    ],
    [
      "record_student_portal_invite_unknown",
      {
        p_receipt_id: RECEIPT_ID,
        p_attempt_id: ATTEMPT_ID,
        p_expected_receipt_version: "8",
        p_expected_invite_generation: "1",
        p_safe_error_code: "provider_outcome_unknown",
      },
    ],
    [
      "finalize_student_portal_authority",
      {
        p_receipt_id: RECEIPT_ID,
        p_expected_receipt_version: "9",
        p_expected_invite_generation: "1",
      },
    ],
  ]);
});

test("verified identity resolver is exact, private and optionally accepting", async () => {
  const fake = fakeClient([
    {
      data: {
        receipt_id: RECEIPT_ID,
        provisioning_state: "invite_succeeded",
        invite_delivery_status: "accepted",
        receipt_version: 10,
        invite_generation: 1,
        account_pending: true,
        authority_activated: false,
      },
      error: null,
    },
    {
      data: null,
      error: { code: "40001", message: "portal_identity_conflict" },
    },
  ]);
  const store = createStudentPortalInviteStore(fake.client);

  assert.deepEqual(
    await store.resolveIdentity({
      authUserId: AUTH_USER_ID,
      normalizedEmail: EMAIL,
      markAccepted: true,
    }),
    {
      status: "matched",
      receiptId: RECEIPT_ID,
      receiptVersion: "10",
      inviteGeneration: "1",
      provisioningState: "invite_succeeded",
      inviteDeliveryStatus: "accepted",
      accountPending: true,
      authorityActivated: false,
    },
  );
  assert.deepEqual(
    await store.resolveIdentity({
      authUserId: AUTH_USER_ID,
      normalizedEmail: EMAIL,
      markAccepted: false,
    }),
    { status: "mismatch" },
  );
  assert.deepEqual(fake.calls, [
    [
      "resolve_student_portal_invite_identity",
      {
        p_auth_user_id: AUTH_USER_ID,
        p_email: EMAIL,
        p_mark_accepted: true,
      },
    ],
    [
      "resolve_student_portal_invite_identity",
      {
        p_auth_user_id: AUTH_USER_ID,
        p_email: EMAIL,
        p_mark_accepted: false,
      },
    ],
  ]);
});

test("malformed or unavailable RPC responses fail closed", async () => {
  const fake = fakeClient([
    { data: { replayed: false }, error: null },
    { data: null, error: { code: "P0002", message: "receipt unavailable" } },
    { data: { receipt_version: 9 }, error: null },
  ]);
  const store = createStudentPortalInviteStore(fake.client);
  const claim = await store.claimInitial({
    kind: "initial",
    receiptId: RECEIPT_ID,
    attemptId: ATTEMPT_ID,
    expectedReceiptVersion: "7",
    expectedInviteGeneration: "0",
  });
  assert.deepEqual(claim, { status: "unavailable" });
  assert.deepEqual(
    await store.resolveIdentity({
      authUserId: AUTH_USER_ID,
      normalizedEmail: EMAIL,
      markAccepted: false,
    }),
    { status: "unavailable" },
  );
  assert.deepEqual(
    await store.recordSuccess({
      receiptId: RECEIPT_ID,
      attemptId: ATTEMPT_ID,
      expectedReceiptVersion: "8",
      expectedInviteGeneration: "1",
      authUserId: AUTH_USER_ID,
      otpExpirySeconds: 3600,
    }),
    { status: "unavailable" },
  );
});

test("reconciliation store binds replay and observed issuance to exact m126 fences", async () => {
  const fake = fakeClient([
    {
      data: {
        receipt_id: RECEIPT_ID,
        attempt_id: ATTEMPT_ID,
        receipt_version: 12,
        invite_generation: 2,
        normalized_email: EMAIL,
        auth_user_id: AUTH_USER_ID,
        reissue_request_id: REISSUE_ID,
        provisioning_state: "authority_activated",
        invite_delivery_status: "reissue_unknown",
        authority_activated: true,
        replayed: true,
      },
      error: null,
    },
    {
      data: {
        receipt_id: RECEIPT_ID,
        attempt_id: ATTEMPT_ID,
        receipt_version: 13,
        invite_generation: 2,
        invite_delivery_status: "issued",
        authority_activated: true,
        reconciled: true,
      },
      error: null,
    },
  ]);
  const store = createStudentPortalInviteStore(fake.client);
  const command = {
    kind: "reissue",
    receiptId: RECEIPT_ID,
    attemptId: ATTEMPT_ID,
    reissueRequestId: REISSUE_ID,
    expectedReceiptVersion: "12",
    expectedInviteGeneration: "2",
  };
  assert.deepEqual(await store.recoverReconciliationClaim(command), {
    status: "recovered",
    claim: {
      kind: "reissue",
      lifecycle: "unknown",
      receiptId: RECEIPT_ID,
      attemptId: ATTEMPT_ID,
      receiptVersion: "12",
      inviteGeneration: "2",
      normalizedEmail: EMAIL,
      authUserId: AUTH_USER_ID,
      reissueRequestId: REISSUE_ID,
    },
  });
  assert.deepEqual(
    await store.reconcileObserved({
      receiptId: RECEIPT_ID,
      attemptId: ATTEMPT_ID,
      expectedReceiptVersion: "12",
      expectedInviteGeneration: "2",
      authUserId: AUTH_USER_ID,
      otpExpirySeconds: 3600,
    }),
    {
      status: "recorded",
      receiptVersion: "13",
      inviteGeneration: "2",
      inviteDeliveryStatus: "issued",
      authorityActivated: true,
    },
  );
  assert.deepEqual(fake.calls, [
    [
      "claim_student_portal_invite_reissue",
      {
        p_receipt_id: RECEIPT_ID,
        p_reissue_request_id: REISSUE_ID,
        p_attempt_id: ATTEMPT_ID,
        p_expected_receipt_version: "12",
        p_expected_invite_generation: "2",
      },
    ],
    [
      "reconcile_student_portal_invite",
      {
        p_receipt_id: RECEIPT_ID,
        p_attempt_id: ATTEMPT_ID,
        p_expected_receipt_version: "12",
        p_expected_invite_generation: "2",
        p_auth_user_id: AUTH_USER_ID,
        p_email_otp_expires_in_seconds: 3600,
        p_provider_no_issuance_proven: false,
        p_provider_operation_upper_bound_at: null,
        p_safe_error_code: "provider_issuance_observed",
      },
    ],
  ]);
});

test("reissue-unknown replay is never hidden by already-active authority", async () => {
  const fake = fakeClient([
    {
      data: {
        receipt_id: RECEIPT_ID,
        attempt_id: ATTEMPT_ID,
        receipt_version: 12,
        invite_generation: 2,
        provisioning_state: "authority_activated",
        invite_delivery_status: "reissue_unknown",
        authority_activated: true,
        replayed: true,
      },
      error: null,
    },
  ]);
  const store = createStudentPortalInviteStore(fake.client);
  assert.deepEqual(
    await store.claimReissue({
      kind: "reissue",
      receiptId: RECEIPT_ID,
      attemptId: ATTEMPT_ID,
      reissueRequestId: REISSUE_ID,
      expectedReceiptVersion: "12",
      expectedInviteGeneration: "2",
    }),
    { status: "blocked", code: "portal_reconciliation_required" },
  );
});
