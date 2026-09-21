import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyTeamChatReadErrors, reduceTeamChatReadErrors, teamChatReadFailureCopy, visibleTeamChatReadFailure,
} from "../src/lib/team-chat-read-errors.ts";

const search = { kind: "search", channel: "general", term: "прежний запрос", cursor: "41", append: true };
const refresh = { kind: "refresh", channel: "general", cursor: "120" };
const begin = (state, owner, id, attempt) => reduceTeamChatReadErrors(state, { type: "begin", owner, id, attempt });
const settle = (state, owner, id, failure) => reduceTeamChatReadErrors(state, { type: "settle", owner, id, failure });

test("failed search retains the exact original term, pagination cursor and append intent", () => {
  const submitted = { ...search };
  let state = begin(emptyTeamChatReadErrors(), "foreground", 1, submitted);
  submitted.term = "новый несохранённый ввод";
  submitted.cursor = "99";
  submitted.append = false;
  state = settle(state, "foreground", 1, "unavailable");
  assert.deepEqual(visibleTeamChatReadFailure(state), { owner: "foreground", ticket: { id: 1, attempt: search, failure: "unavailable", pending: false } });
  assert.equal(teamChatReadFailureCopy(state.foreground).retryLabel, "Повторить поиск");
});

test("timeline retry captures context and return intent without retaining caller-owned mutable input", () => {
  const input = { channel: "admissions", mode: "context", messageId: "10000000-0000-4000-8000-000000000001" };
  const original = { ...input };
  const state = begin(emptyTeamChatReadErrors(), "foreground", 1, { kind: "navigate", input, returnPoint: true });
  input.messageId = "10000000-0000-4000-8000-000000000002";
  assert.deepEqual(state.foreground.attempt, { kind: "navigate", input: original, returnPoint: true });
  for (const mode of ["before", "after"]) {
    const page = { channel: "sales", mode, cursor: "17" };
    const next = begin(state, "foreground", 2, { kind: "extend", input: page });
    page.cursor = "500";
    assert.equal(next.foreground.attempt.input.mode, mode);
    assert.equal(next.foreground.attempt.input.cursor, "17");
  }
});

test("successful background refresh cannot erase an unretried search failure", () => {
  let state = begin(emptyTeamChatReadErrors(), "foreground", 4, search);
  state = settle(state, "foreground", 4, "unavailable");
  const failedSearch = state.foreground;
  state = begin(state, "background", 2, refresh);
  state = settle(state, "background", 2, null);
  assert.equal(state.foreground, failedSearch);
  assert.equal(visibleTeamChatReadFailure(state).owner, "foreground");
  assert.equal(state.background, null);
});

test("foreground success clears only its own issue and reveals any unresolved background failure", () => {
  let state = begin(emptyTeamChatReadErrors(), "background", 2, refresh);
  state = settle(state, "background", 2, "unavailable");
  const background = state.background;
  state = begin(state, "foreground", 4, search);
  state = settle(state, "foreground", 4, "unavailable");
  assert.equal(visibleTeamChatReadFailure(state).owner, "foreground");
  state = begin(state, "foreground", 5, search);
  state = settle(state, "foreground", 5, null);
  assert.equal(state.background, background);
  assert.equal(visibleTeamChatReadFailure(state).owner, "background");
  assert.equal(state.background.attempt.cursor, "120");
});

test("periodic background retry keeps its failure visible until success is confirmed", () => {
  let state = begin(emptyTeamChatReadErrors(), "background", 1, refresh);
  state = settle(state, "background", 1, "unavailable");
  state = begin(state, "background", 2, refresh);
  assert.equal(visibleTeamChatReadFailure(state).ticket.failure, "unavailable");
  assert.equal(state.background.pending, true);
  assert.equal(settle(state, "background", 1, null), state);
  state = settle(state, "background", 2, null);
  assert.equal(visibleTeamChatReadFailure(state), null);
});

test("a delayed old failure or success cannot replace the new foreground attempt", () => {
  let state = begin(emptyTeamChatReadErrors(), "foreground", 1, search);
  state = begin(state, "foreground", 2, { ...search, term: "новый запрос", append: false, cursor: undefined });
  assert.equal(settle(state, "foreground", 1, "unavailable"), state);
  state = settle(state, "foreground", 2, "conflict");
  assert.equal(settle(state, "foreground", 1, null), state);
  assert.equal(state.foreground.attempt.term, "новый запрос");
  assert.equal(state.foreground.failure, "conflict");
});

test("closing or leaving the foreground context cancels its retry, preserving background ownership", () => {
  let state = begin(emptyTeamChatReadErrors(), "foreground", 8, search);
  state = settle(state, "foreground", 8, "unavailable");
  state = begin(state, "background", 3, refresh);
  state = settle(state, "background", 3, "unavailable");
  const background = state.background;
  state = reduceTeamChatReadErrors(state, { type: "cancel", owner: "foreground" });
  assert.equal(state.foreground, null);
  assert.equal(state.background, background);
  assert.equal(settle(state, "foreground", 8, "unavailable"), state);
});

test("late forbidden revokes both lanes even after the failed context was cancelled", () => {
  let state = begin(emptyTeamChatReadErrors(), "foreground", 1, search);
  state = reduceTeamChatReadErrors(state, { type: "cancel", owner: "foreground" });
  state = begin(state, "foreground", 2, { ...search, term: "другой запрос" });
  state = begin(state, "background", 3, refresh);
  state = settle(state, "foreground", 1, "forbidden");
  assert.deepEqual(state, { forbidden: true, foreground: null, background: null });
  assert.equal(visibleTeamChatReadFailure(state), null);
  assert.equal(settle(state, "background", 3, null), state);
  assert.equal(begin(state, "foreground", 4, search), state);
});

test("missing, invalid and denied reads do not offer an endless retry; edit recovery keeps its own handshake", () => {
  for (const failure of ["invalid", "not_found", "forbidden"]) {
    assert.equal(teamChatReadFailureCopy({ id: 1, attempt: search, failure }).retryLabel, null);
  }
  const resume = { kind: "resume-edit", channel: "general", messageId: "10000000-0000-4000-8000-000000000001" };
  assert.equal(teamChatReadFailureCopy({ id: 1, attempt: resume, failure: "unavailable" }).retryLabel, null);
  assert.equal(teamChatReadFailureCopy({ id: 1, attempt: refresh, failure: "unavailable" }).retryLabel, "Повторить обновление");
});
