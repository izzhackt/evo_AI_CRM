// Migration 244 (access by role permissions for invited staff): static
// checks of the migration text, its real-Postgres suite wiring and the board
// move pre-check. These supplement, never replace, the boundary suite
// supabase/tests/platform_access_by_permissions.sql (checkpoint 244 in
// scripts/test-postgres-authorization.sh), which runs every changed function
// against members modelled like production (coarse role NULL, the production
// role bundles and scope shapes).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformAdmissionsPipelineMutationError,
  moveCasePipeline,
} from "../src/lib/platform-admissions-pipeline.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = source("supabase/migrations/244_platform_access_by_permissions.sql");
const suite = source("supabase/tests/platform_access_by_permissions.sql");
const script = source("scripts/test-postgres-authorization.sh");
const pipeline = source("src/lib/platform-admissions-pipeline.ts");

const ORG = "24400000-0000-4000-8000-000000000001";
const REQUEST = "24400000-0000-4000-8000-000000003001";

/** The body of one CREATE OR REPLACE FUNCTION in 244, up to its closing $$. */
function functionBody(signaturePrefix) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${signaturePrefix}(`);
  assert.notEqual(start, -1, signaturePrefix);
  const bodyStart = migration.indexOf("AS $$", start);
  const bodyEnd = migration.indexOf("$$;", bodyStart + 5);
  return migration.slice(bodyStart, bodyEnd);
}

test("244 is one forward-only transaction that rewrites only the nine audited functions", () => {
  assert.match(migration, /^BEGIN;$/mu);
  assert.match(migration, /^COMMIT;\s*$/mu);
  assert.doesNotMatch(migration, /\bDROP\s+(FUNCTION|TABLE|POLICY|TRIGGER)\b/iu);
  assert.doesNotMatch(migration, /\b(CREATE|ALTER)\s+TABLE\b/iu);
  const replaced = [...migration.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_]+\.[a-z0-9_]+)\(/gu)].map((match) => match[1]);
  assert.deepEqual(replaced, [
    "platform.move_case_pipeline_v1",
    "private.assign_case_curator_v1",
    "platform.prepare_lead_cabinet_v1",
    "platform.staff_account_deletion_requests_v1",
  ]);
  for (const signature of [
    "platform.staff_save_application_requirements_v1(uuid,uuid,uuid,jsonb)",
    "platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)",
    "platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)",
    "platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)",
    "platform.admissions_direction_summary_v1(text,uuid,date,date)",
  ]) {
    assert.ok(migration.includes(`'${signature}'`), signature);
  }
  for (const name of replaced) {
    assert.match(functionBody(name), /^AS \$\$/u, name);
  }
  assert.equal((migration.match(/SECURITY DEFINER SET search_path ?= ?''/gu) ?? []).length, 4);
});

test("deliberately unchanged surfaces stay out of 244 (owner decisions B, C and E)", () => {
  for (const name of [
    "require_student_portal_cabinet_actor_e1",
    "assert_student_portal_cabinet_membership_e1",
    "prepare_student_portal_provisioning",
    "save_lead_sale_conditions_v1",
    "kb_require_admin",
    "staff_student_portal_curator_options",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`FUNCTION [a-z_]+\\.${name}\\(`, "u"), name);
    assert.doesNotMatch(migration, new RegExp(`'[a-z_]+\\.${name}\\(`, "u"), name);
  }
});

test("board move: staff with case.update.append, the per-case check still decides", () => {
  const body = functionBody("platform.move_case_pipeline_v1");
  assert.doesNotMatch(body, /platform_role IN \(/u);
  assert.match(body, /a\.platform_role IS DISTINCT FROM 'student'\s+AND platform_private\.staff_has_permission\(a\.organization_id, a\.membership_id, 'case\.update\.append'\);/u);
  assert.match(body, /IF NOT platform_private\.staff_can_access\(p_organization_id, actor\.membership_id, 'case\.update\.append', 'student_case', p_student_case_id\) THEN\s+RAISE EXCEPTION 'case_pipeline_forbidden' USING ERRCODE = '42501';/u);
  // The replay check stays BEFORE the per-case check, as in 187.
  assert.ok(body.indexOf("case_pipeline_request_id_conflict") < body.indexOf("staff_can_access(p_organization_id"));
  for (const message of ["case_pipeline_forbidden", "case_pipeline_invalid_command", "case_pipeline_request_id_conflict", "Case is not active in this pipeline"]) {
    assert.ok(body.includes(`'${message}'`), message);
  }
});

test("curator assignment calls the helper that exists and stays Admin-only", () => {
  const body = functionBody("private.assign_case_curator_v1");
  assert.doesNotMatch(body, /require_case_assignment_admin_locked/u);
  assert.match(body, /PERFORM platform_private\.require_case_assignment_operator_locked\(p_organization_id, p_student_case_id\);/u);
  assert.equal((body.match(/platform_private\.require_admin_actor\(p_organization_id, 'case\.curator\.assign'\)/gu) ?? []).length, 2);
  const lock = body.indexOf("lock_student_case_note_assignment_domain");
  const operator = body.indexOf("require_case_assignment_operator_locked");
  assert.ok(body.indexOf("require_admin_actor") < lock && lock < operator
    && operator < body.lastIndexOf("require_admin_actor"), "preflight, lock, locked recheck, Admin actor");
});

test("requirements save and read gates are self-verifying anchor replaces", () => {
  assert.ok(migration.includes(String.raw`old_lookup CONSTANT TEXT := $q$WHERE authority.platform_role<>'student';$q$;`));
  assert.ok(migration.includes(String.raw`new_lookup CONSTANT TEXT := $q$WHERE authority.platform_role IS DISTINCT FROM 'student';$q$;`));
  assert.match(migration, /RAISE EXCEPTION 'application_requirements_actor_lookup_anchor_drift'/u);
  assert.equal((migration.match(/\$q\$a\.platform_role NOT IN \('admin', 'curator'\)\$q\$/gu) ?? []).length, 3);
  assert.equal((migration.match(/\$q\$a\.platform_role NOT IN \('admin','curator'\)\$q\$/gu) ?? []).length, 1);
  assert.match(migration, /replace\(original, target\.old_gate, \$q\$a\.platform_role IS NOT DISTINCT FROM 'student'\$q\$\)/u);
  assert.match(migration, /RAISE EXCEPTION 'staff_admissions_read_gate_anchor_drift: %'/u);
});

test("lead cabinet: the lead permission decides, never portal provisioning", () => {
  const body = functionBody("platform.prepare_lead_cabinet_v1");
  assert.doesNotMatch(body, /platform_role IN \(/u);
  assert.match(body, /a\.platform_role IS DISTINCT FROM 'student';/u);
  assert.match(body, /IF NOT platform_private\.staff_can_access\(p_organization_id,actor\.membership_id,'lead\.sales\.workflow\.manage','lead',p_lead_id\) THEN/u);
  assert.doesNotMatch(body, /provisioning|cabinet_actor_e1|cabinet_membership_e1|invite/iu);
});

test("deletion requests: NULL no longer passes the Admin check", () => {
  const body = functionBody("platform.staff_account_deletion_requests_v1");
  assert.match(body, /a\.membership_id IS NULL OR a\.platform_role IS DISTINCT FROM 'admin'/u);
  assert.doesNotMatch(body, /platform_role <> 'admin'/u);
});

test("grants are restated as before and the migration verifies itself", () => {
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;\nGRANT EXECUTE ON FUNCTION/u);
  assert.doesNotMatch(migration, /GRANT [A-Z ,]+ TO (anon|service_role|PUBLIC)/u);
  assert.match(migration, /a244_access_by_permissions_verification_failed/u);
});

test("the real-Postgres suite runs at checkpoint 244 with production-shaped members", () => {
  assert.match(script, /== 244_\* \]\]; then\s+docker exec "\$container_name" \\\s+psql -X -v ON_ERROR_STOP=1 -h 127\.0\.0\.1 -U postgres -d "\$test_database" \\\s+-f \/workspace\/supabase\/tests\/platform_access_by_permissions\.sql/u);
  assert.match(suite, /^BEGIN;$/mu);
  assert.match(suite, /^ROLLBACK;\s*$/mu);
  assert.match(suite, /N244_ACCESS_BY_PERMISSIONS_SUITE_PASS/u);
  assert.match(suite, /= ARRAY\[35, 36, 23, 12, 16\], 'role bundles have the production key counts/u);
  assert.match(suite, /"current_role" IS NULL AND current_bundle_id IS NULL/u);
  assert.doesNotMatch(suite, /@(?!example\.invalid)[a-z0-9-]+\.[a-z]/iu, "synthetic addresses only");
  for (const probe of ["move_case_pipeline_v1", "assign_case_curator_v1", "staff_save_application_requirements_v1",
    "prepare_lead_cabinet_v1", "staff_account_deletion_requests_v1", "staff_admissions_pipeline_board_v1",
    "staff_student_case_queue_v1", "staff_student_case_queue_counts_v1", "admissions_direction_summary_v1"]) {
    assert.ok(suite.includes(`platform.${probe}(`), probe);
  }
});

test("the board move pre-check asks for the key the server checks per case", async () => {
  assert.match(pipeline, /if \(!staffHasPermission\(actor, "case\.update\.append"\)\) mutationFailure\("forbidden"\);/u);
  const statusOf = async (permissionKeys) => {
    try {
      await moveCasePipeline({ organizationId: ORG, systemRole: "staff", permissionKeys },
        { studentCaseId: "not-a-uuid", requestId: REQUEST, stage: "documents" });
    } catch (error) {
      assert.ok(error instanceof PlatformAdmissionsPipelineMutationError);
      return error.status;
    }
    return "resolved";
  };
  // admissions.write through task.manage alone: the server would refuse, so
  // the pre-check refuses before any input handling or network call.
  assert.equal(await statusOf(["case.read.full", "task.manage"]), "forbidden");
  // With the key the pre-check passes; the malformed id then fails closed
  // locally (still no network call).
  assert.equal(await statusOf(["case.read.full", "case.update.append"]), "unavailable");
  assert.equal(await statusOf(["case.read.full", "case.update.append", "case.route.manage"]), "unavailable");
});
