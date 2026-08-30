import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const SHELL_PATH = new URL(
  "../scripts/verify-v2-10d-real-acceptance.sh",
  import.meta.url,
);
const SPEC_PATH = new URL(
  "./e2e/canonical-v2-10d-real-acceptance.spec.ts",
  import.meta.url,
);
const AMOCRM_PROVIDER_PATH = new URL(
  "../src/lib/server/canonical-amocrm-provider.ts",
  import.meta.url,
);
const PACKAGE_PATH = new URL("../package.json", import.meta.url);

function sourceIndex(source, fragment) {
  const index = source.indexOf(fragment);
  assert.notEqual(index, -1, `missing harness fragment: ${fragment}`);
  return index;
}

test("V2-10D harness gates every SSH and provider operation behind exact authority and main", async () => {
  const source = await readFile(SHELL_PATH, "utf8");
  const explicitAuthority = sourceIndex(
    source,
    '[[ "${EVO_V2_REAL_END_TO_END_ACCEPTANCE:-}" == "1" ]]',
  );
  const exactShaInput = sourceIndex(
    source,
    '[[ "$expected_main_sha" =~ ^[0-9a-f]{40}$ ]]',
  );
  const exactMainFetch = sourceIndex(source, "git fetch --quiet origin main");
  const exactMainMatch = sourceIndex(
    source,
    '[[ "$head_sha" == "$origin_main_sha" && "$head_sha" == "$expected_main_sha" ]]',
  );
  const noRerunGate = sourceIndex(
    source,
    '[[ ! -e "$review_marker" && ! -e "$dispatch_marker" && ! -e "$success_marker" ]]',
  );
  const providerMap = sourceIndex(
    source,
    '"$node_bin" scripts/prepare-connected-amocrm-validation.mjs map',
  );
  const privateSsh = sourceIndex(
    source,
    "if ! ssh -T -o BatchMode=yes -o ConnectTimeout=15",
  );
  const providerDiscovery = sourceIndex(
    source,
    "scripts/prepare-connected-amocrm-validation.mjs discover",
  );

  assert.ok(explicitAuthority < exactMainFetch);
  assert.ok(exactShaInput < exactMainFetch);
  assert.ok(exactMainFetch < exactMainMatch);
  assert.ok(exactMainMatch < noRerunGate);
  assert.ok(noRerunGate < providerMap);
  assert.ok(providerMap < privateSsh);
  assert.ok(privateSsh < providerDiscovery);

  assert.match(source, /^set -euo pipefail$/mu);
  assert.match(source, /^umask 077$/mu);
  assert.match(source, /Shell xtrace must be disabled/u);
  assert.match(source, /git status --porcelain=v1 --untracked-files=all/u);
  assert.match(source, /refs\/remotes\/origin\/main/u);
  assert.match(source, /git merge-base --is-ancestor/u);
  assert.match(source, /\$\(orb status\).*Running/u);
  assert.match(source, /\$\(docker context show\).*orbstack/u);
  assert.match(source, /V2-10D real acceptance requires Node 22\.x/u);
  assert.doesNotMatch(source, /set\s+-x|set\s+-[a-z]*x[a-z]*/u);
});

test("V2-10D harness uses ignored private secrets and protected evidence", async () => {
  const source = await readFile(SHELL_PATH, "utf8");

  assert.match(source, /data\/private-v2-provider\.env/u);
  assert.match(source, /data\/private-v2-amocrm-token\.json/u);
  assert.match(source, /assert_ignored_private_file/u);
  assert.match(source, /git check-ignore --quiet/u);
  assert.match(source, /stat -f '%Lp'.*== "600"/u);
  assert.match(source, /stat -f '%Su'/u);
  assert.match(source, /chmod 700 .*evidence_root.*evidence_dir/u);
  assert.match(source, /chmod 600 .*authority_marker/u);
  assert.match(source, /chmod 600 .*required_marker/u);
  assert.match(source, /output\/provider-acceptance\/v2-10d/u);
  assert.match(source, /review-required\.json/u);
  assert.match(source, /dispatch-attempt\.json/u);
  assert.match(source, /success\.json/u);
  assert.match(source, /forbiddenKey/u);
  assert.match(source, /forbiddenValue/u);

  const remoteBundle = sourceIndex(
    source,
    'env_file="/opt/evo-crm/.env.lead-agent"',
  );
  const remoteWaha = sourceIndex(
    source,
    'encode_line "$EVO_AGENT_WAHA_API_KEY"',
  );
  const remoteGemini = sourceIndex(source, 'encode_line "$GEMINI_API_KEY"');
  const protectedOutput = sourceIndex(
    source,
    '>"$provider_bundle_file" 2>"$ssh_probe_log"',
  );
  assert.ok(protectedOutput < remoteBundle);
  assert.ok(remoteBundle < remoteWaha);
  assert.ok(remoteWaha < remoteGemini);
  assert.match(source, /chmod 600 "\$provider_bundle_file" "\$ssh_probe_log"/u);
  assert.match(source, /rm -f -- "\$provider_bundle_file"/u);
  assert.match(source, /declare -A env_values=\(\)/u);
  assert.match(source, /while IFS= read -r line/u);
  assert.match(source, /env_values\["\$key"\]="\$raw_value"/u);
  assert.doesNotMatch(source, /^\s*\.\s+"\$env_file"/mu);
});

test("V2-10D harness proves disabled authority before one headed operator run", async () => {
  const source = await readFile(SHELL_PATH, "utf8");
  const blockedStart = sourceIndex(source, 'start_app 0 "$blocked_app_log"');
  const blockedMode = sourceIndex(
    source,
    "EVO_V2_REAL_END_TO_END_MODE=blocked",
  );
  const preparationMarker = sourceIndex(
    source,
    "--kind provider-preparation-attempt",
  );
  const discovery = sourceIndex(
    source,
    "scripts/prepare-connected-amocrm-validation.mjs discover",
  );
  const operatorStart = sourceIndex(source, 'start_app 1 "$operator_app_log"');
  const operatorMode = sourceIndex(
    source,
    "EVO_V2_REAL_END_TO_END_MODE=operator",
  );
  const headed = sourceIndex(source, "    --headed");

  assert.ok(blockedStart < blockedMode);
  assert.ok(blockedMode < preparationMarker);
  assert.ok(preparationMarker < discovery);
  assert.ok(discovery < operatorStart);
  assert.ok(operatorStart < operatorMode);
  assert.ok(operatorMode < headed);

  assert.match(source, /EVO_V2_GEMINI_PROPOSALS_ENABLED=1/u);
  assert.match(
    source,
    /EVO_V2_GEMINI_PROVIDER_AUTHORIZED="\$provider_authorized"/u,
  );
  assert.match(source, /EVO_V2_WAHA_ENABLED=1/u);
  assert.match(
    source,
    /EVO_V2_WAHA_PROVIDER_AUTHORIZED="\$provider_authorized"/u,
  );
  assert.match(source, /--provider-authorized "\$provider_authorized"/u);
  assert.equal(
    [...source.matchAll(/canonical-v2-10d-real-acceptance\.spec\.ts/gu)].length,
    3,
  );
  assert.match(source, /--project=desktop-chromium/u);
  assert.match(source, /--workers=1/u);
  assert.equal(
    [...source.matchAll(/EVO_V2_REAL_END_TO_END_PROJECT=desktop-chromium/gu)]
      .length,
    2,
  );
});

test("V2-10D failure preserves PostgreSQL state and forbids blind recovery", async () => {
  const source = await readFile(SHELL_PATH, "utf8");
  const cleanupStart = sourceIndex(source, "cleanup() {");
  const cleanupEnd = sourceIndex(source, "trap cleanup EXIT");
  const cleanup = source.slice(cleanupStart, cleanupEnd);

  assert.match(cleanup, /if \(\( run_succeeded == 1 \)\)/u);
  assert.match(cleanup, /down --volumes --remove-orphans/u);
  assert.match(cleanup, /stop postgres/u);
  assert.match(
    cleanup,
    /Protected diagnostics and PostgreSQL recovery state were preserved/u,
  );
  assert.match(cleanup, /Compose project: %s/u);
  assert.match(source, /reconcile it instead of rerunning blindly/u);
  assert.match(source, /do not rerun if a durable marker exists/u);
  assert.match(source, /docker compose .* down --volumes --remove-orphans/u);
  assert.match(source, /compose_started=0\nrun_succeeded=1/u);
  assert.doesNotMatch(source, /\b(?:mock|fixture|demo|fake)\b/iu);
  assert.doesNotMatch(source, /\b(?:supabase|sqlite)\b/iu);
  assert.doesNotMatch(source, /curl[^\n]*-X\s+(?:POST|PATCH|PUT|DELETE)/u);
});

test("V2-10D normalizes one WAHA phone identity and uses no excluded amoCRM capability", async () => {
  const shell = await readFile(SHELL_PATH, "utf8");
  const spec = await readFile(SPEC_PATH, "utf8");
  const provider = await readFile(AMOCRM_PROVIDER_PATH, "utf8");

  assert.match(
    shell,
    /filter\(\(candidate\) => typeof candidate === "string" && direct\.test\(candidate\)\)/u,
  );
  assert.match(
    shell,
    /filter\(\(candidate, index, values\) => values\.indexOf\(candidate\) === index\)/u,
  );
  assert.match(shell, /phoneIdentities\.length !== 1/u);
  assert.match(shell, /lidIdentities\.length > 1/u);
  assert.match(shell, /process\.stdout\.write\(`\$\{phoneIdentities\[0\]\}/u);
  assert.match(shell, /\^\[1-9\]\[0-9\]\{4,31\}@c\\\.us\$/u);
  assert.match(spec, /phoneIdentities\.length === 1/u);
  assert.match(spec, /lidIdentities\.length <= 1/u);

  for (const excludedCapability of [
    "files_delete",
    "push_notifications",
    "/api/v4/files",
    "/api/v4/notifications",
  ]) {
    assert.doesNotMatch(
      `${shell}\n${spec}\n${provider}`,
      new RegExp(excludedCapability.replaceAll("/", "\\/"), "u"),
    );
  }
});

test("V2-10D browser proof leaves review and send authority with the human", async () => {
  const source = await readFile(SPEC_PATH, "utf8");
  const explicitFlag = sourceIndex(
    source,
    'process.env.EVO_V2_REAL_END_TO_END_ACCEPTANCE !== "1"',
  );
  const blockedMode = sourceIndex(source, 'requiredMode() !== "blocked"');
  const operatorMode = sourceIndex(source, 'requiredMode() !== "operator"');
  const proposalRequest = source.indexOf(
    'getByTestId("canonical-gemini-proposal-request").click()',
    operatorMode,
  );
  assert.notEqual(proposalRequest, -1, "missing operator Gemini request");
  const reviewMarker = sourceIndex(source, '"review-required.json"');
  const submitBlocker = sourceIndex(
    source,
    'document.addEventListener("submit", blocker, true)',
  );
  const humanReviewWait = sourceIndex(
    source,
    'const finalReview = page.getByTestId("canonical-gemini-review-final")',
  );
  const dispatchMarker = sourceIndex(source, '"dispatch-attempt.json"');
  const submitUnblocker = sourceIndex(
    source,
    'document.removeEventListener("submit", blocker, true)',
  );

  assert.ok(explicitFlag < blockedMode);
  assert.ok(blockedMode < operatorMode);
  assert.ok(operatorMode < proposalRequest);
  assert.ok(proposalRequest < reviewMarker);
  assert.ok(reviewMarker < submitBlocker);
  assert.ok(submitBlocker < humanReviewWait);
  assert.ok(humanReviewWait < dispatchMarker);
  assert.ok(dispatchMarker < submitUnblocker);
  assert.match(
    source,
    /process\.env\.EVO_V2_REAL_END_TO_END_PROJECT !== "desktop-chromium"/u,
  );
  assert.match(source, /testInfo\.project\.name !== "desktop-chromium"/u);

  for (const humanControl of [
    "canonical-gemini-review-accept",
    "canonical-gemini-review-edit",
    "canonical-gemini-review-reject",
    "canonical-whatsapp-outbound-confirm",
    "canonical-whatsapp-outbound-send",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(
        `getByTestId\\(["']${humanControl}["']\\)\\.(?:click|check)\\(`,
        "u",
      ),
    );
  }

  assert.equal(
    [
      ...source.matchAll(
        /getByTestId\("canonical-gemini-proposal-request"\)\.click\(\)/gu,
      ),
    ].length,
    2,
  );
  assert.equal(
    [...source.matchAll(/getByTestId\("canonical-amocrm-sync"\)\.click\(\)/gu)]
      .length,
    2,
  );
  assert.match(source, /status: "review_required"/u);
  assert.match(source, /status: "dispatch_intent_recorded"/u);
  assert.match(source, /test\.setTimeout\(45 \* 60 \* 1_000\)/u);
  assert.match(
    source,
    /test\.use\(\{ trace: "off", screenshot: "off", video: "off" \}\)/u,
  );
});

test("V2-10D harness static proof is registered in the provider unit lane", async () => {
  const packageJson = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));
  assert.match(
    packageJson.scripts["test:u9"],
    /tests\/v2-10d-real-acceptance-harness\.test\.mjs/u,
  );
  assert.notEqual((await stat(SHELL_PATH)).mode & 0o111, 0);
});
