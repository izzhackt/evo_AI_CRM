import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const forbiddenRuntime =
  /agent-lead2-inbox|evo-lead-agent|manual-send-worker|EVO_AGENT_|EVO_DB_PATH|EVO_BACKUP_DIR|sqlite|drizzle/iu;

function serviceNames(value) {
  const start = value.indexOf("services:\n") + "services:\n".length;
  const services = value.slice(start).split(/\n(?:networks|volumes):\n/u, 1)[0];
  return [...services.matchAll(/^  ([a-z][a-z0-9-]+):\s*$/gmu)].map((match) => match[1]);
}

function serviceBlock(value, name) {
  const match = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]+:\\s*$|^volumes:|^networks:)`, "mu")
    .exec(value);
  assert(match, `missing ${name} service`);
  return match[0];
}

for (const file of ["docker-compose.prod.yml"]) {
  test(`${file} is exactly the hardened app, private scanner and private-WAHA successor`, async () => {
    const value = await read(file);
    assert.deepEqual(serviceNames(value), ["app", "clamav", "waha"]);
    assert.doesNotMatch(value, forbiddenRuntime);
    assert.doesNotMatch(value, /image:\s*["']?[^@\n"']+:latest/iu);

    const app = serviceBlock(value, "app");
    const clamav = serviceBlock(value, "clamav");
    const waha = serviceBlock(value, "waha");
    assert.match(app, /platform: linux\/amd64/u);
    assert.match(app, /read_only: true/u);
    assert.match(app, /org\.opencontainers\.image\.revision/u);
    assert.match(app, /\/api\/health/u);
    assert.match(app, /EVO_CLAMD_HOST: "evo-crm-clamav"/u);
    assert.match(app, /clamav:[\s\S]*condition: service_healthy/u);
    assert.match(clamav, /platform: linux\/amd64/u);
    assert.match(clamav, /clamav\/clamav@sha256:6c92171e6ab52529cd44452f6443dd05b2fc4d580c190ffc70f45f955cb9f4b9/u);
    assert.match(clamav, /evo_crm_clamav_signatures:\/var\/lib\/clamav/u);
    assert.match(clamav, /clamdcheck\.sh/u);
    assert.doesNotMatch(clamav, /^\s+ports:/mu);
    assert.match(waha, /@\$\{EVO_WAHA_IMAGE_DIGEST:/u);
    assert.match(waha, /127\.0\.0\.1:3000\/ping/u);
    assert.doesNotMatch(waha, /^\s+ports:/mu);

    for (const block of [app, clamav, waha]) {
      assert.match(block, /cpus:/u);
      assert.match(block, /mem_limit:/u);
      assert.match(block, /pids_limit:/u);
      assert.match(block, /logging:/u);
      assert.match(block, /healthcheck:/u);
    }
  });
}

test("the final application image is narrow, non-root and exact-revision labelled", async () => {
  const dockerfile = await read("Dockerfile");
  assert.match(dockerfile, /FROM node:22-bookworm-slim@sha256:/u);
  assert.match(dockerfile, /LABEL org\.opencontainers\.image\.source=/u);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision=/u);
  assert.match(dockerfile, /COPY --from=builder --chown=nextjs:nodejs \/app\/\.next\/standalone/u);
  assert.match(dockerfile, /USER nextjs/u);
  assert.doesNotMatch(dockerfile, forbiddenRuntime);
  assert.doesNotMatch(dockerfile, /COPY --from=builder .*node_modules/u);
});

test("the Docker context excludes secrets, frozen applications and non-runtime evidence", async () => {
  const ignored = new Set((await read(".dockerignore")).split(/\r?\n/u).filter(Boolean));
  for (const entry of [
    ".git",
    ".env*",
    "node_modules",
    "output",
    "agent-lead2-inbox",
    "evo-lead-agent",
    "tests",
    "docs/archive",
    "docs/evidence",
  ]) {
    assert(ignored.has(entry), `missing Docker ignore: ${entry}`);
  }
});

test("runtime hardening validation checks only the root successor Compose models", async () => {
  const validator = await read("scripts/validate-runtime-hardening.mjs");
  assert.match(validator, /docker-compose\.prod\.yml/u);
  assert.doesNotMatch(validator, /docker-compose\.staging\.yml/u);
  assert.match(validator, /\["app", "clamav", "waha"\]/u);
  assert.doesNotMatch(validator, /agent-lead2-inbox\/deploy|evo-lead-agent\/deploy/u);
});

test("root health is minimal and private readiness fails closed", async () => {
  const health = await read("src/app/api/health/route.ts");
  const readiness = await read("src/lib/server/platform-observability-routes.ts");
  assert.match(health, /ok:\s*true, status:\s*"live"/u);
  assert.doesNotMatch(health, /database|supabase|waha|provider/iu);
  assert.match(readiness, /emptyPlatformObservabilityNotFound/u);
  assert.match(readiness, /emptyServiceUnavailable/u);
});
