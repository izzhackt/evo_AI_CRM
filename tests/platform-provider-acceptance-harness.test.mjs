import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

function source(path) {
  const url = new URL(path, ROOT);
  assert.equal(existsSync(url), true, `${path} must exist`);
  return readFileSync(url, "utf8");
}

function between(value, start, end) {
  const startIndex = value.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source boundary: ${start}`);
  const endIndex = value.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source boundary: ${end}`);
  return value.slice(startIndex, endIndex);
}

test("Platform provider acceptance is exact-SHA, private, single-run and fail-closed", () => {
  const shell = source("scripts/verify-platform-provider-acceptance.sh");

  assert.match(shell, /set -euo pipefail/u);
  assert.match(shell, /umask 077/u);
  assert.match(shell, /Shell xtrace must be disabled/u);
  assert.match(shell, /EVO_PLATFORM_REAL_PROVIDER_ACCEPTANCE/u);
  assert.match(shell, /EVO_PLATFORM_ACCEPTANCE_EXPECTED_SHA/u);
  assert.match(shell, /git status --porcelain=v1 --untracked-files=all/u);
  assert.match(shell, /EVO_PLATFORM_ACCEPTANCE_REMOTE_REF/u);
  assert.match(shell, /git fetch --quiet origin/u);
  assert.match(shell, /remote acceptance ref/u);
  assert.doesNotMatch(shell, /refs\/remotes\/origin\/main|origin main/u);
  assert.match(shell, /orb status/u);
  assert.match(shell, /docker context show/u);
  assert.match(shell, /orbstack/u);
  assert.match(shell, /supabase db reset --local --no-seed --yes/u);
  assert.match(
    shell,
    /LOCAL_PLATFORM_COMMUNICATIONS_PROVISIONED \[0-9a-f-\]\{36\} \[0-9a-f-\]\{36\}/u,
  );
  assert.match(shell, /EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID/u);

  assert.match(shell, /EVO_PLATFORM_ACCEPTANCE_TARGET_CHAT_ID/u);
  assert.match(shell, /EVO_PLATFORM_ACCEPTANCE_SOURCE_MESSAGE_ID/u);
  assert.match(shell, /EVO_PLATFORM_ACCEPTANCE_TARGET_AUTHORIZATION/u);
  assert.match(shell, /MINIMIZED_SINGLE_CHAT/u);
  assert.match(shell, /run-attempt\.json/u);
  assert.match(shell, /waha-dispatch-attempt\.json/u);
  assert.match(shell, /success\.json/u);

  assert.match(shell, /\/opt\/evo-crm\/\.env\.lead-agent/u);
  assert.match(shell, /evo-crm-waha-1/u);
  assert.match(shell, /evo_crm_private/u);
  assert.match(shell, /EVO_AGENT_WAHA_API_KEY/u);
  assert.match(shell, /EVO_AGENT_WAHA_BASE_URL/u);
  assert.match(shell, /EVO_AGENT_WAHA_SESSION/u);
  assert.match(shell, /GEMINI_API_KEY/u);
  assert.match(shell, /crm_primary/u);
  assert.match(shell, /http:\/\/evo-crm-waha:3000/u);
  assert.match(shell, /EVO_PLATFORM_GEMINI_API_KEY/u);
  assert.match(shell, /EVO_TEST_WAHA_REWRITE_BASE_URL/u);
  assert.doesNotMatch(shell, /\/opt\/evo-inbox|evo-inbox-waha|evo_inbox_private/u);
  assert.doesNotMatch(shell, /\.env\.gemini/u);
  assert.doesNotMatch(shell, /EVO_V2_(?:WAHA|GEMINI)/u);
  assert.doesNotMatch(shell, /set -x|curl[^\n]*--verbose/u);
  const remoteProviderProbe = between(
    shell,
    'runtime_env="/opt/evo-crm/.env.lead-agent"',
    "REMOTE\nthen",
  );
  assert.doesNotMatch(
    remoteProviderProbe,
    /\bcurl\b|\bwget\b|docker (?:exec|compose)|\/api\/|webhook/iu,
  );

  assert.match(
    shell,
    /playwright\.platform-provider-acceptance\.config\.ts/u,
  );
  assert.notEqual(
    statSync(new URL("scripts/verify-platform-provider-acceptance.sh", ROOT)).mode & 0o111,
    0,
  );
});

test("the one browser proof performs one reviewed Gemini call and one explicit WAHA send", () => {
  const config = source("playwright.platform-provider-acceptance.config.ts");
  const spec = source("tests/e2e/platform-provider-acceptance.spec.ts");

  assert.match(config, /testMatch: "platform-provider-acceptance\.spec\.ts"/u);
  assert.match(config, /retries: 0/u);
  assert.match(config, /fullyParallel: false/u);
  assert.match(config, /workers: 1/u);
  assert.match(config, /PLAYWRIGHT_BASE_URL is required/u);

  assert.equal((spec.match(/^test\(/gmu) ?? []).length, 1);
  assert.equal(
    (spec.match(/getByRole\("button", \{ name: "Подготовить черновик" \}\)\.click\(\)/gu) ?? [])
      .length,
    1,
  );
  assert.equal(
    (spec.match(/getByTestId\("v3-inbox-send"\)\.click\(\)/gu) ?? []).length,
    1,
  );
  assert.match(spec, /Сохранить исправленный текст/u);
  assert.match(spec, /waha-dispatch-attempt\.json/u);
  assert.match(spec, /geminiRequestCount/u);
  assert.match(spec, /geminiResultCount/u);
  assert.match(spec, /geminiReviewCount/u);
  assert.match(spec, /manualSendAttemptCount/u);
  assert.match(spec, /outboundMessageCount/u);
  assert.match(spec, /providerBindingCount/u);
  assert.match(spec, /exactReadback/u);
  assert.match(spec, /matchingProviderSendCount/u);
  assert.match(spec, /matchingProviderSendCount !== 1/u);
  assert.match(spec, /chmod\(.*0o600/u);
  assert.match(spec, /SYNTHETIC_INBOUND_SEED/u);
  assert.match(spec, /inboundSeed: "synthetic_non_personal_setup"/u);
  assert.match(spec, /\/api\/sessions\/\$\{encodeURIComponent\(wahaSessionName\)\}/u);
  assert.match(spec, /session\?\.name !== wahaSessionName/u);
  assert.match(spec, /session\.status !== "WORKING"/u);
  assert.match(spec, /event: "session\.status"/u);
  assert.match(spec, /status: "synchronized"/u);
  assert.doesNotMatch(spec, /sourceMessage\.body/u);
  assert.doesNotMatch(spec, /console\.(?:log|error)|page\.screenshot/u);
  const evidenceShape = between(
    spec,
    "const successEvidence = Object.freeze({",
    "await writePrivateJson(successEvidencePath",
  );
  assert.doesNotMatch(
    evidenceShape,
    /api.?key|target.?chat|recipient|source.?message|provider.?message|final.?text/iu,
  );
});

test("local browser proof resolves one ambiguous send only through exact WAHA readback", () => {
  const foundation = source("scripts/test-postgres-v2-foundation.sh");
  const spec = source("tests/e2e/platform-communications.spec.ts");

  assert.match(foundation, /waha_session_name="crm_primary"/u);
  assert.doesNotMatch(foundation, /waha_session_name="evo-inbox"/u);
  assert.match(foundation, /EVO_TEST_WAHA_UNKNOWN_TEXT/u);
  assert.match(foundation, /body\.text === unknownResultText/u);
  assert.match(foundation, /source: "api"/u);
  assert.match(foundation, /to: body\.chatId/u);
  assert.doesNotMatch(foundation, /sendCount === 2/u);

  const scenario = between(
    spec,
    'test("an ambiguous provider result blocks resend',
    'test("missing primary webhook secret fails clearly',
  );
  assert.equal(
    (scenario.match(/getByTestId\("v3-inbox-send"\)\s*;/gu) ?? []).length,
    1,
  );
  assert.match(scenario, /await sendButton\.click\(\)/u);
  assert.match(scenario, /await expect\(sendButton\)\.toBeDisabled\(\)/u);
  assert.match(scenario, /v3-inbox-reconcile/u);
  assert.match(scenario, /sendCount - beforeSendCount\)\.toBe\(1\)/u);
  assert.match(scenario, /requests\.filter/u);
  assert.match(scenario, /toHaveLength\(1\)/u);
});
