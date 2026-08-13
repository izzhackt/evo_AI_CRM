const ASCII_CONTROL = /[\u0000-\u001f\u007f]/;
const PRODUCTION_SUPABASE_ORIGIN = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/;
const LOOPBACK_HTTP_ORIGIN =
  /^http:\/\/(localhost|127\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})|\[::1\]):([1-9]\d{0,4})\/?$/;

const DISTINCT_SECRET_ENV_NAMES = [
  'EVO_PLATFORM_P7B_OBSERVABILITY_SECRET',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'EVO_PLATFORM_SUPABASE_SECRET_KEY',
  'EVO_INBOX_WAHA_API_KEY',
  'EVO_INBOX_WAHA_WEBHOOK_HMAC',
  'META_APP_SECRET',
  'WAHA_API_KEY',
  'AUTOMATION_CRON_SECRET',
  'EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET',
  'EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET',
  'EVO_PLATFORM_WAHA_HISTORY_API_KEY',
  'EVO_PLATFORM_WAHA_HISTORY_TRIGGER_SECRET',
  'EVO_PLATFORM_WAHA_MEDIA_API_KEY',
  'EVO_PLATFORM_WAHA_MEDIA_TRIGGER_SECRET',
  'EVO_PLATFORM_AUTONOMOUS_REPLIES_TRIGGER_SECRET',
  'EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_API_KEY',
  'EVO_PLATFORM_GEMINI_PROPOSAL_HMAC_SECRET',
  'EVO_PLATFORM_P6C_OVERDUE_TRIGGER_SECRET',
  'EVO_LEAD_AGENT_SYNC_SECRET',
  'EVO_AGENT_ADMIN_API_KEY',
  'EVO_AGENT_CRM_SYNC_SECRET',
  'EVO_AGENT_WAHA_API_KEY',
  'EVO_AGENT_WAHA_WEBHOOK_SECRET',
] as const;

export type InboxProbeConfig = Readonly<{
  supabase: Readonly<{ origin: string; apiKey: string }> | null;
  waha: Readonly<{ origin: string; apiKey: string }> | null;
}>;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isSafeCredential(
  value: string | undefined,
  maximumBytes = 8_192
): value is string {
  return Boolean(
    value &&
    value === value.trim() &&
    !ASCII_CONTROL.test(value) &&
    byteLength(value) <= maximumBytes
  );
}

function isProtectedSecretName(name: string): boolean {
  if (name === 'EVO_INBOX_P7B_OBSERVABILITY_SECRET') {
    return false;
  }

  if (
    DISTINCT_SECRET_ENV_NAMES.some((protectedName) => protectedName === name)
  ) {
    return true;
  }

  return (
    /(?:SECRET|KEY|TOKEN)/.test(name) &&
    /(?:SUPABASE|WAHA|WEBHOOK|WORKER|AUTONOMOUS|AUTONOMY|LEAD_AGENT|^EVO_AGENT_)/.test(
      name
    )
  );
}

function reusesProtectedSecret(secret: string): boolean {
  return Object.entries(process.env).some(
    ([name, other]) =>
      isProtectedSecretName(name) &&
      (other === secret || other?.trim() === secret)
  );
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') {
    return true;
  }

  const octets = hostname.split('.');
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every(
      (octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255
    )
  );
}

function parseLoopbackOrigin(value: string): string | null {
  const match = LOOPBACK_HTTP_ORIGIN.exec(value);
  if (!match) {
    return null;
  }

  const port = Number(match[2]);
  if (port < 1 || port > 65_535) {
    return null;
  }

  try {
    const url = new URL(value);
    return isLoopbackHost(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

function parseSupabaseOrigin(value: string | undefined): string | null {
  if (!isSafeCredential(value, 2_048)) {
    return null;
  }

  if (process.env.NODE_ENV === 'production') {
    return PRODUCTION_SUPABASE_ORIGIN.test(value)
      ? new URL(value).origin
      : null;
  }

  return parseLoopbackOrigin(value);
}

function parseWahaOrigin(value: string | undefined): string | null {
  if (!isSafeCredential(value, 2_048)) {
    return null;
  }

  if (process.env.NODE_ENV === 'production') {
    return value === 'http://evo-inbox-waha:3000'
      ? 'http://evo-inbox-waha:3000'
      : null;
  }

  return process.env.NODE_ENV === 'test' ? parseLoopbackOrigin(value) : null;
}

export function readInboxObservabilitySecret(): string | null {
  if (process.env.EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED !== '1') {
    return null;
  }

  const secret = process.env.EVO_INBOX_P7B_OBSERVABILITY_SECRET;
  if (
    !isSafeCredential(secret, 128) ||
    byteLength(secret) < 32 ||
    reusesProtectedSecret(secret)
  ) {
    return null;
  }

  return secret;
}

export function readInboxProbeConfig(): InboxProbeConfig {
  const supabaseOrigin = parseSupabaseOrigin(
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const wahaOrigin = parseWahaOrigin(process.env.EVO_INBOX_WAHA_BASE_URL);
  const wahaKey = process.env.EVO_INBOX_WAHA_API_KEY;

  return Object.freeze({
    supabase:
      supabaseOrigin && isSafeCredential(supabaseKey)
        ? Object.freeze({ origin: supabaseOrigin, apiKey: supabaseKey })
        : null,
    waha:
      wahaOrigin && isSafeCredential(wahaKey)
        ? Object.freeze({ origin: wahaOrigin, apiKey: wahaKey })
        : null,
  });
}
