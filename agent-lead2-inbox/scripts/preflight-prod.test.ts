import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const script = join(process.cwd(), 'scripts/preflight-prod.mjs')

const readyEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  ENCRYPTION_KEY: '0'.repeat(64),
  NEXT_PUBLIC_SITE_URL: 'https://inbox.evoadmissions.com',
  EVO_INBOX_DOMAIN: 'inbox.evoadmissions.com',
  EVO_CADDY_NETWORK: 'evo_public_web',
  EVO_INBOX_WAHA_BASE_URL: 'http://evo-inbox-waha:3000',
  EVO_INBOX_WAHA_API_KEY: 'plain-waha-key',
  EVO_INBOX_WAHA_WEBHOOK_HMAC: 'waha-hmac',
  EVO_INBOX_AMOCRM_BASE_URL: 'https://example.amocrm.com',
  EVO_INBOX_AMOCRM_ACCESS_TOKEN: 'amo-token',
  EVO_INBOX_GEMINI_API_KEY: 'gemini-key',
  EVO_INBOX_TEST_WHATSAPP_NUMBER: '15551234567',
}

function runPreflight(env: Record<string, string>) {
  return spawnSync(process.execPath, [script, '--json'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    } as NodeJS.ProcessEnv,
    encoding: 'utf8',
  })
}

describe('preflight-prod', () => {
  it('accepts the Gemini seed key and does not require legacy provider globals', () => {
    const result = runPreflight(readyEnv)

    expect(result.status).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.ok).toBe(true)
    expect(payload.blockers).toEqual([])
    expect(result.stdout).toContain('EVO_INBOX_GEMINI_API_KEY')
    expect(result.stdout).not.toContain('OPENAI_API_KEY')
    expect(result.stdout).not.toContain('ANTHROPIC_API_KEY')
  })

  it('names the Gemini key when proof AI config is missing', () => {
    const withoutGemini: Partial<Record<keyof typeof readyEnv, string>> = {
      ...readyEnv,
    }
    delete withoutGemini.EVO_INBOX_GEMINI_API_KEY
    const result = runPreflight(withoutGemini as Record<string, string>)

    expect(result.status).toBe(1)
    const payload = JSON.parse(result.stdout)
    expect(payload.ok).toBe(false)
    expect(payload.blockers).toContainEqual({
      name: 'EVO_INBOX_GEMINI_API_KEY',
      message: 'missing EVO_INBOX_GEMINI_API_KEY',
    })
  })
})
