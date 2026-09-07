import assert from "node:assert/strict";
import test from "node:test";

import { verifyStudentInviteCallback } from "../src/lib/server/student-invite-callback-verification.ts";

const AUTH_USER_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN_HASH = "b".repeat(56);

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      verifyInviteOtp: async (input) => {
        calls.push(["verify", input]);
        return {
          status: "verified",
          identity: {
            authUserId: AUTH_USER_ID,
            email: "Student@Example.com ",
          },
        };
      },
      readVerifiedIdentity: async () => {
        calls.push(["read-session"]);
        return { status: "anonymous", identity: null };
      },
      acceptReceiptIdentity: async (identity) => {
        calls.push(["accept", identity]);
        return { status: "accepted" };
      },
      clearLocalSession: async () => {
        calls.push(["sign-out"]);
      },
      ...overrides,
    },
  };
}

test("verified invite accepts only the durable exact identity", async () => {
  const setup = dependencies();
  const result = await verifyStudentInviteCallback(
    { tokenHash: TOKEN_HASH, type: "invite" },
    setup.dependencies,
  );

  assert.deepEqual(result, { status: "set_password" });
  assert.deepEqual(setup.calls, [
    ["verify", { tokenHash: TOKEN_HASH, type: "invite" }],
    [
      "accept",
      { authUserId: AUTH_USER_ID, normalizedEmail: "student@example.com" },
    ],
  ]);
});

test("consumed-token replay preserves and accepts a matching verified session", async () => {
  const setup = dependencies({
    verifyInviteOtp: async (input) => {
      setup.calls.push(["verify", input]);
      return { status: "rejected", identity: null };
    },
    readVerifiedIdentity: async () => {
      setup.calls.push(["read-session"]);
      return {
        status: "authenticated",
        identity: { authUserId: AUTH_USER_ID, email: "student@example.com" },
      };
    },
  });

  const result = await verifyStudentInviteCallback(
    { tokenHash: TOKEN_HASH, type: "invite" },
    setup.dependencies,
  );

  assert.deepEqual(result, { status: "set_password" });
  assert.deepEqual(setup.calls.map(([name]) => name), [
    "verify",
    "read-session",
    "accept",
  ]);
});

test("expired invite without a matching session is bounded and never reissues", async () => {
  const setup = dependencies({
    verifyInviteOtp: async (input) => {
      setup.calls.push(["verify", input]);
      return { status: "rejected", identity: null };
    },
  });

  const result = await verifyStudentInviteCallback(
    { tokenHash: TOKEN_HASH, type: "invite" },
    setup.dependencies,
  );

  assert.deepEqual(result, { status: "expired_or_used" });
  assert.deepEqual(setup.calls.map(([name]) => name), [
    "verify",
    "read-session",
  ]);
});

test("foreign or malformed identity is cleared and cannot reach password setup", async () => {
  for (const identity of [
    { authUserId: AUTH_USER_ID, email: "student@example.com" },
    { authUserId: "not-a-uuid", email: "student@example.com" },
    { authUserId: AUTH_USER_ID, email: "not-an-email" },
  ]) {
    const setup = dependencies({
      verifyInviteOtp: async (input) => {
        setup.calls.push(["verify", input]);
        return { status: "verified", identity };
      },
      acceptReceiptIdentity: async (acceptedIdentity) => {
        setup.calls.push(["accept", acceptedIdentity]);
        return { status: "mismatch" };
      },
    });

    const result = await verifyStudentInviteCallback(
      { tokenHash: TOKEN_HASH, type: "invite" },
      setup.dependencies,
    );
    assert.deepEqual(result, { status: "invalid_identity" });
    assert.equal(setup.calls.at(-1)?.[0], "sign-out");
  }
});

test("Auth and receipt uncertainty stay unavailable without session fallback", async () => {
  {
    const setup = dependencies({
      verifyInviteOtp: async (input) => {
        setup.calls.push(["verify", input]);
        return { status: "unavailable", identity: null };
      },
    });
    assert.deepEqual(
      await verifyStudentInviteCallback(
        { tokenHash: TOKEN_HASH, type: "invite" },
        setup.dependencies,
      ),
      { status: "auth_unavailable" },
    );
    assert.deepEqual(setup.calls.map(([name]) => name), ["verify"]);
  }

  {
    const setup = dependencies({
      acceptReceiptIdentity: async (identity) => {
        setup.calls.push(["accept", identity]);
        return { status: "unavailable" };
      },
    });
    assert.deepEqual(
      await verifyStudentInviteCallback(
        { tokenHash: TOKEN_HASH, type: "invite" },
        setup.dependencies,
      ),
      { status: "auth_unavailable" },
    );
    assert.doesNotMatch(
      setup.calls.map(([name]) => name).join(","),
      /sign-out/u,
    );
  }
});
