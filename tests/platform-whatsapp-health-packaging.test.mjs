// Packaging of the WhatsApp connection alert: the host timer, the image, the build chain, the migration it needs and
// the runbook. Run with:
// node --conditions=react-server --experimental-strip-types --test tests/platform-whatsapp-health-packaging.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { build } from "esbuild";

import {
  WHATSAPP_DOWN_THRESHOLD_MS,
  WHATSAPP_SILENT_THRESHOLD_MS,
  WHATSAPP_WORKING_CLOSE_HOUR,
  WHATSAPP_WORKING_ISO_DAYS,
  WHATSAPP_WORKING_OPEN_HOUR,
} from "../src/lib/platform-whatsapp-health.ts";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

test("the systemd unit is a oneshot docker exec of the packaged script with a bounded runtime", () => {
  const unit = read("deploy/whatsapp/evo-whatsapp-health.service");
  assert.match(unit, /^Type=oneshot$/mu);
  assert.match(unit, /^ExecStart=\/usr\/bin\/docker exec evo-crm-app-1 node \/app\/whatsapp-health-maintenance\.mjs$/mu);
  assert.match(unit, /^TimeoutStartSec=\d{2,3}$/mu);
  assert.match(unit, /^Requires=docker\.service$/mu);
  assert.match(unit, /^After=docker\.service$/mu);
  // No secret, no environment file, no flag in the unit: the script reads the app container's env.
  const directives = unit.split("\n").filter((line) => line !== "" && !line.startsWith("#")).join("\n");
  assert.ok(!/Environment|TOKEN|KEY|SECRET|ENABLED/u.test(directives));
});

test("the timer fires five minutes after the previous run ended, so runs never overlap", () => {
  const timer = read("deploy/whatsapp/evo-whatsapp-health.timer");
  assert.match(timer, /^OnUnitInactiveSec=5min$/mu);
  assert.match(timer, /^OnBootSec=\d+min$/mu);
  assert.match(timer, /^Persistent=true$/mu);
  assert.match(timer, /^Unit=evo-whatsapp-health\.service$/mu);
  assert.match(timer, /^WantedBy=timers\.target$/mu);
  assert.ok(!/OnCalendar/u.test(timer), "a calendar schedule could start a run while the last one is still going");
});

test("the image carries the bundle at /app/whatsapp-health-maintenance.mjs and the build produces it", () => {
  const dockerfile = read("Dockerfile");
  assert.match(
    dockerfile,
    /^COPY --from=builder --chown=nextjs:nodejs --chmod=0555 \/app\/\.next\/whatsapp-health-maintenance\.mjs \.\/whatsapp-health-maintenance\.mjs$/mu,
  );
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["build:whatsapp-health-maintenance"], "node scripts/build-whatsapp-health-maintenance.mjs");
  assert.match(pkg.scripts.build, /npm run build:whatsapp-health-maintenance( |$)/u);
  // The sibling build steps keep their place: telephony before, AI agents last (their packaging tests pin it).
  assert.match(pkg.scripts.build, /npm run build:telephony-maintenance && npm run build:whatsapp-health-maintenance && npm run build:ai-agents-maintenance$/u);
  const builder = read("scripts/build-whatsapp-health-maintenance.mjs");
  assert.match(builder, /entryPoints: \["scripts\/whatsapp-health-maintenance\.mjs"\]/u);
  assert.match(builder, /outfile: "\.next\/whatsapp-health-maintenance\.mjs"/u);
  assert.match(builder, /conditions: \["react-server"\]/u);
});

test("the bundle builds, is self-contained and, with the receive path off, prints one disabled line and exits 0", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whatsapp-health-"));
  try {
    const outfile = join(directory, "whatsapp-health-maintenance.mjs");
    await build({
      absWorkingDir: root,
      entryPoints: ["scripts/whatsapp-health-maintenance.mjs"],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      conditions: ["react-server"],
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      logLevel: "silent",
    });
    assert.ok(statSync(outfile).size > 10_000);
    for (const value of [undefined, "0"]) {
      const env = { PATH: process.env.PATH ?? "" };
      if (value !== undefined) env.EVO_PLATFORM_WAHA_INGRESS_ENABLED = value;
      const run = spawnSync(process.execPath, [outfile], { env, encoding: "utf8", cwd: directory });
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(JSON.parse(run.stdout), { event: "whatsapp_health_maintenance", status: "disabled", reason: "ingress_off" });
      assert.equal(run.stderr, "");
    }
    // Switched on without a backend: a clear failure, no stack trace, no secret.
    const failing = spawnSync(process.execPath, [outfile], {
      env: { PATH: process.env.PATH ?? "", EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1" },
      encoding: "utf8",
      cwd: directory,
    });
    assert.equal(failing.status, 1);
    assert.deepEqual(JSON.parse(failing.stdout), { event: "whatsapp_health_maintenance", status: "failed", reason: "backend_not_configured" });
    assert.equal(failing.stderr, "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the job has no public surface: no route, no handler, no HTTP entry mentions it", () => {
  const walk = (directory) =>
    readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
    );
  for (const file of walk("src/app")) {
    if (!/\.(ts|tsx|mjs|js)$/u.test(file)) continue;
    assert.ok(!/whatsapp[-_]health/u.test(read(file)), file);
  }
  assert.ok(!existsSync(join(root, "src/app/api/internal/whatsapp-health")));
});

test("migration 321 exists, is additive, and its copy matches the rules in the application", () => {
  const files = readdirSync(join(root, "supabase/migrations")).filter((file) => file.startsWith("321_"));
  assert.deepEqual(files, ["321_platform_whatsapp_health_alerts.sql"]);
  const sql = read(`supabase/migrations/${files[0]}`);
  // Forward-only and additive: nothing is dropped, altered or replaced.
  assert.ok(!/\bDROP\s+(TABLE|FUNCTION|COLUMN|INDEX|TRIGGER|POLICY)\b/iu.test(sql));
  assert.ok(!/\bALTER\s+TABLE\s+(?!platform_private\.whatsapp_health_)/iu.test(sql));
  assert.ok(!/CREATE\s+OR\s+REPLACE/iu.test(sql));
  assert.match(sql, /RAISE EXCEPTION 'a321_already_applied'/u);
  assert.match(sql, /RAISE EXCEPTION 'a321_anchor_drift/u);
  // The thresholds and the working hours in the Russian copy are the ones the rules use.
  assert.equal(WHATSAPP_DOWN_THRESHOLD_MS, 10 * 60_000);
  assert.equal(WHATSAPP_SILENT_THRESHOLD_MS, 3 * 3_600_000);
  assert.equal(WHATSAPP_WORKING_OPEN_HOUR, 10);
  assert.equal(WHATSAPP_WORKING_CLOSE_HOUR, 20);
  assert.deepEqual([...WHATSAPP_WORKING_ISO_DAYS], [1, 2, 3, 4, 5, 6]);
  assert.match(sql, /больше 10 минут/u);
  assert.match(sql, /молчит 3 часа в рабочее время/u);
  assert.match(sql, /3 рабочих часа/u);
  assert.match(sql, /пн–сб, 10:00–20:00 по Бишкеку/u);
  // Where the staff is sent, as the spec words it.
  assert.match(sql, /Настройки → Интеграции → Подключение WhatsApp/u);
  // The words the alert probe invents for a WAHA that answered 404 / 401, and the silence baseline the planner moves.
  for (const word of ["UNREACHABLE", "UNAUTHORIZED", "SESSION_MISSING"]) assert.match(sql, new RegExp(word, "u"));
  assert.match(sql, /working_since_at/u);
  assert.match(sql, /p_working_restart/u);
  // The service-side copy is true whenever the session comes back: no «это не отвязка», no «когда сервис ответит».
  assert.ok(!/Это не отвязка/u.test(sql));
  assert.ok(!/когда сервис ответит/u.test(sql));
  // The SQL suite is hooked into the authorization harness by file name and insists on its marker.
  const harness = read("scripts/test-postgres-authorization.sh");
  assert.match(harness, /\*_platform_whatsapp_health_alerts\.sql/u);
  assert.match(harness, /a321_already_applied/u);
  assert.match(harness, /A321_WHATSAPP_HEALTH_ALERTS_SUITE_PASSED/u);
  assert.match(read("supabase/tests/platform_whatsapp_health_alerts.sql"), /A321_WHATSAPP_HEALTH_ALERTS_SUITE_PASSED/u);
});

test("the runbook and the deploy note describe the alert, the timer install and the rollback", () => {
  const runbook = read("docs/runbooks/whatsapp-go-live.md");
  assert.match(runbook, /Тревога об отключении и тишине/u);
  for (const phrase of [
    "evo-whatsapp-health.timer",
    "systemctl disable --now evo-whatsapp-health.timer",
    "/app/whatsapp-health-maintenance.mjs",
    "миграция 321",
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED",
    "10 минут",
    "3 рабочих часа",
  ]) {
    assert.ok(runbook.includes(phrase), phrase);
  }
  const deploy = read("deploy/whatsapp/README.md");
  assert.match(deploy, /systemctl enable --now evo-whatsapp-health\.timer/u);
  assert.match(deploy, /systemctl disable --now evo-whatsapp-health\.timer/u);
});
