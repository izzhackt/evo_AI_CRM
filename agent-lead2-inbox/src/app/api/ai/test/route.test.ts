import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiError } from '@/lib/ai/types'

const TEST_STORED_CIPHERTEXT = ['stored', 'ciphertext'].join('-')
const TEST_STORED_PROVIDER_VALUE = ['stored', 'provider', 'value'].join('-')
const TEST_PROVIDER_KEY = ['provider', 'fixture'].join('-')

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  decrypt: vi.fn(),
  validateAiCredentials: vi.fn(),
  getStoredAiConfig: vi.fn(),
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

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: vi.fn(() =>
    NextResponse.json({ error: 'rate_limited' }, { status: 429 }),
  ),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: h.decrypt,
}))

vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: h.validateAiCredentials,
}))

vi.mock('@/lib/ai/admin-store', () => ({
  getStoredAiConfig: h.getStoredAiConfig,
}))

import { POST } from './route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/ai/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
  h.decrypt.mockReturnValue(TEST_STORED_PROVIDER_VALUE)
  h.validateAiCredentials.mockResolvedValue(undefined)
})

describe('POST /api/ai/test', () => {
  it('reuses the stored key from the admin store when no fresh key is sent', async () => {
    h.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
    h.getStoredAiConfig.mockResolvedValue({
      api_key: TEST_STORED_CIPHERTEXT,
    })

    const response = await POST(
      request({ provider: 'gemini', model: 'gemini-3.5-flash' }),
    )

    expect(response.status).toBe(200)
    expect(h.getStoredAiConfig).toHaveBeenCalledWith('acct-1')
    expect(h.decrypt).toHaveBeenCalledWith(TEST_STORED_CIPHERTEXT)
    expect(h.validateAiCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        apiKey: TEST_STORED_PROVIDER_VALUE,
      }),
    )
  })

  it('returns a friendly error when no stored key exists', async () => {
    h.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
    h.getStoredAiConfig.mockResolvedValue(null)

    const response = await POST(
      request({ provider: 'gemini', model: 'gemini-3.5-flash' }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Enter an API key to test.',
    })
  })

  it('maps typed validation failures to 400', async () => {
    h.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
    h.validateAiCredentials.mockRejectedValue(
      new AiError('Gemini rejected the API key', {
        code: 'invalid_key',
        status: 401,
      }),
    )

    const response = await POST(
      request({
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        api_key: TEST_PROVIDER_KEY,
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Gemini rejected the API key',
      code: 'invalid_key',
    })
  })
})
