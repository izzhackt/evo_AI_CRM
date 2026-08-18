import "server-only";

import { getPlatformWahaBackendConfig } from "./platform-waha-ingress-config.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export type PlatformLeadAgentSyncConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      organizationId: string;
      supabaseUrl: string;
      supabaseSecretKey: string;
      intakeSalesMembershipId: string;
    }>;

export class PlatformLeadAgentSyncConfigurationError extends Error {
  constructor() {
    super("Platform Lead-Agent sync is not configured.");
    this.name = "PlatformLeadAgentSyncConfigurationError";
  }
}

function fail(): never {
  throw new PlatformLeadAgentSyncConfigurationError();
}

function enabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  return fail();
}

function membershipId(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== NIL_UUID && UUID_PATTERN.test(normalized)
    ? normalized
    : fail();
}

export function loadPlatformLeadAgentSyncConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformLeadAgentSyncConfig {
  if (!enabled(environment.EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED)) {
    return Object.freeze({ enabled: false });
  }
  try {
    const backend = getPlatformWahaBackendConfig(environment);
    return Object.freeze({
      enabled: true,
      organizationId: backend.organizationId,
      supabaseUrl: backend.supabaseUrl,
      supabaseSecretKey: backend.supabaseSecretKey,
      intakeSalesMembershipId: membershipId(
        environment.EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID,
      ),
    });
  } catch {
    return fail();
  }
}
