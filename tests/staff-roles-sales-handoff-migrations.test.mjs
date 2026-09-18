// Source-contract guards only. These read the actual migration/workflow files;
// they are not database execution, staff login or sale/handoff acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const paths = [
  "supabase/migrations/173_platform_staff_business_roles.sql",
  "supabase/migrations/174_platform_sales_report_handoff.sql",
  "supabase/migrations/175_platform_staff_password_onboarding.sql",
];
const [roles, handoff, accounts] = paths.map(source);
const workflow = source(".github/workflows/evo-fast-pr-checks.yml");

test("staff fast path accepts only the complete exact added 173–175 boundary diff", () => {
  const expected = paths.map(path => `A\\t${path}`).join("\\n");
  assert.ok(workflow.includes(`staff_diff=$'${expected}'`));
  assert.ok(workflow.includes('if [[ "$boundary_diff" == "$staff_diff" ]]; then'));
  assert.ok(workflow.includes('git diff --name-status --no-renames origin/main...HEAD -- supabase/migrations/ supabase/tests/ scripts/test-postgres-authorization.sh'));
  assert.match(workflow, /echo "scoped_staff_handoff=true" >> "\$GITHUB_OUTPUT"\n\s+else\n\s+echo "scoped_staff_handoff=false"/u);
  assert.ok(workflow.includes("if: ${{ steps.migration-scope.outputs.scoped_chat_mute != 'true' && steps.migration-scope.outputs.scoped_staff_handoff != 'true' }}"));
  assert.match(workflow, /run: npm run test:database:migration-boundaries/u);
  assert.ok(workflow.includes("if [[ \"$boundary_diff\" == $'A\\tsupabase/migrations/171_platform_team_chat_remove_mute.sql' ]]; then"));
  assert.match(workflow, /node --test tests\/staff-roles-sales-handoff-migrations\.test\.mjs/u);
});

test("all three migrations are transactional and fail closed on source drift", () => {
  for (const sql of [roles, handoff, accounts]) {
    assert.match(sql, /^BEGIN;$/mu);
    assert.match(sql, /^COMMIT;\s*$/mu);
    assert.match(sql, /RAISE EXCEPTION/u);
    assert.doesNotMatch(sql, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
  }
  assert.match(roles, /staff_business_roles_source_drift/u);
  assert.match(handoff, /sales_report_handoff_(?:definition|gate_definition)_changed/u);
  assert.match(accounts, /staff_password_onboarding_source_drift/u);
});

test("shared role templates keep scoped confirmation and dormant future roles", () => {
  for (const slug of ["sales", "sales-manager", "admissions", "admissions-manager", "marketing", "accountant"]) {
    assert.ok(roles.includes(`('${slug}',`));
  }
  assert.match(roles, /expected_scope:=CASE WHEN spec\.slug='sales-manager' THEN 'department'/u);
  assert.match(roles, /'admissions-manager'\) THEN 'organization' ELSE 'own' END/u);
  assert.match(roles, /CASE WHEN cardinality\(keys\)=0 THEN 'archived' ELSE 'active' END/u);
  assert.match(roles, /staff_validate_permission_keys\(to_jsonb\(keys\)\)/u);
  assert.match(roles, /staff_can_access\(actor\.organization_id,actor\.membership_id,/u);
  assert.doesNotMatch(roles, /INSERT\s+INTO\s+auth\.users|INSERT\s+INTO\s+platform\.staff_role_assignments/iu);
});

test("report creation uses private handoff while retaining gates and historical edits", () => {
  assert.match(handoff, /CREATE FUNCTION platform\.create_sales_report_handoff\(/u);
  assert.match(handoff, /PERFORM platform_private\.handoff_lead_to_admissions\(selected_lead_id,selected_gate_version,p_curator_membership_id,'sales_report'/u);
  assert.match(handoff, /REVOKE ALL ON FUNCTION platform_private\.handoff_lead_to_admissions\(UUID,BIGINT,UUID,TEXT,TEXT,UUID\)\s+FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;/u);
  const publicWrapper = handoff.slice(handoff.indexOf("CREATE OR REPLACE FUNCTION platform.handoff_lead_to_admissions("), handoff.indexOf("CREATE TABLE platform_private.sales_report_handoff_requests"));
  assert.match(publicWrapper, /NOT IN \('normal','exceptional_override'\)/u);
  assert.doesNotMatch(publicWrapper, /'sales_report'/u);
  assert.match(handoff, /IF p_operation=''create'' THEN RAISE EXCEPTION ''sales_register_curator_required''/u);
  assert.match(handoff, /prior\.actor_membership_id<>actor\.membership_id OR prior\.fingerprint<>fingerprint/u);
  assert.match(handoff, /sales_register_already_transferred/u);
  assert.match(handoff, /UPDATE platform_private\.sales_register r SET report_month=/u);
  assert.doesNotMatch(handoff, /UPDATE\s+platform\.lead_admissions_gates|gate_state\s*:=\s*'satisfied'|contract_confirmed\s*=\s*TRUE/iu);
});

test("password onboarding extends audited identity reconciliation without storing passwords", () => {
  assert.match(accounts, /CHECK\(operation IN \('invite','recovery','password'\)\)/u);
  assert.match(accounts, /platform\.staff_workspace_claim_auth/u);
  assert.match(accounts, /platform\.staff_workspace_reconcile_auth/u);
  assert.match(accounts, /email_confirmed_at IS NOT NULL/u);
  assert.match(accounts, /raw_app_meta_data->>'evo_staff_password_request_id'=r\.id::TEXT/u);
  assert.match(accounts, /'operation',r\.operation/u);
  assert.doesNotMatch(accounts, /ADD COLUMN\s+(?:password|encrypted_password)|INSERT\s+INTO\s+auth\.users|UPDATE\s+auth\.users|GRANT\s+.*TO\s+service_role/iu);
});
