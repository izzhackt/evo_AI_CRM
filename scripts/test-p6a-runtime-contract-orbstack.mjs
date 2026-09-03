#!/usr/bin/env node

import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(repositoryRoot, "docker-compose.prod.yml");
const appEnvironmentExample = join(repositoryRoot, "deploy", "env.production.example");
const appEnvironmentValidator = join(repositoryRoot, "scripts", "evo-app-env-contract.mjs");
const temporaryRoot = realpathSync(tmpdir());
const harnessRoot = mkdtempSync(join(temporaryRoot, "evo-p6a-runtime-"));
const appEnvironmentFile = join(harnessRoot, ".env.production");
const wahaEnvironmentFile = join(harnessRoot, ".env.waha");
const suffix = randomBytes(6).toString("hex");
const projectName = `evo-p6a-${suffix}`;
const privateNetwork = "evo_crm_private";
const webNetwork = `evo_p6a_web_${suffix}`;
const wahaDigest = "sha256:dc134637dfa0bd65202010a65e4ff8176101791699176c75bb37d5aa9daf487c";
const wahaReference = `devlikeapro/waha@${wahaDigest}`;
const forbiddenEnvironmentNames = new Set([
  "AUTH_SECRET",
  "EVO_BACKUP_DIR",
  "EVO_DB_PATH",
  "EVO_SECRET_ENCRYPTION_KEY",
  "EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED",
  "EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET",
  "EVO_PLATFORM_MANUAL_SEND_WORKER_ENABLED",
  "EVO_AGENT_WAHA_SESSION",
  "EVO_PLATFORM_WAHA_SESSION_NAME",
]);
const createdNetworks = new Set();

let composeReady = false;
let composeEnvironment;
let primaryError;

function tail(value, size = 6_000) {
  const text = String(value ?? "");
  return text.length > size ? text.slice(-size) : text;
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 10 * 60 * 1_000,
  });
  const accepted = options.accepted ?? [0];
  if (!accepted.includes(result.status)) {
    throw new Error(
      `${options.label ?? command} failed with status ${result.status}\n${tail(result.stdout)}\n${tail(result.stderr)}`,
    );
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function docker(args, options = {}) {
  return execute("docker", ["--context", "orbstack", ...args], options);
}

function compose(args, options = {}) {
  return docker(
    [
      "compose",
      "--project-name",
      projectName,
      "--file",
      composeFile,
      "--env-file",
      appEnvironmentFile,
      ...args,
    ],
    { ...options, env: composeEnvironment },
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertExact(actual, expected, label) {
  assert(
    JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected)),
    `${label} mismatch: expected ${expected.join(", ")}; received ${actual.join(", ") || "none"}.`,
  );
}

function inspectNetwork(name, accepted = [0]) {
  const result = docker(["network", "inspect", name], {
    accepted,
    label: `Inspect network ${name}`,
  });
  if (result.status !== 0) return null;
  const records = parseJson(result.stdout, `Network ${name}`);
  assert(Array.isArray(records) && records.length === 1, `Network ${name} inspection is ambiguous.`);
  return records[0];
}

function ensureEmptyNetwork(name) {
  const existing = inspectNetwork(name, [0, 1]);
  if (existing) {
    assert(Object.keys(existing.Containers ?? {}).length === 0, `Network ${name} is already in use; refusing alias collision.`);
    assert(existing.Internal === true, `Network ${name} is not private; refusing the local proof.`);
    return;
  }
  docker([
    "network",
    "create",
    "--driver",
    "bridge",
    "--internal",
    "--label",
    "com.evo.harness=p6a-runtime-contract",
    "--label",
    `com.evo.harness.run=${suffix}`,
    name,
  ], { label: `Create harness network ${name}` });
  const created = inspectNetwork(name);
  assert(created?.Labels?.["com.evo.harness.run"] === suffix, `Network ${name} ownership could not be proven.`);
  createdNetworks.add(name);
}

function writePrivateFile(path, value) {
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
}

function inspectContainer(id) {
  const records = parseJson(docker(["container", "inspect", id]).stdout, `Container ${id}`);
  assert(Array.isArray(records) && records.length === 1, `Container ${id} inspection is ambiguous.`);
  return records[0];
}

function environmentNames(values) {
  return new Set((values ?? []).map((entry) => entry.slice(0, entry.indexOf("="))).filter(Boolean));
}

function assertNoForbiddenEnvironment(container, label) {
  const names = environmentNames(container.Config?.Env);
  const forbidden = [...names].filter((name) => (
    forbiddenEnvironmentNames.has(name) || name.startsWith("EVO_AGENT_")
  ));
  assert(forbidden.length === 0, `${label} retained forbidden environment names: ${forbidden.join(", ")}.`);
}

function assertNoPublishedPorts(container, label) {
  const bindings = container.HostConfig?.PortBindings ?? {};
  const published = Object.entries(bindings).filter(([, value]) => Array.isArray(value) && value.length > 0);
  assert(published.length === 0, `${label} unexpectedly publishes host ports.`);
}

function assertHealthy(container, label) {
  assert(container.State?.Running === true, `${label} is not running.`);
  assert(container.State?.Health?.Status === "healthy", `${label} is not healthy.`);
  assert(container.RestartCount === 0, `${label} restarted ${container.RestartCount} time(s).`);
}

async function waitForHealthy(service, timeoutMs = 180_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const id = compose(["ps", "--all", "--quiet", service]).stdout;
    if (id) {
      const container = inspectContainer(id);
      if (container.State?.Health?.Status === "healthy") return container;
      if (container.State?.Running === false || container.State?.Health?.Status === "unhealthy") {
        throw new Error(`${service} stopped before reaching healthy state.`);
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  throw new Error(`${service} did not become healthy within ${timeoutMs}ms.`);
}

function assertComposeContract(config) {
  assertExact(Object.keys(config.services ?? {}), ["app", "waha"], "Configured services");
  assertExact(Object.keys(config.services.app?.networks ?? {}), ["private", "web"], "App networks");
  assertExact(Object.keys(config.services.waha?.networks ?? {}), ["private"], "WAHA networks");
  const appTargets = (config.services.app?.volumes ?? []).map((mount) => mount.target);
  const wahaTargets = (config.services.waha?.volumes ?? []).map((mount) => mount.target);
  assertExact(appTargets, ["/app/output"], "App mounts");
  assertExact(wahaTargets, ["/app/.sessions"], "WAHA mounts");
  for (const service of Object.values(config.services ?? {})) {
    const names = new Set(Object.keys(service.environment ?? {}));
    const forbidden = [...names].filter((name) => (
      forbiddenEnvironmentNames.has(name) || name.startsWith("EVO_AGENT_")
    ));
    assert(forbidden.length === 0, `Compose retained forbidden environment names: ${forbidden.join(", ")}.`);
  }
  assert(config.services.waha?.environment?.WAHA_PRINT_QR === "false", "WAHA_PRINT_QR must be false.");
  assert(config.services.waha?.image === wahaReference, "WAHA must use the approved immutable digest.");
}

async function run() {
  assert(execute("orb", ["status"], { label: "OrbStack status" }).stdout.includes("Running"), "OrbStack is not running.");
  assert(execute("docker", ["context", "show"], { label: "Docker context" }).stdout === "orbstack", "Docker context must be exactly orbstack.");
  const status = execute("git", ["status", "--porcelain", "--untracked-files=all"], { label: "Git cleanliness" }).stdout;
  assert(status === "", "Exact-head harness requires a clean worktree.");
  const revision = execute("git", ["rev-parse", "HEAD"], { label: "Git head" }).stdout;
  assert(/^[0-9a-f]{40}$/u.test(revision), "Git HEAD is not a full commit SHA.");

  const appEnvironment = [
    `EVO_CRM_DOMAIN=p6a-${suffix}.invalid`,
    `EVO_CADDY_NETWORK=${webNetwork}`,
    "NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co",
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_${randomBytes(24).toString("base64url")}`,
    `EVO_PLATFORM_SUPABASE_SECRET_KEY=sb_secret_${randomBytes(32).toString("base64url")}`,
    `EVO_PLATFORM_ORGANIZATION_ID=${randomUUID()}`,
    "EVO_UI_CONTRACT_FIXTURES=0",
    "EVO_PLATFORM_WAHA_INGRESS_ENABLED=0",
    "EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET=",
    "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0",
    "EVO_PLATFORM_P7B_OBSERVABILITY_SECRET=",
    "EVO_ALLOW_DEMO_SEED=0",
    "ANTHROPIC_API_KEY=",
    "ZAI_API_KEY=",
    "NEXT_PUBLIC_TRANSCRIPTION_SPLINE_SCENE_URL=",
    "EVO_ENABLE_LOCAL_TRANSCRIPTION=0",
    "",
  ].join("\n");
  const wahaEnvironment = [
    `WAHA_API_KEY=sha512:${randomBytes(64).toString("hex")}`,
    "WAHA_API_KEY_EXCLUDE_PATH=ping",
    "WAHA_PRINT_QR=false",
    `WAHA_DASHBOARD_USERNAME=harness_${suffix}`,
    `WAHA_DASHBOARD_PASSWORD=${randomBytes(32).toString("base64url")}`,
    `WHATSAPP_SWAGGER_USERNAME=harness_${suffix}`,
    `WHATSAPP_SWAGGER_PASSWORD=${randomBytes(32).toString("base64url")}`,
    "",
  ].join("\n");
  writePrivateFile(appEnvironmentFile, appEnvironment);
  writePrivateFile(wahaEnvironmentFile, wahaEnvironment);

  composeEnvironment = {
    ...process.env,
    EVO_CADDY_NETWORK: webNetwork,
    EVO_CRM_APP_ENV_FILE: appEnvironmentFile,
    EVO_CRM_WAHA_ENV_FILE: wahaEnvironmentFile,
    EVO_IMAGE_SOURCE: "https://github.com/izzhackt/evo_AI_CRM",
    EVO_RELEASE_REVISION: revision,
    EVO_RELEASE_VERSION: `p6a-${revision.slice(0, 12)}`,
    EVO_WAHA_IMAGE_DIGEST: wahaDigest,
    EVO_WAHA_IMAGE_REPOSITORY: "devlikeapro/waha",
  };
  execute("node", [appEnvironmentValidator, "--example", appEnvironmentExample, "--env", appEnvironmentFile], {
    label: "Application environment contract",
  });
  docker(["image", "inspect", wahaReference], { label: "Cached immutable WAHA image" });

  const config = parseJson(compose(["config", "--format", "json"]).stdout, "Compose config");
  assertComposeContract(config);
  ensureEmptyNetwork(privateNetwork);
  ensureEmptyNetwork(webNetwork);
  composeReady = true;

  compose(["build", "app"], { label: "Exact-head app image build", timeout: 30 * 60 * 1_000 });
  compose(["up", "--detach", "--no-build", "--pull", "never", "app", "waha"], {
    label: "Two-service runtime boot",
    timeout: 5 * 60 * 1_000,
  });

  const [app, waha] = await Promise.all([waitForHealthy("app"), waitForHealthy("waha")]);
  assertHealthy(app, "App");
  assertHealthy(waha, "WAHA");
  assertExact(
    docker(["ps", "--all", "--filter", `label=com.docker.compose.project=${projectName}`, "--format", "{{.Label \"com.docker.compose.service\"}}"])
      .stdout.split("\n").filter(Boolean),
    ["app", "waha"],
    "Runtime services",
  );
  assertExact(Object.keys(app.NetworkSettings?.Networks ?? {}), [privateNetwork, webNetwork], "Runtime app networks");
  assertExact(Object.keys(waha.NetworkSettings?.Networks ?? {}), [privateNetwork], "Runtime WAHA networks");
  assertNoPublishedPorts(waha, "WAHA");
  assertNoForbiddenEnvironment(app, "App");
  assertNoForbiddenEnvironment(waha, "WAHA");
  assertExact((app.Mounts ?? []).map((mount) => mount.Destination), ["/app/output"], "Runtime app mounts");
  assertExact((waha.Mounts ?? []).map((mount) => mount.Destination), ["/app/.sessions"], "Runtime WAHA mounts");
  assert(app.Config?.Labels?.["org.opencontainers.image.revision"] === revision, "App container revision label does not match HEAD.");
  const appImage = parseJson(docker(["image", "inspect", app.Image]).stdout, "App image")[0];
  assert(appImage?.Config?.Labels?.["org.opencontainers.image.revision"] === revision, "App image revision label does not match HEAD.");
  assert(waha.Image === wahaDigest, "WAHA runtime image does not match the approved cached digest.");

  const healthStatus = docker([
    "exec",
    app.Id,
    "node",
    "-e",
    "fetch('http://127.0.0.1:3000/api/health').then(r=>process.stdout.write(String(r.status))).catch(()=>process.exit(2))",
  ], { label: "Application liveness request" }).stdout;
  const disabledReadinessStatus = docker([
    "exec",
    app.Id,
    "node",
    "-e",
    "fetch('http://127.0.0.1:3000/api/readiness').then(r=>process.stdout.write(String(r.status))).catch(()=>process.exit(2))",
  ], { label: "Disabled private readiness request" }).stdout;
  assert(healthStatus === "200", `Application liveness returned ${healthStatus}.`);
  assert(disabledReadinessStatus === "404", `Disabled private readiness did not fail closed: ${disabledReadinessStatus}.`);

  process.stdout.write(`${JSON.stringify({ ok: true, revision, services: ["app", "waha"], healthy: true, readiness: "disabled_fail_closed", restarts: { app: 0, waha: 0 }, realProviderTraffic: false })}\n`);
}

function removeOwnedNetwork(name) {
  const network = inspectNetwork(name, [0, 1]);
  if (!network) return;
  assert(network.Labels?.["com.evo.harness.run"] === suffix, `Refusing to remove network ${name}: ownership changed.`);
  assert(Object.keys(network.Containers ?? {}).length === 0, `Refusing to remove network ${name}: it still has attached containers.`);
  docker(["network", "rm", name], { label: `Remove harness network ${name}` });
}

try {
  await run();
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors = [];
  if (composeReady) {
    try {
      compose(["down", "--volumes", "--remove-orphans", "--timeout", "10"], {
        label: "Harness Compose cleanup",
        timeout: 3 * 60 * 1_000,
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const name of [...createdNetworks].reverse()) {
    try {
      removeOwnedNetwork(name);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    const resolvedHarnessRoot = realpathSync(harnessRoot);
    assert(dirname(resolvedHarnessRoot) === temporaryRoot, "Harness temp directory escaped the system temp root.");
    assert(basename(resolvedHarnessRoot).startsWith("evo-p6a-runtime-"), "Harness temp directory prefix is invalid.");
    rmSync(resolvedHarnessRoot, { recursive: true, force: false, maxRetries: 2 });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (!primaryError && cleanupErrors.length > 0) primaryError = new AggregateError(cleanupErrors, "Harness cleanup failed.");
  else if (primaryError && cleanupErrors.length > 0) primaryError = new AggregateError([primaryError, ...cleanupErrors], "Harness and cleanup failed.");
}

if (primaryError) throw primaryError;
