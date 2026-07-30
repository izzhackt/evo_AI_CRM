export type SupabasePublicConfig = Readonly<{
  url: string;
  publishableKey: string;
}>;

export type SupabaseConfigurationErrorCode =
  | "missing_url"
  | "invalid_url"
  | "insecure_url"
  | "missing_publishable_key"
  | "unsafe_publishable_key";

export class SupabaseConfigurationError extends Error {
  readonly code: SupabaseConfigurationErrorCode;

  constructor(code: SupabaseConfigurationErrorCode, message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  const segments = value.split(".");
  if (segments.length !== 3 || segments[1].length === 0) return null;

  try {
    const encoded = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    if (encoded.length % 4 === 1) return null;

    const padding = "=".repeat((4 - (encoded.length % 4)) % 4);
    const payload = JSON.parse(globalThis.atob(`${encoded}${padding}`)) as unknown;
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function validatePublishableKey(rawValue: string | undefined): string {
  if (rawValue === undefined || rawValue.length === 0) {
    throw new SupabaseConfigurationError(
      "missing_publishable_key",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be configured.",
    );
  }

  const value = rawValue.trim();
  if (value.length === 0 || value !== rawValue) {
    throw new SupabaseConfigurationError(
      "unsafe_publishable_key",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is malformed.",
    );
  }

  if (value.startsWith("sb_secret_")) {
    throw new SupabaseConfigurationError(
      "unsafe_publishable_key",
      "A Supabase secret key cannot be exposed to the browser.",
    );
  }

  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) {
    return value;
  }

  // Local Supabase and older projects can still expose the legacy anon JWT.
  // It is a publishable credential, but only when its embedded role is `anon`.
  const jwtPayload = decodeJwtPayload(value);
  if (jwtPayload?.role === "service_role") {
    throw new SupabaseConfigurationError(
      "unsafe_publishable_key",
      "A Supabase service_role JWT cannot be exposed to the browser.",
    );
  }
  if (jwtPayload?.role === "anon") {
    return value;
  }

  throw new SupabaseConfigurationError(
    "unsafe_publishable_key",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not a recognized publishable key.",
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "[::1]"
  ) {
    return true;
  }

  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  );
}

function validateSupabaseUrl(rawValue: string | undefined): string {
  if (rawValue === undefined || rawValue.length === 0) {
    throw new SupabaseConfigurationError(
      "missing_url",
      "NEXT_PUBLIC_SUPABASE_URL must be configured.",
    );
  }

  const value = rawValue.trim();
  if (value.length === 0 || value !== rawValue) {
    throw new SupabaseConfigurationError(
      "invalid_url",
      "NEXT_PUBLIC_SUPABASE_URL is malformed.",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SupabaseConfigurationError(
      "invalid_url",
      "NEXT_PUBLIC_SUPABASE_URL must be an absolute URL.",
    );
  }

  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new SupabaseConfigurationError(
      "invalid_url",
      "NEXT_PUBLIC_SUPABASE_URL must contain only the Supabase origin.",
    );
  }

  if (url.protocol === "https:") {
    return url.origin;
  }

  if (
    url.protocol === "http:" &&
    process.env.NODE_ENV !== "production" &&
    isLoopbackHostname(url.hostname)
  ) {
    return url.origin;
  }

  throw new SupabaseConfigurationError(
    "insecure_url",
    "NEXT_PUBLIC_SUPABASE_URL must use HTTPS; HTTP is allowed only for loopback development.",
  );
}

/**
 * Reads and validates public Supabase configuration only when a client is
 * requested. Server-only credentials are deliberately not accepted here.
 */
export function getSupabasePublicConfig(): SupabasePublicConfig {
  return Object.freeze({
    url: validateSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey: validatePublishableKey(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  });
}
