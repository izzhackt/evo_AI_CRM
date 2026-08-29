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
  assert.equal(fixedRoleHomeRoute("admin"), "/sales");
  assert.equal(fixedRoleHomeRoute("sales"), "/sales");
  assert.equal(fixedRoleHomeRoute("admissions"), "/clients");

  assert.equal(fixedRoleCanAccessRoute("sales", "/sales"), true);
  assert.equal(fixedRoleCanAccessRoute("sales", "/clients"), false);
  assert.equal(fixedRoleCanAccessRoute("sales", "/applications"), false);
  assert.equal(fixedRoleCanAccessRoute("sales", "/documents"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/sales"), false);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/clients"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/applications"), true);
  assert.equal(fixedRoleCanAccessRoute("admissions", "/documents"), true);
  assert.equal(fixedRoleCanAccessRoute("admin", "/documents"), true);
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
