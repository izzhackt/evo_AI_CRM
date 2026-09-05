#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
  EVO_PLATFORM_U11_RECOVERY_EVIDENCE_HOST_ROOT: "/tmp/evo-recovery-evidence",
};

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

for (const file of composeFiles) {
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(source, /image:\s*["']?[^@\n"']+:latest/iu);
  assert.doesNotMatch(source, forbidden);
  for (const key of ["mem_limit:", "cpus:", "pids_limit:", "logging:", "healthcheck:"]) {
    assert.equal((source.match(new RegExp(key, "gu")) ?? []).length, 3);
  }

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
  }
}

console.log(JSON.stringify({ ok: true, services: ["app", "clamav", "waha"], checked: composeFiles }));
