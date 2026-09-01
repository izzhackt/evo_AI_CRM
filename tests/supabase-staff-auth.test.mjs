import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FIXED_ROLES,
  canAdminSelectEffectiveRole,
  fixedRoleCan,
} from "../src/lib/fixed-role-policy.ts";
import {
  DATABASE_STAFF_ROLES,
  databaseRoleToInterfaceRole,
  readVerifiedPlatformAuthority,
} from "../src/lib/supabase/platform-authority.ts";

const authUserId = "00000000-0000-4000-8000-000000000101";
const profileId = "00000000-0000-4000-8000-000000000201";
const membershipId = "00000000-0000-4000-8000-000000000301";
const organizationId = "00000000-0000-4000-8000-000000000401";
const bundleId = "00000000-0000-4000-8000-000000000501";

function claims(overrides = {}) {
  return {
    sub: authUserId,
    email: "staff@example.invalid",
    platform_bundle_id: bundleId,
    platform_bundle_version: 13,
    ...overrides,
  };
}

function clientWithResult({ data, error = null }) {
  return {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(functionName) {
          assert.equal(functionName, "current_actor_authority");
          return { data, error };
        },
      };
    },
  };
}

test("one fixed UI role set maps the retained curator value to Admissions", () => {
  assert.deepEqual(FIXED_ROLES, ["admin", "sales", "admissions"]);
  assert.deepEqual(DATABASE_STAFF_ROLES, ["admin", "sales", "curator"]);
  assert.equal(databaseRoleToInterfaceRole("admin"), "admin");
  assert.equal(databaseRoleToInterfaceRole("sales"), "sales");
  assert.equal(databaseRoleToInterfaceRole("curator"), "admissions");
});

test("Admin is the functional superset and only Admin can choose preview roles", () => {
  for (const capability of [
    "sales.read",
    "sales.write",
    "admissions.read",
    "admissions.write",
    "documents.read",
    "documents.write",
    "messaging.read",
    "messaging.send",
    "admin.preview",
  ]) {
    assert.equal(fixedRoleCan("admin", capability), true, capability);
  }
  assert.equal(canAdminSelectEffectiveRole("admin", "sales"), true);
  assert.equal(canAdminSelectEffectiveRole("admin", "admissions"), true);
  assert.equal(canAdminSelectEffectiveRole("sales", "admin"), false);
});

test("verified claims still require exactly one live database authority", async () => {
  const result = await readVerifiedPlatformAuthority(
    clientWithResult({
      data: [
        {
          auth_user_id: authUserId,
          profile_id: profileId,
          membership_id: membershipId,
          organization_id: organizationId,
          display_name: "Sales Manager",
          platform_role: "sales",
          platform_access_version: 2,
        },
      ],
    }),
    claims(),
  );

  assert.deepEqual(result, {
    status: "authenticated",
    authority: {
      authUserId,
      profileId,
      membershipId,
      organizationId,
      displayName: "Sales Manager",
      databaseRole: "sales",
      platformAccessVersion: 2,
      platformBundleId: bundleId,
      platformBundleVersion: 13,
      email: "staff@example.invalid",
    },
  });

  assert.deepEqual(
    await readVerifiedPlatformAuthority(clientWithResult({ data: [] }), claims()),
    { status: "invalid", authority: null },
  );
  assert.deepEqual(
    await readVerifiedPlatformAuthority(
      clientWithResult({ data: null, error: { code: "PGRST" } }),
      claims(),
    ),
    { status: "unavailable", authority: null },
  );
});

test("missing or malformed identity claims fail before a database authority is accepted", async () => {
  const unexpectedClient = {
    schema() {
      throw new Error("RPC must not run for malformed claims");
    },
  };
  for (const invalidClaims of [
    claims({ sub: "not-a-uuid" }),
    claims({ email: "" }),
    claims({ platform_bundle_id: null }),
    claims({ platform_bundle_version: 0 }),
  ]) {
    assert.deepEqual(
      await readVerifiedPlatformAuthority(unexpectedClient, invalidClaims),
      { status: "invalid", authority: null },
    );
  }
});

test("the runtime uses Supabase SSR cookies and never trusts getSession for authorization", async () => {
  const [server, browser, proxy, actions, envExample] = await Promise.all([
    readFile(new URL("../src/lib/supabase/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/browser.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/staff-auth-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(server, /createServerClient/);
  assert.match(server, /cookieStore\.getAll\(\)/);
  assert.match(browser, /createBrowserClient/);
  assert.match(proxy, /auth\.getClaims\(\)/);
  assert.match(proxy, /readVerifiedPlatformAuthority/);
  assert.doesNotMatch(proxy, /getSession\(/);
  assert.match(actions, /signInWithPassword/);
  assert.match(actions, /signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(envExample, /EVO_DEV_GATE_/);
});
