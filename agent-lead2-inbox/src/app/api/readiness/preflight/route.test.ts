import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getIntegrationSetting: vi.fn(),
  getIntegrationSecrets: vi.fn(),
  integrationsAdminClient: vi.fn(),
  getAiConfigSummary: vi.fn(),
  buildProductionPreflight: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized' },
      { status: 500 },
    ),
  ),
}))

vi.mock('@/lib/integrations/admin-client', () => ({
  IntegrationsAdminConfigurationError: class extends Error {
    missingFields: string[]
    constructor(fields: string[]) {
      super('bad config')
      this.missingFields = fields
    }
  },
  integrationsAdminClient: h.integrationsAdminClient,
}))

vi.mock('@/lib/integrations/settings', () => ({
  getIntegrationSecrets: h.getIntegrationSecrets,
  getIntegrationSetting: h.getIntegrationSetting,
}))

vi.mock('@/lib/ai/admin-store', () => ({
  getAiConfigSummary: h.getAiConfigSummary,
}))

vi.mock('@/lib/readiness/preflight', () => ({
  buildProductionPreflight: h.buildProductionPreflight,
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireRole.mockResolvedValue({ accountId: 'acct-1' })
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => Promise.resolve({ data: [], error: null })),
  }
  h.integrationsAdminClient.mockReturnValue({
    from: vi.fn(() => chain),
  })
  h.getIntegrationSetting.mockResolvedValue(null)
  h.getAiConfigSummary.mockResolvedValue({
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    system_prompt: null,
    is_active: true,
    auto_reply_enabled: false,
    auto_reply_max_per_conversation: 1,
    api_key: 'ciphertext',
    embeddings_provider: 'keyword',
    embeddings_api_key: null,
  })
  h.buildProductionPreflight.mockReturnValue({
    ready: false,
    checks: [],
    blockers: ['demo'],
  })
})

describe('GET /api/readiness/preflight', () => {
  it('derives AI readiness from the admin store instead of the SSR client', async () => {
    const response = await GET()

    expect(response.status).toBe(503)
    expect(h.getAiConfigSummary).toHaveBeenCalledWith('acct-1')
    expect(h.buildProductionPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({
          configured: true,
          active: true,
          hasKey: true,
          provider: 'gemini',
        }),
      }),
    )
  })
})
