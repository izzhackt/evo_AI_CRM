#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const revision = "0123456789abcdef0123456789abcdef01234567";
const digest = `sha256:${"a".repeat(64)}`;
const clamavImage = "clamav/clamav@sha256:6c92171e6ab52529cd44452f6443dd05b2fc4d580c190ffc70f45f955cb9f4b9";
const composeFiles = ["docker-compose.prod.yml"];
const forbidden = /agent-lead2-inbox|evo-lead-agent|manual-send-worker|EVO_AGENT_|EVO_DB_PATH|EVO_BACKUP_DIR|sqlite|drizzle/iu;
const baseEnvironment = {
  ...process.env,
  EVO_RELEASE_REVISION: revision,
  EVO_RELEASE_VERSION: "runtime-hardening-validation",
  EVO_IMAGE_SOURCE: "https://github.com/izzhackt/evo_AI_CRM",
  EVO_WAHA_IMAGE_DIGEST: digest,
  EVO_WAHA_IMAGE_REPOSITORY: "devlikeapro/waha",
  EVO_CRM_APP_ENV_FILE: "/dev/null",
  EVO_CRM_WAHA_ENV_FILE: "/dev/null",
  EVO_CRM_AI_AGENT_ENV_FILE: "/dev/null",
  EVO_PLATFORM_U11_RECOVERY_EVIDENCE_HOST_ROOT: "/tmp/evo-recovery-evidence",
};
const agentDigest = `sha256:${"b".repeat(64)}`;
const agentServices = ["ai-agent-api", "ai-agent-worker"];

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertServiceContract(file, config) {
  assert.deepEqual(sorted(Object.keys(config.services ?? {})), ["app", "clamav", "waha"]);
  const app = config.services.app;
  const clamav = config.services.clamav;
  const waha = config.services.waha;
  assert(app && clamav && waha, `${file} must define app, clamav and waha`);
  assert.equal(app.platform, "linux/amd64");
  assert.equal(app.read_only, true);
  assert.equal(app.labels?.["org.opencontainers.image.revision"], revision);
  assert.equal(app.labels?.["org.opencontainers.image.version"], "runtime-hardening-validation");
  assert.match(waha.image, new RegExp(`@${digest}$`, "u"));
  assert.equal(clamav.platform, "linux/amd64");
  assert.equal(clamav.image, clamavImage);
  assert.equal(clamav.init, true);
  assert.equal(clamav.restart, "unless-stopped");
  assert.equal(clamav.cpus, 2);
  assert.equal(clamav.mem_limit, "4294967296");
  assert.equal(clamav.pids_limit, 256);
  assert.deepEqual(sorted(Object.keys(app.networks ?? {})), ["private", "web"]);
  assert.deepEqual(sorted(Object.keys(clamav.networks ?? {})), ["private"]);
  assert.deepEqual(sorted(Object.keys(waha.networks ?? {})), ["private"]);
  assert.equal(app.environment?.EVO_CLAMD_HOST, "evo-crm-clamav");
  assert.equal(String(app.environment?.EVO_CLAMD_PORT), "3310");
  assert.equal(String(app.environment?.EVO_CLAMD_TIMEOUT_MS), "10000");
  assert.equal(app.depends_on?.clamav?.condition, "service_healthy");
  assert.equal(app.healthcheck?.test?.[0], "CMD-SHELL");
  assert.equal(clamav.healthcheck?.test?.[0], "CMD-SHELL");
  assert.equal(clamav.healthcheck?.test?.[1], "clamdcheck.sh");
  assert.equal(clamav.healthcheck?.timeout, "10s");
  assert.equal(clamav.healthcheck?.interval, "30s");
  assert.equal(clamav.healthcheck?.retries, 10);
  assert.equal(clamav.healthcheck?.start_period, "3m0s");
  assert.equal(waha.healthcheck?.test?.[0], "CMD-SHELL");
  for (const [name, service] of Object.entries({ app, clamav, waha })) {
    assert(service.cpus, `${file} ${name} needs a CPU limit`);
    assert(service.mem_limit, `${file} ${name} needs a memory limit`);
    assert(service.pids_limit, `${file} ${name} needs a PID limit`);
    assert.equal(service.logging?.driver, "json-file");
    assert.equal(service.logging?.options?.["max-size"], "10m");
    assert.equal(service.logging?.options?.["max-file"], "5");
    assert.deepEqual(service.ports ?? [], [], `${file} ${name} must not publish a port`);
  }
  assert.deepEqual(clamav.expose, ["3310"]);
  assert.deepEqual(clamav.volumes, [{
    type: "volume",
    source: "evo_crm_clamav_signatures",
    target: "/var/lib/clamav",
    volume: {},
  }]);
  assert(config.volumes?.evo_crm_clamav_signatures, `${file} needs persistent signatures`);
  assert.equal(clamav.labels?.["com.evo.image.provenance"], "official-third-party-digest");
  assert.equal(clamav.labels?.["com.evo.runtime.role"], "private-malware-scanner");
  assert.equal(waha.labels?.["com.evo.image.provenance"], "third-party-digest");
  assert.doesNotMatch(JSON.stringify(config), forbidden);
}

// «ИИ-агент» (plan §4.2/§4.6): rendered only with the `ai-agent` profile.
function assertAiAgentContract(file, config) {
  assert.deepEqual(sorted(Object.keys(config.services ?? {})), sorted(["app", "clamav", "waha", ...agentServices]));
  const expected = {
    "ai-agent-api": { cpus: 0.5, mem_limit: "536870912", pids_limit: 128 },
    "ai-agent-worker": { cpus: 1, mem_limit: "1610612736", pids_limit: 256 },
  };
  for (const name of agentServices) {
    const service = config.services[name];
    assert.equal(service.image, `ghcr.io/izzhackt/evo-ai-agent@${agentDigest}`, `${file} ${name} image`);
    assert.deepEqual(service.profiles, ["ai-agent"]);
    assert.equal(service.platform, "linux/amd64");
    assert.equal(service.read_only, true);
    assert.equal(service.init, true);
    assert.equal(service.user, "10001:10001");
    assert.deepEqual(service.cap_drop, ["ALL"]);
    assert.deepEqual(service.security_opt, ["no-new-privileges:true"]);
    assert.equal(service.cpus, expected[name].cpus);
    assert.equal(service.mem_limit, expected[name].mem_limit);
    assert.equal(service.pids_limit, expected[name].pids_limit);
    assert.equal(service.stop_grace_period, "30s");
    // ADR 0032: the agent's own bridge only; WAHA, clamd and the lead-agent stay on evo_crm_private.
    assert.deepEqual(Object.keys(service.networks ?? {}), ["ai"]);
    assert.deepEqual(service.ports ?? [], [], `${file} ${name} must not publish a port`);
    assert.equal(service.volumes, undefined, `${file} ${name} must not mount anything`);
    assert.equal(service.depends_on, undefined);
    assert.equal(service.logging?.options?.["max-size"], "10m");
    assert.equal(service.healthcheck?.test?.[0], "CMD");
    assert.equal(service.labels?.["com.evo.image.provenance"], "private-ghcr-digest");
  }
  assert.deepEqual(config.services["ai-agent-api"].networks.ai.aliases, ["evo-ai-agent"]);
  assert.deepEqual(config.networks?.ai, { name: "evo_crm_ai", driver: "bridge", ipam: {} });
  for (const name of ["app", "clamav", "waha"]) {
    assert.equal(Object.hasOwn(config.services[name].networks ?? {}, "ai"), false, `${file} ${name} stays off the agent bridge in the file`);
  }
  assert.deepEqual(config.services["ai-agent-worker"].command, ["python", "-m", "evo_ai_agent.worker"]);
}

// The release controller's fixed stdin override (ADR 0032): with the agent on, the app joins
// the agent bridge. It declares the bridge exactly as the compose file does.
const agentBridgeBlock = "  ai:\n    name: evo_crm_ai\n    driver: bridge\n";
function controllerAppNetworkOverride() {
  const controller = readFileSync("scripts/evo-fast-release.sh", "utf8");
  const match = /^readonly AI_AGENT_APP_NETWORK_OVERRIDE=\$'([^'\\]*(?:\\n[^'\\]*)*)'$/mu.exec(controller);
  assert(match, "the release controller defines the app-network override");
  const override = match[1].replaceAll("\\n", "\n");
  assert.equal(override, `services:\n  app:\n    networks:\n      ai:\n        aliases:\n          - evo-crm-app\nnetworks:\n${agentBridgeBlock}`);
  return override;
}

function assertAppOnAgentBridge(file, config, bridge, services) {
  assert.deepEqual(sorted(Object.keys(config.services ?? {})), sorted(services));
  assert.deepEqual(sorted(Object.keys(config.services.app.networks ?? {})), ["ai", "private", "web"]);
  assert.deepEqual(config.services.app.networks.ai.aliases, ["evo-crm-app"]);
  assert.deepEqual(config.networks?.ai, bridge, `${file}: the override and the file declare one bridge`);
  const onBridge = Object.entries(config.services).filter(([, service]) => Object.hasOwn(service.networks ?? {}, "ai"));
  assert.deepEqual(sorted(onBridge.map(([name]) => name)), sorted(["app", ...services.filter((name) => agentServices.includes(name))]));
}

for (const file of composeFiles) {
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(source, /image:\s*["']?[^@\n"']+:latest/iu);
  assert.doesNotMatch(source, forbidden);
  for (const key of ["mem_limit:", "cpus:", "pids_limit:", "logging:", "healthcheck:"]) {
    assert.equal((source.match(new RegExp(key, "gu")) ?? []).length, 5);
  }
  // The agent's secrets are read raw: no `$` substitution and no quote parsing (a render does
  // not keep env_file, so this is checked in the source).
  assert.equal((source.match(/- path: "\$\{EVO_CRM_AI_AGENT_ENV_FILE:-\.env\.ai-agent\}"\n {8}format: raw\n/gu) ?? []).length, 2);
  assert(source.endsWith(`\n${agentBridgeBlock}`), `${file} declares the agent bridge as the controller override does`);
  const appNetworkOverride = controllerAppNetworkOverride();

  if (process.argv.includes("--compose")) {
    const environment = {
      ...baseEnvironment,
      EVO_CRM_PRIVATE_NETWORK: "evo_runtime_validation_private",
      EVO_CADDY_NETWORK: "evo_runtime_validation_web",
    };
    const rendered = execFileSync(
      "docker",
      ["compose", "--file", file, "config", "--format", "json"],
      { env: environment, encoding: "utf8" },
    );
    assertServiceContract(file, JSON.parse(rendered));
    const withAgent = execFileSync(
      "docker",
      ["compose", "--file", file, "--profile", "ai-agent", "config", "--format", "json"],
      { env: { ...environment, EVO_AI_AGENT_IMAGE_DIGEST: agentDigest }, encoding: "utf8" },
    );
    const agentConfig = JSON.parse(withAgent);
    assertAiAgentContract(file, agentConfig);

    // An enabled release renders the file with the controller override: app, agent pair and
    // nothing else on the bridge. A rollback may render the override on top of a previous
    // snapshot that predates the bridge; the agent-off render of this file is such a snapshot.
    const renderWithOverride = (composeFile) => JSON.parse(execFileSync(
      "docker",
      ["compose", "--file", composeFile, "--file", "-", "--profile", "ai-agent", "config", "--format", "json"],
      { env: { ...environment, EVO_AI_AGENT_IMAGE_DIGEST: agentDigest }, encoding: "utf8", input: appNetworkOverride },
    ));
    assertAppOnAgentBridge(file, renderWithOverride(file), agentConfig.networks.ai, ["app", "clamav", "waha", ...agentServices]);
    const snapshotDir = mkdtempSync(join(tmpdir(), "evo-runtime-hardening-"));
    try {
      const snapshot = join(snapshotDir, "docker-compose.previous.yml");
      writeFileSync(snapshot, rendered);
      assert.equal(Object.hasOwn(JSON.parse(rendered).networks ?? {}, "ai"), false);
      assertAppOnAgentBridge(`${file} (pre-bridge snapshot)`, renderWithOverride(snapshot), agentConfig.networks.ai, ["app", "clamav", "waha"]);
    } finally {
      rmSync(snapshotDir, { recursive: true, force: true });
    }
  }
}

console.log(JSON.stringify({ ok: true, services: ["app", "clamav", "waha"], profiles: { "ai-agent": agentServices }, checked: composeFiles }));
