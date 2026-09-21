import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyTeamChatFeed, extendTeamChatFeedRange, mergeTeamChatFeedChanges,
  mergeTeamChatFeedPage, mergeTeamChatSearchChanges, teamChatBodyVisible,
  teamChatFeedMessage, teamChatFeedQuote, teamChatFeedRange, teamChatFeedRows,
  teamChatQuoteFromMessage,
} from "../src/lib/team-chat-feed.ts";

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const message = (number, patch = {}) => ({
  id: id(number), channelKey: "general", sequence: String(number), authorMembershipId: id(100),
  authorName: "Участник", body: `Сообщение ${number}`, parentMessageId: null, quoteMessageId: null,
  mentionedMembershipIds: [], version: "1", createdAt: "2026-09-21T05:00:00Z",
  editedAt: null, deletedAt: null, replyCount: 0, ...patch,
});
const page = (messages, patch = {}) => ({
  schemaVersion: 2, messages, quotes: [], beforeCursor: messages[0]?.sequence ?? "0",
  afterCursor: messages.at(-1)?.sequence ?? "0", hasBefore: false, hasAfter: false,
  watermark: "10", latestMessageId: messages.at(-1)?.id ?? null, focusMessageId: null, ...patch,
});
const legacy = (row) => { const copy = { ...row }; delete copy.quoteMessageId; return copy; };

test("a V1 change never invents a direct target and a delayed V2 page keeps newer base fields", () => {
  const root = message(1);
  const direct = message(3, { parentMessageId: root.id, quoteMessageId: id(2) });
  let store = mergeTeamChatFeedPage(emptyTeamChatFeed(), page([root, direct]));
  const changed = mergeTeamChatFeedChanges(store, [
    legacy({ ...direct, version: "2", body: "Изменено" }),
    legacy(message(4, { parentMessageId: root.id, version: "3", body: "Новейший ответ" })),
  ]);
  store = changed.store;
  assert.equal(teamChatFeedMessage(store, direct.id)?.quoteMessageId, id(2));
  assert.equal(teamChatFeedMessage(store, id(4)), null);
  assert.deepEqual(changed.unknownIds, [id(4)]);
  store = mergeTeamChatFeedPage(store, page([message(4, { parentMessageId: root.id, quoteMessageId: direct.id })]));
  assert.equal(teamChatFeedMessage(store, id(4))?.quoteMessageId, direct.id);
  assert.equal(teamChatFeedMessage(store, id(4))?.body, "Новейший ответ");
  assert.equal(teamChatFeedMessage(store, id(4))?.version, "3");
  assert.deepEqual(store.pendingChanges, {});
});

test("an off-page original updates every quote projection and stale pages cannot reveal deleted text", () => {
  const original = message(2);
  const reply = message(3, { parentMessageId: id(1), quoteMessageId: original.id });
  const initial = page([reply], { quotes: [teamChatQuoteFromMessage(original)] });
  let store = mergeTeamChatFeedPage(emptyTeamChatFeed(), initial);
  assert.equal(teamChatFeedMessage(store, original.id), null);
  const edited = legacy({ ...original, version: "2", body: "🙂".repeat(241) });
  store = mergeTeamChatFeedChanges(store, [edited]).store;
  assert.equal(Array.from(teamChatFeedQuote(store, original.id)?.bodyPreview ?? "").length, 240);
  const deleted = { ...edited, version: "3", body: "", deletedAt: "2026-09-21T05:01:00Z" };
  store = mergeTeamChatFeedChanges(store, [deleted]).store;
  store = mergeTeamChatFeedPage(store, initial);
  assert.equal(teamChatFeedQuote(store, original.id)?.bodyPreview, "");
  assert.equal(teamChatFeedQuote(store, original.id)?.version, "3");
  store = mergeTeamChatFeedPage(store, page([original]));
  assert.equal(teamChatFeedMessage(store, original.id)?.body, "");
  assert.equal(teamChatFeedMessage(store, original.id)?.version, "3");
});

test("cached context remains separate from a displayed continuous range", () => {
  const first = page([message(40), message(41)], { hasBefore: true });
  let store = mergeTeamChatFeedPage(emptyTeamChatFeed(), first);
  const range = teamChatFeedRange(first);
  const context = page([message(2), message(3)], { hasBefore: true, hasAfter: true, focusMessageId: id(3) });
  store = mergeTeamChatFeedPage(store, context);
  assert.deepEqual(teamChatFeedRows(store, range).map((row) => row.id), [id(40), id(41)]);
  assert.deepEqual(teamChatFeedRows(store, teamChatFeedRange(context)).map((row) => row.id), [id(2), id(3)]);
  const earlier = page([message(38), message(39)], { hasBefore: true, hasAfter: true });
  assert.equal(extendTeamChatFeedRange(range, earlier, "before", "2"), range);
  const extended = extendTeamChatFeedRange(range, earlier, "before", "40");
  assert.deepEqual(extended.ids, [id(38), id(39), id(40), id(41)]);
  assert.equal(extended.beforeCursor, "38");
  assert.equal(extended.afterCursor, "41");
  assert.equal(extended.hasAfter, false);
  const exhausted = extendTeamChatFeedRange(extended, page([]), "before", "38");
  assert.equal(exhausted.beforeCursor, "38");
  assert.equal(exhausted.hasBefore, false);
});

test("version ordering stays exact beyond the Number safe integer range", () => {
  const newer = message(1, { version: "9007199254740993", body: "Новое" });
  let store = mergeTeamChatFeedPage(emptyTeamChatFeed(), page([newer]));
  const older = { ...newer, version: "9007199254740992", body: "Старое" };
  store = mergeTeamChatFeedPage(store, page([older]));
  store = mergeTeamChatFeedChanges(store, [legacy(older)]).store;
  assert.equal(teamChatFeedMessage(store, newer.id)?.body, "Новое");
  assert.equal(teamChatFeedQuote(store, newer.id)?.bodyPreview, "Новое");
  assert.equal(mergeTeamChatSearchChanges([newer], [legacy(older)])[0].body, "Новое");
});

test("the visibility criterion handles short and taller-than-viewport bodies without a whole-row requirement", () => {
  assert.equal(teamChatBodyVisible(40, 19), false);
  assert.equal(teamChatBodyVisible(40, 20), true);
  assert.equal(teamChatBodyVisible(2000, 159), false);
  assert.equal(teamChatBodyVisible(2000, 160), true);
  assert.equal(teamChatBodyVisible(0, 0), false);
  assert.equal(teamChatBodyVisible(Number.NaN, 200), false);
});
