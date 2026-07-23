import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function requireRootComposeHardening(value) {
  assert.equal((value.match(/EVO_WAHA_IMAGE_DIGEST/g) ?? []).length, 2);
  assert.equal((value.match(/org\.opencontainers\.image\.revision:/g) ?? []).length, 2);
  assert.equal((value.match(/mem_limit:/g) ?? []).length, 3);
  assert.equal((value.match(/cpus:/g) ?? []).length, 3);
  assert.equal((value.match(/pids_limit:/g) ?? []).length, 3);
}

function requireCaddyHardening(value) {
  assert.match(value, /Content-Security-Policy-Report-Only/);
  assert.match(
    value,
    /@private path \/api\/internal \/api\/internal\/\* \/api\/readiness \/api\/readiness\/\* \/admin \/admin\/\* \/metrics/,
  );
  assert.match(value, /respond @private 404/);
  assert.match(value, /max_header_size 32KB/);
}

test("production Compose pins third parties and identifies first-party releases", async () => {
  for (const path of ["Dockerfile", "agent-lead2-inbox/Dockerfile", "evo-lead-agent/Dockerfile"]) {
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
    assert.match(await read(path), /503/);
  }
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

  const readiness = await read("agent-lead2-inbox/src/app/api/readiness/route.ts");
  assert.doesNotMatch(readiness.replace(/status: ready \? 200 : 503/, ""), /503/);
});
