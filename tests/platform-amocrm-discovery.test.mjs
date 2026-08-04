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
  persistPlatformAmoCrmMappingDiscovery,
  readPlatformAmoCrmMappingDiscoveryVersion,
} from "../src/lib/server/platform-amocrm-mapping-repository.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_ID = "10000001";

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
          return handler(name, args, options);
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
