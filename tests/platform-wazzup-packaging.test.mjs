// Packaging of the Wazzup slice: the two bundles in the image, the combined timer entry, the edge handler, the env example, the
// runbook and the rollback rule. Run with:
// node --conditions=react-server --experimental-strip-types --test tests/platform-wazzup-packaging.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

const NEW_FILES = [
  "src/lib/platform-wazzup-webhook.ts",
  "src/lib/platform-wazzup-health.ts",
  "src/lib/platform-whatsapp-transport.ts",
  "src/lib/server/platform-wazzup-ingress.ts",
  "src/lib/server/platform-wazzup-ingress-config.ts",
  "src/lib/server/platform-wazzup-client.ts",
  "src/lib/server/platform-wazzup-maintenance.ts",
  "src/lib/server/platform-wazzup-ops.ts",
  "src/app/api/v2/whatsapp/wazzup/inbound/route.ts",
  "scripts/wazzup-ops.mjs",
  "docs/runbooks/wazzup-whatsapp.md",
];

const BUNDLE_OPTIONS = {
  absWorkingDir: root,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  conditions: ["react-server"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "silent",
};

async function bundleBoth() {
  const directory = mkdtempSync(join(tmpdir(), "wazzup-bundles-"));
  const timer = join(directory, "whatsapp-health-maintenance.mjs");
  const ops = join(directory, "wazzup-ops.mjs");
  await build({ ...BUNDLE_OPTIONS, entryPoints: ["scripts/whatsapp-health-maintenance.mjs"], outfile: timer });
  await build({ ...BUNDLE_OPTIONS, entryPoints: ["scripts/wazzup-ops.mjs"], outfile: ops });
  return { directory, timer, ops };
}

const run = (file, args, env, input) =>
  spawnSync(process.execPath, [file, ...args], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8", input, cwd: tmpdir() });

test("the image carries /app/wazzup-ops.mjs and the build produces it next to the timer bundle, without moving the build chain", () => {
  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /^COPY --from=builder --chown=nextjs:nodejs --chmod=0555 \/app\/\.next\/wazzup-ops\.mjs \.\/wazzup-ops\.mjs$/mu);
  assert.match(dockerfile, /^COPY --from=builder --chown=nextjs:nodejs --chmod=0555 \/app\/\.next\/whatsapp-health-maintenance\.mjs \.\/whatsapp-health-maintenance\.mjs$/mu);
  const pkg = JSON.parse(read("package.json"));
  // The Wazzup bundle is built by the existing health-maintenance builder, so the pinned order of the build chain holds.
  assert.equal(pkg.scripts["build:whatsapp-health-maintenance"], "node scripts/build-whatsapp-health-maintenance.mjs");
  assert.match(pkg.scripts.build, /npm run build:telephony-maintenance && npm run build:whatsapp-health-maintenance && npm run build:ai-agents-maintenance$/u);
  const builder = read("scripts/build-whatsapp-health-maintenance.mjs");
  assert.match(builder, /entryPoints: \["scripts\/whatsapp-health-maintenance\.mjs"\]/u);
  assert.match(builder, /outfile: "\.next\/whatsapp-health-maintenance\.mjs"/u);
  assert.match(builder, /entryPoints: \["scripts\/wazzup-ops\.mjs"\]/u);
  assert.match(builder, /outfile: "\.next\/wazzup-ops\.mjs"/u);
  assert.equal((builder.match(/conditions: \["react-server"\]/gu) ?? []).length, 2);
  for (const file of NEW_FILES) assert.ok(existsSync(join(root, file)), file);
});

test("both bundles build self-contained; the timer entry prints the old line when Wazzup is not switched on", async () => {
  const { directory, timer, ops } = await bundleBoth();
  try {
    assert.ok(statSync(timer).size > 10_000);
    assert.ok(statSync(ops).size > 10_000);
    // Neither switch: exactly the pre-Wazzup line, nothing nested.
    for (const env of [{}, { EVO_PLATFORM_WAHA_INGRESS_ENABLED: "0", EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: "0" }]) {
      const result = run(timer, [], env);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { event: "whatsapp_health_maintenance", status: "disabled", reason: "ingress_off" });
      assert.equal(result.stderr, "");
    }
    // Wazzup on without a backend: one line, the WAHA part untouched, the Wazzup part failing loudly and without a stack.
    const wazzupOnly = run(timer, [], { EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: "1" });
    assert.equal(wazzupOnly.status, 1);
    assert.deepEqual(JSON.parse(wazzupOnly.stdout), {
      event: "whatsapp_health_maintenance",
      status: "disabled",
      reason: "ingress_off",
      wazzup: { status: "failed", reason: "backend_not_configured" },
    });
    assert.equal(wazzupOnly.stderr, "");
    // Both receive switches on: the WAHA part refuses (transport_conflict) and the exit code is 1.
    const both = run(timer, [], { EVO_PLATFORM_WAHA_INGRESS_ENABLED: "1", EVO_PLATFORM_WAZZUP_INGRESS_ENABLED: "1" });
    assert.equal(both.status, 1);
    assert.deepEqual(JSON.parse(both.stdout), {
      event: "whatsapp_health_maintenance",
      status: "failed",
      reason: "transport_conflict",
      wazzup: { status: "failed", reason: "backend_not_configured" },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the ops bundle: a probe typed as an argument is refused without being read or echoed; unknown and incomplete commands exit 2; without a backend a command fails by a word", async () => {
  const { directory, ops } = await bundleBoth();
  try {
    const probe = ["synthetic", "key", "must", "never", "be", "echoed", "0001"].join("-");
    for (const args of [[], ["nope"], ["set-key", probe], ["webhooks-patch", "--on", probe], ["replay", probe], [probe]]) {
      const result = run(ops, args, {}, "stdin-must-not-be-read");
      assert.equal(result.status, 2, args.join(" ").replace(probe, "<secret>"));
      assert.ok(!result.stdout.includes(probe) && !result.stderr.includes(probe));
      assert.equal(JSON.parse(result.stdout).ok, false);
      assert.equal(result.stderr, "");
    }
    // No backend configuration: a database command stops at a fixed word, no stack trace, nothing about the environment.
    for (const args of [["channels"], ["webhooks-get"], ["transport", "none"]]) {
      const result = run(ops, args, {});
      assert.equal(result.status, 1, args.join(" "));
      assert.deepEqual(JSON.parse(result.stdout), { ok: false, error: "backend_not_configured" });
      assert.equal(result.stderr, "");
    }
    // A malformed key piped in never reaches the network: the shape check comes first and the answer is a word.
    const malformed = run(ops, ["set-key"], {}, "short\n");
    assert.equal(malformed.status, 1);
    assert.deepEqual(JSON.parse(malformed.stdout), { ok: false, error: "key_shape_invalid" });
    assert.ok(!malformed.stdout.includes("short"));
    // Replay without a token never reads the batch.
    const noToken = run(ops, ["replay"], {}, '{"messages":[]}');
    assert.deepEqual(JSON.parse(noToken.stdout), { ok: false, error: "token_unavailable" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the ops script and the timer script never log a value they handle: no console output of keys, tokens or bodies in the new modules", () => {
  for (const file of [
    "src/lib/server/platform-wazzup-ops.ts",
    "src/lib/server/platform-wazzup-client.ts",
    "src/lib/server/platform-wazzup-maintenance.ts",
    "src/lib/server/platform-wazzup-ingress.ts",
  ]) {
    const source = read(file);
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
    // Only the declared sinks: the ops `print`, the ingress `defaultLog` (counters only) and the stdin prompt on stderr.
    const sinks = code.match(/console\.\w+\(/gu) ?? [];
    const allowed = { "src/lib/server/platform-wazzup-ops.ts": 1, "src/lib/server/platform-wazzup-ingress.ts": 1 }[file] ?? 0;
    assert.equal(sinks.length, allowed, `${file}: ${sinks.join(", ")}`);
    assert.ok(!/\bdebugger\b/u.test(code));
    assert.ok(!/process\.argv/u.test(code), `${file}: arguments are read only by the entry script`);
  }
  assert.match(read("scripts/wazzup-ops.mjs"), /runWazzupOps\(process\.argv\.slice\(2\)\)/u);
});

test("the edge handler: public path on crm. only, 1 MiB, overwritten address header, the hold during a release, and the token redacted in the access log", () => {
  const edge = read("agent-lead2-inbox/deploy/Caddyfile.evo-edge");
  const site = edge.slice(edge.indexOf("crm.evoadmissions.com, app.evoadmissions.com {"));
  const crm = site.slice(0, site.indexOf("\n}\n") + 3);
  assert.match(crm, /@wazzup path \/api\/v2\/whatsapp\/wazzup\/inbound\n\thandle @wazzup \{/u);
  assert.match(crm, /@wazzup_not_crm not host crm\.evoadmissions\.com\n\t\trespond @wazzup_not_crm 404/u);
  assert.match(crm, /request_body \{\n\t\t\tmax_size 1MiB\n\t\t\}/u);
  assert.match(crm, /header_up X-Evo-Wazzup-Ip \{remote_host\}/u);
  assert.match(crm, /lb_try_duration 25s/u);
  assert.match(crm, /lb_try_interval 500ms/u);
  // The common proxy and its header are unchanged and come after the handler.
  assert.ok(crm.indexOf("handle @wazzup") < crm.lastIndexOf("reverse_proxy evo-crm-app:3000 {\n\t\theader_up X-Evo-Mcp-Ip {remote_host}"));
  // The path is public: in neither private list.
  const privateLists = edge.match(/@private path [^\n]+/gu) ?? [];
  assert.equal(privateLists.length, 2);
  for (const list of privateLists) assert.ok(!list.includes("wazzup"), list);
  assert.equal(edge.includes("/api/v2/whatsapp/inbound/*"), true, "the WAHA path stays private");
  // The access log of the CRM hosts replaces the query value `token`.
  const snippet = edge.slice(edge.indexOf("(evo_app) {"), edge.indexOf("(evo_canonical_api_paths)"));
  assert.match(snippet, /request>uri query \{\n\t\t\t\treplace token_hash REDACTED\n\t\t\t\treplace token REDACTED\n\t\t\t\}/u);
  // The retired technical host has no Wazzup route at all.
  const retired = edge.slice(edge.indexOf("(evo_retired_app) {"), edge.indexOf("evo-crm.72.62.119.112.sslip.io {"));
  assert.ok(!retired.includes("wazzup"));
});

test("the env example documents the three names (stop off, tokens empty) and no name for the Wazzup API key", () => {
  const example = read("deploy/env.production.example");
  assert.match(example, /^EVO_PLATFORM_WAZZUP_INGRESS_ENABLED=0$/mu);
  assert.match(example, /^EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN=$/mu);
  assert.match(example, /^EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT=$/mu);
  assert.ok(!/WAZZUP_(?:API|KEY|SECRET)/u.test(example.replace(/#.*$/gmu, "")));
  assert.match(example, /EMERGENCY STOP/u);
  assert.match(example, /wazzup-ops set-key/u);
});

test("the runbook carries the rules an operator needs: the key on stdin only, confirmation by last four digits, rotation, the three timer steps, rollback", () => {
  const runbook = read("docs/runbooks/wazzup-whatsapp.md");
  for (const phrase of [
    "read -rs K && printf '%s' \"$K\" | sudo docker exec -i evo-crm-app-1 node /app/wazzup-ops.mjs set-key; unset K",
    "wazzup-ops transport wazzup --ai-trigger off",
    "webhooks-patch --on",
    "webhooks-patch --off",
    "--confirm-last4",
    "--owner-approved",
    "address_occupied",
    "transport_inactive",
    "transport_conflict",
    "receive_only",
    "`409 transport_wazzup`",
    "ingress_off_transport_wazzup",
    "COUNTS_GAP",
    "counts_match",
    "oldest_pending_seconds",
    "EVO_PLATFORM_WAZZUP_INGRESS_ENABLED",
    "EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT",
    "openssl rand -hex 32",
    "wazzup_channel_id IS NOT NULL",
    "caddy validate",
    "token=REDACTED",
    "/api/v2/whatsapp/wazzup/inbound",
    "wazzup24.ru/help/api-ru/webhooks-2/",
    "qridle",
    "openelsewhere",
    "Sidecar",
  ]) {
    assert.ok(runbook.includes(phrase), `the runbook lacks: ${phrase}`);
  }
  // Nothing in it asks for the key or the token on a command line.
  assert.ok(!/set-key\s+[A-Za-z0-9_-]{16,}/u.test(runbook));
  assert.ok(!/token=[0-9a-f]{64}/u.test(runbook));
});

test("the rollback rule is in the release procedure and the timer note describes the Wazzup part", () => {
  const release = read("deploy/production-release.md");
  assert.match(release, /WhatsApp through Wazzup/u);
  assert.match(release, /SELECT count\(\*\) AS wazzup_conversations/u);
  assert.match(release, /the rollback is\s+forbidden/u);
  assert.match(release, /wazzup-ops transport none/u);
  const timer = read("deploy/whatsapp/README.md");
  for (const phrase of ["`sweep`", "`health`", "`reconcile`", "transport_inactive", "transport_conflict", "GET /v3/channels"]) assert.ok(timer.includes(phrase), phrase);
  // The unit itself did not change: still the same oneshot docker exec.
  assert.match(read("deploy/whatsapp/evo-whatsapp-health.service"), /^ExecStart=\/usr\/bin\/docker exec evo-crm-app-1 node \/app\/whatsapp-health-maintenance\.mjs$/mu);
});

test("this slice adds no migration, no plan file and no direct amoCRM call; migrations 324-325 are the ones it stands on", () => {
  assert.ok(existsSync(join(root, "supabase/migrations/324_platform_wazzup_provider.sql")));
  assert.ok(existsSync(join(root, "supabase/migrations/325_platform_wazzup_intake.sql")));
  assert.ok(!existsSync(join(root, "supabase/migrations/326_platform_wazzup_app.sql")));
  for (const file of NEW_FILES.filter((item) => item.startsWith("src/") || item.startsWith("scripts/"))) {
    assert.ok(!/amocrm\.(?:ru|com)|kommo\.com/iu.test(read(file)), `${file}: the timer calls no amoCRM host`);
  }
});

test("the repository is public: the new files hold no real-looking phone number, e-mail address or key", () => {
  const files = [...NEW_FILES, "tests/platform-wazzup-ingress.test.mjs", "tests/platform-wazzup-client.test.mjs", "tests/platform-wazzup-ops.test.mjs",
    "tests/platform-wazzup-maintenance.test.mjs", "tests/platform-wazzup-refusals.test.mjs", "tests/platform-wazzup-webhook.test.mjs", "tests/platform-wazzup-packaging.test.mjs",
    "agent-lead2-inbox/deploy/Caddyfile.evo-edge", "deploy/env.production.example", "deploy/whatsapp/README.md"];
  for (const file of files) {
    const source = read(file);
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/u.test(source.replace(/user@host/gu, "")), `${file}: an e-mail address`);
    for (const match of source.matchAll(/(?<![\w-])\+?\d{10,15}(?![\w-])/gu)) {
      assert.match(match[0], /^(?:\+?9960\d+|\+?1415555\d+|\+?0+\d+)$/u, `${file}: a number that does not look synthetic: ${match[0].slice(0, 6)}…`);
    }
  }
});
