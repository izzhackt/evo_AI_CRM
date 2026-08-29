import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, or } from "drizzle-orm";

import {
  evoAmoCrmAccounts,
  evoAmoCrmDiscoverySnapshots,
} from "../../db/schema/index.ts";
import { getDatabase } from "./database.ts";

export type CanonicalAmoCrmDiscoveryAccountRecord = Readonly<{
  providerAccountId: string;
  accountBaseUrl: string;
  accountSubdomain: string;
  accountName: string;
  timezone: string;
  country: string | null;
}>;

export type CanonicalAmoCrmSanitizedCatalog = readonly Readonly<
  Record<string, unknown>
>[];

export type CanonicalAmoCrmDiscoveryPersistenceInput = Readonly<{
  account: CanonicalAmoCrmDiscoveryAccountRecord;
  snapshot: Readonly<{
    snapshotSha256: string;
    pipelineCatalog: CanonicalAmoCrmSanitizedCatalog;
    userCatalog: CanonicalAmoCrmSanitizedCatalog;
    leadCustomFieldCatalog: CanonicalAmoCrmSanitizedCatalog;
    contactCustomFieldCatalog: CanonicalAmoCrmSanitizedCatalog;
    correlationId: string;
    discoveredAt: Date;
  }>;
}>;

export type CanonicalAmoCrmDiscoveryPersistenceResult = Readonly<{
  accountId: string;
  snapshotId: string;
  discoveredAt: Date;
}>;

export type CanonicalAmoCrmDiscoveryRepository = Readonly<{
  persist: (
    input: CanonicalAmoCrmDiscoveryPersistenceInput,
  ) => Promise<CanonicalAmoCrmDiscoveryPersistenceResult>;
}>;

export class CanonicalAmoCrmDiscoveryRepositoryError extends Error {
  readonly code: "account_mismatch" | "persistence_failed";

  constructor(code: "account_mismatch" | "persistence_failed") {
    super(
      code === "account_mismatch"
        ? "The discovered amoCRM account does not match the canonical account row."
        : "The canonical amoCRM discovery snapshot could not be persisted.",
    );
    this.name = "CanonicalAmoCrmDiscoveryRepositoryError";
    this.code = code;
  }
}

type Database = ReturnType<typeof getDatabase>;

function mutableCatalog(
  value: CanonicalAmoCrmSanitizedCatalog,
): Array<Record<string, unknown>> {
  return structuredClone(value) as Array<Record<string, unknown>>;
}

function exactAccount(
  row: Readonly<{
    providerAccountId: string;
    accountBaseUrl: string;
    accountSubdomain: string;
  }>,
  expected: CanonicalAmoCrmDiscoveryAccountRecord,
): boolean {
  return (
    row.providerAccountId === expected.providerAccountId &&
    row.accountBaseUrl === expected.accountBaseUrl &&
    row.accountSubdomain === expected.accountSubdomain
  );
}

export function createCanonicalAmoCrmDiscoveryRepository(
  database: Database = getDatabase(),
): CanonicalAmoCrmDiscoveryRepository {
  return Object.freeze({
    persist: async (input) => {
      try {
        return await database.transaction(async (transaction) => {
          const matchingIdentityRows = async () =>
            transaction
              .select({
                id: evoAmoCrmAccounts.id,
                providerAccountId: evoAmoCrmAccounts.providerAccountId,
                accountBaseUrl: evoAmoCrmAccounts.accountBaseUrl,
                accountSubdomain: evoAmoCrmAccounts.accountSubdomain,
              })
              .from(evoAmoCrmAccounts)
              .where(
                or(
                  eq(
                    evoAmoCrmAccounts.providerAccountId,
                    input.account.providerAccountId,
                  ),
                  eq(
                    evoAmoCrmAccounts.accountBaseUrl,
                    input.account.accountBaseUrl,
                  ),
                  eq(
                    evoAmoCrmAccounts.accountSubdomain,
                    input.account.accountSubdomain,
                  ),
                ),
              );

          let accounts = await matchingIdentityRows();
          if (accounts.length === 0) {
            await transaction
              .insert(evoAmoCrmAccounts)
              .values({
                id: randomUUID(),
                provider: "amocrm",
                providerAccountId: input.account.providerAccountId,
                accountBaseUrl: input.account.accountBaseUrl,
                accountSubdomain: input.account.accountSubdomain,
                accountName: input.account.accountName,
                timezone: input.account.timezone,
                country: input.account.country,
                version: 1,
              })
              .onConflictDoNothing();
            accounts = await matchingIdentityRows();
          }

          if (
            accounts.length !== 1 ||
            !exactAccount(accounts[0]!, input.account)
          ) {
            throw new CanonicalAmoCrmDiscoveryRepositoryError(
              "account_mismatch",
            );
          }

          const accountId = accounts[0]!.id;
          await transaction
            .update(evoAmoCrmAccounts)
            .set({
              accountName: input.account.accountName,
              timezone: input.account.timezone,
              country: input.account.country,
              updatedAt: input.snapshot.discoveredAt,
            })
            .where(eq(evoAmoCrmAccounts.id, accountId));

          await transaction
            .insert(evoAmoCrmDiscoverySnapshots)
            .values({
              id: randomUUID(),
              accountId,
              snapshotSha256: input.snapshot.snapshotSha256,
              pipelineCatalog: mutableCatalog(input.snapshot.pipelineCatalog),
              userCatalog: mutableCatalog(input.snapshot.userCatalog),
              leadCustomFieldCatalog: mutableCatalog(
                input.snapshot.leadCustomFieldCatalog,
              ),
              contactCustomFieldCatalog: mutableCatalog(
                input.snapshot.contactCustomFieldCatalog,
              ),
              redactionVersion: 1,
              correlationId: input.snapshot.correlationId,
              discoveredAt: input.snapshot.discoveredAt,
            })
            .onConflictDoNothing({
              target: [
                evoAmoCrmDiscoverySnapshots.accountId,
                evoAmoCrmDiscoverySnapshots.snapshotSha256,
              ],
            });

          const matchingSnapshots = await transaction
            .select({
              id: evoAmoCrmDiscoverySnapshots.id,
              discoveredAt: evoAmoCrmDiscoverySnapshots.discoveredAt,
            })
            .from(evoAmoCrmDiscoverySnapshots)
            .where(
              and(
                eq(evoAmoCrmDiscoverySnapshots.accountId, accountId),
                eq(
                  evoAmoCrmDiscoverySnapshots.snapshotSha256,
                  input.snapshot.snapshotSha256,
                ),
              ),
            );
          if (matchingSnapshots.length !== 1) {
            throw new CanonicalAmoCrmDiscoveryRepositoryError(
              "persistence_failed",
            );
          }

          return Object.freeze({
            accountId,
            snapshotId: matchingSnapshots[0]!.id,
            discoveredAt: new Date(
              matchingSnapshots[0]!.discoveredAt.getTime(),
            ),
          });
        });
      } catch (error) {
        if (error instanceof CanonicalAmoCrmDiscoveryRepositoryError) {
          throw error;
        }
        throw new CanonicalAmoCrmDiscoveryRepositoryError("persistence_failed");
      }
    },
  });
}
