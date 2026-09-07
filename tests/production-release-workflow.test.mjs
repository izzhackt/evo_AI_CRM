import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

function savedImageFixture(t, variant) {
  const root = mkdtempSync(join(tmpdir(), "evo-release-image-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const revision = "a".repeat(40);
  const tag = `evo-crm:${revision}`;
  const config = Buffer.from('{"architecture":"amd64","os":"linux","config":{}}\n');
  const configHash = createHash("sha256").update(config).digest("hex");
  const configDigest = `sha256:${configHash}`;
  const imageId = variant === "classic" ? configDigest : `sha256:${"b".repeat(64)}`;
  const configPath = variant === "classic"
    ? `${configHash}.json`
    : `blobs/sha256/${variant === "wrong bytes" ? "c".repeat(64) : configHash}`;
  const entries = [{
    Config: variant === "unsafe path" ? "../outside.json" : configPath,
    RepoTags: [variant === "wrong tag" ? "evo-crm:other" : tag],
    Layers: [],
  }];
  if (variant === "multiple images") entries.push({ ...entries[0] });
  const files = join(root, "files");
  mkdirSync(dirname(join(files, configPath)), { recursive: true });
  writeFileSync(join(files, "manifest.json"), JSON.stringify(entries));
  const members = ["manifest.json"];
  if (variant !== "missing config") {
    writeFileSync(join(files, configPath), config);
    members.push(configPath);
  }
  const archive = join(root, "saved-image.tar.gz");
  const packed = spawnSync("tar", ["-czf", archive, "-C", files, ...members], {
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const manifest = join(root, "release.json");
  writeFileSync(manifest, JSON.stringify({
    imageId,
    imageConfigDigest: variant === "wrong attestation" ? `sha256:${"d".repeat(64)}` : configDigest,
    imageVersion: "test-version",
  }));
  return {
    root, archive, manifest, revision, imageId, configDigest,
    tagId: variant === "wrong loaded tag" ? `sha256:${"e".repeat(64)}` : imageId,
  };
}

function runSavedImageStep(lane, fixture) {
  const source = namedStep(lane === "build"
    ? "Build and inspect immutable linux-amd64 image"
    : "Load and inspect candidate image");
  const marker = lane === "build" ? "image_id=$(docker image inspect" : "expected_image_id=$(jq";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${lane} image identity code must exist`);
  const end = lane === "build" ? source.indexOf("          archive_sha256=", start) : source.length;
  assert.ok(end > start, `${lane} image identity code must be complete`);
  const snippet = source.slice(start, end).replace(/^          /gmu, "")
    .replace(">/tmp/evo-production-docker-load.txt", '>"$EVO_TEST_LOAD_LOG"');
  // Execute the actual workflow shell against real tar/gzip/config bytes.
  // Only Docker is a seam: no image build or production daemon is needed here.
  const docker = String.raw`
docker() {
  if [[ "$1" == save ]]; then gzip -dc "$EVO_TEST_ARCHIVE"; return; fi
  if [[ "$1" == load ]]; then return 0; fi
  [[ "$1 $2 $3" == "image inspect --format" ]] || return 64
  case "$4" in
    '{{.Id}}')
      if [[ "$5" == evo-crm:* ]]; then printf '%s\n' "$EVO_TEST_TAG_ID"
      else printf '%s\n' "$EVO_TEST_IMAGE_ID"; fi ;;
    '{{.Os}}') printf 'linux\n' ;;
    '{{.Architecture}}') printf 'amd64\n' ;;
    *org.opencontainers.image.source*) printf '%s\n' "$EVO_IMAGE_SOURCE" ;;
    *org.opencontainers.image.revision*) printf '%s\n' "$EVO_RELEASE_REVISION" ;;
    *org.opencontainers.image.version*) printf '%s\n' "$EVO_RELEASE_VERSION" ;;
    *) return 64 ;;
  esac
}
`;
  return spawnSync("bash", ["-c", `set -Eeuo pipefail\n${docker}\n${snippet}\nprintf '%s\\n' "$${lane === "build" ? "image_config_digest" : "expected_config_digest"}"`], {
    cwd: fixture.root,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      PATH: process.env.PATH,
      archive: lane === "build" ? join(fixture.root, "resaved-image.tar.gz") : fixture.archive,
      manifest: fixture.manifest,
      EVO_TEST_ARCHIVE: fixture.archive,
      EVO_TEST_LOAD_LOG: join(fixture.root, "docker-load.log"),
      EVO_TEST_IMAGE_ID: fixture.imageId,
      EVO_TEST_TAG_ID: fixture.tagId,
      EVO_RELEASE_REVISION: fixture.revision,
      EVO_RELEASE_VERSION: "test-version",
      EVO_IMAGE_SOURCE: "https://github.com/izzhackt/evo_AI_CRM",
      GITHUB_REPOSITORY: "izzhackt/evo_AI_CRM",
    },
  });
}

for (const lane of ["build", "deploy"]) {
  for (const variant of ["containerd", "classic"]) {
    test(`${lane} saved-image verification accepts ${variant} identities`, (t) => {
      const fixture = savedImageFixture(t, variant);
      const result = runSavedImageStep(lane, fixture);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), fixture.configDigest);
    });
  }
  for (const variant of ["unsafe path", "wrong bytes", "wrong tag", "multiple images", "missing config"]) {
    test(`${lane} saved-image verification rejects ${variant}`, (t) => {
      const result = runSavedImageStep(lane, savedImageFixture(t, variant));
      assert.notEqual(result.status, 0, `${variant} must fail closed`);
    });
  }
}
for (const variant of ["wrong attestation", "wrong loaded tag"]) {
  test(`deploy saved-image verification rejects ${variant}`, (t) => {
    const result = runSavedImageStep("deploy", savedImageFixture(t, variant));
    assert.notEqual(result.status, 0, `${variant} must fail closed`);
  });
}

test("both jobs pin the production Docker containerd store after secretless admission", () => {
  for (const [releaseJob, admission] of [
    [build, "Secretless build admission"], [deploy, "Secretless deploy admission"],
  ]) {
    const steps = releaseJob.split("\n      - name:").slice(1);
    const setupIndex = steps.findIndex((step) => step.includes("uses: docker/setup-docker-action@"));
    assert.ok(setupIndex > 0, "Docker setup follows secretless admission");
    assert.ok(steps[0].startsWith(` ${admission}\n`));
    const setup = steps[setupIndex];
    assert.match(setup, /uses: docker\/setup-docker-action@77e84dbf09b47d1e29270283c22f16145aa85ca1 # v5\.4\.0/u);
    assert.match(setup, /version: v29\.4\.0/u);
    const config = setup.match(/daemon-config: \|\n([\s\S]*)/u);
    assert.ok(config, "explicit daemon config must exist");
    assert.deepEqual(JSON.parse(config[1]), { features: { "containerd-snapshotter": true } });
    assert.doesNotMatch(setup, /tcp-port:|docker-host:|secrets\./u);
    const firstDocker = steps.findIndex((step) => /\bdocker (?:build|save|load|image|info|version)\b/u.test(step));
    assert.ok(firstDocker > setupIndex, "store setup precedes the first Docker operation");
  }
});

function releaseSshArgv(stepName, startMarker, endMarker, env) {
  const step = namedStep(stepName);
  const markerIndex = step.indexOf(startMarker);
  assert.notEqual(markerIndex, -1, `${stepName} SSH setup must exist`);
  const start = markerIndex + startMarker.length;
  const end = step.indexOf(endMarker, start);
  assert.ok(end > start, `${stepName} SSH invocation must be complete`);
  // Exercise the workflow's actual assembly; omit only its result-file redirection
  // and failure branch. OpenSSH joins command arguments with spaces before the
  // remote shell parses them: https://man.openbsd.org/ssh.1#DESCRIPTION
  const invocation = step.slice(start, end)
    .replace(/\bif ! ssh /u, "ssh ")
    .trimEnd()
    .replace(/\\$/u, "");
  const result = spawnSync("bash", ["-c", `
    set -Eeuo pipefail
    ssh() {
      [[ "$1" == evo-production ]]
      shift
      bash -c "$*"
    }
    ${invocation} <<'REMOTE'
    printf '%s\\0' "$@"
REMOTE
  `], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C", ...env }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.ok(result.stdout.endsWith("\0"), "remote argv must be NUL-delimited");
  return result.stdout.slice(0, -1).split("\0");
}

const deployArgumentNames = [
  "transfer_dir", "EVO_RELEASE_TRANSFER_ROOT", "EVO_RELEASE_ROOT",
  "EVO_RELEASE_PROJECT_NAME", "EVO_RELEASE_EVIDENCE_ROOT",
  "EVO_RELEASE_ROLLBACK_SEED", "EVO_RELEASE_EXTERNAL_HEALTH_URL",
  "EVO_RELEASE_MIN_FREE_KB", "EVO_WAHA_IMAGE_DIGEST", "EVO_SUPABASE_PROJECT_REF",
  "EVO_RELEASE_ID", "EVO_RELEASE_REPOSITORY", "EVO_RELEASE_REVISION",
  "EVO_RELEASE_VERSION", "release_run_id", "EVO_RELEASE_WORKFLOW_RUN_ID",
  "EVO_RELEASE_WORKFLOW_RUN_ATTEMPT", "EVO_RELEASE_UPSTREAM_CI_RUN_ID",
  "EVO_RELEASE_UPSTREAM_CI_RUN_ATTEMPT", "EVO_RELEASE_ARTIFACT_ID",
  "EVO_RELEASE_ARTIFACT_DIGEST", "archive_sha256", "image_id", "image_config_digest",
  "compose_sha256", "controller_sha256", "validator_sha256", "env_example_sha256",
  "manifest_sha256",
];
const acceptanceArgumentNames = [
  "command_name", ...deployArgumentNames.slice(0, 21), "EVO_RELEASE_ACTOR_ID",
  "EVO_RELEASE_CURRENT_MAIN_REVISION", "receipt_sha256", "controller_sha256",
];

for (const [seedLabel, rollbackSeed] of [
  ["absent", ""],
  ["present", "/opt/evo-crm/release-evidence/previous/rollback-seed.json"],
  ["shell-sensitive", "/opt/evo-crm/previous release/'seed';$literal.json"],
]) {
  for (const commandName of ["deploy", "accept-candidate", "candidate-status"]) {
    test(`${commandName} preserves every remote argument with ${seedLabel} rollback seed`, () => {
      const isDeploy = commandName === "deploy";
      const names = isDeploy ? deployArgumentNames : acceptanceArgumentNames;
      const env = Object.fromEntries(names.map((name) => [name, name]));
      env.EVO_RELEASE_ROLLBACK_SEED = rollbackSeed;
      env.command_name = commandName;
      const actual = releaseSshArgv(
        isDeploy ? "Deploy exact candidate as pending" : "Accept exact V3 candidate",
        isDeploy
          ? 'release_run_id="release-${EVO_RELEASE_WORKFLOW_RUN_ID}-${EVO_RELEASE_WORKFLOW_RUN_ATTEMPT}"\n'
          : "output_file=$2\n",
        isDeploy ? "<<'REMOTE'" : '> "$output_file"',
        env,
      );
      assert.deepEqual(actual, names.map((name) => env[name]));
    });
  }
}

test("the release stays coarse-unarmed and admits only successful manual exact-main CI", () => {
  assert.match(workflow, /^name: EVO fast app release$/mu);
  assert.match(workflow, /^  workflow_run:$/mu);
  assert.match(workflow, /^      - EVO platform CI$/mu);
  assert.match(workflow, /^      - completed$/mu);
  assert.match(workflow, /^      - main$/mu);
  assert.doesNotMatch(workflow, /^  workflow_dispatch:/mu);
  assert.match(workflow, /^permissions: \{\}$/mu);
  assert.match(workflow, /^  cancel-in-progress: false$/mu);
  assert.match(workflow, /node_modules\/\.bin\/playwright install --with-deps --only-shell chromium/u);
  assert.doesNotMatch(workflow, /node_modules\/\.bin\/playwright install --with-deps chromium/u);

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
  assert.doesNotMatch(image, /image_config_digest=\$image_id/u);
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
