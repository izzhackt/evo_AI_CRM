import "server-only";

import {
  getPlatformWahaIngressConfig,
  PlatformWahaIngressConfigurationError,
  type PlatformWahaIngressConfig,
  type PlatformWahaIngressEnabledConfig,
} from "./platform-waha-ingress-config.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const MIN_TRIGGER_SECRET_BYTES = 32;
const MAX_TRIGGER_SECRET_BYTES = 4096;

export const PLATFORM_WAHA_WORKER_REF =
  "nextjs:p5b-waha-projection" as const;
export const PLATFORM_WAHA_WORKER_VISIBILITY_TIMEOUT_SECONDS = 60;
export const PLATFORM_WAHA_WORKER_RETRY_DELAY_SECONDS = 30;

export type PlatformWahaWorkerDisabledConfig = Readonly<{
  enabled: false;
}>;

export type PlatformWahaWorkerEnabledConfig = Readonly<{
  enabled: true;
  organizationId: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  intakeSalesMembershipId: string;
  triggerSecret: string;
  workerRef: typeof PLATFORM_WAHA_WORKER_REF;
  visibilityTimeoutSeconds: number;
  retryDelaySeconds: number;
}>;

export type PlatformWahaWorkerConfig =
  | PlatformWahaWorkerDisabledConfig
  | PlatformWahaWorkerEnabledConfig;

export type PlatformWahaWorkerConfigurationErrorCode =
  | "invalid_enabled_flag"
  | "ingress_not_configured"
  | "missing_sales_membership_id"
  | "invalid_sales_membership_id"
  | "missing_trigger_secret"
  | "unsafe_trigger_secret";

export class PlatformWahaWorkerConfigurationError extends Error {
  readonly code: PlatformWahaWorkerConfigurationErrorCode;

  constructor(code: PlatformWahaWorkerConfigurationErrorCode) {
    super("Platform WAHA work processor is not configured.");
    this.name = "PlatformWahaWorkerConfigurationError";
    this.code = code;
  }
}

function invalidConfiguration(
  code: PlatformWahaWorkerConfigurationErrorCode,
): never {
  throw new PlatformWahaWorkerConfigurationError(code);
}

function readEnabledFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value === "false") {
    return false;
  }
  if (value === "1" || value === "true") return true;
  return invalidConfiguration("invalid_enabled_flag");
}

function readMembershipId(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_sales_membership_id");
  }
  if (value !== value.trim() || !UUID_PATTERN.test(value)) {
    return invalidConfiguration("invalid_sales_membership_id");
  }

  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) {
    return invalidConfiguration("invalid_sales_membership_id");
  }
  return normalized;
}

function readTriggerSecret(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return invalidConfiguration("missing_trigger_secret");
  }
  if (value !== value.trim()) {
    return invalidConfiguration("unsafe_trigger_secret");
  }

  const byteLength = Buffer.byteLength(value, "utf8");
  if (
    byteLength < MIN_TRIGGER_SECRET_BYTES ||
    byteLength > MAX_TRIGGER_SECRET_BYTES
  ) {
    return invalidConfiguration("unsafe_trigger_secret");
  }
  return value;
}

function requireEnabledIngress(
  environment: NodeJS.ProcessEnv,
): PlatformWahaIngressEnabledConfig {
  let ingress: PlatformWahaIngressConfig;
  try {
    ingress = getPlatformWahaIngressConfig(environment);
  } catch (error) {
    if (error instanceof PlatformWahaIngressConfigurationError) {
      return invalidConfiguration("ingress_not_configured");
    }
    throw error;
  }
  if (!ingress.enabled) return invalidConfiguration("ingress_not_configured");
  return ingress;
}

export function loadPlatformWahaWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformWahaWorkerConfig {
  if (!readEnabledFlag(environment.EVO_PLATFORM_WAHA_WORKER_ENABLED)) {
    return Object.freeze({ enabled: false });
  }

  const ingress = requireEnabledIngress(environment);

  return Object.freeze({
    enabled: true,
    organizationId: ingress.organizationId,
    supabaseUrl: ingress.supabaseUrl,
    supabaseSecretKey: ingress.supabaseSecretKey,
    intakeSalesMembershipId: readMembershipId(
      environment.EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID,
    ),
    triggerSecret: readTriggerSecret(
      environment.EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET,
    ),
    workerRef: PLATFORM_WAHA_WORKER_REF,
    visibilityTimeoutSeconds:
      PLATFORM_WAHA_WORKER_VISIBILITY_TIMEOUT_SECONDS,
    retryDelaySeconds: PLATFORM_WAHA_WORKER_RETRY_DELAY_SECONDS,
  });
}
