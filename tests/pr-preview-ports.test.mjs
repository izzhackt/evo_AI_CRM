import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import test from "node:test";

import { PORT_CHECK_ATTEMPTS, PORT_CHECK_PAUSE_MS, assertPortsFree } from "../scripts/ci/pr-preview-ports.mjs";

// The preview checks its fixed port block (46440-46451) before `supabase start`. The block lies inside the Linux ephemeral
// range, so an outgoing connection of the runner can hold one port for a moment: on 25.11.2026 about 3 of 25 PR runs failed
// with PORT_BUSY and a rerun always passed. The check now repeats (6 attempts, 5 s apart) and fails with the unchanged
// message only when a port stays busy. These tests hold real loopback listeners on ports the OS hands out (never the
// fixed block) and replace the pause with a recorder, so they run in milliseconds and cannot collide with a real preview.
const HOST = "127.0.0.1";

/** A real listener on a port the OS hands out; `release()` frees the port again (safe to call twice). */
async function hold() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const { port } = server.address();
  let closing = null;
  return { port, release: () => (closing ??= new Promise((resolve) => server.close(() => resolve()))) };
}

/** `count` ports that are free right now: taken from the OS, then given back. */
async function freePorts(count) {
  const holders = await Promise.all(Array.from({ length: count }, () => hold()));
  await Promise.all(holders.map((holder) => holder.release()));
  return holders.map((holder) => holder.port);
}

/** Records the pauses and log lines instead of waiting; `onPause(n)` runs at the n-th pause (to release a port there). */
function recorder(onPause = async () => {}) {
  const pauses = [];
  const lines = [];
  return {
    pauses,
    lines,
    sleep: async (ms) => { pauses.push(ms); await onPause(pauses.length); },
    log: (line) => lines.push(line),
  };
}

test("all ports free: the check passes at once, without a pause or a log line", async () => {
  const [shadow, api, db] = await freePorts(3);
  const clock = recorder();
  await assertPortsFree({ shadow, api, db }, { host: HOST, sleep: clock.sleep, log: clock.log });
  assert.deepEqual(clock.pauses, []);
  assert.deepEqual(clock.lines, []);
});

test("a port held for a moment: the check is repeated and passes once the port is released", async (t) => {
  const [shadow, api] = await freePorts(2);
  const holder = await hold();
  t.after(() => holder.release());
  // The holder lets go during the second pause, so the third attempt finds every port free.
  const clock = recorder(async (n) => { if (n === 2) await holder.release(); });
  await assertPortsFree({ shadow, db: holder.port, api }, { host: HOST, sleep: clock.sleep, log: clock.log });
  assert.deepEqual(clock.pauses, [5000, 5000]);
  assert.deepEqual(clock.lines, [
    `порт db:${holder.port} занят, попытка 1/6, повтор через 5 с`,
    `порт db:${holder.port} занят, попытка 2/6, повтор через 5 с`,
    "порты свободны, попытка 3/6",
  ]);
});

test("a port held for good: fails with the unchanged PORT_BUSY message after the last attempt", async (t) => {
  const holder = await hold();
  t.after(() => holder.release());
  const clock = recorder();
  await assert.rejects(
    assertPortsFree({ db: holder.port }, { host: HOST, sleep: clock.sleep, log: clock.log }),
    { message: `PORT_BUSY db:${holder.port} занят чужим процессом` },
  );
  // 6 attempts and 5 pauses of 5 s: about 25 s of waiting in the real run, none here.
  assert.deepEqual(clock.pauses, [5000, 5000, 5000, 5000, 5000]);
  assert.deepEqual(clock.lines, [1, 2, 3, 4, 5].map((n) => `порт db:${holder.port} занят, попытка ${n}/6, повтор через 5 с`));
});

test("every attempt re-checks all ports from the first; the message names the first busy port of the last attempt", async () => {
  const probes = [];
  let attempt = 0;
  // Attempt 1: b is busy. Attempts 2-6: c is busy instead (a different collision each time); a and b are free.
  const isFree = async (port) => {
    probes.push(port);
    if (port === 1) attempt += 1;
    return !(port === 2 && attempt === 1) && !(port === 3 && attempt >= 2);
  };
  const clock = recorder();
  await assert.rejects(
    assertPortsFree({ a: 1, b: 2, c: 3 }, { isFree, sleep: clock.sleep, log: clock.log }),
    { message: "PORT_BUSY c:3 занят чужим процессом" },
  );
  assert.deepEqual(probes, [1, 2, ...Array.from({ length: 5 }, () => [1, 2, 3]).flat()]);
  assert.equal(clock.pauses.length, 5);
  assert.match(clock.lines[0], /^порт b:2 занят, попытка 1\/6/u);
  assert.match(clock.lines[4], /^порт c:3 занят, попытка 5\/6/u);
});

test("the defaults are 6 attempts, a 5 s pause (25 s in all) and a check on all interfaces", async () => {
  assert.equal(PORT_CHECK_ATTEMPTS, 6);
  assert.equal(PORT_CHECK_PAUSE_MS, 5000);
  const hosts = [];
  await assertPortsFree({ a: 1 }, { isFree: async (_port, host) => { hosts.push(host); return true; } });
  assert.deepEqual(hosts, ["0.0.0.0"]);
  const clock = recorder();
  await assert.rejects(assertPortsFree({ a: 1 }, { isFree: async () => false, sleep: clock.sleep }), { message: "PORT_BUSY a:1 занят чужим процессом" });
  assert.equal(clock.pauses.length * PORT_CHECK_PAUSE_MS, 25_000);
});

test("with the real timer a short hold is outlasted by short pauses", async (t) => {
  const holder = await hold();
  const timer = setTimeout(() => holder.release(), 40);
  t.after(async () => { clearTimeout(timer); await holder.release(); });
  // No injected pause: the default one (timers/promises) really waits, 10 ms at a time, up to 3 s; the hold lasts about 40 ms.
  await assertPortsFree({ db: holder.port }, { host: HOST, attempts: 300, pauseMs: 10 });
});

test("pr-preview.mjs checks its ports through the retrying helper, between stopping its own old stand and starting the new one", () => {
  const source = readFileSync(new URL("../scripts/ci/pr-preview.mjs", import.meta.url), "utf8");
  const code = source.split("\n").filter((line) => !/^\s*\/\//u.test(line)).join("\n");
  assert.match(code, /^import \{ assertPortsFree \} from "\.\/pr-preview-ports\.mjs";$/mu);
  // Its own stale stand goes first (otherwise it would count as a foreign process), then every port on all interfaces, then `supabase start`.
  assert.match(code, /stopSupabase\(\);\s*await assertPortsFree\(PORTS, \{ host: "0\.0\.0\.0", log \}\);\s*const statusEnv = await phase\("Supabase: запуск стенда/u);
  // No second, single-shot probe next to it.
  assert.doesNotMatch(code, /\bportFree\b/u);
});
