import assert from "node:assert/strict";
import test from "node:test";
import { decodeTeamChatTimelinePage, teamChatTimelineValidQuery } from "../src/lib/platform-team-chat-timeline.ts";

// Pure wire-contract fixtures, not database or real Auth acceptance evidence.
const uuid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const at = "2026-09-21T00:00:00+00:00";
const latest = { channel: "general", mode: "latest" };
const row = (n, patch = {}) => ({
  id: uuid(n), channelKey: "general", sequence: String(n), authorMembershipId: uuid(999),
  authorName: "QA contract author", body: "Message", parentMessageId: null,
  mentionedMembershipIds: [], version: "1", createdAt: at, editedAt: null, deletedAt: null, replyCount: 0,
  ...patch,
});
const quote = (original) => ({
  id: original.id, sequence: original.sequence, authorMembershipId: original.authorMembershipId,
  authorName: original.authorName, version: original.version, deletedAt: original.deletedAt,
  bodyPreview: Array.from(original.body).slice(0, 240).join(""),
});
const page = (messages = [], patch = {}) => ({
  messages, quotes: [], beforeCursor: messages[0]?.sequence ?? "0", afterCursor: messages.at(-1)?.sequence ?? "0",
  hasBefore: false, hasAfter: false, watermark: "1000", latestMessageId: messages.at(-1)?.id ?? null,
  focusMessageId: null, ...patch,
});
const rejects = (value, query = latest) => assert.equal(decodeTeamChatTimelinePage(value, query), null);

test("queries distinguish message sequence cursors from context anchors and reject extra scope inputs", () => {
  for (const query of [latest, { ...latest, cursor: "0", messageId: null },
    { channel: "sales", mode: "before", cursor: "9223372036854775807" },
    { channel: "admissions", mode: "after", cursor: "1" },
    { channel: "general", mode: "context", messageId: uuid(1) }]) {
    assert.equal(teamChatTimelineValidQuery(query), true);
  }
  for (const query of [null, [], { ...latest, channel: null }, { ...latest, channel: "student" },
    { ...latest, mode: "thread" }, { ...latest, mode: "changes" }, { ...latest, cursor: "1" },
    { ...latest, cursor: null }, { ...latest, messageId: uuid(1) }, { ...latest, organizationId: uuid(2) },
    { ...latest, mode: "context" }, { ...latest, mode: "context", messageId: uuid(1), cursor: "1" },
    ...[undefined, null, "0", "-1", "01", "1e3", "9223372036854775808", 1].map((cursor) => ({ ...latest, mode: "before", cursor })),
    { ...latest, mode: "after", cursor: "1", messageId: uuid(1) }]) {
    assert.equal(teamChatTimelineValidQuery(query), false, JSON.stringify(query));
  }
});

test("empty boundary pages do not pretend the whole channel is empty", () => {
  assert.deepEqual(decodeTeamChatTimelinePage(page(), latest), page());
  const boundary = page([], { latestMessageId: uuid(10) });
  assert.deepEqual(decodeTeamChatTimelinePage(boundary, { ...latest, mode: "before", cursor: "1" }), boundary);
  rejects(boundary);
  rejects(page([], { hasBefore: true }));
  rejects(page([], { hasAfter: true }));
  rejects(page([], { beforeCursor: "1" }));
  rejects(page([], { focusMessageId: uuid(1) }), { ...latest, mode: "context", messageId: uuid(1) });
});

test("50 messages keep sequence precision and accept UUIDs in any lexical order", () => {
  const messages = Array.from({ length: 50 }, (_, i) => row(100 - i, { sequence: String(9007199254740993n + BigInt(i) * 3n) }));
  const wire = page(messages, { hasBefore: true, watermark: "7" });
  assert.deepEqual(decodeTeamChatTimelinePage(wire, latest), wire);
  rejects(page([...messages, row(300, { sequence: "9007199254741200" })]));
  rejects(page([messages[1], messages[0]]));
  rejects(page([messages[0], { ...messages[1], sequence: messages[0].sequence }]));
  rejects(page([messages[0], { ...messages[1], id: messages[0].id.toUpperCase() }]));
});

test("mixed roots and replies require exactly their safe parent projections, including off-page parents", () => {
  const oldParent = row(1, { body: "Older parent" });
  const root = row(50, { body: "Current root", replyCount: 1 });
  const reply = row(51, { parentMessageId: oldParent.id });
  const nextReply = row(52, { parentMessageId: root.id });
  const wire = page([root, reply, nextReply], { hasBefore: true, quotes: [quote(oldParent), quote(root)] });
  assert.deepEqual(decodeTeamChatTimelinePage(wire, latest), wire);
  rejects({ ...wire, quotes: [quote(root)] });
  rejects({ ...wire, quotes: [...wire.quotes, quote(row(2))] });
  rejects({ ...wire, quotes: [...wire.quotes, quote(root)] });
  rejects({ ...wire, quotes: [quote(oldParent), { ...quote(root), version: "2" }] });
  rejects({ ...wire, quotes: [quote(oldParent), { ...quote(root), bodyPreview: "Stale content" }] });
});

test("deleted originals and quoted tombstones never retain body or mentions", () => {
  const original = row(1, { body: "", deletedAt: at, version: "2" });
  const reply = row(2, { parentMessageId: original.id });
  const wire = page([original, reply], { quotes: [quote(original)] });
  assert.deepEqual(decodeTeamChatTimelinePage(wire, latest), wire);
  rejects({ ...wire, quotes: [{ ...quote(original), bodyPreview: "Deleted secret" }] });
  rejects(page([{ ...original, body: "Deleted secret" }]));
  rejects(page([{ ...original, mentionedMembershipIds: [uuid(3)] }]));
  rejects(page([row(1, { body: "" })]));
});

test("quote bounds count Unicode characters and agree with a same-page original", () => {
  const original = row(1, { body: "😀".repeat(300), replyCount: 1 });
  const reply = row(2, { parentMessageId: original.id });
  const wire = page([original, reply], { quotes: [quote(original)] });
  assert.deepEqual(decodeTeamChatTimelinePage(wire, latest), wire);
  rejects({ ...wire, quotes: [{ ...quote(original), bodyPreview: "😀".repeat(241) }] });
  rejects({ ...wire, quotes: [{ ...quote(original), bodyPreview: "😀".repeat(239) }] });
  rejects(page([row(1, { body: "😀".repeat(8001) })]));
});

test("before and after enforce exclusive sequence boundaries and matching cursors", () => {
  const before = page([row(8), row(9)], { hasBefore: true, hasAfter: true, latestMessageId: uuid(20) });
  assert.deepEqual(decodeTeamChatTimelinePage(before, { ...latest, mode: "before", cursor: "10" }), before);
  rejects(before, { ...latest, mode: "before", cursor: "9" });
  rejects({ ...before, beforeCursor: "7" }, { ...latest, mode: "before", cursor: "10" });
  const after = page([row(11), row(20)], { hasBefore: true });
  assert.deepEqual(decodeTeamChatTimelinePage(after, { ...latest, mode: "after", cursor: "10" }), after);
  rejects(after, { ...latest, mode: "after", cursor: "11" });
  rejects({ ...after, afterCursor: "21" }, { ...latest, mode: "after", cursor: "10" });
});

test("context contains its anchor with at most25 older and24 newer messages", () => {
  const messages = Array.from({ length: 50 }, (_, i) => row(i + 1));
  const query = { ...latest, mode: "context", messageId: uuid(26).toUpperCase() };
  const wire = page(messages, { focusMessageId: uuid(26), hasBefore: true, hasAfter: true, latestMessageId: uuid(80) });
  assert.deepEqual(decodeTeamChatTimelinePage(wire, query), wire);
  rejects({ ...wire, focusMessageId: uuid(25) }, query);
  rejects(wire, { ...query, messageId: uuid(90) });
  rejects({ ...wire, focusMessageId: uuid(25) }, { ...query, messageId: uuid(25) });
  rejects({ ...wire, focusMessageId: uuid(27) }, { ...query, messageId: uuid(27) });
  const edge = page([row(1), row(2)], { focusMessageId: uuid(1) });
  assert.deepEqual(decodeTeamChatTimelinePage(edge, { ...query, messageId: uuid(1) }), edge);
  rejects(wire, latest);
});

test("malformed or cross-channel responses fail closed instead of being partially displayed", () => {
  const valid = page([row(1)]);
  for (const patch of [
    { channelKey: "sales" }, { id: "bad" }, { parentMessageId: uuid(1) }, { sequence: "0" },
    { sequence: "01" }, { sequence: 1 }, { version: "0" }, { createdAt: "not-a-date" },
    { editedAt: false }, { deletedAt: false }, { authorMembershipId: null },
    { mentionedMembershipIds: ["bad"] }, { replyCount: -1 },
  ]) rejects(page([row(1, patch)]));
  for (const patch of [
    { messages: null }, { quotes: null }, { watermark: "-1" }, { watermark: 0 },
    { latestMessageId: null }, { latestMessageId: uuid(2) }, { hasAfter: true },
    { hasBefore: "false" }, { focusMessageId: uuid(1) },
  ]) rejects({ ...valid, ...patch });
});
