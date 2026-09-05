#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = realpathSync(tmpdir());
const harnessRoot = mkdtempSync(join(temporaryRoot, "evo-p6d-candidate-"));
const suffix = randomBytes(6).toString("hex");
const projectName = `evo-p6d-${suffix}`;
const privateNetwork = `evo_p6d_${suffix}_private`;
const webNetwork = `evo_p6d_${suffix}_web`;
const outputVolume = `evo_p6d_${suffix}_output`;
const wahaSessionVolume = `evo_p6d_${suffix}_waha_sessions`;
const appSupabaseHostname = "evolocalp6d000000000.supabase.co";
const appEnvironmentFile = join(harnessRoot, ".env.production");
const wahaEnvironmentFile = join(harnessRoot, ".env.waha");
const composeOverrideFile = join(harnessRoot, "compose.override.json");
const tlsCertificateFile = join(harnessRoot, "supabase-local.crt");
const tlsKeyFile = join(harnessRoot, "supabase-local.key");
const wahaDigest = "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c";
const wahaReference = `devlikeapro/waha@${wahaDigest}`;
const createdNetworks = new Set();
const ownedVolumes = new Set([outputVolume, wahaSessionVolume]);
const startedContainers = new Set();
let composeStarted = false;
let browser;

function required(name) {
  const value = process.env[name];
  if (!value || value !== value.trim()) throw new Error(`${name} is required from the disposable Supabase harness`);
  return value;
}

const supabaseApiUrl = required("EVO_P6D_SUPABASE_API_URL");
const supabasePublishableKey = required("EVO_P6D_SUPABASE_PUBLISHABLE_KEY");
const supabaseSecretKey = required("EVO_P6D_SUPABASE_SECRET_KEY");
const organizationId = required("EVO_P6D_ORGANIZATION_ID");
const adminEmail = required("EVO_P6D_ADMIN_EMAIL");
const adminPassword = required("EVO_P6D_ADMIN_PASSWORD");
const sensitiveValues = [supabasePublishableKey, supabaseSecretKey, adminEmail, adminPassword];

function redact(value) {
  let result = String(value ?? "");
  for (const secret of sensitiveValues) result = result.split(secret).join("[REDACTED]");
  return result.length > 8_000 ? result.slice(-8_000) : result;
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1_000,
  });
  const accepted = options.accepted ?? [0];
  if (!accepted.includes(result.status)) {
    throw new Error(
      `${options.label ?? command} failed with status ${result.status}\n${redact(result.stdout)}\n${redact(result.stderr)}`,
    );
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function docker(args, options = {}) {
  return execute("docker", ["--context", "orbstack", ...args], options);
}

function compose(args, environment, options = {}) {
  return docker([
    "compose",
    "--project-name",
    projectName,
    "--file",
    join(repositoryRoot, "docker-compose.prod.yml"),
    "--file",
    composeOverrideFile,
    ...args,
  ], { ...options, env: environment });
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }
}

function writePrivate(path, value) {
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

async function freePort() {
  const { createServer } = await import("node:net");
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a loopback port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function validateInputs() {
  const url = new URL(supabaseApiUrl);
  assert.equal(url.protocol, "http:", "Disposable Supabase must use local HTTP");
  assert(["127.0.0.1", "localhost"].includes(url.hostname), "Disposable Supabase must be loopback-only");
  assert(url.port && Number(url.port) > 0, "Disposable Supabase must expose an explicit loopback port");
  assert(supabasePublishableKey.length >= 16, "Disposable Supabase publishable key is malformed");
  assert(supabaseSecretKey.length >= 16 && supabaseSecretKey !== supabasePublishableKey, "Disposable Supabase secret key is malformed");
  assert(/^[0-9a-f-]{36}$/iu.test(organizationId), "Disposable organization id is malformed");
  return url;
}

function createNetwork(name, { internal }) {
  const args = [
    "network", "create", "--driver", "bridge",
    "--label", "com.evo.harness=p6d-release-candidate",
    "--label", `com.evo.harness.run=${suffix}`,
  ];
  if (internal) args.push("--internal");
  args.push(name);
  docker(args, { label: `Create isolated network ${name}` });
  createdNetworks.add(name);
}

function createLocalTlsCertificate() {
  execute("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
    "-days", "1", "-subj", `/CN=${appSupabaseHostname}`,
    "-addext", `subjectAltName=DNS:${appSupabaseHostname}`,
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,digitalSignature,keyCertSign,keyEncipherment",
    "-addext", "extendedKeyUsage=serverAuth",
    "-keyout", tlsKeyFile, "-out", tlsCertificateFile,
  ], { cwd: harnessRoot, label: "Create disposable local TLS certificate" });
  // The random parent directory remains 0700 on the host. Read permission is
  // required only because the non-root container receives these two files as
  // read-only bind mounts.
  chmodSync(tlsCertificateFile, 0o644);
  chmodSync(tlsKeyFile, 0o644);
}

function inspectContainer(id) {
  const rows = parseJson(docker(["container", "inspect", id]).stdout, `Container ${id}`);
  assert(Array.isArray(rows) && rows.length === 1, `Container ${id} inspection is ambiguous`);
  return rows[0];
}

async function waitForHttp(url, accepted, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastStatus = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3_000) });
      lastStatus = response.status;
      if (accepted.includes(response.status)) return response;
    } catch {
      // Startup connection failures are expected until the bounded deadline.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  throw new Error(`${url} did not return ${accepted.join("/")} before timeout (last ${lastStatus ?? "connection failure"})`);
}

async function assertSupabaseServices() {
  const headers = { apikey: supabaseSecretKey, authorization: `Bearer ${supabaseSecretKey}` };
  const auth = await fetch(new URL("/auth/v1/health", supabaseApiUrl), { headers, signal: AbortSignal.timeout(5_000) });
  assert.equal(auth.status, 200, "Supabase Auth health failed");
  const postgres = await fetch(new URL("/rest/v1/", supabaseApiUrl), { headers, signal: AbortSignal.timeout(5_000) });
  assert.equal(postgres.status, 200, "Supabase Postgres/PostgREST health failed");
  const storage = await fetch(new URL("/storage/v1/bucket", supabaseApiUrl), { headers, signal: AbortSignal.timeout(5_000) });
  assert.equal(storage.status, 200, "Supabase Storage health failed");
}

async function recordCandidateProviderBoundary(revision) {
  const headers = {
    apikey: supabaseSecretKey,
    authorization: `Bearer ${supabaseSecretKey}`,
    "content-type": "application/json",
    "content-profile": "platform",
    "accept-profile": "platform",
  };
  for (const target of ["waha", "ai"]) {
    const response = await fetch(
      new URL(
        "/rest/v1/rpc/record_messaging_integration_health_event",
        supabaseApiUrl,
      ),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_organization_id: organizationId,
          p_target: target,
          p_readiness: "unconfigured",
          p_evidence_kind: "configuration_check",
          p_reason: "P6D candidate runs without external provider configuration",
          p_evidence_ref: `p6d-candidate:${revision}:${target}`,
          p_request_id: randomUUID(),
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    assert.equal(
      response.status,
      200,
      `Could not record the ${target} candidate configuration boundary`,
    );
    const event = await response.json();
    assert.equal(event?.target, target);
    assert.equal(event?.readiness, "unconfigured");
    assert.equal(event?.evidence_kind, "configuration_check");
  }
}

function assertComposeContract(config, file) {
  assert.deepEqual(sorted(Object.keys(config.services ?? {})), ["app", "waha"], `${file} service set drifted`);
  const { app, waha } = config.services;
  assert.equal(app.platform, "linux/amd64", `${file} app platform drifted`);
  assert.equal(app.read_only, true, `${file} app root filesystem is writable`);
  assert.deepEqual(sorted(Object.keys(app.networks ?? {})), ["private", "web"]);
  assert.deepEqual(sorted(Object.keys(waha.networks ?? {})), ["private"]);
  assert.equal(waha.image, wahaReference, `${file} WAHA digest drifted`);
  for (const [name, service] of Object.entries({ app, waha })) {
    assert(service.cpus && service.mem_limit && service.pids_limit, `${file} ${name} lacks resource bounds`);
    assert.equal(service.logging?.driver, "json-file");
    assert.equal(service.logging?.options?.["max-size"], "10m");
    assert.equal(service.logging?.options?.["max-file"], "5");
    assert(service.healthcheck, `${file} ${name} lacks healthcheck`);
  }
  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, /agent-lead2-inbox|evo-lead-agent|manual-send-worker|EVO_DB_PATH|EVO_BACKUP_DIR|sqlite|drizzle/iu);
}

function canonicalCompose(file, environment) {
  const value = docker([
    "compose", "--file", join(repositoryRoot, file), "config", "--format", "json",
  ], { env: environment, label: `Render ${file}` }).stdout;
  const config = parseJson(value, file);
  assertComposeContract(config, file);
  return config;
}

function dependencyInventory(image) {
  const script = String.raw`
const fs=require('node:fs'),path=require('node:path');
const found=new Set();
function walk(root,depth=0){
  if(depth>12||!fs.existsSync(root))return;
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    if(!entry.isDirectory())continue;
    const target=path.join(root,entry.name);
    if(entry.name.startsWith('@')){walk(target,depth+1);continue;}
    const manifest=path.join(target,'package.json');
    if(fs.existsSync(manifest)){
      try{const value=JSON.parse(fs.readFileSync(manifest,'utf8'));if(value.name&&value.version)found.add(value.name+'@'+value.version);}catch{}
    }
    const nested=path.join(target,'node_modules');if(fs.existsSync(nested))walk(nested,depth+1);
  }
}
walk('/app/node_modules');process.stdout.write(JSON.stringify([...found].sort()));`;
  const values = parseJson(docker([
    "run", "--rm", "--platform", "linux/amd64", "--entrypoint", "node", image, "-e", script,
  ], { label: "Sanitized production dependency inventory" }).stdout, "Dependency inventory");
  assert(Array.isArray(values) && values.length > 0, "Final image has no production dependency inventory");
  assert.deepEqual(values, sorted(new Set(values)), "Dependency inventory is not sorted and unique");
  assert.deepEqual(values.filter((value) => /better-sqlite3|drizzle|evo-lead-agent|agent-lead2-inbox/iu.test(value)), []);
  for (const name of ["next", "react", "react-dom", "sharp"]) {
    assert(values.some((value) => value.startsWith(`${name}@`)), `Final image lacks ${name}`);
  }
  return { count: values.length, sha256: sha256(JSON.stringify(values)) };
}

function imagePathInventory(image) {
  const output = docker([
    "run", "--rm", "--platform", "linux/amd64", "--entrypoint", "sh", image,
    "-c", "find /app -maxdepth 5 -type f -print | LC_ALL=C sort",
  ], { label: "Final image path inventory" }).stdout;
  assert.match(output, /\/app\/server\.js$/mu);
  assert.doesNotMatch(output, /(?:^|\/)(?:agent-lead2-inbox|evo-lead-agent)(?:\/|$)|\/p8[^/]*|\/\.env(?:\.|$)|better-sqlite3|drizzle/iu);
  return { count: output.split("\n").filter(Boolean).length, sha256: sha256(output) };
}

async function proveMissingConfiguration(image, port) {
  const name = `evo-p6d-missing-${suffix}`;
  const id = docker([
    "run", "--detach", "--name", name, "--platform", "linux/amd64",
    "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
    "--tmpfs", "/app/.next/cache:rw,noexec,nosuid,nodev,size=128m",
    "--tmpfs", "/app/output:rw,noexec,nosuid,nodev,size=16m",
    "--publish", `127.0.0.1:${port}:3000`, image,
  ], { label: "Missing-configuration candidate boot" }).stdout;
  startedContainers.add(id);
  await waitForHttp(`http://127.0.0.1:${port}/api/health`, [200]);
  const context = await browser.newContext({ locale: "ru-RU" });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/login`);
  await page.locator("#staff-email").fill("missing-config@example.invalid");
  await page.locator("#staff-password").fill("missing-configuration-proof");
  await page.getByRole("button", { name: "Войти в CRM" }).click();
  await page.locator("#login-error").waitFor({ state: "visible" });
  assert.match(await page.locator("#login-error").innerText(), /временно недоступен/iu);
  await context.close();
  const inspection = inspectContainer(id);
  assert.equal(inspection.State.Running, true, "Missing config spawned an alternate process instead of failing the request");
  const environment = (inspection.Config.Env ?? []).join("\n");
  assert.doesNotMatch(environment, /EVO_DB_PATH|EVO_BACKUP_DIR|EVO_AGENT_|manual-send-worker/iu);
  docker(["rm", "--force", id], { label: "Missing-configuration cleanup" });
  startedContainers.delete(id);
}

async function proveBrowserAndReadiness(baseUrl, observabilitySecret) {
  const context = await browser.newContext({ locale: "ru-RU" });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`);
  await page.locator("#staff-email").fill(adminEmail);
  await page.locator("#staff-password").fill(adminPassword);
  await page.getByRole("button", { name: "Войти в CRM" }).click();
  const workspace = page.getByTestId("v3-shell");
  const loginError = page.locator("#login-error");
  try {
    await workspace.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    const facts = [`url=${page.url()}`];
    if (await loginError.isVisible().catch(() => false)) {
      facts.push(`login_error=${JSON.stringify(await loginError.innerText())}`);
    }
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (bodyText.trim()) facts.push(`body=${JSON.stringify(bodyText.trim().slice(0, 800))}`);
    throw new Error(
      `Standalone login did not reach the V3 product shell: ${facts.join(" ")}`,
      { cause: error },
    );
  }
  assert.equal(await page.getByTestId("active-role").getAttribute("data-authority-role"), "admin");
  await context.close();

  const requestId = randomUUID();
  const timestamp = String(Date.now());
  const hmac = createHmac("sha256", observabilitySecret)
    .update(`GET\n/api/readiness\n${requestId}\n${timestamp}`)
    .digest("hex");
  const response = await fetch(`${baseUrl}/api/readiness`, {
    headers: {
      "x-evo-observability-request-id": requestId,
      "x-evo-observability-timestamp": timestamp,
      "x-evo-observability-hmac-algorithm": "sha256",
      "x-evo-observability-hmac": hmac,
    },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(
    response.status,
    503,
    `Candidate without authorized provider evidence must fail readiness, received ${response.status}`,
  );
  const readiness = await response.json();
  assert.equal(readiness?.ok, false, "Readiness must remain fail-closed");
  assert.equal(readiness?.status, "not_ready");
  assert.equal(
    readiness?.components?.supabase?.status,
    "ready",
    "Authenticated readiness must prove the disposable Supabase authority",
  );
  assert.equal(
    readiness?.components?.audit_append?.status,
    "ready",
    "Authenticated readiness must prove the audit append boundary",
  );
  for (const provider of ["waha", "ai"]) {
    assert.notEqual(
      readiness?.components?.[provider]?.status,
      "ready",
      `${provider} must not claim readiness without authorized provider evidence`,
    );
    assert.equal(
      readiness?.signals?.[`${provider}_evidence_kind`],
      "configuration_check",
      `${provider} readiness must come from the current candidate configuration boundary`,
    );
  }
  return {
    httpStatus: response.status,
    applicationStatus: readiness.status,
    supabase: readiness.components.supabase.status,
    auditAppend: readiness.components.audit_append.status,
    waha: readiness.components.waha.status,
    wahaEvidenceKind: readiness.signals.waha_evidence_kind,
    ai: readiness.components.ai.status,
    aiEvidenceKind: readiness.signals.ai_evidence_kind,
  };
}

async function main() {
  const supabaseUrl = validateInputs();
  assert(execute("orb", ["status"], { label: "OrbStack status" }).stdout.includes("Running"), "OrbStack is not running");
  assert.equal(execute("docker", ["context", "show"], { label: "Docker context" }).stdout, "orbstack");
  assert.equal(execute("git", ["status", "--porcelain", "--untracked-files=all"], { label: "Git cleanliness" }).stdout, "", "Exact-head proof requires a clean worktree");
  const revision = execute("git", ["rev-parse", "HEAD"], { label: "Git revision" }).stdout;
  assert(/^[0-9a-f]{40}$/u.test(revision), "Git revision is not exact");
  const version = `p6d-${revision.slice(0, 12)}`;
  const image = `evo-crm:${revision}`;
  const appPort = await freePort();
  const missingConfigPort = await freePort();
  const observabilitySecret = randomBytes(40).toString("base64url");
  // The production observability contract intentionally accepts only the
  // managed Supabase hostname shape on default TLS. A container-local DNS
  // alias and trusted one-run certificate exercise that exact branch while
  // proxying to the disposable loopback Supabase stack.
  const appSupabaseUrl = `https://${appSupabaseHostname}`;

  await assertSupabaseServices();
  await recordCandidateProviderBoundary(revision);
  createLocalTlsCertificate();

  const appEnvironment = [
    `EVO_CRM_DOMAIN=127.0.0.1:${appPort}`,
    `EVO_CADDY_NETWORK=${webNetwork}`,
    `NEXT_PUBLIC_SUPABASE_URL=${appSupabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${supabasePublishableKey}`,
    `EVO_PLATFORM_SUPABASE_SECRET_KEY=${supabaseSecretKey}`,
    `EVO_PLATFORM_ORGANIZATION_ID=${organizationId}`,
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED=0",
    "EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET=",
    "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1",
    `EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=${observabilitySecret}`,
    "EVO_ENABLE_LOCAL_TRANSCRIPTION=0",
    "ANTHROPIC_API_KEY=",
    "ZAI_API_KEY=",
    "NEXT_PUBLIC_TRANSCRIPTION_SPLINE_SCENE_URL=",
    "",
  ].join("\n");
  const wahaEnvironment = [
    `WAHA_API_KEY=sha512:${randomBytes(64).toString("hex")}`,
    "WAHA_API_KEY_EXCLUDE_PATH=ping",
    "WAHA_PRINT_QR=false",
    `WAHA_DASHBOARD_USERNAME=p6d_${suffix}`,
    `WAHA_DASHBOARD_PASSWORD=${randomBytes(32).toString("base64url")}`,
    `WHATSAPP_SWAGGER_USERNAME=p6d_${suffix}`,
    `WHATSAPP_SWAGGER_PASSWORD=${randomBytes(32).toString("base64url")}`,
    "",
  ].join("\n");
  writePrivate(appEnvironmentFile, appEnvironment);
  writePrivate(wahaEnvironmentFile, wahaEnvironment);

  const proxySource = `const fs=require('node:fs'),http=require('node:http'),https=require('node:https');const target={host:'host.docker.internal',port:${Number(supabaseUrl.port)}};https.createServer({key:fs.readFileSync('/run/evo-p6d/supabase-local.key'),cert:fs.readFileSync('/run/evo-p6d/supabase-local.crt')},(req,res)=>{const up=http.request({...target,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:${Number(supabaseUrl.port)}'}},r=>{res.writeHead(r.statusCode??502,r.headers);r.pipe(res)});up.on('error',()=>{res.writeHead(502);res.end()});req.pipe(up)}).listen(443,'127.0.0.1');`;
  writePrivate(composeOverrideFile, `${JSON.stringify({
    services: {
      app: {
        ports: [`127.0.0.1:${appPort}:3000`],
        extra_hosts: [
          "host.docker.internal:host-gateway",
          `${appSupabaseHostname}:127.0.0.1`,
        ],
        environment: {
          NODE_EXTRA_CA_CERTS: "/run/evo-p6d/supabase-local.crt",
          EVO_P6D_LOCAL_SUPABASE_PROXY_B64: Buffer.from(proxySource).toString("base64"),
        },
        volumes: [
          `${tlsCertificateFile}:/run/evo-p6d/supabase-local.crt:ro`,
          `${tlsKeyFile}:/run/evo-p6d/supabase-local.key:ro`,
        ],
        command: ["sh", "-ec", "node -e \"eval(Buffer.from(process.env.EVO_P6D_LOCAL_SUPABASE_PROXY_B64,'base64').toString('utf8'))\" & exec node server.js"],
      },
    },
    volumes: {
      evo_crm_output: {
        name: outputVolume,
        labels: {
          "com.evo.harness": "p6d-release-candidate",
          "com.evo.harness.run": suffix,
        },
      },
      evo_crm_waha_sessions: {
        name: wahaSessionVolume,
        labels: {
          "com.evo.harness": "p6d-release-candidate",
          "com.evo.harness.run": suffix,
        },
      },
    },
  }, null, 2)}\n`);

  const composeEnvironment = {
    ...process.env,
    EVO_CADDY_NETWORK: webNetwork,
    EVO_CRM_PRIVATE_NETWORK: privateNetwork,
    EVO_CRM_APP_ENV_FILE: appEnvironmentFile,
    EVO_CRM_WAHA_ENV_FILE: wahaEnvironmentFile,
    EVO_IMAGE_SOURCE: "https://github.com/izzhackt/evo_AI_CRM",
    EVO_RELEASE_REVISION: revision,
    EVO_RELEASE_VERSION: version,
    EVO_WAHA_IMAGE_DIGEST: wahaDigest,
    EVO_WAHA_IMAGE_REPOSITORY: "devlikeapro/waha",
    EVO_PLATFORM_U11_RECOVERY_EVIDENCE_HOST_ROOT: harnessRoot,
  };

  canonicalCompose("docker-compose.prod.yml", composeEnvironment);
  canonicalCompose("docker-compose.staging.yml", composeEnvironment);
  createNetwork(privateNetwork, { internal: true });
  createNetwork(webNetwork, { internal: false });

  docker([
    "build", "--platform", "linux/amd64", "--file", "Dockerfile", "--tag", image,
    "--build-arg", "EVO_IMAGE_SOURCE=https://github.com/izzhackt/evo_AI_CRM",
    "--build-arg", `EVO_IMAGE_REVISION=${revision}`,
    "--build-arg", `EVO_IMAGE_VERSION=${version}`,
    ".",
  ], { label: "Exact-SHA linux/amd64 app build", timeout: 45 * 60 * 1_000 });

  const imageInspection = parseJson(docker(["image", "inspect", image]).stdout, "App image")[0];
  assert.equal(imageInspection.Architecture, "amd64");
  assert.equal(imageInspection.Config?.Labels?.["org.opencontainers.image.revision"], revision);
  assert.equal(imageInspection.Config?.Labels?.["org.opencontainers.image.version"], version);
  assert.equal(imageInspection.Config?.Labels?.["org.opencontainers.image.source"], "https://github.com/izzhackt/evo_AI_CRM");
  const dependencies = dependencyInventory(image);
  const paths = imagePathInventory(image);

  const cachedWaha = docker(["image", "inspect", wahaReference], { accepted: [0, 1], label: "WAHA image cache" });
  if (cachedWaha.status !== 0) docker(["pull", "--platform", "linux/amd64", wahaReference], { label: "Pull immutable WAHA image", timeout: 20 * 60 * 1_000 });

  browser = await chromium.launch({ headless: true });
  await proveMissingConfiguration(image, missingConfigPort);

  composeStarted = true;
  compose(["up", "--detach", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "240", "app", "waha"], composeEnvironment, {
    label: "Isolated app and private WAHA boot",
    timeout: 8 * 60 * 1_000,
  });
  const serviceIds = Object.fromEntries(["app", "waha"].map((service) => [
    service,
    compose(["ps", "--quiet", service], composeEnvironment, { label: `${service} id` }).stdout,
  ]));
  const app = inspectContainer(serviceIds.app);
  const waha = inspectContainer(serviceIds.waha);
  assert.equal(app.State?.Health?.Status, "healthy");
  assert.equal(waha.State?.Health?.Status, "healthy");
  assert.equal(app.RestartCount, 0);
  assert.equal(waha.RestartCount, 0);
  assert.deepEqual(sorted(Object.keys(app.NetworkSettings?.Networks ?? {})), [privateNetwork, webNetwork]);
  assert.deepEqual(sorted(Object.keys(waha.NetworkSettings?.Networks ?? {})), [privateNetwork]);
  assert.equal(parseJson(docker(["network", "inspect", privateNetwork]).stdout, "Private network")[0]?.Internal, true);
  assert.equal(parseJson(docker(["network", "inspect", webNetwork]).stdout, "Web network")[0]?.Internal, false);
  assert.equal(Object.values(waha.HostConfig?.PortBindings ?? {}).flat().filter(Boolean).length, 0, "WAHA published a port");
  for (const [name, container] of Object.entries({ app, waha })) {
    assert(container.HostConfig?.NanoCpus > 0, `${name} has no CPU bound`);
    assert(container.HostConfig?.Memory > 0, `${name} has no memory bound`);
    assert(container.HostConfig?.PidsLimit > 0, `${name} has no PID bound`);
    assert.equal(container.HostConfig?.LogConfig?.Type, "json-file");
    assert.equal(container.HostConfig?.LogConfig?.Config?.["max-size"], "10m");
    assert.equal(container.HostConfig?.LogConfig?.Config?.["max-file"], "5");
  }
  const activeServices = docker([
    "ps", "--all", "--filter", `label=com.docker.compose.project=${projectName}`,
    "--format", "{{.Label \"com.docker.compose.service\"}}",
  ], { label: "Runtime service inventory" }).stdout.split("\n").filter(Boolean);
  assert.deepEqual(sorted(activeServices), ["app", "waha"]);

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForHttp(`${baseUrl}/api/health`, [200]);
  const readinessStatus = await proveBrowserAndReadiness(baseUrl, observabilitySecret);

  const evidence = {
    schema: "evo-p6d-release-candidate/v1",
    ok: true,
    revision,
    version,
    image: {
      id: imageInspection.Id,
      architecture: imageInspection.Architecture,
      dependencyInventory: dependencies,
      pathInventory: paths,
    },
    compose: { services: ["app", "waha"], privateWaha: true, productionRendered: true, stagingRendered: true },
    supabase: { auth: "passed", postgres: "passed", storage: "passed", authority: "disposable_local_tls_proxy" },
    browser: { adminLogin: "passed" },
    health: 200,
    readiness: readinessStatus,
    missingConfiguration: "failed_closed",
    providerTraffic: false,
    productionMutation: false,
  };
  const evidenceDirectory = join(repositoryRoot, "output", "p6d-release-candidate", revision);
  mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
  const evidencePath = join(evidenceDirectory, "success.json");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(evidencePath, 0o600);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

let primaryError;
try {
  await main();
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors = [];
  if (browser) {
    try { await browser.close(); } catch (error) { cleanupErrors.push(error); }
  }
  if (composeStarted) {
    try {
      const environment = {
        ...process.env,
        EVO_CADDY_NETWORK: webNetwork,
        EVO_CRM_PRIVATE_NETWORK: privateNetwork,
        EVO_CRM_APP_ENV_FILE: appEnvironmentFile,
        EVO_CRM_WAHA_ENV_FILE: wahaEnvironmentFile,
        EVO_RELEASE_REVISION: execute("git", ["rev-parse", "HEAD"]).stdout,
        EVO_RELEASE_VERSION: "cleanup",
        EVO_WAHA_IMAGE_DIGEST: wahaDigest,
      };
      compose(["down", "--volumes", "--remove-orphans", "--timeout", "10"], environment, { label: "Candidate cleanup", timeout: 5 * 60 * 1_000 });
    } catch (error) { cleanupErrors.push(error); }
  }
  for (const id of startedContainers) {
    try { docker(["rm", "--force", id], { accepted: [0, 1], label: "Owned container cleanup" }); } catch (error) { cleanupErrors.push(error); }
  }
  for (const network of [...createdNetworks].reverse()) {
    try { docker(["network", "rm", network], { accepted: [0, 1], label: "Owned network cleanup" }); } catch (error) { cleanupErrors.push(error); }
  }
  for (const volume of ownedVolumes) {
    try { docker(["volume", "rm", volume], { accepted: [0, 1], label: "Owned volume cleanup" }); } catch (error) { cleanupErrors.push(error); }
  }
  try {
    const resolved = realpathSync(harnessRoot);
    assert.equal(dirname(resolved), temporaryRoot);
    assert(basename(resolved).startsWith("evo-p6d-candidate-"));
    rmSync(resolved, { recursive: true, force: false, maxRetries: 2 });
  } catch (error) { cleanupErrors.push(error); }
  if (primaryError && cleanupErrors.length) primaryError = new AggregateError([primaryError, ...cleanupErrors], "P6D proof and cleanup failed");
  else if (!primaryError && cleanupErrors.length) primaryError = new AggregateError(cleanupErrors, "P6D cleanup failed");
}

if (primaryError) throw primaryError;
