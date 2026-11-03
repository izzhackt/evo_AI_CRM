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
  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(fixedRoleCanAccessRoute(role, "/tasks"), true);
    assert.equal(fixedRoleCanAccessRoute(role, "/team-chat"), true);
  }
  assert.equal(fixedRoleHomeRoute("admin"), "/main");
  assert.equal(fixedRoleHomeRoute("sales"), "/main");
  assert.equal(fixedRoleHomeRoute("admissions"), "/main");

  assert.equal(fixedRoleCanAccessRoute("sales", "/main"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/pipeline"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/calendar"), false);
  assert.equal(fixedRoleCan("sales", "documents.read"), false);
  assert.equal(fixedRoleCanAccessRoute("sales", "/knowledge"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/main"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/pipeline"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/calendar"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/knowledge"), false);
  assert.equal(fixedRoleCanAccessRoute("sales", "/profile"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/profile"), true);
  assert.equal(fixedRoleCanAccessRoute("admin", "/settings"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/settings"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/settings"), false);
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
