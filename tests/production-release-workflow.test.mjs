import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/evo-fast-release.yml", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

function job(name, nextName) {
  const start = workflow.indexOf(`  ${name}:`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:`, start) : workflow.length;
  assert.notEqual(start, -1, `${name} job must exist`);
  assert.ok(end > start, `${name} job must have a complete body`);
  return workflow.slice(start, end);
}

function namedStep(name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  const end = workflow.indexOf("\n      - name:", start + marker.length);
  assert.notEqual(start, -1, `${name} step must exist`);
  return workflow.slice(start, end === -1 ? workflow.length : end);
}

function stepIndex(name) {
  const index = workflow.indexOf(`      - name: ${name}`);
  assert.notEqual(index, -1, `${name} step must exist`);
  return index;
}

function jobStepNames(releaseJob) {
  return [...releaseJob.matchAll(/^      - name: (.+)$/gmu)].map((match) => match[1]);
}

const build = job("build", "deploy");
const deploy = job("deploy");

test("the release stays coarse-unarmed and admits only successful manual exact-main CI", () => {
  assert.match(workflow, /^name: EVO fast app release$/mu);
  assert.match(workflow, /^  workflow_run:$/mu);
  assert.match(workflow, /^      - EVO platform CI$/mu);
  assert.match(workflow, /^      - completed$/mu);
  assert.match(workflow, /^      - main$/mu);
  assert.doesNotMatch(workflow, /^  workflow_dispatch:/mu);
  assert.match(workflow, /^permissions: \{\}$/mu);
  assert.match(workflow, /^  cancel-in-progress: false$/mu);

  for (const releaseJob of [build, deploy]) {
    assert.match(releaseJob, /github\.event\.workflow_run\.event == 'workflow_dispatch'/u);
    assert.match(releaseJob, /github\.event\.workflow_run\.conclusion == 'success'/u);
    assert.match(releaseJob, /github\.event\.workflow_run\.head_branch == 'main'/u);
    assert.match(releaseJob, /vars\.EVO_PRODUCTION_RELEASE_ARMED == 'true'/u);
    assert.match(releaseJob, /exact\("EVO_UPSTREAM_EVENT", "workflow_dispatch"\)/u);
    assert.doesNotMatch(releaseJob, /workflow_run\.event == 'push'|exact\("EVO_UPSTREAM_EVENT", "push"\)/u);
  }
  assert.match(deploy, /^    needs: build$/mu);
  assert.match(deploy, /needs\.build\.result == 'success'/u);
});

test("the fast-release suite includes workflow and browser proof contracts", () => {
  const command = packageJson.scripts?.["test:fast-release"] ?? "";
  assert.match(command, /tests\/production-release-workflow\.test\.mjs/u);
  assert.match(command, /tests\/production-browser-smoke\.test\.mjs/u);
});

test("jobs use only their least required GitHub permissions", () => {
  assert.match(build, /^    permissions:\n      contents: read$/mu);
  assert.doesNotMatch(build, /actions: write|contents: write|deployments: write/u);
  assert.match(deploy, /^    permissions:\n      actions: read\n      contents: read$/mu);
  assert.doesNotMatch(deploy, /actions: write|contents: write|deployments: write/u);
});

test("each first step is inline and secretless before checkout or repository code", () => {
  for (const [releaseJob, stepName] of [
    [build, "Secretless build admission"],
    [deploy, "Secretless deploy admission"],
  ]) {
    const firstStepOffset = releaseJob.indexOf("      - name:");
    assert.equal(
      releaseJob.slice(firstStepOffset).startsWith(`      - name: ${stepName}`),
      true,
    );
    const step = namedStep(stepName);
    assert.doesNotMatch(step, /\$\{\{\s*secrets\./u);
    assert.doesNotMatch(step, /\$\{\{\s*github\.token\s*\}\}|GITHUB_TOKEN/u);
    assert.doesNotMatch(step, /^\s*uses:/mu);
    assert.doesNotMatch(step, /scripts\//u);
    assert.match(step, /EVO_EXPECTED_REPOSITORY: izzhackt\/evo_AI_CRM/u);
    assert.match(step, /EVO_RELEASE_WORKFLOW_SHA: \$\{\{ github\.workflow_sha \}\}/u);
    assert.match(step, /EVO_UPSTREAM_WORKFLOW_PATH: \$\{\{ github\.event\.workflow_run\.path \}\}/u);
    assert.match(step, /EVO_UPSTREAM_RUN_ATTEMPT: \$\{\{ github\.event\.workflow_run\.run_attempt \}\}/u);
    assert.match(step, /EVO_ORIGINAL_ACTOR_ID: \$\{\{ github\.actor_id \}\}/u);
    assert.doesNotMatch(step, /triggering_actor/u);
    assert.match(step, /EVO_ARM_SNAPSHOT: \$\{\{ vars\.EVO_PRODUCTION_RELEASE_ARMED \}\}/u);
    assert.match(step, /git\/ref\/heads\/main/u);
    assert.match(step, /redirect: "error"/u);
    assert.match(step, /::error::release_(?:build|deploy)_admission_failed/u);
  }
});

test("both exact checkouts are immutable and never persist credentials", () => {
  const checkouts = workflow.match(/uses: actions\/checkout@[0-9a-f]{40}[\s\S]*?persist-credentials: false/gu) ?? [];
  assert.equal(checkouts.length, 2);
  for (const checkout of checkouts) {
    assert.match(checkout, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/u);
    assert.match(checkout, /fetch-depth: 1/u);
  }
  assert.match(workflow, /EVO_RELEASE_WORKFLOW_SHA[^\n]*\n[\s\S]*?== "\$EVO_RELEASE_REVISION"/u);
  assert.doesNotMatch(workflow, /git checkout|git reset|git pull/u);
});

test("build emits one closed immutable linux-amd64 candidate artifact", () => {
  const image = namedStep("Build and inspect immutable linux-amd64 image");
  const upload = namedStep("Upload closed candidate artifact");
  const outputs = namedStep("Validate immutable artifact outputs");

  assert.match(image, /docker build \\\n            --platform linux\/amd64/u);
  for (const label of [
    "org.opencontainers.image.source",
    "org.opencontainers.image.revision",
    "org.opencontainers.image.version",
  ]) assert.match(image, new RegExp(label.replaceAll(".", "\\."), "u"));
  assert.match(image, /image_id=.*docker image inspect/u);
  assert.match(image, /image_config_digest=\$image_id/u);
  assert.match(image, /archive_bytes/u);
  for (const hash of [
    "composeSha256",
    "controllerSha256",
    "validatorSha256",
    "envExampleSha256",
  ]) assert.match(image, new RegExp(hash, "u"));
  assert.match(image, /upstreamRunAttempt/u);
  assert.match(image, /releaseWorkflowRunAttempt/u);
  assert.match(image, /supabaseProjectRef/u);
  assert.match(image, /os:"linux",architecture:"amd64"/u);

  assert.match(upload, /uses: actions\/upload-artifact@[0-9a-f]{40}/u);
  assert.match(upload, /overwrite: false/u);
  assert.match(upload, /evo-crm-image\.tar\.gz/u);
  assert.match(upload, /evo-production-release-image\.json/u);
  assert.doesNotMatch(upload, /scripts\/|docker-compose|env\.production/u);
  assert.match(outputs, /\^\[1-9\]\[0-9\]\*\$/u);
  assert.match(outputs, /\^\[0-9a-f\]\{64\}\$/u);
  assert.match(build, /artifact_id: \$\{\{ steps\.upload_candidate\.outputs\.artifact-id \}\}/u);
  assert.match(build, /artifact_digest: \$\{\{ steps\.upload_candidate\.outputs\.artifact-digest \}\}/u);
});

test("deploy binds REST artifact identity then downloads by numeric ID and hard digest", () => {
  const bind = namedStep("Bind exact artifact record");
  const download = namedStep("Download exact candidate artifact");
  const validate = namedStep("Validate closed candidate artifact");

  assert.match(bind, /actions\/artifacts\/\$\{env\.EVO_ARTIFACT_ID\}/u);
  assert.match(bind, /artifact\?\.digest !== `sha256:\$\{env\.EVO_ARTIFACT_DIGEST\}`/u);
  assert.match(bind, /artifact\?\.workflow_run\?\.id/u);
  assert.match(bind, /artifact\?\.workflow_run\?\.head_sha/u);
  assert.match(download, /uses: actions\/download-artifact@[0-9a-f]{40}/u);
  assert.match(download, /artifact-ids: \$\{\{ needs\.build\.outputs\.artifact_id \}\}/u);
  assert.match(download, /digest-mismatch: error/u);
  assert.doesNotMatch(download, /\n\s+name:/u);

  assert.match(validate, /evo-crm-image\.tar\.gz\\nevo-production-release-image\.json/u);
  assert.match(validate, /expected_keys/u);
  assert.match(validate, /archiveSha256/u);
  assert.match(validate, /archiveBytes/u);
  assert.doesNotMatch(validate, /(?:^|\s)(?:bash|node)\s+[^\n]*evo-production-candidate/u);
});

test("checked-in controller inputs are hash-bound and remote transfer is allowlisted", () => {
  const validate = namedStep("Validate closed candidate artifact");
  const transfer = namedStep("Transfer exact release allowlist");
  for (const path of [
    "docker-compose.prod.yml",
    "scripts/evo-fast-release.sh",
    "scripts/evo-app-env-contract.mjs",
    "deploy/env.production.example",
  ]) assert.match(validate + transfer, new RegExp(path.replaceAll(".", "\\."), "u"));
  for (const field of [
    "composeSha256",
    "controllerSha256",
    "validatorSha256",
    "envExampleSha256",
  ]) assert.match(validate + transfer, new RegExp(field, "u"));
  assert.match(transfer, /find "\$transfer_dir"[\s\S]*== 6/u);
  assert.doesNotMatch(namedStep("Load and inspect candidate image"), /chmod \+x|evo-fast-release\.sh/u);
});

test("control-token and Supabase guards are isolated and immediately precede mutation", () => {
  const configure = stepIndex("Configure pinned SSH trust");
  const githubMutation = stepIndex("Final live GitHub mutation guard");
  const ledgerMutation = stepIndex("Final Supabase ledger mutation guard");
  const transfer = stepIndex("Transfer exact release allowlist");
  assert.ok(configure < githubMutation && githubMutation < ledgerMutation && ledgerMutation < transfer);
  const names = jobStepNames(deploy);
  const mutationGuardOffset = names.indexOf("Final live GitHub mutation guard");
  assert.deepEqual(names.slice(mutationGuardOffset, mutationGuardOffset + 3), [
    "Final live GitHub mutation guard",
    "Final Supabase ledger mutation guard",
    "Transfer exact release allowlist",
  ]);

  const githubAccept = stepIndex("Final live GitHub acceptance guard");
  const ledgerAccept = stepIndex("Final Supabase ledger acceptance guard");
  const accept = stepIndex("Accept exact V3 candidate");
  assert.ok(githubAccept < ledgerAccept && ledgerAccept < accept);
  const acceptanceGuardOffset = names.indexOf("Final live GitHub acceptance guard");
  assert.deepEqual(names.slice(acceptanceGuardOffset, acceptanceGuardOffset + 3), [
    "Final live GitHub acceptance guard",
    "Final Supabase ledger acceptance guard",
    "Accept exact V3 candidate",
  ]);

  for (const name of ["Final live GitHub mutation guard", "Final live GitHub acceptance guard"]) {
    const step = namedStep(name);
    assert.match(step, /EVO_GITHUB_VARIABLES_READ_TOKEN: \$\{\{ secrets\.EVO_GITHUB_VARIABLES_READ_TOKEN \}\}/u);
    assert.doesNotMatch(step, /SUPABASE_ACCESS_TOKEN|scripts\/|\bssh\b|\bscp\b/u);
    assert.match(step, /actions\/variables\/\$\{name\}/u);
    assert.match(step, /check-runs\?filter=latest&per_page=100/u);
    assert.match(step, /run\?\.name === "Main CRM"/u);
    assert.match(step, /ci\?\.event !== "workflow_dispatch"/u);
    assert.doesNotMatch(step, /ci\?\.event !== "push"/u);
    assert.match(step, /run\?\.app\?\.slug === "github-actions"/u);
    assert.match(step, /EVO_RELEASE_RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/u);
    assert.match(step, /evo-v3-production-\$\{env\.EVO_RELEASE_REVISION\}-\$\{env\.EVO_RELEASE_RUN_ID\}-\$\{env\.EVO_RELEASE_RUN_ATTEMPT\}/u);
    assert.match(step, /EVO_PRODUCTION_RELEASE_ARMED/u);
    assert.match(step, /EVO_PRODUCTION_RELEASE_ACTOR_ID/u);
  }
  for (const name of ["Final Supabase ledger mutation guard", "Final Supabase ledger acceptance guard"]) {
    const step = namedStep(name);
    assert.match(step, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/u);
    assert.match(step, /fast-release-ledger-gate\.mjs/u);
    assert.doesNotMatch(step, /EVO_GITHUB_VARIABLES_READ_TOKEN|\bssh\b|\bscp\b/u);
  }
  assert.equal((workflow.match(/secrets\.EVO_GITHUB_VARIABLES_READ_TOKEN/gu) ?? []).length, 2);

  const beforeTransfer = deploy.slice(0, deploy.indexOf("      - name: Transfer exact release allowlist"));
  assert.doesNotMatch(beforeTransfer, /(?:^|\n)\s*(?:ssh|scp)\s/u);
});

test("candidate remains pending until authenticated read-only V3 proof and explicit acceptance", () => {
  const deployPending = stepIndex("Deploy exact candidate as pending");
  const browser = stepIndex("Authenticated read-only V3 browser smoke");
  const acceptGuard = stepIndex("Final live GitHub acceptance guard");
  const accept = stepIndex("Accept exact V3 candidate");
  assert.ok(deployPending < browser && browser < acceptGuard && acceptGuard < accept);

  const deployStep = namedStep("Deploy exact candidate as pending");
  assert.match(deployStep, /\.command == "deploy" and \.status == "pending"/u);
  assert.doesNotMatch(deployStep, /accept-candidate/u);

  const browserStep = namedStep("Authenticated read-only V3 browser smoke");
  assert.match(browserStep, /EVO_PRODUCTION_SMOKE_ADMIN_EMAIL: \$\{\{ secrets\.EVO_PRODUCTION_SMOKE_ADMIN_EMAIL \}\}/u);
  assert.match(browserStep, /EVO_PRODUCTION_SMOKE_ADMIN_PASSWORD: \$\{\{ secrets\.EVO_PRODUCTION_SMOKE_ADMIN_PASSWORD \}\}/u);
  assert.match(browserStep, /scripts\/evo-production-browser-smoke\.mjs/u);
  assert.doesNotMatch(browserStep, /ssh|scp|WAHA|WHATSAPP|GEMINI|AMOCRM/u);
  assert.equal((workflow.match(/secrets\.EVO_PRODUCTION_SMOKE_ADMIN_(?:EMAIL|PASSWORD)/gu) ?? []).length, 2);

  const acceptStep = namedStep("Accept exact V3 candidate");
  assert.match(acceptStep, /browser-receipt\.json/u);
  assert.match(acceptStep, /EVO_RELEASE_BROWSER_RECEIPT_SHA256/u);
  assert.match(acceptStep, /accept-candidate/u);
  assert.match(acceptStep, /candidate-status/u);
  assert.match(acceptStep, /\.status == "pending" or \.status == "accepted"/u);
  assert.match(acceptStep, /production_candidate_acceptance_state_unknown/u);
  assert.match(acceptStep, /rollback_pending_atomically/u);
  const firstAttempt = acceptStep.indexOf("run_candidate_command accept-candidate");
  const statusProbe = acceptStep.indexOf("run_candidate_command candidate-status");
  assert.ok(firstAttempt !== -1 && firstAttempt < statusProbe);
  assert.doesNotMatch(acceptStep.slice(firstAttempt, statusProbe), /rollback_pending_atomically/u);
});

test("all failure recovery uses the atomic pending-only controller contract", () => {
  const browserRollback = namedStep("Rollback pending candidate after browser proof failure");
  const guardRollback = namedStep("Rollback pending candidate after acceptance guard failure");
  const acceptStep = namedStep("Accept exact V3 candidate");

  for (const recoveryStep of [browserRollback, guardRollback, acceptStep]) {
    assert.match(recoveryStep, /exec "\$rollback_wrapper" pending-only/u);
    assert.match(recoveryStep, /\.command == "rollback-pending"/u);
    assert.match(recoveryStep, /\.status == "rolled_back"/u);
    assert.doesNotMatch(recoveryStep, /exec "\$rollback_wrapper"[ \t]*(?:\n|$)/u);
  }
  assert.equal(
    (workflow.match(/exec "\$rollback_wrapper" pending-only/gu) ?? []).length,
    3,
  );
  assert.doesNotMatch(workflow, /rollback_pending(?:_atomically)?\s*\|\|\s*true/u);
  assert.match(
    acceptStep,
    /if rollback_pending_atomically; then[\s\S]*production_browser_receipt_transfer_failed_and_rolled_back[\s\S]*else[\s\S]*production_browser_receipt_transfer_failed_pending_rollback_refused/u,
  );
  assert.match(
    acceptStep,
    /if rollback_pending_atomically; then[\s\S]*production_candidate_acceptance_failed_and_rolled_back[\s\S]*else[\s\S]*production_candidate_acceptance_failed_pending_rollback_refused/u,
  );
});

test("guard failures rollback pending state while unknown acceptance state is preserved", () => {
  const browserRollback = namedStep("Rollback pending candidate after browser proof failure");
  const guardRollback = namedStep("Rollback pending candidate after acceptance guard failure");
  const cleanup = namedStep("Remove transient release transfer after terminal state");
  assert.match(browserRollback, /steps\.deploy_candidate\.outcome == 'success'/u);
  assert.match(browserRollback, /steps\.browser_smoke\.outcome == 'failure'/u);
  assert.match(guardRollback, /steps\.acceptance_github_guard\.outcome == 'failure'/u);
  assert.match(guardRollback, /steps\.acceptance_ledger_guard\.outcome == 'failure'/u);
  assert.ok(
    stepIndex("Accept exact V3 candidate") <
      stepIndex("Rollback pending candidate after acceptance guard failure"),
  );
  assert.match(cleanup, /steps\.accept_candidate\.outcome == 'success'/u);
  assert.match(cleanup, /steps\.browser_rollback\.outcome == 'success'/u);
  assert.match(cleanup, /steps\.acceptance_guard_rollback\.outcome == 'success'/u);
  assert.doesNotMatch(cleanup, /steps\.accept_candidate\.outcome == 'failure'/u);
  assert.match(cleanup, /evo-production-release-transfer-owned/u);
});
