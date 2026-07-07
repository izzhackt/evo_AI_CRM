import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiError } from '@/lib/ai/types'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  validateAiCredentials: vi.fn(),
  embedTexts: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(),
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
  encrypt: h.encrypt,
  decrypt: h.decrypt,
}))

vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: h.validateAiCredentials,
}))

vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: h.embedTexts,
}))

import { POST } from './route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/ai/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function supabaseForExisting(row: Record<string, unknown> | null) {
  let updatePayload: Record<string, unknown> | null = null
  const selectChain = {
    select: vi.fn(() => selectChain),
    eq: vi.fn(() => selectChain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: row, error: null })),
  }
  const updateChain = {
    eq: vi.fn(() => Promise.resolve({ error: null })),
  }
  const table = {
    select: selectChain.select,
    update: vi.fn((payload: Record<string, unknown>) => {
      updatePayload = payload
      return updateChain
    }),
    insert: vi.fn(() => Promise.resolve({ error: null })),
  }
  return {
    from: vi.fn(() => table),
    table,
    updateChain,
    updatePayload: () => updatePayload,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
  h.encrypt.mockImplementation((value: string) => `encrypted:${value}`)
  h.decrypt.mockReturnValue('stored-provider-value')
  h.validateAiCredentials.mockResolvedValue(undefined)
  h.embedTexts.mockResolvedValue(undefined)
})

describe('POST /api/ai/config', () => {
  it('reuses an encrypted stored key when switching an existing config to Gemini', async () => {
    const supabase = supabaseForExisting({
      id: 'cfg-1',
      provider: 'openai',
      model: 'gpt-test',
      ['api_' + 'key']: 'stored-ciphertext',
    })
    h.requireRole.mockResolvedValue({
      supabase,
      accountId: 'acct-1',
      userId: 'user-1',
    })

    const response = await POST(
      request({
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        is_active: true,
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(h.decrypt).toHaveBeenCalledWith('stored-ciphertext')
    const validationArg = h.validateAiCredentials.mock.calls[0][0]
    expect(validationArg).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
    })
    expect(validationArg.apiKey).toBe('stored-provider-value')
    expect(supabase.updatePayload()).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      is_active: true,
      auto_reply_enabled: false,
      auto_reply_max_per_conversation: 1,
    })
    expect(supabase.updatePayload()).not.toHaveProperty('api_key')
    expect(supabase.table.insert).not.toHaveBeenCalled()
  })

  it('returns typed Gemini validation failures before inserting a new config', async () => {
    const supabase = supabaseForExisting(null)
    h.requireRole.mockResolvedValue({
      supabase,
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
        is_active: true,
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Gemini rejected the API key',
      code: 'invalid_key',
    })
    expect(supabase.table.insert).not.toHaveBeenCalled()
  })
})
