// Split out of tests/fast-release-control.test.mjs (PLAN_CHANGES 22.11.2026): the slow release simulations are
// separate files, so the sharded CI runs them in parallel. Assertions are unchanged.
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { TARGET_AGENT_DIGEST, aiAgentReleaseFixture, TODAY_STATE_KEYS } from "./helpers/fast-release-fixtures.mjs";

test("AI agent disabled: a release makes no agent call and seals today's state and wrapper", () => {
  const fixture = aiAgentReleaseFixture({ enabled: false });
  try {
    assert.equal(fixture.run("seal-rollback-seed").status, 0);
    const deployed = fixture.run("deploy");
    assert.equal(deployed.status, 0, deployed.stderr);
    assert.equal(JSON.parse(deployed.stdout).status, "pending");
    const agentCalls = fixture.dockerCalls().filter((call) => call[0] === "exec" || call.includes("--profile")
      || call.includes("-") || call.includes("{{.State.Running}}")
      || call.some((argument) => /^ai-agent-(?:api|worker)$|evo-ai-agent@/u.test(argument)));
    assert.deepEqual(agentCalls, []);
    assert.equal(fixture.runtime().appAi, false);
    const state = JSON.parse(readFileSync(join(fixture.releaseDir, "state.json"), "utf8"));
    assert.deepEqual(Object.keys(state).sort(), TODAY_STATE_KEYS);
    const wrapper = readFileSync(join(fixture.releaseDir, "rollback-command.sh"), "utf8");
    assert.match(wrapper, /^export EVO_AI_AGENT_ENABLED=false$/mu);
    assert.doesNotMatch(wrapper, /EVO_AI_AGENT_IMAGE_DIGEST|EVO_CRM_AI_AGENT_ENV_FILE/u);
    const status = fixture.run("candidate-status");
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).status, "pending");
    assert.match(fixture.run("candidate-status", { EVO_AI_AGENT_ENABLED: "true", EVO_AI_AGENT_IMAGE_DIGEST: TARGET_AGENT_DIGEST }).stderr,
      /ai_agent_release_mismatch/u);
    const rolledBack = fixture.run("rollback", fixture.rollbackEnvironment);
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    assert.equal(fixture.runtime().app, "baseline");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("AI agent disabled: running agent containers still fail the exact runtime contract", () => {
  const fixture = aiAgentReleaseFixture({ enabled: false, previousAgent: true });
  try {
    const status = fixture.run("status");
    assert.equal(status.status, 2);
    assert.match(status.stderr, /runtime_service_contract_invalid/u);
    const deployed = fixture.run("deploy");
    assert.equal(deployed.status, 2);
    assert.match(deployed.stderr, /runtime_service_contract_invalid/u);
    assert.equal(fixture.runtime().app, "baseline");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("AI agent enabled: configuration fails closed before any runtime change", () => {
  for (const [options, overrides, code] of [
    [{ enabled: true }, { EVO_AI_AGENT_ENABLED: "yes" }, /ai_agent_enabled_invalid/u],
    [{ enabled: true }, { EVO_AI_AGENT_IMAGE_DIGEST: "latest" }, /ai_agent_digest_invalid/u],
    [{ enabled: true, agentEnv: "absent" }, {}, /ai_agent_env_missing/u],
    [{ enabled: true, agentEnv: "incomplete" }, {}, /ai_agent_env_incomplete/u],
    [{ enabled: true, agentEnv: "quoted" }, {}, /ai_agent_env_format_invalid/u],
    [{ enabled: true, agentEnv: "exported" }, {}, /ai_agent_env_format_invalid/u],
    [{ enabled: true, agentEnv: "padded" }, {}, /ai_agent_env_format_invalid/u],
  ]) {
    const fixture = aiAgentReleaseFixture(options);
    try {
      const deployed = fixture.run("deploy", overrides);
      assert.equal(deployed.status, 2, deployed.stdout);
      assert.match(deployed.stderr, code);
      assert.doesNotMatch(deployed.stderr, /synthetic-fixture|postgresql:/u);
      assert.deepEqual(fixture.dockerCalls(), []);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
  const fixture = aiAgentReleaseFixture({ enabled: true });
  try {
    chmodSync(fixture.agentEnvironmentFile, 0o644);
    assert.match(fixture.run("deploy").stderr, /ai_agent_env_permissions_invalid/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("AI agent enabled: first release pulls by digest, proves /v1/ready, records the pin and rolls back to absent", () => {
  const fixture = aiAgentReleaseFixture({ enabled: true });
  try {
    assert.equal(fixture.run("seal-rollback-seed").status, 0);
    const deployed = fixture.run("deploy");
    assert.equal(deployed.status, 0, deployed.stderr);
    assert.equal(JSON.parse(deployed.stdout).status, "pending");
    const calls = fixture.dockerCalls().map((call) => call.join(" "));
    assert.ok(calls.some((call) => /^compose .*--profile ai-agent .*pull --quiet ai-agent-api$/u.test(call)), calls.join("\n"));
    assert.ok(calls.some((call) => /^compose .*--profile ai-agent .*up .*--pull never .*ai-agent-api ai-agent-worker$/u.test(call)));
    assert.ok(calls.some((call) => /^exec e0e0e0e0e0e0 python -c .*\/v1\/ready/u.test(call)));
    // ADR 0032: the app joins the agent's own bridge only now, through the stdin override.
    assert.ok(calls.some((call) => /^compose .*--file - .*--profile ai-agent up .* app$/u.test(call)), calls.join("\n"));
    assert.equal(fixture.runtime().appAi, true);
    assert.deepEqual(fixture.runtime().agent, { api: fixture.targetAgentImage, worker: fixture.targetAgentImage, healthy: true });
    const state = JSON.parse(readFileSync(join(fixture.releaseDir, "state.json"), "utf8"));
    assert.deepEqual(state.aiAgent, { image: fixture.targetAgentImage, previousPresent: false, previousImage: "" });
    assert.deepEqual(Object.keys(state).filter((key) => key !== "aiAgent").sort(), TODAY_STATE_KEYS);
    const wrapper = readFileSync(join(fixture.releaseDir, "rollback-command.sh"), "utf8");
    assert.match(wrapper, /^export EVO_AI_AGENT_ENABLED=true$/mu);
    assert.match(wrapper, new RegExp(`^export EVO_AI_AGENT_IMAGE_DIGEST=${TARGET_AGENT_DIGEST}$`, "mu"));
    assert.match(fixture.run("candidate-status").stdout, /"status":"pending"/u);
    assert.match(fixture.run("candidate-status", { EVO_AI_AGENT_ENABLED: "" }).stderr, /ai_agent_release_mismatch/u);

    const callsBeforeRollback = fixture.dockerCalls().length;
    const rolledBack = fixture.run("rollback", fixture.rollbackEnvironment);
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    assert.equal(fixture.runtime().app, "baseline");
    assert.equal(fixture.runtime().appAi, false);
    assert.equal(fixture.runtime().agent, null);
    assert.equal(existsSync(join(fixture.evidenceRoot, "pending-current.json")), false);
    // The previous release had no agent: its app is restored without the override.
    assert.ok(!fixture.dockerCalls().slice(callsBeforeRollback).some((call) => call.includes("-")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("AI agent off after it ran: the app leaves the agent bridge and nothing else is rendered", () => {
  // The disable runbook removed the agent pair; the app container still sits on evo_crm_ai.
  const fixture = aiAgentReleaseFixture({ enabled: false, appOnAgentNetwork: true });
  try {
    assert.equal(fixture.run("seal-rollback-seed").status, 0);
    const deployed = fixture.run("deploy");
    assert.equal(deployed.status, 0, deployed.stderr);
    assert.equal(fixture.runtime().app, "target");
    assert.equal(fixture.runtime().appAi, false);
    assert.ok(!fixture.dockerCalls().some((call) => call.includes("-") || call.includes("--profile")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("AI agent enabled: a compose that puts the agent next to WAHA or clamd is refused before any change", () => {
  for (const breach of ["agent-private", "waha-ai"]) {
    const fixture = aiAgentReleaseFixture({ enabled: true });
    try {
      assert.equal(fixture.run("seal-rollback-seed").status, 0);
      const deployed = fixture.run("deploy", { FAKE_COMPOSE_BREACH: breach });
      assert.equal(deployed.status, 2, `${breach}: ${deployed.stdout}`);
      assert.match(deployed.stderr, /compose_ai_agent_contract_invalid/u);
      assert.equal(fixture.runtime().app, "baseline");
      assert.equal(fixture.runtime().agent, null);
      assert.ok(!fixture.dockerCalls().some((call) => call.includes("up") || call.includes("pull")), breach);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
test("AI agent enabled: the 2 GiB headroom is required only while the agent is not running yet", (t) => {
  const meminfo = existsSync("/proc/meminfo") ? readFileSync("/proc/meminfo", "utf8") : "";
  const available = meminfo === "" ? 8589934592 / 1024 : Number(/^MemAvailable:\s+(\d+)/mu.exec(meminfo)?.[1]);
  // Between today's minimum and today's minimum plus the agent's limits.
  const minimum = Math.floor(available - 1048576);
  if (!Number.isSafeInteger(minimum) || minimum < 4194304) {
    t.skip("needs at least 5 GiB of available memory");
    return;
  }
  for (const previousAgent of [true, false]) {
    const fixture = aiAgentReleaseFixture({ enabled: true, previousAgent });
    try {
      assert.equal(fixture.run("seal-rollback-seed").status, 0);
      const preflight = fixture.run("preflight", { EVO_RELEASE_MIN_AVAILABLE_MEMORY_KB: String(minimum) });
      if (previousAgent) assert.doesNotMatch(preflight.stderr, /insufficient_memory_capacity/u);
      else assert.match(preflight.stderr, /insufficient_memory_capacity/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
