import "server-only";

const SUPABASE_SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,}$/;
const MAX_SECRET_BYTES = 4096;

export type PlatformSupabaseBackendConfig = Readonly<{
  supabaseUrl: string;
  supabaseSecretKey: string;
}>;

export type PlatformSupabaseBackendConfigurationErrorCode =
  | "missing_supabase_url"
  | "invalid_supabase_url"
  | "insecure_supabase_url"
  | "missing_supabase_secret_key"
  | "unsafe_supabase_secret_key";

export class PlatformSupabaseBackendConfigurationError extends Error {
  readonly code: PlatformSupabaseBackendConfigurationErrorCode;

  constructor(code: PlatformSupabaseBackendConfigurationErrorCode) {
    super("Platform Supabase backend is not configured.");
    this.name = "PlatformSupabaseBackendConfigurationError";
    this.code = code;
  }
}

function invalidConfiguration(
  code: PlatformSupabaseBackendConfigurationErrorCode,
): never {
  throw new PlatformSupabaseBackendConfigurationError(code);
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

function readSupabaseUrl(value: string | undefined): string {
  if (!value) return invalidConfiguration("missing_supabase_url");
  if (value !== value.trim() || Buffer.byteLength(value, "utf8") > 2048) {
    return invalidConfiguration("invalid_supabase_url");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidConfiguration("invalid_supabase_url");
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    return invalidConfiguration("invalid_supabase_url");
  }

  const loopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) {
    return invalidConfiguration("insecure_supabase_url");
  }
  return parsed.origin;
}

function readSupabaseSecretKey(value: string | undefined): string {
  if (!value) return invalidConfiguration("missing_supabase_secret_key");
  if (
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES
  ) {
    return invalidConfiguration("unsafe_supabase_secret_key");
  }
  if (SUPABASE_SECRET_KEY_PATTERN.test(value)) return value;
  if (decodeJwtPayload(value)?.role === "service_role") return value;
  return invalidConfiguration("unsafe_supabase_secret_key");
}

export function getPlatformSupabaseBackendConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformSupabaseBackendConfig {
  return Object.freeze({
    supabaseUrl: readSupabaseUrl(environment.NEXT_PUBLIC_SUPABASE_URL),
    supabaseSecretKey: readSupabaseSecretKey(
      environment.EVO_PLATFORM_SUPABASE_SECRET_KEY,
    ),
  });
}
