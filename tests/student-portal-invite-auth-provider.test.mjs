import assert from "node:assert/strict";
import test from "node:test";

import { createStudentPortalInviteAuthProvider } from "../src/lib/server/student-portal-invite-auth-provider.ts";

const AUTH_USER_ID = "10000000-0000-4000-8000-000000000001";

function client({ invite, getUser, listUsers = async () => ({ data: { users: [], nextPage: null }, error: null }) }) {
  return {
    auth: {
      admin: {
        inviteUserByEmail: invite,
        getUserById: getUser,
        listUsers,
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

test("provider reconciliation finds one exact normalized email without inviting", async () => {
  const calls = [];
  const provider = createStudentPortalInviteAuthProvider(
    client({
      invite: async () => {
        throw new Error("must not invite during readback");
      },
      getUser: async () => ({ data: { user: null }, error: null }),
      listUsers: async (input) => {
        calls.push(input);
        return {
          data: {
            users: [
              {
                id: AUTH_USER_ID,
                email: "Student@Example.com",
                confirmation_sent_at: "2026-09-07T10:00:00.000Z",
                email_confirmed_at: null,
              },
            ],
            nextPage: null,
          },
          error: null,
        };
      },
    }),
  );
  assert.deepEqual(await provider.findUserByExactEmail("student@example.com"), {
    status: "found",
    user: {
      authUserId: AUTH_USER_ID,
      email: "Student@Example.com",
      confirmedAt: null,
      confirmationSentAt: "2026-09-07T10:00:00.000Z",
    },
  });
  assert.deepEqual(calls, [{ page: 1, perPage: 1000 }]);
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

test("provider classifies an occupied email via the trusted admin lookup (PORT-1b)", async () => {
  const occupied = (user, expectedCode) => async () => {
    const provider = createStudentPortalInviteAuthProvider(
      client({
        invite: async () => ({
          data: { user: null },
          error: { status: 422, code: "email_exists", name: "AuthApiError" },
        }),
        getUser: async () => ({ data: { user: null }, error: null }),
        listUsers: async () => ({
          data: { users: user ? [user] : [], nextPage: null },
          error: null,
        }),
      }),
    );
    assert.deepEqual(
      await provider.inviteUserByEmail({
        email: "student@example.com",
        redirectTo: "http://127.0.0.1:3000/auth/callback",
      }),
      { status: "definite_failure", code: expectedCode },
    );
  };

  await occupied(
    {
      id: AUTH_USER_ID,
      email: "student@example.com",
      app_metadata: { evo_staff_password_request_id: AUTH_USER_ID },
    },
    "existing_staff_account",
  )();
  await occupied(
    {
      id: AUTH_USER_ID,
      email: "student@example.com",
      invited_at: "2026-09-10T10:00:00.000Z",
      app_metadata: {},
    },
    "already_accepted_invite",
  )();
  await occupied(
    {
      id: AUTH_USER_ID,
      email: "Student@Example.com",
      app_metadata: {},
      user_metadata: {},
    },
    "existing_student_account",
  )();
  // No matching user (or an unavailable lookup) keeps the honest legacy code.
  await occupied(null, "portal_invite_already_accepted")();
});

test("provider keeps the legacy occupied-email code when the lookup is unavailable", async () => {
  const provider = createStudentPortalInviteAuthProvider(
    client({
      invite: async () => ({
        data: { user: null },
        error: { status: 422, code: "email_address_exists", name: "AuthApiError" },
      }),
      getUser: async () => ({ data: { user: null }, error: null }),
      listUsers: async () => ({ data: { users: null }, error: { status: 500 } }),
    }),
  );
  assert.deepEqual(
    await provider.inviteUserByEmail({
      email: "student@example.com",
      redirectTo: "http://127.0.0.1:3000/auth/callback",
    }),
    { status: "definite_failure", code: "portal_invite_already_accepted" },
  );
});
