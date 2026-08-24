import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PLATFORM_MEMBERSHIP_STATUSES,
  PLATFORM_SENSITIVE_PERMISSIONS,
  PLATFORM_STAFF_ROLES,
  isPlatformMembershipStatus,
  isPlatformSensitivePermission,
  isPlatformStaffRole,
} from "../src/lib/platform-staff-roles.ts";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/083_platform_unified_staff_access.sql");
const auth = read("src/lib/platform-auth.ts");
const actions = read("src/lib/platform-staff-actions.ts");
const directory = read("src/lib/platform-staff-directory.ts");
const settings = read("src/app/(staff)/settings/PlatformStaffSettingsPage.tsx");
const routeContract = read("src/lib/platform-route-contract.ts");

test("U1 exposes exactly three pilot staff roles and the complete lifecycle", () => {
  assert.deepEqual(PLATFORM_STAFF_ROLES, ["admin", "sales", "curator"]);
  assert.deepEqual(PLATFORM_MEMBERSHIP_STATUSES, [
    "invited",
    "active",
    "suspended",
    "inactive",
    "blocked",
  ]);
  assert.deepEqual(PLATFORM_SENSITIVE_PERMISSIONS, [
    "contract.evidence.confirm",
    "finance.first.payment.confirm",
  ]);
  assert.equal(isPlatformStaffRole("finance"), false);
  assert.equal(isPlatformStaffRole("student"), false);
  assert.equal(isPlatformMembershipStatus("suspended"), true);
  assert.equal(isPlatformSensitivePermission("finance.event.confirm"), false);
});

test("JWT and live authority bind organization, membership, bundle, role and access version", () => {
  for (const claim of [
    "platform_organization_id",
    "platform_membership_id",
    "platform_bundle_id",
    "platform_bundle_version",
    "platform_role",
    "platform_access_version",
  ]) {
    assert.match(migration, new RegExp(claim));
    assert.match(auth, new RegExp(claim));
  }
  assert.match(migration, /membership\.organization_id::TEXT =/);
  assert.match(migration, /membership\.id::TEXT =/);
  assert.match(migration, /bundle\.id::TEXT =/);
  assert.match(migration, /bundle\.version::TEXT =/);
  assert.match(migration, /claims := claims \|\| \(authorities -> 0\)/);
  assert.match(
    migration,
    /membership\."current_role" IN \('admin', 'sales', 'curator', 'student'\)/,
  );
});

test("sensitive permissions are append-only individual grants and revoke resident authority", () => {
  assert.match(migration, /CREATE TABLE platform\.membership_permission_events/);
  assert.match(migration, /membership_permission_events_append_only_rows/);
  assert.match(migration, /membership\.permission\.change/);
  assert.match(migration, /platform_private\.bump_access_version\(target_profile_id\)/);
  assert.match(migration, /p_permission_key IN \(\s*'finance\.event\.confirm'/);
  assert.match(migration, /platform\.assert_sensitive_permission/);
});

test("only audited U1 RPCs are reachable from the connected Admin surface", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION platform\.provision_member/);
  assert.match(migration, /REVOKE ALL ON FUNCTION platform\.change_membership_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION platform\.change_membership_status/);
  assert.match(actions, /provision_pilot_staff_member/);
  assert.match(actions, /change_pilot_staff_role/);
  assert.match(actions, /change_pilot_staff_status/);
  assert.match(actions, /change_membership_permission/);
  assert.match(migration, /platform\.assign_organization_scope\(/);
  assert.match(migration, /:u1-pilot-organization-scope/);
  assert.match(migration, /'organization_scope_assigned', TRUE/);
  assert.doesNotMatch(actions, /service[_-]?role/i);
  assert.match(directory, /platformRole !== "admin"/);
  assert.match(settings, /Подтверждение первого платежа/);
  assert.match(routeContract, /role === "finance".*"\/platform-pending"/s);
});
