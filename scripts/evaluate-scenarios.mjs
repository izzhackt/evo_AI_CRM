import Database from "better-sqlite3";
import { spawn } from "child_process";
import { createHmac } from "crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import net from "net";
import os from "os";
import path from "path";
import { createScenarios } from "./scenarios/admissions-crm.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourceDb = path.join(repoRoot, "data", "edu-admin.db");
const reportPath = path.join(repoRoot, "docs", "SCENARIO_EVALUATION.md");
const authSecret = "scenario-evaluation-secret";
const basePort = Number(process.env.EVO_SCENARIO_PORT ?? 3130);
const only = new Set(
  (process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const htmlEntities = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", "\""],
  ["apos", "'"],
  ["#x27", "'"],
  ["#39", "'"],
]);

function decodeHtml(value) {
  return String(value ?? "").replace(/&([^;]+);/g, (match, entity) => {
    if (htmlEntities.has(entity)) return htmlEntities.get(entity);
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return match;
  });
}

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

function escapeMd(value) {
  return String(value ?? "")
    .replaceAll("\n", " ")
    .replaceAll("|", "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSessionCookie(userId) {
  const payload = `${userId}.${Date.now()}`;
  const sig = createHmac("sha256", authSecret).update(payload).digest("hex");
  return `edu_session=${payload}.${sig}`;
}

function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE") tryPort(port + 1);
        else reject(error);
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function copyDatabase(tmpDb) {
  assert(existsSync(sourceDb), `source SQLite database not found at ${sourceDb}`);
  const source = new Database(sourceDb, { readonly: true });
  source.exec(`VACUUM INTO '${escapeSqlString(tmpDb)}'`);
  source.close();
}

function openEvidenceDb(dbPath) {
  const d = new Database(dbPath);
  d.pragma("journal_mode = wal");
  return d;
}

async function waitForServer(baseUrl, processHandle) {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (processHandle.exitCode != null) {
      throw new Error(`next start exited early with code ${processHandle.exitCode}: ${lastError}`);
    }
    try {
      const res = await fetch(`${baseUrl}/login`, { redirect: "manual" });
      if (res.status === 200) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await wait(500);
  }
  throw new Error(`server did not become ready: ${lastError}`);
}

function startServer(port, dbPath) {
  const logs = [];
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AUTH_SECRET: authSecret,
      EVO_DB_PATH: dbPath,
      NEXT_TELEMETRY_DISABLED: "1",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (data) => logs.push(String(data)));
  proc.stderr.on("data", (data) => logs.push(String(data)));
  return { proc, logs };
}

async function stopServer(proc) {
  if (!proc || proc.exitCode != null) return;
  proc.kill("SIGTERM");
  const deadline = Date.now() + 5_000;
  while (proc.exitCode == null && Date.now() < deadline) {
    await wait(100);
  }
  if (proc.exitCode == null) proc.kill("SIGKILL");
}

class ScenarioContext {
  constructor(baseUrl, dbPath) {
    this.baseUrl = baseUrl;
    this.db = openEvidenceDb(dbPath);
    this.users = Object.fromEntries(
      this.db
        .prepare("SELECT id, email, role FROM users")
        .all()
        .map((user) => [user.email, user]),
    );
    this.cookies = Object.fromEntries(
      Object.entries(this.users).map(([email, user]) => [email, makeSessionCookie(user.id)]),
    );
  }

  close() {
    this.db.close();
  }

  user(email) {
    const user = this.users[email];
    assert(user, `missing seeded user ${email}`);
    return user;
  }

  cookie(email) {
    this.user(email);
    return this.cookies[email];
  }

  async request(method, route, { cookie, body, headers = {}, redirect = "manual" } = {}) {
    const finalHeaders = { ...headers };
    if (cookie) finalHeaders.cookie = cookie;
    const res = await fetch(`${this.baseUrl}${route}`, {
      method,
      body,
      headers: finalHeaders,
      redirect,
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      location: res.headers.get("location"),
      actionRedirect: res.headers.get("x-action-redirect"),
      setCookie: typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []),
      text,
    };
  }

  get(route, cookie) {
    return this.request("GET", route, { cookie });
  }

  async postJson(route, body, { cookie, headers = {} } = {}) {
    return this.request("POST", route, {
      cookie,
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  async submit(route, cookie, selector, overrides = {}) {
    const page = await this.get(route, cookie);
    assert(page.status === 200, `GET ${route} returned ${page.status}`);
    const form = findForm(page.text, selector);
    const data = controlsFromForm(form);
    for (const [key, value] of Object.entries(overrides)) {
      data.set(key, value == null ? "" : String(value));
    }
    const actionMarker = [...data.keys()].find((key) => key.startsWith("$ACTION_"));
    assert(actionMarker, `no Server Action marker found in form on ${route}`);
    const post = await this.request("POST", route, {
      cookie,
      body: data,
      headers: { origin: this.baseUrl },
    });
    assert([200, 303].includes(post.status), `POST ${route} returned ${post.status}`);
    return post;
  }

  async submitWithPostCookie(route, getCookie, postCookie, selector, overrides = {}) {
    const page = await this.get(route, getCookie);
    assert(page.status === 200, `GET ${route} returned ${page.status}`);
    const form = findForm(page.text, selector);
    const data = controlsFromForm(form);
    for (const [key, value] of Object.entries(overrides)) {
      data.set(key, value == null ? "" : String(value));
    }
    const actionMarker = [...data.keys()].find((key) => key.startsWith("$ACTION_"));
    assert(actionMarker, `no Server Action marker found in form on ${route}`);
    const post = await this.request("POST", route, {
      cookie: postCookie,
      body: data,
      headers: { origin: this.baseUrl },
    });
    assert([200, 303].includes(post.status), `POST ${route} returned ${post.status}`);
    return post;
  }

  firstClientId() {
    const row = this.db.prepare("SELECT id FROM clients ORDER BY id LIMIT 1").get();
    assert(row, "no seeded client found");
    return row.id;
  }

  firstLeadId(where = "1 = 1") {
    const row = this.db.prepare(`SELECT id FROM leads WHERE ${where} ORDER BY id LIMIT 1`).get();
    assert(row, `no lead found for ${where}`);
    return row.id;
  }

  firstApplicationId() {
    const row = this.db.prepare("SELECT id, client_id FROM applications ORDER BY id LIMIT 1").get();
    assert(row, "no seeded application found");
    return row;
  }

  firstDocumentId() {
    const row = this.db.prepare("SELECT id, client_id FROM documents ORDER BY id LIMIT 1").get();
    assert(row, "no seeded document found");
    return row;
  }

  firstPaymentId(where = "1 = 1") {
    const row = this.db.prepare(`SELECT id, client_id FROM payments WHERE ${where} ORDER BY id LIMIT 1`).get();
    assert(row, `no payment found for ${where}`);
    return row;
  }

  firstTaskId(where = "1 = 1") {
    const row = this.db.prepare(`SELECT id, client_id FROM tasks WHERE ${where} ORDER BY id LIMIT 1`).get();
    assert(row, `no task found for ${where}`);
    return row;
  }
}

function findForm(html, selector) {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  assert(forms.length > 0, "page has no forms");
  const matches = forms.filter((form) => {
    if (selector.includes) {
      for (const fragment of selector.includes) {
        if (!form.includes(fragment)) return false;
      }
    }
    if (selector.names) {
      for (const name of selector.names) {
        if (!new RegExp(`name=["']${escapeRegex(name)}["']`).test(form)) return false;
      }
    }
    if (selector.excludes) {
      for (const fragment of selector.excludes) {
        if (form.includes(fragment)) return false;
      }
    }
    return true;
  });
  assert(matches.length > 0, `no matching form found for ${JSON.stringify(selector)}`);
  return matches[0];
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function controlsFromForm(form) {
  const data = new FormData();
  for (const match of form.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.name || attrs.disabled != null) continue;
    const type = (attrs.type ?? "text").toLowerCase();
    if (["submit", "button", "image", "file"].includes(type)) continue;
    if ((type === "checkbox" || type === "radio") && attrs.checked == null) continue;
    data.append(attrs.name, attrs.value ?? "");
  }
  for (const match of form.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.name || attrs.disabled != null) continue;
    data.append(attrs.name, decodeHtml(match[2]));
  }
  for (const match of form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.name || attrs.disabled != null) continue;
    const options = [...match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((option) => ({
      attrs: parseAttrs(option[1]),
      label: decodeHtml(option[2]).trim(),
    }));
    const selected = options.find((option) => option.attrs.selected != null) ?? options[0];
    data.append(attrs.name, selected?.attrs.value ?? selected?.label ?? "");
  }
  return data;
}

function parseAttrs(raw) {
  const attrs = {};
  for (const match of raw.matchAll(/([:\w$.-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs[match[1]] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function rowCount(ctx, table, where = "1 = 1", params = []) {
  return ctx.db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).get(...params).c;
}

function scalar(ctx, sql, params = []) {
  return ctx.db.prepare(sql).get(...params);
}

const scenarios = createScenarios({ assert, rowCount, scalar, unique });

function writeReport(results, env) {
  const passCount = results.filter((r) => r.result === "PASS").length;
  const failCount = results.length - passCount;
  const rows = results.map((r) => (
    `| ${r.id} | ${escapeMd(r.capability)} | ${escapeMd(r.scenario)} | ${escapeMd(r.criteria)} | ${r.result} | ${escapeMd(r.evidence)} |`
  ));
  const failures = results
    .filter((r) => r.result !== "PASS")
    .map((r) => `- ${r.id}: ${r.error}`)
    .join("\n");
  const content = `# Scenario Evaluation

Generated: ${new Date().toISOString()}

## Method

Evaluation method: consistent pass/fail checks. Each scenario defines a success
criterion before execution and records concrete evidence after execution.

Conditions:

- Built Next.js production app served through \`next start\`.
- Fixed \`AUTH_SECRET\` for signed seeded-session cookies.
- Isolated SQLite copy from \`data/edu-admin.db\` via \`EVO_DB_PATH\`.
- Real App Router pages, Server Action form posts, and API route handlers.
- No live WhatsApp, telephony, amoCRM, or Anthropic credentials supplied; missing
  provider credentials must surface as explicit blocked/not-configured states.
- Base URL: \`${env.baseUrl}\`.
- Temp DB: \`${env.dbPath}\` (isolated copy; removed after the run unless
  \`EVO_KEEP_SCENARIO_DB=1\` is set).

## Summary

- Passed: ${passCount}
- Failed: ${failCount}
- Total: ${results.length}

${failCount ? `## Failures\n\n${failures}\n\n` : ""}## Results

| ID | Capability | Scenario | Success Criteria | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
  writeFileSync(reportPath, content);
}

async function run() {
  if (!existsSync(path.join(repoRoot, ".next"))) {
    throw new Error("production build not found: run `node node_modules/next/dist/bin/next build` first");
  }
  const selected = only.size ? scenarios.filter((scenario) => only.has(scenario.id)) : scenarios;
  assert(selected.length > 0, `no scenarios matched ${[...only].join(",")}`);

  const tmpDir = path.join(os.tmpdir(), `evo-crm-scenarios-${process.pid}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, "edu-admin.db");
  copyDatabase(dbPath);

  const port = await findFreePort(basePort);
  const baseUrl = `http://127.0.0.1:${port}`;
  const { proc, logs } = startServer(port, dbPath);
  const results = [];
  let ctx;
  try {
    await waitForServer(baseUrl, proc);
    ctx = new ScenarioContext(baseUrl, dbPath);
    for (const scenario of selected) {
      const started = Date.now();
      try {
        const evidence = await scenario.run(ctx);
        results.push({ ...scenario, result: "PASS", evidence, durationMs: Date.now() - started });
        console.log(`${scenario.id} PASS ${evidence}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ ...scenario, result: "FAIL", evidence: message, error: message, durationMs: Date.now() - started });
        console.error(`${scenario.id} FAIL ${message}`);
      }
    }
    writeReport(results, { baseUrl, dbPath });
  } finally {
    ctx?.close();
    await stopServer(proc);
    if (process.env.EVO_KEEP_SCENARIO_DB !== "1") {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const failures = results.filter((result) => result.result !== "PASS");
  if (failures.length) {
    console.error(`\n${failures.length} scenario(s) failed. Report: ${reportPath}`);
    console.error(logs.slice(-20).join(""));
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${results.length} scenarios passed. Report: ${reportPath}`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
