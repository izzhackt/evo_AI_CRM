import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeVerifiedStudentPortalAuthority,
  readVerifiedStudentPortalAuthority,
} from "../src/lib/supabase/student-portal-authority.ts";

const AUTH_USER_ID = "10000000-0000-4000-8000-000000000001";
const PROFILE_ID = "20000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "40000000-0000-4000-8000-000000000001";
const BUNDLE_ID = "50000000-0000-4000-8000-000000000001";
const CASE_ID = "60000000-0000-4000-8000-000000000001";

function claims(overrides = {}) {
  return {
    sub: AUTH_USER_ID,
    email: "student@example.com",
    platform_bundle_id: BUNDLE_ID,
    platform_bundle_version: 3,
    user_metadata: {
      platform_role: "admin",
      organization_id: "attacker-controlled",
    },
    ...overrides,
  };
}

function authorityRow(overrides = {}) {
  return {
    auth_user_id: AUTH_USER_ID,
    profile_id: PROFILE_ID,
    membership_id: MEMBERSHIP_ID,
    organization_id: ORGANIZATION_ID,
    display_name: "Айжан Тестова",
    platform_role: "student",
    platform_access_version: 7,
    ...overrides,
  };
}

function portalCaseRow(overrides = {}) {
  return {
    case_id: CASE_ID,
    case_state: "active",
    portal_activated_at: "2026-09-07T08:00:00.000Z",
    ...overrides,
  };
}

test("strict Student authority accepts one activated exact-case projection", () => {
  assert.deepEqual(
    decodeVerifiedStudentPortalAuthority(
      claims(),
      [authorityRow()],
      [portalCaseRow()],
    ),
    {
      authUserId: AUTH_USER_ID,
      profileId: PROFILE_ID,
      membershipId: MEMBERSHIP_ID,
      organizationId: ORGANIZATION_ID,
      studentCaseId: CASE_ID,
      displayName: "Айжан Тестова",
      email: "student@example.com",
      databaseRole: "student",
      platformAccessVersion: 7,
      platformBundleId: BUNDLE_ID,
      platformBundleVersion: 3,
      caseState: "active",
      portalActivatedAt: "2026-09-07T08:00:00.000Z",
    },
  );
});

test("Student authority never accepts staff roles or user_metadata as authority", () => {
  assert.equal(
    decodeVerifiedStudentPortalAuthority(
      claims(),
      [authorityRow({ platform_role: "admin" })],
      [portalCaseRow()],
    ),
    null,
  );
  assert.equal(
    decodeVerifiedStudentPortalAuthority(
      claims({ platform_bundle_id: undefined }),
      [authorityRow()],
      [portalCaseRow()],
    ),
    null,
  );
});

test("Student authority fails closed for missing, duplicate, inactive or malformed case projections", () => {
  for (const rows of [
    [],
    [portalCaseRow(), portalCaseRow({ case_id: PROFILE_ID })],
    [portalCaseRow({ case_state: "pending" })],
    [portalCaseRow({ portal_activated_at: null })],
    [portalCaseRow({ case_id: "not-a-uuid" })],
  ]) {
    assert.equal(
      decodeVerifiedStudentPortalAuthority(claims(), [authorityRow()], rows),
      null,
    );
  }
});

test("Student authority reader uses only current authority and portal-case RPCs", async () => {
  const calls = [];
  const client = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name) {
          calls.push(name);
          if (name === "current_actor_authority") {
            return { data: [authorityRow()], error: null };
          }
          if (name === "student_portal_cases") {
            return { data: [portalCaseRow()], error: null };
          }
          throw new Error(`unexpected RPC ${name}`);
        },
      };
    },
  };

  const result = await readVerifiedStudentPortalAuthority(client, claims());
  assert.equal(result.status, "authenticated");
  assert.equal(result.authority.studentCaseId, CASE_ID);
  assert.deepEqual(calls, ["current_actor_authority", "student_portal_cases"]);
});

test("Student authority reader distinguishes invalid authority from RPC unavailability", async () => {
  const invalidClient = {
    schema() {
      return {
        async rpc() {
          return { data: [authorityRow({ platform_role: "sales" })], error: null };
        },
      };
    },
  };
  assert.deepEqual(
    await readVerifiedStudentPortalAuthority(invalidClient, claims()),
    { status: "invalid", authority: null },
  );

  const unavailableClient = {
    schema() {
      return {
        async rpc() {
          return { data: null, error: { code: "PGRST500" } };
        },
      };
    },
  };
  assert.deepEqual(
    await readVerifiedStudentPortalAuthority(unavailableClient, claims()),
    { status: "unavailable", authority: null },
  );
});
