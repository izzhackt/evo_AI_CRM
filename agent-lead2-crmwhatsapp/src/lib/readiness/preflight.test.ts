import { describe, expect, it } from 'vitest'

import { buildProductionPreflight } from './preflight'

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv
}

const READY_ENV = env({
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  ENCRYPTION_KEY: '0'.repeat(64),
  NEXT_PUBLIC_SITE_URL: 'https://inbox.evoadmissions.com',
  EVO_INBOX_DOMAIN: 'inbox.evoadmissions.com',
  EVO_CADDY_NETWORK: 'acadis_acadis_web',
  EVO_INBOX_TEST_WHATSAPP_NUMBER: '+14155551212',
})

describe('buildProductionPreflight', () => {
  it('passes only when env, WAHA, amoCRM, AI, and proof number are ready', () => {
    const result = buildProductionPreflight({
      env: READY_ENV,
      waha: { configured: true, connected: true, status: 'WORKING' },
      amocrm: { configured: true },
      ai: { configured: true, active: true, hasKey: true, provider: 'openai' },
    })

    expect(result.ready).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.checks.every((check) => check.status === 'pass')).toBe(true)
  })

  it('names exact blockers for missing production inputs', () => {
    const result = buildProductionPreflight({
      env: env({
        NEXT_PUBLIC_SUPABASE_URL: '',
        ENCRYPTION_KEY: 'short',
      }),
      waha: {
        configured: false,
        connected: false,
        missingFields: ['baseUrl', 'apiKey', 'webhookHmacSecret'],
      },
      amocrm: {
        configured: false,
        missingFields: ['baseUrl', 'accessToken'],
      },
      ai: { configured: false, active: false, hasKey: false },
    })

    expect(result.ready).toBe(false)
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'ENCRYPTION_KEY',
        'NEXT_PUBLIC_SITE_URL',
        'EVO_INBOX_DOMAIN',
        'EVO_CADDY_NETWORK',
        'baseUrl',
        'apiKey',
        'webhookHmacSecret',
        'accessToken',
        'AI provider key',
        'EVO_INBOX_TEST_WHATSAPP_NUMBER',
      ]),
    )
  })
})
