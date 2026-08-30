import assert from "node:assert/strict";
import test from "node:test";

import {
  CanonicalAmoCrmCommandConfigurationError,
  loadCanonicalAmoCrmCommandConfig,
} from "../src/lib/server/canonical-amocrm-command-config.ts";
import {
  CanonicalAmoCrmDiscoveryError,
  discoverCanonicalAmoCrmCommandRouting,
} from "../src/lib/server/canonical-amocrm-discovery-service.ts";

const PROVIDER_CONFIG = Object.freeze({
  status: "ready",
  accountDomain: "evo-admissions.amocrm.ru",
  accountOrigin: "https://evo-admissions.amocrm.ru",
  accountSubdomain: "evo-admissions",
  clientId: "client-id",
  clientSecret: "client-secret-kept-out-of-discovery",
  redirectUri: "https://private.invalid/oauth/callback",
  tokenFilePath: "/private/token.json",
  timeoutMs: 10_000,
  maxResponseBytes: 262_144,
  requestIntervalMs: 150,
});

const ROUTING_ENV = Object.freeze({
  EVO_V2_AMOCRM_SALES_PIPELINE_ID: "2001",
  EVO_V2_AMOCRM_SALES_STATUS_ID: "3001",
  EVO_V2_AMOCRM_SALES_RESPONSIBLE_USER_ID: "4001",
  EVO_V2_AMOCRM_SALES_TAG_NAME: "EVO V2 Sales",
  EVO_V2_AMOCRM_ADMISSIONS_PIPELINE_ID: "2002",
  EVO_V2_AMOCRM_ADMISSIONS_STATUS_ID: "3002",
  EVO_V2_AMOCRM_ADMISSIONS_RESPONSIBLE_USER_ID: "4002",
  EVO_V2_AMOCRM_ADMISSIONS_TAG_NAME: "EVO V2 Admissions",
});

function providerResponses(overrides = {}) {
  return {
    account: {
      id: 1001,
      name: "EVO Admissions",
      subdomain: "evo-admissions",
      timezone: "Asia/Bishkek",
      country: "KG",
      access_token: "must-not-cross-the-boundary",
      _links: {
        self: {
          href: "https://evo-admissions.amocrm.ru/api/v4/account",
        },
      },
    },
    pipelines: {
      _embedded: {
        pipelines: [
          {
            id: 2002,
            name: "Admissions",
            is_main: false,
            is_archive: false,
            _embedded: {
              statuses: [
                {
                  id: 3002,
                  name: "Admissions active",
                  sort: 20,
                  type: 0,
                  is_editable: true,
                },
              ],
            },
          },
          {
            id: 2001,
            name: "Sales",
            is_main: true,
            is_archive: false,
            _embedded: {
              statuses: [
                {
                  id: 3001,
                  name: "Qualified",
                  sort: 10,
                  type: 0,
                  is_editable: true,
                },
              ],
            },
          },
        ],
      },
    },
    leadTags: {
      _embedded: {
        tags: [
          { id: 8002, name: "EVO V2 Admissions" },
          { id: 8001, name: "EVO V2 Sales" },
        ],
      },
    },
    users: {
      _embedded: {
        users: [
          {
            id: 4002,
            name: "Admissions Manager",
            email: "private@example.invalid",
            rights: { is_active: true, is_admin: false },
          },
          {
            id: 4001,
            name: "Sales Manager",
            phone: "+000000000",
            rights: { is_active: true, is_admin: false },
          },
        ],
      },
    },
    leadCustomFields: {
      _embedded: {
        custom_fields: [
          {
            id: 5001,
            name: "Program",
            code: null,
            type: "text",
            enums: null,
          },
        ],
      },
    },
    contactCustomFields: {
      _embedded: {
        custom_fields: [
          {
            id: 6002,
            name: "Email",
            code: "EMAIL",
            type: "multitext",
            enums: [{ id: 7002, value: "WORK", sort: 20 }],
          },
          {
            id: 6001,
            name: "Phone",
            code: "PHONE",
            type: "multitext",
            enums: [{ id: 7001, value: "WORK", sort: 10 }],
          },
        ],
      },
    },
    ...overrides,
  };
}

function fakeProvider(source, calls) {
  return Object.freeze({
    getAccount: async () => {
      calls.push("account");
      return source.account;
    },
    getPipelines: async () => {
      calls.push("pipelines");
      return source.pipelines;
    },
    getLeadTags: async () => {
      calls.push("lead-tags");
      return source.leadTags;
    },
    getUsers: async () => {
      calls.push("users");
      return source.users;
    },
    getLeadCustomFields: async () => {
      calls.push("lead-custom-fields");
      return source.leadCustomFields;
    },
    getContactCustomFields: async () => {
      calls.push("contact-custom-fields");
      return source.contactCustomFields;
    },
  });
}

test("loads exact Sales and Admissions command routing without legacy fallback", () => {
  const config = loadCanonicalAmoCrmCommandConfig(ROUTING_ENV);

  assert.deepEqual(config.sales, {
    pipelineId: "2001",
    statusId: "3001",
    responsibleUserId: "4001",
    tagName: "EVO V2 Sales",
  });
  assert.deepEqual(config.admissions, {
    pipelineId: "2002",
    statusId: "3002",
    responsibleUserId: "4002",
    tagName: "EVO V2 Admissions",
  });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.sales), true);

  assert.throws(
    () =>
      loadCanonicalAmoCrmCommandConfig({
        EVO_AGENT_AMO_PIPELINE_ID: "2001",
        EVO_AGENT_AMO_STATUS_ID: "3001",
        EVO_AGENT_AMO_RESPONSIBLE_USER_ID: "4001",
      }),
    (error) =>
      error instanceof CanonicalAmoCrmCommandConfigurationError &&
      error.code === "configuration_missing" &&
      error.field === "sales_pipeline_id" &&
      !error.message.includes("2001"),
  );
});

test("rejects malformed IDs and non-exact or unbounded role tag names without echoing values", () => {
  for (const [field, value, code] of [
    ["EVO_V2_AMOCRM_SALES_PIPELINE_ID", "0", "invalid_provider_id"],
    ["EVO_V2_AMOCRM_SALES_PIPELINE_ID", "2147483648", "invalid_provider_id"],
    ["EVO_V2_AMOCRM_ADMISSIONS_STATUS_ID", " 3002", "invalid_provider_id"],
    ["EVO_V2_AMOCRM_SALES_TAG_NAME", " Sales", "invalid_tag_name"],
    ["EVO_V2_AMOCRM_ADMISSIONS_TAG_NAME", "x".repeat(129), "invalid_tag_name"],
  ]) {
    assert.throws(
      () => loadCanonicalAmoCrmCommandConfig({ ...ROUTING_ENV, [field]: value }),
      (error) =>
        error instanceof CanonicalAmoCrmCommandConfigurationError &&
        error.code === code &&
        !error.message.includes(value),
    );
  }
});

test("discovers, sanitizes, hashes and persists one immutable exact-account routing snapshot", async () => {
  const calls = [];
  const writes = [];
  const repository = Object.freeze({
    persist: async (input) => {
      writes.push(input);
      return Object.freeze({
        accountId: "11111111-1111-4111-8111-111111111111",
        snapshotId: "22222222-2222-4222-8222-222222222222",
        discoveredAt: new Date("2026-08-29T08:00:00.000Z"),
      });
    },
  });

  const snapshot = await discoverCanonicalAmoCrmCommandRouting({
    providerConfig: PROVIDER_CONFIG,
    commandConfig: loadCanonicalAmoCrmCommandConfig(ROUTING_ENV),
    provider: fakeProvider(providerResponses(), calls),
    repository,
    correlationId: "discovery-test-1",
    now: () => new Date("2026-08-29T08:00:00.000Z"),
  });

  assert.deepEqual(calls, [
    "account",
    "pipelines",
    "lead-tags",
    "users",
    "lead-custom-fields",
    "contact-custom-fields",
  ]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].account.providerAccountId, "1001");
  assert.equal(writes[0].account.accountBaseUrl, PROVIDER_CONFIG.accountOrigin);
  assert.equal(writes[0].account.accountSubdomain, "evo-admissions");
  assert.match(writes[0].snapshot.snapshotSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(writes[0].snapshot.leadTagCatalog, [
    { id: "8001", name: "EVO V2 Sales" },
    { id: "8002", name: "EVO V2 Admissions" },
  ]);
  assert.equal(JSON.stringify(writes[0]).includes("must-not-cross"), false);
  assert.equal(JSON.stringify(writes[0]).includes("private@example"), false);
  assert.equal(JSON.stringify(writes[0]).includes("+000000000"), false);

  assert.deepEqual(snapshot.sales, {
    pipelineId: "2001",
    statusId: "3001",
    responsibleUserId: "4001",
    tagId: "8001",
    tagName: "EVO V2 Sales",
  });
  assert.deepEqual(snapshot.admissions, {
    pipelineId: "2002",
    statusId: "3002",
    responsibleUserId: "4002",
    tagId: "8002",
    tagName: "EVO V2 Admissions",
  });
  assert.deepEqual(snapshot.contactCustomFields, {
    phoneFieldId: "6001",
    emailFieldId: "6002",
  });
  assert.equal(snapshot.providerAccountId, "1001");
  assert.equal(snapshot.accountBaseUrl, PROVIDER_CONFIG.accountOrigin);
  assert.equal(snapshot.discoverySnapshotId, "22222222-2222-4222-8222-222222222222");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.sales), true);
  assert.equal(Object.isFrozen(snapshot.contactCustomFields), true);
});

test("exact lead tag IDs participate in the immutable discovery hash", async () => {
  async function discoverWithSalesTagId(tagId) {
    let persistedHash = null;
    const snapshot = await discoverCanonicalAmoCrmCommandRouting({
      providerConfig: PROVIDER_CONFIG,
      commandConfig: loadCanonicalAmoCrmCommandConfig(ROUTING_ENV),
      provider: fakeProvider(
        providerResponses({
          leadTags: {
            _embedded: {
              tags: [
                { id: tagId, name: "EVO V2 Sales" },
                { id: 8002, name: "EVO V2 Admissions" },
              ],
            },
          },
        }),
        [],
      ),
      repository: Object.freeze({
        persist: async (input) => {
          persistedHash = input.snapshot.snapshotSha256;
          return Object.freeze({
            accountId: "11111111-1111-4111-8111-111111111111",
            snapshotId: "22222222-2222-4222-8222-222222222222",
            discoveredAt: input.snapshot.discoveredAt,
          });
        },
      }),
      correlationId: `discovery-tag-hash-${tagId}`,
      now: () => new Date("2026-08-29T08:00:00.000Z"),
    });
    return { persistedHash, snapshot };
  }

  const first = await discoverWithSalesTagId(8001);
  const second = await discoverWithSalesTagId(8003);

  assert.notEqual(first.persistedHash, second.persistedHash);
  assert.equal(first.snapshot.sales.tagId, "8001");
  assert.equal(second.snapshot.sales.tagId, "8003");
});

test("missing managed tags remain bootstrap-ready while duplicate names fail closed", async () => {
  const persisted = [];
  const repository = Object.freeze({
    persist: async (input) => {
      persisted.push(input);
      return Object.freeze({
        accountId: "11111111-1111-4111-8111-111111111111",
        snapshotId: "22222222-2222-4222-8222-222222222222",
        discoveredAt: input.snapshot.discoveredAt,
      });
    },
  });
  const snapshot = await discoverCanonicalAmoCrmCommandRouting({
    providerConfig: PROVIDER_CONFIG,
    commandConfig: loadCanonicalAmoCrmCommandConfig(ROUTING_ENV),
    provider: fakeProvider(
      providerResponses({ leadTags: { _embedded: { tags: [] } } }),
      [],
    ),
    repository,
    correlationId: "discovery-missing-managed-tags",
    now: () => new Date("2026-08-29T08:00:00.000Z"),
  });

  assert.equal(snapshot.sales.tagId, null);
  assert.equal(snapshot.admissions.tagId, null);
  assert.equal(persisted.length, 1);

  await assert.rejects(
    discoverCanonicalAmoCrmCommandRouting({
      providerConfig: PROVIDER_CONFIG,
      commandConfig: loadCanonicalAmoCrmCommandConfig({
        ...ROUTING_ENV,
        EVO_V2_AMOCRM_ADMISSIONS_TAG_NAME: "EVO V2 Sales",
      }),
      provider: fakeProvider(
        providerResponses({ leadTags: { _embedded: { tags: [] } } }),
        [],
      ),
      repository,
      correlationId: "discovery-duplicate-managed-name",
      now: () => new Date("2026-08-29T08:00:00.000Z"),
    }),
    (error) => {
      assert.ok(error instanceof CanonicalAmoCrmDiscoveryError);
      assert.equal(error.code, "mapping_invalid");
      return true;
    },
  );
  assert.equal(persisted.length, 1);
});

test("fails before persistence when the provider account origin is not the configured exact account", async () => {
  const calls = [];
  let persisted = false;
  const source = providerResponses({
    account: {
      ...providerResponses().account,
      _links: {
        self: { href: "https://another.amocrm.ru/api/v4/account" },
      },
    },
  });

  await assert.rejects(
    discoverCanonicalAmoCrmCommandRouting({
      providerConfig: PROVIDER_CONFIG,
      commandConfig: loadCanonicalAmoCrmCommandConfig(ROUTING_ENV),
      provider: fakeProvider(source, calls),
      repository: Object.freeze({
        persist: async () => {
          persisted = true;
          throw new Error("must not persist");
        },
      }),
      correlationId: "discovery-mismatch",
    }),
    (error) =>
      error instanceof CanonicalAmoCrmDiscoveryError &&
      error.code === "account_mismatch" &&
      !error.message.includes("client-secret"),
  );
  assert.equal(persisted, false);
  assert.deepEqual(calls, ["account"]);
});

test("fails closed for invalid routing, duplicate tag mapping or ambiguous contact field code", async () => {
  const cases = [
    [
      "mapping_invalid",
      { ...ROUTING_ENV, EVO_V2_AMOCRM_SALES_STATUS_ID: "3002" },
      providerResponses(),
    ],
    [
      "mapping_invalid",
      ROUTING_ENV,
      providerResponses({
        users: {
          _embedded: {
            users: [
              { id: 4001, name: "Sales", rights: { is_active: false } },
              { id: 4002, name: "Admissions", rights: { is_active: true } },
            ],
          },
        },
      }),
    ],
    [
      "contact_field_mapping_invalid",
      ROUTING_ENV,
      providerResponses({
        contactCustomFields: {
          _embedded: {
            custom_fields: [
              { id: 6001, name: "Phone", code: "PHONE", type: "multitext" },
              { id: 6003, name: "Other phone", code: "PHONE", type: "multitext" },
              { id: 6002, name: "Email", code: "EMAIL", type: "multitext" },
            ],
          },
        },
      }),
    ],
    [
      "mapping_invalid",
      {
        ...ROUTING_ENV,
        EVO_V2_AMOCRM_ADMISSIONS_TAG_NAME: "EVO V2 Sales",
      },
      providerResponses(),
    ],
    [
      "mapping_invalid",
      ROUTING_ENV,
      providerResponses({
        leadTags: {
          _embedded: {
            tags: [
              { id: 8001, name: "EVO V2 Sales" },
              { id: 8002, name: "EVO V2 Sales" },
              { id: 8003, name: "EVO V2 Admissions" },
            ],
          },
        },
      }),
    ],
    [
      "provider_response_invalid",
      ROUTING_ENV,
      providerResponses({
        leadTags: {
          _embedded: {
            tags: [
              { id: 0, name: "EVO V2 Sales" },
              { id: 8002, name: "EVO V2 Admissions" },
            ],
          },
        },
      }),
    ],
  ];

  for (const [expectedCode, environment, source] of cases) {
    await assert.rejects(
      discoverCanonicalAmoCrmCommandRouting({
        providerConfig: PROVIDER_CONFIG,
        commandConfig: loadCanonicalAmoCrmCommandConfig(environment),
        provider: fakeProvider(source, []),
        repository: Object.freeze({
          persist: async () => {
            throw new Error("must not persist");
          },
        }),
        correlationId: "discovery-invalid-map",
      }),
      (error) =>
        error instanceof CanonicalAmoCrmDiscoveryError &&
        error.code === expectedCode,
    );
  }
});
