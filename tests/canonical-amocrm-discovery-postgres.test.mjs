import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

import {
  CanonicalAmoCrmDiscoveryRepositoryError,
  createCanonicalAmoCrmDiscoveryRepository,
} from "../src/lib/server/canonical-amocrm-discovery-repository.ts";
import { closeDatabaseConnections } from "../src/lib/server/database.ts";

function requiredDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  assert.ok(value, "DATABASE_URL is required for amoCRM discovery acceptance");
  const parsed = new URL(value);
  assert.ok(
    parsed.protocol === "postgres:" || parsed.protocol === "postgresql:",
    "amoCRM discovery acceptance requires PostgreSQL",
  );
  return value;
}

test("discovery repository keeps one exact account and one idempotent sanitized snapshot", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 2,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  const suffix = runId.replaceAll("-", "").slice(0, 12);
  const providerAccountId = String(
    100_000_000 + Number.parseInt(suffix.slice(0, 7), 16),
  );
  const snapshotSha256 = createHash("sha256").update(runId).digest("hex");
  const repository = createCanonicalAmoCrmDiscoveryRepository();
  const account = Object.freeze({
    providerAccountId,
    accountBaseUrl: `https://discovery-${suffix}.amocrm.ru`,
    accountSubdomain: `discovery-${suffix}`,
    accountName: "EVO discovery acceptance",
    timezone: "Asia/Dubai",
    country: "AE",
  });
  const input = Object.freeze({
    account,
    snapshot: Object.freeze({
      snapshotSha256,
      pipelineCatalog: Object.freeze([
        Object.freeze({ id: "2001", name: "Sales", statuses: [] }),
      ]),
      userCatalog: Object.freeze([
        Object.freeze({ id: "4001", name: "Sales", isActive: true }),
      ]),
      leadCustomFieldCatalog: Object.freeze([]),
      contactCustomFieldCatalog: Object.freeze([
        Object.freeze({ id: "6001", code: "PHONE" }),
        Object.freeze({ id: "6002", code: "EMAIL" }),
      ]),
      correlationId: `amocrm-discovery-${runId}`,
      discoveredAt: new Date("2026-08-29T08:00:00.000Z"),
    }),
  });

  try {
    const first = await repository.persist(input);
    const replay = await repository.persist(input);

    assert.deepEqual(replay, first);
    const accounts = await sql`
      select provider_account_id, account_base_url, account_subdomain
      from evo_amocrm_accounts
      where provider_account_id = ${providerAccountId}
    `;
    const snapshots = await sql`
      select snapshot_sha256, pipeline_catalog, user_catalog,
             lead_custom_field_catalog, contact_custom_field_catalog
      from evo_amocrm_discovery_snapshots
      where account_id = ${first.accountId}
    `;
    assert.equal(accounts.length, 1);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].snapshot_sha256, snapshotSha256);
    assert.equal(JSON.stringify(snapshots[0]).includes("token"), false);

    await assert.rejects(
      repository.persist({
        ...input,
        account: {
          ...account,
          accountBaseUrl: `https://wrong-${suffix}.amocrm.ru`,
          accountSubdomain: `wrong-${suffix}`,
        },
      }),
      (error) =>
        error instanceof CanonicalAmoCrmDiscoveryRepositoryError &&
        error.code === "account_mismatch",
    );

    const accountCount = await sql`
      select count(*)::int as count
      from evo_amocrm_accounts
      where provider_account_id = ${providerAccountId}
    `;
    assert.equal(accountCount[0].count, 1);
  } finally {
    await closeDatabaseConnections();
    await sql`
      delete from evo_amocrm_discovery_snapshots
      where account_id in (
        select id from evo_amocrm_accounts
        where provider_account_id = ${providerAccountId}
      )
    `;
    await sql`
      delete from evo_amocrm_accounts
      where provider_account_id = ${providerAccountId}
    `;
    await sql.end({ timeout: 5 });
  }
});
