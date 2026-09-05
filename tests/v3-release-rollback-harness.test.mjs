import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../scripts/test-v3-release-rollback-orbstack.mjs", import.meta.url),
  "utf8",
);

test("rollback harness is explicit opt-in and fails closed outside OrbStack", () => {
  assert.match(source, /EVO_RUN_V3_RELEASE_ROLLBACK_ORBSTACK/u);
  assert.match(source, /process\.env\[OPT_IN\] !== REQUIRED_OPT_IN_VALUE/u);
  assert.match(source, /status: "skipped", code: "explicit_opt_in_required"/u);
  assert.match(source, /execute\("orb", \["status"\]/u);
  assert.match(source, /"Running"/u);
  assert.match(source, /execute\("docker", \["context", "show"\]/u);
  assert.match(source, /"orbstack"/u);
  assert.match(source, /process\.env\.DOCKER_HOST/u);
  assert.match(source, /delete environment\.DOCKER_HOST/u);
  assert.match(source, /\["--context", "orbstack", \.\.\.args\]/u);
  assert.doesNotMatch(source, /docker context use|orb start/u);
});

test("rollback harness owns one unique disposable contour and targeted cleanup", () => {
  assert.match(source, /mkdtempSync\(join\(temporaryRoot, HARNESS_PREFIX\)\)/u);
  assert.match(source, /randomBytes\(6\)\.toString\("hex"\)/u);
  assert.match(source, /--project-name/u);
  assert.match(source, /EVO_TEST_NETWORK/u);
  assert.match(source, /reserveLoopbackPort/u);
  assert.match(source, /label=com\.docker\.compose\.project=\$\{projectName\}/u);
  assert.match(source, /compose\(\["down", "--volumes", "--remove-orphans"/u);
  assert.match(source, /env: runtimeComposeEnvironment/u);
  assert.match(source, /label=com\.docker\.compose\.project=\$\{projectName\}/u);
  assert.match(source, /docker\(\["rm", "--force", \.\.\.remainingContainers\]\)/u);
  assert.match(source, /docker\(\["network", "rm", networkName\]\)/u);
  assert.match(source, /disposable network must not survive cleanup/u);
  assert.match(source, /disposable image \$\{reference\} must not survive cleanup/u);
  assert.match(source, /baselineTag, candidateTag, rollbackTag/u);
  assert.match(source, /readFileSync\(markerPath/u);
  assert.match(source, /basename\(harnessRoot\)\.startsWith\(HARNESS_PREFIX\)/u);
  assert.match(source, /dirname\(harnessRoot\), temporaryRoot/u);
  assert.doesNotMatch(source, /system\s+prune|container\s+prune|volume\s+prune|network\s+prune/u);
  assert.doesNotMatch(source, /rmSync\((temporaryRoot|repositoryRoot)/u);
});

test("rollback harness exercises real images, Compose, and the real controller", () => {
  assert.match(source, /docker\(\["pull", "--platform", "linux\/amd64", "node:22-alpine"\]/u);
  assert.match(source, /node@sha256:/u);
  assert.match(source, /"build",\s+"--platform",\s+"linux\/amd64"/u);
  assert.match(source, /healthStatus: 200/u);
  assert.match(source, /healthStatus: 503/u);
  assert.match(source, /compose\(\["up", "--detach", "--wait"/u);
  assert.match(source, /compose\(\["rm", "--stop", "--force", "app"\]/u);
  assert.match(source, /runController\("seal-rollback-seed"/u);
  assert.match(source, /docker\(\["image", "save", "--output", candidateArchive/u);
  assert.match(source, /docker\(\["image", "rm", "--force", candidateTag\]/u);
  assert.match(source, /candidate image must be absent before the controller loads the archive/u);
  assert.match(source, /runController\(\s*"deploy"/u);
  assert.match(source, /\[3\]/u);
  assert.match(source, /status, "rolled_back"/u);
  assert.match(source, /code, "deployment_failed"/u);
  assert.match(source, /runController\(\s*"rollback"/u);
  assert.match(source, /rollback_target_not_active/u);
});

test("macOS rollback proof uses a test-local real fcntl lock without weakening production", () => {
  assert.match(source, /nativeProbe\.error\?\.code !== "ENOENT"/u);
  assert.match(source, /process\.platform,[\s\S]*"darwin"/u);
  assert.match(source, /fcntl\.flock\(9, fcntl\.LOCK_EX \| fcntl\.LOCK_NB\)/u);
  assert.match(source, /PATH: releaseToolPath/u);
  assert.match(source, /PYTHONNOUSERSITE: "1"/u);
  assert.match(source, /releaseLockTool = "macos-python-fcntl"/u);
  assert.match(source, /verifyReleaseLockContention\(\)/u);
  assert.match(source, /contender_status/u);
  assert.match(source, /releaseLockContentionProved/u);
  assert.doesNotMatch(source, /EVO_RELEASE_DISABLE_LOCK|skip[_-]lock|mock[_-]flock/iu);
});

test("rollback proof verifies exact restored identity and controller evidence", () => {
  assert.match(source, /state\.previousImage, baselineImageId/u);
  assert.match(source, /state\.previousRevision, baselineRevision/u);
  assert.match(source, /state\.previousVersion, baselineVersion/u);
  assert.match(source, /state\.targetRevision, candidateRevision/u);
  assert.match(source, /result\.rolledBack/u);
  assert.match(source, /inspectContainer\(restoredApp, "\{\{\.Image\}\}"\)/u);
  assert.match(source, /org\.opencontainers\.image\.revision/u);
  assert.match(source, /org\.opencontainers\.image\.version/u);
  assert.match(source, /assertHealthyHttp\(baselineRevision, baselineVersion\)/u);
  assert.match(source, /serviceContainer\("waha"\), wahaContainer/u);
  assert.match(source, /candidate_failed_and_exact_baseline_rolled_back/u);
  assert.match(source, /staleRollbackRefused: true/u);
});

test("rollback harness cannot call real Supabase or provider mutation paths", () => {
  assert.match(source, /supabase\.invalid/u);
  assert.match(source, /EVO_PLATFORM_WAHA_INGRESS_ENABLED=0/u);
  assert.match(source, /EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0/u);
  assert.match(source, /providersCalled: false/u);
  assert.doesNotMatch(source, /supabase\.co|crm\.evoadmissions\.com|72\.62\.119\.112/u);
  assert.doesNotMatch(source, /api\/sendText|api\/sessions|api\/webhook|amoCRM|Gemini/u);
  assert.doesNotMatch(source, /\bssh\b|\bscp\b|\brsync\b/u);
});
