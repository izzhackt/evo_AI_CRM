import assert from "node:assert/strict";
import test from "node:test";

import { reconcileStudentPortalInvite } from "../src/lib/server/student-portal-invite-reconciler.ts";

const RECEIPT_ID = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000002";
const AUTH_USER_ID = "30000000-0000-4000-8000-000000000003";
const EMAIL = "student@example.com";

function command(kind = "initial") {
  const common = {
    receiptId: RECEIPT_ID,
    attemptId: ATTEMPT_ID,
    expectedReceiptVersion: "8",
    expectedInviteGeneration: "1",
  };
  return kind === "initial"
    ? { kind, ...common }
    : {
        kind,
        reissueRequestId: "40000000-0000-4000-8000-000000000004",
        ...common,
      };
}

function fixture({ kind = "initial", lifecycle = "unknown", user = "found" } = {}) {
  const calls = [];
  const store = {
    recoverReconciliationClaim: async (input) => {
      calls.push(["recover", input]);
      return {
        status: "recovered",
        claim: {
          kind,
          lifecycle,
          receiptId: RECEIPT_ID,
          attemptId: ATTEMPT_ID,
          receiptVersion: "8",
          inviteGeneration: "1",
          normalizedEmail: EMAIL,
          authUserId: kind === "reissue" ? AUTH_USER_ID : null,
          reissueRequestId:
            kind === "reissue"
              ? "40000000-0000-4000-8000-000000000004"
              : null,
        },
      };
    },
    recordUnknown: async (input) => {
      calls.push(["record-unknown", input]);
      return { status: "recorded", receiptVersion: "9", inviteGeneration: "1" };
    },
    reconcileObserved: async (input) => {
      calls.push(["reconcile", input]);
      return {
        status: "recorded",
        receiptVersion: lifecycle === "dispatching" ? "10" : "9",
        inviteGeneration: "1",
        inviteDeliveryStatus: "issued",
        authorityActivated: kind === "reissue",
      };
    },
    finalizeAuthority: async (input) => {
      calls.push(["finalize", input]);
      return {
        status: "activated",
        receiptVersion: lifecycle === "dispatching" ? "11" : "10",
        inviteGeneration: "1",
      };
    },
  };
  const observed = user === "found"
    ? {
        status: "found",
        user: {
          authUserId: AUTH_USER_ID,
          email: EMAIL,
          confirmedAt: null,
          confirmationSentAt: "2026-09-07T10:00:00.000Z",
        },
      }
    : { status: user, user: null };
  const auth = {
    readUserById: async (id) => {
      calls.push(["read-id", id]);
      return observed;
    },
    findUserByExactEmail: async (email) => {
      calls.push(["find-email", email]);
      return observed;
    },
    inviteUserByEmail: async () => {
      throw new Error("reconciliation must never send an invite");
    },
  };
  return { calls, dependencies: { store, auth, otpExpirySeconds: 3600 } };
}

test("initial unknown is reconciled by exact-email readback and finalized without resend", async () => {
  const setup = fixture();
  assert.deepEqual(await reconcileStudentPortalInvite(command(), setup.dependencies), {
    status: "portal_activated",
    receiptId: RECEIPT_ID,
    attemptId: ATTEMPT_ID,
    receiptVersion: "10",
    inviteGeneration: "1",
  });
  assert.deepEqual(setup.calls.map(([name]) => name), [
    "recover",
    "find-email",
    "reconcile",
    "finalize",
  ]);
});

test("dispatching is durably marked unknown before provider reconciliation", async () => {
  const setup = fixture({ lifecycle: "dispatching" });
  await reconcileStudentPortalInvite(command(), setup.dependencies);
  assert.deepEqual(setup.calls.map(([name]) => name), [
    "recover",
    "record-unknown",
    "find-email",
    "reconcile",
    "finalize",
  ]);
  assert.equal(setup.calls[3][1].expectedReceiptVersion, "9");
});

test("missing provider identity remains unknown and cannot prove no issuance", async () => {
  const setup = fixture({ user: "missing" });
  assert.deepEqual(await reconcileStudentPortalInvite(command(), setup.dependencies), {
    status: "invite_outcome_unknown",
    code: "provider_issuance_not_observed",
    receiptId: RECEIPT_ID,
    attemptId: ATTEMPT_ID,
    receiptVersion: "8",
    inviteGeneration: "1",
  });
  assert.deepEqual(setup.calls.map(([name]) => name), ["recover", "find-email"]);
});

test("reissue reconciliation keeps the bounded issued outcome", async () => {
  const setup = fixture({ kind: "reissue" });
  assert.deepEqual(
    await reconcileStudentPortalInvite(command("reissue"), setup.dependencies),
    {
      status: "invite_issued",
      receiptId: RECEIPT_ID,
      attemptId: ATTEMPT_ID,
      receiptVersion: "9",
      inviteGeneration: "1",
    },
  );
  assert.deepEqual(setup.calls.map(([name]) => name), [
    "recover",
    "read-id",
    "reconcile",
  ]);
});
