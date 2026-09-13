import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStaffRoleAssignmentInputs,
  parseStaffRoleCommandResult,
  parseStaffRoleExpectedBindings,
  parseStaffRoleImpact,
  parseStaffRoleArchiveImpact,
  parseStaffRoleImpactFingerprint,
  parseStaffRoleScope,
  parseStaffRoleWorkspace,
} from "../src/lib/v3/staff-roles-contract.ts";

const id = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const permission = "case.document.read";
const assignment = { roleId: id(1), scope: { kind: "direction", key: "CN", resourceKind: null } };

test("archive preview preserves the reviewed role, choice and permission contribution", () => {
  const preview = { roleId: id(1), version: 2, affectedMembershipIds: [id(3)],
    addedPermissionKeys: [permission], removedPermissionKeys: ["case.read.full"],
    impactFingerprint: "b".repeat(64), replacementRoleId: id(2), revokeAssignments: false };
  assert.deepEqual(parseStaffRoleArchiveImpact(preview), preview);
  const removal = { ...preview, replacementRoleId: null, revokeAssignments: true, addedPermissionKeys: [] };
  assert.deepEqual(parseStaffRoleArchiveImpact(removal), removal);
  for (const invalidPreview of [
    { ...preview, replacementRoleId: "" }, { ...preview, revokeAssignments: "false" },
    { ...preview, replacementRoleId: preview.roleId }, { ...preview, revokeAssignments: true },
    { ...preview, unexpected: true }, { ...preview, impactFingerprint: null },
  ]) assert.throws(() => parseStaffRoleArchiveImpact(invalidPreview), /staff_roles_invalid_contract/);
  const incomplete = { ...preview };
  delete incomplete.replacementRoleId;
  assert.throws(() => parseStaffRoleArchiveImpact(incomplete), /staff_roles_invalid_contract/);
});
function workspace() {
  return {
    schemaVersion: 1,
    permissions: [{ key: permission, label: "Документы", group: "Поступление",
      allowedScopes: ["own", "direction"], resourceKinds: ["case"], sensitive: false, systemOnly: false }],
    roles: [{ id: id(1), label: "Куратор", description: "", status: "active", version: 2,
      bundleId: id(2), bundleVersion: 1, permissionKeys: [permission], draftPermissionKeys: [permission], memberCount: 1 }],
    members: [{ membershipId: id(3), displayName: "Сотрудник", systemRole: "staff", accessVersion: 1,
      assignments: [{ ...assignment, id: id(4), label: "Куратор", bundleId: id(2), bundleVersion: 1 }] }],
    departments: [{ id: id(5), name: "Поступление", status: "active" }],
  };
}
const invalid = { message: "staff_roles_invalid_contract" };

test("role workspace keeps role, scope and published bundle together", () => {
  assert.deepEqual(parseStaffRoleWorkspace(workspace()), workspace());
  const noRolesYet = workspace();
  noRolesYet.roles = [];
  noRolesYet.members[0].assignments = [];
  assert.deepEqual(parseStaffRoleWorkspace(noRolesYet), noRolesYet);
});

test("role workspace rejects missing fields, unknown permissions and orphan assignments", () => {
  for (const change of [
    (value) => { delete value.members; },
    (value) => { value.unexpected = true; },
    (value) => { value.roles[0].permissionKeys.push("unknown.permission"); },
    (value) => { value.roles[0].bundleVersion = null; },
    (value) => { value.roles[0].version = 0; },
    (value) => { value.members[0].assignments[0].roleId = id(99); },
    (value) => { value.members[0].accessVersion = 1.5; },
    (value) => { value.members.push(value.members[0]); },
    (value) => { value.permissions.push(value.permissions[0]); },
  ]) {
    const value = workspace();
    change(value);
    assert.throws(() => parseStaffRoleWorkspace(value), invalid);
  }
});

test("assignment input preserves multiple scoped roles and rejects ambiguous scopes", () => {
  const inputs = [assignment, { roleId: id(6), scope: { kind: "organization", key: id(7), resourceKind: null } }];
  assert.deepEqual(parseStaffRoleAssignmentInputs(inputs), inputs);
  assert.throws(() => parseStaffRoleAssignmentInputs([assignment, assignment]), invalid);
  assert.throws(() => parseStaffRoleAssignmentInputs(Array(101).fill(assignment)), invalid);
  for (const scope of [
    { kind: "own", key: id(7), resourceKind: null },
    { kind: "organization", key: null, resourceKind: null },
    { kind: "department", key: "not-an-id", resourceKind: null },
    { kind: "record", key: id(8), resourceKind: null },
    { kind: "direction", key: "CN", resourceKind: "case" },
  ]) assert.throws(() => parseStaffRoleScope(scope), invalid);
  assert.deepEqual(parseStaffRoleScope({ kind: "record", key: id(8), resourceKind: "case" }),
    { kind: "record", key: id(8), resourceKind: "case" });
});

test("role impact and command receipts require complete versioned results", () => {
  const impact = { roleId: id(1), version: 2, affectedMembershipIds: [id(3)],
    addedPermissionKeys: [permission], removedPermissionKeys: [], impactFingerprint: "a".repeat(64) };
  assert.deepEqual(parseStaffRoleImpact(impact), impact);
  assert.throws(() => parseStaffRoleImpact({ ...impact, affectedMembershipIds: [id(3), id(3)] }), invalid);
  for (const impactFingerprint of [undefined, "", "a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
    assert.throws(() => parseStaffRoleImpact({ ...impact, impactFingerprint }), invalid);
    assert.throws(() => parseStaffRoleImpactFingerprint(impactFingerprint), invalid);
  }
  assert.equal(parseStaffRoleImpactFingerprint(impact.impactFingerprint), impact.impactFingerprint);
  for (const status of ["applied", "replayed"]) {
    assert.deepEqual(parseStaffRoleCommandResult({ status, roleId: id(1), version: 3 }, "role"),
      { roleId: id(1), version: 3 });
    assert.deepEqual(parseStaffRoleCommandResult({ status, roleId: id(1), version: 3,
      bundleId: id(2), bundleVersion: 2, affectedMembershipIds: [id(3)] }, "publish"),
    { roleId: id(1), version: 3 });
    assert.deepEqual(parseStaffRoleCommandResult({ status, membershipId: id(3), accessVersion: 2 }, "assignments"),
      { membershipId: id(3), accessVersion: 2 });
    assert.deepEqual(parseStaffRoleCommandResult({ status, membershipId: id(3), accessVersion: 2, systemRole: "admin" }, "admin"),
      { membershipId: id(3), accessVersion: 2 });
  }
  assert.throws(() => parseStaffRoleCommandResult({ status: "success", roleId: id(1), version: 3 }, "role"), invalid);
  assert.throws(() => parseStaffRoleCommandResult({ status: "applied", roleId: id(1), version: 3 }, "publish"), invalid);
});

test("reviewed assignment bindings contain exactly one published version per selected role", () => {
  const binding = { roleId: id(1), roleVersion: 2, bundleId: id(2), bundleVersion: 1 };
  const twoScopes = [assignment, { ...assignment, scope: { kind: "own", key: null, resourceKind: null } }];
  assert.deepEqual(parseStaffRoleExpectedBindings([binding], twoScopes), [binding]);
  assert.deepEqual(parseStaffRoleExpectedBindings([], []), []);
  const second = { roleId: id(6), roleVersion: 4, bundleId: id(7), bundleVersion: 2 };
  assert.deepEqual(parseStaffRoleExpectedBindings([second, binding], [...twoScopes, { ...assignment, roleId: id(6) }]),
    [second, binding]);
  for (const bindings of [
    [], [binding, binding], [binding, second], [{ ...binding, roleId: id(6) }],
    [{ ...binding, bundleId: null }], [{ ...binding, roleVersion: 0 }],
    [{ ...binding, bundleVersion: 1.5 }], [{ ...binding, roleVersion: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...binding, bundleVersion: "1" }], [{ ...binding, unexpected: true }],
  ]) assert.throws(() => parseStaffRoleExpectedBindings(bindings, twoScopes), invalid);
  assert.throws(() => parseStaffRoleExpectedBindings([binding], []), invalid);
});
