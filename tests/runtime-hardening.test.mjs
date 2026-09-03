import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function requireRootComposeHardening(value) {
  assert.equal((value.match(/EVO_WAHA_IMAGE_DIGEST/g) ?? []).length, 2);
  assert.equal((value.match(/org\.opencontainers\.image\.revision:/g) ?? []).length, 1);
  assert.equal((value.match(/mem_limit:/g) ?? []).length, 2);
  assert.equal((value.match(/cpus:/g) ?? []).length, 2);
  assert.equal((value.match(/pids_limit:/g) ?? []).length, 2);
}

function composeServiceNames(value) {
  const services = value
    .slice(value.indexOf("services:\n") + "services:\n".length)
    .split(/\n(?:networks|volumes):\n/, 1)[0];
  return [...services.matchAll(/^  ([a-z][a-z0-9-]+):\s*$/gm)]
    .map((match) => match[1]);
}

function requireCaddyHardening(value) {
  assert.match(value, /Content-Security-Policy-Report-Only/);
  assert.match(
    value,
    /@private path \/api\/internal \/api\/internal\/\* \/api\/readiness \/api\/readiness\/\* \/admin \/admin\/\* \/metrics \/metrics\/\*/,
  );
  assert.match(value, /respond @private 404/);
  assert.match(value, /max_header_size 32KB/);
}

const p7bCredentialHeaders = [
  "Cookie",
  "Authorization",
  "Proxy-Authorization",
  "X-Evo-Observability-Request-Id",
  "X-Evo-Observability-Timestamp",
  "X-Evo-Observability-Hmac-Algorithm",
  "X-Evo-Observability-Hmac",
  "X-Api-Key",
  "X-Hub-Signature-256",
  "X-Webhook-Hmac",
  "X-Webhook-Hmac-Algorithm",
  "X-Cron-Secret",
  "Idempotency-Key",
  "X-Evo-Agent-Admin-Key",
  "X-Evo-Agent-Signature",
  "X-Evo-Agent-Signature-Algorithm",
  "X-Evo-Worker-Hmac",
  "X-Evo-Worker-Hmac-Algorithm",
  "X-Evo-Autonomous-Reply-Hmac",
  "X-Evo-Autonomous-Reply-Hmac-Algorithm",
  "X-Evo-Portal-Overdue-Hmac",
  "X-Evo-Portal-Overdue-Hmac-Algorithm",
  "X-Evo-Gemini-Hmac",
  "X-Evo-Gemini-Hmac-Algorithm",
  "X-Evo-History-Hmac",
  "X-Evo-History-Hmac-Algorithm",
  "X-Evo-Media-Hmac",
  "X-Evo-Media-Hmac-Algorithm",
];

function serviceBlock(compose, service) {
  const match = compose.match(
    new RegExp(
      `^  ${service}:\\n[\\s\\S]*?(?=^  [a-z][a-z0-9-]+:\\n|^networks:\\n|^volumes:\\n)`,
      "m",
    ),
  );
  assert.ok(match, `missing ${service} service`);
  return match[0];
}

function requireP7bEdgeHardening(value) {
  assert.match(
    value,
    /@private path[^\n]*\/api\/readiness[^\n]*\/metrics \/metrics\/\*/,
  );
  assert.match(value, /respond @private 404/);
  for (const header of p7bCredentialHeaders) {
    assert.match(
      value,
      new RegExp(`request>headers>${header} delete`),
      `Caddy access logs must delete ${header}`,
    );
  }
}

function requireInboxReadinessFailureStatus(value) {
  assert.match(value, /const status = ready \? 200 : 503/);
  assert.match(value, /status,/);
}

test("production Compose pins third parties and identifies first-party releases", async () => {
  for (const path of ["Dockerfile", "agent-lead2-inbox/Dockerfile"]) {
    const value = await read(path);
    for (const line of value.match(/^FROM .+$/gm) ?? []) {
      assert.match(line, /@sha256:[a-f0-9]{64}(?:\s|$)/, `${path}: ${line}`);
    }
  }

  for (const path of [
    "docker-compose.prod.yml",
    "agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml",
    "agent-lead2-inbox/deploy/docker-compose.edge.yml",
  ]) {
    const value = await read(path);
    for (const forbidden of [/image:\s*["']?[^@\n"']+:latest/i, /image:\s*caddy:[^\s@]+/i]) {
      assert.doesNotMatch(value, forbidden, `${path} contains a mutable image`);
    }
  }

  for (const path of [
    "docker-compose.prod.yml",
    "agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml",
  ]) {
    const value = await read(path);
    assert.match(value, /org\.opencontainers\.image\.revision/);
    assert.match(value, /org\.opencontainers\.image\.version/);
  }
});

test("successor Compose files expose only the app and its private WAHA transport", async () => {
  for (const path of ["docker-compose.prod.yml", "docker-compose.staging.yml"]) {
    const value = await read(path);
    const app = serviceBlock(value, "app");
    assert.deepEqual(composeServiceNames(value), ["app", "waha"], path);
    assert.match(app, /^    read_only: true$/mu, path);
    assert.match(app, /- \/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777/u, path);
    assert.match(app, /- \/app\/\.next\/cache:rw,noexec,nosuid,nodev,size=128m,mode=0700,uid=1001,gid=1001/u, path);
    assert.doesNotMatch(
      value,
      /manual-send-worker|lead-agent|evo-inbox|EVO_AGENT_|EVO_DB_PATH|EVO_BACKUP_DIR|evo_crm_(?:staging_)?(?:data|backups|lead_agent_data)/u,
      path,
    );
    assert.match(serviceBlock(value, "waha"), /^    expose:\n      - "3000"$/mu);
    assert.doesNotMatch(serviceBlock(value, "waha"), /^    ports:/mu);

    if (path === "docker-compose.staging.yml") {
      const volumeBlock = app.match(/^    volumes:\n(?:      - .+\n)+/mu)?.[0];
      const tmpfsBlock = app.match(/^    tmpfs:\n(?:      - .+\n)+/mu)?.[0];
      assert.ok(volumeBlock, "missing staging app volumes");
      assert.ok(tmpfsBlock, "missing staging app tmpfs");
      assert.match(volumeBlock, /:\/app\/recovery-evidence:ro/u);
      assert.doesNotMatch(tmpfsBlock, /recovery-evidence/u);
    }
  }

  requireRootComposeHardening(await read("docker-compose.prod.yml"));
});

test("successor app image does not bake superseded SQLite and worker paths", async () => {
  const dockerfile = await read("Dockerfile");
  assert.doesNotMatch(
    dockerfile,
    /EVO_DB_PATH|EVO_BACKUP_DIR|\/app\/(?:data|backups)|bootstrap-admin\.mjs|backup-sqlite\.mjs|manual-whatsapp-send-worker\.mjs/u,
  );
});

test("every production service has effective resource and log rotation limits", async () => {
  for (const path of [
    "docker-compose.prod.yml",
    "agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml",
    "agent-lead2-inbox/deploy/docker-compose.edge.yml",
  ]) {
    const value = await read(path);
    const services = value
      .slice(value.indexOf("services:\n") + "services:\n".length)
      .split(/\n(?:networks|volumes):\n/, 1)[0];
    const serviceCount = [...services.matchAll(/^  [a-z][a-z0-9-]+:\s*$/gm)].length;
    assert.equal([...value.matchAll(/^    mem_limit:/gm)].length, serviceCount, path);
    assert.equal([...value.matchAll(/^    cpus:/gm)].length, serviceCount, path);
    assert.equal([...value.matchAll(/^    pids_limit:/gm)].length, serviceCount, path);
    assert.equal([...value.matchAll(/^    logging:/gm)].length, serviceCount, path);
  }
});

test("edge configuration denies private routes and sets bounded security policy", async () => {
  const value = await read("agent-lead2-inbox/deploy/Caddyfile.evo-edge");
  assert.match(value, /max_header_size\s+32KB/);
  assert.match(value, /request_body\s*\{[\s\S]*max_size\s+20MB/);
  assert.match(value, /Content-Security-Policy/);
  assert.match(value, /Cache-Control\s+"no-store"/);
  assert.match(value, /@private[\s\S]*\/api\/readiness \/api\/readiness\/\*/);
  assert.match(value, /respond @private 404/);
});

test("liveness and readiness remain separate contracts", async () => {
  for (const path of [
    "src/app/api/health/route.ts",
    "agent-lead2-inbox/src/app/api/health/route.ts",
  ]) {
    const value = await read(path);
    assert.match(value, /status: ['"]live['"]/);
    assert.doesNotMatch(value, /fetch\(/);
  }
  for (const path of [
    "src/app/api/readiness/route.ts",
    "agent-lead2-inbox/src/app/api/readiness/route.ts",
  ]) {
    const route = await read(path);
    const implementation = path.startsWith("src/")
      ? await read("src/lib/server/platform-observability-routes.ts")
      : "";
    assert.match(`${route}\n${implementation}`, /503/);
  }
});

test("P7B edge, WAHA liveness, and empty-secret defaults fail closed", async () => {
  const rootCompose = await read("docker-compose.prod.yml");
  const inboxCompose = await read(
    "agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml",
  );
  for (const compose of [rootCompose, inboxCompose]) {
    const waha = serviceBlock(compose, "waha");
    assert.match(waha, /127\.0\.0\.1:3000\/ping/);
    assert.doesNotMatch(waha, /127\.0\.0\.1:3000\/health/);
  }

  for (const path of [
    "deploy/env.waha.example",
    "agent-lead2-inbox/deploy/env.waha.example",
  ]) {
    const value = await read(path);
    assert.match(value, /^WAHA_API_KEY_EXCLUDE_PATH=ping$/m);
    assert.doesNotMatch(value, /WAHA_API_KEY_EXCLUDE_PATH=.*health/);
  }

  for (const path of [
    "agent-lead2-inbox/.env.local.example",
    "agent-lead2-inbox/deploy/env.production.example",
  ]) {
    const value = await read(path);
    assert.match(value, /^EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0$/m);
    assert.match(value, /^EVO_INBOX_P7B_OBSERVABILITY_SECRET=$/m);
  }

  requireP7bEdgeHardening(
    await read("agent-lead2-inbox/deploy/Caddyfile.evo-edge"),
  );
});

test("P7B operations runbook defines every frozen response procedure", async () => {
  const runbook = await read("docs/runbooks/p7b-operations.md");
  const runbookIds = [
    "RB-P7B-SUPABASE-UNAVAILABLE",
    "RB-P7B-QUEUE-BACKLOG",
    "RB-P7B-UNKNOWN-DELIVERY",
    "RB-P7B-WAHA-DEGRADED",
    "RB-P7B-AI-UNAVAILABLE",
    "RB-P7B-PRIVATE-MEDIA",
    "RB-P7B-AUDIT-APPEND",
    "RB-P7B-RESTORE-EVIDENCE",
    "RB-P7B-ROLLBACK-KILL-SWITCH",
  ];

  const headings = runbook.match(/^## RB-P7B-[A-Z-]+$/gm) ?? [];
  assert.equal(headings.length, runbookIds.length);
  for (const runbookId of runbookIds) {
    assert.match(runbook, new RegExp(`^## ${runbookId}$`, "m"));
  }
  assert.match(runbook, /Do not delete or rewrite operational evidence/);
  assert.match(runbook, /do not retry an unknown send result/i);
});

test("negative fixtures fail closed when required deployment controls disappear", async () => {
  const compose = await read("docker-compose.prod.yml");
  for (const pattern of [
    /@\$[{]EVO_WAHA_IMAGE_DIGEST[^}]*[}]/,
    /org\.opencontainers\.image\.revision:[^\n]*/,
    /mem_limit:[^\n]*/,
    /cpus:[^\n]*/,
    /pids_limit:[^\n]*/,
  ]) {
    assert.throws(() => requireRootComposeHardening(compose.replace(pattern, "")));
  }

  const caddy = await read("agent-lead2-inbox/deploy/Caddyfile.evo-edge");
  for (const pattern of [
    /Content-Security-Policy-Report-Only[^\n]*/,
    /@private[^\n]*/,
    /respond @private 404/,
    /max_header_size 32KB/,
  ]) {
    assert.throws(() => requireCaddyHardening(caddy.replace(pattern, "")));
  }
  assert.throws(() =>
    requireP7bEdgeHardening(
      caddy.replace(
        /request>headers>X-Evo-Observability-Hmac delete/,
        "",
      ),
    ),
  );

  const readiness = await read("agent-lead2-inbox/src/app/api/readiness/route.ts");
  assert.throws(() =>
    requireInboxReadinessFailureStatus(
      readiness.replace(/const status = ready \? 200 : 503;/, ""),
    ),
  );
});
