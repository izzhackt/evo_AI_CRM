import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse, stringify } from "smol-toml";
import { localStaffConfig, staffLoopbackOrigin } from "../scripts/lib/local-staff-supabase-workdir.mjs";

const source = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
const ports = Array.from({ length: 10 }, (_, index) => 47000 + index);
const projectId = "evo-local-1234567890abcdef";
const appOrigin = "http://127.0.0.1:47123";

test("generated config pins a unique project, service ports and exact staff/Student callbacks", () => {
  const original = parse(source);
  const config = localStaffConfig(source, appOrigin, projectId, ports);
  assert.equal(config.project_id, projectId);
  assert.equal(config.auth.site_url, appOrigin);
  assert.deepEqual(config.auth.additional_redirect_urls, [`${appOrigin}/auth/staff`, `${appOrigin}/auth/callback`]);
  assert.equal(config.api.port, ports[0]);
  assert.equal(config.local_smtp.port, ports[5]);
  assert.equal(config.local_smtp.smtp_port, ports[6]);
  assert.equal(config.db.seed.enabled, false);
  assert.deepEqual(config.auth.hook, original.auth.hook);
  assert.deepEqual(config.auth.email.template, original.auth.email.template);
  assert.deepEqual(config.storage, original.storage);
  assert.deepEqual(parse(stringify(config)), config);
  assert.equal(parse(source).project_id, original.project_id);
});

test("generated local Auth rejects external delivery, providers and non-loopback callbacks", () => {
  for (const origin of ["https://crm.evoadmissions.com", "http://127.0.0.1:3000/auth/staff", "http://user@localhost:3000", "http://localhost:3000/?x=1", "http://localhost"]) {
    assert.throws(() => staffLoopbackOrigin(origin));
  }
  const smtp = parse(source); smtp.auth.email.smtp = { enabled: true, host: "smtp.example.invalid" };
  assert.throws(() => localStaffConfig(stringify(smtp), appOrigin, projectId, ports));
  const mailDisabled = parse(source); mailDisabled.local_smtp.enabled = false;
  assert.throws(() => localStaffConfig(stringify(mailDisabled), appOrigin, projectId, ports));
  const external = parse(source); external.auth.external = { google: { enabled: true } };
  assert.throws(() => localStaffConfig(stringify(external), appOrigin, projectId, ports));
  assert.throws(() => localStaffConfig(source, appOrigin, "evo-platform-local", ports));
  assert.throws(() => localStaffConfig(source, appOrigin, projectId, ports.map(() => 47000)));
});

test("both harnesses use generated workdir for every CLI lifecycle call and onboard after app startup", () => {
  for (const name of ["test-postgres-v2-foundation.sh", "verify-platform-provider-acceptance.sh"]) {
    const harness = readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");
    for (const command of harness.split("\n").filter((line) => /npx --no-install supabase (?:--workdir|start|stop|status|db)/u.test(line))) {
      assert.match(command, /supabase --workdir "\$supabase_workdir"/u);
    }
    assert.match(harness, /EVO_LOCAL_STAFF_PHASE=bootstrap/u);
    assert.match(harness, /EVO_LOCAL_STAFF_PHASE=(?:onboard|"\$staff_phase")/u);
    assert.match(harness, /EVO_STAFF_AUTH_MAILPIT_ORIGIN="\$staff_mailpit_origin"/u);
    assert.match(harness, /EVO_STUDENT_INVITE_LOCAL_ORIGIN="http:\/\/127\.0\.0\.1:\$app_port"/u);
    assert.match(harness, /retained owned workdir/u);
  }
});

test("employee provisioner uses published scoped invitations, not the revoked pilot path", () => {
  const provisioner = readFileSync(new URL("../scripts/provision-local-supabase-staff.mjs", import.meta.url), "utf8");
  assert.match(provisioner, /prepareScopedStaffInvitations/u);
  assert.match(provisioner, /acceptScopedStaffInvitations/u);
  assert.match(provisioner, /staff_access_snapshot/u);
  assert.match(provisioner, /staff_workspace_change_member/u);
  assert.match(provisioner, /change_membership_permission/u);
  assert.doesNotMatch(provisioner, /provision_pilot_staff_member|change_pilot_staff_status|generateLink|createConfirmedUser|row\.platform_role/u);
  assert.equal((provisioner.match(/auth\.admin\.createUser/gu) ?? []).length, 1);
  assert.match(provisioner, /if \(phase === "bootstrap"\)/u);
});

test("onboarding subset proves real mail acceptance before returning, without provider or Storage suites", () => {
  const harness = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
  const subset = harness.slice(harness.indexOf('if [[ "$staff_onboarding_only" == "1" ]]'));
  const branch = subset.slice(0, subset.indexOf("\nfi"));
  assert.match(branch, /start_app configured unavailable blocked provider-not-authorized disabled/u);
  assert.match(branch, /provision_local_staff onboarding-proof/u);
  assert.match(branch, /LOCAL_SCOPED_STAFF_ONBOARDING_VERIFIED/u);
  assert.match(branch, /exit 0/u);
  assert.doesNotMatch(branch, /start_clamav_scanner|start_isolated_waha_service|provision_local_staff_and_fixtures|browser_assert|verify_p4/u);
  const provisioner = readFileSync(new URL("../scripts/provision-local-supabase-staff.mjs", import.meta.url), "utf8");
  const afterAcceptance = provisioner.slice(provisioner.indexOf("accepted = await acceptScopedStaffInvitations"));
  assert.match(afterAcceptance, /phase === "onboarding-proof"[\s\S]*?LOCAL_SUPABASE_STAFF_ONBOARDING_VERIFIED[\s\S]*?return;/u);
});

test("CLI lifecycle receives the same physical workdir as the strict gateway owner check", () => {
  const fixture = mkdtempSync(join(tmpdir(), "evo-staff-workdir-path-"));
  try {
    const physical = join(fixture, "physical"); mkdirSync(physical);
    const alias = join(fixture, "alias"); symlinkSync(physical, alias, "dir");
    const supplied = `${alias}//`;
    const expected = realpathSync(supplied);
    for (const name of ["test-postgres-v2-foundation.sh", "verify-platform-provider-acceptance.sh"]) {
      const harness = readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");
      const normalization = harness.split("\n").find((line) => line.startsWith('supabase_workdir="$(cd -- "$supabase_workdir" && pwd -P)"'));
      assert.ok(normalization, `${name} must canonicalize before handing ownership to the CLI`);
      const firstLifecycle = harness.indexOf('supabase --workdir "$supabase_workdir" start');
      assert.ok(harness.indexOf(normalization) < firstLifecycle);
      const actual = execFileSync("bash", ["-c", `${normalization}\nprintf '%s' "$supabase_workdir"`], {
        encoding: "utf8", env: { ...process.env, supabase_workdir: supplied },
      });
      assert.equal(actual, expected);
    }
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("failure diagnostics emit only literal error categories and query-free main timings", () => {
  const harness = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
  const diagnostic = harness.match(/"\$node_bin" - "\$app_log" <<'NODE'\n([\s\S]*?)\nNODE/u)?.[1];
  assert.ok(diagnostic);
  const fixture = mkdtempSync(join(tmpdir(), "evo-staff-log-categories-"));
  try {
    const logPath = join(fixture, "app.log");
    writeFileSync(logPath, [
      "PlatformSyntheticPrivateValueError: secret-token hidden@example.invalid",
      "PlatformAdmissionsWorkspaceRepositoryError: secret-token hidden@example.invalid",
      "GET /v3/main 200 in 363ms",
      "GET /v3/main?token=secret-token 200 in 1s",
      "GET /v3/main 200 in 1.2s",
    ].join("\n"), { mode: 0o600 });
    const result = spawnSync(process.execPath, ["-", logPath], { input: diagnostic, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `LOCAL_SUPABASE_APP_DIAGNOSTIC:${JSON.stringify({
      errorClasses: ["PlatformAdmissionsWorkspaceRepositoryError"],
      mainRequests: [{ status: 200, durationMs: 363 }, { status: 200, durationMs: 1200 }],
    })}\n`);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
