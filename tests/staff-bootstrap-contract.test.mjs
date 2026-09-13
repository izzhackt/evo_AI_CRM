import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const legacy = readFileSync(new URL("../supabase/migrations/041_platform_identity_rbac_audit.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/157_platform_scoped_staff_onboarding.sql", import.meta.url), "utf8");
const original = legacy.match(/CREATE OR REPLACE FUNCTION platform\.bootstrap_organization_admin\([\s\S]*?\n\$\$;/u)?.[0];

// This is a structural forward-migration contract, not a SQL/Auth execution
// fixture. The separate real local onboarding proof must exercise the RPC.
test("fresh Admin migration extends only the existing one-shot membership INSERT", () => {
  assert.ok(original, "the original public bootstrap function must exist");
  const patch = migration.match(/DO \$staff_first_admin_bootstrap\$([\s\S]*?)END \$staff_first_admin_bootstrap\$;/u)?.[1];
  assert.ok(patch, "157 must establish protected authority for the first Admin");
  assert.match(patch, /pg_get_functiondef\('platform\.bootstrap_organization_admin\(text,uuid,text,text,uuid\)'::regprocedure\)/u);

  const anchor = patch.match(/anchor:=\$old\$([\s\S]*?)\$old\$;/u)?.[1];
  const replacement = patch.match(/body:=replace\(body,anchor,\$new\$([\s\S]*?)\$new\$\);/u)?.[1];
  assert.ok(anchor && replacement, "forward patch must use bounded source literals");
  assert.equal(original.split(anchor).length - 1, 1, "anchor must match the actual041 function exactly once");
  assert.match(patch, /IF \(length\(body\)-length\(replace\(body,anchor,''\)\)\)\/length\(anchor\)<>1 THEN/u);
  assert.match(patch, /RAISE EXCEPTION 'staff_first_admin_bootstrap_source_drift' USING ERRCODE='55000'/u);
  assert.equal((patch.match(/EXECUTE body;/gu) ?? []).length, 1);
  assert.equal((patch.match(/body:=replace\(/gu) ?? []).length, 1);
  assert.match(replacement, /^  INSERT INTO platform\.organization_memberships \(/u);
  assert.match(replacement, /current_bundle_id,\n    is_system_admin\n/u);
  assert.match(replacement, /    bundle_id,\n    TRUE\n/u);
  assert.equal(
    replacement.replace("current_bundle_id,\n    is_system_admin", "current_bundle_id")
      .replace("bundle_id,\n    TRUE", "bundle_id"),
    anchor,
    "only the protected first-Admin flag may change",
  );
});

test("original first-Admin bootstrap retains real identity, one-shot and audit boundaries", () => {
  assert.ok(original);
  for (const contract of [
    "bootstrap_organization_admin is service-role-only",
    "evo-platform:first-organization-bootstrap",
    "hashtextextended(p_request_id::TEXT, 0)",
    "platform_private.replay_audit(",
    "IF EXISTS (SELECT 1 FROM platform.organizations)",
    "FROM auth.users AS auth_user",
    "WHERE auth_user.id = p_admin_auth_user_id",
    "WHERE existing_profile.auth_user_id = p_admin_auth_user_id",
    "platform_private.published_bundle_for_role('admin')",
    "INSERT INTO platform.record_scopes (",
    "platform_private.append_scope_event(",
    "INSERT INTO platform.audit_events (",
  ]) assert.ok(original.includes(contract), `existing bootstrap boundary missing: ${contract}`);
  assert.match(legacy, /GRANT EXECUTE ON FUNCTION platform\.bootstrap_organization_admin\(\s*TEXT,\s*UUID,\s*TEXT,\s*TEXT,\s*UUID\s*\) TO service_role;/u);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION platform\.bootstrap_organization_admin/u);
});
