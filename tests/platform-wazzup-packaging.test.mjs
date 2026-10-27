// Packaging of the Wazzup slice: the two bundles in the image, the combined timer entry, the edge handler, the env example, the
// runbook and the rollback rule. Run with:
// node --conditions=react-server --experimental-strip-types --test tests/platform-wazzup-packaging.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
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
    // Replay takes event ids only: no ids is a usage error whatever arrives on stdin, and with ids but no token nothing is read or sent.
    const bare = run(ops, ["replay"], {}, '{"messages":[]}');
    assert.equal(bare.status, 2);
    assert.deepEqual(JSON.parse(bare.stdout), { ok: false, error: "event_ids_required" });
    const noToken = run(ops, ["replay", "77700000-0000-4000-8000-0000000000e1"], {}, '{"messages":[]}');
    assert.equal(noToken.status, 1);
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
  // The matcher is exact on the ORIGINAL request URI (not only the cleaned path), so the odd spellings that Caddy's `path` matcher
  // folds into this path fall through to the `respond` guards, which run after `handle` (see the runtime test below).
  assert.match(
    crm,
    /\trequest_header -X-Evo-Wazzup-Ip\n\t@wazzup \{\n\t\tpath \/api\/v2\/whatsapp\/wazzup\/inbound\n\t\tvars_regexp \{http\.request\.orig_uri\} `\^\/api\/v2\/whatsapp\/wazzup\/inbound\(\\\?\|\$\)`\n\t\}\n\thandle @wazzup \{/u,
  );
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

// ---------------------------------------------------------------- the edge, on the pinned Caddy image
// Same image and offline discipline as scripts/test-p7b-caddy-runtime.sh: the digest is read from that script, the image is never
// pulled here, and the test is skipped (visibly) when Docker or the image is not on this machine. The real Caddyfile is adapted
// as is; the live run changes only the site address (plain HTTP on 8080) and the upstream (a stub inside the same container).
const CADDY_IMAGE = /readonly CADDY_IMAGE="(caddy@sha256:[0-9a-f]{64})"/u.exec(read("scripts/test-p7b-caddy-runtime.sh"))?.[1] ?? "";
const WEBSITE_HEADER_EXAMPLE = join(root, "agent-lead2-inbox/deploy/website-intake-header.caddy.example");
const EDGE_FILE = join(root, "agent-lead2-inbox/deploy/Caddyfile.evo-edge");

function caddyImageIsHere() {
  if (CADDY_IMAGE === "") return false;
  const probe = spawnSync("docker", ["image", "inspect", CADDY_IMAGE], { encoding: "utf8", timeout: 15_000 });
  return probe.status === 0;
}

test("caddy adapt: the Wazzup handle is taken only for the original URI, the 404 guards stay in the route and the common proxy still follows", { skip: !caddyImageIsHere() && "Docker or the pinned Caddy image is not available here" }, () => {
  const adapted = spawnSync("docker", ["run", "--rm", "--network", "none",
    "-v", `${EDGE_FILE}:/etc/caddy/Caddyfile:ro`, "-v", `${WEBSITE_HEADER_EXAMPLE}:/data/evo-website/intake-header.caddy:ro`,
    CADDY_IMAGE, "caddy", "adapt", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(adapted.status, 0, adapted.stderr);
  const servers = Object.values(JSON.parse(adapted.stdout).apps.http.servers);
  const crm = servers.flatMap((server) => server.routes).find((route) => JSON.stringify(route.match ?? []).includes("crm.evoadmissions.com"));
  assert.ok(crm, "the crm. site");
  const routes = crm.handle[0].routes;
  const index = (predicate) => routes.findIndex(predicate);
  const wazzup = index((route) => JSON.stringify(route.match ?? []).includes("wazzup"));
  const privateList = index((route) => route.handle?.[0]?.handler === "static_response" && JSON.stringify(route.match ?? []).includes("/api/internal"));
  const canonical = index((route) => route.handle?.[0]?.handler === "static_response" && JSON.stringify(route.match ?? []).includes("reject_noncanonical_api"));
  const proxy = routes.length - 1;
  assert.ok(wazzup >= 0 && privateList >= 0 && canonical >= 0, "the three routes exist");
  // `handle` really runs before both `respond` guards: this is why its matcher has to be exact on its own.
  assert.ok(wazzup < privateList && wazzup < canonical && canonical < proxy && privateList < proxy);
  // One matcher set = AND: the cleaned path AND the original URI.
  const [matcher, ...others] = routes[wazzup].match;
  assert.equal(others.length, 0);
  assert.deepEqual(matcher.path, ["/api/v2/whatsapp/wazzup/inbound"]);
  assert.equal(matcher.vars_regexp["{http.request.orig_uri}"].pattern, "^/api/v2/whatsapp/wazzup/inbound(\\?|$)");
  // Both guards answer 404; the client-supplied address header is deleted for every route, before the handler sets its own.
  assert.equal(routes[privateList].handle[0].status_code, 404);
  assert.equal(routes[canonical].handle[0].status_code, 404);
  assert.ok(routes.slice(0, wazzup).some((route) => route.handle?.some((handler) => handler.handler === "headers" && handler.request?.delete?.includes("X-Evo-Wazzup-Ip"))));
  assert.equal(routes[proxy].handle[0].handler, "reverse_proxy");
});

test("the edge at runtime: only the canonical Wazzup URI reaches the Wazzup handler; crafted spellings get the existing 404 guards and cannot bring their own address header", { skip: !caddyImageIsHere() && "Docker or the pinned Caddy image is not available here" }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "wazzup-edge-"));
  const name = `evo-wazzup-edge-test-${process.pid}-${Date.now()}`;
  try {
    // The real file with its site address and upstream swapped for plain HTTP and a stub in the same Caddy: the body of the site block is untouched.
    const source = read("agent-lead2-inbox/deploy/Caddyfile.evo-edge")
      .replace(/^\{\n/u, "{\n\tadmin off\n\tauto_https off\n")
      .replace("crm.evoadmissions.com, app.evoadmissions.com {", "http://crm.evoadmissions.com:8080, http://app.evoadmissions.com:8080 {")
      .replaceAll("evo-crm-app:3000", "127.0.0.1:3000");
    assert.ok(source.includes("http://crm.evoadmissions.com:8080") && source.includes("127.0.0.1:3000"));
    writeFileSync(join(directory, "Caddyfile"), `${source}\nhttp://:3000 {\n\trespond "UPSTREAM {http.request.header.X-Evo-Wazzup-Ip}" 200\n}\n`);
    const started = spawnSync("docker", ["run", "-d", "--rm", "--name", name, "--memory", "128m", "-p", "127.0.0.1::8080",
      "-v", `${join(directory, "Caddyfile")}:/test/Caddyfile:ro`, "-v", `${WEBSITE_HEADER_EXAMPLE}:/data/evo-website/intake-header.caddy:ro`,
      CADDY_IMAGE, "caddy", "run", "--config", "/test/Caddyfile", "--adapter", "caddyfile"], { encoding: "utf8", timeout: 60_000 });
    assert.equal(started.status, 0, started.stderr);
    const mapping = spawnSync("docker", ["port", name, "8080/tcp"], { encoding: "utf8", timeout: 15_000 }).stdout;
    const port = Number(/127\.0\.0\.1:(\d+)/u.exec(mapping)?.[1]);
    assert.ok(Number.isInteger(port) && port > 0, "the published port");

    // node:http sends the path exactly as written (no dot-segment or percent normalisation).
    const request = (path, { method = "POST", host = "crm.evoadmissions.com" } = {}) => new Promise((resolve, reject) => {
      const outgoing = httpRequest({ host: "127.0.0.1", port, method, path, headers: { host, "x-evo-wazzup-ip": "6.6.6.6" } }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      });
      outgoing.on("error", reject);
      outgoing.end(method === "POST" ? "{}" : undefined);
    });
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
      ready = await request("/api/health", { method: "GET" }).then((answer) => answer.status === 200, () => false);
      if (!ready) await new Promise((wait) => setTimeout(wait, 250));
    }
    assert.ok(ready, "the disposable edge answered");

    // Canonical: the Wazzup handler sets the address from the peer, never the client's 6.6.6.6.
    for (const path of ["/api/v2/whatsapp/wazzup/inbound", "/api/v2/whatsapp/wazzup/inbound?token=abc", "/api/v2/whatsapp/wazzup/inbound?x=/../"]) {
      const answer = await request(path);
      assert.equal(answer.status, 200, path);
      assert.match(answer.body, /^UPSTREAM (?!6\.6\.6\.6$)\S+$/u, `${path}: the address header is the peer's`);
    }
    assert.equal((await request("/api/v2/whatsapp/wazzup/inbound?token=abc", { host: "app.evoadmissions.com" })).status, 404, "app. never serves it");

    // Crafted spellings that the cleaned `path` matcher alone would have folded into the Wazzup path: the guards answer, nothing reaches the app.
    for (const path of [
      "/api/internal/ai-agent/storage/X%2f..%2f..%2f..%2f..%2fv2%2fwhatsapp%2fwazzup%2finbound?token=abc",
      "/api/internal/x%2f..%2f..%2fv2/whatsapp/wazzup/inbound",
      "/api/v2/whatsapp/inbound/x/../../wazzup/inbound",
      "/api/internal/x/../../v2/whatsapp/wazzup/inbound?token=abc",
      "/api//v2/whatsapp/wazzup/inbound?token=abc",
    ]) {
      const answer = await request(path);
      assert.equal(answer.status, 404, path);
      assert.ok(!answer.body.includes("UPSTREAM"), path);
    }
    // Spellings outside /api (no guard of this block covers them, as before this route existed) reach the common proxy only without the client's address header.
    for (const path of ["/metrics%2f..%2fapi/v2/whatsapp/wazzup/inbound", "/api/v2/whatsapp/wazzup/%69nbound?token=abc", "/API/V2/whatsapp/wazzup/inbound?token=abc"]) {
      const answer = await request(path);
      assert.equal(answer.status, 200, path);
      assert.equal(answer.body, "UPSTREAM ", `${path}: the client's X-Evo-Wazzup-Ip is dropped`);
    }
    // The private WAHA path stays private.
    assert.equal((await request("/api/v2/whatsapp/inbound")).status, 404);
  } finally {
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", timeout: 30_000 });
    rmSync(directory, { recursive: true, force: true });
  }
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
    "transport_mismatch",
    "env_wazzup_on_db_waha",
    "env_wazzup_off_db_wazzup",
    "env_waha_off_db_waha",
    "env_waha_on_db_wazzup",
    "whatsapp_transport_read_v1",
    "whatsapp_intake_events_read_v1",
    "event_ids_required",
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
    // the contract and the example env come from the release SHA (envcheck against a stale pre-Wazzup contract passes a conflicting env)
    "git show \"$SHA:scripts/evo-app-env-contract.mjs\"",
    "git show \"$SHA:deploy/env.production.example\"",
    "EVO_SUPABASE_PROJECT_REF",
    "app_env_snapshot_seal_failed",
    // the guarded edge procedure and its rollback
    "wz_check",
    "wz_smoke",
    "/root/evo-config-backups",
    "Caddyfile.wazzup",
    "whatsapp-go-live.md",
    "request_header -X-Evo-Wazzup-Ip",
    // the reconcile word outside its window
    "`reconcile_status` — `not_due` вне окна сверки",
  ]) {
    assert.ok(runbook.includes(phrase), `the runbook lacks: ${phrase}`);
  }
  // Nothing in it asks for the key or the token on a command line.
  assert.ok(!/set-key\s+[A-Za-z0-9_-]{16,}/u.test(runbook));
  assert.ok(!/token=[0-9a-f]{64}/u.test(runbook));
});

test("the runbook's live-edge procedure: the expected added lines are exactly what the Caddyfile adds, the write follows backup, check and validate, and the rollback restores the backup in place", () => {
  const runbook = read("docs/runbooks/wazzup-whatsapp.md");
  const edge = read("agent-lead2-inbox/deploy/Caddyfile.evo-edge");
  // What the Caddyfile adds to the live file: the Wazzup directives of the crm./app. block and one line of the (evo_app) log filter.
  const site = edge.slice(edge.indexOf("crm.evoadmissions.com, app.evoadmissions.com {"));
  const from = site.indexOf("\trequest_header -X-Evo-Wazzup-Ip\n");
  const handleStart = site.indexOf("\thandle @wazzup {\n");
  const handleEnd = site.indexOf("\n\t}\n", handleStart) + 4;
  assert.ok(from > 0 && handleStart > from && handleEnd > handleStart);
  const added = site.slice(from, handleEnd).split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  added.push("replace token REDACTED");
  // The runbook's list (single-quoted words of the printf that feeds `sort`).
  const listStart = runbook.indexOf("WZ_ADDED=$(printf '%s\\n' \\");
  const listEnd = runbook.indexOf("| sort)", listStart);
  assert.ok(listStart > 0 && listEnd > listStart, "the WZ_ADDED list");
  const listed = [...runbook.slice(listStart, listEnd).replace("printf '%s\\n' \\", "").matchAll(/'([^']*)'/gu)].map((match) => match[1]);
  assert.deepEqual([...listed].sort(), [...added].sort(), "the runbook's expected added lines are stale against the Caddyfile");
  // The log filter line is really new in the (evo_app) snippet (the global block has its own, indented differently).
  assert.match(edge.slice(edge.indexOf("(evo_app) {"), edge.indexOf("(evo_canonical_api_paths)")), /\t\t\t\treplace token REDACTED\n/u);

  // The order of the procedure: check -> backup -> write (cp in place, never mv) -> validate -> reload; WROTE is set before cp.
  const procedure = runbook.slice(runbook.indexOf("### Правка живого файла"), runbook.indexOf("## 7. Проверка на настоящем пути"));
  const at = (needle) => {
    const index = procedure.indexOf(needle);
    assert.ok(index >= 0, `the procedure lacks: ${needle}`);
    return index;
  };
  assert.ok(at("cp -p \"$LIVE\" \"$BK\"") < at("WROTE=1 && cp \"$NEW\" \"$LIVE\"") && at("WROTE=1 && cp \"$NEW\" \"$LIVE\"") < at("caddy validate --config")
    && at("caddy validate --config") < at("caddy reload --config") && at("caddy reload --config") < at("edge-smoke.wazzup.after"));
  const commands = [...procedure.matchAll(/```bash\n([\s\S]*?)```/gu)].map((match) => match[1]).join("\n");
  assert.ok(!/(?:^|[\s;&|])mv\s|cat\s*>\s*"?\$LIVE|docker (?:restart|compose)|compose (?:up|down)/u.test(commands), "never mv / cat > / restart the shared edge");
  assert.match(procedure, /\[ -s "\$\{NEW:-\}" \]/u, "an empty source is refused before anything is written");
  assert.match(procedure, /cmp -s "\$LIVE" "\$BK"/u, "the backup must equal the live file right before the write");
  assert.match(procedure, /\[ "\$VALIDATED" = "\$SHA" \]/u, "reload only after a validate on this very file");
  // Section 9 carries the edge rollback: restore the backup into the same file, validate, reload, smoke.
  const rollback = runbook.slice(runbook.indexOf("## 9. Откат"), runbook.indexOf("**Ротация токена:**"));
  assert.ok(rollback.indexOf("cp \"$BK\" \"$LIVE\"") > 0 && rollback.indexOf("cp \"$BK\" \"$LIVE\"") < rollback.indexOf("caddy validate --config")
    && rollback.indexOf("caddy validate --config") < rollback.indexOf("caddy reload --config") && rollback.indexOf("caddy reload --config") < rollback.indexOf("wz_smoke |"));
  assert.match(rollback, /grep -q 'crm\[\.\]evoadmissions\[\.\]com' "\$BK"/u, "only a backup that holds the crm. host is restored");
});

test("the runbook's A6 event ids are the test client's inbound events in the A2-A5 window, the very query the SQL suite runs - not the latest events", () => {
  const runbook = read("docs/runbooks/wazzup-whatsapp.md");
  const suite = read("supabase/tests/platform_wazzup_intake.sql");
  const between = (text) => {
    const begin = text.indexOf("-- A6_EVENT_IDS_BEGIN");
    const end = text.indexOf("-- A6_EVENT_IDS_END", begin);
    assert.ok(begin >= 0 && end > begin);
    return text.slice(begin + "-- A6_EVENT_IDS_BEGIN".length, end).replace(/\s+/gu, " ").trim();
  };
  assert.equal(between(runbook), between(suite), "the runbook's query and the tested one differ");
  assert.match(between(runbook), /b\.kind = 'inbound'/u);
  assert.match(between(runbook), /c\.canonical_client_id = :'test_client'::uuid/u);
  assert.doesNotMatch(runbook, /order by received_at desc|limit 2/u, "the replay ids are never «the latest two»");
  assert.ok(runbook.includes("не «последние»") || runbook.includes("Не брать «последние N»"));
  assert.ok(runbook.includes("не меньше трёх"));
  assert.ok(suite.includes("A6 ids: exactly the three inbound events"), "the SQL suite proves the selection");
});

test("the rollback rule is in the release procedure and the timer note describes the Wazzup part", () => {
  const release = read("deploy/production-release.md");
  assert.match(release, /WhatsApp through Wazzup/u);
  assert.match(release, /SELECT count\(\*\) AS wazzup_conversations/u);
  assert.match(release, /the rollback is\s+forbidden/u);
  assert.match(release, /wazzup-ops transport none/u);
  const timer = read("deploy/whatsapp/README.md");
  for (const phrase of ["`sweep`", "`health`", "`reconcile`", "transport_inactive", "transport_conflict", "GET /v3/channels", "whatsapp_transport_read_v1", "transport_mismatch"]) assert.ok(timer.includes(phrase), phrase);
  // The unit itself did not change: still the same oneshot docker exec.
  assert.match(read("deploy/whatsapp/evo-whatsapp-health.service"), /^ExecStart=\/usr\/bin\/docker exec evo-crm-app-1 node \/app\/whatsapp-health-maintenance\.mjs$/mu);
});

test("the app stands on migrations 324-326 (the follow-ups 326 carry the two service reads the timer and `replay` call), adds no plan file and no direct amoCRM call", () => {
  assert.ok(existsSync(join(root, "supabase/migrations/324_platform_wazzup_provider.sql")));
  assert.ok(existsSync(join(root, "supabase/migrations/325_platform_wazzup_intake.sql")));
  const followups = read("supabase/migrations/326_platform_wazzup_followups.sql");
  // The two functions the app calls by name exist in 326, and the app calls nothing else of it.
  for (const name of ["platform.whatsapp_transport_read_v1", "platform.whatsapp_intake_events_read_v1"]) assert.ok(followups.includes(`CREATE FUNCTION ${name}(`), name);
  assert.match(read("src/lib/server/platform-wazzup-maintenance.ts"), /rpc\("whatsapp_transport_read_v1"/u);
  assert.match(read("src/lib/server/platform-wazzup-ops.ts"), /rpc\("whatsapp_intake_events_read_v1"/u);
  assert.ok(!existsSync(join(root, "supabase/migrations/326_platform_wazzup_app.sql")));
  assert.ok(existsSync(join(root, "docs/adr/0036-receive-sales-whatsapp-via-wazzup-sidecar.md")));
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
