#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, writeFile, appendFile, rm, readdir, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { provisionLocalStudentInvite } from "./provision-local-student-invite.mjs";
import { waitForLocalSupabaseAuthAdmin } from "./supabase-auth-readiness.mjs";
import { runStudentInviteProof } from "../tests/e2e/student-invite-proof.mjs";

assert.match(process.version, /^v22\./, "Use Node 22");
process.umask(0o077);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const npx = join(dirname(node), "npx");
// No inherited application/provider variables or checkout .env files.
const baseEnv = Object.fromEntries(["PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH", "DOCKER_HOST", "DOCKER_CONFIG"]
  .filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
assert.ok(!baseEnv.DOCKER_HOST || baseEnv.DOCKER_HOST.startsWith("unix://"), "REMOTE_DOCKER_FORBIDDEN");
const run = (binary, args, options = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(binary, args, { cwd: repo, env: baseEnv, ...options, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolveRun(output) : reject(Object.assign(new Error(`COMMAND_FAILED:${args[0]}:${code}`), { privateOutput: output })));
});
if (process.platform === "darwin") {
  assert.equal((await run("orb", ["status"])).trim(), "Running");
  assert.equal((await run("docker", ["context", "show"])).trim(), "orbstack");
}
const scratch = await mkdtemp(join(tmpdir(), "evo-student-invite."));
const evidence = await mkdtemp(join(tmpdir(), "evo-student-invite-evidence."));
const project = join(scratch, "project");
const app = join(scratch, "app");
const projectId = `evo-invite-${randomUUID()}`;
const secrets = [];
const redact = (value) => secrets.reduce((text, secret) => secret ? text.replaceAll(secret, "[REDACTED]") : text, String(value))
  .replace(/token_hash=[0-9a-f]+/g, "token_hash=[REDACTED]")
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]");
let appProcess;
let owned = false;
let failed = false;
let appLogBuffer = "";
let pendingLog = Promise.resolve();
let cleanupPromise;
const cleanup = () => {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    if (appProcess && appProcess.exitCode === null) {
      appProcess.kill("SIGTERM");
      await Promise.race([new Promise((done) => appProcess.once("exit", done)), delay(10_000)]);
      if (appProcess.exitCode === null) appProcess.kill("SIGKILL");
    }
    if (appLogBuffer) pendingLog = pendingLog.then(() => appendFile(join(evidence, "app.log"), redact(appLogBuffer)));
    await pendingLog;
    if (owned) {
      try {
        await run(npx, ["--no-install", "supabase", "stop", "--workdir", project, "--project-id", projectId, "--no-backup"]);
        const remaining = (await run("docker", ["ps", "-a", "--format", "{{.Names}}"])).split("\n").filter((name) => name.endsWith(`_${projectId}`));
        assert.equal(remaining.length, 0, "OWNED_CONTAINERS_REMAIN");
      } catch { failed = true; console.error("OWNED_STACK_CLEANUP_FAILED"); }
    }
    assert.ok(scratch.startsWith(join(tmpdir(), "evo-student-invite.")));
    if (!failed) await rm(scratch, { recursive: true });
    else console.error(`STUDENT_INVITE_OWNED_SCRATCH_RETAINED ${scratch}`);
  })();
  return cleanupPromise;
};
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  failed = true;
  await cleanup();
  process.exit(130);
});
console.log(`STUDENT_INVITE_PRIVATE_EVIDENCE ${evidence}`);
try {
  await mkdir(join(project, "supabase"), { recursive: true });
  await mkdir(app);
  for (const path of ["src", "public", "node_modules", "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs"]) {
    await cp(join(repo, path), join(app, path), { recursive: true, mode: constants.COPYFILE_FICLONE });
  }
  const servers = [];
  const ports = [];
  for (let i = 0; i < 11; i++) {
    const server = createServer();
    await new Promise((resolvePort, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePort); });
    servers.push(server);
    ports.push(server.address().port);
  }
  assert.ok(ports.every((port) => port >= 1024 && port <= 65535 && ![3000, 3100].includes(port)));
  const [apiPort, dbPort, shadowPort, studioPort, mailPort, smtpPort, popPort, inspectorPort, analyticsPort, poolerPort, appPort] = ports;
  const origin = `http://127.0.0.1:${appPort}`;
  let config = await readFile(join(repo, "supabase/config.toml"), "utf8");
  const replacements = [
    ['project_id = "evo-platform-local"', `project_id = "${projectId}"`],
    ["port = 45421", `port = ${apiPort}`], ["port = 45422", `port = ${dbPort}`],
    ["shadow_port = 45420", `shadow_port = ${shadowPort}`], ["port = 45423", `port = ${studioPort}`],
    ["port = 45424", `port = ${mailPort}`], ["smtp_port = 45425", `smtp_port = ${smtpPort}`],
    ["pop3_port = 45426", `pop3_port = ${popPort}`], ["inspector_port = 45428", `inspector_port = ${inspectorPort}`],
    ["port = 45427", `port = ${analyticsPort}`], ["port = 45429", `port = ${poolerPort}`],
    ['site_url = "http://127.0.0.1:3000"', `site_url = "${origin}"`],
    ['additional_redirect_urls = ["http://127.0.0.1:3000/auth/callback"]', `additional_redirect_urls = ["${origin}/auth/callback"]`],
  ];
  for (const [before, after] of replacements) {
    assert.equal(config.split(before).length - 1, 1, `CONFIG_DRIFT:${before}`);
    config = config.replace(before, after);
  }
  assert.doesNotMatch(config, /\[auth\.email\.smtp\]/, "EXTERNAL_SMTP_FORBIDDEN");
  await writeFile(join(project, "supabase/config.toml"), config);
  await symlink(join(repo, "supabase/migrations"), join(project, "supabase/migrations"));
  await symlink(join(repo, "supabase/templates"), join(project, "supabase/templates"));
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
  owned = true;
  console.log("STUDENT_INVITE_STARTING_ISOLATED_STACK");
  await run(npx, ["--no-install", "supabase", "start", "--workdir", project, "--yes"]);
  const status = await run(npx, ["--no-install", "supabase", "status", "--workdir", project, "-o", "env"]);
  const env = Object.fromEntries([...status.matchAll(/^([A-Z_]+)="(.*)"$/gm)].map((match) => [match[1], match[2]]));
  assert.equal(env.API_URL, `http://127.0.0.1:${apiPort}`);
  assert.equal(new URL(env.DB_URL).host, `127.0.0.1:${dbPort}`);
  for (const key of ["SERVICE_ROLE_KEY", "PUBLISHABLE_KEY", "DB_URL"]) { assert.ok(env[key]); secrets.push(env[key]); }
  const db = postgres(env.DB_URL, { max: 1, onnotice: () => {} });
  try {
    const expected = (await readdir(join(repo, "supabase/migrations"))).filter((name) => /^\d+_.+\.sql$/.test(name)).map((name) => name.split("_")[0]).sort();
    const actual = (await db`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version`).map((row) => row.version).sort();
    assert.deepEqual(actual, expected, "EXACT_MIGRATION_LEDGER_REQUIRED");
  } finally { await db.end(); }
  await waitForLocalSupabaseAuthAdmin({ apiUrl: env.API_URL, serviceRoleKey: env.SERVICE_ROLE_KEY });
  const fixture = await provisionLocalStudentInvite({ url: env.API_URL, serviceKey: env.SERVICE_ROLE_KEY, publishableKey: env.PUBLISHABLE_KEY, dbUrl: env.DB_URL });
  secrets.push(fixture.adminPassword, fixture.studentPassword);
  console.log("STUDENT_INVITE_NORMAL_HANDOFF_COMPLETE_NO_STUDENT_AUTH_USER");
  appProcess = spawn(node, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(appPort)], {
    cwd: app, env: { ...baseEnv, NEXT_PUBLIC_SUPABASE_URL: env.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.PUBLISHABLE_KEY,
      EVO_PLATFORM_SUPABASE_SECRET_KEY: env.SERVICE_ROLE_KEY, EVO_STUDENT_INVITE_OTP_EXPIRY_SECONDS: "3600", EVO_STUDENT_INVITE_LOCAL_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = (data) => {
    appLogBuffer += data;
    const end = appLogBuffer.lastIndexOf("\n");
    if (end < 0) return;
    const completeLines = appLogBuffer.slice(0, end + 1);
    appLogBuffer = appLogBuffer.slice(end + 1);
    pendingLog = pendingLog.then(() => appendFile(join(evidence, "app.log"), redact(completeLines)));
  };
  appProcess.stdout.on("data", log); appProcess.stderr.on("data", log);
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    assert.equal(appProcess.exitCode, null, "APP_EXITED");
    try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch { /* own process starting */ }
    await delay(1000);
  }
  assert.ok(ready, "APP_NOT_READY");
  const proof = await runStudentInviteProof({ origin, apiUrl: env.API_URL, mailpitOrigin: `http://127.0.0.1:${mailPort}`, dbUrl: env.DB_URL, fixture, evidenceRoot: evidence });
  await writeFile(join(evidence, "proof.json"), JSON.stringify({ head: (await run("git", ["rev-parse", "HEAD"])).trim(),
    candidateWorkingTree: (await run("git", ["status", "--porcelain"])).trim().length > 0,
    checkedAt: new Date().toISOString(), isolated: true, browser: "Chromium", viewport: "1360x1000", ...proof }, null, 2));
  console.log("STUDENT_INVITE_REAL_FLOW_VERIFIED");
} catch (error) {
  failed = true;
  await writeFile(join(evidence, "failure.log"), redact(error.privateOutput ?? error.stack ?? error));
  console.error("STUDENT_INVITE_PROOF_FAILED: inspect private redacted evidence");
} finally {
  await cleanup();
}
process.exitCode = failed ? 1 : 0;
