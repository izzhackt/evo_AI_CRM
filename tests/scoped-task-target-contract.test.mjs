import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/156_platform_scoped_staff_consumers.sql");
const legacy = read("supabase/migrations/129_platform_curator_own_task_controls.sql");

function definition(name) {
  const start = migration.indexOf(`CREATE FUNCTION ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const bodyStart = migration.indexOf("AS $$", start);
  const bodyEnd = migration.indexOf("$$;", bodyStart + 5);
  assert.ok(bodyStart > start && bodyEnd > bodyStart);
  return migration.slice(start, bodyEnd + 3);
}

function commandPatches() {
  const block = migration.match(/DO \$scoped_case_task_target\$([\s\S]+?)\$scoped_case_task_target\$;/);
  assert.ok(block, "Selected-task command seams have a dedicated bounded patch");
  const patches = [...block[1].matchAll(
    /PERFORM pg_temp\.evo_s2_replace\(change_task,\s*\$\$([\s\S]*?)\$\$,\s*\$\$([\s\S]*?)\$\$\);/g,
  )].map(([, before, after]) => ({ before, after }));
  assert.equal(patches.length, 2);
  return { block: block[1], patches };
}

test("selected-task reader binds live staff and the exact organization, case and task", () => {
  const body = definition("platform.staff_case_task_target");
  assert.match(body, /p_organization_id UUID, p_student_case_id UUID, p_case_task_id UUID/);
  assert.match(body, /RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''/);
  assert.match(body, /FROM platform\.current_actor_authority\(\) AS a/);
  assert.match(body, /JOIN platform_private\.staff_membership_identity\(a\.organization_id, a\.membership_id\) AS i ON TRUE/);
  assert.match(body, /WHERE a\.organization_id = p_organization_id/);
  assert.match(body, /task\.organization_id = actor\.organization_id/);
  assert.match(body, /task\.student_case_id = p_student_case_id AND task\.id = p_case_task_id/);
  assert.match(body, /student_case\.organization_id = task\.organization_id/);
  assert.match(body, /student_case\.id = task\.student_case_id/);
  assert.match(body, /student_case\.state IN \('active', 'closed'\)/);
  assert.match(body, /student_case\.handoff_at IS NOT NULL/);
  assert.match(body, /staff_can_access\(actor\.organization_id, actor\.membership_id,\s*'task\.manage', 'task', task\.id\)/);
  assert.equal((body.match(/ERRCODE = '42501'/g) ?? []).length, 2);
  assert.doesNotMatch(body, /u7_require_case_workspace_actor|staff_student_case_task_workspace|staff_case_task_queue\(|staff_has_permission|platform_role/);
});

test("selected-task wire reuses the exact queue row and independently paired case capabilities", () => {
  const body = definition("platform.staff_case_task_target");
  const queueProjection = body.match(/SELECT jsonb_build_object\(([\s\S]+?)\) INTO task_json/);
  assert.ok(queueProjection);
  const actualKeys = [...queueProjection[1].matchAll(/^\s*'([^']+)',/gm)].map((match) => match[1]);
  const normalizer = read("src/lib/platform-admissions-workspace.ts").match(
    /export function normalizePlatformAdmissionsTaskQueueRow\([\s\S]+?exactRecord\(value, \[([\s\S]+?)\]\)/,
  );
  assert.ok(normalizer);
  const expectedKeys = [...normalizer[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(actualKeys.toSorted(), expectedKeys.toSorted());
  assert.equal(actualKeys.length, 18);
  assert.match(body, /task\.version::TEXT/);
  assert.match(body, /task\.due_on::TIMESTAMP AT TIME ZONE 'Asia\/Bishkek'/);
  assert.match(body, /'9999-12-31 00:00:00\+00'::TIMESTAMPTZ/);
  for (const [capability, permission] of [
    ["canAssign", "task.assign"],
    ["canChangeVisibility", "task.visibility.manage"],
    ["canReadCase", "case.read.full"],
  ]) {
    assert.ok(body.includes(`'${capability}'`));
    assert.ok(body.includes(`'${permission}', 'student_case', p_student_case_id)`));
  }
  assert.match(body, /'schemaVersion', 1, 'organizationId', actor\.organization_id/);
  assert.match(body, /'studentCaseId', p_student_case_id, 'task', task_json/);
  assert.doesNotMatch(body, /student_profiles|client_profiles|jsonb_agg\(.*task|created_by_membership_id/);
});

test("selected-task recipients use canonical prospective authority and retain live locks", () => {
  const predicate = definition("platform_private.selected_case_task_recipient_eligible");
  assert.match(predicate, /task\.organization_id = p_organization_id/);
  assert.match(predicate, /task\.id = p_case_task_id AND task\.student_case_id = p_student_case_id/);
  assert.match(predicate, /staff_membership_identity\(p_organization_id, p_membership_id\)/);
  assert.match(predicate, /'case\.read\.full', 'student_case', p_student_case_id/);
  assert.match(predicate, /'task\.create', 'student_case', p_student_case_id/);
  assert.match(predicate, /OR platform_private\.staff_can_receive_assignment\(p_organization_id, p_membership_id,\s*'task\.manage', 'task', p_case_task_id\)/);
  assert.doesNotMatch(predicate, /staff_has_permission|current_role|platform_role/);
  const required = definition("platform_private.require_selected_case_task_assignee");
  assert.match(required, /require_live_task_assignee\(p_organization_id, p_membership_id\)/);
  assert.match(required, /selected_case_task_recipient_eligible\(\s*p_organization_id, p_membership_id, p_student_case_id, p_case_task_id\)/);
  assert.match(required, /ERRCODE = '42501'/);
  const reader = definition("platform.staff_case_task_target");
  assert.match(reader, /IF NOT can_assign THEN/);
  assert.match(reader, /jsonb_build_array\(jsonb_build_object\(\s*'membership_id', task_json->>'assignee_membership_id'/);
  assert.match(reader, /selected_case_task_recipient_eligible\(\s*actor\.organization_id, m\.id, p_student_case_id, p_case_task_id\)/);
  assert.match(reader, /task_json->>'status' NOT IN \('open', 'in_progress', 'blocked'\)/);
  assert.match(reader, /platform_private\.case_curator_coverages/);
  assert.match(reader, /i\.system_role = 'admin'/);
  assert.match(reader, /student_case\.current_curator_membership_id = m\.id/);
  assert.match(reader, /jsonb_array_length\(assignees\) > 100/);
  assert.match(reader, /ERRCODE = '54000'/);
});

test("only the existing task command target and recipient seams change", () => {
  const { block, patches } = commandPatches();
  assert.match(block, /coverage_change_task_body\(uuid,uuid,platform\.case_task_status/);
  assert.doesNotMatch(block, /create_case_task|staff_student_case_task_workspace|CREATE OR REPLACE FUNCTION/);
  const bodyStart = legacy.indexOf("AS $$") + 5;
  const original = legacy.slice(bodyStart, legacy.indexOf("$$;", bodyStart));
  assert.match(block, new RegExp(createHash("md5").update(original).digest("hex")));
  assert.match(block, /IF md5\(body\) <>/);
  for (const patch of patches) {
    assert.equal(original.split(patch.before).length - 1, 1, "Exact original command anchor");
  }
  assert.match(patches[0].after, /require_domain_actor\(p_organization_id, 'task.manage'\)/);
  assert.match(patches[0].after, /staff_can_access\(p_organization_id, actor.actor_membership_id,\s*'task.manage', 'task', task_row.id\)/);
  assert.match(patches[1].after, /require_selected_case_task_assignee\(p_organization_id, p_new_assignee_membership_id, task_row.student_case_id, task_row.id\)/);
  let revised = original;
  for (const patch of patches) revised = revised.replace(patch.before, patch.after);
  for (const patch of patches.toReversed()) revised = revised.replace(patch.after, patch.before);
  assert.equal(revised, original, "All lock, version, replay, audit and business-rule statements stay exact");
  const coverage = read("supabase/migrations/133_platform_curator_workload_coverage.sql");
  assert.match(coverage, /coverage_require_current_task_assignee\(p_organization_id,task_case_id,p_new_assignee_membership_id,p_new_status\)/);
  assert.match(migration, /task_row.assignee_membership_id <> p_new_assignee_membership_id AND NOT[\s\S]+?'task.assign', 'student_case', task_row.student_case_id/);
  assert.match(migration, /task_row.student_visible <> p_student_visible AND NOT[\s\S]+?'task.visibility.manage', 'student_case', task_row.student_case_id/);
});

test("selected-task read exposes only the fixed authenticated RPC, never internal recipient helpers", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION platform.staff_case_task_target\(UUID,UUID,UUID\)\s+FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION platform.staff_case_task_target\(UUID,UUID,UUID\) TO authenticated;/);
  for (const helper of ["selected_case_task_recipient_eligible", "require_selected_case_task_assignee"]) {
    assert.ok(migration.includes(`REVOKE ALL ON FUNCTION platform_private.${helper}(UUID,UUID,UUID,UUID)`));
    assert.ok(!migration.includes(`GRANT EXECUTE ON FUNCTION platform_private.${helper}`));
  }
});
