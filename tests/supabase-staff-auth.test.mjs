import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canAdminSelectEffectiveRole } from "../src/lib/fixed-role-policy.ts";
import { parseStaffAccessSnapshot } from "../src/lib/supabase/platform-authority.ts";
import { isStaffPreview, staffCan, staffCanAccessRoute, staffHasPermission, staffHomeRoute, staffPresentationCan } from "../src/lib/platform-access.ts";
import { parseCaseSectionAccess } from "../src/lib/v3/case-access-contract.ts";

// Synthetic parser examples only; these do not prove a Supabase runtime or RLS.
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const authUserId = uuid(1), organizationId = uuid(2);
function snapshot(overrides = {}) {
  return { schemaVersion: 1, authUserId, organizationId, profileId: uuid(3), membershipId: uuid(4),
    displayName: "Synthetic staff", systemRole: "staff", accessVersion: 7,
    assignments: [{ id: uuid(5), roleId: uuid(6), label: "Custom role", bundleId: uuid(7), bundleVersion: 2,
      scope: { kind: "direction", key: "CN", resourceKind: null } }],
    permissions: ["case.read.full", "document.upload"], ...overrides };
}
const parse = value => parseStaffAccessSnapshot(value, authUserId, "synthetic@example.invalid");
const actor = (permissions = [], overrides = {}) => ({ ...parse(snapshot({ assignments: [], permissions })), presentationRole: null, ...overrides });

test("live snapshot preserves paired assignments without a single business role", () => {
  const input = snapshot();
  input.assignments.push({ ...input.assignments[0], id: uuid(8), roleId: uuid(9), label: "Another role",
    scope: { kind: "record", key: uuid(10), resourceKind: "student_case" } });
  const result = parse(input);
  assert.equal(result.systemRole, "staff");
  assert.equal(result.platformAccessVersion, 7);
  assert.deepEqual(result.assignments, input.assignments);
  assert.deepEqual(result.permissionKeys, input.permissions);
  for (const obsolete of ["authorityRole", "platformRole", "platformBundleId", "platformBundleVersion"]) assert.equal(obsolete in result, false);
});
test("strict parser rejects stale identity and malformed contracts without legacy fallback", () => {
  for (const input of [null, [], [snapshot()], { ...snapshot(), authUserId: uuid(90) },
    { ...snapshot(), schemaVersion: 2 }, { ...snapshot(), accessVersion: 0 },
    { ...snapshot(), accessVersion: "9007199254740992" }, { ...snapshot(), systemRole: "sales" },
    { ...snapshot(), platform_role: "admin" }, { ...snapshot(), permissions: ["case.read.full", "case.read.full"] },
    { ...snapshot(), permissions: ["*"] }, { ...snapshot(), assignments: [snapshot().assignments[0], snapshot().assignments[0]] },
    { ...snapshot(), assignments: [{ ...snapshot().assignments[0], bundleVersion: 0 }] },
  ]) assert.equal(parse(input), null);
});
test("canonical scope shapes reject mixed or borrowed scope metadata", () => {
  const valid = [{ kind: "own", key: null, resourceKind: null }, { kind: "organization", key: organizationId, resourceKind: null },
    { kind: "department", key: uuid(10), resourceKind: null },
    ...["CN", "MY", "EUROPE", "AE", "TR"].map(key => ({ kind: "direction", key, resourceKind: null })),
    { kind: "record", key: uuid(11), resourceKind: "lead" }];
  const invalid = [{ kind: "organization", key: uuid(10), resourceKind: null }, { kind: "organization", key: null, resourceKind: null }, { kind: "direction", key: "EU", resourceKind: null },
    { kind: "direction", key: "china", resourceKind: null }, { kind: "department", key: "Sales", resourceKind: null },
    { kind: "record", key: uuid(11), resourceKind: null }, { kind: "own", key: null, resourceKind: "lead" },
    { kind: "organization", key: null, resourceKind: null, grant: "admin" }];
  for (const scope of valid) assert.ok(parse(snapshot({ assignments: [{ ...snapshot().assignments[0], scope }] })));
  for (const scope of invalid) assert.equal(parse(snapshot({ assignments: [{ ...snapshot().assignments[0], scope }] })), null);
});
test("zero-assignment staff is authenticated but has no implicit business sections", () => {
  const staff = actor();
  assert.ok(staff);
  assert.equal(staffCan(staff, "sales.read"), false);
  assert.equal(staffHomeRoute(staff), "/access-denied");
  assert.equal(staffCanAccessRoute(staff, "/v3/settings"), false);
  assert.equal(staffHasPermission({ ...staff, assignments: snapshot().assignments }, "document.upload"), false);
});
test("live permissions select sections and fixed choices are only protected Admin preview", () => {
  const staff = actor(["company.file.read", "team.chat.admissions"]);
  assert.equal(staffCanAccessRoute(staff, "/v3/knowledge"), true);
  assert.equal(staffCanAccessRoute(staff, "/v3/team-chat"), true);
  assert.equal(staffCan(staff, "documents.read"), false);
  assert.equal(staffCan(staff, "admissions.write"), false);
  assert.equal(canAdminSelectEffectiveRole("staff", "admin"), false);
  const admin = actor([], { systemRole: "admin" });
  assert.equal(staffCan(admin, "sales.write"), true);
  assert.equal(isStaffPreview(admin), false);
  assert.equal(canAdminSelectEffectiveRole("admin", "sales"), true);
  const preview = { ...admin, presentationRole: "sales" };
  assert.equal(isStaffPreview(preview), true);
  assert.equal(staffPresentationCan(preview, "admissions.read"), false);
  assert.equal(staffCanAccessRoute(preview, "/v3/settings"), false);
});
test("report-only and snippet-only roles do not inherit lead, case or communication sections", () => {
  const reporting = actor(["sales.register.read"]);
  assert.equal(staffHomeRoute(reporting), "/v3/main");
  assert.equal(staffCan(reporting, "sales.report.read"), true);
  assert.equal(staffCan(reporting, "sales.read"), false);
  assert.equal(staffCanAccessRoute(reporting, "/v3/pipeline"), false);
  assert.equal(staffCanAccessRoute(reporting, "/v3/profile"), false);
  const snippets = actor(["reply.snippet.sales", "reply.snippet.manage"]);
  assert.equal(staffHomeRoute(snippets), "/v3/knowledge");
  assert.equal(staffCan(snippets, "snippets.write"), true);
  assert.equal(staffCan(snippets, "messaging.read"), false);
  assert.equal(staffCanAccessRoute(snippets, "/v3/inbox"), false);
  assert.equal(staffCan(snippets, "documents.write"), false);
  const caseTasks = actor(["case.read.full", "task.create"]);
  assert.equal(staffCanAccessRoute(caseTasks, "/v3/tasks"), true);
  assert.equal(staffHasPermission(caseTasks, "staff.task.read"), false);
  assert.equal(staffCanAccessRoute(actor(["task.create"]), "/v3/tasks"), false);
});
test("case modules are independent strict object-bound read capabilities", () => {
  const value = { organizationId, studentCaseId: uuid(80), documents: false, finance: true,
    studentProfile: false, contract: true, handoff: true, applications: true, visa: true };
  assert.deepEqual(parseCaseSectionAccess(value, organizationId, uuid(80)), { documents: false, finance: true, studentProfile: false, contract: true });
  for (const input of [null, { ...value, organizationId: uuid(90) }, { ...value, studentCaseId: uuid(90) },
    { ...value, finance: "true" }, { ...value, visa: false }, { ...value, extra: true }])
    assert.throws(() => parseCaseSectionAccess(input, organizationId, uuid(80)), /case_access_unavailable/);
});

test("Sales read and task queue route hints use independent live permissions", () => {
  for (const keys of [["pipeline.read"], ["lead.sales.workflow.manage"], ["lead.sales.owner.assign"]]) {
    assert.equal(staffCan(actor(keys), "sales.read"), false);
    assert.equal(staffCanAccessRoute(actor(keys), "/v3/pipeline"), false);
  }
  assert.equal(staffCanAccessRoute(actor(["lead.read"]), "/v3/pipeline"), true);
  assert.equal(staffCanAccessRoute(actor(["task.manage"]), "/v3/calendar"), true);
  assert.equal(staffCanAccessRoute(actor(["task.create"]), "/v3/calendar"), false);
  assert.equal(staffCan(actor(["lead.read"]), "sales.write"), false);
  assert.equal(staffCan(actor(["lead.manual.create"]), "sales.write"), false);
  for (const keys of [["task.manage"], ["staff.task.read"], ["staff.task.create"], ["case.read.full", "task.create"]]) {
    assert.equal(staffCanAccessRoute(actor(keys), "/v3/tasks"), true);
  }
  for (const keys of [[], ["task.create"], ["case.read.full"]]) {
    assert.equal(staffCanAccessRoute(actor(keys), "/v3/tasks"), false);
  }
});
test("runtime verifies claims and reads a live snapshot without JWT business fallback", async () => {
  const read = async file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const [authority, guards, server, proxy, actions, shell] = await Promise.all([
    read("src/lib/supabase/platform-authority.ts"), read("src/lib/platform-guards.ts"), read("src/lib/supabase/server.ts"),
    read("src/proxy.ts"), read("src/lib/staff-auth-actions.ts"), read("src/components/v3/AppShell.tsx")]);
  assert.match(authority, /rpc\("staff_access_snapshot"\)/);
  assert.doesNotMatch(authority, /current_actor_authority|claims\.platform_(role|bundle|access)/);
  assert.match(guards, /staffCanAccessRoute\(actor, route\)/);
  assert.match(guards, /if \(isStaffPreview\(actor\)\) redirect/);
  assert.match(server, /createServerClient/);
  assert.match(proxy, /auth\.getClaims\(\)/);
  assert.doesNotMatch(proxy, /getSession\(/);
  assert.match(actions, /signInWithPassword/);
  assert.match(actions, /signOut\(\{ scope: "local" \}\)/);
  assert.match(shell, /selectStaffRolePreviewAction/);
});

test("current-actor SQL contract separates live staff identity from scoped grant and removal", async () => {
  // Source coverage only: required CI executes this transactional SQL contract.
  const sql = await readFile(new URL("../supabase/tests/platform_current_actor_authority.sql", import.meta.url), "utf8");
  for (const denial of ["wrong_subject", "missing_authority", "blocked_profile", "inactive_membership", "suspended_organization"]) {
    assert.match(sql, new RegExp(`:'p3a_${denial}_rows' = '0'`));
  }
  for (const state of ["wrong_role", "stale_version", "malformed_version", "revoked_scope"]) {
    const assertion = sql.slice(sql.indexOf(`AS p3a_${state}_live_contract_ok`) - 300,
      sql.indexOf(`AS p3a_${state}_live_contract_ok`));
    assert.match(assertion, /jsonb_agg\(to_jsonb\(actor\)\)/);
    assert.match(assertion, /= :'p3a_expected_actor'::JSONB/);
    assert.match(assertion, /staff_access_snapshot\(\) = :'p3a_expected_empty_snapshot'::JSONB/);
    assert.match(sql, new RegExp(`:'p3a_${state}_live_contract_ok'::BOOLEAN`));
  }
  assert.match(sql, /'systemRole', 'staff',[\s\S]*'accessVersion', 1,[\s\S]*'assignments', '\[\]'::JSONB,[\s\S]*'permissions', '\[\]'::JSONB/);
  assert.match(sql, /membership\.is_system_admin/);
  assert.match(sql, /bundle\.status = 'published'/);
  assert.match(sql, /bool_and\('organization' = ANY\(definition\.staff_scope_kinds\)/);
  assert.equal((sql.match(/SELECT platform\.staff_role_assignments_save\(/g) ?? []).length, 2);
  assert.match(sql, /:'p3a_actor_membership_id', 1,\s*:'p3a_scoped_assignments'::JSONB, :'p3a_scoped_role_bindings'::JSONB/);
  assert.match(sql, /:'p3a_actor_membership_id', 2, '\[\]', '\[\]'/);
  for (const version of [2, 3]) assert.match(sql, new RegExp(`'\\{0,platform_access_version\\}', '${version}'`));
  assert.match(sql, /jsonb_array_length\(body->'assignments'\) = 1/);
  assert.match(sql, /'permissions', :'p3a_expected_permissions'::JSONB/);
  assert.match(sql, /jsonb_set\(:'p3a_expected_empty_snapshot'::JSONB, '\{accessVersion\}', '3'\)/);
  assert.doesNotMatch(sql, /SET current_bundle_id|p3a_published_without_permission_bundle_id|p3a_draft_bundle_id|DISABLE TRIGGER|session_replication_role/);
  assert.match(sql, /has_function_privilege\('anon', routine_oid, 'EXECUTE'\)/);
  assert.match(sql, /actual_columns IS DISTINCT FROM expected_columns/);
  assert.match(sql, /ROLLBACK;\s*$/);
});
