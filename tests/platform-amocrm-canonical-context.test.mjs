import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  buildPlatformAmoCrmCanonicalContext,
  normalizePersistedPlatformAmoCrmCanonicalContext,
  parsePlatformAmoCrmCanonicalProviderId,
  PLATFORM_AMOCRM_CANONICAL_CONTEXT_REFRESH_TTL_MS,
  PLATFORM_AMOCRM_CANONICAL_CONTEXT_STALE_TTL_MS,
} from "../src/lib/platform-amocrm-canonical-context.ts";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export default {};",
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  getPlatformAmoCrmReadBackendConfig,
  getPlatformAmoCrmReadConfig,
  PlatformAmoCrmReadConfigurationError,
} = await import("../src/lib/server/platform-amocrm-read-config.ts");
const {
  buildUnavailableCanonicalContextFromError,
  createPlatformAmoCrmCanonicalContextRequestPacer,
  PlatformAmoCrmCanonicalContextClientError,
  readPlatformAmoCrmCanonicalContext,
} = await import("../src/lib/server/platform-amocrm-canonical-context-client.ts");
const {
  PLATFORM_AMOCRM_CANONICAL_CONTEXT_RECORD_RPC,
  PLATFORM_AMOCRM_CANONICAL_CONTEXT_STAFF_RPC,
  readPlatformAmoCrmCanonicalContextCurrent,
  recordPlatformAmoCrmCanonicalObservation,
} = await import("../src/lib/server/platform-amocrm-canonical-context-repository.ts");
const { getPlatformAmoCrmCanonicalContext } = await import(
  "../src/lib/server/platform-amocrm-canonical-context-service.ts"
);

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "100001";
const CONTACT_ID = "200002";
const LEAD_ID = "300003";
const PIPELINE_ID = "400004";
const STATUS_ID = "500005";
const USER_ID = "600006";

function actor(overrides = {}) {
  return {
    authUserId: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    profileId: "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    membershipId: "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    organizationId: ORGANIZATION_ID,
    displayName: "Operator",
    platformRole: "sales",
    platformAccessVersion: 7,
    role: "sales",
    ...overrides,
  };
}

function conversation(overrides = {}) {
  return {
    id: CONVERSATION_ID,
    organizationId: ORGANIZATION_ID,
    amocrmAccountId: ACCOUNT_ID,
    amocrmContactId: CONTACT_ID,
    amocrmLeadId: LEAD_ID,
    ...overrides,
  };
}

function okJson(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function providerResponses() {
  return new Map([
    ["/api/v4/account", { id: Number(ACCOUNT_ID), subdomain: "evoadmissions", name: "Account" }],
    [
      `/api/v4/contacts/${CONTACT_ID}?with=leads`,
      { id: Number(CONTACT_ID), name: "Student Contact", _embedded: { leads: [{ id: Number(LEAD_ID) }] } },
    ],
    [
      `/api/v4/leads/${LEAD_ID}?with=contacts`,
      {
        id: Number(LEAD_ID),
        name: "Lead Name",
        pipeline_id: Number(PIPELINE_ID),
        status_id: Number(STATUS_ID),
        responsible_user_id: Number(USER_ID),
        _embedded: { contacts: [{ id: Number(CONTACT_ID) }] },
      },
    ],
    [
      `/api/v4/leads/pipelines/${PIPELINE_ID}`,
      {
        id: Number(PIPELINE_ID),
        name: "Admissions",
        _embedded: { statuses: [{ id: Number(STATUS_ID), name: "Contract signed" }] },
      },
    ],
    [
      `/api/v4/users/${USER_ID}`,
      {
        id: Number(USER_ID),
        name: "Sales Manager",
        rights: { is_active: true },
      },
    ],
  ]);
}

test("config is disabled by default and enabled config validates the full backend boundary", () => {
  assert.deepEqual(getPlatformAmoCrmReadConfig({}), { enabled: false });

  const config = getPlatformAmoCrmReadConfig({
    EVO_PLATFORM_AMOCRM_READ_ENABLED: "1",
    EVO_PLATFORM_AMOCRM_ACCOUNT_DOMAIN: "evoadmissions.amocrm.ru",
    EVO_PLATFORM_AMOCRM_READ_TOKEN: "synthetic-read-token-123456",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.accountOrigin, "https://evoadmissions.amocrm.ru");
  assert.equal(getPlatformAmoCrmReadBackendConfig({
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
  }).organizationId, ORGANIZATION_ID.toLowerCase());
});

test("config rejects unsafe amoCRM domains, unsafe tokens and missing backend config", () => {
  assert.throws(
    () => getPlatformAmoCrmReadConfig({ EVO_PLATFORM_AMOCRM_READ_ENABLED: "wat" }),
    PlatformAmoCrmReadConfigurationError,
  );
  assert.throws(
    () => getPlatformAmoCrmReadConfig({
      EVO_PLATFORM_AMOCRM_READ_ENABLED: "1",
      EVO_PLATFORM_AMOCRM_ACCOUNT_DOMAIN: "https://evil.example",
      EVO_PLATFORM_AMOCRM_READ_TOKEN: "synthetic-read-token-123456",
      EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
    }),
    /configured/,
  );
  assert.throws(
    () => getPlatformAmoCrmReadConfig({
      EVO_PLATFORM_AMOCRM_READ_ENABLED: "1",
      EVO_PLATFORM_AMOCRM_ACCOUNT_DOMAIN: "evoadmissions.amocrm.ru",
      EVO_PLATFORM_AMOCRM_READ_TOKEN: " token-with-spaces ",
      EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
    }),
    PlatformAmoCrmReadConfigurationError,
  );
});

test("provider ID parser is strict and persisted public context fails closed on hidden IDs and invalid state combinations", () => {
  assert.equal(parsePlatformAmoCrmCanonicalProviderId("42"), "42");
  assert.equal(parsePlatformAmoCrmCanonicalProviderId("00042"), "42");
  assert.equal(parsePlatformAmoCrmCanonicalProviderId("0"), null);
  assert.equal(parsePlatformAmoCrmCanonicalProviderId("-1"), null);

  const current = normalizePersistedPlatformAmoCrmCanonicalContext({
    state: "degraded",
    reason_code: "responsible_user_forbidden",
    contact_name: "Contact",
    lead_name: "Lead",
    responsible_user_name: null,
    responsible_user_active: null,
    responsible_user_resolution: "permission_denied",
    pipeline_name: "Pipeline",
    status_name: "Stage",
    provider_observed_at: "2026-08-10T12:00:01.000Z",
    last_attempt_at: "2026-08-10T12:00:00.000Z",
    adapter_contract_version: 1,
    version: 3,
  });
  assert.equal(current.state, "degraded");
  assert.equal(current.responsible_user_name, null);

  assert.throws(
    () => buildPlatformAmoCrmCanonicalContext({
      state: "available",
      contact_name: "Contact",
      lead_name: "Lead",
      responsible_user_name: "User",
      responsible_user_active: null,
      responsible_user_resolution: "resolved",
      pipeline_name: "Pipeline",
      status_name: "Stage",
      provider_observed_at: "2026-08-10T12:00:01.000Z",
      last_attempt_at: "2026-08-10T12:00:00.000Z",
    }),
    /invalid/,
  );
  assert.throws(
    () => buildPlatformAmoCrmCanonicalContext({
      state: "available",
      contact_name: "Contact\nInjected",
      lead_name: "Lead",
      responsible_user_name: "User",
      responsible_user_active: true,
      responsible_user_resolution: "resolved",
      pipeline_name: "Pipeline",
      status_name: "Stage",
      provider_observed_at: "2026-08-10T12:00:01.000Z",
      last_attempt_at: "2026-08-10T12:00:00.000Z",
    }),
    /invalid/,
  );

  assert.throws(
    () => normalizePersistedPlatformAmoCrmCanonicalContext({
      state: "available",
      reason_code: null,
      contact_name: "x",
      lead_name: "y",
      responsible_user_name: "r",
      responsible_user_active: true,
      responsible_user_resolution: "resolved",
      pipeline_name: "z",
      status_name: "s",
      provider_observed_at: "2026-08-10T12:00:01.000Z",
      last_attempt_at: null,
      adapter_contract_version: 1,
      version: 1,
    }),
  );
});

test("client uses bounded manual GET requests with no-store and validates provider relationships", async () => {
  const responses = providerResponses();
  const requests = [];
  const context = await readPlatformAmoCrmCanonicalContext(
    {
      accountDomain: "evoadmissions.amocrm.ru",
      accessToken: "synthetic-read-token-123456",
      amocrmAccountId: ACCOUNT_ID,
      amocrmContactId: CONTACT_ID,
      amocrmLeadId: LEAD_ID,
    },
    {
      requestPacer: async () => {},
      fetchImplementation: async (input, init) => {
        const url = new URL(String(input));
        requests.push({ url, init });
        return okJson(responses.get(`${url.pathname}${url.search}`));
      },
    },
  );

  assert.equal(requests.length, 5);
  assert.deepEqual(
    requests.map(({ url, init }) => [url.pathname + url.search, init.method, init.redirect, init.cache, init.credentials]),
    [
      ["/api/v4/account", "GET", "manual", "no-store", "omit"],
      [`/api/v4/contacts/${CONTACT_ID}?with=leads`, "GET", "manual", "no-store", "omit"],
      [`/api/v4/leads/${LEAD_ID}?with=contacts`, "GET", "manual", "no-store", "omit"],
      [`/api/v4/leads/pipelines/${PIPELINE_ID}`, "GET", "manual", "no-store", "omit"],
      [`/api/v4/users/${USER_ID}`, "GET", "manual", "no-store", "omit"],
    ],
  );
  assert.equal(context.state, "available");
  assert.deepEqual(context.observedCapabilities, [
    "account.read",
    "contact.read",
    "lead.read",
    "pipeline.read",
    "user.read",
  ]);
  assert.deepEqual(context.context, {
    state: "available",
    reason_code: null,
    contact_name: "Student Contact",
    lead_name: "Lead Name",
    responsible_user_name: "Sales Manager",
    responsible_user_active: true,
    responsible_user_resolution: "resolved",
    pipeline_name: "Admissions",
    status_name: "Contract signed",
    provider_observed_at: context.context.provider_observed_at,
    last_attempt_at: context.context.last_attempt_at,
    adapter_contract_version: 1,
    version: 1,
  });
});

test("client degrades only the admin-only user lookup on 403 and maps other errors without leaking the token", async () => {
  const responses = providerResponses();
  const degraded = await readPlatformAmoCrmCanonicalContext(
    {
      accountDomain: "evoadmissions.amocrm.ru",
      accessToken: "synthetic-read-token-123456",
      amocrmAccountId: ACCOUNT_ID,
      amocrmContactId: CONTACT_ID,
      amocrmLeadId: LEAD_ID,
    },
    {
      requestPacer: async () => {},
      fetchImplementation: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === `/api/v4/users/${USER_ID}`) {
          return new Response(JSON.stringify({ detail: "forbidden" }), { status: 403 });
        }
        return okJson(responses.get(`${url.pathname}${url.search}`));
      },
    },
  );
  assert.equal(degraded.state, "degraded");
  assert.equal(degraded.reasonCode, "responsible_user_forbidden");
  assert.equal(degraded.context.responsible_user_name, null);

  await assert.rejects(
    () => readPlatformAmoCrmCanonicalContext(
      {
        accountDomain: "evoadmissions.amocrm.ru",
        accessToken: "synthetic-read-token-123456",
        amocrmAccountId: ACCOUNT_ID,
        amocrmContactId: CONTACT_ID,
        amocrmLeadId: LEAD_ID,
      },
      {
        requestPacer: async () => {},
        fetchImplementation: async () => new Response(JSON.stringify({ rate: "limit" }), {
          status: 429,
          headers: { "retry-after": "17" },
        }),
      },
    ),
    (error) => {
      assert.equal(error instanceof PlatformAmoCrmCanonicalContextClientError, true);
      assert.equal(error.code, "provider_rate_limited");
      assert.equal(error.retryAfterSeconds, 17);
      assert.doesNotMatch(error.message, /synthetic-read-token/);
      return true;
    },
  );

  const notFound = buildUnavailableCanonicalContextFromError(
    new PlatformAmoCrmCanonicalContextClientError("provider_not_found"),
    "2026-08-10T12:05:00.000Z",
  );
  assert.equal(notFound.reason_code, "provider_not_found");
});

test("client rejects cross-link mismatches, redirects and oversized responses", async () => {
  const responses = providerResponses();
  responses.set(`/api/v4/leads/${LEAD_ID}?with=contacts`, {
    id: Number(LEAD_ID),
    name: "Lead Name",
    pipeline_id: Number(PIPELINE_ID),
    status_id: Number(STATUS_ID),
    responsible_user_id: Number(USER_ID),
    _embedded: { contacts: [{ id: 999999 }] },
  });
  await assert.rejects(
    () => readPlatformAmoCrmCanonicalContext(
      {
        accountDomain: "evoadmissions.amocrm.ru",
        accessToken: "synthetic-read-token-123456",
        amocrmAccountId: ACCOUNT_ID,
        amocrmContactId: CONTACT_ID,
        amocrmLeadId: LEAD_ID,
      },
      {
        requestPacer: async () => {},
        fetchImplementation: async (input) => {
          const url = new URL(String(input));
          return okJson(responses.get(`${url.pathname}${url.search}`));
        },
      },
    ),
    (error) => {
      assert.equal(error.code, "provider_relationship_mismatch");
      return true;
    },
  );

  await assert.rejects(
    () => readPlatformAmoCrmCanonicalContext(
      {
        accountDomain: "evoadmissions.amocrm.ru",
        accessToken: "synthetic-read-token-123456",
        amocrmAccountId: ACCOUNT_ID,
        amocrmContactId: CONTACT_ID,
        amocrmLeadId: LEAD_ID,
      },
      {
        requestPacer: async () => {},
        fetchImplementation: async () => new Response("", {
          status: 302,
          headers: { location: "https://evil.example/" },
        }),
      },
    ),
    /unavailable/,
  );

  await assert.rejects(
    () => readPlatformAmoCrmCanonicalContext(
      {
        accountDomain: "evoadmissions.amocrm.ru",
        accessToken: "synthetic-read-token-123456",
        amocrmAccountId: ACCOUNT_ID,
        amocrmContactId: CONTACT_ID,
        amocrmLeadId: LEAD_ID,
      },
      {
        maxResponseBytes: 32,
        requestPacer: async () => {},
        fetchImplementation: async () => okJson({ huge: "x".repeat(500) }),
      },
    ),
    (error) => error.code === "provider_response_too_large",
  );
});

test("request pacer spaces starts by about 200ms", async () => {
  const originalNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const waits = [];
  let now = 1000;
  Date.now = () => now;
  globalThis.setTimeout = ((callback, delay) => {
    waits.push(delay);
    now += delay;
    callback();
    return 1;
  });

  try {
    const pace = createPlatformAmoCrmCanonicalContextRequestPacer();
    await pace();
    await pace();
    await pace();
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(waits, [200, 200]);
});

test("repository uses the exact inferred RPC names and validates safe JSON only", async () => {
  const calls = [];
  const client = {
    schema(name) {
      assert.equal(name, "platform");
      return {
        rpc(functionName, args, options) {
          calls.push({ functionName, args, options });
          if (functionName === PLATFORM_AMOCRM_CANONICAL_CONTEXT_STAFF_RPC) {
          return Promise.resolve({
              data: [{
                ...buildPlatformAmoCrmCanonicalContext({
                  state: "available",
                  contact_name: "Contact",
                  lead_name: "Lead",
                  responsible_user_name: "User",
                  responsible_user_active: true,
                  responsible_user_resolution: "resolved",
                  pipeline_name: "Pipeline",
                  status_name: "Stage",
                  last_attempt_at: "2026-08-10T12:00:00.000Z",
                  provider_observed_at: "2026-08-10T12:00:01.000Z",
                }),
              }],
              error: null,
            });
          }
          return Promise.resolve({
            data: {
              ...buildPlatformAmoCrmCanonicalContext({
                state: "unavailable",
                  reason_code: "provider_timeout",
                  last_attempt_at: "2026-08-10T12:05:00.000Z",
                }),
              },
            error: null,
          });
        },
      };
    },
  };

  const current = await readPlatformAmoCrmCanonicalContextCurrent(client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
  });
  assert.equal(current.current.state, "available");

  const receipt = await recordPlatformAmoCrmCanonicalObservation(client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    amocrmAccountId: ACCOUNT_ID,
    amocrmContactId: CONTACT_ID,
    amocrmLeadId: LEAD_ID,
    pipelineId: null,
    statusId: null,
    responsibleUserId: null,
    requestId: "44444444-4444-4444-8444-444444444444",
    outcome: "failed",
    reasonCode: "provider_timeout",
    attemptedAt: "2026-08-10T12:05:00.000Z",
    observedAt: null,
    observedCapabilities: [],
    current: buildUnavailableCanonicalContextFromError(
      new PlatformAmoCrmCanonicalContextClientError("request_timeout"),
      "2026-08-10T12:05:00.000Z",
    ),
  });
  assert.equal(receipt.current.state, "unavailable");
  assert.equal(calls[0].functionName, PLATFORM_AMOCRM_CANONICAL_CONTEXT_STAFF_RPC);
  assert.equal(calls[0].options.get, true);
  assert.equal(calls[1].functionName, PLATFORM_AMOCRM_CANONICAL_CONTEXT_RECORD_RPC);
  assert.equal(calls[1].args.p_state, "failed");
  assert.equal(Object.hasOwn(calls[1].args, "p_outcome"), false);
  assert.deepEqual(calls[1].args.p_observed_capabilities, []);
});

test("service fails closed on actor or organization mismatch, avoids provider calls when disabled or not linked, and serves fresh durable state", async () => {
  const fresh = buildPlatformAmoCrmCanonicalContext({
    state: "available",
    contact_name: "Contact",
    lead_name: "Lead",
    responsible_user_name: "User",
    responsible_user_active: true,
    responsible_user_resolution: "resolved",
    pipeline_name: "Pipeline",
    status_name: "Stage",
    last_attempt_at: "2026-08-10T12:00:00.000Z",
    provider_observed_at: "2026-08-10T12:00:01.000Z",
  });

  let providerReads = 0;
  const result = await getPlatformAmoCrmCanonicalContext(
    actor(),
    conversation(),
    {
      getConfig: () => ({
        enabled: true,
        organizationId: ORGANIZATION_ID,
        supabaseUrl: "https://example.supabase.co",
        supabaseSecretKey: "sb_secret_abcdefghijklmnopqrstuvwxyz",
        accountDomain: "evoadmissions.amocrm.ru",
        accountOrigin: "https://evoadmissions.amocrm.ru",
        accountSubdomain: "evoadmissions",
        accessToken: "synthetic-read-token-123456",
        timeoutMs: 1000,
        maxResponseBytes: 1024,
        requestIntervalMs: 200,
      }),
      createStaffClient: async () => ({}),
      readCurrent: async () => ({
        organizationId: ORGANIZATION_ID,
        conversationId: CONVERSATION_ID,
        current: fresh,
      }),
      readProvider: async () => {
        providerReads += 1;
        throw new Error("should not run");
      },
      now: () => Date.parse(fresh.provider_observed_at) + 10,
    },
  );
  assert.equal(result.state, "available");
  assert.equal(providerReads, 0);

  assert.equal(
    (await getPlatformAmoCrmCanonicalContext(actor(), conversation(), {
      getConfig: () => ({ enabled: false }),
    })).state,
    "disabled",
  );
  assert.equal(
    (await getPlatformAmoCrmCanonicalContext(actor(), conversation({ amocrmLeadId: null }), {
      getConfig: () => ({
        enabled: true,
        organizationId: ORGANIZATION_ID,
        supabaseUrl: "https://example.supabase.co",
        supabaseSecretKey: "sb_secret_abcdefghijklmnopqrstuvwxyz",
        accountDomain: "evoadmissions.amocrm.ru",
        accountOrigin: "https://evoadmissions.amocrm.ru",
        accountSubdomain: "evoadmissions",
        accessToken: "synthetic-read-token-123456",
        timeoutMs: 1000,
        maxResponseBytes: 1024,
        requestIntervalMs: 200,
      }),
    })).state,
    "not_linked",
  );

  await assert.rejects(
    () => getPlatformAmoCrmCanonicalContext(actor({ platformRole: "finance" }), conversation(), {
      getConfig: () => ({ enabled: false }),
    }),
  );
  await assert.rejects(
    () => getPlatformAmoCrmCanonicalContext(actor(), conversation({ organizationId: "33333333-3333-4333-8333-333333333333" }), {
      getConfig: () => ({ enabled: false }),
    }),
  );
});

test("service keeps the conversation page available when enabled configuration is missing or scoped to another organization", async () => {
  const missing = await getPlatformAmoCrmCanonicalContext(actor(), conversation(), {
    getConfig: () => {
      throw new PlatformAmoCrmReadConfigurationError("missing_read_token");
    },
  });
  assert.equal(missing.state, "disabled");
  assert.equal(missing.reason_code, "missing_configuration");

  const invalid = await getPlatformAmoCrmCanonicalContext(actor(), conversation(), {
    getConfig: () => {
      throw new PlatformAmoCrmReadConfigurationError("unsafe_read_token");
    },
  });
  assert.equal(invalid.state, "disabled");
  assert.equal(invalid.reason_code, "invalid_configuration");

  const wrongOrganization = await getPlatformAmoCrmCanonicalContext(
    actor(),
    conversation(),
    {
      getConfig: () => ({
        enabled: true,
        organizationId: "33333333-3333-4333-8333-333333333333",
        supabaseUrl: "https://example.supabase.co",
        supabaseSecretKey: "sb_secret_abcdefghijklmnopqrstuvwxyz",
        accountDomain: "evoadmissions.amocrm.ru",
        accountOrigin: "https://evoadmissions.amocrm.ru",
        accountSubdomain: "evoadmissions",
        accessToken: "synthetic-read-token-123456",
        timeoutMs: 1000,
        maxResponseBytes: 1024,
        requestIntervalMs: 200,
      }),
    },
  );
  assert.equal(wrongOrganization.state, "disabled");
  assert.equal(wrongOrganization.reason_code, "configuration_scope_mismatch");
});

test("service refreshes stale data once, records failures, and falls back to stale only inside the bounded lifetime", async () => {
  const staleBase = buildPlatformAmoCrmCanonicalContext({
    state: "available",
    contact_name: "Contact",
    lead_name: "Lead",
    responsible_user_name: "User",
    responsible_user_active: true,
    responsible_user_resolution: "resolved",
    pipeline_name: "Pipeline",
    status_name: "Stage",
    last_attempt_at: "2026-08-10T12:00:00.000Z",
    provider_observed_at: "2026-08-10T12:00:01.000Z",
  });

  const config = {
    enabled: true,
    organizationId: ORGANIZATION_ID,
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "sb_secret_abcdefghijklmnopqrstuvwxyz",
    accountDomain: "evoadmissions.amocrm.ru",
    accountOrigin: "https://evoadmissions.amocrm.ru",
    accountSubdomain: "evoadmissions",
    accessToken: "synthetic-read-token-123456",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    requestIntervalMs: 200,
  };

  let providerReads = 0;
  const records = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const deps = {
    getConfig: () => config,
    createStaffClient: async () => ({}),
    createServiceClient: () => ({}),
    readCurrent: async () => ({
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      current: staleBase,
    }),
    recordObservation: async (_client, input) => {
      records.push(input);
      return {
        organizationId: ORGANIZATION_ID,
        conversationId: CONVERSATION_ID,
        outcome: input.outcome,
        reasonCode: input.reasonCode,
        attemptedAt: input.attemptedAt,
        observedAt: input.observedAt,
        current: input.current,
      };
    },
    readProvider: async () => {
      providerReads += 1;
      await gate;
      return {
        state: "available",
        reasonCode: null,
        attemptedAt: "2026-08-10T12:16:00.000Z",
        observedAt: "2026-08-10T12:16:01.000Z",
        responsibleUserResolution: "resolved",
        relationshipIds: {
          amocrmAccountId: ACCOUNT_ID,
          amocrmContactId: CONTACT_ID,
          amocrmLeadId: LEAD_ID,
          pipelineId: PIPELINE_ID,
          statusId: STATUS_ID,
          responsibleUserId: USER_ID,
        },
        responsibleUserActive: true,
        context: buildPlatformAmoCrmCanonicalContext({
          state: "available",
          contact_name: staleBase.contact_name,
          lead_name: staleBase.lead_name,
          responsible_user_name: staleBase.responsible_user_name,
          responsible_user_active: staleBase.responsible_user_active,
          responsible_user_resolution: staleBase.responsible_user_resolution,
          pipeline_name: staleBase.pipeline_name,
          status_name: staleBase.status_name,
          last_attempt_at: "2026-08-10T12:16:00.000Z",
          provider_observed_at: "2026-08-10T12:16:01.000Z",
        }),
      };
    },
    now: () =>
      Date.parse(staleBase.provider_observed_at)
      + PLATFORM_AMOCRM_CANONICAL_CONTEXT_REFRESH_TTL_MS
      + 1,
  };

  const first = getPlatformAmoCrmCanonicalContext(actor(), conversation(), deps);
  const second = getPlatformAmoCrmCanonicalContext(actor(), conversation(), deps);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(providerReads, 1);
  assert.equal(firstResult.state, "available");
  assert.equal(secondResult.state, "available");
  assert.equal(records.length, 1);
  assert.equal(records[0].outcome, "available");

  const staleFailure = await getPlatformAmoCrmCanonicalContext(actor(), conversation(), {
    ...deps,
    readProvider: async () => {
      throw new PlatformAmoCrmCanonicalContextClientError("request_timeout");
    },
  });
  assert.equal(staleFailure.state, "stale");
  assert.equal(staleFailure.contact_name, "Contact");

  const unavailable = await getPlatformAmoCrmCanonicalContext(actor(), conversation(), {
    ...deps,
    now: () =>
      Date.parse(staleBase.provider_observed_at)
      + PLATFORM_AMOCRM_CANONICAL_CONTEXT_STALE_TTL_MS
      + 1,
    readProvider: async () => {
      throw new PlatformAmoCrmCanonicalContextClientError("request_timeout");
    },
  });
  assert.equal(unavailable.state, "unavailable");
});

test("service isolates concurrent refreshes when a conversation amoCRM binding changes", async () => {
  const config = {
    enabled: true,
    organizationId: ORGANIZATION_ID,
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "sb_secret_abcdefghijklmnopqrstuvwxyz",
    accountDomain: "evoadmissions.amocrm.ru",
    accountOrigin: "https://evoadmissions.amocrm.ru",
    accountSubdomain: "evoadmissions",
    accessToken: "synthetic-read-token-123456",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    requestIntervalMs: 200,
  };
  const rotatedContactId = "200099";
  const rotatedLeadId = "300099";
  let providerReads = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const dependencies = {
    getConfig: () => config,
    createStaffClient: async () => ({}),
    createServiceClient: () => ({}),
    readCurrent: async () => null,
    recordObservation: async () => ({}),
    readProvider: async (input) => {
      providerReads += 1;
      await gate;
      return {
        state: "available",
        reasonCode: null,
        attemptedAt: "2026-08-10T12:16:00.000Z",
        observedAt: "2026-08-10T12:16:01.000Z",
        responsibleUserResolution: "not_assigned",
        relationshipIds: {
          amocrmAccountId: input.amocrmAccountId,
          amocrmContactId: input.amocrmContactId,
          amocrmLeadId: input.amocrmLeadId,
          pipelineId: PIPELINE_ID,
          statusId: STATUS_ID,
          responsibleUserId: null,
        },
        responsibleUserActive: null,
        observedCapabilities: [
          "account.read",
          "contact.read",
          "lead.read",
          "pipeline.read",
        ],
        context: buildPlatformAmoCrmCanonicalContext({
          state: "available",
          contact_name: `Contact ${input.amocrmContactId}`,
          lead_name: `Lead ${input.amocrmLeadId}`,
          responsible_user_resolution: "not_assigned",
          pipeline_name: "Pipeline",
          status_name: "Stage",
          last_attempt_at: "2026-08-10T12:16:00.000Z",
          provider_observed_at: "2026-08-10T12:16:01.000Z",
        }),
      };
    },
  };

  const original = getPlatformAmoCrmCanonicalContext(
    actor(),
    conversation(),
    dependencies,
  );
  const rotated = getPlatformAmoCrmCanonicalContext(
    actor(),
    conversation({
      amocrmContactId: rotatedContactId,
      amocrmLeadId: rotatedLeadId,
    }),
    dependencies,
  );
  release();
  const [originalResult, rotatedResult] = await Promise.all([original, rotated]);

  assert.equal(providerReads, 2);
  assert.equal(originalResult.contact_name, `Contact ${CONTACT_ID}`);
  assert.equal(rotatedResult.contact_name, `Contact ${rotatedContactId}`);
  assert.equal(originalResult.lead_name, `Lead ${LEAD_ID}`);
  assert.equal(rotatedResult.lead_name, `Lead ${rotatedLeadId}`);
});

test("service propagates observation-storage failures without misclassifying them as provider failures", async () => {
  const config = {
    enabled: true,
    organizationId: ORGANIZATION_ID,
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "sb_secret_abcdefghijklmnopqrstuvwxyz",
    accountDomain: "evoadmissions.amocrm.ru",
    accountOrigin: "https://evoadmissions.amocrm.ru",
    accountSubdomain: "evoadmissions",
    accessToken: "synthetic-read-token-123456",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    requestIntervalMs: 200,
  };
  const current = buildPlatformAmoCrmCanonicalContext({
    state: "available",
    contact_name: "Contact",
    lead_name: "Lead",
    responsible_user_name: "User",
    responsible_user_active: true,
    responsible_user_resolution: "resolved",
    pipeline_name: "Pipeline",
    status_name: "Stage",
    last_attempt_at: "2026-08-10T12:16:00.000Z",
    provider_observed_at: "2026-08-10T12:16:01.000Z",
  });
  let providerReads = 0;
  let recordAttempts = 0;
  const dependencies = {
    getConfig: () => config,
    createStaffClient: async () => ({}),
    createServiceClient: () => ({}),
    readCurrent: async () => null,
    now: () => Date.parse("2026-08-10T12:16:02.000Z"),
    readProvider: async () => {
      providerReads += 1;
      return {
        state: "available",
        reasonCode: null,
        attemptedAt: "2026-08-10T12:16:00.000Z",
        observedAt: "2026-08-10T12:16:01.000Z",
        responsibleUserResolution: "resolved",
        relationshipIds: {
          amocrmAccountId: ACCOUNT_ID,
          amocrmContactId: CONTACT_ID,
          amocrmLeadId: LEAD_ID,
          pipelineId: PIPELINE_ID,
          statusId: STATUS_ID,
          responsibleUserId: USER_ID,
        },
        responsibleUserActive: true,
        observedCapabilities: [
          "account.read",
          "contact.read",
          "lead.read",
          "pipeline.read",
          "user.read",
        ],
        context: current,
      };
    },
    recordObservation: async () => {
      recordAttempts += 1;
      throw new Error("durable observation write failed");
    },
  };

  await assert.rejects(
    () => getPlatformAmoCrmCanonicalContext(actor(), conversation(), dependencies),
    /durable observation write failed/,
  );
  await assert.rejects(
    () => getPlatformAmoCrmCanonicalContext(actor(), conversation(), dependencies),
    /durable observation write failed/,
  );
  assert.equal(providerReads, 2, "single-flight entry must be cleared after rejection");
  assert.equal(recordAttempts, 2, "each provider success must produce exactly one write attempt");
});

test("server files stay server-only and do not import legacy SQLite amoCRM adapters", async () => {
  const files = [
    "../src/lib/server/platform-amocrm-read-config.ts",
    "../src/lib/server/platform-amocrm-canonical-context-client.ts",
    "../src/lib/server/platform-amocrm-canonical-context-repository.ts",
    "../src/lib/server/platform-amocrm-canonical-context-service.ts",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /^import "server-only";/m);
    assert.doesNotMatch(source, /src\/lib\/amocrm\.ts|from\s+["'].*amocrm\.ts["']/);
  }
});

test("focused file passes a standalone node:test execution", () => {
  const result = spawnSync(process.execPath, [
    "--conditions=react-server",
    "--experimental-strip-types",
    "--test",
    "tests/platform-amocrm-canonical-context.test.mjs",
    "--test-name-pattern",
    "provider ID parser",
  ], {
    cwd: new URL("..", import.meta.url),
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
