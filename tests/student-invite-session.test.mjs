import assert from "node:assert/strict";
import test from "node:test";

const { readVerifiedStudentInviteSession } = await import(
  "../src/lib/server/student-invite-session.ts"
);

const AUTH_USER_ID = "10000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "20000000-0000-4000-8000-000000000002";

function client(result) {
  return { auth: { getClaims: async () => result } };
}

function store(result, calls = []) {
  return {
    async resolveIdentity(input) {
      calls.push(input);
      return result;
    },
  };
}

const MATCH = {
  status: "matched",
  receiptId: RECEIPT_ID,
  receiptVersion: "3",
  inviteGeneration: "1",
  provisioningState: "invite_succeeded",
  inviteDeliveryStatus: "accepted",
  accountPending: true,
  authorityActivated: false,
};

test("verified invite session normalizes exact Auth identity and reads the private receipt", async () => {
  const calls = [];
  const result = await readVerifiedStudentInviteSession(
    client({
      data: {
        claims: {
          sub: AUTH_USER_ID,
          email: "  STUDENT@EXAMPLE.COM ",
        },
      },
      error: null,
    }),
    store(MATCH, calls),
  );

  assert.deepEqual(calls, [
    {
      authUserId: AUTH_USER_ID,
      normalizedEmail: "student@example.com",
      markAccepted: false,
    },
  ]);
  assert.deepEqual(result, {
    status: "authenticated",
    identity: {
      authUserId: AUTH_USER_ID,
      normalizedEmail: "student@example.com",
    },
    receipt: MATCH,
  });
});

test("missing, malformed and rejected sessions never consult a receipt", async () => {
  const calls = [];
  assert.deepEqual(
    await readVerifiedStudentInviteSession(
      client({
        data: { claims: null },
        error: { name: "AuthSessionMissingError" },
      }),
      store(MATCH, calls),
    ),
    { status: "anonymous", identity: null, receipt: null },
  );
  assert.deepEqual(
    await readVerifiedStudentInviteSession(
      client({ data: { claims: { sub: "bad", email: "bad" } }, error: null }),
      store(MATCH, calls),
    ),
    { status: "invalid", identity: null, receipt: null },
  );
  assert.deepEqual(
    await readVerifiedStudentInviteSession(
      client({ data: null, error: { name: "AuthApiError", status: 401 } }),
      store(MATCH, calls),
    ),
    { status: "invalid", identity: null, receipt: null },
  );
  assert.equal(calls.length, 0);
});

test("only a matching accepted receipt authorizes password and pending surfaces", async () => {
  const authClient = client({
    data: { claims: { sub: AUTH_USER_ID, email: "student@example.com" } },
    error: null,
  });

  assert.deepEqual(
    await readVerifiedStudentInviteSession(authClient, store({ status: "mismatch" })),
    { status: "invalid", identity: null, receipt: null },
  );
  assert.deepEqual(
    await readVerifiedStudentInviteSession(
      authClient,
      store({ ...MATCH, inviteDeliveryStatus: "issued" }),
    ),
    { status: "invalid", identity: null, receipt: null },
  );
  assert.deepEqual(
    await readVerifiedStudentInviteSession(authClient, store({ status: "unavailable" })),
    { status: "unavailable", identity: null, receipt: null },
  );
});

test("network and store exceptions are unavailable, never anonymous", async () => {
  assert.deepEqual(
    await readVerifiedStudentInviteSession(
      { auth: { getClaims: async () => Promise.reject(new Error("offline")) } },
      store(MATCH),
    ),
    { status: "unavailable", identity: null, receipt: null },
  );
  assert.deepEqual(
    await readVerifiedStudentInviteSession(
      client({
        data: { claims: { sub: AUTH_USER_ID, email: "student@example.com" } },
        error: null,
      }),
      {
        resolveIdentity: async () => Promise.reject(new Error("database offline")),
      },
    ),
    { status: "unavailable", identity: null, receipt: null },
  );
});
