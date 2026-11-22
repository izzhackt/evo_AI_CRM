#!/usr/bin/env node
// Проверка «preview» на каждый PR (docs/PLAN_CHANGES.md, 2026-11-22): настоящее приложение из рабочего дерева
// против одноразовой синтетической базы; в браузере проверяются ключевые страницы персонала и студента.
//
//   npm run preview:ci            (локально нужен Docker; на macOS: DOCKER_CONTEXT=orbstack)
//
// Что делает: изолированный стенд Supabase CLI (проект evo-pr-preview, порты 46440-46451) -> синтетические
// данные (готовый scripts/local-dev/mobile-dev-stack-seed.mjs) -> `next build` (standalone, как в production)
// -> сервер приложения -> Playwright (chromium) -> таблица замеров из строк `evo_timing` -> остановка стенда.
// Только синтетика (@example.test); секретов нет; продакшн не затрагивается. Ненулевой код выхода при любом сбое.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync,
  readSync, rmSync, statSync, writeFileSync, cpSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { waitForLocalSupabaseAuthAdmin } from "../local-dev/supabase-auth-readiness.mjs";
import { seedMobileDevStack } from "../local-dev/mobile-dev-stack-seed.mjs";
import { redact } from "./redact.mjs";
import { STAFF_PAGES, STUDENT_PAGES } from "./pr-preview-pages.mjs";
import { parseTimingLines } from "../maintenance/timing-report.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Стенд: свой id и свой блок портов (не пересекается с evo-mobile-dev 46420-46430, E4/E5 и 3000/3100).
export const PROJECT_ID = "evo-pr-preview";
export const BASE_PORT = 46440;
export const PORTS = {
  shadow: BASE_PORT, api: BASE_PORT + 1, db: BASE_PORT + 2, studio: BASE_PORT + 3, mail: BASE_PORT + 4,
  smtp: BASE_PORT + 5, pop3: BASE_PORT + 6, analytics: BASE_PORT + 7, inspector: BASE_PORT + 8,
  pooler: BASE_PORT + 9, app: BASE_PORT + 10, tls: BASE_PORT + 11,
};
// Сервисы, которых страницы не используют: быстрее старт, меньше образов. Auth, REST, Storage и БД остаются.
const EXCLUDED_SERVICES = ["studio", "imgproxy", "vector", "logflare", "edge-runtime", "realtime", "postgres-meta", "supavisor", "mailpit"];


const OUT_DIR = process.env.EVO_PR_PREVIEW_OUT ? resolve(process.env.EVO_PR_PREVIEW_OUT) : join(repo, "output/pr-preview");
const WORK_DIR = join(OUT_DIR, "work");
const SHOT_DIR = join(OUT_DIR, "screenshots");
const APP_LOG = join(OUT_DIR, "app.log");
const SUPABASE_LOG = join(OUT_DIR, "supabase.log");
const BUILD_LOG = join(OUT_DIR, "build.log");
const SUMMARY = join(OUT_DIR, "summary.md");
const PROJECT_DIR = join(WORK_DIR, "project");

// Только нужные переменные окружения. Ничего из секретов и .env чекаута в процессы не попадает.
const PASS_ENV = ["PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "XDG_CONFIG_HOME", "CI", "LANG"];
const baseEnv = Object.fromEntries(PASS_ENV.filter((n) => process.env[n]).map((n) => [n, process.env[n]]));
assert.ok(!baseEnv.DOCKER_HOST || baseEnv.DOCKER_HOST.startsWith("unix://"), "REMOTE_DOCKER_FORBIDDEN: только локальный Docker (unix://)");

const npx = join(dirname(process.execPath), "npx");
const log = (message) => console.log(`[pr-preview] ${message}`);
const children = new Set();
const phases = [];
const failures = [];

async function phase(name, fn) {
  const started = Date.now();
  log(`${name}...`);
  try { return await fn(); } finally {
    const seconds = (Date.now() - started) / 1000;
    phases.push({ name, seconds });
    log(`${name}: ${seconds.toFixed(1)} с`);
  }
}

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: repo, env: baseEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    throw new Error(`COMMAND_FAILED ${binary} ${args.slice(0, 3).join(" ")} (exit ${result.status})\n${((result.stdout ?? "") + (result.stderr ?? "")).slice(-3000)}`);
  }
  return result.stdout ?? "";
}
const supabase = (...args) => run(npx, ["--no-install", "supabase", ...args, "--workdir", PROJECT_DIR]);

const portFree = (port, host) => new Promise((ok) => {
  const server = createServer();
  server.once("error", () => ok(false));
  server.listen(port, host, () => server.close(() => ok(true)));
});

function writeProjectConfig() {
  mkdirSync(join(PROJECT_DIR, "supabase"), { recursive: true });
  let config = readFileSync(join(repo, "supabase/config.toml"), "utf8");
  const origin = `http://127.0.0.1:${PORTS.app}`;
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
  assert.doesNotMatch(config, /\[auth\.email\.smtp\]/u, "EXTERNAL_SMTP_FORBIDDEN");
  writeFileSync(join(PROJECT_DIR, "supabase/config.toml"), config);
  // Копии (не симлинки): шаблоны писем читаются по путям из config.toml.
  for (const dir of ["migrations", "templates"]) cpSync(join(repo, "supabase", dir), join(PROJECT_DIR, "supabase", dir), { recursive: true });
}

function parseStatus() {
  const out = supabase("status", "-o", "env");
  const values = Object.fromEntries([...out.matchAll(/^([A-Z_]+)="(.*)"$/gmu)].map((m) => [m[1], m[2]]));
  for (const key of ["API_URL", "DB_URL", "SERVICE_ROLE_KEY", "PUBLISHABLE_KEY"]) assert.ok(values[key], `STATUS_MISSING_${key}`);
  assert.equal(values.API_URL, `http://127.0.0.1:${PORTS.api}`);
  return values;
}

function stopSupabase() {
  if (!existsSync(join(PROJECT_DIR, "supabase/config.toml"))) return;
  try { supabase("stop", "--project-id", PROJECT_ID, "--no-backup"); } catch (error) { log(`supabase stop: ${String(error.message).split("\n")[0]}`); }
  // Запасной путь: только ресурсы с меткой этого проекта и точным суффиксом имени.
  const label = `label=com.supabase.cli.project=${PROJECT_ID}`;
  const names = (args) => { try { return run("docker", args).split("\n").map((n) => n.trim()).filter((n) => n.endsWith(`_${PROJECT_ID}`)); } catch { return []; } };
  const containers = names(["ps", "-a", "--filter", label, "--format", "{{.Names}}"]);
  if (containers.length) spawnSync("docker", ["rm", "-f", ...containers], { env: baseEnv });
  const volumes = names(["volume", "ls", "--filter", label, "-q"]);
  if (volumes.length) spawnSync("docker", ["volume", "rm", ...volumes], { env: baseEnv });
  const networks = names(["network", "ls", "--filter", label, "--format", "{{.Name}}"]);
  if (networks.length) spawnSync("docker", ["network", "rm", ...networks], { env: baseEnv });
}

function appEnv(statusEnv, tlsUrl, certPath) {
  return {
    ...baseEnv,
    NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: certPath,
    NEXT_PUBLIC_SUPABASE_URL: tlsUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: statusEnv.PUBLISHABLE_KEY,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: statusEnv.SERVICE_ROLE_KEY, SUPABASE_SERVICE_ROLE_KEY: statusEnv.SERVICE_ROLE_KEY,
    EVO_STUDENT_INVITE_OTP_EXPIRY_SECONDS: "3600", HOSTNAME: "127.0.0.1", PORT: String(PORTS.app),
  };
}

/** Читает хвост файла, начиная со смещения (строки evo_timing, появившиеся после него). */
function readFrom(path, offset) {
  const size = statSync(path).size;
  if (size <= offset) return "";
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(size - offset);
    readSync(fd, buffer, 0, buffer.length, offset);
    return buffer.toString("utf8");
  } finally { closeSync(fd); }
}

const errorBoundary = (page) => page.locator('[data-testid="v3-error"], main.pt-boundary [role="alert"], [data-nextjs-dialog], #__next_error__');

// Состояния «нет доступа / недоступно / ошибка чтения» у синтетического администратора и студента означают поломку.
const BAD_STATE = '[data-testid$="-unavailable"], [data-testid$="-denied"], [data-testid$="-forbidden"], [data-testid="queue-error"]';

/** Содержимое страницы, а не скелет loading.tsx: якорь виден и нет `aria-busy`. */
async function waitForContent(page, anchor) {
  if (anchor.testIds?.length) {
    await page.locator(anchor.testIds.map((id) => `[data-testid="${id}"]`).join(", ")).first().waitFor({ state: "visible", timeout: 60_000 });
  } else if (anchor.role) {
    await page.getByRole(anchor.role, { name: anchor.name }).first().waitFor({ state: "visible", timeout: 60_000 });
  }
  // Засеянные данные должны быть на экране: пустой список или деградировавший вид не проходит.
  for (const text of anchor.text ?? []) await page.getByText(text).first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 60_000 });
  await page.getByRole("heading").first().waitFor({ state: "visible", timeout: 10_000 });
}

async function signIn(page, baseUrl, email, password, destination, { consentGate = false } = {}) {
  const login = await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  assert.equal(login?.status(), 200, "login_route_unavailable");
  await page.locator("#staff-email").fill(email);
  await page.locator("#staff-password").fill(password);
  const landing = (url) => url.href === `${baseUrl}${destination}` || (consentGate && url.href.startsWith(`${baseUrl}/portal/privacy`));
  await Promise.all([
    page.waitForURL(landing, { waitUntil: "domcontentloaded", timeout: 60_000 }),
    page.locator('form[aria-labelledby="login-title"] button[type="submit"]').click(),
  ]);
  if (consentGate && page.url().startsWith(`${baseUrl}/portal/privacy`)) {
    // Экран согласий (356): две обязательные галочки, затем «Продолжить». Запись идёт в синтетическую базу.
    const gate = page.getByTestId("consent-gate");
    await gate.waitFor({ state: "visible", timeout: 30_000 });
    const boxes = gate.locator('input[type="checkbox"]');
    assert.equal(await boxes.count(), 2, "consent_gate_shape_invalid");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await Promise.all([
      page.waitForURL(`${baseUrl}${destination}`, { waitUntil: "domcontentloaded", timeout: 60_000 }),
      gate.getByTestId("consent-gate-submit").click(),
    ]);
  }
}

/** Одна страница: HTTP 200, без редиректа, без границы ошибки, якорь на месте, ошибок в консоли страницы нет. */
async function checkPage(page, baseUrl, spec, group, results, pageErrors, serverErrors) {
  const url = `${baseUrl}${spec.path}`;
  const result = { group, path: spec.path, status: null, ok: false, note: "", timing: null, ms: null, testIds: [] };
  const errorsBefore = pageErrors.length;
  const errorsBeforeServer = serverErrors.length;
  await delay(250); // дать предыдущим ответам дописать строки evo_timing
  const offset = statSync(APP_LOG).size;
  const started = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    result.status = response?.status() ?? null;
    if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
    const expected = `${baseUrl}${spec.finalPath ?? spec.path}`;
    if (page.url() !== expected) throw new Error(`ожидался ${spec.finalPath ?? spec.path}, открылся ${new URL(page.url()).pathname}`);
    await waitForContent(page, spec.anchor);
    result.ms = Date.now() - started;
    result.testIds = await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")))].slice(0, 40));
    if (await errorBoundary(page).count()) throw new Error("граница ошибки на странице");
    if (await page.locator(BAD_STATE).count()) throw new Error("страница показывает состояние «недоступно/нет доступа»");
    for (const id of spec.anchor.absent ?? []) {
      if (await page.locator(`[data-testid="${id}"]`).count()) throw new Error(`виден запасной/устаревший вид (${id})`);
    }
    if (serverErrors.length > errorsBeforeServer) throw new Error(`ответ сервера 5xx: ${serverErrors[serverErrors.length - 1]}`);
    if (pageErrors.length > errorsBefore) throw new Error(`ошибка в браузере: ${pageErrors[pageErrors.length - 1]}`);
    result.ok = true;
  } catch (error) {
    result.ms ??= Date.now() - started;
    result.note = String(error?.message ?? error).split("\n")[0].slice(0, 200);
    failures.push(`${group} ${spec.path}: ${result.note}`);
  }
  const shot = `${group}-${spec.path.replace(/^\//u, "").replace(/[^A-Za-z0-9-]+/gu, "_") || "root"}.png`;
  try { await page.screenshot({ path: join(SHOT_DIR, shot), fullPage: false }); } catch { /* снимок не обязателен для вердикта */ }
  await delay(300);
  const { records } = parseTimingLines(readFrom(APP_LOG, offset));
  const pageRecords = records.filter((r) => r.kind === "page");
  result.timing = pageRecords.find((r) => `/${r.class}`.replace(/^\/\//u, "/") === (spec.finalPath ?? spec.path).split("?")[0]) ?? pageRecords[0] ?? null;
  results.push(result);
  log(`${result.ok ? "OK  " : "FAIL"} ${group} ${spec.path} ${result.status ?? "-"} ${result.ms} мс${result.note ? ` — ${result.note}` : ""}`);
}

function markdown(results, context) {
  const total = phases.reduce((sum, p) => sum + p.seconds, 0);
  const lines = [];
  lines.push(`## EVO PR preview: ${failures.length === 0 ? "все страницы прошли" : `сбоев: ${failures.length}`}`, "");
  lines.push(`Ревизия: \`${context.revision}\`. Стенд: изолированный Supabase CLI (\`${PROJECT_ID}\`, синтетические данные \`@example.test\`), production-сборка Next.`, "");
  lines.push("| Страница | Роль | HTTP | Результат | Браузер, мс | Сервер, мс | RPC | Глубина |", "|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const t = r.timing;
    lines.push(`| \`${r.path}\` | ${r.group} | ${r.status ?? "—"} | ${r.ok ? "OK" : `FAIL: ${r.note}`} | ${r.ms ?? "—"} | ${t ? Math.round(t.ms) : "—"} | ${t ? t.rpc : "—"} | ${t ? t.depth : "—"} |`);
  }
  lines.push("", "Сервер/RPC/глубина — строка `evo_timing` самого запроса страницы (холодный старт, один заход).", "");
  lines.push("| Этап | Секунды |", "|---|---|");
  for (const p of phases) lines.push(`| ${p.name} | ${p.seconds.toFixed(1)} |`);
  lines.push(`| **Итого** | **${total.toFixed(1)}** |`);
  if (failures.length) lines.push("", "### Сбои", ...failures.map((f) => `- ${f}`));
  return `${lines.join("\n")}\n`;
}

async function main() {
  const revision = (() => { try { return run("git", ["rev-parse", "--short=12", "HEAD"]).trim(); } catch { return "unknown"; } })();
  const stray = readdirSync(repo).filter((f) => /^\.env/u.test(f) && f !== ".env.example");
  assert.equal(stray.length, 0, `ENV_FILE_IN_CHECKOUT: ${stray.join(", ")} — Next подхватил бы чужие ключи; запустите из чистого worktree`);
  assert.ok(existsSync(join(repo, "node_modules/next")), "DEPENDENCIES_MISSING: сначала npm ci");

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(SHOT_DIR, { recursive: true });
  mkdirSync(WORK_DIR, { recursive: true });
  for (const file of [APP_LOG, SUPABASE_LOG, BUILD_LOG]) writeFileSync(file, "", { mode: 0o600 });

  let appProcess = null;
  let tlsProcess = null;
  const results = [];
  let browser = null;
  try {
    run("docker", ["info", "--format", "{{.ServerVersion}}"]);
    // Свой прошлый (прерванный) прогон снимаем до проверки портов; чужие стенды не трогаем.
    writeProjectConfig();
    stopSupabase();
    for (const [name, port] of Object.entries(PORTS)) {
      assert.ok(await portFree(port, "0.0.0.0"), `PORT_BUSY ${name}:${port} занят чужим процессом`);
    }

    const statusEnv = await phase("Supabase: запуск стенда и все миграции", async () => {
      const out = supabase("start", "--yes", "-x", EXCLUDED_SERVICES.join(","));
      appendFileSync(SUPABASE_LOG, out);
      const status = parseStatus();
      await waitForLocalSupabaseAuthAdmin({ apiUrl: status.API_URL, serviceRoleKey: status.SERVICE_ROLE_KEY });
      return status;
    });
    const migrations = readdirSync(join(repo, "supabase/migrations")).filter((n) => /^\d+_.+\.sql$/u.test(n)).length;
    log(`миграций в репозитории: ${migrations}`);

    const accounts = await phase("Синтетические данные (seed)", () => seedMobileDevStack({
      apiUrl: statusEnv.API_URL, serviceKey: statusEnv.SERVICE_ROLE_KEY, publishableKey: statusEnv.PUBLISHABLE_KEY,
      dbUrl: statusEnv.DB_URL, previous: null, log,
    }));
    const credential = (key) => { const a = accounts.accounts.find((x) => x.key === key); assert.ok(a, `ACCOUNT_MISSING_${key}`); return a; };
    const admin = credential("admin");
    const student = credential("assisted");

    // Production-сборка требует HTTPS к Supabase: одноразовый самоподписанный сертификат и loopback-прокси (как в E4).
    const certDir = join(WORK_DIR, "tls");
    mkdirSync(certDir, { recursive: true, mode: 0o700 });
    const key = join(certDir, "supabase-local.key");
    const cert = join(certDir, "supabase-local.crt");
    run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
      "-addext", "subjectAltName=IP:127.0.0.1", "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,digitalSignature,keyCertSign,keyEncipherment", "-addext", "extendedKeyUsage=serverAuth",
      "-keyout", key, "-out", cert]);
    chmodSync(key, 0o600);
    const tlsUrl = `https://127.0.0.1:${PORTS.tls}`;
    tlsProcess = spawn(process.execPath, [join(repo, "scripts/support/e4-loopback-tls-proxy.mjs"), statusEnv.API_URL, String(PORTS.tls), key, cert],
      { env: baseEnv, stdio: ["ignore", openSync(join(WORK_DIR, "tls-proxy.log"), "a"), openSync(join(WORK_DIR, "tls-proxy.log"), "a")] });
    children.add(tlsProcess);
    for (let i = 0; ; i++) {
      assert.ok(i < 30 && tlsProcess.exitCode === null, "TLS_PROXY_NOT_READY");
      // fetch не доверяет самоподписанному сертификату; проверяем через curl с явным CA.
      const code = spawnSync("curl", ["--silent", "--max-time", "2", "--cacert", cert, "--output", "/dev/null", "--write-out", "%{http_code}", `${tlsUrl}/auth/v1/health`], { encoding: "utf8" }).stdout;
      if (code === "200") break;
      await delay(1000);
    }
    const env = appEnv(statusEnv, tlsUrl, cert);

    await phase("Сборка приложения (next build)", async () => {
      const out = openSync(BUILD_LOG, "a");
      const build = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { cwd: repo, env, stdio: ["ignore", out, out] });
      assert.equal(build.status, 0, `NEXT_BUILD_FAILED (см. build.log: ${BUILD_LOG})`);
      // Standalone-сервер, как в production: статика и public копируются рядом.
      cpSync(join(repo, "public"), join(repo, ".next/standalone/public"), { recursive: true });
      cpSync(join(repo, ".next/static"), join(repo, ".next/standalone/.next/static"), { recursive: true });
    });

    await phase("Запуск сервера приложения", async () => {
      const out = openSync(APP_LOG, "a", 0o600);
      appProcess = spawn(process.execPath, [".next/standalone/server.js"], { cwd: repo, env, stdio: ["ignore", out, out] });
      children.add(appProcess);
      for (let i = 0; ; i++) {
        assert.ok(i < 120 && appProcess.exitCode === null, `APP_NOT_READY (см. app.log: ${APP_LOG})`);
        const ok = await fetch(`http://127.0.0.1:${PORTS.app}/api/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
        if (ok) break;
        await delay(1000);
      }
    });

    await phase("Браузер: персонал и студент", async () => {
      const baseUrl = `http://127.0.0.1:${PORTS.app}`;
      browser = await chromium.launch({ headless: true });
      // Самоподписанный сертификат одноразового прокси: браузер ходит в Supabase через него.
      for (const [group, account, pages, options] of [
        ["staff", admin, STAFF_PAGES, { destination: "/main" }],
        ["student", student, STUDENT_PAGES, { destination: "/portal", consentGate: true }],
      ]) {
        const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
        context.setDefaultTimeout(60_000);
        const page = await context.newPage();
        const pageErrors = [];
        const serverErrors = [];
        // Ответы документа и XHR/fetch со статусом 5xx в ходе посещения страницы — сбой этой страницы.
        page.on("response", (response) => {
          if (response.status() >= 500 && ["document", "xhr", "fetch"].includes(response.request().resourceType())) {
            serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`.slice(0, 120));
          }
        });
        page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error).slice(0, 160)));
        try {
          await signIn(page, baseUrl, account.email, account.password, options.destination, options);
          for (const spec of pages) await checkPage(page, baseUrl, spec, group, results, pageErrors, serverErrors);
        } catch (error) {
          const note = `вход не удался: ${String(error?.message ?? error).split("\n")[0].slice(0, 200)}`;
          failures.push(`${group}: ${note}`);
          for (const spec of pages) if (!results.some((r) => r.group === group && r.path === spec.path)) results.push({ group, path: spec.path, status: null, ok: false, note, ms: null, timing: null });
          try { await page.screenshot({ path: join(SHOT_DIR, `${group}-login-failure.png`) }); } catch { /* ignore */ }
        } finally {
          await context.close();
        }
      }
    });
    return { results, revision };
  } finally {
    await browser?.close().catch(() => {});
    for (const child of [appProcess, tlsProcess]) {
      if (child && child.exitCode === null) { child.kill("SIGTERM"); await delay(500); if (child.exitCode === null) child.kill("SIGKILL"); }
    }
    await phase("Остановка стенда", async () => { stopSupabase(); });
    // Рабочий каталог (сертификаты, копии миграций) не нужен после прогона и не попадает в артефакт.
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  // GitHub шлёт SIGINT, через ~7.5 с SIGKILL: путь быстрый, только процессы. Контейнеры снимет следующий запуск (stopSupabase в начале).
  process.on(signal, () => { for (const child of children) child.kill("SIGKILL"); process.exit(130); });
}

let outcome = { results: [], revision: "unknown" };
let fatal = null;
try { outcome = await main(); } catch (error) { fatal = error; failures.push(`прогон прерван: ${String(error?.message ?? error).split("\n")[0].slice(0, 300)}`); }

// Загружаемые логи в публичный артефакт: токены вида JWT и sb_* (в том числе локальные ключи по умолчанию) вычёркиваются.
for (const file of [APP_LOG, BUILD_LOG]) {
  try { writeFileSync(file, redact(readFileSync(file, "utf8"))); } catch { /* файла нет при раннем сбое */ }
}
mkdirSync(OUT_DIR, { recursive: true });
const expected = STAFF_PAGES.length + STUDENT_PAGES.length;
if (!fatal && outcome.results.length !== expected) failures.push(`проверено страниц ${outcome.results.length} из ${expected}`);
let report = markdown(outcome.results, { revision: outcome.revision });
try {
  const table = spawnSync(process.execPath, [join(repo, "scripts/maintenance/timing-report.mjs")], { input: readFileSync(APP_LOG), encoding: "utf8" }).stdout?.trim();
  if (table) report += `\n<details><summary>Все запросы сервера (scripts/maintenance/timing-report.mjs)</summary>\n\n\`\`\`\n${table}\n\`\`\`\n\n</details>\n`;
} catch { /* лог мог не создаться при раннем сбое */ }
writeFileSync(SUMMARY, report);
writeFileSync(join(OUT_DIR, "pages.json"), `${JSON.stringify(outcome.results.map(({ group, path, status, ok, ms, timing, testIds }) => ({ group, path, status, ok, ms, timing, testIds })), null, 2)}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(`\n${report}`);
if (fatal) console.error(`[pr-preview] ОШИБКА: ${fatal.message}`);
process.exitCode = failures.length === 0 ? 0 : 1;
