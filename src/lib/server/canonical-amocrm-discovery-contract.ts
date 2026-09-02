import "server-only";

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
    leadTagCatalog: CanonicalAmoCrmSanitizedCatalog;
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
  snapshotSha256: string;
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
        ? "The discovered amoCRM account does not match the canonical account scope."
        : "The canonical amoCRM discovery snapshot could not be persisted.",
    );
    this.name = "CanonicalAmoCrmDiscoveryRepositoryError";
    this.code = code;
  }
}
