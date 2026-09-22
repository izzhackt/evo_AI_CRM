import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { acceptTeamChatChannels, decodeTeamChatChannels } from "../src/lib/team-chat-channel-previews.ts";
import { normalizeTeamChatPreviewCreatedAt } from "../src/lib/team-chat-channel-preview-time.ts";

// Pure wire/merge examples only: no SQL, Auth, browser, migration or runtime acceptance.
const id = (number) => `b0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const createdAt = "2026-09-21T23:59:59.123456Z";
const nextMicrosecond = "2026-09-21T23:59:59.123457Z";
const preview = (patch = {}) => ({
  id: id(1), sequence: "10", version: "3", authorMembershipId: id(7),
  authorName: "Участник", bodyPreview: "Привет", deletedAt: null, ...patch,
});
const channel = (patch = {}) => ({
  key: "general", muted: false, preferenceVersion: "0", readSequence: "0",
  unreadCount: 0, firstUnreadId: null, latestPreview: preview(), ...patch,
});
const decode = (rows) => {
  const result = decodeTeamChatChannels(rows);
  assert.notEqual(result, null, "test input must pass the real strict decoder");
  return result;
};
const state = (rows, requestId = 1) => ({ requestId, channels: decode(rows) });
const accept = (before, rows, requestId = before.requestId + 1) => {
  const result = acceptTeamChatChannels(before, decode(rows), requestId);
  assert.notEqual(result, null, "expected an accepted decoded snapshot");
  return result;
};

async function legacyDecoder() {
  // Verbatim source from d1568d5840cee85e62947a616bb00f0d2a2ac505, unchanged since 237.
  const source = await readFile(new URL("./fixtures/team-chat-channel-previews-237.ts.txt", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "b4a3ba82230819f348755575e05aac65a915c9f28c08f7dc05766d2ecb2764f9");
  const specifier = '"./platform-team-chat.ts"';
  assert.equal(source.split(specifier).length, 2, "rewrite only the legacy module's one relative import");
  const resolvable = source.replace(specifier,
    JSON.stringify(new URL("../src/lib/platform-team-chat.ts", import.meta.url).href));
  const javascript = stripTypeScriptTypes(resolvable);
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

test("explicit offsets and fractional spellings normalize to the same UTC microsecond", () => {
  for (const input of [createdAt, "2026-09-22T05:59:59.123456+06:00", "2026-09-21T18:29:59.123456-05:30"]) {
    assert.equal(normalizeTeamChatPreviewCreatedAt(input), createdAt, input);
  }
  for (const input of ["2026-09-21T23:59:59Z", "2026-09-21T23:59:59.0+00:00", "2026-09-21T23:59:59.000000-00:00"]) {
    assert.equal(normalizeTeamChatPreviewCreatedAt(input), "2026-09-21T23:59:59.000000Z", input);
  }
  for (const fraction of ["1", "10", "100", "1000", "10000", "100000"]) {
    assert.equal(normalizeTeamChatPreviewCreatedAt(`2026-09-21T23:59:59.${fraction}Z`), "2026-09-21T23:59:59.100000Z");
  }
});

test("normalization preserves all six fractional digits and civil date boundaries", () => {
  const cases = [
    ["2026-09-21T23:59:59.000001Z", "2026-09-21T23:59:59.000001Z"],
    ["2026-09-21T23:59:59.999999Z", "2026-09-21T23:59:59.999999Z"],
    ["2026-01-01T00:00:00.000001+00:01", "2025-12-31T23:59:00.000001Z"],
    ["2026-12-31T23:59:59.999999-00:01", "2027-01-01T00:00:59.999999Z"],
    ["2000-03-01T00:00:00+00:01", "2000-02-29T23:59:00.000000Z"],
    ["2400-02-29T12:00:00Z", "2400-02-29T12:00:00.000000Z"],
    ["0099-01-01T00:00:00Z", "0099-01-01T00:00:00.000000Z"],
    ["0001-01-01T00:00:00Z", "0001-01-01T00:00:00.000000Z"],
    ["9999-12-31T23:59:59.999999Z", "9999-12-31T23:59:59.999999Z"],
    ["2026-01-02T00:00:00+23:59", "2026-01-01T00:01:00.000000Z"],
    ["2026-01-01T00:00:00-23:59", "2026-01-01T23:59:00.000000Z"],
  ];
  for (const [input, expected] of cases) assert.equal(normalizeTeamChatPreviewCreatedAt(input), expected, input);
  assert.notEqual(normalizeTeamChatPreviewCreatedAt(createdAt), normalizeTeamChatPreviewCreatedAt(nextMicrosecond));
});

test("timestamp validation rejects coercion, absent zones, impossible dates and excess precision", () => {
  const invalid = [
    null, undefined, 0, true, {}, [], new Date("2026-09-21T23:59:59Z"),
    "", "2026-09-21", "2026-09-21T23:59:59", "2026-09-21T23:59Z",
    "2026-09-21 23:59:59Z", "2026-09-21t23:59:59z", " 2026-09-21T23:59:59Z",
    "2026-09-21T23:59:59Z\n", "2026-09-21T23:59:59.Z", "2026-09-21T23:59:59.1234567Z",
    "2026-09-21T23:59:59+0600", "2026-09-21T23:59:59+6:00", "2026-09-21T23:59:59+24:00",
    "2026-09-21T23:59:59-24:00", "2026-09-21T23:59:59+00:60", "2026-09-21T23:59:59-00:60",
    "2026-09-21T24:00:00Z", "2026-09-21T23:60:00Z", "2026-09-21T23:59:60Z",
    "2026-00-21T23:59:59Z", "2026-13-21T23:59:59Z", "2026-09-00T23:59:59Z",
    "2026-04-31T23:59:59Z", "2026-02-29T23:59:59Z", "1900-02-29T23:59:59Z",
    "0000-01-01T00:00:00Z", "-0001-01-01T00:00:00Z", "+2026-01-01T00:00:00Z",
    "10000-01-01T00:00:00Z", "0001-01-01T00:00:00+00:01", "9999-12-31T23:59:59-00:01",
  ];
  for (const input of invalid) assert.equal(normalizeTeamChatPreviewCreatedAt(input), null, String(input));
});

test("legacy wire remains identical for both old and new decoders, including absent time", async () => {
  const legacy = await legacyDecoder();
  const wire = [channel(), channel({ key: "sales", latestPreview: null }), channel({
    key: "admissions", latestPreview: preview({ id: id(3), sequence: "12", bodyPreview: "", deletedAt: "2026-09-22T00:00:00Z" }),
  })];
  const decoded = decode(wire);
  assert.deepEqual(decoded, legacy.decodeTeamChatChannels(wire));
  assert.deepEqual(decoded, wire);
  for (const row of decoded) assert.equal(Object.hasOwn(row, "latestPreviewCreatedAt"), false);
});

test("old decoder accepts the new outer timestamp without changing its seven-field preview", async () => {
  const legacy = await legacyDecoder();
  const legacyWire = [channel(), channel({ key: "sales", latestPreview: null }), channel({
    key: "admissions", latestPreview: preview({ id: id(3), sequence: "12", bodyPreview: "", deletedAt: "2026-09-22T00:00:00Z" }),
  })];
  const wire = legacyWire.map((row) => ({ ...row, latestPreviewCreatedAt: row.latestPreview === null ? null : createdAt }));
  assert.deepEqual(legacy.decodeTeamChatChannels(wire), legacyWire);
  assert.deepEqual(decode(wire), wire);
  for (const row of wire.filter((item) => item.latestPreview !== null)) {
    assert.equal(Object.keys(row.latestPreview).length, 7);
    const nested = channel({ latestPreview: { ...row.latestPreview, createdAt } });
    assert.equal(legacy.decodeTeamChatChannels([nested]), null);
    assert.equal(decodeTeamChatChannels([nested]), null);
  }
});

test("new decoder canonicalizes time, projects extras away and preserves timestamp ownership", () => {
  const wire = [channel({ latestPreviewCreatedAt: "2026-09-22T05:59:59.123456+06:00", ignoredExtra: "discard" })];
  const decoded = decode(wire);
  assert.deepEqual(decoded, [channel({ latestPreviewCreatedAt: createdAt })]);
  wire[0].latestPreviewCreatedAt = nextMicrosecond;
  wire[0].latestPreview.bodyPreview = "Changed after decoding";
  assert.deepEqual(decoded, [channel({ latestPreviewCreatedAt: createdAt })]);
});

test("new decoder distinguishes an absent legacy field from present invalid or mismatched time", () => {
  for (const value of [undefined, null, false, 0, {}, "", "2026-09-21T23:59:59", "2026-02-29T12:00:00Z", "2026-09-21T23:59:59.1234567Z"]) {
    assert.equal(decodeTeamChatChannels([channel({ latestPreviewCreatedAt: value })]), null, String(value));
  }
  for (const value of [undefined, createdAt, "invalid"]) {
    assert.equal(decodeTeamChatChannels([channel({ latestPreview: null, latestPreviewCreatedAt: value })]), null, String(value));
  }
  assert.deepEqual(decode([channel({ latestPreview: null, latestPreviewCreatedAt: null })]),
    [channel({ latestPreview: null, latestPreviewCreatedAt: null })]);
  assert.equal(Object.hasOwn(decode([channel()])[0], "latestPreviewCreatedAt"), false);
});

test("deleted previews carry their original creation instant independently of deletion time", () => {
  const tombstone = channel({ latestPreviewCreatedAt: createdAt, latestPreview: preview({
    version: "4", bodyPreview: "", deletedAt: "2026-09-22T09:30:00Z",
  }) });
  assert.deepEqual(decode([tombstone]), [tombstone]);
  assert.equal(decodeTeamChatChannels([{ ...tombstone, latestPreviewCreatedAt: null }]), null);
});

test("a newer preview version retains a known creation instant when a legacy reader omits it", () => {
  const before = state([channel({ latestPreviewCreatedAt: createdAt })]);
  const incoming = channel({ latestPreview: preview({ version: "4", bodyPreview: "Edited" }), unreadCount: 3 });
  const result = accept(before, [incoming]);
  assert.deepEqual(result.channels, [{ ...incoming, latestPreviewCreatedAt: createdAt }]);
  assert.equal(result.requestId, 2);
});

test("older versions retain the preview and timestamp while accepting independent channel metadata", () => {
  const before = state([channel({ latestPreviewCreatedAt: createdAt })]);
  for (const timePatch of [{}, { latestPreviewCreatedAt: createdAt }]) {
    const result = accept(before, [channel({ ...timePatch, latestPreview: preview({ version: "2", bodyPreview: "Older" }),
      muted: true, preferenceVersion: "1", readSequence: "9", unreadCount: 2, firstUnreadId: id(1) })]);
    assert.deepEqual(result.channels[0], channel({ latestPreviewCreatedAt: createdAt,
      muted: true, preferenceVersion: "1", readSequence: "9", unreadCount: 2, firstUnreadId: id(1) }));
  }
});

test("unknown creation time is filled for the same message even when its incoming edit version is older", () => {
  const before = state([channel()]);
  for (const version of ["2", "3", "4"]) {
    const incoming = channel({ latestPreviewCreatedAt: createdAt, latestPreview: preview({ version, bodyPreview: "Incoming" }) });
    const result = accept(before, [incoming]);
    assert.equal(result.channels[0].latestPreviewCreatedAt, createdAt);
    assert.deepEqual(result.channels[0].latestPreview, version === "2" ? before.channels[0].latestPreview : incoming.latestPreview);
  }
});

test("same-message conflicting instants reject the whole snapshot regardless of edit version", () => {
  const before = state([channel({ latestPreviewCreatedAt: createdAt })], 7);
  const unchanged = structuredClone(before);
  for (const version of ["2", "3", "4"]) {
    const rows = decode([channel({ latestPreviewCreatedAt: nextMicrosecond,
      latestPreview: preview({ id: id(1).toUpperCase(), version }) })]);
    assert.equal(acceptTeamChatChannels(before, rows, 8), null, `version ${version}`);
    assert.deepEqual(before, unchanged, "rejected snapshot cannot advance the request watermark");
  }
});

test("same-message offset and fractional equivalents do not create a timestamp conflict", () => {
  const before = state([channel({ latestPreviewCreatedAt: "2026-09-21T23:59:59.1Z" })]);
  const result = accept(before, [channel({ latestPreviewCreatedAt: "2026-09-22T05:59:59.100000+06:00",
    latestPreview: preview({ id: id(1).toUpperCase(), version: "4" }) })]);
  assert.equal(result.channels[0].latestPreviewCreatedAt, "2026-09-21T23:59:59.100000Z");
  assert.equal(result.channels[0].latestPreview.version, "4");
});

test("a lower-sequence different message never donates its time to the retained preview", () => {
  for (const beforeTime of [{}, { latestPreviewCreatedAt: createdAt }]) {
    const before = state([channel(beforeTime)]);
    for (const incomingTime of [{}, { latestPreviewCreatedAt: nextMicrosecond }]) {
      const result = accept(before, [channel({ ...incomingTime, latestPreview: preview({ id: id(2), sequence: "9", version: "99" }) })]);
      assert.deepEqual(result.channels, before.channels);
    }
  }
});

test("a transient empty snapshot retains the prior message and its known-or-unknown time as a pair", () => {
  for (const beforeTime of [{}, { latestPreviewCreatedAt: createdAt }]) {
    const before = state([channel(beforeTime)]);
    for (const incomingTime of [{}, { latestPreviewCreatedAt: null }]) {
      const result = accept(before, [channel({ ...incomingTime, latestPreview: null })]);
      assert.deepEqual(result.channels, before.channels);
    }
  }
});

test("a newer message with unknown time cannot inherit the previous message's timestamp", () => {
  const before = state([channel({ latestPreviewCreatedAt: createdAt })]);
  const incoming = channel({ latestPreview: preview({ id: id(2), sequence: "11", version: "1" }) });
  const result = accept(before, [incoming]);
  assert.deepEqual(result.channels, [incoming]);
  assert.equal(Object.hasOwn(result.channels[0], "latestPreviewCreatedAt"), false);
});

test("a newer message adopts only its own time and does not reorder by the clock", () => {
  const before = state([channel({ latestPreviewCreatedAt: createdAt })]);
  const incoming = channel({ latestPreviewCreatedAt: "2025-01-01T00:00:00.000001Z",
    latestPreview: preview({ id: id(2), sequence: "11", version: "1" }) });
  assert.deepEqual(accept(before, [incoming]).channels, [incoming]);
});

test("empty channels transition to known and legacy messages without retaining an empty-channel null", () => {
  const before = state([channel({ latestPreview: null, latestPreviewCreatedAt: null })]);
  for (const incoming of [channel(), channel({ latestPreviewCreatedAt: createdAt })]) {
    assert.deepEqual(accept(before, [incoming]).channels, [incoming]);
  }
});

test("tombstones keep their original creation time and cannot be resurrected by an older edit", () => {
  const before = state([channel({ latestPreviewCreatedAt: createdAt })]);
  const tombstone = channel({ latestPreview: preview({ version: "4", bodyPreview: "", deletedAt: "2026-09-22T09:30:00Z" }) });
  const deleted = accept(before, [tombstone]);
  assert.deepEqual(deleted.channels, [{ ...tombstone, latestPreviewCreatedAt: createdAt }]);
  assert.deepEqual(accept(deleted, [channel()]).channels, deleted.channels);
});

test("identity/sequence conflicts remain rejected independently of matching creation time", () => {
  const before = state([channel({ latestPreviewCreatedAt: createdAt })]);
  for (const patch of [{ id: id(2) }, { sequence: "11" }]) {
    assert.equal(acceptTeamChatChannels(before,
      decode([channel({ latestPreviewCreatedAt: createdAt, latestPreview: preview(patch) })]), 2), null);
  }
});

test("an old request ticket is ignored before considering timestamp conflicts or restoring channels", () => {
  const before = state([channel({ latestPreviewCreatedAt: createdAt })], 8);
  const late = decode([channel({ latestPreviewCreatedAt: nextMicrosecond }), channel({ key: "sales", latestPreview: null, latestPreviewCreatedAt: null })]);
  for (const requestId of [7, 8]) assert.equal(acceptTeamChatChannels(before, late, requestId), before);
});

test("the latest authorized list can revoke a channel without cached timestamps restoring it", () => {
  const general = channel({ latestPreviewCreatedAt: createdAt });
  const sales = channel({ key: "sales", latestPreviewCreatedAt: nextMicrosecond,
    latestPreview: preview({ id: id(2), sequence: "11" }) });
  const initial = state([general, sales], 1);
  const narrowed = accept(initial, [general], 3);
  assert.deepEqual(narrowed.channels, [general]);
  assert.equal(acceptTeamChatChannels(narrowed, initial.channels, 2), narrowed);
  assert.deepEqual(accept(narrowed, [], 4), { requestId: 4, channels: [] });
});

test("accepted timestamp merges do not mutate frozen previous state or alias incoming previews", () => {
  const before = state([channel({ latestPreviewCreatedAt: createdAt })]);
  Object.freeze(before.channels[0].latestPreview);
  Object.freeze(before.channels[0]); Object.freeze(before.channels); Object.freeze(before);
  const incoming = decode([channel({ latestPreview: preview({ version: "4", bodyPreview: "Edited" }) })]);
  const result = acceptTeamChatChannels(before, incoming, 2);
  assert.notEqual(result, null);
  incoming[0].latestPreview.bodyPreview = "Changed after acceptance";
  incoming[0].latestPreviewCreatedAt = nextMicrosecond;
  assert.deepEqual(result.channels, [channel({ latestPreviewCreatedAt: createdAt,
    latestPreview: preview({ version: "4", bodyPreview: "Edited" }) })]);
  assert.deepEqual(before, state([channel({ latestPreviewCreatedAt: createdAt })]));
});
