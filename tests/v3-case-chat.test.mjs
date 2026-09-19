// OTH-5 «Переписка по делу» (per-case staff chat). Source-contract guards
// only — these read the actual migration/TS files; they are not database
// execution (no Supabase credentials in this environment; the migration is
// not applied here). Behavior is checked by pattern-matching, the same
// style tests/platform-lead-sale-conditions-migration.test.mjs and
// tests/platform-notifications-v2-migration.test.mjs (188) use.
//
// Deliberately absent: an `expectedMigrationVersions`/ledger-contiguity
// assertion. This branch's base does not contain migrations 189/190
// (sibling OTH slices merged separately); 191 continuing straight after 188
// is a real, temporary gap the task instructions explicitly forbid
// asserting away in tests (merge order closes it, not renumbering).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = source("supabase/migrations/191_platform_case_chat.sql");

test("migration 191 is transactional and fails closed on source drift, like 181/187/188", () => {
  assert.match(migration, /^BEGIN;$/mu);
  assert.match(migration, /^COMMIT;\s*$/mu);
  assert.match(migration, /RAISE EXCEPTION/u);
  assert.doesNotMatch(migration, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
});

test("case_chat_messages/case_chat_threads carry the specified columns, FKs and hygiene CHECKs", () => {
  const table = migration.slice(migration.indexOf("CREATE TABLE platform.case_chat_messages"), migration.indexOf("CREATE INDEX case_chat_messages_case_idx"));
  assert.match(table, /sequence_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE/u);
  assert.match(table, /body TEXT NOT NULL/u);
  assert.match(table, /quoted_message_id UUID/u);
  assert.match(table, /attachment_kind TEXT CHECK \(attachment_kind IN \('document', 'case_task'\)\)/u);
  assert.match(table, /attachment_id UUID/u);
  // Same-case quote FK (a CHECK cannot join) — carries student_case_id, same
  // shape as team_chat's own parent_message_id FK.
  assert.match(table, /FOREIGN KEY \(organization_id, student_case_id, quoted_message_id\)\s*REFERENCES platform\.case_chat_messages\(organization_id, student_case_id, id\)/u);
  assert.match(table, /CHECK \(id IS DISTINCT FROM quoted_message_id\)/u);
  assert.match(table, /CHECK \(attachment_id IS NOT NULL OR char_length\(body\) >= 1\)/u);
  // The control-character CHECK used by team_chat (141), mirrored here as a
  // genuine table-level CHECK (team_chat only enforces it in its command RPC).
  assert.match(table, /CHECK \(body !~ '\[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F\]'\)/u);
  assert.match(table, /CHECK \(\(attachment_kind IS NULL\) = \(attachment_id IS NULL\)\)/u);

  const threads = migration.slice(migration.indexOf("CREATE TABLE platform.case_chat_threads"), migration.indexOf("---------------------------------------------------------------------------\n-- b)"));
  assert.match(threads, /await_state TEXT NOT NULL DEFAULT 'none' CHECK \(await_state IN \('none', 'needs_reply', 'awaiting_student'\)\)/u);
  assert.match(threads, /await_set_by_membership_id UUID/u);
  assert.match(threads, /last_message_sequence_id BIGINT/u);
  assert.match(threads, /PRIMARY KEY \(organization_id, student_case_id\)/u);
});

test("case_chat_messages and case_chat_receipts are append-only via block_append_only_mutation, ROW and STATEMENT", () => {
  for (const table of ["platform.case_chat_messages", "platform_private.case_chat_receipts"]) {
    const escaped = table.replace(".", "\\.");
    assert.match(migration, new RegExp(`CREATE TRIGGER \\w+_append_only BEFORE UPDATE OR DELETE\\s*ON ${escaped} FOR EACH ROW EXECUTE FUNCTION platform_private\\.block_append_only_mutation\\(\\);`, "u"));
    assert.match(migration, new RegExp(`CREATE TRIGGER \\w+_no_truncate BEFORE TRUNCATE\\s*ON ${escaped} FOR EACH STATEMENT EXECUTE FUNCTION platform_private\\.block_append_only_mutation\\(\\);`, "u"));
  }
  // case_chat_threads and case_chat_read_positions are deliberately mutable
  // (thread header / per-staff read cursor) — no append-only guard on either.
  assert.doesNotMatch(migration, /CREATE TRIGGER \w*case_chat_threads\w*_append_only/u);
  assert.doesNotMatch(migration, /CREATE TRIGGER \w*read_positions\w*_append_only/u);
});

test("case_chat_receipts has the specified idempotency shape (fingerprint, not raw input/result)", () => {
  const table = migration.slice(migration.indexOf("CREATE TABLE platform_private.case_chat_receipts"), migration.indexOf("CREATE TRIGGER case_chat_receipts_append_only"));
  assert.match(table, /fingerprint TEXT NOT NULL/u);
  assert.match(table, /receipt JSONB NOT NULL/u);
  assert.match(table, /PRIMARY KEY \(organization_id, actor_membership_id, request_id\)/u);
});

test("every exposed platform.*/platform_private.* function in this migration is REVOKE/GRANT-paired to authenticated only", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION platform_private\.case_chat_can_subscribe\(TEXT\),\s*platform\.case_chat_command\(UUID, UUID, UUID, JSONB\),\s*platform\.case_chat_read_page_v1\(UUID, UUID, TEXT, BIGINT\),\s*platform\.staff_case_chat_threads_v1\(TEXT\)\s*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION platform_private\.case_chat_can_subscribe\(TEXT\),\s*platform\.case_chat_command\(UUID, UUID, UUID, JSONB\),\s*platform\.case_chat_read_page_v1\(UUID, UUID, TEXT, BIGINT\),\s*platform\.staff_case_chat_threads_v1\(TEXT\)\s*TO authenticated;/u);
  assert.match(migration, /REVOKE ALL ON platform\.case_chat_messages, platform\.case_chat_threads,\s*platform_private\.case_chat_receipts, platform_private\.case_chat_read_positions\s*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u);
});

test("case_chat_command is SECURITY DEFINER, search_path-locked, and gates modes on the specified permissions", () => {
  const fn = migration.slice(migration.indexOf("CREATE FUNCTION platform.case_chat_command("), migration.indexOf("CREATE FUNCTION platform.case_chat_read_page_v1("));
  assert.match(fn, /SECURITY DEFINER SET search_path = ''/u);
  assert.match(fn, /IF actor\.platform_role = 'student' THEN\s*RAISE EXCEPTION 'case_chat_forbidden' USING ERRCODE = '42501';/u);
  assert.match(fn, /IF mode IN \('post', 'set_await'\) AND NOT platform_private\.staff_can_access\(\s*p_organization_id, actor\.membership_id, 'case\.update\.append', 'student_case', p_student_case_id\s*\)/u);
  assert.match(fn, /IF mode = 'read' AND NOT platform_private\.staff_can_access\(\s*p_organization_id, actor\.membership_id, 'case\.read\.full', 'student_case', p_student_case_id\s*\)/u);
  // Double advisory-lock order: per-actor-request, THEN per-case — same
  // order as platform.team_chat_command (141).
  const requestLock = fn.indexOf("pg_advisory_xact_lock(hashtextextended('case-chat-request:");
  const caseLock = fn.indexOf("pg_advisory_xact_lock(hashtextextended('case-chat:'");
  assert.ok(requestLock > 0 && caseLock > requestLock, "lock order must be per-actor-request THEN per-case");
  // Receipt idempotency via fingerprint, replay-with-different-input is a conflict (40001), not a silent 22023.
  assert.match(fn, /IF prior\.fingerprint <> fingerprint THEN\s*RAISE EXCEPTION 'case_chat_request_conflict' USING ERRCODE = '40001';/u);
  // Attachment existence, scoped to THIS case only.
  assert.match(fn, /FROM platform\.document_slots d\s*WHERE d\.id = attachment_id AND d\.organization_id = p_organization_id AND d\.student_case_id = p_student_case_id/u);
  assert.match(fn, /FROM platform\.case_tasks t\s*WHERE t\.id = attachment_id AND t\.organization_id = p_organization_id AND t\.student_case_id = p_student_case_id/u);
  // Same-case quote lookup.
  assert.match(fn, /SELECT \* INTO quoted FROM platform\.case_chat_messages m\s*WHERE m\.id = quoted_id AND m\.organization_id = p_organization_id AND m\.student_case_id = p_student_case_id;/u);
  // post updates the thread row; staff posts never touch await_state (the
  // student branch is written but unreachable in this migration).
  assert.match(fn, /await_state = CASE WHEN actor\.platform_role = 'student' THEN 'needs_reply'\s*ELSE platform\.case_chat_threads\.await_state END;/u);
  // Realtime: invalidate-only broadcast, no message content in the payload, after post only.
  assert.match(fn, /PERFORM realtime\.send\(jsonb_build_object\('refresh', true\), 'invalidate',\s*'case-chat:' \|\| p_organization_id::TEXT \|\| ':' \|\| p_student_case_id::TEXT, true\);/u);
  // Read alone never clears "Нужен ответ": the read branch never writes to
  // platform.case_chat_threads (a comment may name the table; no INSERT/
  // UPDATE statement against it may appear in this branch).
  const readBranch = fn.slice(fn.indexOf("ELSE -- mode = 'read'"));
  assert.doesNotMatch(readBranch, /(?:INSERT INTO|UPDATE)\s+platform\.case_chat_threads/u);
  assert.match(readBranch, /INSERT INTO platform_private\.case_chat_read_positions/u);
});

test("case_chat_read_page_v1 and staff_case_chat_threads_v1 gate on case.read.full and reuse the board's own visibility predicate", () => {
  const readPage = migration.slice(migration.indexOf("CREATE FUNCTION platform.case_chat_read_page_v1("), migration.indexOf("CREATE FUNCTION platform.staff_case_chat_threads_v1("));
  assert.match(readPage, /OR NOT platform_private\.staff_can_access\(p_organization_id, actor\.membership_id, 'case\.read\.full', 'student_case', p_student_case_id\)/u);
  assert.match(readPage, /'attachmentLabel', CASE\s*WHEN m\.attachment_kind = 'document' THEN document_requirement\.label\s*WHEN m\.attachment_kind = 'case_task' THEN case_task\.title/u);
  assert.match(readPage, /LIMIT 51/u);

  const threadsList = migration.slice(migration.indexOf("CREATE FUNCTION platform.staff_case_chat_threads_v1("), migration.indexOf("-- ---------------------------------------------------------------------------\n-- Realtime authorization"));
  assert.match(threadsList, /AND private\.platform_can_read_student_case\(c\.organization_id, c\.id\)/u);
  assert.match(threadsList, /ORDER BY t\.last_message_at DESC NULLS LAST, c\.id DESC/u);
  assert.match(threadsList, /'truncated', \(SELECT count\(\*\) FROM visible\) > 200/u);
});

test("staff_notifications kind CHECK is extended under 188's exact constraint names, additively, with ids-only notification", () => {
  assert.match(migration, /ALTER TABLE platform\.staff_notifications DROP CONSTRAINT staff_notifications_kind_check;/u);
  assert.match(migration, /ALTER TABLE platform\.staff_notifications DROP CONSTRAINT staff_notifications_check;/u);
  assert.match(migration, /ADD CONSTRAINT staff_notifications_kind_check CHECK \(kind IN \(\s*'task_assigned', 'task_updated', 'chat_mention', 'case_help',\s*'case_task_assigned', 'task_due', 'case_message'\s*\)\)/u);
  assert.match(migration, /OR \(kind = 'case_message' AND student_case_id IS NOT NULL AND actor_membership_id IS NOT NULL\s*AND message_id IS NULL AND staff_task_id IS NULL AND help_request_id IS NULL AND case_task_id IS NULL\)/u);

  const trigger = migration.slice(migration.indexOf("CREATE FUNCTION platform_private.notify_case_chat_message"), migration.indexOf("REVOKE ALL ON FUNCTION platform_private.notify_case_chat_message"));
  assert.match(trigger, /IF curator_id IS NULL OR curator_id = NEW\.author_membership_id THEN RETURN NEW; END IF;/u);
  assert.match(trigger, /'case-message:' \|\| NEW\.id::TEXT, 'case_message', NEW\.student_case_id, NEW\.author_membership_id/u);
  // Ids only: no NEW.body reference anywhere in the trigger body.
  assert.doesNotMatch(trigger, /NEW\.body/u);
  assert.match(migration, /CREATE TRIGGER case_chat_message_notifications AFTER INSERT ON platform\.case_chat_messages/u);
});

test("staff_notification_visible is extended for case_message (byte-for-byte reproduction plus one OR branch)", () => {
  const fn = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION platform_private.staff_notification_visible"), migration.indexOf("-- staff_notifications_page_v2 (188): NO CREATE OR REPLACE needed"));
  assert.match(fn, /OR \(n\.kind = 'case_message' AND platform_private\.staff_can_access\(\s*n\.organization_id, a\.membership_id, 'case\.read\.full', 'student_case', n\.student_case_id\)\)/u);
  // The 4 pre-existing branches from 188 must still be present verbatim (no accidental drift).
  assert.match(fn, /n\.staff_task_id IS NOT NULL AND platform_private\.staff_can_access\(\s*n\.organization_id, a\.membership_id, 'staff\.task\.read', 'staff_task', n\.staff_task_id\)/u);
  assert.match(fn, /n\.kind = 'case_help' AND platform_private\.staff_can_access\(\s*n\.organization_id, a\.membership_id, 'case\.read\.full', 'student_case', n\.student_case_id\)/u);
});

test("staff_notifications_page (v1) and staff_notifications_page_v2 are untouched (documented finding, no CREATE OR REPLACE for either)", () => {
  assert.doesNotMatch(migration, /CREATE (?:OR REPLACE )?FUNCTION platform\.staff_notifications_page\(/u);
  assert.doesNotMatch(migration, /CREATE (?:OR REPLACE )?FUNCTION platform\.staff_notifications_page_v2\(/u);
  assert.match(migration, /NO CREATE OR REPLACE needed/u);
  assert.match(migration, /zero degradation, no change made here/u);
});

test("staff_admissions_pipeline_board_v1 is replaced with the same signature, reconstructed from 187's body, adding needs_reply", () => {
  const fn = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION platform.staff_admissions_pipeline_board_v1("), migration.indexOf("-- Admin audit journal allowlist"));
  assert.match(fn, /^CREATE OR REPLACE FUNCTION platform\.staff_admissions_pipeline_board_v1\(\s*p_curator_membership_id UUID DEFAULT NULL, p_direction TEXT DEFAULT NULL,\s*p_country TEXT DEFAULT NULL, p_query TEXT DEFAULT NULL\s*\)/u);
  // 187's own body must survive verbatim: attention flags, primary institution, board filters.
  assert.match(fn, /platform_private\.admissions_attention_flags\(c\.id\) AS flags/u);
  assert.match(fn, /'awaiting_ack', 'awaiting_ack' = ANY \(page\.flags\)/u);
  assert.match(fn, /'overdue', 'overdue' = ANY \(page\.flags\)/u);
  // New column.
  assert.match(fn, /EXISTS \(\s*SELECT 1 FROM platform\.case_chat_threads t\s*WHERE t\.organization_id = c\.organization_id AND t\.student_case_id = c\.id AND t\.await_state = 'needs_reply'\s*\) AS needs_reply/u);
  assert.match(fn, /'needs_reply', page\.needs_reply/u);
  // No REVOKE/GRANT repetition for this same-signature replace.
  const afterFn = migration.slice(migration.indexOf("-- Admin audit journal allowlist"));
  assert.doesNotMatch(afterFn.slice(0, afterFn.indexOf("p7a_safe_audit_actions")), /GRANT EXECUTE ON FUNCTION platform\.staff_admissions_pipeline_board_v1/u);
});

test("the audit action allowlist gains exactly the two new dot-only action names (no underscore, matching the audit_events CHECK)", () => {
  assert.match(migration, /ARRAY\['case\.chat\.post', 'case\.chat\.await'\]::TEXT\[\]/u);
  // The rejected underscore form may appear in an explanatory comment (it
  // does, explaining why); it must never appear as an actual ARRAY element.
  assert.doesNotMatch(migration, /ARRAY\[[^\]]*'case\.chat\.set_await'[^\]]*\]/u);
});

// ---------------------------------------------------------------------------
// TS source pins
// ---------------------------------------------------------------------------

test("the case-chat contract module is client-safe: no supabase import reachable from it (OTH-1's Build-gate mistake, not repeated here)", () => {
  const contract = source("src/lib/platform-case-chat-contract.ts");
  // A comment may discuss "server-only" in prose (it does, explaining why);
  // no actual import statement may reference supabase or server-only.
  assert.doesNotMatch(contract, /^import .*(?:supabase|server-only)/mu);
  assert.doesNotMatch(contract, /from ["'][^"']*supabase[^"']*["']/u);
  assert.match(contract, /export const CASE_CHAT_AWAIT_STATES = \["none", "needs_reply", "awaiting_student"\]/u);
});

test("the server-only source module is marked server-only and never imported by the client contract", () => {
  const readSource = source("src/lib/v3/case-chat-source.ts");
  assert.match(readSource, /^import "server-only";/mu);
});

test("case chat actions echo the caller's request id verbatim (frozen-retry is the composer's job, not the action's)", () => {
  const actions = source("src/lib/platform-case-chat-actions.ts");
  assert.match(actions, /^"use server";/u);
  assert.match(actions, /export async function postCaseChatMessageAction/u);
  assert.match(actions, /export async function setCaseChatAwaitAction/u);
  assert.match(actions, /export async function markCaseChatReadAction/u);
  assert.match(actions, /if \(!data \|\| data\.requestId !== requestId \|\| data\.studentCaseId !== caseId\) return \{ status: "unavailable" \};/u);
});

test("the composer freezes the exact submitted field values (not just the request id) on 'unavailable' and never narrates", () => {
  const component = source("src/components/v3/case-chat/CaseChatThread.tsx");
  assert.match(component, /retryBody\?: string; retryQuotedMessageId\?: string; retryAttachmentKind\?: string; retryAttachmentId\?: string;/u);
  assert.match(component, /value=\{draft\.retryBody \?\? draft\.body\}/u);
  assert.match(component, /else if \(result\.status !== "unavailable"\) \{\s*persist\(\{ \.\.\.draft, requestId: crypto\.randomUUID\(\), retryBody: undefined, retryQuotedMessageId: undefined, retryAttachmentKind: undefined, retryAttachmentId: undefined \}\);/u);
  // Quiet UI: no explanatory narration strings.
  assert.doesNotMatch(component, /Это нужно для|Мы делаем это|Обратите внимание/u);
  // States distinguishable by text, not color alone: every Pill has a text child, and the await Pill always renders caseChatAwaitState(...) alongside its tone.
  assert.match(component, /<Pill tone=\{awaitTone\(state\)\}>\{caseChatAwaitState\(state\)\}<\/Pill>/u);
});

test("the messages route registers in all three route maps and the navigation group", () => {
  assert.match(source("src/lib/fixed-role-policy.ts"), /"\/v3\/messages",/u);
  assert.match(source("src/lib/fixed-role-policy.ts"), /"\/v3\/messages": \["admissions\.read"\]/u);
  assert.match(source("src/lib/platform-route-contract.ts"), /"\/v3\/messages",/u);
  assert.match(source("src/lib/platform-access.ts"), /"\/v3\/messages": \["admissions\.read"\]/u);
  const navigation = source("src/lib/v3/navigation.ts");
  assert.match(navigation, /\{ id: "messages", href: "\/v3\/messages", route: "\/v3\/messages", label: "Сообщения" \}/u);
});

test("«Обсудить» links exist from the case card, task detail panel (case tasks) and the documents panel", () => {
  assert.match(source("src/components/v3/profile/tabs.tsx"), /href=\{`\/v3\/messages\?case=\$\{draft\.admissions\.studentCaseId\}`\}/u);
  const taskPanel = source("src/components/v3/tasks/TaskDetailPanel.tsx");
  assert.match(taskPanel, /href=\{`\/v3\/messages\?case=\$\{data\.caseId\}&attach=case_task:\$\{data\.task\.id\}`\}/u);
  assert.match(taskPanel, />\s*Обсудить\s*</u);
  // Documents panel: header-level link only (not per-slot), a deliberate
  // fallback per the task instructions — v3-profile-documents.test.mjs pins
  // ProfileDocumentsClient.tsx's body with ~170 lines of exact regex on the
  // per-slot checklist rows, too brittle to touch safely for a per-row hook.
  const documents = source("src/components/v3/profile/ProfileDocumentsClient.tsx");
  assert.match(documents, /studentCaseId \? \(\s*<p className="border-b border-border px-4 py-2\.5">\s*<Link href=\{`\/v3\/messages\?case=\$\{studentCaseId\}`\}/u);
});

test("the board decoder tolerates the new needs_reply key (field-picking, no exhaustive key check) — verified, not assumed", () => {
  const decoder = source("src/lib/platform-admissions-pipeline.ts");
  const normalizeRow = decoder.slice(decoder.indexOf("function normalizeRow"), decoder.indexOf("export function normalizeAdmissionsPipelineBoard"));
  // The decoder builds the frozen object by explicit named field access only
  // — it never enumerates or rejects Object.keys(value), so an old client
  // build simply ignores any extra JSON key a newer RPC adds.
  assert.doesNotMatch(normalizeRow, /Object\.keys\(value\)/u);
  assert.match(normalizeRow, /needsReply: value\.needs_reply === true/u);
  const contract = source("src/lib/platform-admissions-pipeline-contract.ts");
  assert.match(contract, /needsReply: boolean;/u);
});

test("the pipeline board renders the needs_reply Pill with text and a link to the messages screen", () => {
  const board = source("src/components/v3/AdmissionsPipelineBoard.tsx");
  assert.match(board, /row\.needsReply \?/u);
  assert.match(board, /href=\{`\/v3\/messages\?case=\$\{row\.studentCaseId\}`\}/u);
  assert.match(board, /<Pill tone="danger">\{caseChatAwaitState\("needs_reply"\)\}<\/Pill>/u);
});

test("the staff notification contract decodes case_message with an ids-only href to the messages screen", () => {
  const contract = source("src/lib/platform-staff-notifications-contract.ts");
  assert.match(contract, /\| "case_message";/u);
  assert.match(contract, /else if \(row\.kind === "case_message"\) \{\s*if \(!isStaffNotificationId\(row\.student_case_id\)\) return fail\(\);\s*href = `\/v3\/messages\?case=\$\{row\.student_case_id\}`;/u);
});

test("wording.ts carries the await-state dictionary used by the composer and the board Pill", () => {
  const wording = source("src/lib/v3/wording.ts");
  assert.match(wording, /const CASE_CHAT_AWAIT_STATE: Record<string, string> = \{\s*none: "Без отметки",\s*needs_reply: "Нужен ответ",\s*awaiting_student: "Ждём студента",\s*\};/u);
  assert.match(wording, /export const caseChatAwaitState = \(v: string \| null \| undefined\) => lookup\(CASE_CHAT_AWAIT_STATE, v\);/u);
});
