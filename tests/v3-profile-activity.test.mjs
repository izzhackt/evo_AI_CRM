import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/132_platform_case_activity_timeline.sql");
const source = read("src/lib/v3/profile-activity-source.ts");
const page = read("src/app/(v3)/v3/profile/page.tsx");

// Source contracts supplement, never replace, actual DB/Auth/browser acceptance.
test("activity replaces the unused projection and exposes an invoker-only exact-case stream", () => {
  assert.match(migration, /DROP FUNCTION platform\.staff_student_case_activity\(UUID, INTEGER\)/u);
  assert.match(migration, /u7_require_case_workspace_actor\(p_student_case_id\)/u);
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/u);
  assert.match(migration, /LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = ''/u);
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin/u);
});

test("activity pages one ordered stream and suppresses duplicate recorded-message audit", () => {
  assert.match(migration, /\(event\.created_at, event\.id\) < \(p_before_at, p_before_id\)/u);
  assert.match(migration, /ORDER BY created_at DESC, id DESC LIMIT p_limit \+ 1/u);
  assert.match(migration, /NOT EXISTS \(SELECT 1 FROM platform\.audit_events/u);
  assert.match(migration, /platform_can_read_communication_full/u);
  assert.match(migration, /finance\.read\.summary/u);
});

test("safe history never serializes audit bodies or document author/time", () => {
  assert.doesNotMatch(source, /before_state|after_state|body_text|actor_profile_id|author_display_name/u);
  assert.match(migration, /CASE WHEN kind = 'documents' THEN NULL ELSE created_at END/u);
  assert.match(source, /seen\.has\(id\)/u);
  assert.match(source, /data\.organization_id !== actor\.organizationId/u);
  assert.match(source, /data\.student_case_id !== studentCaseId/u);
  assert.match(source, /case: studentCaseId, task: targetId/u);
});

test("history cursor is explicit and never escalates Sales into full-case reads", () => {
  assert.match(page, /invalidActivityCursor/u);
  assert.match(page, /actor\.presentationRole === "sales"/u);
  assert.match(read("src/lib/v3/profile-source.ts"), /actor\.presentationRole !== "sales"/u);
  assert.match(page, /singleSearchParam\(params\.tab\) === "history" \? \{ cursor: activityCursor \}/u);
});
