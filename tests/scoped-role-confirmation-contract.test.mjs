import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/155_platform_scoped_staff_roles.sql");
function definition(name) {
  const start = sql.indexOf(`CREATE FUNCTION ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = sql.indexOf("$$;", sql.indexOf("AS $$", start));
  assert.ok(end > start);
  return sql.slice(start, end + 3);
}
function before(body, first, second) {
  assert.ok(body.indexOf(first) >= 0 && body.indexOf(second) > body.indexOf(first), `${first} precedes ${second}`);
}

test("publication impact uses one canonical role and live scoped assignment fingerprint", () => {
  const fingerprint = definition("platform_private.staff_role_impact_fingerprint");
  for (const field of ["schemaVersion", "organizationId", "roleId", "roleVersion", "status", "bundleId", "bundleVersion",
    "draftPermissionKeys", "publishedPermissionKeys", "assignments", "membershipId", "scopeKind", "scopeKey", "resourceKind"])
    assert.ok(fingerprint.includes(`'${field}'`), field);
  assert.match(fingerprint, /encode\(sha256\(convert_to\(/);
  assert.match(fingerprint, /jsonb_agg\(k ORDER BY k\)/);
  assert.match(fingerprint, /bp\.permission_key ORDER BY bp\.permission_key/);
  assert.match(fingerprint, /'id',a\.id,[\s\S]*ORDER BY a\.id/);
  assert.match(fingerprint, /a\.organization_id=r\.organization_id[\s\S]*a\.role_id=r\.id AND a\.revoked_at IS NULL/);
  assert.doesNotMatch(fingerprint, /display_name|email|auth_user_id|profiles/);
  const impact = definition("platform.staff_role_impact");
  assert.match(impact, /require_admin_actor\(p_organization_id,'rbac\.read'\)/);
  assert.match(impact, /'impactFingerprint',platform_private\.staff_role_impact_fingerprint\(p_organization_id,r\.id\)/);
});

test("publish compares the reviewed impact after serialized locks and before business writes", () => {
  const begin = definition("platform_private.staff_role_request_begin");
  assert.match(begin, /FROM platform\.organizations[^;]+FOR UPDATE/);
  const publish = definition("platform.staff_role_publish");
  assert.match(publish, /p_expected_impact_fingerprint TEXT,p_reason TEXT,p_request_id UUID/);
  assert.match(publish, /'expectedImpactFingerprint',p_expected_impact_fingerprint/);
  before(publish, "staff_role_request_begin", "staff_lock_memberships");
  before(publish, "staff_lock_memberships", "staff_role_impact_fingerprint");
  before(publish, "staff_role_impact_fingerprint", "INSERT INTO platform.role_bundle_versions");
  assert.match(publish, /staff_role_impact_fingerprint\(p_organization_id,r\.id\) IS DISTINCT FROM p_expected_impact_fingerprint/);
  assert.match(publish, /staff_roles_impact_version_conflict' USING ERRCODE='40001'/);
  assert.match(publish, /IF result IS NOT NULL THEN RETURN result; END IF/);
});

test("ordinary assignment changes bind the exact selected published role set before replacement", () => {
  const bindings = definition("platform_private.staff_validate_assignment_bindings");
  assert.match(bindings, /count\(DISTINCT \(a->>'roleId'\)::UUID\)/);
  assert.match(bindings, /ARRAY\['roleId','roleVersion','bundleId','bundleVersion'\]/);
  assert.match(bindings, /jsonb_object_keys\(entry\)\)<>4/);
  assert.match(bindings, /v_role_id=ANY\(seen\)/);
  assert.match(bindings, /WHERE \(a->>'roleId'\)::UUID=v_role_id/);
  assert.match(bindings, /r\.organization_id=p_organization_id AND r\.id=v_role_id AND r\.status='active'/);
  assert.match(bindings, /r\.version=\(entry->>'roleVersion'\)::BIGINT AND r\.current_bundle_id=\(entry->>'bundleId'\)::UUID/);
  assert.match(bindings, /binding\.bundle_version=\(entry->>'bundleVersion'\)::BIGINT/);
  assert.match(bindings, /bundle\.version=binding\.bundle_version AND bundle\.status='published'/);
  assert.match(bindings, /staff_roles_selected_role_version_conflict' USING ERRCODE='40001'/);
  const save = definition("platform.staff_role_assignments_save");
  assert.match(save, /'expectedRoleBindings',p_expected_role_bindings/);
  before(save, "staff_role_request_begin", "staff_lock_memberships");
  before(save, "staff_lock_memberships", "staff_validate_assignment_bindings");
  before(save, "staff_validate_assignment_bindings", "staff_replace_assignments");
  assert.match(save, /staff_replace_assignments\(p_organization_id,p_membership_id,p_assignments\)/);
  assert.doesNotMatch(read("supabase/migrations/157_platform_scoped_staff_onboarding.sql"), /staff_validate_assignment_bindings|p_expected_role_bindings/);
});

test("reviewed inputs reach the existing exact-replay form and command without automatic refresh", () => {
  const service = read("src/lib/server/staff-roles-service.ts");
  assert.match(service, /params\.p_expected_impact_fingerprint = parseStaffRoleImpactFingerprint\(field\(form, "expected_impact_fingerprint", 64\)\)/);
  assert.match(service, /params\.p_expected_role_bindings = parseStaffRoleExpectedBindings\(/);
  assert.match(service, /JSON\.parse\(field\(form, "expected_role_bindings", 32000\)\), assignments/);
  const mutation = service.slice(service.indexOf("  const base = { ...organization"));
  assert.doesNotMatch(mutation, /staff_role_impact|staff_role_workspace/);
  const publication = read("src/components/v3/settings/StaffRolesSection.tsx").split("function RolePublication")[1].split("function RoleLifecycle")[0];
  assert.match(publication, /name="expected_impact_fingerprint" value=\{impact\.impactFingerprint\}/);
  assert.match(publication, /publication\.status === "error" && publication\.outcome !== "unknown"/);
  const form = read("src/components/v3/settings/StaffRoleForms.tsx");
  assert.match(form, /unknown/);
  assert.match(form, /request_id/);
});

test("only authenticated public commands expose the new signatures; canonical helpers stay private", () => {
  assert.match(sql, /'staff_role_impact_fingerprint','staff_validate_assignment_bindings'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin/);
  assert.match(sql, /platform\.staff_role_publish\(UUID,UUID,BIGINT,TEXT,TEXT,UUID\)/);
  assert.match(sql, /platform\.staff_role_assignments_save\(UUID,UUID,BIGINT,JSONB,JSONB,TEXT,UUID\)/);
  assert.doesNotMatch(sql, /platform\.staff_role_publish\(UUID,UUID,BIGINT,TEXT,UUID\)/);
  assert.doesNotMatch(sql, /platform\.staff_role_assignments_save\(UUID,UUID,BIGINT,JSONB,TEXT,UUID\)/);
  assert.match(sql, /platform\.staff_system_admin_command\([^;]+ TO authenticated/);
});
