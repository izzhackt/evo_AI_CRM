#!/usr/bin/env node
// `npm run verify` — one command for every check, the same on a laptop and in CI (PLAN_CHANGES 22.11.2026).
//
//   npm run verify                          every default step in parallel; PASS or FAIL with a table
//   npm run verify -- --only tests          one step (CI jobs call it this way)
//   npm run verify -- --only tests --shard 2/4
//   npm run verify -- --skip build          everything except the slow production build
//   npm run verify -- --with preview        add an opt-in step
//   npm run verify -- --list                the steps and what they run
//
// Each step writes its own log under .verify/ (in CI a single selected step streams to the job log instead).
// Exit code 0 only when every selected step passed. A step whose prerequisites are missing FAILS: nothing is
// skipped silently.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
/** Running step processes, stopped when verify itself is interrupted. */
const CHILDREN = new Set();

/** The steps. `command(ctx)` returns [executable, args]; `requires(ctx)` returns null or why it cannot run. */
export const STEPS = Object.freeze({
  "diff-check": {
    title: "Whitespace (git diff --check)",
    command: (ctx) => ["git", ["diff", "--check", `${ctx.base}...HEAD`]],
    requires: (ctx) => (gitRefExists(ctx.root, ctx.base) ? null : `base ${ctx.base} is not available: git fetch origin main`),
  },
  typecheck: { title: "Types (next typegen + tsc)", command: () => [NPM, ["run", "--silent", "typecheck"]] },
  lint: { title: "Lint (eslint)", command: () => [NPM, ["run", "--silent", "lint"]] },
  tests: {
    title: "Node test manifest",
    command: (ctx) => [process.execPath, [
      "scripts/test-runners/run-node-test-suite.mjs", "--suite", "ci", ...(ctx.shard ? ["--shard", ctx.shard] : []),
    ]],
  },
  contracts: { title: "Release contracts", command: () => [NPM, ["run", "--silent", "test:fast-release"]] },
  mobile: {
    title: "Mobile app (mobile/: npm run check)",
    command: () => [NPM, ["--prefix", "mobile", "run", "--silent", "check"]],
    requires: (ctx) => (existsSync(join(ctx.root, "mobile/node_modules"))
      ? null
      : "mobile/node_modules is missing: run `npm ci --prefix mobile`"),
  },
  build: { title: "Production build (next build)", command: () => [NPM, ["run", "--silent", "build"]] },
  migrations: {
    title: "Migration boundaries (Docker)",
    command: () => [NPM, ["run", "--silent", "test:database:migration-boundaries"]],
  },
  preview: { title: "PR preview (synthetic stack + browser)", command: () => [NPM, ["run", "--silent", "preview:ci"]] },
});

/** Rough seconds on a laptop (22.11.2026), only to start the longest steps first. */
export const EXPECTED_SECONDS = Object.freeze({ "diff-check": 1, typecheck: 50, lint: 80, tests: 240, contracts: 200, mobile: 55, build: 70, migrations: 1500, preview: 120 });

/** Run by a plain `npm run verify`. `migrations` joins when supabase/ changed; `preview` only on request. */
export const DEFAULT_STEPS = Object.freeze(["diff-check", "typecheck", "lint", "tests", "contracts", "mobile", "build"]);

export function parseArgs(argv) {
  const options = { only: null, skip: [], with: [], shard: null, base: null, jobs: null, list: false };
  const list = (value) => String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === "--only") options.only = list(value());
    else if (argument === "--skip") options.skip.push(...list(value()));
    else if (argument === "--with") options.with.push(...list(value()));
    else if (argument === "--shard") options.shard = value();
    else if (argument === "--base") options.base = value();
    else if (argument === "--jobs") options.jobs = Number(value());
    else if (argument === "--list") options.list = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const name of [...(options.only ?? []), ...options.skip, ...options.with]) {
    if (!Object.hasOwn(STEPS, name)) throw new Error(`Unknown step: ${name} (known: ${Object.keys(STEPS).join(", ")})`);
  }
  if (options.shard !== null && !/^[1-9][0-9]*\/[1-9][0-9]*$/u.test(options.shard)) {
    throw new Error(`Invalid --shard: ${options.shard} (expected i/n)`);
  }
  if (options.jobs !== null && !(Number.isSafeInteger(options.jobs) && options.jobs > 0)) {
    throw new Error("--jobs must be a positive integer");
  }
  return options;
}

/** Which steps run, in table order. Pure: `changedPaths` decides whether migrations join a default run. */
export function selectSteps(options, changedPaths = []) {
  let names;
  if (options.only) {
    names = [...options.only];
  } else {
    names = [...DEFAULT_STEPS];
    if (changedPaths.some((path) => path.startsWith("supabase/"))) names.push("migrations");
  }
  for (const extra of options.with) if (!names.includes(extra)) names.push(extra);
  names = names.filter((name) => !options.skip.includes(name));
  if (options.shard !== null && !names.includes("tests")) throw new Error("--shard applies to the tests step only");
  const order = Object.keys(STEPS);
  return [...new Set(names)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function gitRefExists(root, ref) {
  return spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: root }).status === 0;
}

/**
 * What this branch changed: commits since the merge base with `base` (not main's newer commits), plus uncommitted and
 * untracked files. null when the base is not available: then nobody can tell whether supabase/ changed.
 */
export function changedPathsSince(root, base) {
  if (!gitRefExists(root, base)) return null;
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout ?? "";
  const committed = git("diff", "--name-only", `${base}...HEAD`);
  const uncommitted = git("diff", "--name-only", "HEAD");
  const untracked = git("ls-files", "--others", "--exclude-standard");
  return [...new Set(`${committed}\n${uncommitted}\n${untracked}`.split("\n").map((line) => line.trim()).filter(Boolean))];
}

const seconds = (ms) => {
  const total = Math.round(ms / 1000);
  return total >= 60 ? `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s` : `${total}s`;
};

function tail(path, lines = 40) {
  try {
    return readFileSync(path, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/**
 * Runs the selected steps (up to `jobs` at a time) and resolves to the results. `steps` can be replaced in tests.
 * `stream` sends a step's output to this process instead of its log (one step in CI).
 */
export async function runSteps(names, { ctx, steps = STEPS, jobs = names.length, stream = false, out = process.stdout } = {}) {
  const logDir = join(ctx.root, ".verify");
  mkdirSync(logDir, { recursive: true });
  const results = [];
  const queue = [...names].sort((a, b) => (EXPECTED_SECONDS[b] ?? 60) - (EXPECTED_SECONDS[a] ?? 60));
  const running = new Set();
  const runOne = (name) => new Promise((done) => {
    const step = steps[name];
    const log = join(logDir, `${name}${ctx.shard && name === "tests" ? `-${ctx.shard.replace("/", "-of-")}` : ""}.log`);
    const started = Date.now();
    let finished = false;
    const finish = (status, detail = null) => {
      if (finished) return;
      finished = true;
      const result = { name, title: step.title, status, ms: Date.now() - started, log: stream ? null : log, detail };
      out.write(`${status === "PASS" ? "PASS" : "FAIL"}  ${name}  ${seconds(result.ms)}${detail ? `  (${detail})` : ""}\n`);
      results.push(result);
      done();
    };
    let file = null;
    const closeLog = (then) => {
      if (!file || file.closed || file.destroyed) return then();
      file.end(then);
    };
    try {
      const blocked = step.requires?.(ctx) ?? null;
      if (blocked) return finish("FAIL", blocked);
      const [executable, args] = step.command(ctx);
      out.write(`start ${name}: ${[executable, ...args].join(" ")}\n`);
      if (!stream) {
        file = createWriteStream(log);
        file.on("error", (error) => finish("FAIL", `log: ${error.message}`));
      }
      const child = spawn(executable, args, {
        cwd: ctx.root,
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: stream ? "inherit" : ["ignore", "pipe", "pipe"],
        // Its own process group, so an interrupted verify stops the whole step (npm -> next, node --test workers).
        detached: process.platform !== "win32",
      });
      CHILDREN.add(child);
      if (file) {
        // Both streams write into one log; only the process end closes it (late stderr is kept).
        child.stdout.pipe(file, { end: false });
        child.stderr.pipe(file, { end: false });
      }
      child.on("error", (error) => {
        CHILDREN.delete(child);
        closeLog(() => finish("FAIL", error.message));
      });
      child.on("close", (code, signal) => {
        CHILDREN.delete(child);
        closeLog(() => finish(code === 0 ? "PASS" : "FAIL", code === 0 ? null : signal ? `signal ${signal}` : `exit ${code}`));
      });
    } catch (error) {
      closeLog(() => finish("FAIL", error?.message ?? String(error)));
    }
  });
  await new Promise((allDone) => {
    const next = () => {
      if (queue.length === 0 && running.size === 0) return allDone();
      while (running.size < jobs && queue.length > 0) {
        const name = queue.shift();
        const promise = runOne(name).then(() => {
          running.delete(promise);
          next();
        });
        running.add(promise);
      }
    };
    next();
  });
  const order = names;
  return results.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

export function summary(results, totalMs) {
  const failed = results.filter((result) => result.status !== "PASS");
  const rows = results.map((result) => `| ${result.name} | ${result.status} | ${seconds(result.ms)} | ${result.detail ?? (result.log ? result.log.replace(`${ROOT}/`, "") : "job log")} |`);
  const table = ["| step | result | time | log / reason |", "|---|---|---|---|", ...rows].join("\n");
  const verdict = failed.length === 0
    ? `VERIFY PASS — ${results.length} step(s) in ${seconds(totalMs)}`
    : `VERIFY FAIL — ${failed.map((result) => result.name).join(", ")}`;
  return { table, verdict, failed };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    for (const [name, step] of Object.entries(STEPS)) {
      const [executable, args] = step.command({ root: ROOT, base: "origin/main", shard: null });
      process.stdout.write(`${DEFAULT_STEPS.includes(name) ? "*" : " "} ${name.padEnd(11)} ${step.title}: ${[executable, ...args].join(" ")}\n`);
    }
    process.stdout.write("* = part of a plain `npm run verify`; migrations join when supabase/ changed.\n");
    return 0;
  }
  const base = options.base ?? process.env.VERIFY_BASE ?? "origin/main";
  const ctx = { root: ROOT, base, shard: options.shard };
  // A plain run must know whether supabase/ changed; without the base it fails instead of guessing.
  const decidesMigrations = !options.only && !options.skip.includes("migrations") && !options.with.includes("migrations");
  const changed = decidesMigrations ? changedPathsSince(ROOT, base) : [];
  if (changed === null) {
    throw new Error(`base ${base} is not available, so whether supabase/ changed is unknown: git fetch origin main, or pass --base, --with migrations or --skip migrations`);
  }
  const names = selectSteps(options, changed);
  if (names.length === 0) throw new Error("No step selected");
  const inCi = process.env.GITHUB_ACTIONS === "true";
  // Three steps at a time by default: the test manifest alone runs four workers, and timing-bound tests (the release
  // rollback simulations) fail under a fully loaded machine. --jobs overrides.
  const jobs = options.jobs ?? (inCi ? 1 : Math.max(1, Math.min(names.length, 3, Math.floor(availableParallelism() / 4) || 1)));
  const started = Date.now();
  process.stdout.write(`verify: ${names.join(", ")}${options.shard ? ` (tests shard ${options.shard})` : ""}\n`);
  const results = await runSteps(names, { ctx, jobs, stream: inCi && names.length === 1 });
  const { table, verdict, failed } = summary(results, Date.now() - started);
  for (const result of failed) {
    if (!result.log) continue;
    process.stdout.write(`\n----- ${result.name}: last lines of ${result.log.replace(`${ROOT}/`, "")} -----\n${tail(result.log)}\n`);
  }
  process.stdout.write(`\n${table}\n\n${verdict}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n\n**${verdict}**\n`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      for (const child of CHILDREN) {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          // The step already ended.
        }
      }
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`verify: ${error.message}\n`);
    process.exitCode = 2;
  });
}
