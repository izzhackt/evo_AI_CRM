import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Static regression boundaries; not a substitute for live role/file acceptance.
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = source("supabase/migrations/146_platform_partner_packets_student_help.sql");
const deadlines = source("supabase/migrations/145_platform_admissions_deadlines.sql");
function rpc(name) {
  const start = sql.indexOf(`CREATE FUNCTION ${name}(`);
  assert.ok(start >= 0);
  return sql.slice(start, sql.indexOf("END $$;", start) + 7);
}

test("all recorded Admissions deadline types share one scoped cursor projection", () => {
  for (const kind of ["application", "partner_reply", "correction", "offer", "passport_expiry", "visa_expiry", "eval_expiry", "entry_visa_expiry"]) {
    assert.ok(deadlines.includes(`'${kind}'`));
  }
  assert.match(deadlines, /private\.platform_can_read_student_case\(c\.organization_id,c\.id\)/u);
  assert.match(deadlines, /d\.source_key COLLATE "C"/u);
  assert.doesNotMatch(deadlines.slice(0, deadlines.indexOf("-- Preserve")), /primary_application_id/u);
  const calendar = source("src/lib/v3/calendar-contract.ts");
  assert.match(calendar, /admissions_deadline_page_v1/u);
  assert.doesNotMatch(calendar, /staff_application_deadline_page|staff_nearest_application_deadline/u);
});

test("a packet fixes approved verified private versions and requires write authority", () => {
  const prepare = rpc("platform.prepare_partner_packet_v1");
  assert.match(prepare, /require_case_operator\(a\.organization_id,a\.student_case_id,'application\.manage'\)/u);
  assert.match(prepare, /document\.read\.full/u);
  assert.match(prepare, /p_application_id IS NULL/u);
  assert.match(prepare, /prior\.application_id IS DISTINCT FROM p_application_id/u);
  for (const boundary of ["s.status='approved'", "v.integrity_status='verified'", "v.malware_status='clean'", "document_storage_bindings", "s.current_version_id", "'sha256'", "'versionNo'"]) assert.ok(prepare.includes(boundary));
  assert.match(prepare, /RETURN prior\.manifest/u);
  assert.doesNotMatch(prepare, /UPDATE platform\.(university_applications|document_versions)|packageSentOn|universitySubmittedOn/u);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON platform_private\.partner_packets/u);
  assert.match(sql, /BEFORE TRUNCATE ON platform_private\.partner_packets/u);
  assert.match(source("src/components/v3/profile/PartnerPacketsPanel.tsx"), /\/api\/v2\/document-versions\/\$\{file\.versionId\}\/download/u);
});

test("Student help binds the exact accessible portal case and preserves private assessments", () => {
  const authority = rpc("platform_private.require_case_operations_actor");
  assert.match(authority, /count\(\*\) FROM platform\.student_portal_cases\(\)\)<>1/u);
  assert.match(authority, /JOIN platform\.student_portal_cases\(\) portal ON portal\.case_id=s\.id/u);
  assert.match(rpc("platform.create_case_help_request_v1"), /require_case_operations_actor\(NULL,TRUE\)/u);
  const answer = rpc("platform.answer_case_help_request_v1");
  assert.match(answer, /require_case_operator\(a\.organization_id,a\.student_case_id,'case\.update\.append'\)/u);
  assert.match(answer, /p_expected_version/u);
  assert.match(answer, /40001/u);
  assert.doesNotMatch(sql, /assessment_attempts|assessment_answers|career_result|english_result/u);
});

test("case-help notifications contain identifiers only and check current case access", () => {
  const create = rpc("platform.create_case_help_request_v1");
  const notification = create.slice(create.indexOf("INSERT INTO platform.staff_notifications"));
  assert.doesNotMatch(notification, /p_subject|p_body|h\.body|h\.subject/u);
  assert.match(sql, /private\.platform_can_read_student_case/u);
  assert.match(source("src/lib/platform-staff-notifications-contract.ts"), /#case-help/u);
});

test("uncertain command retries preserve the original payload and do not silently reset", () => {
  const form = source("src/components/v3/profile/CaseOperationsForms.tsx");
  assert.match(form, /const payload = frozen\.current \?\? input; frozen\.current = payload/u);
  assert.match(form, /response\.code !== "unavailable"/u);
  assert.match(form, /visible\.code === "unavailable"\) return/u);
  const actions = source("src/lib/platform-admissions-support-actions.ts");
  assert.match(actions, /await requirePlatformStaffActor\(\)/u);
  assert.match(actions, /await requireStudentPortalActor\(\)/u);
  assert.match(actions, /actor\.presentationRole !== actor\.authorityRole/u);
});

test("case navigation remounts scoped drafts without resetting same-case retries", () => {
  const page = source("src/app/(v3)/v3/profile/page.tsx");
  const key = page.slice(page.indexOf("<Profile\n"), page.indexOf("profile={view.profile}"));
  for (const identity of ["actor.organizationId", "actor.authUserId", "actor.authorityRole", "actor.presentationRole", "routeTarget.studentCaseId", "routeTarget.leadId"]) assert.ok(key.includes(identity));
  assert.doesNotMatch(key, /randomUUID|requestId/u);
  assert.match(source("src/components/v3/profile/CaseHelpWorkspace.tsx"), /<CaseHelpPanel key=/u);
});

test("Student next action reuses canonical finance without adding payment writes", () => {
  const portal = source("src/lib/v3/portal-source.ts");
  assert.match(portal, /readStudentPortalPayments/u);
  assert.match(portal, /outstandingMinor/u);
  assert.match(source("src/components/v3/portal/OverviewView.tsx"), /\/portal\/payments/u);
  assert.doesNotMatch(source("src/lib/platform-admissions-support-actions.ts"), /payment|refund|settle_finance/iu);
});
