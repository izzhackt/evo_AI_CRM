// Split out of tests/fast-release-control.test.mjs (PLAN_CHANGES 22.11.2026): the slow release simulations are
// separate files, so the sharded CI runs them in parallel. Assertions are unchanged.
import assert from "node:assert/strict";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { sha256, AGENT_REPOSITORY, FOREIGN_AGENT_DIGEST, aiAgentReleaseFixture } from "./helpers/fast-release-fixtures.mjs";

test("AI agent enabled: a failed readiness proof restores the previous app and agent pin", () => {
  for (const failure of ["FAKE_AGENT_READY_FAIL", "FAKE_AGENT_UP_FAIL"]) {
    const fixture = aiAgentReleaseFixture({ enabled: true, previousAgent: true });
    try {
      assert.equal(fixture.run("seal-rollback-seed").status, 0);
      const deployed = fixture.run("deploy", { [failure]: "1" });
      assert.equal(deployed.status, 3, `${failure}: ${deployed.stderr}`);
      assert.deepEqual(JSON.parse(deployed.stdout), {
        ok: false, command: "deploy", status: "rolled_back", code: "deployment_failed",
        evidenceDir: fixture.releaseDir,
      });
      const state = JSON.parse(readFileSync(join(fixture.releaseDir, "state.json"), "utf8"));
      assert.deepEqual(state.aiAgent, {
        image: fixture.targetAgentImage, previousPresent: true, previousImage: fixture.previousAgentImage,
      });
      assert.equal(fixture.runtime().app, "baseline");
      assert.equal(fixture.runtime().appAi, true);
      assert.deepEqual(fixture.runtime().agent, {
        api: fixture.previousAgentImage, worker: fixture.previousAgentImage, healthy: true,
      });
      const calls = fixture.dockerCalls().map((call) => call.join(" "));
      assert.ok(calls.some((call) => /up .*--force-recreate .*ai-agent-api ai-agent-worker$/u.test(call)), failure);
      assert.ok(calls.some((call) => /--file \S+\/rollback\.override\.yml --file - .*up .* app$/u.test(call)), failure);
      // Before any runtime change the previous snapshot was rendered as the rollback renders it.
      const previousRender = calls.findIndex((call) => /--file \S+\/docker-compose\.previous\.yml --file - .*config --quiet$/u.test(call));
      const firstUp = calls.findIndex((call) => /^compose .* up /u.test(call));
      assert.ok(previousRender >= 0 && previousRender < firstUp, failure);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
test("AI agent enabled: acceptance records the pin and a hand-changed agent is drift", () => {
  const fixture = aiAgentReleaseFixture({ enabled: true, previousAgent: true });
  try {
    assert.equal(fixture.run("seal-rollback-seed").status, 0);
    const deployed = fixture.run("deploy");
    assert.equal(deployed.status, 0, deployed.stderr);
    const state = JSON.parse(readFileSync(join(fixture.releaseDir, "state.json"), "utf8"));
    const receipt = join(fixture.releaseDir, "browser-receipt.json");
    const receiptText = JSON.stringify({
      schema: "evo-v3-browser-receipt/v1", result: "passed", releaseId: state.releaseId,
      repository: state.repository, revision: state.revision, workflowRunId: state.workflowRunId,
      workflowRunAttempt: state.workflowRunAttempt, artifactId: state.artifactId, artifactDigest: state.artifactDigest,
    });
    writeFileSync(receipt, receiptText, { mode: 0o600 });
    chmodSync(receipt, 0o600);
    const accepted = fixture.run("accept-candidate", {
      EVO_RELEASE_ACTOR_ID: "1", EVO_RELEASE_CURRENT_MAIN_REVISION: fixture.targetRevision,
      EVO_RELEASE_BROWSER_RECEIPT: receipt, EVO_RELEASE_BROWSER_RECEIPT_SHA256: sha256(receiptText),
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    const record = JSON.parse(readFileSync(join(fixture.releaseDir, "v3-acceptance-record.json"), "utf8"));
    assert.deepEqual(record.aiAgent, state.aiAgent);

    // Same candidate again: the accepted agent pin is recognised, so only the revision check stops it.
    assert.match(fixture.run("preflight").stderr, /current_release_invalid/u);
    const foreign = `${AGENT_REPOSITORY}@${FOREIGN_AGENT_DIGEST}`;
    fixture.setRuntime({ agent: { api: foreign, worker: foreign, healthy: true }, agentImages: [foreign] });
    assert.match(fixture.run("preflight").stderr, /runtime_ai_agent_image_drift/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
test("AI agent enabled: a rollback whose previous agent image is gone stops before any change", () => {
  const fixture = aiAgentReleaseFixture({ enabled: true, previousAgent: true });
  try {
    assert.equal(fixture.run("seal-rollback-seed").status, 0);
    assert.equal(fixture.run("deploy").status, 0);
    fixture.setRuntime({ agentImages: [fixture.targetAgentImage] });
    const callsBeforeRollback = fixture.dockerCalls().length;
    const rolledBack = fixture.run("rollback", fixture.rollbackEnvironment);
    assert.notEqual(rolledBack.status, 0);
    assert.match(rolledBack.stderr, /rollback_failed/u);
    assert.equal(fixture.runtime().app, "target");
    assert.deepEqual(fixture.runtime().agent, {
      api: fixture.targetAgentImage, worker: fixture.targetAgentImage, healthy: true,
    });
    const mutations = fixture.dockerCalls().slice(callsBeforeRollback)
      .filter((call) => call.includes("up") || call.includes("rm") || call.includes("stop") || call[0] === "tag");
    assert.deepEqual(mutations, []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
