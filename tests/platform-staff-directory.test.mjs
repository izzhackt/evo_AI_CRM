import assert from "node:assert/strict";
import test from "node:test";

import { isConnectedPlatformStaffSettingsRequest } from "../src/lib/platform-route-contract.ts";
import {
  PLATFORM_MEMBERSHIP_STATUSES,
  PLATFORM_STAFF_ROLES,
  isPlatformMembershipStatus,
  isPlatformStaffRole,
} from "../src/lib/platform-staff-roles.ts";

function query(value) {
  return new URLSearchParams(value);
}

test("the staff surface accepts only its exact tab and outcome keys", () => {
  assert.equal(
    isConnectedPlatformStaffSettingsRequest("/settings", query("tab=staff")),
    true,
  );
  assert.equal(
    isConnectedPlatformStaffSettingsRequest(
      "/settings",
      query("tab=staff&staff_result=provisioned"),
    ),
    true,
  );
});

test("a crafted link cannot smuggle extra state into the staff surface", () => {
  for (const raw of [
    "tab=staff&organization_id=00000000-0000-4000-8000-000000000000",
    "tab=staff&role=admin",
    "tab=staff&membership_id=1",
    "tab=staff&staff_result=provisioned&staff_result=rejected",
    "tab=staff&tab=audit",
  ]) {
    assert.equal(
      isConnectedPlatformStaffSettingsRequest("/settings", query(raw)),
      false,
      raw,
    );
  }
});

test("the staff surface is bound to its own path and tab", () => {
  assert.equal(
    isConnectedPlatformStaffSettingsRequest("/settings", query("tab=audit")),
    false,
  );
  assert.equal(
    isConnectedPlatformStaffSettingsRequest("/settings", query("")),
    false,
  );
  assert.equal(
    isConnectedPlatformStaffSettingsRequest("/portal", query("tab=staff")),
    false,
  );
});

test("staff roles exclude the client-facing role", () => {
  assert.deepEqual(PLATFORM_STAFF_ROLES, [
    "admin",
    "sales",
    "curator",
    "finance",
  ]);
  // `student` is a real platform role but never a staff role: offering it here
  // would let an administrator move a colleague onto the client surface.
  assert.equal(isPlatformStaffRole("student"), false);
  assert.equal(isPlatformStaffRole("visa"), false);
  assert.equal(isPlatformStaffRole(""), false);
});

test("membership statuses match the database enum exactly", () => {
  assert.deepEqual(PLATFORM_MEMBERSHIP_STATUSES, [
    "invited",
    "active",
    "inactive",
    "blocked",
  ]);
  for (const status of PLATFORM_MEMBERSHIP_STATUSES) {
    assert.equal(isPlatformMembershipStatus(status), true, status);
  }
  assert.equal(isPlatformMembershipStatus("deleted"), false);
  assert.equal(isPlatformMembershipStatus("ACTIVE"), false);
});
