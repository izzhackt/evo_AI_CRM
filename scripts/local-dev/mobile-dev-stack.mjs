#!/usr/bin/env node
// Постоянный локальный стенд для мобильного приложения (mobile/): настоящие Auth + Postgres + Storage
// и настоящие маршруты Next.js-портала. Только синтетические данные; продакшн не затрагивается.
//
//   npm run mobile:stack:up       поднять (или переиспользовать) стенд и досеять недостающее
//   npm run mobile:stack:status   адреса, здоровье, логины (без паролей)
//   npm run mobile:stack:down     остановить и удалить ТОЛЬКО этот стенд
//
// Подробнее: docs/mobile/LOCAL_STACK.md
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { waitForLocalSupabaseAuthAdmin } from "./supabase-auth-readiness.mjs";
import { seedMobileDevStack } from "./mobile-dev-stack-seed.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Короткий фиксированный id: CLI обрезает длинные id в метках контейнеров, и `stop` тогда ничего не находит.
const PROJECT_ID = "evo-mobile-dev";
const STATE_DIR = process.env.EVO_MOBILE_STACK_HOME || join(homedir(), ".evo-mobile-dev-stack");
const PROJECT_DIR = join(STATE_DIR, "project");
const STATE_FILE = join(STATE_DIR, "state.json");
const APP_LOG = join(STATE_DIR, "portal.log");
const ACCOUNTS_FILE = join(STATE_DIR, "accounts.json");
const MOBILE_DIR = process.env.EVO_MOBILE_DIR || join(repo, "mobile");

// Фиксированный блок портов (рядом с 4542x репозитория, не пересекается с ним и с 3000/3100).
const BASE = 46420;
const PORTS = { shadow: BASE, api: BASE + 1, db: BASE + 2, studio: BASE + 3, mail: BASE + 4, smtp: BASE + 5, pop3: BASE + 6,
  analytics: BASE + 7, inspector: BASE + 8, pooler: BASE + 9, portal: BASE + 10 };

const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONFIG"].filter((n) => process.env[n]).map((n) => [n, process.env[n]]));
const npx = join(dirname(process.execPath), "npx");

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: repo, env, encoding: "utf8", ...options });
  if (result.status !== 0) {
    const error = new Error(`COMMAND_FAILED ${binary} ${args.slice(0, 3).join(" ")} (exit ${result.status})\n${(result.stdout ?? "") + (result.stderr ?? "")}`.slice(0, 4000));
    error.output = (result.stdout ?? "") + (result.stderr ?? "");
    throw error;
  }
  return result.stdout;
}
const supabase = (...args) => run(npx, ["--no-install", "supabase", ...args, "--workdir", PROJECT_DIR]);
const log = (msg) => console.log(`[mobile-stack] ${msg}`);

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return null; }
}
function writeJson(path, value, mode = 0o600) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode });
  chmodSync(path, mode);
}
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) if (item.family === "IPv4" && !item.internal) return item.address;
  }
  return null;
}
const portFree = (port, host) => new Promise((ok) => {
  const server = createServer();
  server.once("error", () => ok(false));
  server.listen(port, host, () => server.close(() => ok(true)));
});
const dockerNames = (kind) => {
  const format = kind === "containers" ? ["ps", "-a", "--format", "{{.Names}}"]
    : kind === "volumes" ? ["volume", "ls", "-q"] : ["network", "ls", "--format", "{{.Name}}"];
  return run("docker", format).split("\n").map((s) => s.trim()).filter((n) => n.endsWith(`_${PROJECT_ID}`));
};

function writeProjectConfig() {
  mkdirSync(join(PROJECT_DIR, "supabase"), { recursive: true });
  let config = readFileSync(join(repo, "supabase/config.toml"), "utf8");
  const origin = `http://127.0.0.1:${PORTS.portal}`;
  const replacements = [
    ['project_id = "evo-platform-local"', `project_id = "${PROJECT_ID}"`],
    ["port = 45421", `port = ${PORTS.api}`], ["port = 45422", `port = ${PORTS.db}`],
    ["shadow_port = 45420", `shadow_port = ${PORTS.shadow}`], ["port = 45423", `port = ${PORTS.studio}`],
    ["port = 45424", `port = ${PORTS.mail}`], ["smtp_port = 45425", `smtp_port = ${PORTS.smtp}`],
    ["pop3_port = 45426", `pop3_port = ${PORTS.pop3}`], ["inspector_port = 45428", `inspector_port = ${PORTS.inspector}`],
    ["port = 45427", `port = ${PORTS.analytics}`], ["port = 45429", `port = ${PORTS.pooler}`],
    ['site_url = "http://127.0.0.1:3000"', `site_url = "${origin}"`],
    ['additional_redirect_urls = ["http://127.0.0.1:3000/auth/callback"]', `additional_redirect_urls = ["${origin}/auth/callback"]`],
  ];
  for (const [before, after] of replacements) {
    assert.equal(config.split(before).length - 1, 1, `CONFIG_DRIFT: ${before}`);
    config = config.replace(before, after);
  }
  assert.doesNotMatch(config, /\[auth\.email\.smtp\]/, "EXTERNAL_SMTP_FORBIDDEN");
  writeFileSync(join(PROJECT_DIR, "supabase/config.toml"), config);
  // Копии (не симлинки): стенд не ломается, если рабочее дерево с кодом переедет.
  for (const dir of ["migrations", "templates"]) {
    rmSync(join(PROJECT_DIR, "supabase", dir), { recursive: true, force: true });
    cpSync(join(repo, "supabase", dir), join(PROJECT_DIR, "supabase", dir), { recursive: true });
  }
}

function parseStatus() {
  const out = supabase("status", "-o", "env");
  const values = Object.fromEntries([...out.matchAll(/^([A-Z_]+)="(.*)"$/gm)].map((m) => [m[1], m[2]]));
  for (const key of ["API_URL", "DB_URL", "SERVICE_ROLE_KEY", "PUBLISHABLE_KEY"]) assert.ok(values[key], `STATUS_MISSING_${key}`);
  assert.equal(values.API_URL, `http://127.0.0.1:${PORTS.api}`);
  return values;
}

async function stackRunning() {
  try { return (await fetch(`http://127.0.0.1:${PORTS.api}/auth/v1/health`)).status < 500; } catch { return false; }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function portalPid() {
  const state = readState();
  return state?.portalPid && pidAlive(state.portalPid) ? state.portalPid : null;
}

async function portalHealthy() {
  try { return (await fetch(`http://127.0.0.1:${PORTS.portal}/api/health`, { signal: AbortSignal.timeout(5000) })).ok; } catch { return false; }
}

async function startSupabase() {
  if (await stackRunning()) { log("Supabase уже запущен, переиспользую."); return; }
  const leftovers = dockerNames("containers");
  if (leftovers.length > 0) { log("Остановленный стенд найден, запускаю заново (данные сохраняются в томах)."); }
  else {
    for (const [name, port] of Object.entries(PORTS)) {
      assert.ok(await portFree(port, "0.0.0.0"), `PORT_BUSY ${name}:${port} занят чужим процессом; стенд не тронут.`);
    }
  }
  log("supabase start (первый запуск скачивает образы и применяет все миграции, это несколько минут)...");
  supabase("start", "--yes");
}

function applyMigrations() {
  // На уже существующей БД новые миграции из репозитория применяет `migration up`.
  try { supabase("migration", "up", "--local"); } catch (error) {
    if (!/up to date|no migrations|Local database is up to date/i.test(error.output ?? "")) throw error;
  }
}

async function startPortal(statusEnv) {
  if (portalPid() && await portalHealthy()) { log(`Портал уже работает на :${PORTS.portal}.`); return portalPid(); }
  const old = portalPid();
  if (old) { try { process.kill(old, "SIGTERM"); } catch { /* уже нет */ } await delay(1500); }
  assert.ok(await portFree(PORTS.portal, "0.0.0.0"), `PORT_BUSY portal:${PORTS.portal}`);
  const out = openSync(APP_LOG, "a", 0o600);
  const local = `http://127.0.0.1:${PORTS.portal}`;
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "0.0.0.0", "--port", String(PORTS.portal)], {
    cwd: repo, detached: true, stdio: ["ignore", out, out],
    env: { ...env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: statusEnv.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: statusEnv.PUBLISHABLE_KEY,
      EVO_PLATFORM_SUPABASE_SECRET_KEY: statusEnv.SERVICE_ROLE_KEY, EVO_STUDENT_INVITE_OTP_EXPIRY_SECONDS: "3600",
      EVO_STUDENT_SIGNUP_OTP_LENGTH: "6", EVO_STUDENT_INVITE_LOCAL_ORIGIN: local },
  });
  child.unref();
  const state = readState() ?? {};
  writeJson(STATE_FILE, { ...state, portalPid: child.pid });
  log(`Портал (next dev) запущен, pid ${child.pid}; лог ${APP_LOG}. Жду готовности (первая сборка до пары минут)...`);
  for (let attempt = 0; attempt < 240; attempt++) {
    if (!pidAlive(child.pid)) throw new Error(`PORTAL_EXITED, см. ${APP_LOG}`);
    if (await portalHealthy()) return child.pid;
    await delay(1000);
  }
  throw new Error(`PORTAL_NOT_READY, см. ${APP_LOG}`);
}

function hostsFor(statusEnv) {
  const mk = (host) => ({
    EXPO_PUBLIC_SUPABASE_URL: `http://${host}:${PORTS.api}`,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: statusEnv.PUBLISHABLE_KEY,
    EXPO_PUBLIC_PORTAL_BASE_URL: `http://${host}:${PORTS.portal}`,
  });
  return { ios: mk("localhost"), android: mk("10.0.2.2"), lan: lanAddress() ? mk(lanAddress()) : null };
}
const envText = (title, values) => `# ${title}\n# Сгенерировано npm run mobile:stack:up. Только локальный стенд, синтетические данные. Не коммитить.\n${Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n")}\n`;

function writeMobileFiles(statusEnv, accounts) {
  mkdirSync(MOBILE_DIR, { recursive: true });
  const hosts = hostsFor(statusEnv);
  // Основной файл: iOS-симулятор (хост = localhost). Для Android-эмулятора и телефона — отдельные варианты.
  writeFileSync(join(MOBILE_DIR, ".env.local-stack"), envText("iOS-симулятор (localhost)", hosts.ios), { mode: 0o600 });
  writeFileSync(join(MOBILE_DIR, ".env.local-stack.android"), envText("Android-эмулятор (10.0.2.2 = хост-машина)", hosts.android), { mode: 0o600 });
  if (hosts.lan) writeFileSync(join(MOBILE_DIR, ".env.local-stack.lan"), envText(`Физический телефон в одной Wi-Fi сети (${lanAddress()})`, hosts.lan), { mode: 0o600 });
  writeJson(join(MOBILE_DIR, ".local-stack-accounts.json"), accounts);
  writeJson(ACCOUNTS_FILE, accounts);
}

async function up() {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  writeProjectConfig();
  await startSupabase();
  applyMigrations();
  const statusEnv = parseStatus();
  await waitForLocalSupabaseAuthAdmin({ apiUrl: statusEnv.API_URL, serviceRoleKey: statusEnv.SERVICE_ROLE_KEY });
  const expected = readdirSync(join(repo, "supabase/migrations")).filter((n) => /^\d+_.+\.sql$/.test(n)).map((n) => n.split("_")[0]).sort();
  log(`Миграций в репозитории: ${expected.length}.`);
  const accounts = await seedMobileDevStack({
    apiUrl: statusEnv.API_URL, serviceKey: statusEnv.SERVICE_ROLE_KEY, publishableKey: statusEnv.PUBLISHABLE_KEY, dbUrl: statusEnv.DB_URL,
    previous: existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8")) : null, expectedMigrations: expected, log,
  });
  const pid = await startPortal(statusEnv);
  accounts.generatedAt = new Date().toISOString();
  accounts.urls = hostsFor(statusEnv);
  accounts.portalPort = PORTS.portal;
  if (accounts.registrationInvite) accounts.registrationInvite.url = `http://127.0.0.1:${PORTS.portal}${accounts.registrationInvite.path}`;
  writeMobileFiles(statusEnv, accounts);
  writeJson(STATE_FILE, { ...(readState() ?? {}), projectId: PROJECT_ID, ports: PORTS, portalPid: pid, upAt: new Date().toISOString() });
  await print(statusEnv, accounts);
}

async function check(url, init) {
  try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) }); return r.status; } catch { return "недоступен"; }
}

async function print(statusEnv, accounts) {
  const hosts = hostsFor(statusEnv);
  console.log("\n== EVO mobile dev stack ==");
  console.log(`Supabase API : http://127.0.0.1:${PORTS.api}  (Auth/REST/Storage)`);
  console.log(`Портал       : http://127.0.0.1:${PORTS.portal}  (слушает 0.0.0.0)`);
  console.log(`Studio       : http://127.0.0.1:${PORTS.studio}   Inbucket/Mailpit: http://127.0.0.1:${PORTS.mail}`);
  console.log(`Postgres     : порт ${PORTS.db} (127.0.0.1)`);
  console.log(`iOS-симулятор: ${hosts.ios.EXPO_PUBLIC_SUPABASE_URL} + ${hosts.ios.EXPO_PUBLIC_PORTAL_BASE_URL}`);
  console.log(`Android      : ${hosts.android.EXPO_PUBLIC_SUPABASE_URL} + ${hosts.android.EXPO_PUBLIC_PORTAL_BASE_URL}`);
  if (hosts.lan) console.log(`Телефон (LAN): ${hosts.lan.EXPO_PUBLIC_SUPABASE_URL} + ${hosts.lan.EXPO_PUBLIC_PORTAL_BASE_URL}`);
  console.log(`Файлы        : ${join(MOBILE_DIR, ".env.local-stack")} (+ .android, .lan) и .local-stack-accounts.json`);
  console.log("Аккаунты (пароли только в .local-stack-accounts.json):");
  for (const a of accounts.accounts ?? []) console.log(`  ${a.role.padEnd(10)} ${a.login ?? a.email}  — ${a.note}`);
  if (accounts.registrationInvite) console.log(`  invite     ссылка регистрации: ${accounts.registrationInvite.url} (токен в accounts.json)`);
}

async function status() {
  const state = readState();
  if (!state) { console.log("Стенд ещё не создавался: npm run mobile:stack:up"); process.exitCode = 1; return; }
  const running = await stackRunning();
  const api = `http://127.0.0.1:${PORTS.api}`;
  console.log(`Контейнеры стенда (${PROJECT_ID}): ${dockerNames("containers").length}`);
  const accounts = existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8")) : { accounts: [] };
  const key = accounts.urls?.ios?.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const headers = key ? { apikey: key } : {};
  const authStatus = await check(`${api}/auth/v1/health`, { headers });
  const restStatus = await check(`${api}/rest/v1/`, { headers });
  const portalStatus = await check(`http://127.0.0.1:${PORTS.portal}/api/health`);
  const ok = (v) => (v === 200 ? "OK" : `проблема (${v})`);
  console.log(`Auth   ${api}/auth/v1/health : ${ok(authStatus)}`);
  console.log(`REST   ${api}/rest/v1/       : ${restStatus === 200 ? "OK" : `проблема (${restStatus})`}`);
  console.log(`Портал http://127.0.0.1:${PORTS.portal}/api/health : ${ok(portalStatus)}${portalPid() ? ` (pid ${portalPid()})` : " (процесс не найден)"}`);
  if (accounts.urls) {
    console.log(`iOS-симулятор: ${accounts.urls.ios.EXPO_PUBLIC_SUPABASE_URL} | ${accounts.urls.ios.EXPO_PUBLIC_PORTAL_BASE_URL}`);
    console.log(`Android      : ${accounts.urls.android.EXPO_PUBLIC_SUPABASE_URL} | ${accounts.urls.android.EXPO_PUBLIC_PORTAL_BASE_URL}`);
  }
  console.log("Логины (пароли — в mobile/.local-stack-accounts.json):");
  for (const a of accounts.accounts) console.log(`  ${a.role.padEnd(10)} ${a.login ?? a.email}  — ${a.note}`);
  if (!running || portalStatus !== 200) { console.log("Стенд не полностью работает: npm run mobile:stack:up"); process.exitCode = 1; }
}

async function down() {
  const pid = portalPid();
  if (pid) {
    // Убиваем только процесс, который мы сами запустили (группа detached).
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* уже нет */ } }
    await delay(1500);
    if (pidAlive(pid)) { try { process.kill(-pid, "SIGKILL"); } catch { /* ignore */ } }
    log(`Портал остановлен (pid ${pid}).`);
  }
  if (existsSync(join(PROJECT_DIR, "supabase/config.toml"))) {
    try { supabase("stop", "--project-id", PROJECT_ID, "--no-backup"); } catch (error) { log(`supabase stop: ${String(error.message).split("\n")[0]}`); }
  }
  // Запасной путь: только имена с суффиксом _evo-mobile-dev.
  const containers = dockerNames("containers");
  if (containers.length) run("docker", ["rm", "-f", ...containers]);
  const volumes = dockerNames("volumes");
  if (volumes.length) run("docker", ["volume", "rm", ...volumes]);
  const networks = dockerNames("networks");
  if (networks.length) run("docker", ["network", "rm", ...networks]);
  assert.equal(dockerNames("containers").length + dockerNames("volumes").length + dockerNames("networks").length, 0, "OWNED_RESOURCES_REMAIN");
  rmSync(STATE_FILE, { force: true });
  rmSync(ACCOUNTS_FILE, { force: true });
  for (const f of [".env.local-stack", ".env.local-stack.android", ".env.local-stack.lan", ".local-stack-accounts.json"]) rmSync(join(MOBILE_DIR, f), { force: true });
  log("Стенд остановлен; контейнеры, тома и сеть evo-mobile-dev удалены, учётные файлы убраны.");
}

const command = process.argv[2];
try {
  if (command === "up") await up();
  else if (command === "status") await status();
  else if (command === "down") await down();
  else { console.error("Использование: mobile-dev-stack.mjs up|status|down"); process.exitCode = 2; }
} catch (error) {
  console.error(`[mobile-stack] ОШИБКА: ${error.message}`);
  process.exitCode = 1;
}
