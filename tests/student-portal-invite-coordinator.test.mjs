import assert from "node:assert/strict";
import test from "node:test";

import { coordinateStudentPortalInvite } from "../src/lib/server/student-portal-invite-coordinator.ts";

const RECEIPT_ID = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000002";
const REISSUE_ID = "30000000-0000-4000-8000-000000000003";
const AUTH_USER_ID = "40000000-0000-4000-8000-000000000004";
const OTHER_AUTH_USER_ID = "50000000-0000-4000-8000-000000000005";
const EMAIL = "student@example.com";
const ISSUED_AT = "2026-09-07T10:00:00.000Z";
const REISSUED_AT = "2026-09-07T12:00:00.000Z";

function command(kind = "initial") {
  return kind === "initial"
    ? {
        kind,
        receiptId: RECEIPT_ID,
        attemptId: ATTEMPT_ID,
        expectedReceiptVersion: "7",
        expectedInviteGeneration: "0",
      }
    : {
        kind,
        receiptId: RECEIPT_ID,
        attemptId: ATTEMPT_ID,
        reissueRequestId: REISSUE_ID,
        expectedReceiptVersion: "11",
        expectedInviteGeneration: "1",
      };
}

function fixture({ kind = "initial", overrides = {} } = {}) {
  const calls = [];
  let readCount = 0;
  const claim = {
    receiptId: RECEIPT_ID,
    attemptId: ATTEMPT_ID,
    receiptVersion: kind === "initial" ? "8" : "12",
    inviteGeneration: kind === "initial" ? "1" : "2",
    normalizedEmail: EMAIL,
    authUserId: kind === "initial" ? null : AUTH_USER_ID,
    preAttemptConfirmationSentAt: kind === "initial" ? null : ISSUED_AT,
  };

  const store = {
    claimInitial: async (input) => {
      calls.push(["claim-initial", input]);
      return { status: "claimed", claim };
    },
    claimReissue: async (input) => {
      calls.push(["claim-reissue", input]);
      return { status: "claimed", claim };
    },
    recordSuccess: async (input) => {
      calls.push(["record-success", input]);
      return {
        status: "recorded",
        receiptVersion: kind === "initial" ? "9" : "13",
        inviteGeneration: claim.inviteGeneration,
      };
    },
    recordFailure: async (input) => {
      calls.push(["record-failure", input]);
      return {
        status: "recorded",
        receiptVersion: kind === "initial" ? "9" : "13",
        inviteGeneration: claim.inviteGeneration,
      };
    },
    recordUnknown: async (input) => {
      calls.push(["record-unknown", input]);
      return {
        status: "recorded",
        receiptVersion: kind === "initial" ? "9" : "13",
        inviteGeneration: claim.inviteGeneration,
      };
    },
    finalizeAuthority: async (input) => {
      calls.push(["finalize", input]);
      return {
        status: "activated",
        receiptVersion: "10",
        inviteGeneration: claim.inviteGeneration,
      };
    },
  };
  const auth = {
    readUserById: async (authUserId) => {
      calls.push(["read-user", authUserId]);
      readCount += 1;
      return {
        status: "found",
        user: {
          authUserId,
          email: EMAIL,
          confirmedAt: null,
          confirmationSentAt:
            kind === "initial" || readCount === 1 ? ISSUED_AT : REISSUED_AT,
        },
      };
    },
    inviteUserByEmail: async (input) => {
      calls.push(["invite", input]);
      return { status: "success", authUserId: AUTH_USER_ID };
    },
  };

  return {
    calls,
    dependencies: {
      store: { ...store, ...overrides.store },
      auth: { ...auth, ...overrides.auth },
      otpExpirySeconds: 3600,
      nodeEnv: "development",
    },
  };
}

test("initial invite is claimed before one exact provider call and fenced records", async () => {
  const setup = fixture();
  const result = await coordinateStudentPortalInvite(
    command(),
    setup.dependencies,
  );

  assert.deepEqual(result, {
    status: "portal_activated",
    receiptId: RECEIPT_ID,
    attemptId: ATTEMPT_ID,
    receiptVersion: "10",
    inviteGeneration: "1",
  });
  assert.deepEqual(setup.calls, [
    ["claim-initial", command()],
    [
      "invite",
      {
        email: EMAIL,
        redirectTo: "http://127.0.0.1:3000/auth/callback",
      },
    ],
    ["read-user", AUTH_USER_ID],
    [
      "record-success",
      {
        receiptId: RECEIPT_ID,
        attemptId: ATTEMPT_ID,
        expectedReceiptVersion: "8",
        expectedInviteGeneration: "1",
        authUserId: AUTH_USER_ID,
        otpExpirySeconds: 3600,
      },
    ],
    [
      "finalize",
      {
        receiptId: RECEIPT_ID,
        expectedReceiptVersion: "9",
        expectedInviteGeneration: "1",
      },
    ],
  ]);
});

test("claim replay, in-progress and stale conflicts never call Auth", async () => {
  for (const claimResult of [
    {
      status: "replay",
      outcome: {
        status: "invite_issued",
        receiptId: RECEIPT_ID,
        attemptId: ATTEMPT_ID,
        receiptVersion: "9",
        inviteGeneration: "1",
      },
    },
    { status: "blocked", code: "invite_reissue_in_progress" },
    { status: "blocked", code: "stale_invite_generation" },
    { status: "blocked", code: "portal_reconciliation_required" },
  ]) {
    const setup = fixture({
      overrides: {
        store: {
          claimInitial: async (input) => {
            setup.calls.push(["claim-initial", input]);
            return claimResult;
          },
        },
      },
    });
    const result = await coordinateStudentPortalInvite(
      command(),
      setup.dependencies,
    );
    assert.equal(result.status, claimResult.status === "replay" ? "invite_issued" : "blocked");
    assert.deepEqual(setup.calls.map(([name]) => name), ["claim-initial"]);
  }
});

test("definite provider failure records failure, while uncertainty records unknown", async () => {
  {
    const setup = fixture({
      overrides: {
        auth: {
          inviteUserByEmail: async (input) => {
            setup.calls.push(["invite", input]);
            return { status: "definite_failure", code: "provider_rejected" };
          },
        },
      },
    });
    const result = await coordinateStudentPortalInvite(
      command(),
      setup.dependencies,
    );
    assert.deepEqual(result, {
      status: "invite_failed",
      receiptId: RECEIPT_ID,
      attemptId: ATTEMPT_ID,
      receiptVersion: "9",
      inviteGeneration: "1",
      code: "provider_rejected",
    });
    assert.deepEqual(setup.calls.map(([name]) => name), [
      "claim-initial",
      "invite",
      "record-failure",
    ]);
  }

  {
    const setup = fixture({
      overrides: {
        auth: {
          inviteUserByEmail: async (input) => {
            setup.calls.push(["invite", input]);
            return { status: "unknown", code: "provider_outcome_unknown" };
          },
        },
      },
    });
    const result = await coordinateStudentPortalInvite(
      command(),
      setup.dependencies,
    );
    assert.deepEqual(result, {
      status: "invite_outcome_unknown",
      receiptId: RECEIPT_ID,
      attemptId: ATTEMPT_ID,
      receiptVersion: "9",
      inviteGeneration: "1",
      code: "provider_outcome_unknown",
    });
    assert.deepEqual(setup.calls.map(([name]) => name), [
      "claim-initial",
      "invite",
      "record-unknown",
    ]);
  }
});

test("post-dispatch identity uncertainty never records success or finalizes", async () => {
  for (const readResult of [
    { status: "missing", user: null },
    {
      status: "found",
      user: {
        authUserId: OTHER_AUTH_USER_ID,
        email: EMAIL,
        confirmedAt: null,
        confirmationSentAt: ISSUED_AT,
      },
    },
    {
      status: "found",
      user: {
        authUserId: AUTH_USER_ID,
        email: "other@example.com",
        confirmedAt: null,
        confirmationSentAt: ISSUED_AT,
      },
    },
    { status: "unavailable", user: null },
  ]) {
    const setup = fixture({
      overrides: {
        auth: {
          readUserById: async (authUserId) => {
            setup.calls.push(["read-user", authUserId]);
            return readResult;
          },
        },
      },
    });
    const result = await coordinateStudentPortalInvite(
      command(),
      setup.dependencies,
    );
    assert.equal(result.status, "invite_outcome_unknown");
    assert.equal(setup.calls.at(-1)?.[0], "record-unknown");
    assert.doesNotMatch(
      setup.calls.map(([name]) => name).join(","),
      /record-success|finalize/u,
    );
  }
});

test("reissue reads the same unconfirmed user before and after dispatch", async () => {
  const setup = fixture({ kind: "reissue" });
  const result = await coordinateStudentPortalInvite(
    command("reissue"),
    setup.dependencies,
  );

  assert.deepEqual(result, {
    status: "invite_issued",
    receiptId: RECEIPT_ID,
    attemptId: ATTEMPT_ID,
    receiptVersion: "13",
    inviteGeneration: "2",
  });
  assert.deepEqual(setup.calls.map(([name]) => name), [
    "claim-reissue",
    "read-user",
    "invite",
    "read-user",
    "record-success",
  ]);
  assert.equal(setup.calls.filter(([name]) => name === "invite").length, 1);
  assert.doesNotMatch(
    JSON.stringify(setup.calls.find(([name]) => name === "invite")?.[1]),
    /data|metadata|user_metadata/u,
  );
});

test("reissue never sends for changed, confirmed, or unverifiable identity", async () => {
  for (const readResult of [
    { status: "missing", user: null },
    { status: "unavailable", user: null },
    {
      status: "found",
      user: {
        authUserId: OTHER_AUTH_USER_ID,
        email: EMAIL,
        confirmedAt: null,
        confirmationSentAt: ISSUED_AT,
      },
    },
    {
      status: "found",
      user: {
        authUserId: AUTH_USER_ID,
        email: EMAIL,
        confirmedAt: "2026-09-07T11:00:00.000Z",
        confirmationSentAt: ISSUED_AT,
      },
    },
    {
      status: "found",
      user: {
        authUserId: AUTH_USER_ID,
        email: EMAIL,
        confirmedAt: null,
        confirmationSentAt: "2026-09-07T11:30:00.000Z",
      },
    },
  ]) {
    const setup = fixture({
      kind: "reissue",
      overrides: {
        auth: {
          readUserById: async (authUserId) => {
            setup.calls.push(["read-user", authUserId]);
            return readResult;
          },
        },
      },
    });
    const result = await coordinateStudentPortalInvite(
      command("reissue"),
      setup.dependencies,
    );
    assert.notEqual(result.status, "invite_issued");
    assert.doesNotMatch(
      setup.calls.map(([name]) => name).join(","),
      /invite|record-success/u,
    );
  }
});

test("a reissue success without a newly observed issuance timestamp is unknown", async () => {
  let reads = 0;
  const setup = fixture({
    kind: "reissue",
    overrides: {
      auth: {
        readUserById: async (authUserId) => {
          setup.calls.push(["read-user", authUserId]);
          reads += 1;
          return {
            status: "found",
            user: {
              authUserId,
              email: EMAIL,
              confirmedAt: null,
              confirmationSentAt: ISSUED_AT,
            },
          };
        },
      },
    },
  });

  const result = await coordinateStudentPortalInvite(
    command("reissue"),
    setup.dependencies,
  );
  assert.equal(reads, 2);
  assert.equal(result.status, "invite_outcome_unknown");
  assert.equal(setup.calls.at(-1)?.[0], "record-unknown");
});

test("malformed command fails before the receipt store", async () => {
  const setup = fixture();
  const result = await coordinateStudentPortalInvite(
    { ...command(), expectedReceiptVersion: "900719925474099999999999" },
    setup.dependencies,
  );
  assert.deepEqual(result, { status: "blocked", code: "invalid_arguments" });
  assert.deepEqual(setup.calls, []);
});
