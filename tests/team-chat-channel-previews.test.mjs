import assert from "node:assert/strict";
import test from "node:test";
import { acceptTeamChatChannels, decodeTeamChatChannels, teamChatChannelPreviewText } from "../src/lib/team-chat-channel-previews.ts";

// Pure wire/order examples only, not Auth, SQL or live-channel acceptance.
const id = (number) => `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const preview = (patch = {}) => ({ id: id(1), sequence: "1", version: "1", authorMembershipId: id(7),
  authorName: "Участник", bodyPreview: "Привет", deletedAt: null, ...patch });
const channel = (key = "general", patch = {}) => ({ key, muted: false, preferenceVersion: "0", readSequence: "0",
  unreadCount: 0, firstUnreadId: null,
  latestPreview: preview({ id: id(key === "sales" ? 2 : key === "admissions" ? 3 : 1),
    sequence: key === "sales" ? "2" : key === "admissions" ? "3" : "1" }), ...patch });
const state = (channels, requestId = 0) => ({ requestId, channels });

test("decodes permitted known channels, including a confirmed empty channel and sparse unread metadata", () => {
  const rows = [channel(), channel("sales", { latestPreview: preview({ id: id(2), sequence: "2" }),
    unreadCount: 2, firstUnreadId: id(2), readSequence: "1", preferenceVersion: "4" }),
  channel("admissions", { latestPreview: null })];
  assert.deepEqual(decodeTeamChatChannels(rows), rows);
  assert.deepEqual(decodeTeamChatChannels([]), []);
});

test("missing or malformed channel metadata is never interpreted as empty", () => {
  const oldChannel = channel(); delete oldChannel.latestPreview;
  for (const rows of [null, {}, [null], new Array(1), [oldChannel], [channel("general", { latestPreview: undefined })],
    [channel("general", { latestPreview: {} })], [Object.create(channel())], [channel("unknown")],
    [channel(), channel()], [channel(), channel("sales"), channel("admissions"), channel()]]) {
    assert.equal(decodeTeamChatChannels(rows), null);
  }
  for (const patch of [{ muted: 0 }, { preferenceVersion: "-1" }, { readSequence: 1 },
    { unreadCount: "1" }, { unreadCount: -1 }, { unreadCount: 0.5 }, { unreadCount: Number.MAX_SAFE_INTEGER + 1 },
    { firstUnreadId: "invalid" }]) assert.equal(decodeTeamChatChannels([channel("general", patch)]), null);
});

test("preview rejects missing/extra fields and invalid identity, timestamp or BIGINT cursors", () => {
  for (const field of Object.keys(preview())) {
    const incomplete = preview(); delete incomplete[field];
    assert.equal(decodeTeamChatChannels([channel("general", { latestPreview: incomplete })]), null);
  }
  for (const patch of [{ id: "invalid" }, { authorMembershipId: null }, { authorName: null },
    { sequence: "0" }, { sequence: "01" }, { sequence: 1 }, { sequence: "9223372036854775808" },
    { version: "0" }, { version: "-1" }, { version: "9223372036854775808" },
    { deletedAt: "invalid" }, { deletedAt: false }, { bodyPreview: null }, { bodyPreview: "" },
    { body: "not part of this DTO" }, { linkedTaskIds: [id(9)] }]) {
    assert.equal(decodeTeamChatChannels([channel("general", { latestPreview: preview(patch) })]), null);
  }
  const inherited = Object.assign(Object.create(preview()), { unrelated: 1 });
  assert.equal(decodeTeamChatChannels([channel("general", { latestPreview: inherited })]), null);
});

test("one message id or global sequence cannot belong to two channel previews", () => {
  for (const latestPreview of [preview({ id: id(1).toUpperCase(), sequence: "2" }),
    preview({ id: id(2), sequence: "1" })]) {
    assert.equal(decodeTeamChatChannels([channel(), channel("sales", { latestPreview })]), null);
  }
});

test("240 Unicode code points are allowed, 241 are rejected without cutting a surrogate pair", () => {
  const bounded = preview({ bodyPreview: "🙂".repeat(240) });
  assert.deepEqual(decodeTeamChatChannels([channel("general", { latestPreview: bounded })])[0].latestPreview, bounded);
  assert.equal(decodeTeamChatChannels([channel("general", { latestPreview: preview({ bodyPreview: "🙂".repeat(241) }) })]), null);
});

test("a deleted latest row is a tombstone and must not carry deleted text", () => {
  const tombstone = preview({ version: "2", deletedAt: "2026-09-21T12:00:00Z", bodyPreview: "" });
  assert.deepEqual(decodeTeamChatChannels([channel("general", { latestPreview: tombstone })])[0].latestPreview, tombstone);
  assert.equal(decodeTeamChatChannels([channel("general", { latestPreview: { ...tombstone, bodyPreview: "deleted text" } })]), null);
});

test("decoder does not retain mutable aliases or unrecognized channel payload fields", () => {
  const wire = [channel("general", { hiddenPayload: "not exposed" })];
  const decoded = decodeTeamChatChannels(wire);
  wire[0].latestPreview.bodyPreview = "changed after read";
  wire[0].unreadCount = 8;
  assert.deepEqual(decoded, [channel()]);
});

test("a newer accepted metadata ticket prevents a late search from reintroducing an absent channel", () => {
  const initial = state([channel(), channel("sales")]);
  const narrowed = acceptTeamChatChannels(initial, [channel()], 2);
  assert.deepEqual(narrowed.channels.map((row) => row.key), ["general"]);
  assert.strictEqual(acceptTeamChatChannels(narrowed, [channel(), channel("sales")], 1), narrowed);
  assert.strictEqual(acceptTeamChatChannels(narrowed, [channel(), channel("sales")], 2), narrowed);
  const removed = acceptTeamChatChannels(narrowed, [], 3);
  assert.deepEqual(removed.channels, []);
  assert.strictEqual(acceptTeamChatChannels(removed, [channel()], 2), removed);
});

test("sequence and version comparisons retain BIGINT precision beyond Number.MAX_SAFE_INTEGER", () => {
  const old = preview({ sequence: "9007199254740992", version: "9223372036854775806" });
  const newer = preview({ sequence: old.sequence, version: "9223372036854775807", bodyPreview: "Изменено" });
  const accepted = acceptTeamChatChannels(state([channel("general", { latestPreview: old })]),
    [channel("general", { latestPreview: newer })], 1);
  assert.deepEqual(accepted.channels[0].latestPreview, newer);
  const last = preview({ id: id(2), sequence: "9007199254740993", version: "1" });
  assert.deepEqual(acceptTeamChatChannels(accepted, [channel("general", { latestPreview: last })], 2).channels[0].latestPreview, last);
  assert.deepEqual(acceptTeamChatChannels(state([channel("general", { latestPreview: last })]),
    [channel("general", { latestPreview: old })], 1).channels[0].latestPreview, last);
});

test("even a later request carrying an older row/version cannot undo a known tombstone", () => {
  const removed = preview({ sequence: "9", version: "3", deletedAt: "2026-09-21T12:00:00Z", bodyPreview: "" });
  const previous = state([channel("general", { latestPreview: removed })], 1);
  for (const incoming of [preview({ sequence: "9", version: "2" }), preview({ id: id(2), sequence: "8" }), null]) {
    const next = acceptTeamChatChannels(previous, [channel("general", { latestPreview: incoming, unreadCount: 4 })], 2);
    assert.deepEqual(next.channels[0].latestPreview, removed);
    assert.equal(next.channels[0].unreadCount, 4);
  }
});

test("new replies/tombstones remain eligible latest rows regardless of an older row's higher version", () => {
  const previous = state([channel("general", { latestPreview: preview({ version: "99" }) })]);
  const latest = preview({ id: id(2), sequence: "2", version: "2", deletedAt: "2026-09-21T12:00:00Z", bodyPreview: "" });
  assert.deepEqual(acceptTeamChatChannels(previous, [channel("general", { latestPreview: latest })], 1).channels[0].latestPreview, latest);
});

test("same id with another sequence or same sequence with another id rejects the whole update", () => {
  const previous = state([channel()], 1);
  for (const latestPreview of [preview({ sequence: "2" }), preview({ id: id(2) })]) {
    assert.equal(acceptTeamChatChannels(previous, [channel("sales", { latestPreview: null }),
      channel("general", { latestPreview })], 2), null);
    assert.deepEqual(previous, state([channel()], 1));
  }
});

test("UUID letter case is not a new identity; equal version accepts updated author display name", () => {
  const updated = preview({ id: id(1).toUpperCase(), authorName: "Новое имя" });
  const next = acceptTeamChatChannels(state([channel()]), [channel("general", { latestPreview: updated })], 1);
  assert.deepEqual(next.channels[0].latestPreview, updated);
});

test("empty channel can become populated, and absent channels never come from prior cache", () => {
  const previous = state([channel("general", { latestPreview: null }), channel("sales")]);
  const next = acceptTeamChatChannels(previous, [channel()], 1);
  assert.deepEqual(next.channels, [channel()]);
  assert.deepEqual(acceptTeamChatChannels(state([]), [channel("sales", { latestPreview: null })], 1).channels,
    [channel("sales", { latestPreview: null })]);
});

test("invalid metadata request tickets fail without accepting channels", () => {
  for (const requestId of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(acceptTeamChatChannels(state([]), [channel()], requestId), null);
  }
  assert.equal(acceptTeamChatChannels(state([], -1), [channel()], 1), null);
});

test("merge preserves immutable inputs and returns a separate preview projection", () => {
  const beforePreview = Object.freeze(preview());
  const previous = Object.freeze(state(Object.freeze([Object.freeze(channel("general", { latestPreview: beforePreview }))])));
  const incoming = [channel()];
  const next = acceptTeamChatChannels(previous, incoming, 1);
  incoming[0].latestPreview.bodyPreview = "changed after acceptance";
  incoming[0].unreadCount = 9;
  assert.deepEqual(next.channels, [channel()]);
  assert.deepEqual(previous, state([channel()]));
});

test("only a confirmed null preview formats as an empty channel", () => {
  assert.equal(teamChatChannelPreviewText(null, id(7)), "Пока нет сообщений");
  assert.equal(teamChatChannelPreviewText(preview(), id(8)), "Участник: Привет");
});

test("own preview uses the membership identity regardless of UUID letter case", () => {
  const own = preview({ authorMembershipId: id(7).toUpperCase(), authorName: "Другое отображаемое имя" });
  assert.equal(teamChatChannelPreviewText(own, id(7)), "Вы: Привет");
  assert.equal(teamChatChannelPreviewText(own, id(8)), "Другое отображаемое имя: Привет");
});

test("deleted preview never exposes its author or retained text", () => {
  const deleted = preview({ deletedAt: "2026-09-21T12:00:00Z", bodyPreview: "" });
  assert.equal(teamChatChannelPreviewText(deleted, id(7)), "Сообщение удалено");
  // Defensive formatting is not a claim that the strict decoder accepts old bodies.
  assert.equal(teamChatChannelPreviewText({ ...deleted, bodyPreview: "Старый текст" }, id(8)), "Сообщение удалено");
});

test("preview formatting preserves literal Unicode text without parsing markup or changing its meaning", () => {
  const literal = preview({ authorName: "Алия & Тимур", bodyPreview: "<b>Саламатсызбы 👋</b>\nУниверситет — 北京" });
  assert.equal(teamChatChannelPreviewText(literal, id(8)), "Алия & Тимур: <b>Саламатсызбы 👋</b>\nУниверситет — 北京");
});
