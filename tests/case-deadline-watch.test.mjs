// «Сторож сроков» (миграция 383): разбор аргументов (сухой прогон по умолчанию), один вызов RPC и строка только со
// счётчиками, равенство слов задач в SQL и в wording.ts, упаковка в образ и файлы systemd. Подставной RPC; боевой базы,
// VPS и живого запуска здесь нет. Правила и повторы проверяет supabase/tests/platform_case_deadline_watch.sql.
//
// node --conditions=react-server --experimental-strip-types --test tests/case-deadline-watch.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { build } from "esbuild";

import {
  CASE_DEADLINE_WATCH_REASONS,
  parseCaseDeadlineWatchArgs,
  runCaseDeadlineWatch,
} from "../src/lib/server/ai-agents/case-deadline-watch.ts";
import { CASE_DEADLINE_WATCH_TITLES } from "../src/lib/v3/wording.ts";
import { ORG, fakeRpc, runtimeDeps } from "./ai-agents-fakes.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

const PERSON_MARKER = "Иванова";
const ANSWER = {
  dry_run: true, today: "2026-12-01", found: 6, created: 0, would_create: 5, skipped: 1, no_assignee: 0,
  by_reason: { slot_due: { found: 3, created: 0, would_create: 2, skipped: 1, no_assignee: 0 }, next_step_overdue: { found: 2, created: 0, would_create: 2, skipped: 0, no_assignee: 0 }, tranche_overdue: { found: 1, created: 0, would_create: 1, skipped: 0, no_assignee: 0 } },
  // Список дел и названия не должны попасть в журнал.
  items: [{ case_id: "33333333-3333-4333-8333-333333333333", reason_code: "slot_due", due_date: "2026-11-30", outcome: PERSON_MARKER }],
};

function setup(handler, env) {
  const service = fakeRpc({ case_deadline_watch_run_v1: handler });
  const { deps, logs } = runtimeDeps({ claude: { fetch: async () => { throw new Error("Claude must not be called"); } }, service, env });
  return { service, deps, logs };
}

/* ------------------------------------------------------------------ аргументы */

test("аргументы: без флагов — сухой прогон; --once допустим; --apply — настоящий запуск", () => {
  assert.deepEqual(parseCaseDeadlineWatchArgs([]), { apply: false });
  assert.deepEqual(parseCaseDeadlineWatchArgs(["--once"]), { apply: false });
  assert.deepEqual(parseCaseDeadlineWatchArgs(["--dry-run"]), { apply: false });
  assert.deepEqual(parseCaseDeadlineWatchArgs(["--once", "--dry-run"]), { apply: false });
  assert.deepEqual(parseCaseDeadlineWatchArgs(["--apply"]), { apply: true });
  assert.deepEqual(parseCaseDeadlineWatchArgs(["--once", "--apply"]), { apply: true });
});

test("аргументы: оба режима сразу, повтор и всё незнакомое — ошибка, а не молчаливая запись", () => {
  for (const args of [["--dry-run", "--apply"], ["--apply", "--dry-run"], ["--apply", "--apply"], ["--once", "--once"],
    ["--apply=1"], ["apply"], ["--org", ORG], ["--today", "2026-12-01"], ["-a"], [""]]) {
    assert.throws(() => parseCaseDeadlineWatchArgs(args), /invalid_arguments/u, JSON.stringify(args));
  }
});

/* ------------------------------------------------------------------ запуск */

test("сухой прогон: RPC вызван с p_dry_run=true, день не передаётся, в журнале только счётчики", async () => {
  const { service, deps } = setup(() => ({ data: ANSWER }));
  const report = await runCaseDeadlineWatch(parseCaseDeadlineWatchArgs([]), deps);
  assert.equal(report.exitCode, 0);
  const [call, ...rest] = service.calls;
  assert.equal(rest.length, 0);
  assert.deepEqual(call, { fn: "case_deadline_watch_run_v1", args: { p_organization_id: ORG, p_dry_run: true } });
  assert.equal(report.log.event, "case_deadline_watch");
  assert.equal(report.log.mode, "dry_run");
  assert.equal(report.log.status, "ok");
  assert.equal(report.log.today, "2026-12-01");
  assert.equal(report.log.found, 6);
  assert.equal(report.log.would_create, 5);
  assert.equal(report.log.by_reason.slot_due_found, 3);
  assert.equal(report.log.by_reason.tranche_overdue_would_create, 1);
  const text = JSON.stringify(report.log);
  assert.ok(!text.includes(PERSON_MARKER) && !text.includes("33333333") && !text.includes("items") && !text.includes(ORG));
});

test("--apply: RPC вызван с p_dry_run=false", async () => {
  const { service, deps } = setup(() => ({ data: { ...ANSWER, dry_run: false, created: 5, would_create: 0 } }));
  const report = await runCaseDeadlineWatch(parseCaseDeadlineWatchArgs(["--once", "--apply"]), deps);
  assert.equal(report.exitCode, 0);
  assert.equal(report.log.mode, "apply");
  assert.equal(report.log.created, 5);
  assert.deepEqual(service.calls.map((call) => call.args.p_dry_run), [false]);
});

test("без организации, без доступа к базе и при отказе базы — код 1 и фиксированные слова", async () => {
  const noOrganization = setup(() => ({ data: ANSWER }), { EVO_PLATFORM_ORGANIZATION_ID: "" });
  const first = await runCaseDeadlineWatch({ apply: true }, noOrganization.deps);
  assert.equal(first.exitCode, 1);
  assert.equal(first.log.reason, "organization_not_configured");
  assert.equal(noOrganization.service.calls.length, 0);

  const refused = setup(() => ({ error: { code: "42501", message: `Service role is required ${PERSON_MARKER}` } }));
  const second = await runCaseDeadlineWatch({ apply: true }, refused.deps);
  assert.equal(second.exitCode, 1);
  assert.equal(second.log.reason, "rpc_failed");
  assert.equal(second.log.code, "42501");
  assert.ok(!JSON.stringify(second.log).includes(PERSON_MARKER), "текст ошибки базы в журнал не идёт");

  const odd = setup(() => ({ data: "ok" }));
  assert.equal((await runCaseDeadlineWatch({ apply: false }, odd.deps)).log.reason, "unexpected_answer");

  const { deps } = runtimeDeps({ claude: { fetch: async () => { throw new Error("no"); } }, service: fakeRpc() });
  const broken = await runCaseDeadlineWatch({ apply: false }, { ...deps, serviceClient: async () => { throw new Error("no key"); } });
  assert.equal(broken.exitCode, 1);
  assert.equal(broken.log.reason, "backend_not_configured");
});

/* ------------------------------------------------------------------ слова и упаковка */

test("слова задач в SQL (миграция 383) и в wording.ts одинаковы, других причин нет", () => {
  const sql = read("supabase/migrations/383_platform_case_deadline_watch.sql");
  const body = /FUNCTION platform_private\.case_deadline_watch_title[\s\S]*?\$\$;/u.exec(sql)?.[0] ?? "";
  const pairs = [...body.matchAll(/WHEN '([a-z_]+)' THEN '([^']+)'/gu)].map((match) => [match[1], match[2]]);
  assert.deepEqual(Object.fromEntries(pairs), CASE_DEADLINE_WATCH_TITLES);
  assert.deepEqual(Object.keys(CASE_DEADLINE_WATCH_TITLES).sort(), [...CASE_DEADLINE_WATCH_REASONS].sort());
  for (const title of Object.values(CASE_DEADLINE_WATCH_TITLES)) {
    assert.match(title, /^[А-Я]/u);
    assert.ok(!/[a-z]_[a-z]/u.test(title.replace(/\{[a-z]+\}/gu, "")), "сырой ключ в слове для людей");
  }
});

test("образ несёт /app/case-deadline-watch.mjs, сборка входит в npm run build", () => {
  assert.match(read("Dockerfile"),
    /^COPY --from=builder --chown=nextjs:nodejs --chmod=0555 \/app\/\.next\/case-deadline-watch\.mjs \.\/case-deadline-watch\.mjs$/mu);
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(scripts["build:case-deadline-watch"], "node scripts/maintenance/build-case-deadline-watch.mjs");
  assert.match(scripts.build, /&& npm run build:case-deadline-watch && npm run build:ai-agents-maintenance$/u);
  assert.match(read("scripts/maintenance/build-case-deadline-watch.mjs"), /outfile: "\.next\/case-deadline-watch\.mjs"/u);
});

test("файлы systemd: будни 08:15 по Бишкеку, --apply только в unit, ключей и флагов окружения нет", () => {
  const unit = read("deploy/ai-agents/evo-case-deadline-watch.service");
  assert.match(unit, /^Type=oneshot$/mu);
  assert.match(unit, /^ExecStart=\/usr\/bin\/docker exec evo-crm-app-1 node \/app\/case-deadline-watch\.mjs --apply$/mu);
  assert.match(unit, /^Requires=docker\.service$/mu);
  const directives = unit.split("\n").filter((line) => line !== "" && !line.startsWith("#")).join("\n");
  assert.ok(!/Environment|TOKEN|KEY|SECRET/u.test(directives));
  const timer = read("deploy/ai-agents/evo-case-deadline-watch.timer");
  assert.match(timer, /^OnCalendar=Mon\.\.Fri 08:15 Asia\/Bishkek$/mu);
  assert.match(timer, /^Unit=evo-case-deadline-watch\.service$/mu);
  assert.match(timer, /^WantedBy=timers\.target$/mu);
});

test("runbook: ручной запуск, сухой прогон по умолчанию и включение таймера владельцем", () => {
  const runbook = read("docs/runbooks/ai-agents-managed.md");
  const section = runbook.slice(runbook.indexOf("## Сторож сроков"));
  assert.match(section, /node \/app\/case-deadline-watch\.mjs\s+# сухой прогон/u);
  assert.match(section, /node \/app\/case-deadline-watch\.mjs --apply/u);
  assert.match(section, /включает только владелец/u);
  assert.match(section, /systemctl enable --now evo-case-deadline-watch\.timer/u);
});

test("упакованный скрипт: без аргументов не пишет (нет организации — код 1), плохой флаг — код 2 и подсказка", async () => {
  const directory = mkdtempSync(join(tmpdir(), "case-deadline-watch-bundle-"));
  try {
    const outfile = join(directory, "case-deadline-watch.mjs");
    await build({
      absWorkingDir: root, entryPoints: ["scripts/maintenance/run-case-deadline-watch.mjs"], outfile, bundle: true,
      platform: "node", format: "esm", target: "node22", conditions: ["react-server"], logLevel: "silent",
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    });
    assert.ok(statSync(outfile).size > 1_000);
    const env = { PATH: process.env.PATH ?? "" };
    const noOrganization = spawnSync(process.execPath, [outfile], { env, encoding: "utf8", cwd: directory });
    assert.equal(noOrganization.status, 1, noOrganization.stderr);
    assert.deepEqual(JSON.parse(noOrganization.stdout),
      { event: "case_deadline_watch", mode: "dry_run", status: "failed", reason: "organization_not_configured" });
    const applyNoOrganization = spawnSync(process.execPath, [outfile, "--apply"], { env, encoding: "utf8", cwd: directory });
    assert.equal(JSON.parse(applyNoOrganization.stdout).mode, "apply");
    const bad = spawnSync(process.execPath, [outfile, "--dry-run", "--apply"], { env, encoding: "utf8", cwd: directory });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /^Usage: node case-deadline-watch\.mjs/u);
    assert.equal(bad.stdout, "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
