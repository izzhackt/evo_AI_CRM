import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SHELL_PATH = new URL(
  "../scripts/verify-connected-amocrm-validation.sh",
  import.meta.url,
);
const PREPARE_PATH = new URL(
  "../scripts/prepare-connected-amocrm-validation.mjs",
  import.meta.url,
);
const E2E_PATH = new URL(
  "./e2e/canonical-amocrm-connected-provider.spec.ts",
  import.meta.url,
);

test("connected amoCRM harness is opt-in, exact-main and OrbStack-only", async () => {
  const source = await readFile(SHELL_PATH, "utf8");

  assert.match(source, /^set -euo pipefail$/m);
  assert.match(source, /^umask 077$/m);
  assert.match(source, /Shell xtrace must be disabled/u);
  assert.match(source, /EVO_V2_REAL_AMOCRM_ACCEPTANCE:-.*== "1"/u);
  assert.match(source, /git fetch --quiet origin main/u);
  assert.match(source, /git status --porcelain=v1 --untracked-files=all/u);
  assert.match(source, /head_sha.*origin_main_sha.*expected_main_sha/su);
  assert.match(source, /\$\(orb status\).*Running/u);
  assert.match(source, /\$\(docker context show\).*orbstack/u);
  assert.match(source, /mktemp -d/u);
  assert.match(source, /private legacy provider env file/u);
  assert.match(source, /private token file/u);
  assert.equal([...source.matchAll(/-o BatchMode=yes/gu)].length, 2);
  assert.equal([...source.matchAll(/-o ConnectTimeout=15/gu)].length, 2);
  const addressReadIndex = source.indexOf('container_ip="$(awk');
  const addressValidationIndex = source.indexOf("validate-private-ipv4");
  const tunnelIndex = source.indexOf("ssh -o BatchMode=yes", addressValidationIndex);
  const forwardIndex = source.indexOf('-L "127.0.0.1:${tunnel_port}:', tunnelIndex);
  assert.ok(addressReadIndex >= 0 && addressValidationIndex > addressReadIndex);
  assert.ok(tunnelIndex > addressValidationIndex && forwardIndex > tunnelIndex);
  assert.match(source, /-L "127\.0\.0\.1:\$\{tunnel_port\}:/u);
  assert.match(source, /read-waha-self/u);
  assert.match(source, /authority-blocked\.json/u);
  assert.match(source, /provider-preparation-attempt\.json/u);
  assert.match(source, /dispatch-attempt\.json/u);
  assert.match(source, /success\.database\?\.exactUiReplay === true/u);
  assert.match(source, /success\.database\?\.replayAddedAttemptCount === 0/u);
  assert.match(source, /success\.database\?\.replayAddedReceiptCount === 0/u);
  assert.match(source, /success\.database\?\.replayAddedBindingCount === 0/u);
  assert.match(source, /success\.database\?\.replayProviderEntitySetUnchanged === true/u);
  assert.match(source, /success\.provider\?\.validationContactCount === 1/u);
  assert.match(source, /success\.provider\?\.validationLeadCount === 1/u);
  assert.match(source, /success\.provider\?\.validationNoteCount === 1/u);
  assert.match(source, /success\.boundaries\?\.v1ApplicationPathExecuted === false/u);
  assert.match(source, /success\.boundaries\?\.existingWahaSessionReadOnly === true/u);
  assert.match(source, /forbiddenKey/u);
  assert.match(source, /canonical-amocrm-connected-provider\.spec\.ts/u);
  assert.doesNotMatch(source, /set -x/u);
  assert.doesNotMatch(source, /curl[^\n]*-X\s+(POST|PATCH|PUT|DELETE)/u);
  assert.doesNotMatch(source, /source\s+.*provider/u);
});

test("connected amoCRM harness canonicalizes a trailing-slash TMPDIR before creating private paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evo-amocrm-tmp-root."));
  try {
    const result = spawnSync(
      "bash",
      [fileURLToPath(SHELL_PATH), "0".repeat(40)],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          EVO_NODE_BIN: process.execPath,
          EVO_V2_REAL_AMOCRM_ACCEPTANCE: "0",
          TMPDIR: `${directory}/`,
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Connected amoCRM acceptance requires EVO_V2_REAL_AMOCRM_ACCEPTANCE=1/u,
    );
    assert.doesNotMatch(result.stderr, /\/{2}evo-v2-real-amocrm\./u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preparation helper maps only the explicit legacy provider keys into private V2 state", async () => {
  const source = await readFile(PREPARE_PATH, "utf8");

  for (const legacyKey of [
    "EVO_AGENT_AMO_BASE_URL",
    "EVO_AGENT_AMO_CLIENT_ID",
    "EVO_AGENT_AMO_CLIENT_SECRET",
    "EVO_AGENT_AMO_REDIRECT_URI",
    "EVO_AGENT_WAHA_API_KEY",
    "EVO_AGENT_WAHA_SESSION",
  ]) {
    assert.match(source, new RegExp(legacyKey, "u"));
  }
  for (const v2Key of [
    "EVO_V2_AMOCRM_BASE_URL",
    "EVO_V2_AMOCRM_CLIENT_ID",
    "EVO_V2_AMOCRM_CLIENT_SECRET",
    "EVO_V2_AMOCRM_REDIRECT_URI",
    "EVO_V2_AMOCRM_TOKEN_FILE",
  ]) {
    assert.match(source, new RegExp(v2Key, "u"));
  }

  assert.match(source, /parseEnv/u);
  assert.match(source, /lstat/u);
  assert.match(source, /0o077/u);
  assert.match(source, /wx/u);
  assert.match(source, /prepareEnsureLeadTag|ensureLeadTag/u);
  assert.match(source, /EVO V2 Sales/u);
  assert.match(source, /EVO V2 Admissions/u);
  assert.match(source, /is_main/u);
  assert.match(source, /is_archive/u);
  assert.match(source, /is_editable/u);
  assert.match(source, /current_user_id/u);
  assert.match(source, /status\.id !== "142"/u);
  assert.match(source, /status\.id !== "143"/u);
  assert.doesNotMatch(source, /status\.type !== "?14[23]"?/u);
  assert.match(source, /createCanonicalPersonLead/u);
  assert.match(source, /discoverCanonicalAmoCrmCommandRouting/u);
  assert.match(source, /spawn/u);
  assert.doesNotMatch(source, /console\.log\([^)]*(token|secret|apiKey)/iu);
});

test("private tunnel address validation accepts only exact RFC1918 IPv4", () => {
  const invoke = (value) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(PREPARE_PATH),
        "validate-private-ipv4",
        "--value",
        value,
      ],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        timeout: 10_000,
      },
    );

  for (const value of ["10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.1"]) {
    const result = invoke(value);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }

  for (const value of [
    "8.8.8.8",
    "127.0.0.1",
    "169.254.1.1",
    "172.15.0.1",
    "172.32.0.1",
    "10.0.0.1 ",
    "010.0.0.1",
    "10.0.0.999",
    "::1",
    "-oProxyCommand=invalid",
  ]) {
    const result = invoke(value);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /private_tunnel_address_invalid|arguments_invalid/u);
    assert.doesNotMatch(result.stderr, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
});

test("preparation CLI maps a private bundle without executing it and rejects loose permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evo-amocrm-map-test."));
  const providerEnv = join(directory, "provider.env");
  const tokenFile = join(directory, "token.json");
  const runtimeFile = join(directory, "runtime.json");
  const refusedRuntimeFile = join(directory, "refused-runtime.json");
  await chmod(directory, 0o700);
  try {
    await writeFile(
      providerEnv,
      [
        "EVO_AGENT_AMO_BASE_URL=https://technical.amocrm.ru",
        "EVO_AGENT_AMO_CLIENT_ID=technical-client-id",
        "EVO_AGENT_AMO_CLIENT_SECRET=technical-client-secret",
        "EVO_AGENT_AMO_REDIRECT_URI=http://127.0.0.1/oauth/amocrm",
        "EVO_AGENT_WAHA_API_KEY=technical-api-key",
        "EVO_AGENT_WAHA_SESSION=technical-session",
        "UNRELATED_VALUE=must-not-be-mapped",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await writeFile(
      tokenFile,
      `${JSON.stringify({
        access_token: "technical-access-token",
        refresh_token: "technical-refresh-token",
      })}\n`,
      { mode: 0o600 },
    );

    const invoke = (outputPath) =>
      spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--experimental-strip-types",
          fileURLToPath(PREPARE_PATH),
          "map",
          "--provider-env",
          providerEnv,
          "--token-file",
          tokenFile,
          "--runtime-file",
          outputPath,
        ],
        {
          cwd: new URL("..", import.meta.url),
          encoding: "utf8",
          timeout: 10_000,
        },
      );

    const accepted = invoke(runtimeFile);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stdout, "");
    const runtime = JSON.parse(await readFile(runtimeFile, "utf8"));
    assert.deepEqual(Object.keys(runtime.providerEnvironment).sort(), [
      "EVO_V2_AMOCRM_BASE_URL",
      "EVO_V2_AMOCRM_CLIENT_ID",
      "EVO_V2_AMOCRM_CLIENT_SECRET",
      "EVO_V2_AMOCRM_REDIRECT_URI",
      "EVO_V2_AMOCRM_TOKEN_FILE",
    ]);
    assert.equal(runtime.providerEnvironment.EVO_V2_AMOCRM_TOKEN_FILE, tokenFile);
    assert.equal(Object.hasOwn(runtime.providerEnvironment, "UNRELATED_VALUE"), false);
    assert.equal((await stat(runtimeFile)).mode & 0o077, 0);

    await chmod(providerEnv, 0o644);
    const refused = invoke(refusedRuntimeFile);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /legacy_provider_env_invalid/u);
    await assert.rejects(() => stat(refusedRuntimeFile), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("connected amoCRM browser acceptance is inert without its explicit flag", async () => {
  const source = await readFile(E2E_PATH, "utf8");
  assert.match(
    source,
    /test\.skip\(\s*process\.env\.EVO_V2_REAL_AMOCRM_ACCEPTANCE !== "1"/u,
  );
  assert.match(source, /EVO_V2_CONNECTED_AMOCRM_MODE/u);
  assert.match(source, /provider-not-authorized/u);
  assert.match(source, /one_explicit_admin_sync/u);
  assert.match(source, /exactReadback/u);
  assert.match(source, /exactUiReplay/u);
  assert.match(source, /replayAddedAttemptCount:\s*0/u);
  assert.match(source, /replayAddedReceiptCount:\s*0/u);
  assert.match(source, /replayAddedBindingCount:\s*0/u);
  assert.match(source, /replayProviderEntitySetUnchanged:\s*true/u);
  assert.match(source, /validationContactCount:\s*provider\.validationContactCount/u);
  assert.match(source, /validationLeadCount:\s*provider\.validationLeadCount/u);
  assert.match(source, /validationNoteCount:\s*provider\.validationNoteCount/u);
  assert.match(source, /\/api\/v4\/contacts\?limit=250&filter%5Bname%5D%5B%5D=/u);
  assert.match(source, /\/api\/v4\/leads\?limit=250&filter%5Bname%5D%5B%5D=/u);
  assert.match(
    source,
    /\/notes\?limit=250&filter%5Bnote_type%5D%5B%5D=common/u,
  );
  assert.match(source, /persistedAfterReload:\s*true/u);
  assert.match(source, /v1ApplicationPathExecuted:\s*false/u);
  assert.match(source, /existingWahaSessionReadOnly:\s*true/u);
  assert.doesNotMatch(source, /v1RuntimeExecuted/u);

  const result = spawnSync(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "tests/e2e/canonical-amocrm-connected-provider.spec.ts",
      "--config=playwright.config.ts",
      "--project=desktop-chromium",
      "--workers=1",
      "--reporter=line",
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:9",
        EVO_V2_REAL_AMOCRM_ACCEPTANCE: "0",
      },
      timeout: 30_000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(`${result.stdout}\n${result.stderr}`, /skipped/u);
});
