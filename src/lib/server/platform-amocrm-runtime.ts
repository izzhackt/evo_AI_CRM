import "server-only";

import {
  loadCanonicalAmoCrmCommandConfig,
  type CanonicalAmoCrmCommandConfig,
} from "./canonical-amocrm-command-config.ts";
import {
  discoverCanonicalAmoCrmCommandRouting,
  type CanonicalAmoCrmCommandRoutingSnapshot,
} from "./canonical-amocrm-discovery-service.ts";
import {
  createCanonicalAmoCrmReadProvider,
  createCanonicalAmoCrmWriteProvider,
  type CanonicalAmoCrmReadProvider,
  type CanonicalAmoCrmWriteProvider,
} from "./canonical-amocrm-provider.ts";
import {
  loadCanonicalAmoCrmProviderConfig,
  type CanonicalAmoCrmProviderConfig,
} from "./canonical-amocrm-provider-config.ts";
import {
  type CanonicalAmoCrmDiscoveryRepository,
} from "./canonical-amocrm-discovery-contract.ts";
import { createPlatformAmoCrmDiscoveryRepository } from "./platform-amocrm-discovery-repository.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type ReadyProviderConfig = Extract<
  CanonicalAmoCrmProviderConfig,
  Readonly<{ status: "ready" }>
>;

export type PlatformAmoCrmRuntime = Readonly<{
  provider: CanonicalAmoCrmWriteProvider;
  routing: CanonicalAmoCrmCommandRoutingSnapshot;
}>;

export type ResolvePlatformAmoCrmRuntimeInput = Readonly<{
  organizationId: string;
  actorRole: "admin" | "sales" | "admissions";
  correlationId: string;
}>;

export type PlatformAmoCrmRuntimeDependencies = Readonly<{
  loadProviderConfig?: () => CanonicalAmoCrmProviderConfig;
  loadCommandConfig?: () => CanonicalAmoCrmCommandConfig;
  createReadProvider?: (config: ReadyProviderConfig) => CanonicalAmoCrmReadProvider;
  createWriteProvider?: (config: ReadyProviderConfig) => CanonicalAmoCrmWriteProvider;
  createDiscoveryRepository?: (
    organizationId: string,
  ) => CanonicalAmoCrmDiscoveryRepository;
  discoverRouting?: typeof discoverCanonicalAmoCrmCommandRouting;
  now?: () => Date;
}>;

export type PlatformAmoCrmRuntimeResolutionErrorCode =
  | "provider_configuration_invalid"
  | "provider_discovery_failed";

export class PlatformAmoCrmRuntimeResolutionError extends Error {
  readonly code: PlatformAmoCrmRuntimeResolutionErrorCode;

  constructor(code: PlatformAmoCrmRuntimeResolutionErrorCode) {
    super(code);
    this.name = "PlatformAmoCrmRuntimeResolutionError";
    this.code = code;
  }
}

function uuid(value: string): string {
  const normalized = value.toLowerCase();
  if (value !== normalized || !UUID_PATTERN.test(normalized)) {
    throw new PlatformAmoCrmRuntimeResolutionError(
      "provider_configuration_invalid",
    );
  }
  return normalized;
}

export async function resolvePlatformAmoCrmRuntime(
  input: ResolvePlatformAmoCrmRuntimeInput,
  overrides: PlatformAmoCrmRuntimeDependencies = {},
): Promise<PlatformAmoCrmRuntime> {
  const organizationId = uuid(input.organizationId);
  const correlationId = uuid(input.correlationId);
  const loadProviderConfig =
    overrides.loadProviderConfig ?? (() => loadCanonicalAmoCrmProviderConfig());
  const loadCommandConfig =
    overrides.loadCommandConfig ?? (() => loadCanonicalAmoCrmCommandConfig());
  const createReadProvider =
    overrides.createReadProvider ?? createCanonicalAmoCrmReadProvider;
  const createWriteProvider =
    overrides.createWriteProvider ?? createCanonicalAmoCrmWriteProvider;
  const createDiscoveryRepository =
    overrides.createDiscoveryRepository ??
    ((scope: string) =>
      createPlatformAmoCrmDiscoveryRepository({ organizationId: scope }));
  const discoverRouting =
    overrides.discoverRouting ?? discoverCanonicalAmoCrmCommandRouting;

  try {
    const providerConfig = loadProviderConfig();
    if (providerConfig.status !== "ready") {
      throw new PlatformAmoCrmRuntimeResolutionError(
        "provider_configuration_invalid",
      );
    }
    const commandConfig = loadCommandConfig();
    const readProvider = createReadProvider(providerConfig);
    const repository = createDiscoveryRepository(organizationId);
    const routing = await discoverRouting({
      providerConfig,
      commandConfig,
      provider: readProvider,
      repository,
      correlationId,
      now: overrides.now,
    });
    return Object.freeze({
      provider: createWriteProvider(providerConfig),
      routing,
    });
  } catch (error) {
    if (error instanceof PlatformAmoCrmRuntimeResolutionError) throw error;
    throw new PlatformAmoCrmRuntimeResolutionError("provider_discovery_failed");
  }
}
