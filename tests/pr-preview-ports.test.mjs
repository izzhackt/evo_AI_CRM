import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import test from "node:test";

import { diagnoseBusyPorts, describePortHolders, parseLsof, parseProcNetTcp, parseSs } from "../scripts/ci/pr-preview-port-holders.mjs";
import {
  EPHEMERAL_RANGE_FILE, PORT_CHECK_ATTEMPTS, PORT_CHECK_PAUSE_MS, assertPortsFree, describePortBlock, readEphemeralRange,
} from "../scripts/ci/pr-preview-ports.mjs";

// The preview checks its fixed port block (18440-18451) before `supabase start`. The block used to be 46440-46451, INSIDE the
// Linux ephemeral range (32768-60999): an outgoing connection of the runner, and the 60 s TIME_WAIT it leaves behind, can hold
// a port of that range, and bind() on it fails. Since 22.11.2026, 6 of 183 Preview runs failed, all on an even port of that block
// (25.11.2026): 5 times the port check (PORT_BUSY db:46442 twice, pop3:46446, shadow:46440, inspector:46448) and once Docker itself,
// 34 s after a passing check and the image pulls ("failed to bind host port 0.0.0.0:46442/tcp: address already in use"). The retry
// of #1584 (6 attempts, 5 s apart) saved none of the 26 runs that had it and cannot help the Docker case. The block now lies
// below the range (the guard below), the retry stays as a second line of defence, and a port that is still busy after the last
// attempt is explained in the log (what holds it, never a command line) before the unchanged PORT_BUSY message.
// These tests hold real loopback listeners on ports the OS hands out (never the fixed block) and replace the pause with a
// recorder, so they run in milliseconds and cannot collide with a real preview. The command-line tools (ss, lsof, /proc) are
// replaced with canned output, except one smoke test that looks at a live listener of this very process.
const HOST = "127.0.0.1";
const NAMES = ["shadow", "api", "db", "studio", "mail", "smtp", "pop3", "analytics", "inspector", "pooler", "app", "tls"];
const blockAt = (base) => Object.fromEntries(NAMES.map((name, offset) => [name, base + offset]));
const EPHEMERAL = { low: 32768, high: 60999 }; // the Linux default of ip_local_port_range

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
  assert.match(code, /^import \{ assertPortsFree, describePortBlock, readEphemeralRange \} from "\.\/pr-preview-ports\.mjs";$/mu);
  assert.match(code, /^import \{ diagnoseBusyPorts \} from "\.\/pr-preview-port-holders\.mjs";$/mu);
  // Its own stale stand goes first (otherwise it would count as a foreign process), then the journal line about the block, then every
  // port on all interfaces (with the holder diagnosis on failure), then `supabase start`.
  assert.match(code, /stopSupabase\(\);\s*log\(describePortBlock\(PORTS, readEphemeralRange\(\)\)\);\s*await assertPortsFree\(PORTS, \{ host: "0\.0\.0\.0", log, diagnose: diagnoseBusyPorts \}\);\s*const statusEnv = await phase\("Supabase: запуск стенда/u);
  // No second, single-shot probe next to it.
  assert.doesNotMatch(code, /\bportFree\b/u);
});

test("the preview block keeps its names and offsets and lies below the Linux ephemeral range, clear of the other local stacks", () => {
  const source = readFileSync(new URL("../scripts/ci/pr-preview.mjs", import.meta.url), "utf8");
  const code = source.split("\n").filter((line) => !/^\s*\/\//u.test(line)).join("\n");
  const base = Number(/export const BASE_PORT = (\d+);/u.exec(code)?.[1]);
  assert.ok(Number.isInteger(base), "BASE_PORT is a plain number");
  // The names and their order are the structure of the block: the config.toml replacements and the status check use them.
  const declared = /export const PORTS = \{([\s\S]*?)\};/u.exec(code)?.[1] ?? "";
  const offsets = Object.fromEntries([...declared.matchAll(/(\w+): BASE_PORT(?: \+ (\d+))?/gu)].map((match) => [match[1], Number(match[2] ?? 0)]));
  assert.deepEqual(offsets, Object.fromEntries(NAMES.map((name, offset) => [name, offset])));
  for (const port of Object.values(offsets).map((offset) => base + offset)) {
    // 32768 is where the kernel starts handing ports to outgoing connections; below 1024 needs root.
    assert.ok(port >= 1024 && port < EPHEMERAL.low, `${port} must lie in 1024-${EPHEMERAL.low - 1}, below the Linux ephemeral range`);
    assert.ok(!(port >= 45420 && port <= 45429), `${port} is in the E4/E5 and local test stack block 45420-45429`);
    assert.ok(!(port >= 46420 && port <= 46430), `${port} is in the mobile dev stack block 46420-46430`);
    assert.ok(![3000, 3100].includes(port), `${port} is a dev server port`);
  }
});

test("the journal line says where the block lies: below the ephemeral range, inside it (a warning that names the ports), or range unknown", () => {
  assert.equal(
    describePortBlock(blockAt(18440), EPHEMERAL),
    "порты стенда 18440-18451 (12 шт.) вне эфемерного диапазона ОС 32768-60999: исходящие соединения раннера их не занимают",
  );
  // The old block, 46440-46451, is what this line must warn about.
  assert.match(
    describePortBlock(blockAt(46440), EPHEMERAL),
    /^ВНИМАНИЕ: порты стенда 46440-46451 \(12 шт\.\) пересекаются с эфемерным диапазоном ОС 32768-60999 \(shadow:46440, api:46441, .*, tls:46451\): /u,
  );
  assert.match(describePortBlock({ a: 100, b: 40000 }, EPHEMERAL), /\(b:40000\)/u);
  assert.equal(describePortBlock(blockAt(18440), null), "порты стенда 18440-18451 (12 шт.); эфемерный диапазон ОС не определён");
});

test("the ephemeral range is read from the kernel file, and every odd answer becomes null", (t) => {
  assert.deepEqual(readEphemeralRange(() => "32768\t60999\n"), EPHEMERAL);
  assert.deepEqual(readEphemeralRange(() => "1024 65535"), { low: 1024, high: 65535 });
  for (const odd of ["", "32768", "60999 32768", "a b", "1 2 3", "0 70000", null, undefined]) assert.equal(readEphemeralRange(() => odd), null, String(odd));
  assert.equal(readEphemeralRange(() => { throw new Error("ENOENT"); }), null);
  if (!existsSync(EPHEMERAL_RANGE_FILE)) return t.skip("no /proc/sys/net/ipv4/ip_local_port_range here (not Linux)");
  const real = readEphemeralRange();
  assert.ok(real && real.low <= real.high, "the real file is readable on Linux");
});

test("the final sweep probes every port once on the same host, and its diagnosis goes to the log before the unchanged PORT_BUSY", async () => {
  const busyPorts = new Set([2, 3]);
  const probes = [];
  const isFree = async (port, host) => { probes.push([port, host]); return !busyPorts.has(port); };
  const received = [];
  const diagnose = async (busy) => { received.push(busy); return ["первая строка", "вторая строка"]; };
  const clock = recorder();
  await assert.rejects(
    assertPortsFree({ a: 1, b: 2, c: 3 }, { host: HOST, isFree, sleep: clock.sleep, log: clock.log, diagnose }),
    { message: "PORT_BUSY b:2 занят чужим процессом" },
  );
  assert.deepEqual(received, [[{ name: "b", port: 2 }, { name: "c", port: 3 }]]);
  // Six attempts stop at b (it stays busy); then one sweep over all three ports.
  assert.deepEqual(probes.slice(-3), [[1, HOST], [2, HOST], [3, HOST]]);
  assert.equal(clock.pauses.length, 5);
  assert.deepEqual(clock.lines.slice(0, 5), [1, 2, 3, 4, 5].map((n) => `порт b:2 занят, попытка ${n}/6, повтор через 5 с`));
  assert.deepEqual(clock.lines.slice(5), ["после 6 попыток заняты: b:2, c:3", "первая строка", "вторая строка"]);
});

test("the diagnosis is for a port that stays busy only: not asked when ports are free, or free up in time", async () => {
  let asked = 0;
  const diagnose = async () => { asked += 1; return ["не должно появиться"]; };
  const [free] = await freePorts(1);
  const clock = recorder();
  await assertPortsFree({ free }, { host: HOST, sleep: clock.sleep, log: clock.log, diagnose });
  let probes = 0;
  await assertPortsFree({ a: 1 }, { isFree: async () => (probes += 1) >= 3, sleep: clock.sleep, log: clock.log, diagnose });
  assert.equal(asked, 0);
  assert.ok(!clock.lines.some((line) => line.includes("не должно появиться")));
});

test("a failing diagnosis or a failing log never replaces PORT_BUSY; the failure is one short line", async () => {
  const message = "PORT_BUSY a:1 занят чужим процессом";
  for (const diagnose of [() => { throw new Error("взрыв"); }, async () => { throw new Error("отказ"); }, () => undefined, () => null]) {
    await assert.rejects(assertPortsFree({ a: 1 }, { isFree: async () => false, sleep: async () => {}, diagnose }), { message });
  }
  const clock = recorder();
  await assert.rejects(
    assertPortsFree({ a: 1 }, { isFree: async () => false, sleep: clock.sleep, log: clock.log, diagnose: () => { throw new Error("взрыв\nвторая строка с подробностями"); } }),
    { message },
  );
  assert.equal(clock.lines.at(-1), "диагностика занятых портов не удалась: взрыв");
  // A log that stops working while the diagnosis is written (the retry lines are already out) changes nothing.
  let written = 0;
  await assert.rejects(
    assertPortsFree({ a: 1 }, { isFree: async () => false, sleep: async () => {}, log: () => { if ((written += 1) > 5) throw new Error("журнал закрыт"); }, diagnose: () => ["x"] }),
    { message },
  );
  // A sweep whose probe fails is also only a log matter.
  let probe = 0;
  await assert.rejects(
    assertPortsFree({ a: 1 }, { isFree: async () => { if ((probe += 1) > 6) throw new Error("зонд упал"); return false; }, sleep: async () => {}, diagnose: () => ["x"] }),
    { message },
  );
});

/** An environment with canned answers: commands by "binary args", files by path. Records what was run and what was read. */
function fakeEnvironment({ commands = {}, files = {}, dirs = {}, links = {} } = {}) {
  const ran = [];
  const read = [];
  return {
    ran,
    read,
    run(binary, args) { const key = [binary, ...args].join(" "); ran.push(key); return key in commands ? commands[key] : null; },
    readText(path) { read.push(path); return files[path] ?? null; },
    listDir(path) { return dirs[path] ?? []; },
    readLink(path) { return links[path] ?? null; },
  };
}
const answer = (stdout, status = 0) => ({ status, stdout });

const SS_OUTPUT = [
  "State     Recv-Q Send-Q Local Address:Port Peer Address:Port Process",
  'LISTEN    0      4096         0.0.0.0:18442      0.0.0.0:*     users:(("docker-proxy",pid=4321,fd=7))',
  'ESTAB     0      0          10.1.0.30:18442 140.82.112.4:443   users:(("node",pid=2345,fd=21),("node",pid=2346,fd=21))',
  "TIME-WAIT 0      0          10.1.0.30:18442   20.60.1.2:443",
  "",
].join("\n");

test("ss output is parsed into state, addresses and the owners named in users:(...); the header and blank lines are skipped", () => {
  assert.deepEqual(parseSs(SS_OUTPUT), [
    { state: "LISTEN", local: "0.0.0.0:18442", peer: "0.0.0.0:*", owners: [{ name: "docker-proxy", pid: 4321 }] },
    { state: "ESTAB", local: "10.1.0.30:18442", peer: "140.82.112.4:443", owners: [{ name: "node", pid: 2345 }, { name: "node", pid: 2346 }] },
    { state: "TIME-WAIT", local: "10.1.0.30:18442", peer: "20.60.1.2:443", owners: [] },
  ]);
  assert.deepEqual(parseSs(""), []);
  assert.deepEqual(parseSs(null), []);
  // A process name is cut to safe characters: whatever a process calls itself cannot inject a line or markup.
  assert.equal(parseSs('LISTEN 0 1 0.0.0.0:1 0.0.0.0:* users:(("a b\\x1b[0m<x>",pid=9,fd=1))')[0].owners[0].name, "a?b?x1b?0m?x?");
});

test("holders via ss: name and pid, state and addresses; a closed connection is TIME-WAIT without a process", () => {
  const env = fakeEnvironment({ commands: { "ss -tanpH sport = :18442": answer(SS_OUTPUT) } });
  assert.deepEqual(describePortHolders(18442, env), [
    "порт 18442: LISTEN 0.0.0.0:18442 -> 0.0.0.0:*; docker-proxy (pid 4321) [ss]",
    "порт 18442: ESTAB 10.1.0.30:18442 -> 140.82.112.4:443; node (pid 2345), node (pid 2346) [ss]",
    "порт 18442: TIME-WAIT 10.1.0.30:18442 -> 20.60.1.2:443; без процесса: закрытое соединение ждёт до 60 с (TIME-WAIT) [ss]",
  ]);
  assert.deepEqual(env.ran, ["ss -tanpH sport = :18442"], "every process was visible: no sudo");
});

test("holders via ss: a socket whose process is hidden is retried once with sudo -n; without sudo the line says so", () => {
  const hidden = "LISTEN 0 4096 0.0.0.0:18442 0.0.0.0:*\n";
  const shown = 'LISTEN 0 4096 0.0.0.0:18442 0.0.0.0:* users:(("docker-proxy",pid=77,fd=4))\n';
  const withSudo = fakeEnvironment({ commands: { "ss -tanpH sport = :18442": answer(hidden), "sudo -n ss -tanpH sport = :18442": answer(shown) } });
  assert.deepEqual(describePortHolders(18442, withSudo), ["порт 18442: LISTEN 0.0.0.0:18442 -> 0.0.0.0:*; docker-proxy (pid 77) [ss]"]);
  const withoutSudo = fakeEnvironment({ commands: { "ss -tanpH sport = :18442": answer(hidden), "sudo -n ss -tanpH sport = :18442": answer("sudo: a password is required", 1) } });
  assert.deepEqual(describePortHolders(18442, withoutSudo), ["порт 18442: LISTEN 0.0.0.0:18442 -> 0.0.0.0:*; процесс не виден [ss]"]);
  assert.deepEqual(withoutSudo.ran, ["ss -tanpH sport = :18442", "sudo -n ss -tanpH sport = :18442"]);
  // TIME-WAIT never has a process: no point in sudo.
  const waiting = fakeEnvironment({ commands: { "ss -tanpH sport = :18442": answer("TIME-WAIT 0 0 10.1.0.30:18442 20.60.1.2:443\n") } });
  describePortHolders(18442, waiting);
  assert.deepEqual(waiting.ran, ["ss -tanpH sport = :18442"]);
});

// Real output of `lsof -nP -iTCP:51562 -FpcnT` on macOS: a listener and both ends of one connection to it.
const LSOF_OUTPUT = [
  "p91812", "cnode", "f12", "n127.0.0.1:51562", "TST=LISTEN", "TQR=0", "TQS=0",
  "f13", "n127.0.0.1:51563->127.0.0.1:51562", "TST=ESTABLISHED", "TQR=0", "TQS=0",
  "f14", "n127.0.0.1:51562->127.0.0.1:51563", "TST=ESTABLISHED", "TQR=0", "TQS=0", "",
].join("\n");

test("holders via lsof when ss is missing: only sockets that have the port as their local port", () => {
  assert.equal(parseLsof(LSOF_OUTPUT).length, 3);
  const env = fakeEnvironment({ commands: { "lsof -nP -iTCP:51562 -FpcnT": answer(LSOF_OUTPUT) } });
  assert.deepEqual(describePortHolders(51562, env), [
    "порт 51562: LISTEN 127.0.0.1:51562 -> *; node (pid 91812) [lsof]",
    "порт 51562: ESTABLISHED 127.0.0.1:51562 -> 127.0.0.1:51563; node (pid 91812) [lsof]",
  ]);
  assert.deepEqual(env.ran, ["ss -tanpH sport = :51562", "lsof -nP -iTCP:51562 -FpcnT"]);
  // lsof exits with 1 when nobody has the port: that is an answer, not a missing tool.
  const nobody = fakeEnvironment({ commands: { "lsof -nP -iTCP:51562 -FpcnT": answer("", 1) } });
  assert.deepEqual(describePortHolders(51562, nobody), ["порт 51562: lsof не видит сокетов на этом порту (освободился к проверке?)"]);
});

const PROC_TCP = [
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
  "   0: 00000000:480A 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 31337 1 0000000000000000 100 0 0 10 0",
  "   1: 0A01001E:B56A 04704C14:01BB 06 00000000:00000000 03:00000B2C 00000000     0        0 0 3 0000000000000000",
  "   2: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 99999 1 0000000000000000 100 0 0 10 0",
  "",
].join("\n");
const PROC_TCP6 = [
  "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
  "   0: 00000000000000000000000000000000:480A 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 31338 1 0000000000000000 100 0 0 10 0",
  "   1: 0000000000000000FFFF00000100007F:480A 0000000000000000FFFF00000100007F:C350 01 00000000:00000000 00:00000000 00000000  1001        0 31339 1 0000000000000000 100 0 0 10 0",
  "   2: 00000000000000000000000001000000:480A 00000000000000000000000001000000:C351 01 00000000:00000000 00:00000000 00000000  1001        0 31340 1 0000000000000000 100 0 0 10 0",
  "",
].join("\n");

test("/proc/net/tcp is parsed by local port: states, addresses (little-endian words), inode", () => {
  assert.deepEqual(parseProcNetTcp(PROC_TCP, 18442, 4), [{ state: "LISTEN", local: "0.0.0.0:18442", peer: "0.0.0.0:0", inode: 31337, owners: [] }]);
  assert.deepEqual(parseProcNetTcp(PROC_TCP, 46442, 4), [{ state: "TIME-WAIT", local: "30.0.1.10:46442", peer: "20.76.112.4:443", inode: 0, owners: [] }]);
  assert.deepEqual(parseProcNetTcp(PROC_TCP6, 18442, 6).map(({ state, local, peer }) => [state, local, peer]), [
    ["LISTEN", "[::]:18442", "[::]:0"],
    ["ESTAB", "[::ffff:127.0.0.1]:18442", "[::ffff:127.0.0.1]:50000"],
    ["ESTAB", "[::1]:18442", "[::1]:50001"],
  ]);
  assert.deepEqual(parseProcNetTcp(PROC_TCP, 1, 4), []);
  assert.deepEqual(parseProcNetTcp(null, 1, 4), []);
});

test("holders via /proc/net/tcp when neither ss nor lsof exist: name and pid from the socket inode, never a command line", () => {
  const env = fakeEnvironment({
    files: {
      "/proc/net/tcp": PROC_TCP, "/proc/net/tcp6": PROC_TCP6, "/proc/4242/comm": "docker-proxy\n", "/proc/4243/comm": "node\n",
      // Bait: if the diagnosis ever read these, the secret would reach the log.
      "/proc/4242/cmdline": "docker-proxy -host-port 18442 --token=SECRET-TOKEN", "/proc/4242/environ": "GITHUB_TOKEN=SECRET-TOKEN",
    },
    dirs: { "/proc": ["1", "4242", "4243", "self", "net"], "/proc/1/fd": [], "/proc/4242/fd": ["0", "7"], "/proc/4243/fd": ["3", "9"] },
    links: { "/proc/4242/fd/0": "/dev/null", "/proc/4242/fd/7": "socket:[31337]", "/proc/4243/fd/3": "socket:[555]", "/proc/4243/fd/9": "socket:[31338]" },
  });
  const lines = describePortHolders(18442, env);
  assert.deepEqual(lines.slice(0, 2), [
    "порт 18442: LISTEN 0.0.0.0:18442 -> 0.0.0.0:0; docker-proxy (pid 4242) [/proc/net/tcp]",
    "порт 18442: LISTEN [::]:18442 -> [::]:0; node (pid 4243) [/proc/net/tcp]",
  ]);
  assert.equal(lines.length, 4, "the two v6 connections of the sample have no visible owner");
  assert.match(lines[2], /ESTAB \[::ffff:127\.0\.0\.1\]:18442 -> \[::ffff:127\.0\.0\.1\]:50000; процесс не виден/u);
  assert.deepEqual(describePortHolders(46442, env), ["порт 46442: TIME-WAIT 30.0.1.10:46442 -> 20.76.112.4:443; без процесса: закрытое соединение ждёт до 60 с (TIME-WAIT) [/proc/net/tcp]"]);
  assert.ok(env.read.every((path) => !/cmdline|environ/u.test(path)), `read: ${env.read.join(", ")}`);
  assert.ok(!lines.join("\n").includes("SECRET-TOKEN"));
});

test("nothing to look with: one honest line; an environment that throws never throws out of the diagnosis", () => {
  assert.deepEqual(describePortHolders(18442, fakeEnvironment()), ["порт 18442: выяснить нечем (нет ни ss, ни lsof, ни /proc/net/tcp)"]);
  const throwing = () => { throw new Error("запуск не удался\nстек вызовов"); };
  const broken = { run: throwing, readText: throwing, listDir: throwing, readLink: throwing };
  assert.deepEqual(describePortHolders(18442, broken), ["порт 18442: диагностика недоступна (запуск не удался)"]);
  assert.ok(diagnoseBusyPorts([{ name: "db", port: 18442 }], broken).every((line) => typeof line === "string"));
});

test("diagnoseBusyPorts: the ephemeral range, socket counts by state, then each busy port (at most four)", () => {
  const states = [
    "ESTAB 0 0 10.1.0.30:45678 140.82.112.4:443", "TIME-WAIT 0 0 10.1.0.30:45680 20.60.1.2:443", "TIME-WAIT 0 0 10.1.0.30:45682 20.60.1.2:443",
    "TIME-WAIT 0 0 10.1.0.30:45684 20.60.1.2:443", "LISTEN 0 4096 127.0.0.53:53 0.0.0.0:*", "",
  ].join("\n");
  const commands = { "ss -tanH": answer(states) };
  for (let port = 18442; port < 18448; port += 1) commands[`ss -tanpH sport = :${port}`] = answer(`TIME-WAIT 0 0 10.1.0.30:${port} 20.60.1.2:443\n`);
  const env = fakeEnvironment({ commands, files: { [EPHEMERAL_RANGE_FILE]: "32768\t60999\n", "/proc/sys/net/ipv4/ip_local_reserved_ports": "8080,9148\n" } });
  const busy = [18442, 18443, 18444, 18445, 18446, 18447].map((port, index) => ({ name: NAMES[index + 2], port }));
  const lines = diagnoseBusyPorts(busy, env);
  assert.deepEqual(lines.slice(0, 2), ["эфемерный диапазон ОС: 32768-60999; зарезервировано: 8080,9148", "сокеты TCP по состояниям: TIME-WAIT 3, ESTAB 1, LISTEN 1"]);
  assert.equal(lines[2], "порт 18442: TIME-WAIT 10.1.0.30:18442 -> 20.60.1.2:443; без процесса: закрытое соединение ждёт до 60 с (TIME-WAIT) [ss]");
  assert.equal(lines.filter((line) => line.startsWith("порт ")).length, 4);
  assert.equal(lines.at(-1), "ещё занятых портов: 2");
  // Without any tool: the range is unknown, the socket-count line is left out, and the port line says why.
  assert.deepEqual(diagnoseBusyPorts([{ name: "db", port: 18442 }], fakeEnvironment()), [
    "эфемерный диапазон ОС: не определён", "порт 18442: выяснить нечем (нет ни ss, ни lsof, ни /proc/net/tcp)",
  ]);
});

test("the holder diagnosis never reads command lines or environments of other processes", () => {
  const source = readFileSync(new URL("../scripts/ci/pr-preview-port-holders.mjs", import.meta.url), "utf8");
  const code = source.split("\n").filter((line) => !/^\s*\/\//u.test(line)).join("\n");
  // No `ps`, no /proc/<pid>/cmdline|environ|exe, no process arguments, and the child gets nothing but PATH and LC_ALL.
  assert.doesNotMatch(code, /cmdline|environ|\/exe\b|"ps"|process\.argv|process\.env\.(?!PATH\b)/u);
  assert.match(code, /env: \{ PATH: path, LC_ALL: "C" \}/u);
});

test("with the real tools: a live listener of this very process is found by name and pid (skipped where nothing can look)", async (t) => {
  const holder = await hold();
  t.after(() => holder.release());
  const lines = describePortHolders(holder.port);
  if (lines.some((line) => line.includes("выяснить нечем"))) return t.skip("neither ss, lsof nor /proc/net/tcp is available here");
  assert.ok(lines.some((line) => line.includes("LISTEN") && line.includes(`(pid ${process.pid})`)), lines.join("\n"));
  assert.ok(!lines.some((line) => line.includes("диагностика недоступна")), lines.join("\n"));
  // The same through the full chain: a real busy port, the real check, the real diagnosis, the unchanged error.
  const clock = recorder();
  await assert.rejects(
    assertPortsFree({ db: holder.port }, { host: HOST, sleep: clock.sleep, log: clock.log, diagnose: diagnoseBusyPorts }),
    { message: `PORT_BUSY db:${holder.port} занят чужим процессом` },
  );
  assert.equal(clock.lines[5], `после 6 попыток заняты: db:${holder.port}`);
  assert.ok(clock.lines.some((line) => line.includes(`порт ${holder.port}: LISTEN`) && line.includes(`(pid ${process.pid})`)), clock.lines.join("\n"));
});
