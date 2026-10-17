import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { TELEPHONY_PBX_OPERATIONS } from "../src/lib/server/platform-telephony-pbx-client.ts";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

test("the systemd unit is a oneshot docker exec of the packaged script with a bounded runtime", () => {
  const unit = read("deploy/telephony/evo-telephony-maintenance.service");
  assert.match(unit, /^Type=oneshot$/mu);
  assert.match(unit, /^ExecStart=\/usr\/bin\/docker exec evo-crm-app-1 node \/app\/telephony-maintenance\.mjs$/mu);
  assert.match(unit, /^TimeoutStartSec=\d{2,3}$/mu);
  assert.match(unit, /^Requires=docker\.service$/mu);
  assert.match(unit, /^After=docker\.service$/mu);
  // No secret, no environment file, no flag in the unit: the script reads the app container's env.
  const directives = unit.split("\n").filter((line) => line !== "" && !line.startsWith("#")).join("\n");
  assert.ok(!/Environment|TOKEN|KEY|ENABLED/u.test(directives));
});

test("the timer fires one minute after the previous run ended, so runs never overlap", () => {
  const timer = read("deploy/telephony/evo-telephony-maintenance.timer");
  assert.match(timer, /^OnUnitInactiveSec=1min$/mu);
  assert.match(timer, /^OnBootSec=\d+min$/mu);
  assert.match(timer, /^Persistent=true$/mu);
  assert.match(timer, /^Unit=evo-telephony-maintenance\.service$/mu);
  assert.match(timer, /^WantedBy=timers\.target$/mu);
  assert.ok(!/OnCalendar/u.test(timer), "a calendar schedule could start a run while the last one is still going");
});

test("the image carries the bundle at /app/telephony-maintenance.mjs and the build produces it", () => {
  const dockerfile = read("Dockerfile");
  assert.match(
    dockerfile,
    /^COPY --from=builder --chown=nextjs:nodejs --chmod=0555 \/app\/\.next\/telephony-maintenance\.mjs \.\/telephony-maintenance\.mjs$/mu,
  );
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["build:telephony-maintenance"], "node scripts/build-telephony-maintenance.mjs");
  assert.match(pkg.scripts.build, /npm run build:telephony-maintenance$/u);
  for (const file of [
    "tests/platform-telephony-pbx-config.test.mjs",
    "tests/platform-telephony-pbx-client.test.mjs",
    "tests/platform-telephony-maintenance.test.mjs",
    "tests/platform-telephony-maintenance-packaging.test.mjs",
  ]) {
    assert.ok(pkg.scripts["test:unit:core"].includes(file), `${file} is part of test:unit:core`);
  }
  const builder = read("scripts/build-telephony-maintenance.mjs");
  assert.match(builder, /entryPoints: \["scripts\/telephony-maintenance\.mjs"\]/u);
  assert.match(builder, /outfile: "\.next\/telephony-maintenance\.mjs"/u);
  assert.match(builder, /conditions: \["react-server"\]/u);
});

test("the bundle builds, is self-contained and, with the switch off, prints one disabled line and exits 0", async () => {
  const directory = mkdtempSync(join(tmpdir(), "telephony-maintenance-"));
  try {
    const outfile = join(directory, "telephony-maintenance.mjs");
    await build({
      absWorkingDir: root,
      entryPoints: ["scripts/telephony-maintenance.mjs"],
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
      if (value !== undefined) env.EVO_PLATFORM_TELEPHONY_ENABLED = value;
      const run = spawnSync(process.execPath, [outfile], { env, encoding: "utf8", cwd: directory });
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(JSON.parse(run.stdout), { event: "telephony_maintenance", status: "disabled", reason: "env_switch" });
      assert.equal(run.stderr, "");
    }
    // Switched on without a backend: a clear failure, no stack trace, no secret.
    const failing = spawnSync(process.execPath, [outfile], {
      env: { PATH: process.env.PATH ?? "", EVO_PLATFORM_TELEPHONY_ENABLED: "1" },
      encoding: "utf8",
      cwd: directory,
    });
    assert.equal(failing.status, 1);
    assert.deepEqual(JSON.parse(failing.stdout), { event: "telephony_maintenance", status: "failed", reason: "backend_not_configured" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the source names only the closed PBX operation list: no management path appears in the client", () => {
  const source = read("src/lib/server/platform-telephony-pbx-client.ts");
  const literalPaths = new Set([...source.matchAll(/path: "(\/[^"]*)"/gu)].map((match) => match[1]));
  assert.deepEqual(
    [...literalPaths].sort(),
    TELEPHONY_PBX_OPERATIONS.map((operation) => operation.path).sort(),
  );
  for (const forbidden of ["telnums", "blacklist", "caller-ids", "calls-restrictions", "sip-registrations", "sipuri", "branches", "webhook", "/am", "blf", "access-rights", "media-catalog", "music"]) {
    assert.ok(!source.includes(`"/${forbidden}`) && !source.includes(`/${forbidden}"`), forbidden);
  }
  // The only write verb is the makecall stub.
  assert.equal(TELEPHONY_PBX_OPERATIONS.filter((operation) => operation.method !== "GET").length, 1);
  assert.ok(!/method: "(PUT|PATCH|DELETE)"/u.test(source));
});

test("nothing in the T4a sources logs a value: the only console use is the entry's single JSON line", () => {
  for (const path of [
    "src/lib/server/platform-telephony-pbx-config.ts",
    "src/lib/server/platform-telephony-pbx-client.ts",
    "src/lib/server/platform-telephony-maintenance.ts",
  ]) {
    assert.ok(!/console\./u.test(read(path)), path);
  }
  const entry = read("scripts/telephony-maintenance.mjs");
  assert.equal((entry.match(/console\./gu) ?? []).length, 2);
  assert.match(entry, /console\.log\(JSON\.stringify\(report\.log\)\)/u);
  assert.match(entry, /console\.error\("telephony_maintenance_failed"\)/u);
});
