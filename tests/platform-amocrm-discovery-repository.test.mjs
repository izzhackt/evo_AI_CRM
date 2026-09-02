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
  CanonicalAmoCrmDiscoveryRepositoryError,
} = await import("../src/lib/server/canonical-amocrm-discovery-contract.ts");
const {
  createPlatformAmoCrmDiscoveryRepository,
} = await import("../src/lib/server/platform-amocrm-discovery-repository.ts");

const IDS = Object.freeze({
  organization: "11111111-1111-4111-8111-111111111111",
  request: "22222222-2222-4222-8222-222222222222",
  snapshot: "33333333-3333-4333-8333-333333333333",
});

function persistenceInput(overrides = {}) {
  return {
    account: {
      providerAccountId: "1001",
      accountBaseUrl: "https://evo-admissions.amocrm.ru",
      accountSubdomain: "evo-admissions",
      accountName: "EVO Admissions",
      timezone: "Asia/Bishkek",
      country: "KG",
    },
    snapshot: {
      snapshotSha256: "a".repeat(64),
      pipelineCatalog: [
        {
          id: "2001",
          name: "Sales",
          isMain: true,
          isArchive: false,
          statuses: [
            {
              id: "3001",
              name: "Qualified",
              sort: 10,
              type: 0,
              isEditable: true,
            },
          ],
        },
      ],
      leadTagCatalog: [
        { id: "4001", name: "EVO V2 Sales" },
        { id: "4002", name: "EVO V2 Admissions" },
      ],
      userCatalog: [{ id: "5001", name: "Operator", isActive: true }],
      leadCustomFieldCatalog: [
        { id: "6001", name: "Program", code: null, type: "text", enums: [] },
      ],
      contactCustomFieldCatalog: [
        { id: "7001", name: "Phone", code: "PHONE", type: "multitext", enums: [] },
        { id: "7002", name: "Email", code: "EMAIL", type: "multitext", enums: [] },
      ],
      correlationId: IDS.request,
      discoveredAt: new Date("2026-09-02T10:00:00.000Z"),
    },
    ...overrides,
  };
}

function successfulClient(calls, mutateRow = (row) => row) {
  return {
    schema(schema) {
      calls.push(["schema", schema]);
      return {
        async rpc(name, args) {
          calls.push(["rpc", name, args]);
          return {
            error: null,
            data: [
              mutateRow({
                discovery_version_id: IDS.snapshot,
                organization_id: args.p_organization_id,
                amocrm_account_id: args.p_amocrm_account_id,
                account_domain: args.p_account_domain,
                account_subdomain: args.p_account_subdomain,
                version: 1,
                snapshot_schema_version: 2,
                sanitized_snapshot: args.p_sanitized_snapshot,
                snapshot_sha256: "b".repeat(64),
                evidence_kind: args.p_evidence_kind,
                evidence_ref: args.p_evidence_ref,
                request_id: args.p_request_id,
                discovered_at: args.p_discovered_at,
                created_at: args.p_discovered_at,
              }),
            ],
          };
        },
      };
    },
  };
}

test("persists one complete schema-v2 snapshot through the service-only Supabase RPC", async () => {
  const calls = [];
  const repository = createPlatformAmoCrmDiscoveryRepository({
    organizationId: IDS.organization,
    client: successfulClient(calls),
  });
  const result = await repository.persist(persistenceInput());

  assert.equal(calls[0][1], "platform");
  assert.equal(calls[1][1], "persist_amocrm_mapping_discovery");
  const args = calls[1][2];
  assert.deepEqual(Object.keys(args).sort(), [
    "p_account_domain",
    "p_account_subdomain",
    "p_amocrm_account_id",
    "p_discovered_at",
    "p_evidence_kind",
    "p_evidence_ref",
    "p_organization_id",
    "p_request_id",
    "p_sanitized_snapshot",
  ]);
  assert.equal(args.p_sanitized_snapshot.schema_version, 2);
  assert.deepEqual(args.p_sanitized_snapshot.lead_tags, [
    { id: "4001", name: "EVO V2 Sales" },
    { id: "4002", name: "EVO V2 Admissions" },
  ]);
  assert.deepEqual(args.p_sanitized_snapshot.account, {
    id: "1001",
    domain: "evo-admissions.amocrm.ru",
    subdomain: "evo-admissions",
    name: "EVO Admissions",
    timezone: "Asia/Bishkek",
    country: "KG",
  });
  assert.equal(
    args.p_evidence_ref,
    `provider:amocrm:api-v4:routing-v2:${"a".repeat(64)}`,
  );
  assert.deepEqual(result, {
    accountId: IDS.organization,
    snapshotId: IDS.snapshot,
    snapshotSha256: "b".repeat(64),
    discoveredAt: new Date("2026-09-02T10:00:00.000Z"),
  });
  assert.notEqual(result.snapshotSha256, "a".repeat(64));
});

test("fails closed without a second call when Supabase rejects persistence", async () => {
  let calls = 0;
  const repository = createPlatformAmoCrmDiscoveryRepository({
    organizationId: IDS.organization,
    client: {
      schema() {
        return {
          async rpc() {
            calls += 1;
            return { data: null, error: { message: "private database detail" } };
          },
        };
      },
    },
  });

  await assert.rejects(repository.persist(persistenceInput()), (error) => {
    assert.ok(error instanceof CanonicalAmoCrmDiscoveryRepositoryError);
    assert.equal(error.code, "persistence_failed");
    assert.equal(error.message.includes("private database detail"), false);
    return true;
  });
  assert.equal(calls, 1);
});

test("rejects response-shape or authority drift instead of trusting a cast", async () => {
  const repository = createPlatformAmoCrmDiscoveryRepository({
    organizationId: IDS.organization,
    client: successfulClient([], (row) => ({
      ...row,
      organization_id: "44444444-4444-4444-8444-444444444444",
    })),
  });
  await assert.rejects(
    repository.persist(persistenceInput()),
    (error) =>
      error instanceof CanonicalAmoCrmDiscoveryRepositoryError &&
      error.code === "persistence_failed",
  );
});

test("rejects non-UUID scope before constructing any runtime path", () => {
  let clientTouched = false;
  assert.throws(
    () =>
      createPlatformAmoCrmDiscoveryRepository({
        organizationId: "not-an-organization",
        client: {
          schema() {
            clientTouched = true;
            throw new Error("must not run");
          },
        },
      }),
    (error) =>
      error instanceof CanonicalAmoCrmDiscoveryRepositoryError &&
      error.code === "persistence_failed",
  );
  assert.equal(clientTouched, false);
});
