import "server-only";

const OBSERVABILITY_SECRET_NAME =
  "EVO_PLATFORM_P7B_OBSERVABILITY_SECRET" as const;
const MIN_OBSERVABILITY_SECRET_BYTES = 32;
const MAX_OBSERVABILITY_SECRET_BYTES = 128;
const MAX_SUPABASE_SECRET_BYTES = 4_096;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const SUPABASE_SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,}$/;
const PRODUCTION_SUPABASE_ORIGIN_PATTERN =
  /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/;
const LOOPBACK_SUPABASE_ORIGIN_PATTERN =
  /^http:\/\/(?:(localhost)|(127(?:\.\d{1,3}){3})|(\[::1\])):(\d{1,5})\/?$/;

export const PLATFORM_OBSERVABILITY_RPC_TIMEOUT_MS = 5_000;

type PlatformObservabilityEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type PlatformObservabilityDisabledConfig = Readonly<{
  enabled: false;
}>;

export type PlatformObservabilityEnabledConfig = Readonly<{
  enabled: true;
  observabilitySecret: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  rpcTimeoutMs: typeof PLATFORM_OBSERVABILITY_RPC_TIMEOUT_MS;
}>;

export type PlatformObservabilityConfig =
  | PlatformObservabilityDisabledConfig
  | PlatformObservabilityEnabledConfig;

export type PlatformObservabilityConfigurationErrorCode =
  | "unsafe_supabase_url"
  | "unsafe_supabase_secret_key"
  | "unsafe_observability_secret"
  | "reused_observability_secret";

export class PlatformObservabilityConfigurationError extends Error {
  readonly code: PlatformObservabilityConfigurationErrorCode;

  constructor(code: PlatformObservabilityConfigurationErrorCode) {
    super("Platform observability is not safely configured.");
    this.name = "PlatformObservabilityConfigurationError";
    this.code = code;
  }
}

function fail(code: PlatformObservabilityConfigurationErrorCode): never {
  throw new PlatformObservabilityConfigurationError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  const segments = value.split(".");
  if (segments.length !== 3 || segments[1].length === 0) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as unknown;
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function isPlatformP7BObservabilityEnabled(
  environment: PlatformObservabilityEnvironment = process.env,
): boolean {
  return environment.EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED === "1";
}

function readSupabaseOrigin(
  value: string | undefined,
  production: boolean,
): string {
  if (!value || value !== value.trim()) return fail("unsafe_supabase_url");

  const accepted = production
    ? PRODUCTION_SUPABASE_ORIGIN_PATTERN.test(value)
    : validLoopbackOrigin(value);
  if (!accepted) return fail("unsafe_supabase_url");

  try {
    const parsed = new URL(value);
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    ) {
      return fail("unsafe_supabase_url");
    }
    return parsed.origin;
  } catch {
    return fail("unsafe_supabase_url");
  }
}

function validLoopbackOrigin(value: string): boolean {
  const match = LOOPBACK_SUPABASE_ORIGIN_PATTERN.exec(value);
  if (!match) return false;

  const port = Number(match[4]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return false;

  const ipv4 = match[2];
  if (!ipv4) return true;
  const octets = ipv4.split(".").map(Number);
  return octets.length === 4 && octets[0] === 127 && octets.every((octet) => octet <= 255);
}

function readObservabilitySecret(value: string | undefined): string {
  if (!value || value !== value.trim() || ASCII_CONTROL_PATTERN.test(value)) {
    return fail("unsafe_observability_secret");
  }
  const byteLength = Buffer.byteLength(value, "utf8");
  if (
    byteLength < MIN_OBSERVABILITY_SECRET_BYTES ||
    byteLength > MAX_OBSERVABILITY_SECRET_BYTES
  ) {
    return fail("unsafe_observability_secret");
  }
  return value;
}

function isProtectedSecretName(name: string): boolean {
  if (name === OBSERVABILITY_SECRET_NAME) return false;
  if (!/(?:SECRET|KEY|TOKEN)/.test(name)) return false;
  return /(?:SUPABASE|WAHA|WHATSAPP|WEBHOOK|WORKER|AUTONOMOUS|LEAD_AGENT|^EVO_AGENT_)/.test(
    name,
  );
}

function rejectReusedSecret(
  environment: PlatformObservabilityEnvironment,
  observabilitySecret: string,
): void {
  for (const [name, value] of Object.entries(environment)) {
    if (
      isProtectedSecretName(name) &&
      value !== undefined &&
      value === observabilitySecret
    ) {
      fail("reused_observability_secret");
    }
  }
}

function readSupabaseSecretKey(value: string | undefined): string {
  if (
    !value ||
    value !== value.trim() ||
    ASCII_CONTROL_PATTERN.test(value) ||
    Buffer.byteLength(value, "utf8") > MAX_SUPABASE_SECRET_BYTES
  ) {
    return fail("unsafe_supabase_secret_key");
  }
  if (SUPABASE_SECRET_KEY_PATTERN.test(value)) return value;
  if (decodeJwtPayload(value)?.role === "service_role") return value;
  return fail("unsafe_supabase_secret_key");
}

export function loadPlatformObservabilityConfig(
  environment: PlatformObservabilityEnvironment = process.env,
): PlatformObservabilityConfig {
  if (!isPlatformP7BObservabilityEnabled(environment)) {
    return Object.freeze({ enabled: false });
  }

  const observabilitySecret = readObservabilitySecret(
    environment.EVO_PLATFORM_P7B_OBSERVABILITY_SECRET,
  );
  rejectReusedSecret(environment, observabilitySecret);

  return Object.freeze({
    enabled: true,
    observabilitySecret,
    supabaseUrl: readSupabaseOrigin(
      environment.NEXT_PUBLIC_SUPABASE_URL,
      environment.NODE_ENV === "production",
    ),
    supabaseSecretKey: readSupabaseSecretKey(
      environment.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    ),
    rpcTimeoutMs: PLATFORM_OBSERVABILITY_RPC_TIMEOUT_MS,
  });
}
