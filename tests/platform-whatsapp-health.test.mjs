// Pure rules of the WhatsApp connection alert (src/lib/platform-whatsapp-health.ts): thresholds, working-hours math,
// dedupe, resolve. No database, no network, no clock. Run with:
// node --conditions=react-server --experimental-strip-types --test tests/platform-whatsapp-health.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  isWhatsAppWorkingTime,
  planWhatsAppHealth,
  whatsAppHealthStatusWord,
  whatsAppWorkingElapsedMs,
  WHATSAPP_DOWN_THRESHOLD_MS,
  WHATSAPP_HEALTH_TICK_GAP_MS,
  WHATSAPP_SILENT_THRESHOLD_MS,
} from "../src/lib/platform-whatsapp-health.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
// Bishkek wall clock as an instant (UTC+6, no daylight saving).
const at = (local) => Date.parse(`${local}+06:00`);
const weekday = (ms) => new Date(ms).toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Bishkek" });

test("the calendar facts the fixtures rely on", () => {
  assert.equal(weekday(at("2026-10-26T12:00:00")), "Monday");
  assert.equal(weekday(at("2026-10-31T12:00:00")), "Saturday");
  assert.equal(weekday(at("2026-11-01T12:00:00")), "Sunday");
  assert.equal(WHATSAPP_DOWN_THRESHOLD_MS, 10 * MIN);
  assert.equal(WHATSAPP_SILENT_THRESHOLD_MS, 3 * HOUR);
});

test("working time is Mon-Sat 10:00-20:00 in Bishkek; the end is exclusive, Sunday is closed", () => {
  assert.equal(isWhatsAppWorkingTime(at("2026-10-26T09:59:59")), false);
  assert.equal(isWhatsAppWorkingTime(at("2026-10-26T10:00:00")), true);
  assert.equal(isWhatsAppWorkingTime(at("2026-10-26T19:59:59")), true);
  assert.equal(isWhatsAppWorkingTime(at("2026-10-26T20:00:00")), false);
  assert.equal(isWhatsAppWorkingTime(at("2026-10-31T15:00:00")), true, "Saturday works");
  assert.equal(isWhatsAppWorkingTime(at("2026-11-01T15:00:00")), false, "Sunday is closed");
  // The local day differs from the UTC day: Monday 03:00 Bishkek is still Sunday 21:00 UTC.
  assert.equal(isWhatsAppWorkingTime(Date.parse("2026-10-25T21:00:00Z")), false);
  // Monday 10:00 Bishkek is Monday 04:00 UTC.
  assert.equal(isWhatsAppWorkingTime(Date.parse("2026-10-26T04:00:00Z")), true);
  assert.equal(isWhatsAppWorkingTime(Number.NaN), false);
});

test("working elapsed time counts only working hours", () => {
  // Inside one day.
  assert.equal(whatsAppWorkingElapsedMs(at("2026-10-26T10:00:00"), at("2026-10-26T13:00:00")), 3 * HOUR);
  // Across closing: 19:00 -> next day 11:00 is 1 h + 1 h.
  assert.equal(whatsAppWorkingElapsedMs(at("2026-10-26T19:00:00"), at("2026-10-27T11:00:00")), 2 * HOUR);
  // Night only.
  assert.equal(whatsAppWorkingElapsedMs(at("2026-10-26T21:00:00"), at("2026-10-27T08:00:00")), 0);
  // Saturday evening to Monday: Saturday 19:00-20:00 + Monday 10:00-12:00.
  assert.equal(whatsAppWorkingElapsedMs(at("2026-10-31T19:00:00"), at("2026-11-02T12:00:00")), 3 * HOUR);
  // Sunday only.
  assert.equal(whatsAppWorkingElapsedMs(at("2026-11-01T00:00:00"), at("2026-11-01T23:59:00")), 0);
  // A whole working day is ten hours.
  assert.equal(whatsAppWorkingElapsedMs(at("2026-10-26T00:00:00"), at("2026-10-27T00:00:00")), 10 * HOUR);
  // Reversed or equal or non-finite ends.
  assert.equal(whatsAppWorkingElapsedMs(at("2026-10-26T12:00:00"), at("2026-10-26T11:00:00")), 0);
  assert.equal(whatsAppWorkingElapsedMs(at("2026-10-26T12:00:00"), at("2026-10-26T12:00:00")), 0);
  assert.equal(whatsAppWorkingElapsedMs(Number.NaN, at("2026-10-26T12:00:00")), 0);
  // The cap stops the walk early even for a very old start (no long loop), and the answer is still >= the cap.
  const started = Date.now();
  const capped = whatsAppWorkingElapsedMs(0, at("2026-10-26T12:00:00"), 3 * HOUR);
  assert.ok(capped >= 3 * HOUR);
  assert.ok(Date.now() - started < 200);
});

test("only well-formed WAHA status words pass", () => {
  for (const word of ["WORKING", "FAILED", "SCAN_QR_CODE", "PASSKEY_CONFIRMATION_REQUIRED", "UNREACHABLE"]) {
    assert.equal(whatsAppHealthStatusWord(word), word);
  }
  for (const bad of ["working", "", "FAILED ", "A-B", "7UP", null, undefined, 7, "X".repeat(65)]) {
    assert.equal(whatsAppHealthStatusWord(bad), null);
  }
});

const NOW = at("2026-10-26T14:00:00"); // Monday, inside working time
const working = { kind: "status", status: "WORKING" };
const failed = { kind: "status", status: "FAILED" };
// `workingSinceAt` is the silence baseline; unless a test says otherwise it is the start of the run.
const monitor = (lastStatus, sinceAt, lastSeenAt = NOW - 5 * MIN, workingSinceAt = sinceAt) => ({
  lastStatus,
  lastSeenAt,
  sinceAt,
  workingSinceAt,
});
const plan = (overrides) =>
  planWhatsAppHealth({
    now: NOW,
    observation: working,
    monitor: monitor("WORKING", NOW - HOUR),
    disconnected: null,
    silent: null,
    lastInboundAt: NOW - MIN,
    ...overrides,
  });

test("a probe that cannot answer changes nothing and raises nothing", () => {
  const result = plan({
    observation: { kind: "unknown" },
    monitor: monitor("FAILED", NOW - HOUR),
    disconnected: { id: "a", openedAt: NOW - 30 * MIN },
    silent: { id: "b", openedAt: NOW - 30 * MIN },
  });
  assert.equal(result.verdict, "unknown");
  assert.equal(result.observe, null);
  assert.deepEqual([...result.open], []);
  assert.deepEqual([...result.resolve], []);
});

test("not working for less than ten minutes only starts the run, nothing is raised", () => {
  const first = plan({ observation: failed, monitor: null });
  assert.deepEqual(first.observe, { status: "FAILED", restart: true, workingRestart: true });
  assert.deepEqual([...first.open], []);
  assert.equal(first.verdict, "down_pending");

  const second = plan({ observation: failed, monitor: monitor("FAILED", NOW - 5 * MIN) });
  assert.deepEqual(second.observe, { status: "FAILED", restart: false, workingRestart: false });
  assert.deepEqual([...second.open], []);
  assert.equal(second.downMinutes, 5);

  const justBefore = plan({ observation: failed, monitor: monitor("FAILED", NOW - WHATSAPP_DOWN_THRESHOLD_MS + 1) });
  assert.deepEqual([...justBefore.open], []);
});

test("not working for ten minutes opens ONE disconnected alert, with the status word", () => {
  const exactly = plan({ observation: failed, monitor: monitor("FAILED", NOW - WHATSAPP_DOWN_THRESHOLD_MS) });
  assert.deepEqual([...exactly.open], [{ kind: "disconnected", status: "FAILED" }]);
  assert.equal(exactly.verdict, "down");
  // Dedupe: an alert already open for this outage is not opened again, however long it lasts.
  for (const minutes of [10, 11, 60, 24 * 60]) {
    const again = plan({
      observation: failed,
      monitor: monitor("FAILED", NOW - minutes * MIN),
      disconnected: { id: "open-1", openedAt: NOW - 5 * MIN },
    });
    assert.deepEqual([...again.open], [], `${minutes} min`);
    assert.deepEqual([...again.resolve], []);
  }
});

test("any status other than WORKING counts, including an unreachable service, and the run survives status changes", () => {
  for (const status of ["FAILED", "STOPPED", "STARTING", "SCAN_QR_CODE", "PASSKEY_REQUIRED", "UNREACHABLE"]) {
    const result = plan({
      observation: { kind: "status", status },
      monitor: monitor("FAILED", NOW - 12 * MIN),
    });
    assert.deepEqual([...result.open], [{ kind: "disconnected", status }], status);
    assert.equal(result.observe.restart, false, "FAILED -> another non-working word keeps the run");
  }
});

test("a gap between passes, or a clock that went backwards, restarts the run", () => {
  const gap = plan({
    observation: failed,
    monitor: monitor("FAILED", NOW - 3 * HOUR, NOW - WHATSAPP_HEALTH_TICK_GAP_MS - 1),
  });
  assert.deepEqual(gap.observe, { status: "FAILED", restart: true, workingRestart: false });
  assert.deepEqual([...gap.open], [], "nothing is known about the gap");
  const withinGap = plan({
    observation: failed,
    monitor: monitor("FAILED", NOW - 3 * HOUR, NOW - WHATSAPP_HEALTH_TICK_GAP_MS),
  });
  assert.equal(withinGap.observe.restart, false);
  assert.equal(withinGap.open.length, 1);
  const future = plan({ observation: failed, monitor: monitor("FAILED", NOW + HOUR, NOW + HOUR) });
  assert.equal(future.observe.restart, true);
});

test("a recovery resolves the disconnected alert at the first WORKING pass and starts the working run", () => {
  const result = plan({
    observation: working,
    monitor: monitor("FAILED", NOW - 2 * HOUR),
    disconnected: { id: "open-1", openedAt: NOW - HOUR },
  });
  assert.deepEqual([...result.resolve], [{ kind: "disconnected", reason: "working_again" }]);
  assert.deepEqual(result.observe, { status: "WORKING", restart: true, workingRestart: true });
  assert.deepEqual([...result.open], []);
  // No alert open: nothing to resolve.
  const quiet = plan({ observation: working, monitor: monitor("FAILED", NOW - 5 * MIN) });
  assert.deepEqual([...quiet.resolve], []);
});

test("silence: three working hours without an inbound message opens ONE silent alert inside working time", () => {
  const since = at("2026-10-25T08:00:00"); // the run is old
  const lastInboundAt = at("2026-10-26T11:00:00"); // exactly three working hours before 14:00
  const result = plan({ monitor: monitor("WORKING", since), lastInboundAt });
  assert.deepEqual([...result.open], [{ kind: "silent", status: "WORKING" }]);
  assert.equal(result.verdict, "silent");
  assert.equal(result.silentWorkingMinutes, 180);
  // One minute short: pending, nothing opened.
  const short = plan({ monitor: monitor("WORKING", since), lastInboundAt: lastInboundAt + MIN });
  assert.deepEqual([...short.open], []);
  assert.equal(short.verdict, "silent_pending");
  // Dedupe: the alert is already open and the silence goes on.
  const again = plan({
    monitor: monitor("WORKING", since),
    lastInboundAt,
    silent: { id: "s1", openedAt: NOW - 20 * MIN },
  });
  assert.deepEqual([...again.open], []);
  assert.deepEqual([...again.resolve], []);
  assert.equal(again.verdict, "silent");
});

test("silence is not raised after hours or on Sunday, even when the working hours before it add up", () => {
  const since = at("2026-10-20T08:00:00");
  const lastInboundAt = at("2026-10-26T10:00:00");
  // Monday 20:30: five working hours of silence, but the office is closed now.
  const evening = planWhatsAppHealth({
    now: at("2026-10-26T20:30:00"),
    observation: working,
    monitor: { lastStatus: "WORKING", lastSeenAt: at("2026-10-26T20:25:00"), sinceAt: since, workingSinceAt: since },
    disconnected: null,
    silent: null,
    lastInboundAt,
  });
  assert.deepEqual([...evening.open], []);
  // Sunday noon: closed, nothing opened.
  const sunday = planWhatsAppHealth({
    now: at("2026-11-01T12:00:00"),
    observation: working,
    monitor: { lastStatus: "WORKING", lastSeenAt: at("2026-11-01T11:55:00"), sinceAt: since, workingSinceAt: since },
    disconnected: null,
    silent: null,
    lastInboundAt: at("2026-10-31T10:00:00"),
  });
  assert.deepEqual([...sunday.open], []);
  // Monday 10:30 after a Saturday 19:00 message: 1 h (Saturday) + 30 min = 1.5 h, not enough.
  const monday = planWhatsAppHealth({
    now: at("2026-11-02T10:30:00"),
    observation: working,
    monitor: { lastStatus: "WORKING", lastSeenAt: at("2026-11-02T10:25:00"), sinceAt: since, workingSinceAt: since },
    disconnected: null,
    silent: null,
    lastInboundAt: at("2026-10-31T19:00:00"),
  });
  assert.deepEqual([...monday.open], []);
  assert.equal(monday.silentWorkingMinutes, 90);
  // Monday 12:00 the same silence is three working hours: now it opens.
  const noon = planWhatsAppHealth({
    now: at("2026-11-02T12:00:00"),
    observation: working,
    monitor: { lastStatus: "WORKING", lastSeenAt: at("2026-11-02T11:55:00"), sinceAt: since, workingSinceAt: since },
    disconnected: null,
    silent: null,
    lastInboundAt: at("2026-10-31T19:00:00"),
  });
  assert.deepEqual([...noon.open], [{ kind: "silent", status: "WORKING" }]);
});

test("a fresh reconnection does not read as silence: the clock starts with the working run", () => {
  // The last message is days old, but the session was seen WORKING for the first time 20 minutes ago.
  const reconnected = plan({
    monitor: monitor("WORKING", NOW - 20 * MIN),
    lastInboundAt: at("2026-10-16T12:00:00"),
  });
  assert.deepEqual([...reconnected.open], []);
  assert.equal(reconnected.silentWorkingMinutes, 20);
  // The very first pass ever (no run yet) behaves the same.
  const first = plan({ monitor: null, lastInboundAt: at("2026-10-16T12:00:00") });
  assert.deepEqual([...first.open], []);
  assert.deepEqual(first.observe, { status: "WORKING", restart: true, workingRestart: true });
  // No message ever recorded: silence counts from the start of the run.
  const never = plan({ monitor: monitor("WORKING", NOW - 4 * HOUR), lastInboundAt: null });
  assert.deepEqual([...never.open], [{ kind: "silent", status: "WORKING" }]);
  const neverYoung = plan({ monitor: monitor("WORKING", NOW - 2 * HOUR), lastInboundAt: null });
  assert.deepEqual([...neverYoung.open], []);
});

test("the silent alert resolves when a message arrives, or when the session was re-linked after it opened", () => {
  const openedAt = NOW - 30 * MIN;
  const stillSilent = plan({
    monitor: monitor("WORKING", NOW - 6 * HOUR),
    lastInboundAt: NOW - 4 * HOUR,
    silent: { id: "s1", openedAt },
  });
  assert.deepEqual([...stillSilent.resolve], []);

  const message = plan({
    monitor: monitor("WORKING", NOW - 6 * HOUR),
    lastInboundAt: NOW - 2 * MIN,
    silent: { id: "s1", openedAt },
  });
  assert.deepEqual([...message.resolve], [{ kind: "silent", reason: "messages_arrived" }]);
  assert.deepEqual([...message.open], []);

  const relinked = plan({
    observation: working,
    monitor: monitor("FAILED", NOW - 40 * MIN),
    lastInboundAt: NOW - 4 * HOUR,
    silent: { id: "s1", openedAt },
  });
  assert.deepEqual([...relinked.resolve], [{ kind: "silent", reason: "reconnected" }]);

  // A message that arrives outside working time still resolves it.
  const night = planWhatsAppHealth({
    now: at("2026-10-26T22:00:00"),
    observation: working,
    monitor: {
      lastStatus: "WORKING",
      lastSeenAt: at("2026-10-26T21:55:00"),
      sinceAt: at("2026-10-26T09:00:00"),
      workingSinceAt: at("2026-10-26T09:00:00"),
    },
    disconnected: null,
    silent: { id: "s1", openedAt: at("2026-10-26T18:00:00") },
    lastInboundAt: at("2026-10-26T21:50:00"),
  });
  assert.deepEqual([...night.resolve], [{ kind: "silent", reason: "messages_arrived" }]);
});

test("while the session is down no silence is judged, and an open silent alert is left for its own resolve", () => {
  const down = plan({
    observation: failed,
    monitor: monitor("WORKING", NOW - 6 * HOUR),
    lastInboundAt: NOW - 6 * HOUR,
    silent: { id: "s1", openedAt: NOW - HOUR },
  });
  assert.deepEqual([...down.open], []);
  assert.deepEqual([...down.resolve], []);
  assert.equal(down.silentWorkingMinutes, 0);
});

test("a simultaneous disconnected resolve and silent open cannot happen for the same pass", () => {
  // Recovery pass: the run restarts now, so the silence clock is at zero and no silent alert opens.
  const recovery = plan({
    observation: working,
    monitor: monitor("FAILED", NOW - 3 * HOUR),
    disconnected: { id: "d1", openedAt: NOW - 2 * HOUR },
    lastInboundAt: at("2026-10-26T08:00:00"),
  });
  assert.deepEqual([...recovery.resolve], [{ kind: "disconnected", reason: "working_again" }]);
  assert.deepEqual([...recovery.open], []);
});

// --- Measurement breaks are not connection events (review of the first version: a slow probe or a stopped timer
// used to restart the silence clock and close an open «молчит» alert as «reconnected»). ---

const TUESDAY = at("2026-10-27T13:30:00");
const TUE_RUN_START = at("2026-10-20T08:00:00"); // the WORKING run is old
/** A pass on Tuesday with the silence started at 10:00 (last inbound) and the alert opened at 13:00. */
const tuesdayPass = (overrides) =>
  planWhatsAppHealth({
    now: TUESDAY,
    observation: working,
    monitor: monitor("WORKING", TUE_RUN_START, TUESDAY - 5 * MIN),
    disconnected: null,
    silent: { id: "s1", openedAt: at("2026-10-27T13:00:00") },
    lastInboundAt: at("2026-10-27T10:00:00"),
    ...overrides,
  });

test("one slow probe between two WORKING passes does not close an open silent alert", () => {
  // 13:25: the probe times out - UNREACHABLE. Only the run restarts; the silence baseline stays and nothing resolves.
  const blip = tuesdayPass({
    now: at("2026-10-27T13:25:00"),
    observation: { kind: "status", status: "UNREACHABLE" },
    monitor: monitor("WORKING", TUE_RUN_START, at("2026-10-27T13:20:00")),
  });
  assert.deepEqual(blip.observe, { status: "UNREACHABLE", restart: true, workingRestart: false });
  assert.deepEqual([...blip.resolve], []);
  assert.deepEqual([...blip.open], []);
  assert.equal(blip.verdict, "down_pending");
  // 13:30: WORKING again. The blip lasted nothing, so this is no reconnection: the alert stays, the baseline stays.
  const back = tuesdayPass({
    monitor: { lastStatus: "UNREACHABLE", lastSeenAt: at("2026-10-27T13:25:00"), sinceAt: at("2026-10-27T13:25:00"), workingSinceAt: TUE_RUN_START },
  });
  assert.deepEqual([...back.resolve], []);
  assert.deepEqual([...back.open], []);
  assert.equal(back.verdict, "silent");
  assert.deepEqual(back.observe, { status: "WORKING", restart: true, workingRestart: false });
  // A real message after the alert opened still closes it, blip or not.
  const message = tuesdayPass({
    monitor: { lastStatus: "UNREACHABLE", lastSeenAt: at("2026-10-27T13:25:00"), sinceAt: at("2026-10-27T13:25:00"), workingSinceAt: TUE_RUN_START },
    lastInboundAt: at("2026-10-27T13:28:00"),
  });
  assert.deepEqual([...message.resolve], [{ kind: "silent", reason: "messages_arrived" }]);
});

test("passes without an answer (a gap of more than twenty minutes) restart the run but never close a silent alert", () => {
  // Alert opened at 13:00; the probe could not answer for 25 minutes (nothing was recorded), then WORKING at 13:30.
  const afterGap = tuesdayPass({ monitor: monitor("WORKING", TUE_RUN_START, TUESDAY - WHATSAPP_HEALTH_TICK_GAP_MS - 5 * MIN) });
  assert.deepEqual(afterGap.observe, { status: "WORKING", restart: true, workingRestart: false });
  assert.deepEqual([...afterGap.resolve], []);
  assert.equal(afterGap.verdict, "silent");
  // The same gap without an alert: the silence is still counted from the last message, so it opens when it reaches
  // three working hours (here 10:00 -> 13:30 is 3.5 h).
  const opens = tuesdayPass({
    silent: null,
    monitor: monitor("WORKING", TUE_RUN_START, TUESDAY - WHATSAPP_HEALTH_TICK_GAP_MS - 5 * MIN),
  });
  assert.deepEqual([...opens.open], [{ kind: "silent", status: "WORKING" }]);
  assert.equal(opens.silentWorkingMinutes, 210);
});

test("a blip does not restart the silence clock: three working hours after the last message still raise «молчит»", () => {
  // Last message 11:00. At 13:55 one probe reads UNREACHABLE; at 14:00 WORKING. Before the fix the clock restarted at 14:00.
  const lastInboundAt = at("2026-10-27T11:00:00");
  const now = at("2026-10-27T14:00:00");
  const result = planWhatsAppHealth({
    now,
    observation: working,
    monitor: { lastStatus: "UNREACHABLE", lastSeenAt: now - 5 * MIN, sinceAt: now - 5 * MIN, workingSinceAt: TUE_RUN_START },
    disconnected: null,
    silent: null,
    lastInboundAt,
  });
  assert.deepEqual([...result.open], [{ kind: "silent", status: "WORKING" }]);
  assert.equal(result.silentWorkingMinutes, 180);
  assert.deepEqual(result.observe, { status: "WORKING", restart: true, workingRestart: false });
});

test("a real outage moves the silence baseline: the spell itself lasted ten minutes, or an alert was open", () => {
  const openedAt = at("2026-10-27T13:00:00");
  // Down for 25 recorded minutes (the disconnected alert could not be opened, say): a real reconnection.
  const spell = tuesdayPass({
    monitor: monitor("FAILED", TUESDAY - 30 * MIN, TUESDAY - 5 * MIN, TUE_RUN_START),
    silent: { id: "s1", openedAt },
  });
  assert.deepEqual(spell.observe, { status: "WORKING", restart: true, workingRestart: true });
  assert.deepEqual([...spell.resolve], [{ kind: "silent", reason: "reconnected" }]);
  // Exactly ten recorded minutes counts; one minute less does not.
  const exact = tuesdayPass({ monitor: monitor("FAILED", TUESDAY - 15 * MIN, TUESDAY - 5 * MIN, TUE_RUN_START) });
  assert.equal(exact.observe.workingRestart, true);
  assert.deepEqual([...exact.resolve], [{ kind: "silent", reason: "reconnected" }]);
  const short = tuesdayPass({ monitor: monitor("FAILED", TUESDAY - 15 * MIN + MIN, TUESDAY - 5 * MIN, TUE_RUN_START) });
  assert.equal(short.observe.workingRestart, false);
  assert.deepEqual([...short.resolve], []);
  // An open «отключён» alert is a real outage whatever the recorded spell says (a gap restarted the run).
  const alerted = tuesdayPass({
    monitor: monitor("FAILED", TUESDAY - 5 * MIN, TUESDAY - 5 * MIN, TUE_RUN_START),
    disconnected: { id: "d1", openedAt: TUESDAY - 2 * HOUR },
  });
  assert.equal(alerted.observe.workingRestart, true);
  assert.deepEqual(
    alerted.resolve.map((item) => item.kind).sort(),
    ["disconnected", "silent"],
  );
  // A reconnection does not raise «молчит» right away: the baseline is now.
  const fresh = tuesdayPass({
    silent: null,
    monitor: monitor("FAILED", TUESDAY - 30 * MIN, TUESDAY - 5 * MIN, TUE_RUN_START),
    lastInboundAt: at("2026-10-20T12:00:00"),
  });
  assert.deepEqual([...fresh.open], []);
  assert.equal(fresh.silentWorkingMinutes, 0);
});

test("the first pass ever, and a baseline from the future, start the silence clock now", () => {
  const first = tuesdayPass({ monitor: null, silent: null, lastInboundAt: null });
  assert.deepEqual(first.observe, { status: "WORKING", restart: true, workingRestart: true });
  assert.equal(first.silentWorkingMinutes, 0);
  const future = tuesdayPass({
    silent: null,
    monitor: monitor("WORKING", TUESDAY - HOUR, TUESDAY - 5 * MIN, TUESDAY + HOUR),
    lastInboundAt: null,
  });
  assert.equal(future.observe.workingRestart, true);
});
