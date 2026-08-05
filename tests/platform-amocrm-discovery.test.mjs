import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  PlatformAmoCrmDiscoveryContractError,
  buildPlatformAmoCrmMappingSnapshot,
  normalizePersistedPlatformAmoCrmMappingSnapshot,
  normalizePlatformAmoCrmAccountDomain,
  parsePlatformAmoCrmProviderId,
} from "../src/lib/platform-amocrm-discovery-contract.ts";
import {
  PLATFORM_AMOCRM_DISCOVERY_REQUEST_INTERVAL_MS,
  PlatformAmoCrmDiscoveryClientError,
  createPlatformAmoCrmDiscoveryRequestPacer,
  discoverPlatformAmoCrmMappingSnapshot,
} from "../src/lib/server/platform-amocrm-discovery-client.ts";
import {
  PlatformAmoCrmMappingRepositoryError,
  approvePlatformAmoCrmMappingSelection,
  normalizePlatformAmoCrmMappingApprovalEvent,
  normalizePlatformAmoCrmMappingApprovalWorkspace,
  normalizePlatformAmoCrmSelectedBindings,
  persistPlatformAmoCrmMappingDiscovery,
  readPlatformAmoCrmMappingApprovalWorkspace,
  readPlatformAmoCrmMappingDiscoveryVersion,
  readPlatformAmoCrmMappingStateForConversation,
  revokePlatformAmoCrmMappingSelection,
} from "../src/lib/server/platform-amocrm-mapping-repository.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_ID = "10000001";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";
const ACTOR_PROFILE_ID = "66666666-6666-4666-8666-666666666666";

function providerResponses(overrides = {}) {
  return {
    account: {
      id: Number(ACCOUNT_ID),
      name: "Must not be persisted",
      subdomain: "evo-admissions",
      email: "operator@example.invalid",
      access_token: "must-not-cross-boundary",
    },
    pipelines: {
      _embedded: {
        pipelines: [
          {
            id: 2002,
            name: "Admissions sales",
            is_main: true,
            is_archive: false,
            _embedded: {
              statuses: [
                {
                  id: 3002,
                  name: "Contract confirmed",
                  sort: 20,
                  is_editable: true,
                  type: 0,
                  color: "#ffffff",
                },
                {
                  id: 3001,
                  name: "New lead",
                  sort: 10,
                  is_editable: true,
                  type: 0,
                },
              ],
            },
          },
        ],
      },
    },
    users: {
      _embedded: {
        users: [
          {
            id: 4001,
            name: "Sales Manager",
            rights: { is_active: true, is_admin: false },
            email: "sales@example.invalid",
            phone: "+000000000",
          },
        ],
      },
    },
    leadCustomFields: {
      _embedded: {
        custom_fields: [
          {
            id: 5001,
            name: "Target country",
            code: null,
            type: "select",
            enums: [
              { id: 5002, value: "Malaysia", sort: 10 },
            ],
          },
        ],
      },
    },
    contactCustomFields: {
      _embedded: {
        custom_fields: [
          {
            id: 6001,
            name: "Phone",
            code: "PHONE",
            type: "multitext",
          },
        ],
      },
    },
    ...overrides,
  };
}

function validSnapshot(overrides = {}) {
  return buildPlatformAmoCrmMappingSnapshot({
    accountDomain: "evo-admissions.amocrm.ru",
    ...providerResponses(),
    ...overrides,
  });
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/hal+json; charset=utf-8",
      ...init.headers,
    },
  });
}

test("normalizes only a single HTTPS amoCRM or Kommo account origin", () => {
  assert.deepEqual(
    normalizePlatformAmoCrmAccountDomain(" EVO-Admissions.AMOCRM.RU "),
    {
      domain: "evo-admissions.amocrm.ru",
      origin: "https://evo-admissions.amocrm.ru",
      subdomain: "evo-admissions",
    },
  );
  assert.equal(
    normalizePlatformAmoCrmAccountDomain("https://team.kommo.com/").domain,
    "team.kommo.com",
  );

  for (const rejected of [
    "http://team.amocrm.ru",
    "https://amocrm.ru",
    "https://one.two.amocrm.ru",
    "https://user:pass@team.amocrm.ru",
    "https://team.amocrm.ru:8443",
    "https://team.amocrm.ru/api/v4/account",
    "https://team.amocrm.ru/?token=secret",
    "https://team.example.com",
  ]) {
    assert.throws(
      () => normalizePlatformAmoCrmAccountDomain(rejected),
      PlatformAmoCrmDiscoveryContractError,
    );
  }
});

test("normalizes provider IDs without accepting lossy JavaScript numbers", () => {
  assert.equal(parsePlatformAmoCrmProviderId(42), "42");
  assert.equal(parsePlatformAmoCrmProviderId("9223372036854775807"), "9223372036854775807");
  assert.equal(parsePlatformAmoCrmProviderId(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(parsePlatformAmoCrmProviderId("9223372036854775808"), null);
  assert.equal(parsePlatformAmoCrmProviderId("01"), null);
  assert.equal(parsePlatformAmoCrmProviderId(0), null);
});

test("builds a deterministic sanitized snapshot and drops provider extras", () => {
  const snapshot = validSnapshot();
  assert.equal(snapshot.schema_version, 1);
  assert.deepEqual(snapshot.pipelines[0].statuses.map((row) => row.id), ["3001", "3002"]);
  assert.deepEqual(snapshot.contact_custom_fields[0].enums, []);
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    "access_token",
    "must-not-cross-boundary",
    "operator@example.invalid",
    "sales@example.invalid",
    "+000000000",
    "#ffffff",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.deepEqual(normalizePersistedPlatformAmoCrmMappingSnapshot(snapshot), snapshot);
});

test("fails closed for account mismatch, duplicate IDs and empty required mappings", () => {
  assert.throws(
    () => validSnapshot({ accountDomain: "another.amocrm.ru" }),
    PlatformAmoCrmDiscoveryContractError,
  );

  const duplicate = providerResponses();
  duplicate.users._embedded.users.push({
    id: 4001,
    name: "Duplicate",
    rights: { is_active: true },
  });
  assert.throws(
    () => validSnapshot({ users: duplicate.users }),
    PlatformAmoCrmDiscoveryContractError,
  );

  assert.throws(
    () => validSnapshot({ users: { _embedded: { users: [] } } }),
    PlatformAmoCrmDiscoveryContractError,
  );
});

test("uses only bounded sequential GET requests and canonicalizes all responses", async () => {
  const source = providerResponses();
  const requests = [];
  const responses = new Map([
    ["/api/v4/account", source.account],
    ["/api/v4/leads/pipelines", source.pipelines],
    ["/api/v4/users?limit=250&page=1", source.users],
    ["/api/v4/leads/custom_fields?limit=250&page=1", source.leadCustomFields],
    ["/api/v4/contacts/custom_fields?limit=250&page=1", source.contactCustomFields],
  ]);

  const snapshot = await discoverPlatformAmoCrmMappingSnapshot(
    {
      accountDomain: "evo-admissions.amocrm.ru",
      accessToken: "synthetic-token-never-logged",
    },
    {
      fetchImplementation: async (input, init) => {
        const url = new URL(input);
        requests.push({ url, init });
        const body = responses.get(`${url.pathname}${url.search}`);
        assert.notEqual(body, undefined);
        return jsonResponse(body);
      },
    },
  );

  assert.equal(snapshot.account.id, ACCOUNT_ID);
  assert.equal(requests.length, 5);
  for (const request of requests) {
    assert.equal(request.url.origin, "https://evo-admissions.amocrm.ru");
    assert.equal(request.init.method, "GET");
    assert.equal(request.init.redirect, "error");
    assert.equal(request.init.cache, "no-store");
    assert.equal(
      request.init.headers.Authorization,
      "Bearer synthetic-token-never-logged",
    );
  }
});

test("shares non-bypassable pacing through a deterministic queue", async () => {
  let now = 10_000;
  const sleeps = [];
  const pacer = createPlatformAmoCrmDiscoveryRequestPacer({
    now: () => now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
  });

  await Promise.all([pacer.acquire(), pacer.acquire(), pacer.acquire()]);

  assert.deepEqual(sleeps, [
    PLATFORM_AMOCRM_DISCOVERY_REQUEST_INTERVAL_MS,
    PLATFORM_AMOCRM_DISCOVERY_REQUEST_INTERVAL_MS,
  ]);
  assert.equal(now, 10_000 + 2 * PLATFORM_AMOCRM_DISCOVERY_REQUEST_INTERVAL_MS);
});

test("follows bounded pagination without trusting a provider next URL", async () => {
  const source = providerResponses();
  const firstPage = Array.from({ length: 250 }, (_, index) => ({
    id: index + 1,
    name: `User ${index + 1}`,
    rights: { is_active: true },
  }));
  const seen = [];
  const snapshot = await discoverPlatformAmoCrmMappingSnapshot(
    { accountDomain: "evo-admissions.amocrm.ru", accessToken: "token" },
    {
      fetchImplementation: async (input) => {
        const url = new URL(input);
        const key = `${url.pathname}${url.search}`;
        seen.push(key);
        if (key === "/api/v4/account") return jsonResponse(source.account);
        if (key === "/api/v4/leads/pipelines") return jsonResponse(source.pipelines);
        if (key === "/api/v4/users?limit=250&page=1") {
          return jsonResponse({
            _links: { next: { href: "https://attacker.invalid/steal" } },
            _embedded: { users: firstPage },
          });
        }
        if (key === "/api/v4/users?limit=250&page=2") {
          return jsonResponse({
            _embedded: {
              users: [{ id: 251, name: "User 251", rights: { is_active: true } }],
            },
          });
        }
        if (key.startsWith("/api/v4/leads/custom_fields")) {
          return jsonResponse(source.leadCustomFields);
        }
        if (key.startsWith("/api/v4/contacts/custom_fields")) {
          return jsonResponse(source.contactCustomFields);
        }
        throw new Error(`Unexpected test request: ${key}`);
      },
    },
  );
  assert.equal(snapshot.users.length, 251);
  assert.equal(seen.some((value) => value.includes("attacker.invalid")), false);
});

test("stops pagination when an exact 250-row page has no HAL next link", async () => {
  const source = providerResponses();
  const exactPage = Array.from({ length: 250 }, (_, index) => ({
    id: index + 1,
    name: `User ${index + 1}`,
    rights: { is_active: true },
  }));
  const seen = [];
  const snapshot = await discoverPlatformAmoCrmMappingSnapshot(
    { accountDomain: "evo-admissions.amocrm.ru", accessToken: "token" },
    {
      fetchImplementation: async (input) => {
        const url = new URL(input);
        const key = `${url.pathname}${url.search}`;
        seen.push(key);
        if (key === "/api/v4/account") return jsonResponse(source.account);
        if (key === "/api/v4/leads/pipelines") return jsonResponse(source.pipelines);
        if (key === "/api/v4/users?limit=250&page=1") {
          return jsonResponse({ _embedded: { users: exactPage } });
        }
        if (key.startsWith("/api/v4/leads/custom_fields")) {
          return jsonResponse(source.leadCustomFields);
        }
        if (key.startsWith("/api/v4/contacts/custom_fields")) {
          return jsonResponse(source.contactCustomFields);
        }
        throw new Error(`Unexpected test request: ${key}`);
      },
    },
  );

  assert.equal(snapshot.users.length, 250);
  assert.equal(seen.includes("/api/v4/users?limit=250&page=2"), false);
});

test("returns safe typed errors without response bodies, tokens or automatic retries", async () => {
  let calls = 0;
  const sensitiveMarker = ["unique", "sensitive", "test", "marker"].join("-");
  await assert.rejects(
    () => discoverPlatformAmoCrmMappingSnapshot(
      { accountDomain: "team.amocrm.ru", accessToken: sensitiveMarker },
      {
        fetchImplementation: async () => {
          calls += 1;
          return jsonResponse(
            { detail: `provider echoed ${sensitiveMarker}` },
            { status: 429, headers: { "retry-after": "12" } },
          );
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof PlatformAmoCrmDiscoveryClientError);
      assert.equal(error.code, "provider_rejected");
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 12);
      assert.equal(error.message.includes(sensitiveMarker), false);
      assert.equal(JSON.stringify(error).includes(sensitiveMarker), false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("rejects malformed and oversized provider responses", async () => {
  await assert.rejects(
    () => discoverPlatformAmoCrmMappingSnapshot(
      { accountDomain: "team.amocrm.ru", accessToken: "token" },
      {
        fetchImplementation: async () => new Response("not-json", {
          headers: { "content-type": "text/plain" },
        }),
      },
    ),
    (error) => error instanceof PlatformAmoCrmDiscoveryClientError &&
      error.code === "provider_response_invalid",
  );

  await assert.rejects(
    () => discoverPlatformAmoCrmMappingSnapshot(
      { accountDomain: "team.amocrm.ru", accessToken: "token" },
      {
        maxResponseBytes: 1_024,
        fetchImplementation: async () => jsonResponse({ payload: "x".repeat(2_000) }),
      },
    ),
    (error) => error instanceof PlatformAmoCrmDiscoveryClientError &&
      error.code === "provider_response_too_large",
  );
});

function discoveryRow(snapshot = validSnapshot(), overrides = {}) {
  return {
    discovery_version_id: VERSION_ID,
    organization_id: ORGANIZATION_ID,
    amocrm_account_id: ACCOUNT_ID,
    account_domain: "evo-admissions.amocrm.ru",
    account_subdomain: "evo-admissions",
    version: "1",
    snapshot_schema_version: 1,
    sanitized_snapshot: snapshot,
    snapshot_sha256: "a".repeat(64),
    evidence_kind: "local_non_provider",
    evidence_ref: "tests/platform-amocrm-discovery.test.mjs",
    request_id: REQUEST_ID,
    discovered_at: "2026-08-04T01:02:03Z",
    created_at: "2026-08-04T01:02:04.123456Z",
    ...overrides,
  };
}

function fakeSupabaseClient(handler) {
  return {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        rpc(name, args, options) {
          let retryEnabled;
          let result;
          const execute = () => {
            result ??= Promise.resolve().then(() =>
              handler(name, args, options, retryEnabled));
            return result;
          };
          return {
            retry(enabled) {
              retryEnabled = enabled;
              return this;
            },
            then(onFulfilled, onRejected) {
              return execute().then(onFulfilled, onRejected);
            },
          };
        },
      };
    },
  };
}

test("persists a sanitized snapshot through only the service RPC adapter", async () => {
  const snapshot = validSnapshot();
  let receipt;
  const client = fakeSupabaseClient(async (name, args, options) => {
    receipt = { name, args, options };
    return { data: [discoveryRow(snapshot)], error: null };
  });
  const row = await persistPlatformAmoCrmMappingDiscovery(client, {
    organizationId: ORGANIZATION_ID,
    snapshot,
    evidenceKind: "local_non_provider",
    evidenceRef: "tests/platform-amocrm-discovery.test.mjs",
    discoveredAt: "2026-08-04T01:02:03Z",
    requestId: REQUEST_ID,
  });

  assert.equal(receipt.name, "persist_amocrm_mapping_discovery");
  assert.equal(receipt.options, undefined);
  assert.equal(receipt.args.p_amocrm_account_id, ACCOUNT_ID);
  assert.equal(receipt.args.p_account_domain, "evo-admissions.amocrm.ru");
  assert.deepEqual(receipt.args.p_sanitized_snapshot, snapshot);
  assert.equal(row.discoveryVersionId, VERSION_ID);
});

test("reads only the requested admin mapping version through a GET RPC", async () => {
  let receipt;
  const client = fakeSupabaseClient(async (name, args, options) => {
    receipt = { name, args, options };
    return { data: [discoveryRow()], error: null };
  });
  const row = await readPlatformAmoCrmMappingDiscoveryVersion(client, {
    organizationId: ORGANIZATION_ID,
    amocrmAccountId: ACCOUNT_ID,
    version: 1,
  });
  assert.equal(receipt.name, "admin_amocrm_mapping_discovery_versions");
  assert.deepEqual(receipt.options, { get: true });
  assert.equal(receipt.args.p_version, 1);
  assert.equal(row.version, 1);
});

test("repository adapters fail closed on errors, mismatches and malformed rows", async () => {
  const providerError = fakeSupabaseClient(async () => ({
    data: null,
    error: { message: "sensitive database detail" },
  }));
  await assert.rejects(
    () => readPlatformAmoCrmMappingDiscoveryVersion(providerError, {
      organizationId: ORGANIZATION_ID,
      amocrmAccountId: ACCOUNT_ID,
    }),
    PlatformAmoCrmMappingRepositoryError,
  );

  const mismatch = fakeSupabaseClient(async () => ({
    data: [discoveryRow(undefined, { organization_id: "44444444-4444-4444-8444-444444444444" })],
    error: null,
  }));
  await assert.rejects(
    () => readPlatformAmoCrmMappingDiscoveryVersion(mismatch, {
      organizationId: ORGANIZATION_ID,
      amocrmAccountId: ACCOUNT_ID,
    }),
    PlatformAmoCrmMappingRepositoryError,
  );

  const duplicate = fakeSupabaseClient(async () => ({
    data: [discoveryRow(), discoveryRow()],
    error: null,
  }));
  await assert.rejects(
    () => readPlatformAmoCrmMappingDiscoveryVersion(duplicate, {
      organizationId: ORGANIZATION_ID,
      amocrmAccountId: ACCOUNT_ID,
    }),
    PlatformAmoCrmMappingRepositoryError,
  );
});

function selectedBindingsRow(overrides = {}) {
  return {
    pipeline_id: "2002",
    signed_contract_status_id: "3002",
    responsible_user_source: "lead.responsible_user_id",
    lead_custom_fields: [{ binding_key: "target_country", field_id: "5001" }],
    contact_custom_fields: [{ binding_key: "primary_phone", field_id: "6001" }],
    ...overrides,
  };
}

function mappingStateRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    conversation_id: CONVERSATION_ID,
    mapping_use: "messaging",
    mapping_state: "not_approved",
    ...overrides,
  };
}

function adminWorkspaceRow(overrides = {}) {
  return {
    ...mappingStateRow(),
    amocrm_account_id: ACCOUNT_ID,
    review_discovery_version_id: VERSION_ID,
    review_discovery_version: 1,
    review_account_domain: "evo-admissions.amocrm.ru",
    review_account_subdomain: "evo-admissions",
    review_sanitized_snapshot: validSnapshot(),
    review_snapshot_sha256: "a".repeat(64),
    review_evidence_kind: "local_non_provider",
    review_evidence_ref: "tests/platform-amocrm-discovery.test.mjs",
    review_discovered_at: "2026-08-04T01:02:03Z",
    current_event_id: null,
    current_event_kind: null,
    current_discovery_version_id: null,
    current_discovery_version: null,
    current_selected_bindings: null,
    current_reason: null,
    current_actor_profile_id: null,
    current_request_id: null,
    current_created_at: null,
    ...overrides,
  };
}

function approvalEventRow(overrides = {}) {
  return {
    approval_event_id: EVENT_ID,
    organization_id: ORGANIZATION_ID,
    amocrm_account_id: ACCOUNT_ID,
    mapping_use: "messaging",
    event_version: 1,
    event_kind: "approved",
    discovery_version_id: VERSION_ID,
    discovery_version: 1,
    selected_bindings: selectedBindingsRow(),
    prior_event_id: null,
    actor_profile_id: ACTOR_PROFILE_ID,
    reason: "Reviewed account-specific mapping",
    request_id: REQUEST_ID,
    created_at: "2026-08-05T01:02:03.123456Z",
    mapping_state: "approved_configured_unverified",
    ...overrides,
  };
}

test("normalizes generic selected bindings without inventing global semantic keys", () => {
  const selected = normalizePlatformAmoCrmSelectedBindings(selectedBindingsRow());
  assert.equal(selected.pipelineId, "2002");
  assert.equal(selected.signedContractStatusId, "3002");
  assert.deepEqual(selected.leadCustomFields, [
    { bindingKey: "target_country", fieldId: "5001" },
  ]);
  assert.deepEqual(selected.contactCustomFields, [
    { bindingKey: "primary_phone", fieldId: "6001" },
  ]);

  for (const rejected of [
    selectedBindingsRow({ lead_custom_fields: [] }),
    selectedBindingsRow({ responsible_user_source: "user.id" }),
    selectedBindingsRow({
      contact_custom_fields: [{ binding_key: "target_country", field_id: "6001" }],
    }),
    selectedBindingsRow({
      lead_custom_fields: [{ binding_key: "Target Country", field_id: "5001" }],
    }),
  ]) {
    assert.throws(
      () => normalizePlatformAmoCrmSelectedBindings(rejected),
      PlatformAmoCrmMappingRepositoryError,
    );
  }
});

test("reads only the bounded conversation mapping state for authorized staff", async () => {
  let receipt;
  const client = fakeSupabaseClient(async (name, args, options) => {
    receipt = { name, args, options };
    return { data: [mappingStateRow()], error: null };
  });
  const state = await readPlatformAmoCrmMappingStateForConversation(client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
  });
  assert.deepEqual(receipt, {
    name: "amocrm_mapping_state_for_conversation",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
    },
    options: { get: true },
  });
  assert.equal(state.mappingState, "not_approved");
  assert.deepEqual(Object.keys(state).sort(), [
    "conversationId",
    "mappingState",
    "mappingUse",
    "organizationId",
  ]);
});

test("normalizes Admin review workspace and keeps revoked latest-event concurrency evidence", () => {
  const workspace = normalizePlatformAmoCrmMappingApprovalWorkspace(
    adminWorkspaceRow({
      current_event_id: EVENT_ID,
      current_event_kind: "revoked",
      current_discovery_version_id: VERSION_ID,
      current_discovery_version: 1,
      current_selected_bindings: selectedBindingsRow(),
      current_reason: "Mapping revoked after review",
      current_actor_profile_id: ACTOR_PROFILE_ID,
      current_request_id: REQUEST_ID,
      current_created_at: "2026-08-05T01:02:03Z",
    }),
  );
  assert.equal(workspace.mappingState, "not_approved");
  assert.equal(workspace.reviewDiscovery.version, 1);
  assert.equal(workspace.latestDecision.eventKind, "revoked");
  assert.equal(workspace.latestDecision.eventId, EVENT_ID);

  const withoutDiscovery = normalizePlatformAmoCrmMappingApprovalWorkspace(
    adminWorkspaceRow({
      review_discovery_version_id: null,
      review_discovery_version: null,
      review_account_domain: null,
      review_account_subdomain: null,
      review_sanitized_snapshot: null,
      review_snapshot_sha256: null,
      review_evidence_kind: null,
      review_evidence_ref: null,
      review_discovered_at: null,
    }),
  );
  assert.equal(withoutDiscovery.reviewDiscovery, null);
});

test("Admin workspace RPC is exact-scope and rejects response scope drift", async () => {
  let receipt;
  const client = fakeSupabaseClient(async (name, args, options) => {
    receipt = { name, args, options };
    return { data: [adminWorkspaceRow()], error: null };
  });
  const workspace = await readPlatformAmoCrmMappingApprovalWorkspace(client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    discoveryVersionId: VERSION_ID,
  });
  assert.equal(workspace.reviewDiscovery.discoveryVersionId, VERSION_ID);
  assert.deepEqual(receipt, {
    name: "admin_amocrm_mapping_approval_workspace",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
      p_discovery_version_id: VERSION_ID,
    },
    options: { get: true },
  });

  let defaultedReceipt;
  const defaulted = fakeSupabaseClient(async (name, args, options) => {
    defaultedReceipt = { name, args, options };
    return { data: [adminWorkspaceRow()], error: null };
  });
  await readPlatformAmoCrmMappingApprovalWorkspace(defaulted, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
  });
  assert.deepEqual(defaultedReceipt, {
    name: "admin_amocrm_mapping_approval_workspace",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
    },
    options: { get: true },
  });

  const drift = fakeSupabaseClient(async () => ({
    data: [adminWorkspaceRow({ conversation_id: ACTOR_PROFILE_ID })],
    error: null,
  }));
  await assert.rejects(
    () => readPlatformAmoCrmMappingApprovalWorkspace(drift, {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
    }),
    PlatformAmoCrmMappingRepositoryError,
  );
});

test("approve and revoke adapters keep immutable receipts separate from current state", async () => {
  const selectedBindings = normalizePlatformAmoCrmSelectedBindings(
    selectedBindingsRow(),
  );
  const receipts = [];
  const client = fakeSupabaseClient(async (name, args, options, retryEnabled) => {
    receipts.push({ name, args, options, retryEnabled });
    if (name === "approve_amocrm_mapping_selection") {
      return { data: [approvalEventRow()], error: null };
    }
    return {
      data: [approvalEventRow({
        approval_event_id: "77777777-7777-4777-8777-777777777777",
        event_version: 2,
        event_kind: "revoked",
        prior_event_id: EVENT_ID,
        reason: "Revoke after explicit review",
        mapping_state: "not_approved",
      })],
      error: null,
    };
  });
  const approved = await approvePlatformAmoCrmMappingSelection(client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    amocrmAccountId: ACCOUNT_ID,
    discoveryVersionId: VERSION_ID,
    selectedBindings,
    expectedPriorEventId: null,
    reason: "Reviewed account-specific mapping",
    requestId: REQUEST_ID,
  });
  assert.equal(approved.eventKind, "approved");
  assert.deepEqual(receipts[0], {
    name: "approve_amocrm_mapping_selection",
    args: {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
      p_discovery_version_id: VERSION_ID,
      p_selected_bindings: selectedBindingsRow(),
      p_expected_prior_event_id: null,
      p_reason: "Reviewed account-specific mapping",
      p_request_id: REQUEST_ID,
    },
    options: undefined,
    retryEnabled: false,
  });

  const revoked = await revokePlatformAmoCrmMappingSelection(client, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    amocrmAccountId: ACCOUNT_ID,
    expectedPriorEventId: EVENT_ID,
    reason: "Revoke after explicit review",
    requestId: REQUEST_ID,
  });
  assert.equal(revoked.eventKind, "revoked");
  assert.equal(receipts[1].name, "revoke_amocrm_mapping_selection");
  assert.equal(receipts[1].args.p_expected_prior_event_id, EVENT_ID);
  assert.equal(receipts[1].retryEnabled, false);

  const replayedApprovalAfterRevoke = normalizePlatformAmoCrmMappingApprovalEvent(
    approvalEventRow({ mapping_state: "not_approved" }),
  );
  assert.equal(replayedApprovalAfterRevoke.eventKind, "approved");
  assert.equal(replayedApprovalAfterRevoke.mappingState, "not_approved");

  const replayedRevokeAfterApproval = normalizePlatformAmoCrmMappingApprovalEvent(
    approvalEventRow({
      approval_event_id: "77777777-7777-4777-8777-777777777777",
      event_version: 2,
      event_kind: "revoked",
      prior_event_id: EVENT_ID,
      reason: "Revoke after explicit review",
      mapping_state: "approved_configured_unverified",
    }),
  );
  assert.equal(replayedRevokeAfterApproval.eventKind, "revoked");
  assert.equal(
    replayedRevokeAfterApproval.mappingState,
    "approved_configured_unverified",
  );
});

test("P4B app seam stays on Platform auth, persisted state, and non-provider truth", async () => {
  const paths = [
    new URL("../src/lib/platform-amocrm-approval-actions.ts", import.meta.url),
    new URL("../src/app/(staff)/whatsapp/[id]/page.tsx", import.meta.url),
    new URL(
      "../src/components/platform/communications/PlatformAmoCrmMappingPanel.tsx",
      import.meta.url,
    ),
  ];
  const [actionSource, pageSource, panelSource] = await Promise.all(
    paths.map((path) => readFile(path, "utf8")),
  );
  assert.match(actionSource, /requirePlatformMessagingActor/);
  assert.match(actionSource, /actor\.platformRole !== "admin"/);
  assert.match(actionSource, /approvePlatformAmoCrmMappingSelection/);
  assert.match(actionSource, /revokePlatformAmoCrmMappingSelection/);
  assert.doesNotMatch(actionSource, /mapping_result|mapping_retry_request_id/);
  assert.doesNotMatch(pageSource, /mapping_result|mapping_retry_request_id/);
  assert.match(pageSource, /readPlatformAmoCrmMappingStateForConversation/);
  assert.match(panelSource, /data-provider-proof="not-proved"/);
  assert.match(panelSource, /lead\.responsible_user_id/);
  assert.match(panelSource, /aria-live="polite"/);
  assert.match(panelSource, /name="request_id"[\s\S]{0,80}defaultValue=""/);
  assert.match(
    panelSource,
    /key=\{`\$\{workspace\.workspace\.reviewDiscovery\?\.discoveryVersionId[\s\S]+workspace\.workspace\.latestDecision\?\.eventId/,
  );
  assert.doesNotMatch(panelSource, /JSON\.stringify|textarea[^>]+selected_bindings/);
  for (const source of [actionSource, pageSource, panelSource]) {
    assert.doesNotMatch(source, /@\/lib\/(?:db|auth)|from\s+["']\.\/db["']/);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE|service_role|AMOCRM_(?:TOKEN|SECRET)/);
    assert.doesNotMatch(source, /LegacyWhatsAppPage/);
  }
});

test("server adapters have no legacy DB, env secret, browser or provider-write seam", async () => {
  const paths = [
    new URL("../src/lib/server/platform-amocrm-discovery-client.ts", import.meta.url),
    new URL("../src/lib/server/platform-amocrm-mapping-repository.ts", import.meta.url),
  ];
  const source = (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");
  for (const forbidden of [
    "@/lib/db",
    "../db",
    "lead-stages",
    "process.env",
    "SUPABASE_SERVICE_ROLE",
    'method: "POST"',
    'method: "PATCH"',
    'method: "DELETE"',
    '"use client"',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.match(source, /^import "server-only";/);
  assert.equal(source.includes("minimumIntervalMs"), false);
  assert.match(
    source,
    /const sharedProviderRequestPacer = createPlatformAmoCrmDiscoveryRequestPacer\(\);/,
  );

  const poisonProbe = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", 'import("server-only")'],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    },
  );
  assert.notEqual(poisonProbe.status, 0);
  assert.match(
    `${poisonProbe.stdout}${poisonProbe.stderr}`,
    /cannot be imported from a Client Component module/,
  );

  async function sourceFiles(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = new URL(
        `${encodeURIComponent(entry.name)}${entry.isDirectory() ? "/" : ""}`,
        directory,
      );
      if (entry.isDirectory()) {
        files.push(...await sourceFiles(child));
      } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        files.push(child);
      }
    }
    return files;
  }

  const clientImportViolations = [];
  for (const path of await sourceFiles(new URL("../src/", import.meta.url))) {
    const fileSource = await readFile(path, "utf8");
    if (
      /^\s*["']use client["'];/m.test(fileSource) &&
      /platform-amocrm-(?:discovery-client|mapping-repository)/.test(fileSource)
    ) {
      clientImportViolations.push(path.pathname);
    }
  }
  assert.deepEqual(clientImportViolations, []);
});
