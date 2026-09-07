import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveStudentPortalActor,
} from "../src/lib/student-portal-auth.ts";
import {
  studentPortalGuardDestination,
} from "../src/lib/student-portal-guard-policy.ts";

const AUTH_USER_ID = "10000000-0000-4000-8000-000000000001";
const PROFILE_ID = "20000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "40000000-0000-4000-8000-000000000001";
const BUNDLE_ID = "50000000-0000-4000-8000-000000000001";
const CASE_ID = "60000000-0000-4000-8000-000000000001";

function claims() {
  return {
    sub: AUTH_USER_ID,
    email: "student@example.com",
    platform_bundle_id: BUNDLE_ID,
    platform_bundle_version: 2,
  };
}

function client({ claimsError = null, claimsValue = claims(), role = "student" } = {}) {
  return {
    auth: {
      async getClaims() {
        return {
          data: claimsValue ? { claims: claimsValue } : null,
          error: claimsError,
        };
      },
    },
    schema() {
      return {
        async rpc(name) {
          if (name === "current_actor_authority") {
            return {
              data: [{
                auth_user_id: AUTH_USER_ID,
                profile_id: PROFILE_ID,
                membership_id: MEMBERSHIP_ID,
                organization_id: ORGANIZATION_ID,
                display_name: "Айжан Тестова",
                platform_role: role,
                platform_access_version: 4,
              }],
              error: null,
            };
          }
          return {
            data: [{
              case_id: CASE_ID,
              case_state: "active",
              portal_activated_at: "2026-09-07T08:00:00.000Z",
            }],
            error: null,
          };
        },
      };
    },
  };
}

test("Student resolver returns one active portal actor", async () => {
  const result = await resolveStudentPortalActor({
    createClient: async () => client(),
  });
  assert.equal(result.status, "authenticated");
  assert.equal(result.actor.studentCaseId, CASE_ID);
  assert.equal(result.actor.databaseRole, "student");
});

test("Student resolver keeps missing sessions separate from rejected authority", async () => {
  assert.deepEqual(
    await resolveStudentPortalActor({
      createClient: async () => client({
        claimsError: { name: "AuthSessionMissingError" },
        claimsValue: null,
      }),
    }),
    { status: "anonymous", actor: null },
  );

  const rejected = await resolveStudentPortalActor({
    createClient: async () => client({ role: "admin" }),
  });
  assert.deepEqual(rejected, {
    status: "invalid",
    actor: null,
    reason: "student_authority_invalid",
  });
});

test("Student resolver fails closed when Auth or authority is unavailable", async () => {
  assert.deepEqual(
    await resolveStudentPortalActor({
      createClient: async () => {
        throw new Error("configuration missing");
      },
    }),
    {
      status: "invalid",
      actor: null,
      reason: "student_authority_unavailable",
    },
  );

  const result = await resolveStudentPortalActor({
    createClient: async () => client({ claimsError: { name: "network" } }),
  });
  assert.deepEqual(result, {
    status: "invalid",
    actor: null,
    reason: "supabase_session_invalid",
  });
});

test("Student guard destinations are bounded and never route to staff UI", () => {
  assert.equal(
    studentPortalGuardDestination({ status: "anonymous", actor: null }),
    "/login",
  );
  assert.equal(
    studentPortalGuardDestination({
      status: "invalid",
      actor: null,
      reason: "student_authority_invalid",
    }),
    "/login?error=session_invalid",
  );
  assert.equal(
    studentPortalGuardDestination({
      status: "invalid",
      actor: null,
      reason: "student_authority_unavailable",
    }),
    "/login?error=auth_unavailable",
  );
  assert.equal(
    studentPortalGuardDestination({ status: "authenticated", actor: {} }),
    null,
  );
});

test("Student logout uses the local Supabase scope and never a provider/global mutation", () => {
  const source = readFileSync(
    new URL("../src/lib/student-portal-auth-actions.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /logoutStudentPortalAction/u);
  assert.match(source, /signOut\(\{ scope: "local" \}\)/u);
  assert.match(source, /redirect\("\/login"\)/u);
  assert.doesNotMatch(source, /scope: "global"|auth\.admin/u);
});
