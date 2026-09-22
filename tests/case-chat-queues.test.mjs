import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  caseChatHref, isCaseChatListQuery, parseCaseChatAttachParam, parseCaseChatQueue,
} from "../src/lib/platform-case-chat-contract.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("queue input distinguishes an absent filter from invalid or repeated values", () => {
  assert.equal(parseCaseChatQueue(undefined), "all");
  for (const queue of ["all", "needs_reply", "awaiting_student"]) assert.equal(parseCaseChatQueue(queue), queue);
  for (const invalid of [null, "", "none", "unread", "NEEDS_REPLY", ["needs_reply"], ["all", "needs_reply"], {}, 1]) {
    assert.equal(parseCaseChatQueue(invalid), null);
  }
});

test("list query validates the actual trimmed Unicode query and rejects non-text input", () => {
  for (const value of [null, "", "  ", "Иван_%\\", "😀".repeat(200), ` ${"a".repeat(200)} `]) {
    assert.equal(isCaseChatListQuery(value), true);
  }
  for (const value of [undefined, {}, ["student"], 12, "😀".repeat(201), "a".repeat(201)]) {
    assert.equal(isCaseChatListQuery(value), false);
  }
});

test("selected-case and return links round-trip a literal search and queue without carrying another case attachment", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const attachment = { kind: "document", id: "10000000-0000-4000-8000-000000000002" };
  const query = "Анна & queue=all #?+%_";
  for (const queue of ["all", "needs_reply", "awaiting_student"]) {
    const current = new URL(caseChatHref(query, queue, id, attachment), "https://example.invalid");
    assert.equal(current.pathname, "/v3/messages");
    assert.equal(current.searchParams.get("q"), query);
    assert.equal(current.searchParams.get("case"), id);
    assert.equal(parseCaseChatQueue(current.searchParams.get("queue") ?? undefined), queue);
    assert.deepEqual(parseCaseChatAttachParam(current.searchParams.get("attach")), attachment);
    const list = new URL(caseChatHref(query, queue, null, attachment), current.origin);
    assert.equal(list.searchParams.get("q"), query);
    assert.equal(list.searchParams.has("case"), false);
    assert.equal(list.searchParams.has("attach"), false);
    const anotherCase = new URL(caseChatHref(query, queue, attachment.id), current.origin);
    assert.equal(anotherCase.searchParams.get("case"), attachment.id);
    assert.equal(anotherCase.searchParams.has("attach"), false);
  }
  assert.equal(caseChatHref("", "all"), "/v3/messages");
  const reset = new URL(caseChatHref("", "needs_reply", id), "https://example.invalid");
  assert.equal(reset.searchParams.has("q"), false);
  assert.equal(reset.searchParams.get("queue"), "needs_reply");
});

// These are source-contract guards, not SQL execution or authorization proof.
test("additive queue RPC filters authorized active cases before limiting and preserves independent unread", () => {
  const sql = source("supabase/migrations/234_platform_case_chat_queues.sql");
  assert.match(sql, /CREATE FUNCTION platform\.staff_case_chat_threads_v2\(/u);
  assert.doesNotMatch(sql, /CREATE OR REPLACE|CREATE TABLE|INSERT INTO|UPDATE platform|DELETE FROM/u);
  assert.match(sql, /STABLE SECURITY DEFINER SET search_path = ''/u);
  assert.match(sql, /actor\.membership_id IS NULL OR actor\.platform_role = 'student'/u);
  assert.match(sql, /p_await_state NOT IN \('needs_reply', 'awaiting_student'\)/u);
  const where = sql.slice(sql.indexOf("WHERE c.organization_id"), sql.indexOf("LIMIT 201"));
  assert.match(where, /c\.organization_id = actor\.organization_id/u);
  assert.match(where, /c\.state = 'active'/u);
  assert.match(where, /private\.platform_can_read_student_case\(c\.organization_id, c\.id\)/u);
  assert.match(where, /p_await_state IS NULL OR t\.await_state = p_await_state/u);
  assert.match(where, /strpos\(lower\(c\.student_display_name\), lower\(btrim\(p_query\)\)\)/u);
  assert.match(sql, /ORDER BY last_message_at DESC NULLS LAST, student_case_id DESC LIMIT 200/u);
  assert.match(sql, /page\.last_message_sequence_id > page\.read_sequence_id/u);
  assert.match(sql, /'truncated', \(SELECT count\(\*\) FROM visible\) > 200/u);
  assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.staff_case_chat_threads_v2\(TEXT, TEXT\)\s+TO authenticated;/u);
});
