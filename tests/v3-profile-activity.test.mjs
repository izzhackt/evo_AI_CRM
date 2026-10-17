import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { journalEvent } from "../src/lib/v3/wording.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/132_platform_case_activity_timeline.sql");
const source = read("src/lib/v3/profile-activity-source.ts");
const page = read("src/app/(v3)/v3/profile/page.tsx");

// Source contracts supplement, never replace, actual DB/Auth/browser acceptance.
test("every action emitted by the real activity projection has user-facing wording", () => {
  const actions = new Set([...migration.matchAll(/'((?:case|lead|task|application|visa|document|finance|communication)\.[a-z_.]+)'/gu)]
    .map((match) => match[1])
    .filter((action) => action !== "finance.read.summary"));
  assert.ok(actions.size > 20);
  for (const action of actions) assert.ok(journalEvent(action), `Missing wording for ${action}`);
});

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
  assert.match(read("src/lib/v3/profile-source.ts"), /staffPresentationCan\(actor, "admissions\.read"\)/u);
  assert.match(page, /singleSearchParam\(params\.tab\) === "history" \? \{ cursor: activityCursor \}/u);
});

// Смена направления дела в «Истории» (миграция «аудит направления», номер 302).
// Исходные проверки дополняют, но не заменяют настоящую проверку БД и браузера.
const directionMigration = read("supabase/migrations/302_platform_case_direction_audit.sql");

test("the history stream gains the direction event and its one field, and nothing else changes", () => {
  // Список действий: самопроверяемая замена куска (приём 241), ровно одно действие.
  assert.match(directionMigration, /\$old\$'case\.next\.action\.change'\]::TEXT\[\]\)\$old\$/u);
  assert.match(directionMigration, /\$new\$'case\.next\.action\.change','case\.direction\.set'\]::TEXT\[\]\)\$new\$/u);
  // Поле только у этого действия; остальные события остаются как были (выгрузка базы знаний не меняется).
  assert.match(directionMigration, /\) \|\| CASE WHEN action = 'case\.direction\.set' THEN jsonb_build_object\('direction_change',/u);
  assert.match(directionMigration, /ELSE '\{\}'::JSONB END\s+ORDER BY created_at DESC, id DESC\) FILTER \(WHERE ordinal <= p_limit\)/u);
  // Значения берутся из записи события этой организации и проходят общий помощник (только пять кодов).
  assert.match(directionMigration, /direction_event\.organization_id = actor\.organization_id AND direction_event\.id = numbered\.id/u);
  assert.match(directionMigration, /platform_private\.case_direction_change\(direction_event\.before_state, direction_event\.after_state\)/u);
  // Любой кусок, найденный не ровно один раз, откатывает миграцию.
  assert.match(directionMigration, /staff_student_case_activity_source_anchor_drift/u);
  assert.match(directionMigration, /a302_activity_anchor_drift/u);
  // Сама функция потока по-прежнему не меняет подпись и права (CREATE OR REPLACE по её же телу).
  assert.doesNotMatch(directionMigration, /DROP FUNCTION|GRANT |CREATE FUNCTION private\.staff_student_case_activity/u);
});

test("the history reads the direction change as codes only, requires it on its event alone, and words come from wording.ts", () => {
  assert.match(source, /parseCaseDirectionChange\(row\[DIRECTION_KEY\]\)/u);
  assert.match(source, /carriesDirection !== \(row\.action === DIRECTION_ACTION\)\) return fail\(\)/u);
  assert.match(source, /\.\.\.\(directionChange \? \{ directionChange \} : \{\}\)/u);
  // Ни один экран не переводит направление по месту: слова даёт journalEventText.
  for (const file of [
    "src/components/v3/profile/tabs.tsx",
    "src/components/v3/profile/case-work-view.ts",
    "src/components/v3/knowledge/KnowledgeDossiers.tsx",
    "src/components/v3/settings/sections.tsx",
  ]) {
    const text = read(file);
    assert.match(text, /journalEventText\(/u, file);
    assert.doesNotMatch(text, /Направление: |DIRECTION_LABELS/u, file);
  }
  assert.match(read("src/components/v3/profile/tabs.tsx"), /journalEventText\(entry\.transition, entry\.directionChange\)/u);
  assert.match(read("src/components/v3/profile/case-work-view.ts"), /journalEventText\(event\.transition, event\.directionChange\)/u);
  assert.match(read("src/components/v3/settings/sections.tsx"), /journalEventText\(entry\.transition, entry\.directionChange\)/u);
});

test("the direction event in the history has wording, so the stream does not refuse the page", () => {
  assert.equal(journalEvent("case.direction.set"), "Направление дела изменено");
});
