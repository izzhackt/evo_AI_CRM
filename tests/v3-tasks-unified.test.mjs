// Source-contract guards for OTH-2 (unified staff-task composer/panel +
// notifications v2). Static regression boundaries, same style as
// tests/platform-lead-sale-conditions-migration.test.mjs for the SQL pins
// and tests/staff-task-workspace.test.mjs for the page-source pins; this is
// not database execution (no Supabase credentials here) and not a browser
// acceptance run.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const composer = source("src/components/v3/tasks/TaskComposerDialog.tsx");
const panelPage = source("src/app/(v3)/v3/tasks/page.tsx");
const caseTasksPanel = source("src/components/v3/profile/CaseTasksPanel.tsx");
const admissionsTaskActions = source("src/lib/platform-admissions-task-actions.ts");
const notificationsContract = source("src/lib/platform-staff-notifications-contract.ts");
const notificationsUi = source("src/components/v3/StaffNotifications.tsx");
const notificationsActions = source("src/lib/v3/staff-notification-actions.ts");
const notificationsSource = source("src/lib/v3/staff-notification-source.ts");
const sql = source("supabase/migrations/188_platform_staff_notifications_v2.sql");

test("migration 188 is present (186/187 belong to parallel slices; merge order closes the gap)", () => {
  // Not scripts/fast-release-ledger-gate.mjs's expectedMigrationVersions()
  // here deliberately: that helper requires an unbroken 001..N run, and this
  // worktree genuinely has no 186_* file (the S2 task instructions name this
  // gap explicitly: "if a 186 block does not exist in this worktree, model
  // on 185_*" -- 186 belongs to a sibling OTH-1 branch not merged here yet).
  // Asserting full contiguity would therefore fail for a reason outside this
  // slice's control; this test only pins what this slice actually owns.
  const names = readdirSync(new URL("../supabase/migrations", import.meta.url))
    .filter((name) => /^\d{3}_.+\.sql$/u.test(name)).map((name) => name.slice(0, 3)).sort();
  assert.ok(names.includes("184") && names.includes("185") && names.includes("188"));
  assert.equal(new Set(names).size, names.length, "duplicate migration version prefix");
});

test("migration 188 is transactional and fails closed on source drift, like 181/185", () => {
  assert.match(sql, /^BEGIN;$/mu);
  assert.match(sql, /^COMMIT;\s*$/mu);
  assert.match(sql, /RAISE EXCEPTION/u);
  assert.doesNotMatch(sql, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
});

test("the composer has no upfront 'Тип задачи' radio fieldset; the case attachment itself decides", () => {
  assert.doesNotMatch(composer, /Тип задачи/u);
  assert.doesNotMatch(composer, /name="task-composer-kind"/u);
  assert.doesNotMatch(composer, /type="radio"/u);
});

test("the title field is focused immediately", () => {
  assert.match(composer, /<input ref=\{titleInputRef\} name="title" required maxLength=\{1000\} autoFocus/u);
  // Belt and braces: showModal() alone cannot focus a field, since React's
  // own autoFocus commit can land before the dialog is actually shown.
  assert.match(composer, /titleInputRef\.current\?\.focus\(\)/u);
});

test("submitting with a case chosen routes through the canonical create_case_task RPC", () => {
  assert.match(composer, /import \{ createPlatformAdmissionsTaskAction \} from "@\/lib\/platform-admissions-task-actions"/u);
  assert.match(composer, /if \(caseMode\) \{/u);
  assert.match(composer, /await createPlatformAdmissionsTaskAction\(/u);
  assert.match(admissionsTaskActions, /client\.schema\("platform"\)\.rpc\("create_case_task", \{/u);
  // No case: the existing mutate_staff_task 'create' path, unchanged.
  assert.match(composer, /await mutateStaffTaskAction\(/u);
  assert.match(composer, /form\.set\("operation", "create"\)/u);
});

test("the unified composer is reachable from both the task list and a case (CaseTasksPanel)", () => {
  assert.match(panelPage, /import \{ TaskComposerDialog \} from "@\/components\/v3\/tasks\/TaskComposerDialog"/u);
  assert.match(caseTasksPanel, /import \{ TaskComposerDialog \} from "@\/components\/v3\/tasks\/TaskComposerDialog"/u);
  assert.match(caseTasksPanel, /initialCase=\{\{ id: caseId, name: caseName \}\}/u);
});

test("the task-list page renders a right-side/full-screen panel instead of navigating to a separate page", () => {
  assert.match(panelPage, /import \{ TaskDetailPanel \} from "@\/components\/v3\/tasks\/TaskDetailPanel"/u);
  assert.doesNotMatch(panelPage, /PartShell title="Рабочая задача"/u);
  assert.match(panelPage, /readCalendarTaskTarget\(actor, selectedCaseId, taskId\)/u);
});

test("closing the panel returns to the same list URL with its filters, cursor and scroll position preserved", () => {
  // Source pin: the close/list href is built from the SAME domain/view/status
  // (+ pagination cursor) the list itself renders with, not a bare /v3/tasks.
  assert.match(panelPage, /const listParams: Record<string, string> = \{ type: domain, view, status \};/u);
  assert.match(panelPage, /const closeHref = `\/v3\/tasks\?\$\{new URLSearchParams\(listParams\)\}`;/u);
  assert.match(panelPage, /function taskHref\(item: WorkspaceTask\): string \{/u);
  // scroll={false} on the row links: opening/closing the panel must not
  // reset the list's scroll position via Next.js's default scroll-to-top.
  assert.match(panelPage, /<Link href=\{taskHref\(item\)\} scroll=\{false\}/u);
  const panel = source("src/components/v3/tasks/TaskDetailPanel.tsx");
  assert.match(panel, /<Link href=\{closeHref\}/u);
});

test("case tasks open in the same /v3/tasks panel, never a redirect to /v3/calendar", () => {
  assert.doesNotMatch(panelPage, /v3\/calendar\?case=/u);
  assert.match(panelPage, /query\.set\("kind", "case"\); query\.set\("case", item\.task\.studentCaseId\);/u);
});

test("the notifications contract decodes the v2 enrichment fields", () => {
  assert.match(notificationsContract, /actorDisplayName: string \| null;/u);
  assert.match(notificationsContract, /subjectTitle: string \| null;/u);
  assert.match(notificationsContract, /studentDisplayName: string \| null;/u);
  assert.match(notificationsContract, /"case_task_assigned"/u);
  assert.match(notificationsContract, /"task_due"/u);
  // #case-help is pinned by tests/v3-admissions-support.test.mjs; untouched.
  assert.match(notificationsContract, /#case-help/u);
  assert.match(notificationsSource, /\.rpc\("staff_notifications_page_v2", \{/u);
});

test("'Прочитать всё' exists as one server action reachable from the panel menu, no per-row mark-read affordance beyond the click-through", () => {
  assert.match(notificationsActions, /export async function markAllStaffNotificationsReadAction/u);
  assert.match(notificationsSource, /\.rpc\("mark_all_staff_notifications_read", \{/u);
  assert.match(notificationsUi, /Прочитать всё/u);
  assert.match(notificationsUi, /role="menu"/u);
  // The always-visible "Обновить" was demoted: it must not sit in the
  // primary panel header any more, only as a retry after a real failure.
  assert.doesNotMatch(notificationsUi, />Обновить</u);
  assert.match(notificationsUi, />Повторить</u);
});

test("migration 188 extends the kind/shape CHECK with the two new kinds, additively", () => {
  assert.match(sql, /ADD COLUMN case_task_id UUID,\s*\n\s*ADD COLUMN actor_membership_id UUID,/u);
  assert.match(sql, /'case_task_assigned', 'task_due'/u);
  assert.match(sql, /kind = 'case_task_assigned' AND case_task_id IS NOT NULL AND student_case_id IS NOT NULL/u);
  assert.match(sql, /kind = 'task_due' AND help_request_id IS NULL AND message_id IS NULL AND student_case_id IS NULL/u);
});

test("mark_all_staff_notifications_read and staff_notifications_page_v2 have the specified signatures", () => {
  assert.match(sql, /CREATE FUNCTION platform\.mark_all_staff_notifications_read\(p_organization_id UUID\)/u);
  assert.match(sql, /CREATE FUNCTION platform\.staff_notifications_page_v2\(\s*p_organization_id UUID, p_before_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL\s*\)/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION platform\.mark_all_staff_notifications_read\(UUID\),\s*\n\s*platform\.staff_notifications_page_v2\(UUID, TIMESTAMPTZ, UUID\)/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.mark_all_staff_notifications_read\(UUID\),\s*\n\s*platform\.staff_notifications_page_v2\(UUID, TIMESTAMPTZ, UUID\)\s*\n\s*TO authenticated;/u);
});

test("the due reminder is materialized with ON CONFLICT DO NOTHING, keyed by task id and current due", () => {
  const page = sql.slice(sql.indexOf("CREATE FUNCTION platform.staff_notifications_page_v2("), sql.indexOf("-- Visibility: extend"));
  assert.match(page, /'task-reminder:' \|\| t\.id::TEXT \|\| ':' \|\| COALESCE\(t\.due_at::TEXT, t\.due_on::TEXT\)/u);
  assert.match(page, /ON CONFLICT \(organization_id, recipient_membership_id, event_key\) DO NOTHING;/u);
  assert.match(page, /t\.status NOT IN \('done', 'cancelled'\)/u);
  // Stale-reminder neutralization: completed/cancelled, cleared or changed due.
  assert.match(page, /t\.status IN \('done', 'cancelled'\) OR \(t\.due_at IS NULL AND t\.due_on IS NULL\)/u);
});

test("the old staff_notifications_page keeps its exact signature and row shape, and never returns a new kind", () => {
  const old = sql.slice(sql.lastIndexOf("CREATE OR REPLACE FUNCTION platform.staff_notifications_page("));
  assert.match(old, /CREATE OR REPLACE FUNCTION platform\.staff_notifications_page\(p_organization_id UUID,p_before_at TIMESTAMPTZ DEFAULT NULL,p_before_id UUID DEFAULT NULL\)/u);
  assert.match(old, /n\.kind IN \('task_assigned','task_updated','chat_mention','case_help'\)/u);
  assert.doesNotMatch(old, /'case_task_assigned'|'task_due'/u);
  // Row shape is byte-identical to the pre-188 (146+156) body: no new keys.
  assert.doesNotMatch(old, /actor_display_name|subject_title|student_display_name|case_task_id/u);
});

test("case-task assignment gets its own trigger on the append-only case_task_events log, mirroring notify_staff_task_event", () => {
  assert.match(sql, /CREATE FUNCTION platform_private\.notify_case_task_event\(\) RETURNS TRIGGER/u);
  assert.match(sql, /CREATE TRIGGER case_task_event_notifications AFTER INSERT ON platform\.case_task_events/u);
  // Keyed by the per-event case_task_events row id, not by case_task_id +
  // assignee: a reassign-away-and-back cycle mints the same new_assignee
  // twice (the create-time event and the reassign-back event), so a key
  // built from those two alone would collide on ON CONFLICT DO NOTHING and
  // silently drop the second notification.
  assert.match(sql, /'case-task:' \|\| NEW\.id::TEXT/u);
  assert.match(sql, /IF NEW\.new_assignee_membership_id = NEW\.actor_membership_id THEN RETURN NEW; END IF;/u);
});
