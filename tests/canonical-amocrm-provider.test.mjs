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
  createCanonicalAmoCrmWriteProvider,
  CanonicalAmoCrmMutationError,
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
  await provider.getLeadTags();
  await provider.getUsers();
  await provider.getLeadCustomFields();
  await provider.getContactCustomFields();

  assert.deepEqual(
    calls.map(({ url }) => {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    }),
    [
      "/api/v4/account?with=datetime_settings",
      "/api/v4/leads/pipelines?limit=250&page=1",
      "/api/v4/leads/tags?limit=250&page=1",
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

test("canonical amoCRM creates one contact through the pinned origin and exposes secret-free transport evidence", async () => {
  const { tokenFilePath } = await makePrivateTokenFile();
  const calls = [];
  const provider = createCanonicalAmoCrmWriteProvider(readyConfig(tokenFilePath), {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(
        {
          _embedded: {
            contacts: [{ id: 918273, request_id: "command-contact-1" }],
          },
        },
        { headers: { "x-request-id": "provider-request-contact-1" } },
      );
    },
  });

  const result = await provider.createContact({
    requestId: "command-contact-1",
    name: "Provider validation contact",
    responsibleUserId: "192837",
    customFieldsValues: [
      {
        fieldId: "81001",
        values: [{ value: "+971500000000", enumCode: "WORK" }],
      },
    ],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://evoadmissions.amocrm.ru/api/v4/contacts");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SECRET_ACCESS}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    {
      request_id: "command-contact-1",
      name: "Provider validation contact",
      responsible_user_id: 192837,
      custom_fields_values: [
        {
          field_id: 81001,
          values: [{ value: "+971500000000", enum_code: "WORK" }],
        },
      ],
    },
  ]);
  assert.deepEqual(result, {
    entityId: "918273",
    request: {
      method: "POST",
      path: "/api/v4/contacts",
      requestId: "command-contact-1",
    },
    response: {
      status: 200,
      providerRequestId: "provider-request-contact-1",
    },
  });
  assert.equal(JSON.stringify(result).includes(SECRET_ACCESS), false);
  assert.equal(JSON.stringify(result).includes(SECRET_CLIENT), false);
});

test("canonical amoCRM freezes and hashes the exact mutation before one-shot dispatch", async () => {
  const { tokenFilePath } = await makePrivateTokenFile();
  let callCount = 0;
  let sentBody = null;
  const provider = createCanonicalAmoCrmWriteProvider(readyConfig(tokenFilePath), {
    fetch: async (_url, init) => {
      callCount += 1;
      sentBody = init.body;
      return jsonResponse({
        _embedded: {
          contacts: [{ id: 101, request_id: "prepare-contact" }],
        },
      });
    },
  });

  const prepared = provider.prepareCreateContact({
    requestId: "prepare-contact",
    name: "Contact",
  });
  assert.equal(callCount, 0);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.request), true);
  assert.equal(Object.isFrozen(prepared.body), true);
  assert.equal(Object.isFrozen(prepared.body[0]), true);
  assert.deepEqual(prepared.request, {
    method: "POST",
    path: "/api/v4/contacts",
    requestId: "prepare-contact",
  });
  assert.equal(
    prepared.bodyJson,
    '[{"request_id":"prepare-contact","name":"Contact"}]',
  );
  assert.equal(
    prepared.bodySha256,
    "deeed9975fdc1542b7f4a2cb548867ddf99471226969e98c7f0219ef9f3e8971",
  );
  assert.equal(
    prepared.requestSha256,
    "6cb2a9f83098a0cdcf43e40723bba7de350a706d3e4cbbe9600a4666965e40bb",
  );
  assert.equal(JSON.stringify(prepared).includes("Authorization"), false);
  assert.equal(JSON.stringify(prepared).includes(SECRET_ACCESS), false);

  await prepared.dispatch();
  assert.equal(callCount, 1);
  assert.equal(sentBody, prepared.bodyJson);
  await assert.rejects(prepared.dispatch(), (error) => {
    assert.ok(error instanceof CanonicalAmoCrmMutationError);
    assert.equal(error.code, "invalid_request");
    assert.equal(error.outcome, "rejected");
    return true;
  });
  assert.equal(callCount, 1);
});

test("canonical amoCRM never refreshes or replays a mutation after a 401 response", async () => {
  const { tokenFilePath } = await makePrivateTokenFile();
  const calls = [];
  const provider = createCanonicalAmoCrmWriteProvider(readyConfig(tokenFilePath), {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ title: "Unauthorized" }, { status: 401 });
    },
  });

  await assert.rejects(
    provider.updateLeadResponsibleUser({
      requestId: "command-responsible-1",
      leadId: "918273",
      responsibleUserId: "192837",
    }),
    (error) => {
      assert.ok(error instanceof CanonicalAmoCrmMutationError);
      assert.equal(error.code, "authentication_failed");
      assert.equal(error.outcome, "rejected");
      assert.equal(error.request.path, "/api/v4/leads/918273");
      assert.equal(error.response?.status, 401);
      assert.equal(error.message.includes(SECRET_ACCESS), false);
      return true;
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls.some(({ url }) => String(url).endsWith("/oauth2/access_token")), false);
});

test("canonical amoCRM emits the reviewed contact, lead, link, note, stage, responsible-user and tag mutations", async () => {
  const { tokenFilePath } = await makePrivateTokenFile();
  const calls = [];
  const responses = [
    { _embedded: { contacts: [{ id: 101, request_id: "c-create" }] } },
    { _embedded: { leads: [{ id: 202, request_id: "l-create" }] } },
    { _embedded: { contacts: [{ id: 101 }] } },
    { _embedded: { leads: [{ id: 202 }] } },
    { _embedded: { leads: [{ id: 202 }] } },
    { _embedded: { leads: [{ id: 202 }] } },
    { _embedded: { links: [{ to_entity_id: 101, to_entity_type: "contacts" }] } },
    {
      _embedded: {
        notes: [{ id: 303, entity_id: 202, request_id: "l-note" }],
      },
    },
    { _embedded: { leads: [{ id: 202 }] } },
  ];
  const provider = createCanonicalAmoCrmWriteProvider(readyConfig(tokenFilePath), {
    ...virtualClock(),
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
      return jsonResponse(responses[calls.length - 1]);
    },
  });

  await provider.createContact({ requestId: "c-create", name: "Contact" });
  await provider.createLead({
    requestId: "l-create",
    name: "Lead",
    pipelineId: "11",
    statusId: "12",
    responsibleUserId: "13",
    price: 5000,
  });
  await provider.updateContact({
    requestId: "c-update",
    contactId: "101",
    firstName: "Updated",
  });
  await provider.updateLead({
    requestId: "l-update",
    leadId: "202",
    name: "Updated lead",
  });
  await provider.updateLeadPipelineStatus({
    requestId: "l-stage",
    leadId: "202",
    pipelineId: "21",
    statusId: "22",
  });
  await provider.updateLeadResponsibleUser({
    requestId: "l-owner",
    leadId: "202",
    responsibleUserId: "23",
  });
  await provider.linkContactToLead({
    requestId: "l-link",
    leadId: "202",
    contactId: "101",
  });
  assert.equal(
    (await provider.createLeadNote({
      requestId: "l-note",
      leadId: "202",
      text: "Human-reviewed note",
    })).entityId,
    "303",
  );
  await provider.updateLeadTags({
    requestId: "l-tags",
    leadId: "202",
    add: [{ id: "31" }, { name: "EVO V2 Sales" }],
    remove: [{ id: "32" }],
  });

  assert.deepEqual(
    calls.map(({ url, method }) => ({ url, method })),
    [
      { url: "https://evoadmissions.amocrm.ru/api/v4/contacts", method: "POST" },
      { url: "https://evoadmissions.amocrm.ru/api/v4/leads", method: "POST" },
      { url: "https://evoadmissions.amocrm.ru/api/v4/contacts/101", method: "PATCH" },
      { url: "https://evoadmissions.amocrm.ru/api/v4/leads/202", method: "PATCH" },
      { url: "https://evoadmissions.amocrm.ru/api/v4/leads/202", method: "PATCH" },
      { url: "https://evoadmissions.amocrm.ru/api/v4/leads/202", method: "PATCH" },
      { url: "https://evoadmissions.amocrm.ru/api/v4/leads/202/link", method: "POST" },
      { url: "https://evoadmissions.amocrm.ru/api/v4/leads/notes", method: "POST" },
      { url: "https://evoadmissions.amocrm.ru/api/v4/leads/202", method: "PATCH" },
    ],
  );
  assert.deepEqual(calls[1].body, [
    {
      request_id: "l-create",
      name: "Lead",
      pipeline_id: 11,
      status_id: 12,
      responsible_user_id: 13,
      price: 5000,
    },
  ]);
  assert.deepEqual(calls[4].body, {
    request_id: "l-stage",
    pipeline_id: 21,
    status_id: 22,
  });
  assert.deepEqual(calls[6].body, [
    {
      to_entity_id: 101,
      to_entity_type: "contacts",
      metadata: { is_main: true },
    },
  ]);
  assert.deepEqual(calls[7].body, [
    {
      entity_id: 202,
      note_type: "common",
      params: { text: "Human-reviewed note" },
      request_id: "l-note",
      is_need_to_trigger_digital_pipeline: false,
    },
  ]);
  assert.deepEqual(calls[8].body, {
    request_id: "l-tags",
    tags_to_add: [{ id: 31 }, { name: "EVO V2 Sales" }],
    tags_to_delete: [{ id: 32 }],
  });
});

test("canonical amoCRM reads back only exact provider IDs and uses GET-safe token refresh", async () => {
  const { tokenFilePath } = await makePrivateTokenFile();
  const calls = [];
  const provider = createCanonicalAmoCrmWriteProvider(readyConfig(tokenFilePath), {
    ...virtualClock(),
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      const path = new URL(url).pathname;
      if (path === "/api/v4/contacts/101") return jsonResponse({ id: 101 });
      if (path === "/api/v4/leads/202") return jsonResponse({ id: 202 });
      if (path === "/api/v4/leads/201") return jsonResponse({ id: 202 });
      if (path === "/api/v4/leads/202/links") {
        return jsonResponse({ _embedded: { links: [] } });
      }
      if (path === "/api/v4/leads/204/links") {
        return jsonResponse({
          _embedded: {
            links: [{ to_entity_id: 0, to_entity_type: "contacts" }],
          },
        });
      }
      if (path === "/api/v4/leads/notes/303") {
        return jsonResponse({ id: 303, entity_id: 202 });
      }
      if (path === "/api/v4/leads/notes/304") {
        return jsonResponse({ id: 304, entity_id: 999 });
      }
      throw new Error("unexpected readback path");
    },
  });

  assert.deepEqual(await provider.getContactById("101"), { id: 101 });
  assert.deepEqual(await provider.getLeadById("202"), { id: 202 });
  assert.deepEqual(await provider.getLeadLinks("202"), { _embedded: { links: [] } });
  assert.deepEqual(await provider.getLeadNoteById("202", "303"), {
    id: 303,
    entity_id: 202,
  });
  assert.equal(calls.every(({ method }) => method === "GET"), true);
  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      "https://evoadmissions.amocrm.ru/api/v4/contacts/101?with=leads",
      "https://evoadmissions.amocrm.ru/api/v4/leads/202?with=contacts",
      "https://evoadmissions.amocrm.ru/api/v4/leads/202/links",
      "https://evoadmissions.amocrm.ru/api/v4/leads/notes/303",
    ],
  );

  await assert.rejects(provider.getLeadById("201"), (error) => {
    assert.ok(error instanceof CanonicalAmoCrmProviderError);
    assert.equal(error.code, "invalid_response");
    return true;
  });
  await assert.rejects(provider.getLeadLinks("204"), (error) => {
    assert.ok(error instanceof CanonicalAmoCrmProviderError);
    assert.equal(error.code, "invalid_response");
    return true;
  });
  await assert.rejects(provider.getLeadNoteById("202", "304"), (error) => {
    assert.ok(error instanceof CanonicalAmoCrmProviderError);
    assert.equal(error.code, "invalid_response");
    return true;
  });
});

test("canonical amoCRM rejects unsafe IDs and payloads before any dispatch", async () => {
  const { tokenFilePath } = await makePrivateTokenFile();
  let callCount = 0;
  const provider = createCanonicalAmoCrmWriteProvider(readyConfig(tokenFilePath), {
    fetch: async () => {
      callCount += 1;
      return jsonResponse({});
    },
  });
  const invalidCommands = [
    () => provider.updateLead({ requestId: "ok", leadId: "0", name: "Lead" }),
    () => provider.updateLead({ requestId: "ok", leadId: "2147483648", name: "Lead" }),
    () => provider.updateLead({ requestId: "not safe", leadId: "1", name: "Lead" }),
    () => provider.updateContact({ requestId: "ok", contactId: "1" }),
    () => provider.createLeadNote({ requestId: "ok", leadId: "1", text: "" }),
    () => provider.updateLeadTags({ requestId: "ok", leadId: "1" }),
    () =>
      provider.prepareUpdateLeadTags({
        requestId: "ok",
        leadId: "1",
        add: [{ name: " must-not-trim " }],
      }),
    () =>
      provider.updateLeadTags({
        requestId: "ok",
        leadId: "1",
        add: [{ id: "2", name: "ambiguous" }],
      }),
    () =>
      provider.createContact({
        requestId: "ok",
        name: "Contact",
        customFieldsValues: Array.from({ length: 41 }, (_, index) => ({
          fieldId: String(index + 1),
          values: [{ value: "x" }],
        })),
      }),
    () =>
      provider.createLeadNote({
        requestId: "ok",
        leadId: "1",
        text: "x".repeat(10_001),
      }),
  ];
  for (const execute of invalidCommands) {
    assert.throws(execute, (error) => {
      assert.ok(error instanceof CanonicalAmoCrmProviderError);
      assert.equal(error.code, "invalid_request");
      return true;
    });
  }
  assert.equal(callCount, 0);
});

test("canonical amoCRM marks ambiguous mutation transport and provider failures unknown without retry", async () => {
  const { tokenFilePath } = await makePrivateTokenFile();
  for (const scenario of [
    {
      responseStatus: null,
      fetch: async () => {
        throw Object.assign(new Error(`socket failed ${SECRET_ACCESS}`), {
          name: "TypeError",
        });
      },
    },
    {
      responseStatus: 503,
      fetch: async () => jsonResponse({ title: "Unavailable" }, { status: 503 }),
    },
    {
      responseStatus: 200,
      fetch: async () => jsonResponse({ unexpected: true }),
    },
  ]) {
    let callCount = 0;
    const provider = createCanonicalAmoCrmWriteProvider(readyConfig(tokenFilePath), {
      ...virtualClock(),
      fetch: async (...args) => {
        callCount += 1;
        return scenario.fetch(...args);
      },
    });
    await assert.rejects(
      provider.createLead({
        requestId: "unknown-once",
        name: "Unknown result lead",
        pipelineId: "11",
        statusId: "12",
        responsibleUserId: "13",
      }),
      (error) => {
        assert.ok(error instanceof CanonicalAmoCrmMutationError);
        assert.equal(error.outcome, "unknown");
        assert.equal(error.request.path, "/api/v4/leads");
        assert.equal(error.response?.status ?? null, scenario.responseStatus);
        assert.equal(error.message.includes(SECRET_ACCESS), false);
        assert.equal(JSON.stringify(error).includes(SECRET_ACCESS), false);
        return true;
      },
    );
    assert.equal(callCount, 1);
  }
});
