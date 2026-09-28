import assert from "node:assert/strict";
import test from "node:test";
import { teamChatDeletedRunLabel, teamChatFeedItems } from "../src/lib/team-chat-deleted-runs.ts";

// Э8.9 (28.09.2026): подряд удалённые сообщения — одна тихая строка, у
// каждого своя цель ссылки; удалённое с живым ответом остаётся своей строкой.
const id = (sequence) => `message-${sequence}`;
const row = (sequence, overrides = {}) => ({
  id: id(sequence), sequence: String(sequence), parentMessageId: null, quoteMessageId: null,
  replyCount: 0, deletedAt: null, ...overrides,
});
const deleted = (sequence, overrides = {}) => row(sequence, { deletedAt: "2026-09-28T06:40:00Z", ...overrides });
const shape = (items) => items.map((item) => item.kind === "message"
  ? `${item.message.sequence}@${item.index}` : `[${item.messages.map((message) => message.sequence).join(",")}]@${item.index}`);

test("live rows pass through with their position in the visible range", () => {
  assert.deepEqual(teamChatFeedItems([]), []);
  assert.deepEqual(shape(teamChatFeedItems([row(1), row(2), row(3)])), ["1@0", "2@1", "3@2"]);
});

test("each run of consecutive deleted messages becomes one line; a live row ends the run", () => {
  const rows = [row(1), deleted(2), deleted(3), row(4), deleted(5), row(6), deleted(7), deleted(8), deleted(9)];
  assert.deepEqual(shape(teamChatFeedItems(rows)), ["1@0", "[2,3]@1", "4@3", "[5]@4", "6@5", "[7,8,9]@6"]);
});

test("every message keeps exactly one place, in order, so every anchor survives", () => {
  const rows = [deleted(1), row(2), deleted(3), deleted(4, { replyCount: 1 }), row(5, { parentMessageId: id(4), quoteMessageId: id(4) }), deleted(6)];
  const ids = teamChatFeedItems(rows).flatMap((item) => item.kind === "message" ? [item.message.id] : item.messages.map((message) => message.id));
  assert.deepEqual(ids, rows.map((message) => message.id));
});

test("a channel where everything is deleted is one line, not an empty channel (production shape 28.09)", () => {
  const rows = [
    deleted(1, { replyCount: 1 }), deleted(2, { parentMessageId: id(1), quoteMessageId: id(1) }),
    deleted(3), deleted(4), deleted(5), deleted(7),
  ];
  const items = teamChatFeedItems(rows);
  assert.deepEqual(shape(items), ["[1,2,3,4,5,7]@0"]);
  assert.equal(teamChatDeletedRunLabel(items[0].messages.length), "Удалено сообщений: 6");
});

test("a deleted message with a live reply in range keeps its tombstone and splits the run", () => {
  const rows = [deleted(1), deleted(2, { replyCount: 1 }), deleted(3), row(4, { parentMessageId: id(2), quoteMessageId: id(2) })];
  assert.deepEqual(shape(teamChatFeedItems(rows)), ["[1]@0", "2@1", "[3]@2", "4@3"]);
});

test("a live direct quote keeps a deleted reply that has no children of its own", () => {
  const rows = [
    row(1, { replyCount: 2 }), deleted(2, { parentMessageId: id(1), quoteMessageId: id(1) }),
    row(3, { parentMessageId: id(1), quoteMessageId: id(2) }),
  ];
  assert.deepEqual(shape(teamChatFeedItems(rows)), ["1@0", "2@1", "3@2"]);
});

test("replies outside the visible range may be live: the tombstone stays", () => {
  assert.deepEqual(shape(teamChatFeedItems([deleted(1, { replyCount: 1 }), deleted(2)])), ["1@0", "[2]@1"]);
  // Only one of the two replies is a visible deleted reply; the other is unknown.
  const rows = [deleted(1, { replyCount: 2 }), deleted(2, { parentMessageId: id(1), quoteMessageId: id(1) })];
  assert.deepEqual(shape(teamChatFeedItems(rows)), ["1@0", "[2]@1"]);
  // Malformed metadata is never read as «no replies».
  assert.deepEqual(shape(teamChatFeedItems([deleted(1, { replyCount: Number.NaN })])), ["1@0"]);
});

test("identities compare without case and a deleted row never keeps itself alive", () => {
  const rows = [deleted(1, { id: "MESSAGE-1", replyCount: 1 }), row(2, { parentMessageId: "message-1", quoteMessageId: "Message-1" })];
  assert.deepEqual(shape(teamChatFeedItems(rows)), ["1@0", "2@1"]);
  const deletedReply = [deleted(1, { replyCount: 1 }), deleted(2, { parentMessageId: "MESSAGE-1", quoteMessageId: "MESSAGE-1" })];
  assert.deepEqual(shape(teamChatFeedItems(deletedReply)), ["[1,2]@0"]);
});

test("grouping is presentation only and never mutates the rows", () => {
  const rows = Object.freeze([Object.freeze(deleted(1)), Object.freeze(deleted(2)), Object.freeze(row(3))]);
  const before = structuredClone(rows);
  teamChatFeedItems(rows);
  assert.deepEqual(rows, before);
});

test("the line names the count without plural forms", () => {
  assert.equal(teamChatDeletedRunLabel(1), "Сообщение удалено");
  assert.equal(teamChatDeletedRunLabel(2), "Удалено сообщений: 2");
  assert.equal(teamChatDeletedRunLabel(21), "Удалено сообщений: 21");
});
