import {
  normalizePlatformAuditSearchInput,
  PlatformAuditContractError,
  type PlatformAuditSearchResult,
} from "./platform-audit.ts";
import { isPlatformP7AAuditEnabled } from "./platform-audit-config.ts";
import {
  createAuthenticatedPlatformAuditRepository,
  PlatformAuditRepositoryError,
  type PlatformAuditRepository,
} from "./platform-audit-repository.ts";

type PlatformAuditActionActor = Readonly<{
  platformRole: string;
}>;

export type PlatformAuditActionDependencies = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  requireActor(): Promise<PlatformAuditActionActor>;
  createRepository(): Promise<PlatformAuditRepository>;
}>;

export type PlatformAuditActionErrorKind =
  | "unauthorized"
  | "invalid"
  | "too_large"
  | "unavailable";

export class PlatformAuditActionError extends Error {
  readonly kind: PlatformAuditActionErrorKind;

  constructor(kind: PlatformAuditActionErrorKind) {
    super("Platform audit search failed");
    this.name = "PlatformAuditActionError";
    this.kind = kind;
  }
}

async function defaultDependencies(): Promise<PlatformAuditActionDependencies> {
  const { requirePlatformStaffActor } = await import("./platform-guards");
  return {
    env: process.env,
    requireActor: requirePlatformStaffActor,
    createRepository: createAuthenticatedPlatformAuditRepository,
  };
}

function mappedRepositoryError(
  kind: PlatformAuditRepositoryError["kind"],
): PlatformAuditActionErrorKind {
  if (kind === "unauthorized") return "unauthorized";
  if (kind === "invalid") return "invalid";
  if (kind === "too_large") return "too_large";
  return "unavailable";
}

export async function searchPlatformAudit(
  input: unknown,
  injected?: PlatformAuditActionDependencies,
): Promise<PlatformAuditSearchResult> {
  const dependencies = injected ?? (await defaultDependencies());
  if (!isPlatformP7AAuditEnabled(dependencies.env)) {
    throw new PlatformAuditActionError("unavailable");
  }
  const actor = await dependencies.requireActor();
  if (actor.platformRole !== "admin") {
    throw new PlatformAuditActionError("unauthorized");
  }

  let parsed;
  try {
    parsed = normalizePlatformAuditSearchInput(input);
  } catch (error) {
    if (error instanceof PlatformAuditContractError) {
      throw new PlatformAuditActionError("invalid");
    }
    throw new PlatformAuditActionError("unavailable");
  }

  try {
    return await (await dependencies.createRepository()).search(parsed);
  } catch (error) {
    if (error instanceof PlatformAuditRepositoryError) {
      throw new PlatformAuditActionError(mappedRepositoryError(error.kind));
    }
    throw new PlatformAuditActionError("unavailable");
  }
}
