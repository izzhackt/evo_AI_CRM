import assert from "node:assert/strict";
import test from "node:test";

import { createStudentPortalInviteAuthProvider } from "../src/lib/server/student-portal-invite-auth-provider.ts";

const AUTH_USER_ID = "10000000-0000-4000-8000-000000000001";

function client({ invite, getUser }) {
  return {
    auth: {
      admin: {
        inviteUserByEmail: invite,
        getUserById: getUser,
      },
    },
  };
}

test("provider sends only exact email and redirectTo without metadata", async () => {
  const calls = [];
  const provider = createStudentPortalInviteAuthProvider(
    client({
      invite: async (...args) => {
        calls.push(args);
        return { data: { user: { id: AUTH_USER_ID } }, error: null };
      },
      getUser: async () => ({ data: { user: null }, error: null }),
    }),
  );

  assert.deepEqual(
    await provider.inviteUserByEmail({
      email: "student@example.com",
      redirectTo: "http://127.0.0.1:3000/auth/callback",
    }),
    { status: "success", authUserId: AUTH_USER_ID },
  );
  assert.deepEqual(calls, [
    [
      "student@example.com",
      { redirectTo: "http://127.0.0.1:3000/auth/callback" },
    ],
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /data|metadata|user_metadata/u);
});

test("provider distinguishes definite Auth rejection from uncertain outcome", async () => {
  for (const [error, expected] of [
    [
      { status: 422, code: "email_exists", name: "AuthApiError" },
      {
        status: "definite_failure",
        code: "portal_invite_already_accepted",
      },
    ],
    [
      {
        status: 429,
        code: "over_email_send_rate_limit",
        name: "AuthApiError",
      },
      { status: "definite_failure", code: "provider_rate_limited" },
    ],
    [
      { status: 500, code: "unexpected_failure", name: "AuthApiError" },
      { status: "unknown", code: "provider_outcome_unknown" },
    ],
    [
      { status: 0, code: "network_error", name: "AuthRetryableFetchError" },
      { status: "unknown", code: "provider_outcome_unknown" },
    ],
  ]) {
    const provider = createStudentPortalInviteAuthProvider(
      client({
        invite: async () => ({ data: { user: null }, error }),
        getUser: async () => ({ data: { user: null }, error: null }),
      }),
    );
    assert.deepEqual(
      await provider.inviteUserByEmail({
        email: "student@example.com",
        redirectTo: "http://127.0.0.1:3000/auth/callback",
      }),
      expected,
    );
  }
});

test("provider reads the exact bounded Auth identity", async () => {
  const provider = createStudentPortalInviteAuthProvider(
    client({
      invite: async () => ({ data: { user: null }, error: null }),
      getUser: async (id) => ({
        data: {
          user: {
            id,
            email: "Student@Example.com",
            confirmed_at: null,
            confirmation_sent_at: "2026-09-07T10:00:00.000Z",
            user_metadata: { role: "admin" },
          },
        },
        error: null,
      }),
    }),
  );

  assert.deepEqual(await provider.readUserById(AUTH_USER_ID), {
    status: "found",
    user: {
      authUserId: AUTH_USER_ID,
      email: "Student@Example.com",
      confirmedAt: null,
      confirmationSentAt: "2026-09-07T10:00:00.000Z",
    },
  });
});

test("provider read fails closed on missing, malformed or unavailable Auth user", async () => {
  for (const [response, expectedStatus] of [
    [{ data: { user: null }, error: { status: 404 } }, "missing"],
    [{ data: { user: null }, error: null }, "missing"],
    [
      { data: { user: { id: "bad", email: "x@example.com" } }, error: null },
      "unavailable",
    ],
    [{ data: { user: null }, error: { status: 500 } }, "unavailable"],
  ]) {
    const provider = createStudentPortalInviteAuthProvider(
      client({
        invite: async () => ({ data: { user: null }, error: null }),
        getUser: async () => response,
      }),
    );
    assert.equal(
      (await provider.readUserById(AUTH_USER_ID)).status,
      expectedStatus,
    );
  }
});
