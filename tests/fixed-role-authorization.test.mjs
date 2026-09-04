import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_ROLE_CAPABILITIES,
  canAdminSelectEffectiveRole,
  fixedRoleCan,
  fixedRoleCanAccessRoute,
  fixedRoleHomeRoute,
} from "../src/lib/fixed-role-policy.ts";

test("fixed roles enforce the Sales, Admissions and Admin union", () => {
  for (const capability of [
    "sales.read",
    "sales.write",
    "messaging.read",
    "messaging.send",
  ]) {
    assert.equal(fixedRoleCan("sales", capability), true, capability);
  }
  for (const capability of [
    "admissions.read",
    "admissions.write",
    "documents.read",
    "documents.write",
  ]) {
    assert.equal(fixedRoleCan("sales", capability), false, capability);
  }

  for (const capability of [
    "admissions.read",
    "admissions.write",
    "documents.read",
    "documents.write",
    "messaging.read",
    "messaging.send",
  ]) {
    assert.equal(fixedRoleCan("admissions", capability), true, capability);
  }
  for (const capability of ["sales.read", "sales.write"]) {
    assert.equal(fixedRoleCan("admissions", capability), false, capability);
  }

  for (const capability of FIXED_ROLE_CAPABILITIES) {
    assert.equal(fixedRoleCan("admin", capability), true, capability);
  }
});

test("the same policy resolves home routes and direct page access", () => {
  assert.equal(fixedRoleHomeRoute("admin"), "/v3/main");
  assert.equal(fixedRoleHomeRoute("sales"), "/v3/main");
  assert.equal(fixedRoleHomeRoute("admissions"), "/v3/calendar");

  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/main"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/pipeline"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/calendar"), false);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/knowledge"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/main"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/pipeline"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/calendar"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/knowledge"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/profile"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/profile"), true);
  assert.equal(fixedRoleCanAccessRoute("admin", "/v3/settings"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/v3/settings"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/v3/settings"), false);
});

test("only Admin authority can select an exact fixed-role preview", () => {
  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(canAdminSelectEffectiveRole("admin", role), true, role);
  }
  assert.equal(canAdminSelectEffectiveRole("sales", "admin"), false);
  assert.equal(canAdminSelectEffectiveRole("sales", "sales"), false);
  assert.equal(canAdminSelectEffectiveRole("admissions", "sales"), false);
  assert.equal(canAdminSelectEffectiveRole("admin", "curator"), false);
  assert.equal(canAdminSelectEffectiveRole("admin", "finance"), false);
});
