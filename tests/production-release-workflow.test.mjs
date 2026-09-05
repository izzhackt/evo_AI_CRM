import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/evo-fast-release.yml", import.meta.url),
  "utf8",
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

const prepare = job("prepare", "release");
const release = job("release");

test("release is chained only from successful push CI on main", () => {
  assert.match(workflow, /^name: EVO production release$/mu);
  assert.match(workflow, /^  workflow_run:$/mu);
  assert.match(workflow, /^      - EVO platform CI$/mu);
  assert.match(workflow, /^      - completed$/mu);
  assert.match(workflow, /^      - main$/mu);
  assert.doesNotMatch(workflow, /workflow_dispatch/u);

  for (const releaseJob of [prepare, release]) {
    assert.match(releaseJob, /github\.event\.workflow_run\.event == 'push'/u);
    assert.match(releaseJob, /github\.event\.workflow_run\.conclusion == 'success'/u);
    assert.match(releaseJob, /github\.event\.workflow_run\.head_branch == 'main'/u);
    assert.match(
      releaseJob,
      /vars\.EVO_AUTOMATED_PRODUCTION_RELEASE_ENABLED == 'true'/u,
    );
  }

  assert.match(release, /^    needs: prepare$/mu);
  assert.match(release, /needs\.prepare\.result == 'success'/u);
});

test("both jobs bind the CI head to the current origin main", () => {
  for (const releaseJob of [prepare, release]) {
    assert.match(releaseJob, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/u);
    assert.match(
      releaseJob,
      /EVO_RELEASE_REVISION: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/u,
    );
    assert.match(releaseJob, /git fetch --no-tags origin main:refs\/remotes\/origin\/main/u);
    assert.match(releaseJob, /git rev-parse HEAD/u);
    assert.match(releaseJob, /git rev-parse origin\/main/u);
    assert.match(releaseJob, /scripts\/fast-release-ci-gate\.mjs/u);
    assert.match(
      releaseJob,
      /EVO_RELEASE_WORKFLOW_REVISION: \$\{\{ github\.workflow_sha \}\}/u,
    );
    assert.match(
      releaseJob,
      /\[\[ "\$EVO_RELEASE_WORKFLOW_REVISION" == "\$EVO_RELEASE_REVISION" \]\]/u,
    );
  }

  assert.doesNotMatch(workflow, /inputs\.release_revision|github\.sha/u);
});

test("release rechecks exact main and CI in the last step before the controller", () => {
  const gateName = "      - name: Reconfirm exact main and exact-SHA CI immediately before deployment";
  const controllerName = "      - name: Run one preflight, deploy app, verify, and auto-rollback on failure";
  const gateIndex = release.indexOf(gateName);
  const controllerIndex = release.indexOf(controllerName);
  assert.notEqual(gateIndex, -1);
  assert.notEqual(controllerIndex, -1);
  assert.equal(
    release.indexOf("      - name:", gateIndex + gateName.length),
    controllerIndex,
  );
  const gate = release.slice(gateIndex, controllerIndex);
  assert.match(gate, /git fetch --no-tags origin main:refs\/remotes\/origin\/main/u);
  assert.match(gate, /git rev-parse HEAD/u);
  assert.match(gate, /git rev-parse origin\/main/u);
  assert.match(gate, /node scripts\/fast-release-ci-gate\.mjs/u);
});

test("release serialization has no manual, environment, or staging gate", () => {
  assert.match(workflow, /group: evo-production-release/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.doesNotMatch(workflow, /^\s*environment:/mu);
  assert.doesNotMatch(workflow, /staging/iu);
  assert.doesNotMatch(workflow, /fast-release-scope\.mjs/u);
  assert.doesNotMatch(workflow, /exec "\$1" status/u);
  assert.doesNotMatch(workflow, /EVO_RELEASE_STAGING_ROOT/u);
  assert.match(workflow, /EVO_RELEASE_TRANSFER_ROOT/u);
});

test("runner-built immutable image and sealed transfer remain intact", () => {
  assert.match(prepare, /docker build[\s\S]*--platform linux\/amd64/u);
  assert.match(prepare, /org\.opencontainers\.image\.revision/u);
  assert.match(prepare, /org\.opencontainers\.image\.version/u);
  assert.match(prepare, /docker save/u);
  assert.match(prepare, /evo-production-candidate-/u);
  assert.match(release, /evo-production-candidate-/u);
  assert.match(release, /archiveSha256/u);
  assert.match(release, /composeSha256/u);
  assert.match(release, /EVO_RELEASE_EXPECTED_IMAGE_ID/u);
  assert.match(release, /EVO_RELEASE_EXPECTED_COMPOSE_SHA256/u);
  for (const metadataField of [
    "workflowRevision",
    "controllerSha256",
    "validatorSha256",
    "envExampleSha256",
    "supabaseProjectRef",
  ]) {
    assert.match(prepare, new RegExp(metadataField, "u"));
    assert.match(release, new RegExp(metadataField, "u"));
  }
  for (const bundledFile of [
    "evo-fast-release.sh",
    "evo-app-env-contract.mjs",
    "env.production.example",
  ]) {
    assert.match(prepare, new RegExp(bundledFile.replace(".", "\\."), "u"));
    assert.match(release, new RegExp(bundledFile.replace(".", "\\."), "u"));
  }
});

test("privileged controller bundle is sealed to the reviewed workflow revision", () => {
  const revalidate = namedStep("Revalidate the sealed production candidate");

  assert.match(revalidate, /\.workflowRevision/u);
  assert.match(revalidate, /EVO_RELEASE_WORKFLOW_REVISION/u);
  assert.match(revalidate, /\.supabaseProjectRef/u);
  assert.match(revalidate, /EVO_SUPABASE_PROJECT_REF/u);
  assert.match(
    revalidate,
    /sha256sum scripts\/evo-fast-release\.sh[\s\S]*\.controllerSha256/u,
  );
  assert.match(
    revalidate,
    /sha256sum scripts\/evo-app-env-contract\.mjs[\s\S]*\.validatorSha256/u,
  );
  assert.match(
    revalidate,
    /sha256sum deploy\/env\.production\.example[\s\S]*\.envExampleSha256/u,
  );
});

test("partial transfer is cleanup-addressable before scp and removes the allowlist", () => {
  const transfer = namedStep("Transfer the immutable release bundle to Hermes");
  const cleanup = namedStep("Remove the transferred release bundle");
  const markerIndex = transfer.indexOf(
    "printf '%s\\n' \"$transfer_dir\" > /tmp/evo-production-release-transfer-dir",
  );
  const scpIndex = transfer.indexOf("          scp \\");

  assert.ok(markerIndex >= 0, "transfer cleanup marker must be written");
  assert.ok(scpIndex > markerIndex, "cleanup marker must precede every scp attempt");
  for (const bundledFile of [
    "evo-crm-image.tar.gz",
    "evo-fast-release.sh",
    "evo-app-env-contract.mjs",
    "env.production.example",
  ]) {
    assert.match(transfer, new RegExp(bundledFile.replace(".", "\\."), "u"));
    assert.match(cleanup, new RegExp(bundledFile.replace(".", "\\."), "u"));
  }
  assert.match(cleanup, /\[\[ -d "\$transfer_dir" && ! -L "\$transfer_dir" \]\]/u);
  assert.match(cleanup, /rm -f -- "\$transferred_file"/u);
  assert.match(cleanup, /rmdir -- "\$transfer_dir"/u);
});

test("remote hash mismatch aborts before the transferred controller executes", () => {
  const deploy = namedStep(
    "Run one preflight, deploy app, verify, and auto-rollback on failure",
  );
  const execIndex = deploy.indexOf('exec "$controller" deploy');

  assert.ok(execIndex > 0, "transferred controller must execute");
  assert.doesNotMatch(deploy, /EVO_RELEASE_ROOT\/scripts\/evo-fast-release\.sh/u);
  assert.match(deploy, /EVO_RELEASE_ENV_EXAMPLE_FILE="\$env_example"/u);
  assert.match(
    deploy,
    /EVO_SUPABASE_PROJECT_REF: \$\{\{ vars\.EVO_SUPABASE_PROJECT_REF \}\}/u,
  );
  assert.match(deploy, /supabase_project_ref=\$\(jq -er '\.supabaseProjectRef'/u);
  assert.match(deploy, /export EVO_SUPABASE_PROJECT_REF=\$\{19\}/u);
  assert.match(
    deploy,
    /for bundle_file in "\$archive" "\$controller" "\$validator" "\$env_example"/u,
  );
  assert.match(deploy, /set -Eeuo pipefail/u);
  for (const [expectedHashCheck, equality] of [
    ['sha256sum "$archive"', /sha256sum "\$archive"[^\n]*== "\$\{16\}"/u],
    ['sha256sum "$controller"', /sha256sum "\$controller"[^\n]*== "\$3"/u],
    ['sha256sum "$validator"', /sha256sum "\$validator"[^\n]*== "\$4"/u],
    ['sha256sum "$env_example"', /sha256sum "\$env_example"[^\n]*== "\$5"/u],
  ]) {
    const checkIndex = deploy.indexOf(expectedHashCheck);
    assert.ok(checkIndex >= 0, `${expectedHashCheck} must be checked remotely`);
    assert.ok(checkIndex < execIndex, `${expectedHashCheck} must abort before execution`);
    assert.match(deploy, equality);
  }
});

test("production safety gates fail closed and do not apply schema", () => {
  assert.match(release, /StrictHostKeyChecking yes/u);
  assert.match(release, /BatchMode yes/u);
  assert.match(release, /\[\[ -n "\$DEPLOY_PRIVATE_KEY" && -n "\$DEPLOY_KNOWN_HOSTS" \]\]/u);
  assert.match(release, /\[\[ -n "\$SUPABASE_ACCESS_TOKEN" \]\]/u);
  assert.match(release, /scripts\/fast-release-ledger-gate\.mjs/u);
  assert.match(release, /EVO_RELEASE_ROLLBACK_SEED: \$\{\{ vars\.EVO_RELEASE_ROLLBACK_SEED \}\}/u);
  assert.match(release, /export EVO_RELEASE_ROLLBACK_SEED=\$9/u);
  assert.match(release, /Run one preflight, deploy app, verify, and auto-rollback on failure/u);
  assert.match(release, /exec "\$controller" deploy/u);
  assert.match(release, /evidenceDir/u);
  assert.match(release, /rolledBack:false/u);
  assert.doesNotMatch(workflow, /ssh-keyscan|StrictHostKeyChecking no/u);
  assert.doesNotMatch(workflow, /supabase\s+(?:db|migration|link)|schema\s+apply/iu);
});
