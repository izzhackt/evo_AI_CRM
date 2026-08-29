import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CANONICAL_AMOCRM_MAX_RESPONSE_BYTES,
  CANONICAL_AMOCRM_REQUEST_INTERVAL_MS,
  CanonicalAmoCrmConfigurationError,
  loadCanonicalAmoCrmProviderConfig,
} from "../src/lib/server/canonical-amocrm-provider-config.ts";
import {
  createCanonicalAmoCrmReadProvider,
  CanonicalAmoCrmProviderError,
} from "../src/lib/server/canonical-amocrm-provider.ts";
import {
  CanonicalAmoCrmTokenFileError,
  readCanonicalAmoCrmTokenFile,
  rotateCanonicalAmoCrmTokenFile,
} from "../src/lib/server/canonical-amocrm-token-store.ts";

const SECRET_ACCESS = "access-token-that-must-never-leak";
const SECRET_REFRESH = "refresh-token-that-must-never-leak";
const SECRET_CLIENT = "client-secret-that-must-never-leak";

async function makePrivateTokenFile(prefix = "evo-v2-amocrm-") {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const tokenFilePath = join(directory, "token.json");
  await writeFile(
    tokenFilePath,
    `${JSON.stringify({
      token_type: "Bearer",
      access_token: SECRET_ACCESS,
      refresh_token: SECRET_REFRESH,
      expires_in: 86_400,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(tokenFilePath, 0o600);
  return { directory, tokenFilePath };
}

function readyEnvironment(tokenFilePath) {
  return {
    EVO_V2_AMOCRM_WRITES_ENABLED: "1",
    EVO_V2_AMOCRM_PROVIDER_AUTHORIZED: "1",
    EVO_V2_AMOCRM_BASE_URL: "https://evoadmissions.amocrm.ru",
    EVO_V2_AMOCRM_CLIENT_ID: "technical-client-id-123456",
    EVO_V2_AMOCRM_CLIENT_SECRET: SECRET_CLIENT,
    EVO_V2_AMOCRM_REDIRECT_URI: "https://private.evo.example/oauth/amocrm",
    EVO_V2_AMOCRM_TOKEN_FILE: tokenFilePath,
  };
}

function readyConfig(tokenFilePath) {
  const config = loadCanonicalAmoCrmProviderConfig(
    readyEnvironment(tokenFilePath),
  );
  assert.equal(config.status, "ready");
  return config;
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function virtualClock() {
  let current = 1_000;
  return {
    now: () => current,
    sleep: async (milliseconds) => {
      current += milliseconds;
    },
  };
}

test("canonical amoCRM is disabled by default and ignores unrelated credentials", () => {
  assert.deepEqual(loadCanonicalAmoCrmProviderConfig({}), {
    status: "blocked",
    reason: "feature_disabled",
  });

  assert.deepEqual(
    loadCanonicalAmoCrmProviderConfig({
      AMO_BASE_URL: "https://unrelated.amocrm.ru",
      AMO_CLIENT_ID: "unrelated-client",
      AMO_CLIENT_SECRET: "unrelated-secret",
      AMO_REDIRECT_URI: "https://unrelated.example/callback",
      AMO_TOKEN_FILE: "/tmp/unrelated-token.json",
    }),
    { status: "blocked", reason: "feature_disabled" },
  );
});

test("canonical amoCRM requires standing authorization and every server-only value", () => {
  assert.deepEqual(
    loadCanonicalAmoCrmProviderConfig({
      EVO_V2_AMOCRM_WRITES_ENABLED: "1",
    }),
    { status: "blocked", reason: "provider_not_authorized" },
  );

  assert.deepEqual(
    loadCanonicalAmoCrmProviderConfig({
      EVO_V2_AMOCRM_WRITES_ENABLED: "1",
      EVO_V2_AMOCRM_PROVIDER_AUTHORIZED: "1",
    }),
    {
      status: "blocked",
      reason: "configuration_missing",
      missing: [
        "base_url",
        "client_id",
        "client_secret",
        "redirect_uri",
        "token_file",
      ],
    },
  );

  assert.deepEqual(
    loadCanonicalAmoCrmProviderConfig({
      ...readyEnvironment(undefined),
      EVO_V2_AMOCRM_TOKEN_FILE: undefined,
      EVO_V2_AMOCRM_ACCESS_TOKEN: SECRET_ACCESS,
      EVO_V2_AMOCRM_REFRESH_TOKEN: SECRET_REFRESH,
    }),
    {
      status: "blocked",
      reason: "configuration_missing",
      missing: ["token_file"],
    },
  );
});

test("canonical amoCRM normalizes a strict HTTPS account and exposes fixed safety bounds", async () => {
  const { tokenFilePath } = await makePrivateTokenFile();
  const config = readyConfig(tokenFilePath);

  assert.equal(config.accountOrigin, "https://evoadmissions.amocrm.ru");
  assert.equal(config.accountDomain, "evoadmissions.amocrm.ru");
  assert.equal(config.tokenFilePath, tokenFilePath);
  assert.equal(config.requestIntervalMs, CANONICAL_AMOCRM_REQUEST_INTERVAL_MS);
  assert.equal(config.maxResponseBytes, CANONICAL_AMOCRM_MAX_RESPONSE_BYTES);
  assert.ok(config.requestIntervalMs >= Math.ceil(1_000 / 7));
  assert.equal("accessToken" in config, false);
  assert.equal("refreshToken" in config, false);
  assert.equal("supabaseUrl" in config, false);
});

test("canonical amoCRM rejects malformed flags, unsafe hosts, and unsafe redirect URIs", async () => {
  const { tokenFilePath } = await makePrivateTokenFile();
  const base = readyEnvironment(tokenFilePath);
  const cases = [
    [{ ...base, EVO_V2_AMOCRM_WRITES_ENABLED: "true" }, "invalid_enabled_flag"],
    [
      { ...base, EVO_V2_AMOCRM_PROVIDER_AUTHORIZED: "yes" },
      "invalid_authorization_flag",
    ],
    [{ ...base, EVO_V2_AMOCRM_BASE_URL: "http://evo.amocrm.ru" }, "invalid_base_url"],
    [{ ...base, EVO_V2_AMOCRM_BASE_URL: "https://amocrm.ru" }, "invalid_base_url"],
    [{ ...base, EVO_V2_AMOCRM_BASE_URL: "https://evo.amocrm.ru.evil.test" }, "invalid_base_url"],
    [{ ...base, EVO_V2_AMOCRM_BASE_URL: "https://evo.amocrm.ru/api/v4" }, "invalid_base_url"],
    [{ ...base, EVO_V2_AMOCRM_BASE_URL: "https://user:pass@evo.amocrm.ru" }, "invalid_base_url"],
    [{ ...base, EVO_V2_AMOCRM_REDIRECT_URI: "http://public.example/callback" }, "invalid_redirect_uri"],
    [{ ...base, EVO_V2_AMOCRM_TOKEN_FILE: "  token.json" }, "invalid_token_file"],
    [
      { ...base, EVO_V2_AMOCRM_TOKEN_FILE: "src/accidental-token.json" },
      "invalid_token_file",
    ],
  ];

  for (const [environment, code] of cases) {
    assert.throws(
      () => loadCanonicalAmoCrmProviderConfig(environment),
      (error) =>
        error instanceof CanonicalAmoCrmConfigurationError &&
        error.code === code &&
        !error.message.includes(SECRET_CLIENT),
    );
  }
});

test("token store accepts only a private regular file and rotates it atomically", async () => {
  const { directory, tokenFilePath } = await makePrivateTokenFile();
  assert.equal((await readCanonicalAmoCrmTokenFile(tokenFilePath)).accessToken, SECRET_ACCESS);

  await rotateCanonicalAmoCrmTokenFile(tokenFilePath, {
    tokenType: "Bearer",
    accessToken: "new-access-token-kept-private",
    refreshToken: "new-refresh-token-kept-private",
    expiresInSeconds: 3_600,
  });

  const persisted = JSON.parse(await readFile(tokenFilePath, "utf8"));
  assert.equal(persisted.access_token, "new-access-token-kept-private");
  assert.equal(persisted.refresh_token, "new-refresh-token-kept-private");
  assert.equal((await lstat(tokenFilePath)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(directory), ["token.json"]);

  await chmod(tokenFilePath, 0o644);
  await assert.rejects(
    readCanonicalAmoCrmTokenFile(tokenFilePath),
    (error) =>
      error instanceof CanonicalAmoCrmTokenFileError &&
      error.code === "unsafe_permissions",
  );
});

test("token store rejects symlinks, malformed JSON, oversized files, and secret-shaped errors", async () => {
  const { directory, tokenFilePath } = await makePrivateTokenFile();
  const linkPath = join(directory, "linked-token.json");
  await symlink(tokenFilePath, linkPath);
  await assert.rejects(
    readCanonicalAmoCrmTokenFile(linkPath),
    (error) =>
      error instanceof CanonicalAmoCrmTokenFileError && error.code === "not_regular_file",
  );

  await writeFile(tokenFilePath, `{\"access_token\":\"${SECRET_ACCESS}\"`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await assert.rejects(
    readCanonicalAmoCrmTokenFile(tokenFilePath),
    (error) => {
      assert.ok(error instanceof CanonicalAmoCrmTokenFileError);
      assert.equal(error.code, "invalid_content");
      assert.equal(error.message.includes(SECRET_ACCESS), false);
      return true;
    },
  );

  await writeFile(tokenFilePath, "x".repeat(20_000), { encoding: "utf8", mode: 0o600 });
  await assert.rejects(
    readCanonicalAmoCrmTokenFile(tokenFilePath),
    (error) =>
      error instanceof CanonicalAmoCrmTokenFileError && error.code === "file_too_large",
  );
});

test("read provider exposes only the bounded canonical discovery calls", async () => {
  const { tokenFilePath } = await makePrivateTokenFile();
  const calls = [];
  const provider = createCanonicalAmoCrmReadProvider(readyConfig(tokenFilePath), {
    ...virtualClock(),
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method, authorization: init?.headers?.Authorization });
      return jsonResponse({ ok: true, path: new URL(url).pathname });
    },
  });

  await provider.getAccount();
  await provider.getPipelines();
  await provider.getUsers();
  await provider.getLeadCustomFields();
  await provider.getContactCustomFields();

  assert.deepEqual(
    calls.map(({ url }) => {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    }),
    [
      "/api/v4/account",
      "/api/v4/leads/pipelines?limit=250&page=1",
      "/api/v4/users?limit=250&page=1",
      "/api/v4/leads/custom_fields?limit=250&page=1",
      "/api/v4/contacts/custom_fields?limit=250&page=1",
    ],
  );
  assert.ok(calls.every((call) => call.method === "GET"));
  assert.ok(calls.every((call) => call.authorization === `Bearer ${SECRET_ACCESS}`));
  assert.equal("post" in provider, false);
  assert.equal("patch" in provider, false);
  assert.equal("request" in provider, false);
});

test("list discovery fails explicitly instead of treating a first page as complete", async () => {
  const { tokenFilePath } = await makePrivateTokenFile("evo-v2-amocrm-pages-");
  const provider = createCanonicalAmoCrmReadProvider(readyConfig(tokenFilePath), {
    ...virtualClock(),
    fetch: async () =>
      jsonResponse({
        _links: {
          self: { href: "https://evoadmissions.amocrm.ru/api/v4/users?page=1" },
          next: { href: "https://evoadmissions.amocrm.ru/api/v4/users?page=2" },
        },
        _embedded: { users: [] },
      }),
  });

  await assert.rejects(
    provider.getUsers(),
    (error) =>
      error instanceof CanonicalAmoCrmProviderError &&
      error.code === "discovery_incomplete",
  );
});

test("all provider calls are process-paced below seven requests per second", async () => {
  const { tokenFilePath } = await makePrivateTokenFile("evo-v2-amocrm-rate-");
  let current = 10_000;
  const starts = [];
  const provider = createCanonicalAmoCrmReadProvider(readyConfig(tokenFilePath), {
    now: () => current,
    sleep: async (milliseconds) => {
      current += milliseconds;
    },
    fetch: async () => {
      starts.push(current);
      return jsonResponse({ ok: true });
    },
  });

  await Promise.all([provider.getAccount(), provider.getPipelines(), provider.getUsers()]);
  assert.equal(starts.length, 3);
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(starts[index] - starts[index - 1] >= CANONICAL_AMOCRM_REQUEST_INTERVAL_MS);
  }
});

test("one 401 performs one serialized refresh and one replay, including concurrent callers", async () => {
  const { tokenFilePath } = await makePrivateTokenFile("evo-v2-amocrm-refresh-");
  const calls = [];
  const provider = createCanonicalAmoCrmReadProvider(readyConfig(tokenFilePath), {
    ...virtualClock(),
    fetch: async (url, init) => {
      const authorization = init?.headers?.Authorization ?? null;
      calls.push({ path: new URL(url).pathname, method: init?.method, authorization });
      if (new URL(url).pathname === "/oauth2/access_token") {
        const request = JSON.parse(String(init?.body));
        assert.equal(request.client_secret, SECRET_CLIENT);
        assert.equal(request.refresh_token, SECRET_REFRESH);
        return jsonResponse({
          token_type: "Bearer",
          access_token: "refreshed-access-token",
          refresh_token: "refreshed-refresh-token",
          expires_in: 86_400,
        });
      }
      if (authorization === `Bearer ${SECRET_ACCESS}`) {
        return new Response(null, { status: 401 });
      }
      return jsonResponse({ id: 42 });
    },
  });

  const [account, users] = await Promise.all([provider.getAccount(), provider.getUsers()]);
  assert.deepEqual(account, { id: 42 });
  assert.deepEqual(users, { id: 42 });
  assert.equal(calls.filter((call) => call.path === "/oauth2/access_token").length, 1);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(calls.at(-1).authorization, "Bearer refreshed-access-token");
  assert.equal((await readCanonicalAmoCrmTokenFile(tokenFilePath)).refreshToken, "refreshed-refresh-token");
});

test("a rejected replay stops after one refresh without blind retry", async () => {
  const { tokenFilePath } = await makePrivateTokenFile("evo-v2-amocrm-replay-");
  let calls = 0;
  const provider = createCanonicalAmoCrmReadProvider(readyConfig(tokenFilePath), {
    ...virtualClock(),
    fetch: async (url) => {
      calls += 1;
      if (new URL(url).pathname === "/oauth2/access_token") {
        return jsonResponse({
          token_type: "Bearer",
          access_token: "refreshed-access-token",
          refresh_token: "refreshed-refresh-token",
          expires_in: 3_600,
        });
      }
      return jsonResponse({ secret: SECRET_ACCESS }, { status: 401 });
    },
  });

  await assert.rejects(provider.getAccount(), (error) => {
    assert.ok(error instanceof CanonicalAmoCrmProviderError);
    assert.equal(error.code, "authentication_failed");
    assert.equal(error.message.includes(SECRET_ACCESS), false);
    return true;
  });
  assert.equal(calls, 3);
});

test("provider rejects oversized and secret-bearing failures without exposing response content", async () => {
  const { tokenFilePath } = await makePrivateTokenFile("evo-v2-amocrm-bounds-");
  const config = readyConfig(tokenFilePath);
  const oversized = createCanonicalAmoCrmReadProvider(config, {
    ...virtualClock(),
    fetch: async () =>
      new Response("x".repeat(CANONICAL_AMOCRM_MAX_RESPONSE_BYTES + 1), {
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(
    oversized.getAccount(),
    (error) =>
      error instanceof CanonicalAmoCrmProviderError && error.code === "response_too_large",
  );

  const rejected = createCanonicalAmoCrmReadProvider(config, {
    ...virtualClock(),
    fetch: async () =>
      jsonResponse(
        { error: SECRET_ACCESS, refresh: SECRET_REFRESH, client: SECRET_CLIENT },
        { status: 429 },
      ),
  });
  await assert.rejects(rejected.getUsers(), (error) => {
    assert.ok(error instanceof CanonicalAmoCrmProviderError);
    assert.equal(error.code, "provider_rejected");
    assert.equal(error.status, 429);
    const serialized = `${error.name} ${error.message} ${JSON.stringify(error)}`;
    assert.equal(serialized.includes(SECRET_ACCESS), false);
    assert.equal(serialized.includes(SECRET_REFRESH), false);
    assert.equal(serialized.includes(SECRET_CLIENT), false);
    return true;
  });
});

test("provider applies the configured deadline and maps timeout details to a redacted error", async () => {
  const { tokenFilePath } = await makePrivateTokenFile("evo-v2-amocrm-timeout-");
  const config = readyConfig(tokenFilePath);
  let requestedTimeout = null;
  const signal = new AbortController().signal;
  const provider = createCanonicalAmoCrmReadProvider(config, {
    ...virtualClock(),
    createTimeoutSignal: (milliseconds) => {
      requestedTimeout = milliseconds;
      return signal;
    },
    fetch: async () => {
      const error = new Error(`Timeout while using ${SECRET_ACCESS}`);
      error.name = "TimeoutError";
      throw error;
    },
  });

  await assert.rejects(provider.getAccount(), (error) => {
    assert.ok(error instanceof CanonicalAmoCrmProviderError);
    assert.equal(error.code, "request_timeout");
    assert.equal(error.message.includes(SECRET_ACCESS), false);
    return true;
  });
  assert.equal(requestedTimeout, config.timeoutMs);
});

test("canonical amoCRM provider files stay server-only and contain no legacy or database adapter seam", async () => {
  const files = [
    "../src/lib/server/canonical-amocrm-provider-config.ts",
    "../src/lib/server/canonical-amocrm-token-store.ts",
    "../src/lib/server/canonical-amocrm-provider.ts",
  ];
  for (const relativePath of files) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /^import "server-only";/u);
    for (const forbidden of [
      "EVO_AGENT_",
      "EVO_PLATFORM_AMOCRM",
      "NEXT_PUBLIC_",
      "supabase",
      "better-sqlite3",
      "canonical-crm-repository",
    ]) {
      assert.equal(source.includes(forbidden), false, `${relativePath} imports ${forbidden}`);
    }
  }
});
