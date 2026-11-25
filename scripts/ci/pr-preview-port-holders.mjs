// Что держит порт: `ss`, затем `lsof`, затем /proc/net/tcp. Только для журнала при PORT_BUSY (pr-preview-ports.mjs,
// тесты в tests/pr-preview-ports.test.mjs). Диагностика не должна ронять и подменять проверку: любой сбой становится строкой
// «недоступно», наружу ничего не бросается.
//
// Секреты: командные строки и окружение процессов раннера могут содержать токены, поэтому здесь они не читаются и не печатаются
// (нет ни `ps`, ни /proc/<pid>/cmdline, ни environ). В журнал идут состояние сокета, адреса, имя процесса (comm) и PID.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

import { readEphemeralRange } from "./pr-preview-ports.mjs";

const TOOL_TIMEOUT_MS = 5000;
const MAX_PORTS = 4; // сколько занятых портов разбирать
const MAX_ENTRIES_PER_PORT = 8; // сколько сокетов печатать на порт

/** Состояния /proc/net/tcp (шестнадцатеричный код) в написании `ss`. */
const PROC_STATES = {
  "01": "ESTAB", "02": "SYN-SENT", "03": "SYN-RECV", "04": "FIN-WAIT-1", "05": "FIN-WAIT-2", "06": "TIME-WAIT",
  "07": "CLOSE", "08": "CLOSE-WAIT", "09": "LAST-ACK", "0A": "LISTEN", "0B": "CLOSING", "0C": "NEW-SYN-RECV",
};

/** Реальное окружение; в тестах подменяется целиком. Ничего из этого не бросает. */
export const realEnvironment = {
  /** Запуск без оболочки и без окружения процесса (только PATH): { status, stdout } или null, если запустить не удалось. */
  run(binary, args) {
    try {
      const path = [process.env.PATH, "/usr/sbin", "/sbin", "/usr/bin", "/bin"].filter(Boolean).join(":"); // без пустого элемента: он означал бы текущий каталог
      const result = spawnSync(binary, args, {
        encoding: "utf8", timeout: TOOL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
        env: { PATH: path, LC_ALL: "C" },
      });
      return result.error || result.status === null ? null : { status: result.status, stdout: result.stdout ?? "" };
    } catch { return null; }
  },
  readText(path) { try { return readFileSync(path, "utf8"); } catch { return null; } },
  listDir(path) { try { return readdirSync(path); } catch { return []; } },
  readLink(path) { try { return readlinkSync(path); } catch { return null; } },
};

const shortError = (error) => String(error?.message ?? error).split("\n")[0].slice(0, 160);
const clip = (text, limit = 64) => String(text).slice(0, limit);
/** Имя процесса только из безопасных символов: comm не бывает длиннее 15, лишнее отрезается. */
const safeName = (name) => String(name).replace(/[^A-Za-z0-9._+:@-]/gu, "?").slice(0, 32) || "?";

/**
 * Вывод `ss -tanpH`: [{ state, local, peer, owners: [{ name, pid }] }]. Процессы берутся только из `users:(("имя",pid=N,fd=M))`.
 * Строки, не похожие на сокет (шапка, пустые), пропускаются.
 */
export function parseSs(text) {
  const entries = [];
  for (const raw of String(text ?? "").split("\n")) {
    const columns = raw.trim().split(/\s+/u);
    if (columns.length < 5 || !/^[A-Z][A-Z0-9_-]*$/u.test(columns[0])) continue;
    const owners = [...raw.matchAll(/\("([^"]*)",pid=(\d+)/gu)].map((m) => ({ name: safeName(m[1]), pid: Number(m[2]) }));
    entries.push({ state: columns[0], local: clip(columns[3]), peer: clip(columns[4]), owners });
  }
  return entries;
}

/** Вывод `lsof -FpcnT` (поля: p - PID, c - команда, n - адреса, T - состояние TCP): тот же вид записей, что у parseSs. */
export function parseLsof(text) {
  const entries = [];
  let owner = null;
  let entry = null;
  for (const raw of String(text ?? "").split("\n")) {
    const tag = raw.charAt(0);
    const value = raw.slice(1).trim();
    if (tag === "p") { owner = { name: "?", pid: Number(value) }; entry = null; }
    else if (tag === "c" && owner) owner.name = safeName(value);
    else if (tag === "f") entry = null;
    else if (tag === "n" && owner) {
      const [local, peer = "*"] = value.split("->");
      entry = { state: "?", local: clip(local), peer: clip(peer), owners: [{ name: owner.name, pid: owner.pid }] };
      entries.push(entry);
    } else if (tag === "T" && entry && value.startsWith("ST=")) entry.state = clip(value.slice(3), 24);
  }
  return entries;
}

/** Адрес из /proc/net/tcp(6): «0100007F:1F90» -> «127.0.0.1:8080». Слова адреса записаны в порядке хоста (little-endian). */
function decodeProcAddress(value, family) {
  const [address = "", hexPort = ""] = String(value).split(":");
  const port = Number.parseInt(hexPort, 16);
  const bytes = (address.match(/../gu) ?? []).map((pair) => Number.parseInt(pair, 16));
  const flat = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) flat.push(...bytes.slice(i, i + 4).reverse());
  if (family === 4) return `${flat.slice(0, 4).join(".")}:${port}`;
  if (flat.length === 16 && flat.every((byte) => byte === 0)) return `[::]:${port}`;
  if (flat.length === 16 && flat.slice(0, 15).every((byte) => byte === 0) && flat[15] === 1) return `[::1]:${port}`;
  if (flat.length === 16 && flat.slice(0, 10).every((byte) => byte === 0) && flat[10] === 255 && flat[11] === 255) {
    return `[::ffff:${flat.slice(12).join(".")}]:${port}`;
  }
  return `[ipv6]:${port}`;
}

/** /proc/net/tcp или tcp6: сокеты с локальным портом `port`: [{ state, local, peer, inode, owners: [] }]. */
export function parseProcNetTcp(text, port, family = 4) {
  const entries = [];
  for (const raw of String(text ?? "").split("\n").slice(1)) {
    const columns = raw.trim().split(/\s+/u);
    if (columns.length < 10 || Number.parseInt(columns[1].split(":")[1] ?? "", 16) !== port) continue;
    const code = columns[3].toUpperCase();
    entries.push({
      state: PROC_STATES[code] ?? `0x${code}`, local: decodeProcAddress(columns[1], family), peer: decodeProcAddress(columns[2], family),
      inode: Number(columns[9]), owners: [],
    });
  }
  return entries;
}

/** Кто держит сокеты с этими inode (только по /proc/<pid>/fd и /proc/<pid>/comm; чужие процессы без root не видны). */
function inodeOwners(inodes, env) {
  const wanted = new Set(inodes.filter((inode) => inode > 0));
  const owners = new Map();
  if (wanted.size === 0) return owners;
  for (const pid of env.listDir("/proc").filter((name) => /^\d+$/u.test(name))) {
    for (const fd of env.listDir(`/proc/${pid}/fd`)) {
      const match = /^socket:\[(\d+)\]$/u.exec(env.readLink(`/proc/${pid}/fd/${fd}`) ?? "");
      const inode = match ? Number(match[1]) : 0;
      if (!wanted.has(inode)) continue;
      const list = owners.get(inode) ?? [];
      if (!list.some((owner) => owner.pid === Number(pid))) list.push({ name: safeName((env.readText(`/proc/${pid}/comm`) ?? "?").trim()), pid: Number(pid) });
      owners.set(inode, list);
    }
  }
  return owners;
}

function viaSs(port, env) {
  const args = ["-tanpH", `sport = :${port}`];
  const plain = env.run("ss", args);
  if (!plain || plain.status !== 0) return null;
  let entries = parseSs(plain.stdout);
  // Процессы других пользователей (docker-proxy, агент раннера) без root не видны: один безопасный повтор через sudo -n (без пароля и вопросов).
  if (entries.some((entry) => entry.owners.length === 0 && entry.state !== "TIME-WAIT")) {
    const elevated = env.run("sudo", ["-n", "ss", ...args]);
    const better = elevated?.status === 0 ? parseSs(elevated.stdout) : [];
    if (better.length > 0) entries = better;
  }
  return { tool: "ss", entries };
}

function viaLsof(port, env) {
  const result = env.run("lsof", ["-nP", `-iTCP:${port}`, "-FpcnT"]);
  if (!result) return null;
  // -iTCP:PORT находит и сокеты, у которых порт только на другом конце (клиент, подключённый к занятому порту): держат порт лишь те, у кого он локальный.
  if (result.status === 0) return { tool: "lsof", entries: parseLsof(result.stdout).filter((entry) => entry.local.endsWith(`:${port}`)) };
  // lsof завершается с кодом 1, когда на порту никого нет.
  return result.status === 1 && result.stdout.trim() === "" ? { tool: "lsof", entries: [] } : null;
}

function viaProc(port, env) {
  const v4 = env.readText("/proc/net/tcp");
  const v6 = env.readText("/proc/net/tcp6");
  if (v4 === null && v6 === null) return null;
  const entries = [...parseProcNetTcp(v4, port, 4), ...parseProcNetTcp(v6, port, 6)];
  const owners = inodeOwners(entries.map((entry) => entry.inode), env);
  for (const entry of entries) entry.owners = owners.get(entry.inode) ?? [];
  return { tool: "/proc/net/tcp", entries };
}

function formatEntry({ state, local, peer, owners }) {
  let who = "процесс не виден";
  if (owners.length > 0) who = owners.map((owner) => `${owner.name} (pid ${owner.pid})`).join(", ");
  else if (state === "TIME-WAIT" || state === "TIME_WAIT") who = "без процесса: закрытое соединение ждёт до 60 с (TIME-WAIT)";
  return `${state} ${local} -> ${peer}; ${who}`;
}

/** Строки журнала о том, что держит порт `port`. Никогда не бросает. */
export function describePortHolders(port, env = realEnvironment) {
  try {
    const found = viaSs(port, env) ?? viaLsof(port, env) ?? viaProc(port, env);
    if (!found) return [`порт ${port}: выяснить нечем (нет ни ss, ни lsof, ни /proc/net/tcp)`];
    if (found.entries.length === 0) return [`порт ${port}: ${found.tool} не видит сокетов на этом порту (освободился к проверке?)`];
    const lines = found.entries.slice(0, MAX_ENTRIES_PER_PORT).map((entry) => `порт ${port}: ${formatEntry(entry)} [${found.tool}]`);
    if (found.entries.length > MAX_ENTRIES_PER_PORT) lines.push(`порт ${port}: и ещё ${found.entries.length - MAX_ENTRIES_PER_PORT} сокетов`);
    return lines;
  } catch (error) {
    return [`порт ${port}: диагностика недоступна (${shortError(error)})`];
  }
}

/** Сколько TCP-сокетов в каком состоянии: «TIME-WAIT 143, ESTAB 14, LISTEN 7». null, если выяснить нечем. */
function socketCounts(env) {
  const result = env.run("ss", ["-tanH"]);
  if (!result || result.status !== 0) return null;
  const counts = new Map();
  for (const entry of parseSs(result.stdout)) counts.set(entry.state, (counts.get(entry.state) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([state, count]) => `${state} ${count}`).join(", ") || "сокетов нет";
}

/** Строка журнала «сокеты TCP по состояниям: TIME-WAIT 143, ESTAB 14, LISTEN 7» или null (нет ss). Никогда не бросает. */
export function describeSocketStates(env = realEnvironment) {
  try {
    const counts = socketCounts(env);
    return counts === null ? null : `сокеты TCP по состояниям: ${counts}`;
  } catch { return null; }
}

/** Печатает describeSocketStates, если есть что печатать: сколько недавних соединений раннера может держать порты в момент проверки. */
export function logSocketStates(log, env = realEnvironment) {
  try {
    const line = describeSocketStates(env);
    if (line) log(line);
  } catch { /* только журнал */ }
}

/**
 * Для `assertPortsFree({ diagnose })`: `busy` - [{ name, port }]. Возвращает строки журнала: эфемерный диапазон ОС, сколько
 * TCP-сокетов в каком состоянии (для проверки догадки про TIME-WAIT) и по каждому занятому порту (не больше MAX_PORTS), чем он занят.
 */
export function diagnoseBusyPorts(busy, env = realEnvironment) {
  const lines = [];
  const section = (title, make) => {
    try { lines.push(...make()); } catch (error) { lines.push(`${title}: недоступно (${shortError(error)})`); }
  };
  section("эфемерный диапазон", () => {
    const range = readEphemeralRange((path) => env.readText(path));
    const reserved = (env.readText("/proc/sys/net/ipv4/ip_local_reserved_ports") ?? "").trim();
    return [`эфемерный диапазон ОС: ${range ? `${range.low}-${range.high}` : "не определён"}${reserved ? `; зарезервировано: ${reserved}` : ""}`];
  });
  section("сокеты TCP", () => [describeSocketStates(env)].filter(Boolean));
  for (const { name, port } of busy.slice(0, MAX_PORTS)) section(`порт ${name}:${port}`, () => describePortHolders(port, env));
  if (busy.length > MAX_PORTS) lines.push(`ещё занятых портов: ${busy.length - MAX_PORTS}`);
  return lines;
}
