import assert from "node:assert/strict";
import test from "node:test";
import { teamChatMessageContinuations } from "../src/lib/team-chat-message-grouping.ts";

const row = (sequence, overrides = {}) => ({
  id: `message-${sequence}`, sequence: String(sequence), channelKey: "general",
  authorMembershipId: "member-a", authorName: "Same name",
  createdAt: "2026-09-21T10:00:00.000Z", deletedAt: null, ...overrides,
});
const pair = (previous = {}, current = {}, boundaries) => teamChatMessageContinuations([row(1, previous), row(2, current)], boundaries);

test("only adjacent rows in the supplied visible range can continue a group", () => {
  assert.deepEqual(teamChatMessageContinuations([]), []);
  assert.deepEqual(teamChatMessageContinuations([row(101)]), [false]);
  const rows = [row(101), row(102), row(103)];
  assert.deepEqual(teamChatMessageContinuations(rows), [false, true, true]);
  assert.deepEqual(teamChatMessageContinuations(rows.slice(1)), [false, true]);
});

test("five minutes is inclusive; older or out-of-order timestamps start a group", () => {
  assert.deepEqual(pair({}, { createdAt: "2026-09-21T10:05:00.000Z" }), [false, true]);
  assert.deepEqual(pair({}, { createdAt: "2026-09-21T10:05:00.001Z" }), [false, false]);
  assert.deepEqual(pair({}, { createdAt: "2026-09-21T09:59:59.999Z" }), [false, false]);
});

test("membership and channel boundaries cannot be crossed even for identical display names", () => {
  assert.deepEqual(pair({}, { authorMembershipId: "member-b" }), [false, false]);
  assert.deepEqual(pair({}, { channelKey: "sales" }), [false, false]);
  assert.deepEqual(pair({}, { authorName: "Updated display name" }), [false, true]);
  assert.deepEqual(teamChatMessageContinuations([row(1), row(2, { authorMembershipId: "member-b" }), row(3)]), [false, false, false]);
});

test("calendar day boundaries use Bishkek rather than UTC or the host timezone", () => {
  assert.deepEqual(pair({ createdAt: "2026-09-21T17:59:59Z" }, { createdAt: "2026-09-21T18:00:00Z" }), [false, false]);
  assert.deepEqual(pair({ createdAt: "2026-09-21T23:59:59Z" }, { createdAt: "2026-09-22T00:00:00Z" }), [false, true]);
  assert.deepEqual(pair({ createdAt: "2026-09-21T23:59:59+06:00" }, { createdAt: "2026-09-22T00:00:00+06:00" }), [false, false]);
});

test("either deleted row breaks the sequence", () => {
  assert.deepEqual(pair({ deletedAt: "2026-09-21T10:01:00Z" }), [false, false]);
  assert.deepEqual(pair({}, { deletedAt: "2026-09-21T10:01:00Z" }), [false, false]);
  assert.deepEqual(teamChatMessageContinuations([row(1), row(2, { deletedAt: "2026-09-21T10:01:00Z" }), row(3), row(4)]), [false, false, false, true]);
});

test("invalid timestamps on either side never group", () => {
  for (const createdAt of ["", "not-a-date", "2026-13-21T10:00:00Z"]) {
    assert.deepEqual(pair({ createdAt }), [false, false]);
    assert.deepEqual(pair({}, { createdAt }), [false, false]);
  }
});

test("decimal sequences remain exact beyond Number precision", () => {
  assert.deepEqual(pair({ sequence: "9007199254740992" }, { sequence: "9007199254740993" }), [false, true]);
  assert.deepEqual(pair({ sequence: "9007199254740993" }, { sequence: "9007199254740994" }), [false, true]);
  assert.deepEqual(pair({ sequence: "9007199254740992" }, { sequence: "9007199254740994" }), [false, false]);
});

test("sequence gaps, duplicate, reverse and malformed sequence values start full rows", () => {
  for (const sequence of ["", " ", "-1", "+2", "1.5", "2e0", "0x2", "NaN"]) {
    assert.deepEqual(pair({ sequence }), [false, false]);
    assert.deepEqual(pair({}, { sequence }), [false, false]);
  }
  for (const sequence of ["0", "1", "3"]) assert.deepEqual(pair({}, { sequence }), [false, false]);
});

test("highlighted and first unread rows keep visible authors without inferring read state", () => {
  const rows = [row(1), row(2), row(3), row(4)];
  assert.deepEqual(teamChatMessageContinuations(rows, { highlightedId: "message-2" }), [false, false, true, true]);
  assert.deepEqual(teamChatMessageContinuations(rows, { firstUnreadId: "message-2" }), [false, false, true, true]);
  assert.deepEqual(teamChatMessageContinuations(rows, { highlightedId: "message-2", firstUnreadId: "message-3" }), [false, false, false, true]);
  for (const firstUnreadId of [null, undefined, "outside-range"]) {
    assert.deepEqual(teamChatMessageContinuations(rows, { firstUnreadId }), [false, true, true, true]);
  }
});

test("quote metadata does not merge threads and grouping never mutates messages", () => {
  const rows = Object.freeze([Object.freeze(row(1)), Object.freeze(row(2, { quoteMessageId: "older-message", body: "Own body" }))]);
  const before = structuredClone(rows);
  assert.deepEqual(teamChatMessageContinuations(rows, Object.freeze({ firstUnreadId: null })), [false, true]);
  assert.deepEqual(rows, before);
});
