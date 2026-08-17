const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUPABASE_PUBLISHABLE_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{8,}$/u;
const SUPABASE_SECRET_PATTERN = /^sb_secret_[A-Za-z0-9_-]{8,}$/u;

export const PLATFORM_STAFF_ASSISTANT_MODEL = "gemini-3.5-flash";
export const PLATFORM_STAFF_ASSISTANT_TIMEOUT_MS = 15_000;
export const PLATFORM_STAFF_ASSISTANT_MAX_OUTPUT_TOKENS = 2_048;
export const PLATFORM_STAFF_ASSISTANT_TEMPERATURE = 0.2;

export type PlatformStaffAssistantDisabledConfig = Readonly<{ enabled: false }>;

export type PlatformStaffAssistantEnabledConfig = Readonly<{
  enabled: true;
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey: string;
  organizationId: string;
  accountId: string;
  geminiApiKey: string;
  model: typeof PLATFORM_STAFF_ASSISTANT_MODEL;
  timeoutMs: typeof PLATFORM_STAFF_ASSISTANT_TIMEOUT_MS;
  maxOutputTokens: typeof PLATFORM_STAFF_ASSISTANT_MAX_OUTPUT_TOKENS;
  temperature: typeof PLATFORM_STAFF_ASSISTANT_TEMPERATURE;
}>;

export type PlatformStaffAssistantConfig =
  | PlatformStaffAssistantDisabledConfig
  | PlatformStaffAssistantEnabledConfig;

function validUuid(value: string | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/u.test(value));
}

function validHttpsUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.origin === value && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function loadPlatformStaffAssistantConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PlatformStaffAssistantConfig {
  if (environment.EVO_PLATFORM_STAFF_ASSISTANT_ENABLED !== "1") {
    return Object.freeze({ enabled: false });
  }

  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const supabaseSecretKey = environment.EVO_PLATFORM_SUPABASE_SECRET_KEY;
  const organizationId = environment.EVO_PLATFORM_ORGANIZATION_ID;
  const accountId = environment.EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID;
  const geminiApiKey = environment.EVO_PLATFORM_GEMINI_API_KEY;

  if (
    !validHttpsUrl(supabaseUrl) ||
    !supabasePublishableKey ||
    !SUPABASE_PUBLISHABLE_PATTERN.test(supabasePublishableKey) ||
    !supabaseSecretKey ||
    !SUPABASE_SECRET_PATTERN.test(supabaseSecretKey) ||
    supabasePublishableKey === supabaseSecretKey ||
    !validUuid(organizationId) ||
    !validUuid(accountId) ||
    organizationId === accountId ||
    !geminiApiKey ||
    geminiApiKey.trim() !== geminiApiKey ||
    geminiApiKey.length < 16
  ) {
    return Object.freeze({ enabled: false });
  }

  return Object.freeze({
    enabled: true,
    supabaseUrl,
    supabasePublishableKey,
    supabaseSecretKey,
    organizationId,
    accountId,
    geminiApiKey,
    model: PLATFORM_STAFF_ASSISTANT_MODEL,
    timeoutMs: PLATFORM_STAFF_ASSISTANT_TIMEOUT_MS,
    maxOutputTokens: PLATFORM_STAFF_ASSISTANT_MAX_OUTPUT_TOKENS,
    temperature: PLATFORM_STAFF_ASSISTANT_TEMPERATURE,
  });
}
