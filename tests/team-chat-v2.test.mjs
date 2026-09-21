import assert from "node:assert/strict";
import test from "node:test";
import { teamChatValidPostV2Input, teamChatValidPostV2Request, decodeTeamChatPostV2Receipt } from "../src/lib/platform-team-chat-post-v2.ts";
import { decodeTeamChatTimelineV2Page } from "../src/lib/platform-team-chat-timeline-v2.ts";
import { decodeTeamChatTimelinePage } from "../src/lib/platform-team-chat-timeline.ts";

// Pure wire examples only. Actual SQL/Auth/idempotency require the separate local QA packet.
const uuid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const at = "2026-09-21T00:00:00+00:00";
const latest = { channel: "general", mode: "latest" };
const input = { body: "Ответ", quoteMessageId: null, mentionedMembershipIds: [] };
const request = { channel: "general", requestId: uuid(900), input };
const ack = (patch = {}) => ({
  schemaVersion: 2, requestId: request.requestId, channelKey: "general", operation: "post",
  messageId: uuid(10), version: "1", quoteMessageId: null, rootParentMessageId: null, ...patch,
});
const row = (n, patch = {}) => ({
  id: uuid(n), channelKey: "general", sequence: String(n), authorMembershipId: uuid(999),
  authorName: "Contract author", body: "Message", parentMessageId: null, quoteMessageId: null,
  mentionedMembershipIds: [], version: "1", createdAt: at, editedAt: null, deletedAt: null,
  replyCount: 0, ...patch,
});
const quote = (original) => ({
  id: original.id, sequence: original.sequence, authorMembershipId: original.authorMembershipId,
  authorName: original.authorName, version: original.version, deletedAt: original.deletedAt,
  bodyPreview: Array.from(original.body).slice(0, 240).join(""),
});
const page = (messages = [], patch = {}) => ({
  schemaVersion: 2, messages, quotes: [], beforeCursor: messages[0]?.sequence ?? "0",
  afterCursor: messages.at(-1)?.sequence ?? "0", hasBefore: false, hasAfter: false,
  watermark: "100", latestMessageId: messages.at(-1)?.id ?? null, focusMessageId: null, ...patch,
});
const rejects = (wire, query = latest) => assert.equal(decodeTeamChatTimelineV2Page(wire, query), null);

test("V2 input requires an explicit quote choice and never accepts actor/root/operation injection", () => {
  for (const valid of [input, { ...input, quoteMessageId: uuid(1), mentionedMembershipIds: [uuid(2)] },
    { ...input, body: "🙂".repeat(8000) }, { ...input, body: "Строка\n\tдва" }]) {
    assert.equal(teamChatValidPostV2Input(valid), true);
  }
  for (const bad of [null, [], { body: "text", mentionedMembershipIds: [] }, { ...input, quoteMessageId: undefined },
    { ...input, quoteMessageId: "bad" }, { ...input, body: " \n\t" }, { ...input, body: "🙂".repeat(8001) },
    { ...input, body: "a\u0000b" }, { ...input, body: "a\u007fb" }, { ...input, mentionedMembershipIds: [null] },
    { ...input, mentionedMembershipIds: Array(1) }, { ...input, mentionedMembershipIds: Array(21).fill(uuid(1)) },
    ...["parentMessageId", "rootParentMessageId", "actor", "organizationId", "schemaVersion", "operation"].map((key) => ({ ...input, [key]: uuid(1) }))]) {
    assert.equal(teamChatValidPostV2Input(bad), false);
  }
  assert.equal(teamChatValidPostV2Request(request), true);
  for (const bad of [{ ...request, requestId: null }, { ...request, channel: "student" },
    { ...request, organizationId: uuid(1) }, { ...request, input: { ...input, operation: "post" } }]) {
    assert.equal(teamChatValidPostV2Request(bad), false);
  }
});

test("post acknowledgements must match request, channel and direct target, with an exact V2 envelope", () => {
  assert.deepEqual(decodeTeamChatPostV2Receipt(ack(), request), ack());
  const reply = { ...request, input: { ...input, quoteMessageId: uuid(2) } };
  const result = ack({ quoteMessageId: uuid(2), rootParentMessageId: uuid(1), version: "9007199254740993" });
  assert.deepEqual(decodeTeamChatPostV2Receipt(result, reply), result);
  for (const patch of [{ schemaVersion: 1 }, { schemaVersion: "2" }, { operation: "edit" }, { channelKey: "sales" },
    { requestId: uuid(901) }, { messageId: uuid(2) }, { messageId: uuid(1) }, { version: "0" },
    { version: "9223372036854775808" }, { version: 1 }, { quoteMessageId: uuid(3) },
    { rootParentMessageId: null }, { body: "unexpected" }, { quoteMessageId: undefined }]) {
    assert.equal(decodeTeamChatPostV2Receipt({ ...result, ...patch }, reply), null);
  }
  assert.equal(decodeTeamChatPostV2Receipt(ack({ rootParentMessageId: uuid(1) }), request), null);
  const { schemaVersion: _version, ...v1 } = ack();
  assert.equal(decodeTeamChatPostV2Receipt(v1, request), null);
});

test("direct replies retain the root but require the selected reply projection, not the root projection", () => {
  const root = row(1);
  const reply = row(2, { parentMessageId: root.id, quoteMessageId: root.id });
  const direct = row(3, { parentMessageId: root.id, quoteMessageId: reply.id });
  const wire = page([root, reply, direct], { quotes: [quote(root), quote(reply)] });
  assert.deepEqual(decodeTeamChatTimelineV2Page(wire, latest), wire);
  const offPage = page([direct], { hasBefore: true, quotes: [quote(reply)] });
  assert.deepEqual(decodeTeamChatTimelineV2Page(offPage, latest), offPage);
  rejects({ ...offPage, quotes: [quote(root)] });
  rejects({ ...offPage, quotes: [quote(reply), quote(root)] });
  rejects({ ...offPage, quotes: [] });
  rejects({ ...offPage, quotes: [quote(reply), quote(reply)] });
  rejects(page([root, reply, { ...direct, parentMessageId: reply.id }], { quotes: wire.quotes }));
  rejects(page([{ ...direct, quoteMessageId: direct.id }], { quotes: [quote(direct)] }));
  rejects({ ...offPage, quotes: [{ ...quote(reply), sequence: direct.sequence }] });
});

test("old root fallback remains representable, V2 rejects V1 and mixed pages, and V1 decoder stays compatible", () => {
  const root = row(1), reply = row(2, { parentMessageId: uuid(1), quoteMessageId: uuid(1) });
  const wire = page([root, reply], { quotes: [quote(root)] });
  assert.deepEqual(decodeTeamChatTimelineV2Page(wire, latest), wire);
  const { schemaVersion: _version, ...v1 } = wire;
  v1.messages = wire.messages.map(({ quoteMessageId: _quote, ...message }) => message);
  assert.deepEqual(decodeTeamChatTimelinePage(v1, latest), v1);
  rejects(v1);
  rejects({ ...v1, schemaVersion: 2 });
  rejects({ ...wire, messages: [root, v1.messages[1]] });
  rejects({ ...wire, schemaVersion: "2" });
  rejects({ ...wire, actorId: uuid(10) });
});

test("current original consistency rejects stale edited quotes and prevents tombstone text leakage", () => {
  const original = row(2, { parentMessageId: uuid(1), quoteMessageId: uuid(1), body: "🙂".repeat(241), version: "2", editedAt: at });
  const direct = row(3, { parentMessageId: uuid(1), quoteMessageId: original.id });
  const wire = page([original, direct], { quotes: [quote(row(1)), quote(original)] });
  assert.equal(Array.from(wire.quotes[1].bodyPreview).length, 240);
  assert.deepEqual(decodeTeamChatTimelineV2Page(wire, latest), wire);
  for (const patch of [{ version: "1" }, { bodyPreview: "old" }, { bodyPreview: "🙂".repeat(241) },
    { authorName: "Other" }, { sequence: "1" }]) {
    rejects({ ...wire, quotes: [wire.quotes[0], { ...wire.quotes[1], ...patch }] });
  }
  const tombstone = { ...original, body: "", deletedAt: at, version: "3" };
  const deleted = page([tombstone, direct], { quotes: [quote(row(1)), quote(tombstone)] });
  assert.deepEqual(decodeTeamChatTimelineV2Page(deleted, latest), deleted);
  const outside = page([direct], { quotes: [quote(tombstone)] });
  assert.deepEqual(decodeTeamChatTimelineV2Page(outside, latest), outside);
  rejects({ ...outside, quotes: [{ ...quote(tombstone), bodyPreview: "deleted text" }] });
  rejects({ ...deleted, messages: [{ ...tombstone, mentionedMembershipIds: [uuid(7)] }, direct] });
});

test("timeline preserves exclusive cursors, context limits, ascending int64 and page bounds", () => {
  const messages = Array.from({ length: 50 }, (_, i) => row(100 - i, { sequence: String(9007199254740993n + BigInt(i)) }));
  const wire = page(messages, { hasBefore: true });
  assert.deepEqual(decodeTeamChatTimelineV2Page(wire, latest), wire);
  assert.deepEqual(decodeTeamChatTimelineV2Page(wire, { ...latest, mode: "after", cursor: "9007199254740992" }), wire);
  assert.deepEqual(decodeTeamChatTimelineV2Page(wire, { ...latest, mode: "before", cursor: "9223372036854775807" }), wire);
  rejects(wire, { ...latest, mode: "after", cursor: wire.beforeCursor });
  rejects(wire, { ...latest, mode: "before", cursor: wire.afterCursor });
  const context = { ...latest, mode: "context", messageId: messages[25].id };
  const focused = { ...wire, focusMessageId: context.messageId };
  assert.deepEqual(decodeTeamChatTimelineV2Page(focused, context), focused);
  rejects({ ...wire, focusMessageId: messages[26].id }, { ...context, messageId: messages[26].id });
  rejects({ ...wire, focusMessageId: messages[24].id }, { ...context, messageId: messages[24].id });
  rejects({ ...wire, messages: [...messages].reverse() });
  rejects({ ...wire, messages: [...messages, row(500)] });
  rejects({ ...wire, messages: [messages[0], { ...messages[1], id: messages[0].id }] });
  rejects({ ...wire, messages: [messages[0], { ...messages[1], sequence: messages[0].sequence }] });
  rejects({ ...wire, messages: [{ ...messages[0], sequence: "9223372036854775808" }] });
  rejects({ ...wire, messages: [{ ...messages[0], channelKey: "sales" }] });
  rejects({ ...wire, beforeCursor: "0" });
  rejects({ ...wire, latestMessageId: uuid(700) });
});

test("empty boundaries are explicit and sparse or partially missing payloads fail closed", () => {
  assert.deepEqual(decodeTeamChatTimelineV2Page(page(), latest), page());
  const boundary = page([], { latestMessageId: uuid(1) });
  assert.deepEqual(decodeTeamChatTimelineV2Page(boundary, { ...latest, mode: "before", cursor: "1" }), boundary);
  rejects(boundary);
  for (const wire of [page([], { hasBefore: true }), page([], { hasAfter: true }), page([], { beforeCursor: "1" }),
    page(Array(1)), page([row(1)], { quotes: Array(1) }), page([row(1, { quoteMessageId: undefined })]),
    page([row(1, { parentMessageId: uuid(2) })]), page([row(1, { quoteMessageId: uuid(2) })]),
    page([row(1, { mentionedMembershipIds: Array(1) })]), page([row(1, { actorId: uuid(4) })])]) rejects(wire);
});
