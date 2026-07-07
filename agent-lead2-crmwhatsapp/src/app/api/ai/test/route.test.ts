import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiError } from '@/lib/ai/types'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  decrypt: vi.fn(),
  validateAiCredentials: vi.fn(),
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

import { POST } from './route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/ai/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function supabaseWithStoredKey(apiKey: string | null) {
  const chain = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: apiKey ? { api_key: apiKey } : null, error: null }),
    ),
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
  h.decrypt.mockReturnValue('stored-provider-value')
  h.validateAiCredentials.mockResolvedValue(undefined)
})

describe('POST /api/ai/test', () => {
  it('allows Gemini and reuses the stored key when no fresh key is sent', async () => {
    h.requireRole.mockResolvedValue({
      supabase: supabaseWithStoredKey('encrypted-key'),
      accountId: 'acct-1',
      userId: 'user-1',
    })

    const response = await POST(
      request({ provider: 'gemini', model: 'gemini-3.5-flash' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(h.decrypt).toHaveBeenCalledWith('encrypted-key')
    const validationArg = h.validateAiCredentials.mock.calls[0][0]
    expect(validationArg).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
    })
    expect(validationArg.apiKey).toBe('stored-provider-value')
  })

  it('rejects unsupported providers before validating credentials', async () => {
    h.requireRole.mockResolvedValue({
      supabase: supabaseWithStoredKey('encrypted-key'),
      accountId: 'acct-1',
      userId: 'user-1',
    })

    const response = await POST(
      request({ provider: 'cohere', model: 'command-test' }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'provider must be "openai", "anthropic", or "gemini"',
    })
    expect(h.validateAiCredentials).not.toHaveBeenCalled()
  })

  it('maps Gemini validation failures to a typed 400 response', async () => {
    h.requireRole.mockResolvedValue({
      supabase: supabaseWithStoredKey(null),
      accountId: 'acct-1',
      userId: 'user-1',
    })
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
        api_key: 'AIza-test',
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Gemini rejected the API key',
      code: 'invalid_key',
    })
  })
})
