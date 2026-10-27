// The pure Wazzup rules: payload classification, portions, the webhook address (src/lib/platform-wazzup-webhook.ts) and the
// channel-health words and daily reconciliation (src/lib/platform-wazzup-health.ts). No network, no database, no clock.
// Run with: node --conditions=react-server --experimental-strip-types --test tests/platform-wazzup-webhook.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWazzupWebhookUri,
  classifyWazzupPayload,
  splitWazzupPortions,
  WAZZUP_COUNTER_MAX,
  WAZZUP_MAX_BODY_BYTES,
  WAZZUP_PORTION_SIZE,
  WAZZUP_WEBHOOK_HOST,
  WAZZUP_WEBHOOK_ORIGIN,
  WAZZUP_WEBHOOK_PATH,
  WAZZUP_WEBHOOK_URI_MAX_CHARS,
  wazzupElementTimeMs,
} from "../src/lib/platform-wazzup-webhook.ts";
import {
  WAZZUP_BACKLOG_DEGRADED_SECONDS,
  wazzupReconciliationTolerance,
  wazzupReconciliationVerdict,
  wazzupReconciliationWindow,
  wazzupStateHealthWord,
} from "../src/lib/platform-wazzup-health.ts";

const HOOK_TOKEN = "0123456789abcdef".repeat(4);

test("the constants are the ones the plan fixes", () => {
  assert.equal(WAZZUP_WEBHOOK_HOST, "crm.evoadmissions.com");
  assert.equal(WAZZUP_WEBHOOK_PATH, "/api/v2/whatsapp/wazzup/inbound");
  assert.equal(WAZZUP_WEBHOOK_ORIGIN, "https://crm.evoadmissions.com");
  assert.equal(WAZZUP_MAX_BODY_BYTES, 1024 * 1024);
  assert.equal(WAZZUP_PORTION_SIZE, 100);
  assert.equal(WAZZUP_WEBHOOK_URI_MAX_CHARS, 200);
  assert.equal(WAZZUP_BACKLOG_DEGRADED_SECONDS, 1800);
});

test("the webhook address with a 64-character token is 131 characters, under the 200 Wazzup allows; a bad token never builds one", () => {
  const uri = buildWazzupWebhookUri(HOOK_TOKEN);
  assert.equal(uri, `https://crm.evoadmissions.com/api/v2/whatsapp/wazzup/inbound?token=${HOOK_TOKEN}`);
  assert.equal(uri.length, 131);
  assert.ok(uri.length <= WAZZUP_WEBHOOK_URI_MAX_CHARS);
  for (const bad of ["", "a".repeat(63), "a".repeat(65), HOOK_TOKEN.toUpperCase(), `${HOOK_TOKEN.slice(1)}z`]) {
    assert.throws(() => buildWazzupWebhookUri(bad), RangeError);
  }
  // The error never carries the value.
  try {
    buildWazzupWebhookUri("secret-looking-value");
  } catch (error) {
    assert.ok(!String(error.message).includes("secret-looking-value"));
  }
});

test("classification: the handshake is exactly {test:true}; anything else with a test key is an ordinary payload", () => {
  assert.deepEqual(classifyWazzupPayload({ test: true }), { kind: "test" });
  for (const body of [{ test: false }, { test: 1 }, { test: true, messages: [] }, { test: "true" }]) {
    assert.equal(classifyWazzupPayload(body)?.kind, "batch", JSON.stringify(body));
  }
  for (const notObject of [null, [], "x", 1, true, undefined]) assert.equal(classifyWazzupPayload(notObject), null);
});

test("classification: messages and channel updates become elements in body order; statuses and unwanted subscriptions become counters only", () => {
  const body = {
    messages: [{ messageId: "m1" }, { messageId: "m2" }],
    statuses: [{ messageId: "m1" }, { messageId: "m2" }, { messageId: "m3" }],
    channelsUpdates: [{ channelId: "c1", state: "active" }],
    createContact: { name: "x" },
    templateStatus: { status: "APPROVED" },
    somethingNew: 1,
  };
  assert.deepEqual(classifyWazzupPayload(body), {
    kind: "batch",
    elements: [
      { kind: "message", element: { messageId: "m1" } },
      { kind: "message", element: { messageId: "m2" } },
      { kind: "channel", element: { channelId: "c1", state: "active" } },
    ],
    statuses: 3,
    ignored: 3,
  });
  assert.deepEqual(classifyWazzupPayload({}), { kind: "batch", elements: [], statuses: 0, ignored: 0 });
  // A key that is not an array is kept whole as one element (the database stores it as `unparsed`), never dropped.
  assert.deepEqual(classifyWazzupPayload({ messages: "oops", channelsUpdates: null }), {
    kind: "batch",
    elements: [{ kind: "message", element: "oops" }, { kind: "channel", element: null }],
    statuses: 0,
    ignored: 0,
  });
  assert.equal(classifyWazzupPayload({ statuses: { a: 1 } }).statuses, 1);
});

test("classification: a counter never exceeds what the database accepts (seven digits)", () => {
  const huge = classifyWazzupPayload({ statuses: new Array(10_000_000).fill(0) });
  assert.equal(huge.statuses, WAZZUP_COUNTER_MAX);
});

test("portions: at most the size, in order, nothing lost, nothing doubled", () => {
  assert.deepEqual(splitWazzupPortions([]), []);
  const items = Array.from({ length: 250 }, (_, index) => index);
  const portions = splitWazzupPortions(items);
  assert.deepEqual(portions.map((portion) => portion.length), [100, 100, 50]);
  assert.deepEqual(portions.flat(), items);
  assert.deepEqual(splitWazzupPortions(items.slice(0, 100)).map((portion) => portion.length), [100]);
  assert.deepEqual(splitWazzupPortions(items.slice(0, 101)).map((portion) => portion.length), [100, 1]);
  assert.deepEqual(splitWazzupPortions([1, 2, 3], 2), [[1, 2], [3]]);
  for (const size of [0, -1, 1.5, Number.NaN]) assert.throws(() => splitWazzupPortions([1], size), RangeError);
});

test("element time: dateTime without a zone is read as UTC; an unreadable or missing time is null", () => {
  assert.equal(wazzupElementTimeMs({ dateTime: "2026-10-27T10:00:00.000" }), Date.parse("2026-10-27T10:00:00.000Z"));
  assert.equal(wazzupElementTimeMs({ dateTime: "2026-10-27T10:00:00.000Z" }), Date.parse("2026-10-27T10:00:00.000Z"));
  assert.equal(wazzupElementTimeMs({ dateTime: "2026-10-27T10:00:00+06:00" }), Date.parse("2026-10-27T04:00:00Z"));
  for (const element of [{}, { dateTime: 5 }, { dateTime: "yesterday" }, null, "x", [], undefined]) {
    assert.equal(wazzupElementTimeMs(element), null, JSON.stringify(element));
  }
});

// ---------------------------------------------------------------- channel state words

test("channel states map to the 321 status words, in either spelling the two documentation pages use", () => {
  const expected = {
    active: "WORKING",
    init: "STARTING",
    phoneUnavailable: "PHONE_UNAVAILABLE",
    qr: "SCAN_QR_CODE",
    qridle: "SCAN_QR_CODE",
    openElsewhere: "OPEN_ELSEWHERE",
    openelsewhere: "OPEN_ELSEWHERE",
    notEnoughMoney: "NOT_PAID",
    unauthorized: "UNAUTHORIZED",
    disabled: "DISABLED",
    foreignphone: "FOREIGN_PHONE",
    waitForPassword: "WAIT_FOR_PASSWORD",
    blocked: "BLOCKED",
    onModeration: "ON_MODERATION",
    rejected: "REJECTED",
  };
  for (const [state, word] of Object.entries(expected)) assert.equal(wazzupStateHealthWord(state), word, state);
  assert.equal(wazzupStateHealthWord("ACTIVE"), "WORKING", "case does not matter");
});

test("an unknown state is never read as working: camelCase becomes a status word, junk becomes UNKNOWN_STATE", () => {
  assert.equal(wazzupStateHealthWord("newBrokenState"), "NEW_BROKEN_STATE");
  assert.equal(wazzupStateHealthWord("some-state.v2"), "SOME_STATE_V2");
  assert.equal(wazzupStateHealthWord(""), "UNKNOWN_STATE");
  assert.equal(wazzupStateHealthWord("!!!"), "UNKNOWN_STATE");
  assert.equal(wazzupStateHealthWord("9lives"), "UNKNOWN_STATE");
  for (const state of ["newBrokenState", "x", "a-b", "ЖЖЖ"]) {
    assert.match(wazzupStateHealthWord(state), /^[A-Z][A-Z0-9_]{0,63}$/u);
    assert.notEqual(wazzupStateHealthWord(state), "WORKING");
  }
});

// ---------------------------------------------------------------- reconciliation

test("reconciliation tolerance is max(3, 2 % of the amoCRM count) and the verdict only calls EVO-behind a gap", () => {
  assert.equal(wazzupReconciliationTolerance(0), 3);
  assert.equal(wazzupReconciliationTolerance(100), 3);
  assert.equal(wazzupReconciliationTolerance(150), 3);
  assert.equal(wazzupReconciliationTolerance(300), 6);
  assert.equal(wazzupReconciliationTolerance(303), 7);
  assert.equal(wazzupReconciliationVerdict(300, 300), "match");
  assert.equal(wazzupReconciliationVerdict(294, 300), "match", "exactly at the tolerance");
  assert.equal(wazzupReconciliationVerdict(293, 300), "gap", "one beyond");
  assert.equal(wazzupReconciliationVerdict(0, 10), "gap");
  assert.equal(wazzupReconciliationVerdict(7, 10), "match");
  assert.equal(wazzupReconciliationVerdict(6, 10), "gap");
  assert.equal(wazzupReconciliationVerdict(400, 300), "evo_ahead", "EVO having more is not a loss");
  assert.equal(wazzupReconciliationVerdict(306, 300), "match");
  assert.equal(wazzupReconciliationVerdict(307, 300), "evo_ahead");
});

test("the reconciliation window is 00:10-06:00 Bishkek and the day is the Bishkek day that just ended", () => {
  const at = (local) => Date.parse(`${local}+06:00`);
  assert.deepEqual(wazzupReconciliationWindow(at("2026-10-27T00:09:59")), { due: false, day: "2026-10-26" });
  assert.deepEqual(wazzupReconciliationWindow(at("2026-10-27T00:10:00")), { due: true, day: "2026-10-26" });
  assert.deepEqual(wazzupReconciliationWindow(at("2026-10-27T05:59:59")), { due: true, day: "2026-10-26" });
  assert.deepEqual(wazzupReconciliationWindow(at("2026-10-27T06:00:00")), { due: false, day: "2026-10-26" });
  assert.deepEqual(wazzupReconciliationWindow(at("2026-10-27T23:59:00")), { due: false, day: "2026-10-26" });
  // Month and year boundaries: the day is computed on the Bishkek calendar, not the UTC one.
  assert.deepEqual(wazzupReconciliationWindow(at("2026-11-01T01:00:00")), { due: true, day: "2026-10-31" });
  assert.deepEqual(wazzupReconciliationWindow(at("2027-01-01T00:30:00")), { due: true, day: "2026-12-31" });
  // 18:30 UTC on 26.10 is already 00:30 on 27.10 in Bishkek.
  assert.deepEqual(wazzupReconciliationWindow(Date.parse("2026-10-26T18:30:00Z")), { due: true, day: "2026-10-26" });
  assert.deepEqual(wazzupReconciliationWindow(Number.NaN).due, false);
});
