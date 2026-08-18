import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import test from "node:test";

import {
  createDockerExecutor,
  parseProductionRows,
  renderProductionInspectCommands,
} from "../scripts/p8v2-production-operations.mjs";

const IMAGE_ID = process.env.EVO_P8V2C_FIXTURE_IMAGE_ID ?? "";
const OWNER_LABEL = "evo.p8v2c.baseline-owner";
const ID = /^[0-9a-f]{64}$/;
const IMAGE = /^sha256:[0-9a-f]{64}$/;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    signal: result.signal ?? null,
  };
}

function success(result, label) {
  assert.equal(result.signal, null, `${label} received a signal`);
  assert.equal(result.status, 0, `${label} failed`);
  return result.stdout;
}

function inventory(docker) {
  const output = success(docker(["container", "ls", "-a", "--no-trunc", "--format", "{{.Names}}|{{.ID}}"]), "container inventory");
  const rows = new Map();
  for (const line of output.trim().split("\n").filter(Boolean)) {
    const [name, id, ...rest] = line.split("|");
    assert.equal(rest.length, 0, "container inventory row is malformed");
    assert.match(id, ID, "container inventory ID is malformed");
    assert.equal(rows.has(name), false, "container inventory name is duplicated");
    rows.set(name, id);
  }
  return rows;
}

function inspectOwnership(docker, id, nonce) {
  const rows = JSON.parse(success(docker(["container", "inspect", id]), "container inspect"));
  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.Id, id);
  assert.equal(row.Image, IMAGE_ID);
  assert.equal(row.Config?.Labels?.[OWNER_LABEL], nonce);
  return row;
}

function assertFixtureRuntime(row) {
  assert.equal(row.HostConfig?.NetworkMode, "none");
  assert.equal(row.HostConfig?.RestartPolicy?.Name, "no");
  assert.equal(row.Mounts?.length, 0);
  return row;
}

function cleanupFixtures(docker, { names, observed, owned, nonce }) {
  const errors = [];
  for (const [name, id] of owned) {
    try {
      const current = inventory(docker);
      const namedId = current.get(name) ?? null;
      const foreignError = namedId !== null && namedId !== id ? new Error(`foreign container occupies fixture name: ${name}`) : null;
      if (![...current.values()].includes(id)) throw new Error(`owned fixture disappeared: ${id}`);
      inspectOwnership(docker, id, nonce);
      success(docker(["container", "rm", "-f", id]), `remove ${name}`);
      if (foreignError) throw foreignError;
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    const final = inventory(docker);
    const remainingNames = names.filter((name) => final.has(name));
    const remainingIds = [...observed.values()].filter((id) => [...final.values()].includes(id));
    if (remainingNames.length || remainingIds.length) throw new Error("fixture names or observed IDs remain after cleanup");
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

test("P8V2C exact five-row producer executes on owned OrbStack fixtures", { timeout: 120_000 }, async () => {
  assert.equal(process.platform, "darwin", "the P8V2C fixture gate is macOS/OrbStack-only");
  assert.match(IMAGE_ID, IMAGE, "EVO_P8V2C_FIXTURE_IMAGE_ID must be one immutable local image ID");

  const docker = createDockerExecutor(run);
  const imageRows = JSON.parse(success(docker(["image", "inspect", IMAGE_ID]), "fixture image inspect"));
  assert.equal(imageRows.length, 1);
  assert.equal(imageRows[0].Id, IMAGE_ID);

  const nonce = randomBytes(12).toString("hex");
  const names = Array.from({ length: 5 }, (_, index) => `evo-p8v2c-baseline-${index}-${nonce}`);
  const observed = new Map();
  const owned = new Map();
  let primaryError = null;

  try {
    const before = inventory(docker);
    for (const name of names) assert.equal(before.has(name), false, `fixture name collision: ${name}`);

    for (const name of names) {
      const runResult = docker([
        "run", "-d", "--pull", "never", "--name", name,
        "--label", `${OWNER_LABEL}=${nonce}`,
        "--network", "none", "--restart", "no",
        "--health-cmd", "node -e \"process.exit(0)\"",
        "--health-interval", "100ms", "--health-timeout", "1s", "--health-retries", "1",
        IMAGE_ID, "node", "-e", "setInterval(()=>{},1000)",
      ], { timeout: 30_000 });
      const afterRun = inventory(docker);
      const observedId = afterRun.get(name) ?? "";
      if (ID.test(observedId)) {
        observed.set(name, observedId);
        const inspected = inspectOwnership(docker, observedId, nonce);
        owned.set(name, observedId);
        assertFixtureRuntime(inspected);
      }
      assert.equal(runResult.status, 0, `fixture start failed: ${name}`);
      assert.equal(runResult.signal, null, `fixture start signaled: ${name}`);
      assert.equal(runResult.stdout.trim(), observedId, `fixture start identity drifted: ${name}`);
    }

    for (const [name, id] of owned) {
      let healthy = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const row = success(docker(["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}", id]), `${name} health`).trim();
        if (row === "healthy") { healthy = true; break; }
        assert.ok(row === "starting", `${name} health drifted: ${row}`);
        await wait(100);
      }
      assert.equal(healthy, true, `${name} did not become healthy`);
    }

    const rendered = [];
    for (const args of renderProductionInspectCommands(names)) {
      rendered.push(success(docker(args), "baseline row render").trim().replace(/^\//, ""));
    }
    const expected = names.map((name) => ({ name, containerId: owned.get(name), imageId: IMAGE_ID }));
    const parsed = parseProductionRows(`${rendered.join("\n")}\n`, expected);
    assert.equal(parsed.length, 5);
    assert.deepEqual(parsed.map((row) => row.name), names);
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = cleanupFixtures(docker, { names, observed, owned, nonce });
    if (primaryError || cleanupErrors.length) throw new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], "P8V2C fixture gate failed safely");
  }
});

test("P8V2C runtime drift after ownership proof still removes the exact owned ID", { timeout: 60_000 }, () => {
  assert.equal(process.platform, "darwin", "the P8V2C fixture gate is macOS/OrbStack-only");
  assert.match(IMAGE_ID, IMAGE, "EVO_P8V2C_FIXTURE_IMAGE_ID must be one immutable local image ID");
  const docker = createDockerExecutor(run);
  const nonce = randomBytes(12).toString("hex");
  const names = [`evo-p8v2c-baseline-drift-${nonce}`];
  const observed = new Map();
  const owned = new Map();
  let expectedDrift = null;

  try {
    assert.equal(inventory(docker).has(names[0]), false);
    const started = docker([
      "run", "-d", "--pull", "never", "--name", names[0],
      "--label", `${OWNER_LABEL}=${nonce}`, "--network", "none", "--restart", "no",
      IMAGE_ID, "node", "-e", "setInterval(()=>{},1000)",
    ]);
    const id = inventory(docker).get(names[0]) ?? "";
    assert.match(id, ID);
    observed.set(names[0], id);
    const row = inspectOwnership(docker, id, nonce);
    owned.set(names[0], id);
    assert.equal(started.status, 0);
    assert.equal(started.signal, null);
    assert.equal(started.stdout.trim(), id);
    const drifted = { ...row, HostConfig: { ...row.HostConfig, NetworkMode: "bridge" } };
    try { assertFixtureRuntime(drifted); } catch (error) { expectedDrift = error; }
    assert.ok(expectedDrift, "synthetic runtime drift must block");
  } finally {
    const cleanupErrors = cleanupFixtures(docker, { names, observed, owned, nonce });
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "P8V2C runtime-drift cleanup failed");
  }
});
