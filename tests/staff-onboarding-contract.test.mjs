import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  parseStaffAuthPreparation, parseStaffInviteAssignmentInputs, parseStaffAuthInput,
  parseStaffPendingAccessInput, parseStaffAuthClaim, parseStaffAuthResult, parseStaffPendingAccessReceipt,
  parseStaffStatusInput, parseStaffStatusReceipt, isStaffCommandVersionRejection,
} from "../src/lib/v3/staff-workspace-contract.ts";

const ids = { org: "51000000-0000-4000-8000-000000000001", role: "51000000-0000-4000-8000-000000000002",
  bundle: "51000000-0000-4000-8000-000000000003", request: "51000000-0000-4000-8000-000000000004",
  command: "51000000-0000-4000-8000-000000000005", member: "51000000-0000-4000-8000-000000000006" };
const assignment = { roleId: ids.role, roleVersion: 3, scope: { kind: "direction", key: "CN", resourceKind: null } };
const prepared = { ...assignment, bundleId: ids.bundle, bundleVersion: 2, label: "Китай",
  permissionKeys: ["case.read.full", "task.create"] };
const preparation = { schemaVersion: 1, requestId: ids.request, operation: "invite", status: "reconciliation_required",
  displayName: "Synthetic employee", preparationVersion: 1, conflictCode: null, noAccess: false, targetMembershipId: null,
  assignments: [prepared] };
const expected = { requestId: ids.request, organizationId: ids.org };
test("only receipt-first status/preparation version rejections can settle an unknown local command", () => {
  assert.equal(isStaffCommandVersionRejection("status", { code: "40001", message: "staff_workspace_version_conflict" }), true);
  assert.equal(isStaffCommandVersionRejection("preparation", { code: "40001", message: "staff_workspace_preparation_version_conflict" }), true);
  for (const error of [{ code: "40001", message: "staff_roles_version_conflict" },
    { code: "23505", message: "staff_roles_request_conflict" }, { code: "42501", message: "staff_workspace_forbidden" },
    { code: "40001", message: "serialization_failure" }, { message: "staff_workspace_version_conflict" }]) {
    assert.equal(isStaffCommandVersionRejection("status", error), false);
    assert.equal(isStaffCommandVersionRejection("preparation", error), false);
  }
  assert.equal(isStaffCommandVersionRejection("preparation", { code: "40001", message: "staff_workspace_version_conflict" }), false);
  const sql = readFileSync(new URL("../supabase/migrations/157_platform_scoped_staff_onboarding.sql", import.meta.url), "utf8");
  for (const [start, end, message] of [
    ["CREATE FUNCTION platform.staff_workspace_prepare_pending_access(", "CREATE FUNCTION platform.staff_workspace_auth_preparation(", "staff_workspace_preparation_version_conflict"],
    ["CREATE OR REPLACE FUNCTION platform.staff_workspace_change_member(", "CREATE OR REPLACE FUNCTION platform.staff_directory(", "staff_workspace_version_conflict"],
  ]) {
    const body = sql.slice(sql.indexOf(start), sql.indexOf(end));
    assert.ok(body.indexOf("staff_role_request_begin") < body.indexOf(message));
    assert.ok(body.indexOf("IF result IS NOT NULL THEN RETURN") < body.indexOf(message));
  }
  const actions = readFileSync(new URL("../src/lib/staff-workspace-actions.ts", import.meta.url), "utf8");
  const auth = actions.slice(actions.indexOf("export async function staffAuthAction"), actions.indexOf("export async function staffAuthPreparationAction"));
  assert.doesNotMatch(auth, /StaffCommandVersionRejectedError/);
  assert.match(auth, /_previous\.outcome === "unknown"/);
  for (const [start, end] of [["staffPreparePendingAccessAction", "staffMemberAction"], ["staffMemberAction", "staffOrganizationalDetailsAction"]]) {
    const body = actions.slice(actions.indexOf(`export async function ${start}`), end === "staffMemberAction" ? actions.indexOf(`export async function ${end}`) : undefined);
    assert.ok(body.indexOf("error instanceof StaffCommandVersionRejectedError && !confirmedRequestId") < body.indexOf('_previous.outcome === "unknown"'));
  }
});
function form(values = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ request_id: ids.request, operation: "invite", email: "SYNTHETIC@example.test",
    display_name: "Synthetic employee", reason: "Technical contract check", recipient_confirmed: "yes", rights_confirmed: "yes",
    no_access: "no", assignments: JSON.stringify([assignment]), ...values })) result.set(key, value);
  return result;
}

test("prepared access is exact, versioned and contains no email or Auth identifier", () => {
  assert.deepEqual(parseStaffAuthPreparation(preparation, expected), preparation);
  for (const change of [{ schemaVersion: 2 }, { requestId: ids.command }, { preparationVersion: -1 },
    { noAccess: "false" }, { email: "hidden@example.test" }, { authUserId: ids.member }, { role: "sales" },
    { conflictCode: "unexpected private details" }, { status: "delivered" }, { status: "completed" }]) {
    assert.throws(() => parseStaffAuthPreparation({ ...preparation, ...change }, expected));
  }
});

test("explicit no-access and legacy preparation remain distinct; neither invents a role", () => {
  assert.equal(parseStaffAuthPreparation({ ...preparation, assignments: [], noAccess: true }, expected).noAccess, true);
  assert.equal(parseStaffAuthPreparation({ ...preparation, preparationVersion: 0, assignments: [], conflictCode: "legacy_access_review_required" }, expected).assignments.length, 0);
  assert.throws(() => parseStaffAuthPreparation({ ...preparation, assignments: [] }, expected));
  assert.throws(() => parseStaffAuthPreparation({ ...preparation, noAccess: true }, expected));
  assert.throws(() => parseStaffAuthPreparation({ ...preparation, preparationVersion: 0 }, expected));
  const recovery = { ...preparation, operation: "recovery", assignments: [], preparationVersion: 0, targetMembershipId: ids.member };
  assert.equal(parseStaffAuthPreparation(recovery, expected).operation, "recovery");
  assert.throws(() => parseStaffAuthPreparation({ ...recovery, targetMembershipId: null }, expected));
});

test("assignment parsers preserve each role/scope pair and reject widening or stale malformed versions", () => {
  assert.deepEqual(parseStaffInviteAssignmentInputs([assignment], false, ids.org), [assignment]);
  const org = { ...assignment, scope: { kind: "organization", key: ids.org, resourceKind: null } };
  assert.deepEqual(parseStaffInviteAssignmentInputs([assignment, org], false, ids.org), [assignment, org]);
  for (const rows of [[], [assignment, assignment], [{ ...assignment, roleVersion: "3" }],
    [{ ...assignment, roleVersion: Number.MAX_SAFE_INTEGER + 1 }], [{ ...assignment, permissions: ["membership.provision"] }],
    [{ ...assignment, scope: { kind: "organization", key: ids.member, resourceKind: null } }],
    [{ ...assignment, scope: { kind: "direction", key: "EU", resourceKind: null } }]]) {
    assert.throws(() => parseStaffInviteAssignmentInputs(rows, false, ids.org));
  }
  assert.deepEqual(parseStaffInviteAssignmentInputs([], true), []);
  assert.throws(() => parseStaffInviteAssignmentInputs([assignment], true));
  assert.throws(() => parseStaffAuthPreparation({ ...preparation, assignments: [{ ...prepared, permissionKeys: ["case.read.full", "case.read.full"] }] }, expected));
});

test("invite requires separate recipient and rights confirmation and explicit access", () => {
  const parsed = parseStaffAuthInput(form(), ids.org);
  assert.equal(parsed.operation, "invite");
  assert.equal(parsed.email, "synthetic@example.test");
  assert.deepEqual(parsed.assignments, [assignment]);
  for (const values of [{ recipient_confirmed: "no" }, { rights_confirmed: "no" }, { no_access: "" },
    { no_access: "yes" }, { role: "admin" }, { reason: "" }, { assignments: "{}" }, { email: "invalid" }]) {
    assert.throws(() => parseStaffAuthInput(form(values), ids.org));
  }
  const duplicate = form(); duplicate.append("rights_confirmed", "yes");
  assert.throws(() => parseStaffAuthInput(duplicate, ids.org));
  assert.equal(parseStaffAuthInput(form({ no_access: "yes", assignments: "[]" }), ids.org).noAccess, true);
});

test("recovery pins membership access version; reconcile needs no recipient or provider data", () => {
  const recovery = form({ operation: "recovery", membership_id: ids.member, expected_version: "4" });
  assert.deepEqual(parseStaffAuthInput(recovery, ids.org), { operation: "recovery", requestId: ids.request,
    reason: "Technical contract check", membershipId: ids.member, expectedAccessVersion: 4 });
  for (const version of ["0", "1.5", "NaN", "9007199254740992"]) {
    recovery.set("expected_version", version); assert.throws(() => parseStaffAuthInput(recovery));
  }
  const reconcile = new FormData(); reconcile.set("request_id", ids.request); reconcile.set("operation", "reconcile");
  assert.deepEqual(parseStaffAuthInput(reconcile), { operation: "reconcile", requestId: ids.request });
});

test("pending preparation uses a distinct immutable command and exact preparation version", () => {
  const pending = form({ command_request_id: ids.command, expected_preparation_version: "0" });
  assert.equal(parseStaffPendingAccessInput(pending, ids.org).expectedPreparationVersion, 0);
  pending.set("command_request_id", ids.request); assert.throws(() => parseStaffPendingAccessInput(pending));
  pending.set("command_request_id", ids.command); pending.set("rights_confirmed", "no");
  assert.throws(() => parseStaffPendingAccessInput(pending));
  assert.equal(parseStaffPendingAccessReceipt({ status: "applied", requestId: ids.request, preparationVersion: 2 }, ids.request, 1), undefined);
  assert.throws(() => parseStaffPendingAccessReceipt({ status: "applied", requestId: ids.request, preparationVersion: 3 }, ids.request, 1));
});

test("Auth claim receipts cannot redirect a confirmed recipient or replay dispatch", () => {
  assert.deepEqual(parseStaffAuthClaim({ id: ids.request, dispatch: false, status: "completed" }, ids.request), { dispatch: false, status: "completed" });
  const claim = { id: ids.request, dispatch: true, status: "dispatching", email: "synthetic@example.test" };
  assert.equal(parseStaffAuthClaim(claim, ids.request, claim.email).email, claim.email);
  for (const changed of [{ id: ids.command }, { dispatch: "true" }, { status: "completed" }, { email: "another@example.test" }]) {
    assert.throws(() => parseStaffAuthClaim({ ...claim, ...changed }, ids.request, claim.email));
  }
  assert.throws(() => parseStaffAuthClaim({ ...claim, dispatch: false }, ids.request));
});

test("reconcile receipts distinguish confirmed rejection, pending conflict and technical completion", () => {
  assert.deepEqual(parseStaffAuthResult({ status: "completed", operation: "invite" }, "invite"),
    { status: "completed", operation: "invite", rejectionCode: null, conflictCode: null });
  assert.equal(parseStaffAuthResult({ status: "rejected", operation: "invite", rejection_code: "email_exists" }).rejectionCode, "email_exists");
  assert.equal(parseStaffAuthResult({ status: "reconciliation_required", operation: "invite", conflict_code: "role_version_changed" }).conflictCode, "role_version_changed");
  for (const changed of [{ status: "delivered" }, { status: "dispatching" }, { email: "private@example.test" }, { conflict_code: "role_version_changed" }, { operation: "recovery" }]) {
    assert.throws(() => parseStaffAuthResult({ status: "completed", operation: "invite", ...changed }, "invite"));
  }
});

test("application adapters keep exact snapshots, no coarse invite role, and unknown effect outcomes", () => {
  const service = readFileSync(new URL("../src/lib/server/staff-workspace-service.ts", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/lib/staff-workspace-actions.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /p_role:|isStaffRole|as StaffAuthResult/u);
  for (const field of ["p_assignments", "p_no_access", "p_reason", "p_expected_access_version"]) assert.ok(service.includes(field));
  assert.match(service, /if \(operation === "reconcile"\) return reconcile\(\)/u);
  const preparationOnly = service.slice(service.indexOf("export async function readStaffAuthPreparation"), service.indexOf("export async function changeStaffMember"));
  assert.doesNotMatch(preparationOnly, /inviteUserByEmail|resetPasswordForEmail|createPlatformSupabaseServiceClient/u);
  assert.match(preparationOnly, /parseStaffAuthPreparation\(result.data, \{ requestId, organizationId: actor.organizationId \}\)/u);
  assert.match(actions, /confirmedRequestId = result.requestId;[\s\S]*revalidatePath/u);
  assert.match(actions, /error instanceof StaffAuthOutcomeUnknownError \|\| confirmedRequestId \|\| _previous.outcome === "unknown"/u);
  assert.match(actions, /result\.status === "rejected"[\s\S]*retryAllowed: true/u);
});

test("staff status accepts custom staff metadata but pins the target and next access version", () => {
  const input = form({ operation: "status", value: "suspended", membership_id: ids.member, expected_version: "4" });
  assert.equal(parseStaffStatusInput(input).status, "suspended");
  input.set("operation", "role"); assert.throws(() => parseStaffStatusInput(input));
  const receipt = { organization_id: ids.org, membership_id: ids.member, profile_id: ids.command,
    role: null, bundle_id: null, status: "suspended", access_version: 5 };
  const context = { organizationId: ids.org, membershipId: ids.member, status: "suspended", expectedVersion: 4 };
  assert.equal(parseStaffStatusReceipt(receipt, context), undefined);
  for (const changed of [{ membership_id: ids.command }, { organization_id: ids.command }, { access_version: 4 },
    { status: "active" }, { role: "student" }, { auth_user_id: ids.command }]) {
    assert.throws(() => parseStaffStatusReceipt({ ...receipt, ...changed }, context));
  }
});
