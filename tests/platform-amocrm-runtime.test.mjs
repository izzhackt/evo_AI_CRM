import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {};" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  PlatformAmoCrmRuntimeResolutionError,
  resolvePlatformAmoCrmRuntime,
} = await import("../src/lib/server/platform-amocrm-runtime.ts");

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const READY_CONFIG = Object.freeze({
  status: "ready",
  accountDomain: "evo-admissions.amocrm.ru",
  accountOrigin: "https://evo-admissions.amocrm.ru",
  accountSubdomain: "evo-admissions",
  tokenFilePath: "/private/token.json",
  timeoutMs: 10_000,
  maxResponseBytes: 262_144,
  requestIntervalMs: 150,
});
const COMMAND_CONFIG = Object.freeze({
  sales: Object.freeze({
    pipelineId: "1",
    statusId: "2",
    responsibleUserId: "3",
    tagName: "Sales",
  }),
  admissions: Object.freeze({
    pipelineId: "4",
    statusId: "5",
    responsibleUserId: "6",
    tagName: "Admissions",
  }),
});
const ROUTING = Object.freeze({
  canonicalAccountId: ORGANIZATION_ID,
  discoverySnapshotId: "33333333-3333-4333-8333-333333333333",
  providerAccountId: "1001",
  accountBaseUrl: READY_CONFIG.accountOrigin,
  snapshotSha256: "a".repeat(64),
  discoveredAt: "2026-09-02T10:00:00.000Z",
  sales: Object.freeze({
    ...COMMAND_CONFIG.sales,
    tagId: "7",
  }),
  admissions: Object.freeze({
    ...COMMAND_CONFIG.admissions,
    tagId: "8",
  }),
  contactCustomFields: Object.freeze({
    phoneFieldId: "9",
    emailFieldId: "10",
  }),
});

test("builds one real-provider runtime and persists discovery under the exact organization", async () => {
  const calls = [];
  const readProvider = Object.freeze({ kind: "read" });
  const writeProvider = Object.freeze({ kind: "write" });
  const repository = Object.freeze({ persist: async () => { throw new Error("unused"); } });

  const result = await resolvePlatformAmoCrmRuntime(
    {
      organizationId: ORGANIZATION_ID,
      actorRole: "sales",
      correlationId: REQUEST_ID,
    },
    {
      loadProviderConfig: () => {
        calls.push("provider-config");
        return READY_CONFIG;
      },
      loadCommandConfig: () => {
        calls.push("command-config");
        return COMMAND_CONFIG;
      },
      createReadProvider: (config) => {
        assert.equal(config, READY_CONFIG);
        calls.push("read-provider");
        return readProvider;
      },
      createWriteProvider: (config) => {
        assert.equal(config, READY_CONFIG);
        calls.push("write-provider");
        return writeProvider;
      },
      createDiscoveryRepository: (organizationId) => {
        assert.equal(organizationId, ORGANIZATION_ID);
        calls.push("repository");
        return repository;
      },
      discoverRouting: async (input) => {
        calls.push("discover-and-persist");
        assert.equal(input.provider, readProvider);
        assert.equal(input.repository, repository);
        assert.equal(input.providerConfig, READY_CONFIG);
        assert.equal(input.commandConfig, COMMAND_CONFIG);
        assert.equal(input.correlationId, REQUEST_ID);
        return ROUTING;
      },
    },
  );

  assert.deepEqual(calls, [
    "provider-config",
    "command-config",
    "read-provider",
    "repository",
    "discover-and-persist",
    "write-provider",
  ]);
  assert.equal(result.provider, writeProvider);
  assert.equal(result.routing, ROUTING);
});

test("blocked provider configuration fails before discovery or write-provider creation", async () => {
  let sideEffects = 0;
  await assert.rejects(
    resolvePlatformAmoCrmRuntime(
      {
        organizationId: ORGANIZATION_ID,
        actorRole: "admin",
        correlationId: REQUEST_ID,
      },
      {
        loadProviderConfig: () => ({
          status: "blocked",
          reason: "configuration_missing",
        }),
        loadCommandConfig: () => {
          sideEffects += 1;
          return COMMAND_CONFIG;
        },
        createDiscoveryRepository: () => {
          sideEffects += 1;
          return {};
        },
      },
    ),
    (error) =>
      error instanceof PlatformAmoCrmRuntimeResolutionError &&
      error.code === "provider_configuration_invalid",
  );
  assert.equal(sideEffects, 0);
});

test("discovery failures expose one safe fail-closed reason without fallback", async () => {
  let discoveryCalls = 0;
  await assert.rejects(
    resolvePlatformAmoCrmRuntime(
      {
        organizationId: ORGANIZATION_ID,
        actorRole: "admissions",
        correlationId: REQUEST_ID,
      },
      {
        loadProviderConfig: () => READY_CONFIG,
        loadCommandConfig: () => COMMAND_CONFIG,
        createReadProvider: () => ({}),
        createWriteProvider: () => {
          throw new Error("must not construct after failed discovery");
        },
        createDiscoveryRepository: () => ({}),
        discoverRouting: async () => {
          discoveryCalls += 1;
          throw new Error("secret provider response");
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof PlatformAmoCrmRuntimeResolutionError);
      assert.equal(error.code, "provider_discovery_failed");
      assert.equal(error.message.includes("secret provider response"), false);
      return true;
    },
  );
  assert.equal(discoveryCalls, 1);
});

test("invalid authority identifiers fail before configuration or provider access", async () => {
  let calls = 0;
  await assert.rejects(
    resolvePlatformAmoCrmRuntime(
      {
        organizationId: "wrong-org",
        actorRole: "sales",
        correlationId: REQUEST_ID,
      },
      {
        loadProviderConfig: () => {
          calls += 1;
          return READY_CONFIG;
        },
      },
    ),
    (error) =>
      error instanceof PlatformAmoCrmRuntimeResolutionError &&
      error.code === "provider_configuration_invalid",
  );
  assert.equal(calls, 0);
});
