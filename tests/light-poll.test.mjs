import assert from "node:assert/strict";
import test from "node:test";

import * as poll from "../src/lib/light-poll.ts";
import * as sections from "../src/lib/portal-poll-section.ts";

// Лёгкий опрос (A4, docs/PLAN_CHANGES.md 19.10.2026): расписание, задержка
// после сбоев, скрытая вкладка, фокус, версия и устаревшая сборка.

const V1 = "a".repeat(32);
const V2 = "b".repeat(32);
const REV = "c".repeat(40);

test("delay doubles after each failure up to ten minutes and the base is one minute", () => {
  assert.equal(poll.POLL_BASE_MS, 60_000);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9, 50].map(poll.nextPollDelay), [60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000, 600_000]);
  assert.equal(poll.nextPollDelay(-3), 60_000);
  assert.equal(poll.nextPollDelay(Number.NaN), 60_000);
});

test("a return to the tab polls only if the last poll is at least 30 s old", () => {
  assert.equal(poll.shouldPollOnResume(null, 1000), true);
  assert.equal(poll.shouldPollOnResume(1000, 30_999), false);
  assert.equal(poll.shouldPollOnResume(1000, 31_000), true);
});

test("the answer is parsed strictly: integers, 32-hex or null version, 40-hex or null release", () => {
  assert.deepEqual(poll.parseLightPollBody({ release: REV, unread: 3, version: V1 }), { release: REV, unread: 3, version: V1 });
  assert.deepEqual(poll.parseLightPollBody({ release: null, unread: 0, version: null }), { release: null, unread: 0, version: null });
  for (const bad of [
    null, [], "x", {}, { release: REV, unread: -1, version: V1 }, { release: REV, unread: 1.5, version: V1 },
    { release: REV, unread: "3", version: V1 }, { release: REV, unread: 1, version: "short" }, { release: REV, unread: 1, version: undefined },
    { release: "nope", unread: 1, version: V1 }, { unread: 1, version: V1 },
  ]) assert.equal(poll.parseLightPollBody(bad), null, JSON.stringify(bad));
});

function harness(overrides = {}) {
  let time = 1_000_000;
  let visible = true;
  let stale = false;
  let nextHandle = 1;
  const timers = new Map();
  const log = { states: [], changes: 0, releases: [], failures: [], fetches: 0 };
  const queue = [];
  const deps = {
    now: () => time,
    setTimer: (callback, delay) => { const handle = nextHandle++; timers.set(handle, { callback, delay }); return handle; },
    clearTimer: (handle) => { timers.delete(handle); },
    isVisible: () => visible,
    isStale: () => stale,
    fetchState: (signal) => {
      log.fetches += 1;
      const next = queue.shift();
      if (typeof next === "function") return next(signal);
      return Promise.resolve(next ?? { kind: "ok", state: { release: REV, unread: 0, version: V1 } });
    },
    onState: (state) => log.states.push(state),
    onChange: () => { log.changes += 1; },
    onRelease: (release) => log.releases.push(release),
    onFailure: (kind) => log.failures.push(kind),
    ...overrides,
  };
  const poller = poll.createLightPoller(deps);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  /** Scheduled (non-guard) delays: the guard timer has REQUEST_TIMEOUT_MS. */
  const scheduled = () => [...timers.values()].map((timer) => timer.delay).filter((delay) => delay !== poll.REQUEST_TIMEOUT_MS);
  const fire = (delay) => {
    const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `no timer with delay ${delay}: ${JSON.stringify([...timers.values()].map((t) => t.delay))}`);
    timers.delete(entry[0]);
    entry[1].callback();
  };
  return {
    poller, log, queue, timers, scheduled, fire, settle,
    advance: (ms) => { time += ms; },
    setVisible: (value) => { visible = value; },
    setStale: (value) => { stale = value; },
  };
}

const ok = (version, unread = 1, release = REV) => ({ kind: "ok", state: { release, unread, version } });

test("first read polls at once and only remembers the version; the page re-renders only when it changes", async () => {
  const h = harness();
  h.queue.push(ok(V1), ok(V1, 2), ok(V2, 2), ok(V2, 2));
  h.poller.start();
  await h.settle();
  assert.equal(h.log.fetches, 1);
  assert.equal(h.log.changes, 0, "the entry read only remembers the version");
  assert.deepEqual(h.scheduled(), [60_000], "one 60 s timer, nothing else");
  for (const expected of [0, 1, 1]) {
    h.fire(60_000);
    await h.settle();
    assert.equal(h.log.changes, expected);
  }
  assert.equal(h.log.fetches, 4);
  assert.deepEqual(h.log.states.map((state) => state.unread), [1, 2, 2, 2]);
});

test("an unknown version (null) never refreshes the page and is not remembered", async () => {
  const h = harness();
  h.queue.push(ok(null), ok(V1), ok(V2), ok(null));
  h.poller.start();
  await h.settle();
  for (let i = 0; i < 3; i += 1) { h.fire(60_000); await h.settle(); }
  assert.equal(h.log.changes, 1, "V1 -> V2 only; null in between does not count");
});

test("a failure doubles the delay, a success resets it", async () => {
  const h = harness();
  h.queue.push({ kind: "error" }, { kind: "error" }, { kind: "denied" }, ok(V1));
  h.poller.start();
  await h.settle();
  assert.deepEqual(h.scheduled(), [120_000]);
  h.fire(120_000); await h.settle();
  assert.deepEqual(h.scheduled(), [240_000]);
  h.fire(240_000); await h.settle();
  assert.deepEqual(h.scheduled(), [480_000]);
  h.fire(480_000); await h.settle();
  assert.deepEqual(h.scheduled(), [60_000], "first success: back to a minute");
  assert.deepEqual(h.log.failures, ["error", "error", "denied"]);
  assert.equal(h.log.states.length, 1);
});

test("a hidden tab makes no requests and holds no timer; the return polls only after 30 s", async () => {
  const h = harness();
  h.poller.start();
  await h.settle();
  h.setVisible(false);
  h.fire(60_000); await h.settle();
  assert.equal(h.log.fetches, 1, "the tick found the tab hidden: no request");
  assert.deepEqual(h.scheduled(), [], "and no timer is held while hidden");
  h.advance(10_000);
  h.setVisible(true);
  h.poller.resume();
  await h.settle();
  assert.equal(h.log.fetches, 1, "10 s after the last poll: not yet");
  assert.deepEqual(h.scheduled(), [60_000], "the tab is back: the minute timer resumes");
  h.advance(25_000);
  h.poller.resume(); h.poller.resume();
  await h.settle();
  assert.equal(h.log.fetches, 2, "35 s: one poll, focus and visibility together do not double it");
});

test("focus is throttled to once per 30 s and never runs two requests at once", async () => {
  let release;
  const h = harness();
  h.queue.push(() => new Promise((resolve) => { release = () => resolve(ok(V1)); }));
  h.poller.start();
  h.poller.resume(); h.poller.online(); h.poller.retry();
  assert.equal(h.log.fetches, 1, "start, focus, network and retry share the one request in flight");
  release();
  await h.settle();
  h.advance(29_000); h.poller.resume(); await h.settle();
  assert.equal(h.log.fetches, 1);
  h.advance(2_000); h.poller.resume(); await h.settle();
  assert.equal(h.log.fetches, 2);
});

test("network return resets the delay and polls at once; retry polls at once", async () => {
  const h = harness();
  h.queue.push({ kind: "error" }, { kind: "error" }, ok(V1), ok(V1));
  h.poller.start(); await h.settle();
  h.fire(120_000); await h.settle();
  assert.deepEqual(h.scheduled(), [240_000]);
  h.poller.online(); await h.settle();
  assert.equal(h.log.fetches, 3);
  assert.deepEqual(h.scheduled(), [60_000]);
  h.poller.retry(); await h.settle();
  assert.equal(h.log.fetches, 4);
});

test("a different server release stops the page: no state applied, no timer, no further request", async () => {
  const h = harness();
  const marks = [];
  const stale = harness({ onRelease: (release) => { marks.push(release); if (release !== REV) stale.setStale(true); } });
  stale.queue.push(ok(V1, 1, REV), ok(V2, 5, "d".repeat(40)), ok(V2, 5, "d".repeat(40)));
  stale.poller.start(); await stale.settle();
  stale.fire(60_000); await stale.settle();
  assert.deepEqual(marks, [REV, "d".repeat(40)]);
  assert.equal(stale.log.states.length, 1, "the answer from the new build is not applied");
  assert.equal(stale.log.changes, 0);
  assert.deepEqual(stale.scheduled(), [], "polling is over");
  stale.poller.resume(); stale.poller.online(); stale.poller.retry(); await stale.settle();
  assert.equal(stale.log.fetches, 2, "nothing more is asked of the new build");
  void h;
});

test("stop aborts the request in flight, ignores its answer and clears every timer", async () => {
  let seenSignal;
  const h = harness();
  h.queue.push((signal) => { seenSignal = signal; return new Promise(() => {}); });
  h.poller.start();
  assert.equal(h.timers.size, 1, "only the request guard while the request is out");
  h.poller.stop();
  assert.equal(seenSignal.aborted, true);
  assert.equal(h.timers.size, 0);
  h.poller.resume(); h.poller.online(); h.poller.retry();
  assert.equal(h.log.fetches, 1, "a stopped poller stays stopped");
});

test("a request with no answer for 20 s is aborted and counts as a failure", async () => {
  const h = harness();
  h.queue.push((signal) => new Promise((resolve) => { signal.addEventListener("abort", () => resolve({ kind: "error" })); }));
  h.poller.start();
  assert.deepEqual([...h.timers.values()].map((timer) => timer.delay), [poll.REQUEST_TIMEOUT_MS]);
  h.fire(poll.REQUEST_TIMEOUT_MS);
  await h.settle();
  assert.deepEqual(h.log.failures, ["error"]);
  assert.deepEqual(h.scheduled(), [120_000], "and the next poll waits twice as long");
  h.queue.push(ok(V1));
  h.fire(120_000); await h.settle();
  assert.equal(h.log.states.length, 1, "the poller is not stuck");
});

test("a thrown fetch is a failure, not a crash", async () => {
  const h = harness();
  h.queue.push(() => Promise.reject(new Error("boom")));
  h.poller.start(); await h.settle();
  assert.deepEqual(h.log.failures, ["error"]);
  assert.deepEqual(h.scheduled(), [120_000]);
});

test("start without immediate waits one minute for the first poll", async () => {
  const h = harness();
  h.poller.start({ immediate: false });
  assert.equal(h.log.fetches, 0);
  assert.deepEqual(h.scheduled(), [60_000]);
});

test("an idle hour is one request a minute: 60 requests and no page re-render", async () => {
  const h = harness();
  h.poller.start(); await h.settle();
  for (let minute = 1; minute <= 59; minute += 1) { h.advance(60_000); h.fire(60_000); await h.settle(); }
  assert.equal(h.log.fetches, 60, "one request per minute for an hour (plus the entry read), one RPC each");
  assert.equal(h.log.changes, 0, "an idle hour changes nothing: no page re-render");
});

test("portal sections: the pages whose data is compared, the rest only count", () => {
  const cases = {
    "/portal/home": "home", "/portal": "admission", "/portal/documents": "documents", "/portal/payments": "payments",
    "/portal/messages": "messages", "/portal/notifications": "notifications", "/portal/notifications/7c1b0f3e-91a2-4d0b-8a55-0123456789ab": "notifications",
    "/portal/universities": null, "/portal/profile": null, "/portal/csca": null, "/portal/english/review": null,
  };
  for (const [path, expected] of Object.entries(cases)) assert.equal(sections.portalPollSectionForPath(path), expected, path);
  assert.equal(sections.portalPollUrl(null), "/api/portal/updates");
  assert.equal(sections.portalPollUrl("home"), "/api/portal/updates?s=home");
  for (const value of sections.PORTAL_POLL_SECTIONS) assert.equal(sections.isPortalPollSection(value), true);
  for (const value of ["", "HOME", "all", null, undefined, 3, "home,documents"]) assert.equal(sections.isPortalPollSection(value), false);
});
