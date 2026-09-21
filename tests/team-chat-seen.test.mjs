import assert from "node:assert/strict";
import test from "node:test";
import { decodeTeamChatSeenReceipt, teamChatValidSeenBatch } from "../src/lib/platform-team-chat-seen.ts";

// Pure wire-contract examples only; real Auth/SQL behavior needs its own QA.
const id = (number) => `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const batch = { channel: "general", messageIds: [id(1), id(7)] };
const ack = { channelKey: "general", messageIds: [id(1), id(7)] };

test("seen batch accepts one to fifty distinct UUIDs in every known channel", () => {
  for (const channel of ["general", "sales", "admissions"]) {
    assert.equal(teamChatValidSeenBatch({ channel, messageIds: [id(1)] }), true);
    assert.equal(teamChatValidSeenBatch({ channel, messageIds: Array.from({ length: 50 }, (_, i) => id(i)) }), true);
  }
});

test("rejects actor injection, wrong shape, unknown channel and unbounded batches", () => {
  for (const value of [null, [], "general", {}, { ...batch, membershipId: id(2) },
    { ...batch, organizationId: id(3) }, { ...batch, channel: "private" },
    { ...batch, channel: null }, { channel: "general" },
    { ...batch, messageIds: [] }, { ...batch, messageIds: id(1) },
    Object.assign(Object.create(batch), { membershipId: id(2), organizationId: id(3) }),
    { ...batch, messageIds: Array.from({ length: 51 }, (_, i) => id(i)) }]) {
    assert.equal(teamChatValidSeenBatch(value), false);
  }
});

test("rejects nulls, holes, nested arrays and duplicate UUIDs including case variants", () => {
  for (const messageIds of [[null], [id(1), null], new Array(1), [[id(1)]],
    [id(1), id(1)], [id(1), id(1).toUpperCase()], ["not-a-uuid"], [7]]) {
    assert.equal(teamChatValidSeenBatch({ ...batch, messageIds }), false);
  }
});

test("accepts only a complete exact-set acknowledgement, with order/case independence", () => {
  assert.deepEqual(decodeTeamChatSeenReceipt(ack, batch), ack);
  const reversed = { ...ack, messageIds: [id(7).toUpperCase(), id(1)] };
  assert.deepEqual(decodeTeamChatSeenReceipt(reversed, batch), { ...ack, messageIds: [id(7), id(1)] });
});

test("partial, extra, duplicate or other-channel acknowledgements are not success", () => {
  for (const value of [null, [], {}, { ...ack, channelKey: "sales" },
    { ...ack, messageIds: [id(1)] }, { ...ack, messageIds: [id(1), id(7), id(9)] },
    { ...ack, messageIds: [id(1), id(9)] }, { ...ack, messageIds: [id(1), id(1)] },
    { ...ack, messageIds: [id(1), id(1).toUpperCase()] }, { ...ack, messageIds: [id(1), null] },
    { ...ack, readSequence: "999" }, { ...ack, messageIds: new Array(2) }]) {
    assert.equal(decodeTeamChatSeenReceipt(value, batch), null);
  }
  assert.equal(decodeTeamChatSeenReceipt(Object.assign(Object.create(ack), { unrelated: 1, version: 2 }), batch), null);
});

test("receipt decoding rejects an invalid originating batch", () => {
  assert.equal(decodeTeamChatSeenReceipt(ack, { ...batch, messageIds: [id(1), id(1)] }), null);
  assert.equal(decodeTeamChatSeenReceipt(ack, { ...batch, channel: "unknown" }), null);
});

test("decoding does not expose a mutable alias to the transport array", () => {
  const wire = { ...ack, messageIds: [...ack.messageIds] };
  const decoded = decodeTeamChatSeenReceipt(wire, batch);
  wire.messageIds[0] = id(9);
  assert.deepEqual(decoded, ack);
});
