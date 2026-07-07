export type PreflightStatus = 'pass' | 'blocked'

export interface IntegrationReadinessState {
  configured: boolean
  connected?: boolean
  status?: string | null
  message?: string | null
  missingFields?: string[]
}

export interface AiReadinessState {
  configured: boolean
  active?: boolean
  hasKey?: boolean
  provider?: string | null
  message?: string | null
}

export interface PreflightInput {
  env: NodeJS.ProcessEnv
  waha: IntegrationReadinessState
  amocrm: IntegrationReadinessState
  ai: AiReadinessState
}

export interface PreflightCheck {
  id: string
  label: string
  status: PreflightStatus
  missing: string[]
  message: string
}

export interface PreflightResult {
  ready: boolean
  checks: PreflightCheck[]
  blockers: string[]
}

function present(env: NodeJS.ProcessEnv, name: string): boolean {
  return typeof env[name] === 'string' && env[name]!.trim().length > 0
}

function encryptedKeyOk(env: NodeJS.ProcessEnv): boolean {
  const value = env.ENCRYPTION_KEY?.trim() ?? ''
  return /^[a-f0-9]{64}$/i.test(value)
}

function checkRequiredEnv(
  env: NodeJS.ProcessEnv,
  id: string,
  label: string,
  required: string[],
  message: string,
): PreflightCheck {
  const missing = required.filter((name) => !present(env, name))
  return {
    id,
    label,
    status: missing.length === 0 ? 'pass' : 'blocked',
    missing,
    message: missing.length === 0 ? message : `Missing ${missing.join(', ')}`,
  }
}

export function buildProductionPreflight(input: PreflightInput): PreflightResult {
  const { env, waha, amocrm, ai } = input
  const checks: PreflightCheck[] = [
    checkRequiredEnv(
      env,
      'supabase',
      'Supabase companion store',
      [
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
      ],
      'Supabase URL, anon key, and service-role key are present.',
    ),
    {
      id: 'encryption',
      label: 'Secret encryption',
      status: encryptedKeyOk(env) ? 'pass' : 'blocked',
      missing: encryptedKeyOk(env) ? [] : ['ENCRYPTION_KEY'],
      message: encryptedKeyOk(env)
        ? 'ENCRYPTION_KEY is present and has the required 64 hex characters.'
        : 'Missing ENCRYPTION_KEY as a 64-character hex AES-256-GCM key.',
    },
    checkRequiredEnv(
      env,
      'domain',
      'DNS and Caddy route',
      ['NEXT_PUBLIC_SITE_URL', 'EVO_INBOX_DOMAIN', 'EVO_CADDY_NETWORK'],
      'Public URL, inbox domain, and Caddy Docker network are declared.',
    ),
    {
      id: 'waha',
      label: 'Private WAHA session',
      status: waha.configured && waha.connected ? 'pass' : 'blocked',
      missing: waha.missingFields ?? [],
      message:
        waha.message ??
        (waha.configured
          ? waha.connected
            ? 'WAHA session is configured and connected.'
            : `WAHA session is configured but not connected${waha.status ? ` (${waha.status})` : ''}.`
          : 'WAHA base URL, session, API key, and webhook HMAC must be configured.'),
    },
    {
      id: 'amocrm',
      label: 'amoCRM identity source',
      status: amocrm.configured ? 'pass' : 'blocked',
      missing: amocrm.missingFields ?? [],
      message:
        amocrm.message ??
        (amocrm.configured
          ? 'amoCRM identity configuration is present.'
          : 'amoCRM domain/base URL and access token must be configured.'),
    },
    {
      id: 'ai',
      label: 'Companion AI draft',
      status: ai.configured && ai.active && ai.hasKey ? 'pass' : 'blocked',
      missing: ai.configured && ai.active && ai.hasKey ? [] : ['AI provider key'],
      message:
        ai.message ??
        (ai.configured && ai.active && ai.hasKey
          ? `AI draft provider is configured${ai.provider ? ` (${ai.provider})` : ''}.`
          : 'OpenAI or Anthropic BYO key must be saved and enabled for draft generation.'),
    },
    checkRequiredEnv(
      env,
      'proof-number',
      'Production proof test number',
      ['EVO_INBOX_TEST_WHATSAPP_NUMBER'],
      'Dedicated test WhatsApp number is declared for the proof run.',
    ),
  ]

  const blockers = checks
    .filter((check) => check.status === 'blocked')
    .flatMap((check) =>
      check.missing.length > 0 ? check.missing : [check.label],
    )

  return {
    ready: blockers.length === 0,
    checks,
    blockers,
  }
}
