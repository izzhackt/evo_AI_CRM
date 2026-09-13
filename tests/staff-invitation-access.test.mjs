import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { invitationAccessIsValid, staffReconcileAllowsPreparation, supportedStaffInviteScopes } from "../src/lib/v3/staff-invitation-access.ts";
import { staffAuthConflictMessage } from "../src/lib/v3/wording.ts";
import nextConfig from "../next.config.ts";

const role = { id: "role", label: "Published", status: "active", version: 3, bundleId: "bundle", permissionKeys: ["case.read.full", "task.manage"] };
const workspace = { roles: [role], permissions: [
  { key: "case.read.full", allowedScopes: ["own", "organization", "department", "direction", "record"] },
  { key: "task.manage", allowedScopes: ["own", "organization", "department", "direction", "record"] },
], departments: [{ id: "department", status: "active" }, { id: "archived", status: "archived" }] };
const assignment = (kind, key) => ({ roleId: role.id, roleVersion: 3, scope: { kind, key, resourceKind: null } });

test("invitation readiness keeps paired versioned scopes and explicit empty access", () => {
  for (const [kind, key] of [["own", null], ["organization", "org"], ["department", "department"], ["direction", "CN"], ["direction", "EUROPE"]]) {
    assert.equal(invitationAccessIsValid([assignment(kind, key)], false, workspace, "org"), true);
  }
  assert.equal(invitationAccessIsValid([], false, workspace, "org"), false);
  assert.equal(invitationAccessIsValid([], true, workspace, "org"), true);
  assert.equal(invitationAccessIsValid([assignment("direction", "CN"), assignment("organization", "org")], false, workspace, "org"), true);
});

test("readiness rejects stale roles, unsupported or unavailable scopes and duplicate assignments", () => {
  const own = assignment("own", null);
  for (const rows of [[{ ...own, roleVersion: 2 }], [assignment("own", "org")], [assignment("organization", "other")],
    [assignment("department", "archived")], [assignment("department", "missing")], [assignment("direction", "EU")],
    [assignment("record", "case")], [{ ...own, scope: { ...own.scope, resourceKind: "student_case" } }], [own, own]]) {
    assert.equal(invitationAccessIsValid(rows, false, workspace, "org"), false);
  }
  assert.equal(invitationAccessIsValid([own], false, { ...workspace, roles: [{ ...role, status: "archived" }] }, "org"), false);
  assert.equal(invitationAccessIsValid([own], false, { ...workspace, roles: [{ ...role, bundleId: null }] }, "org"), false);
});

test("scope choices require every role permission to support the scope", () => {
  assert.deepEqual(supportedStaffInviteScopes(workspace, "role"), ["own", "organization", "department", "direction"]);
  assert.deepEqual(supportedStaffInviteScopes({ ...workspace, permissions: [...workspace.permissions.slice(0, 1), { key: "task.manage", allowedScopes: ["organization"] }] }, "role"), ["organization"]);
  assert.deepEqual(supportedStaffInviteScopes({ ...workspace, permissions: [] }, "role"), []);
  assert.deepEqual(supportedStaffInviteScopes(workspace, "missing"), []);
});

test("invitation conflicts have actionable Russian copy instead of internal codes", () => {
  for (const code of ["legacy_access_review_required", "prepared_access_invalid", "role_version_changed", "scope_changed", "identity_already_linked", "recovery_target_unavailable"]) {
    assert.match(staffAuthConflictMessage(code), /[А-Яа-я]/u);
    assert.ok(!staffAuthConflictMessage(code).includes(code));
  }
  assert.equal(staffAuthConflictMessage(null), null);
});

test("UI keeps original commands and offers no unconditional new invitation escape", () => {
  const source = (file) => readFileSync(new URL(`../src/components/v3/settings/${file}`, import.meta.url), "utf8");
  const hook = source("useStaffCommandForm.tsx");
  assert.match(hook, /original\.current = copyForm\(form\)/u);
  assert.match(hook, /const command = copyForm\(original\.current\)/u);
  assert.match(hook, /outcome: "unknown"/u);
  assert.doesNotMatch(source("StaffSection.tsx"), /STAFF_ROLES|STAFF_ROLE_LABELS|setInviteKey/u);
  assert.match(source("StaffInviteForm.tsx"), /state\.status === "success" \? <button/u);
  assert.match(source("StaffPendingAccess.tsx"), /disabled=\{pending \|\| writeLocked \|\| reconcileLocked\}/u);
  assert.match(source("StaffPendingAccess.tsx"), /command_request_id/u);
});

test("confirmed access-review response opens preparation without treating an unknown transport as settled", () => {
  const unknown = { status: "error", message: "", outcome: "unknown" };
  assert.equal(staffReconcileAllowsPreparation(unknown), false);
  assert.equal(staffReconcileAllowsPreparation({ ...unknown, conflictCode: "unrecognized" }), false);
  assert.equal(staffReconcileAllowsPreparation({ ...unknown, conflictCode: "identity_already_linked" }), false);
  for (const conflictCode of ["legacy_access_review_required", "prepared_access_invalid", "role_version_changed", "scope_changed"]) {
    assert.equal(staffReconcileAllowsPreparation({ ...unknown, conflictCode }), true);
    assert.equal(staffReconcileAllowsPreparation({ ...unknown, conflictCode, metadataOutcome: "unknown" }), false);
  }
  assert.equal(staffReconcileAllowsPreparation({ status: "success", message: "" }), true);
});

test("status restart is explicit and invitation operations share a parent interlock", () => {
  const section = readFileSync(new URL("../src/components/v3/settings/StaffSection.tsx", import.meta.url), "utf8");
  const preparation = readFileSync(new URL("../src/components/v3/settings/StaffPendingAccess.tsx", import.meta.url), "utf8");
  assert.match(section, /state\.status === "success" && state\.outcome !== "unknown"/u);
  assert.match(section, /<MemberChangeForm key=\{command\}/u);
  assert.match(section, /onClick=\{onNext\}>Изменить доступ снова/u);
  assert.match(section, /activeOperation\.current !== null && activeOperation\.current !== next/u);
  assert.match(section, /disabled=\{pending \|\| operation === "prepare"\}/u);
  assert.match(section, /if \(!claim\("reconcile"\)\) return previous/u);
  assert.match(section, /if \(staffReconcileAllowsPreparation\(result\)\) release\("reconcile"\)/u);
  assert.match(preparation, /if \(!onPrepareStart\(\)\)/u);
  assert.match(preparation, /result\.outcome !== "unknown" && result\.metadataOutcome !== "unknown"/u);
  assert.match(preparation, /readPending=\{pending \|\| reconcileLocked\}/u);
});

test("development request logging excludes credential callbacks but keeps ordinary routes", () => {
  const ignored = (url) => nextConfig.logging.incomingRequests.ignore.some((pattern) => pattern.test(url));
  for (const url of ["/auth/staff", "/auth/staff?token_hash=local-fixture", "/auth/staff/?token_hash=local-fixture", "/auth/callback?code=local-fixture"]) {
    assert.equal(ignored(url), true);
  }
  for (const url of ["/login", "/v3/settings?section=staff", "/api/health", "/auth/staffing"]) assert.equal(ignored(url), false);
});
